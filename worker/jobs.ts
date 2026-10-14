import type { Env, Clip } from "./types";
import { assert, getConfig, AppError, audit } from "./core";
import { connection, twitch, google, driveFolder } from "./connections";
import { encrypt, decrypt } from "./security";
const CHUNK = 4 * 1024 * 1024;
export async function isProtected(e: Env, id: string) {
  return !!(await e.DB.prepare(
    "SELECT clip_id FROM publication_clips WHERE clip_id=? UNION ALL SELECT clip_id FROM draft_clip_refs WHERE clip_id=? UNION ALL SELECT clip_id FROM playback_clip_leases WHERE clip_id=? AND expires>? LIMIT 1",
  )
    .bind(id, id, id, Date.now())
    .first());
}
export async function capacity(e: Env, reserve = 0) {
  const row = await e.DB.prepare(
    "SELECT COALESCE(SUM(bytes),0) AS bytes FROM clips WHERE r2_key IS NOT NULL",
  ).first<{ bytes: number }>();
  const frames = await e.DB.prepare(
    "SELECT COALESCE(SUM(bytes),0) AS bytes FROM frames",
  ).first<{ bytes: number }>();
  const pending = await e.DB.prepare(
    "SELECT COUNT(*) AS count FROM clips WHERE status IN ('requested','generating','downloading','storing','restoring','retry')",
  ).first<{ count: number }>();
  assert(
    (row?.bytes || 0) +
      (frames?.bytes || 0) +
      (pending?.count || 0) * 100 * 1024 * 1024 +
      reserve <
      Number(await getConfig(e, "r2_limit_bytes", "8589934592")),
    409,
    "保存容量の上限に近づいています。アーカイブして空きを確保してください",
  );
}
export async function claim(e: Env, id: string) {
  const owner = crypto.randomUUID();
  return await e.DB.prepare(
    "UPDATE clips SET lease_until=?, lease_owner=? WHERE id=? AND lease_until<? RETURNING *",
  )
    .bind(Date.now() + 90000, owner, id, Date.now())
    .first<Clip>();
}
export async function status(e: Env, c: Clip, stage: string) {
  await e.DB.prepare(
    "UPDATE clips SET status=?,updated=? WHERE id=? AND lease_owner=?",
  )
    .bind(stage, Date.now(), c.id, c.lease_owner)
    .run();
}
async function ingest(e: Env, c: Clip) {
  if (!c.twitch_id) {
    assert(
      !c.generation_started,
      409,
      "Twitchの作成応答を確認できません。Twitch側に作成済みの可能性があります。再試行前に公式クリップ一覧を確認してください",
    );
    await e.DB.prepare(
      "UPDATE clips SET generation_started=? WHERE id=? AND lease_owner=?",
    )
      .bind(Date.now(), c.id, c.lease_owner)
      .run();
    c.generation_started = Date.now();
    await status(e, c, "requested");
    const conn = await connection(e, "twitch");
    const q = new URLSearchParams({
      broadcaster_id: conn.user_id!,
      duration: String(c.requested_duration),
    });
    const r = await twitch(e, "clips?" + q, "POST");
    assert(r.data[0]?.id, 502, "TwitchからクリップIDが返されませんでした");
    c.twitch_id = r.data[0].id;
    c.generation_started = Date.now();
    await e.DB.prepare(
      "UPDATE clips SET twitch_id=?,generation_started=?,status='generating',updated=? WHERE id=? AND lease_owner=?",
    )
      .bind(c.twitch_id, c.generation_started, Date.now(), c.id, c.lease_owner)
      .run();
    return;
  }
  const found = await twitch(e, "clips?id=" + encodeURIComponent(c.twitch_id));
  const clip = found.data[0];
  if (!clip) {
    assert(
      Date.now() - (c.generation_started || c.created) < 60000,
      502,
      "Twitchのクリップ生成を60秒待ちました。再試行してください",
    );
    await status(e, c, "generating");
    return;
  }
  await status(e, c, "downloading");
  const conn = await connection(e, "twitch");
  const q = new URLSearchParams({
    broadcaster_id: conn.user_id!,
    editor_id: conn.user_id!,
    clip_id: c.twitch_id,
  });
  const result = await twitch(e, "clips/downloads?" + q);
  const url = result.data[0]?.landscape_download_url;
  assert(url, 502, "横向き動画のダウンロードがまだ準備できません");
  const download = new URL(url);
  assert(
    download.protocol === "https:" &&
      (download.hostname.endsWith(".twitchcdn.net") ||
        download.hostname.endsWith(".twitch.tv")),
    502,
    "Twitchの動画URLを検証できません",
  );
  const r = await fetch(download.toString());
  assert(r.ok && r.body, 502, "動画を取得できません");
  const size = Number(r.headers.get("content-length"));
  assert(
    size > 0 && size <= 100 * 1024 * 1024,
    413,
    "動画の容量が不明か、100MBを超えています",
  );
  await capacity(e, size);
  const key = "clips/" + c.id + ".mp4";
  const existing = await e.MEDIA.head(key);
  await status(e, c, "storing");
  await e.DB.prepare(
    "UPDATE clips SET r2_key=?,bytes=? WHERE id=? AND lease_owner=?",
  )
    .bind(key, size, c.id, c.lease_owner)
    .run();
  if (!existing) {
    await e.MEDIA.put(key, r.body, {
      httpMetadata: { contentType: "video/mp4" },
    });
  } else await r.body.cancel();
  const stored = await e.MEDIA.head(key);
  assert(
    stored && stored.size === size,
    502,
    "R2に保存した容量の確認に失敗しました",
  );
  await e.DB.prepare(
    "UPDATE clips SET r2_key=?,bytes=?,duration=?,thumbnail=?,status='ready',error=NULL,attempts=0,updated=? WHERE id=? AND lease_owner=?",
  )
    .bind(
      key,
      size,
      clip.duration,
      clip.thumbnail_url,
      Date.now(),
      c.id,
      c.lease_owner,
    )
    .run();
}
interface Transfer {
  id: string;
  clip_id: string;
  status: string;
  encrypted_url: string | null;
  drive_id: string | null;
  offset: number;
  bytes: number;
  error: string | null;
}
async function archive(e: Env, c: Clip) {
  if (c.status !== "archiving") {
    const acquired = await e.DB.prepare(
      "UPDATE clips SET status='archiving' WHERE id=? AND lease_owner=? AND status='ready' AND NOT EXISTS(SELECT 1 FROM draft_clip_refs WHERE clip_id=?) AND NOT EXISTS(SELECT 1 FROM publication_clips WHERE clip_id=?) AND NOT EXISTS(SELECT 1 FROM playback_clip_leases WHERE clip_id=? AND expires>?) RETURNING id",
    )
      .bind(c.id, c.lease_owner, c.id, c.id, c.id, Date.now())
      .first();
    if (!acquired) return;
  }
  assert(c.r2_key, 409, "R2の元動画がありません");
  const source = await e.MEDIA.head(c.r2_key);
  let tr = await e.DB.prepare("SELECT * FROM transfers WHERE clip_id=?")
    .bind(c.id)
    .first<Transfer>();
  if (!tr) {
    const id = crypto.randomUUID();
    await e.DB.prepare(
      "INSERT INTO transfers(id,clip_id,status,bytes,updated) VALUES (?,?,'pending',?,?)",
    )
      .bind(id, c.id, c.bytes, Date.now())
      .run();
    tr = {
      id,
      clip_id: c.id,
      status: "pending",
      encrypted_url: null,
      drive_id: null,
      offset: 0,
      bytes: c.bytes,
      error: null,
    };
  }
  assert(
    (source && source.size === c.bytes) ||
      (!source && tr.status === "verified" && c.drive_id === tr.drive_id),
    409,
    "R2の元動画の容量が一致しません",
  );
  if (!tr.drive_id) {
    const generated = await google(
      e,
      "https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive&type=files",
    );
    tr.drive_id = ((await generated.json()) as { ids: string[] }).ids[0];
    await e.DB.prepare("UPDATE transfers SET drive_id=?,updated=? WHERE id=?")
      .bind(tr.drive_id, Date.now(), tr.id)
      .run();
    return;
  }
  // A stable Drive file ID makes an upload retry idempotent, even after response loss.
  const token = await connection(e, "google");
  const check = await fetch(
    `https://www.googleapis.com/drive/v3/files/${tr.drive_id}?fields=id,size,md5Checksum,trashed`,
    { headers: { Authorization: "Bearer " + token.access_token } },
  );
  if (check.ok) {
    const file = (await check.json()) as {
      id: string;
      size: string;
      md5Checksum?: string;
      trashed: boolean;
    };
    assert(
      !file.trashed && Number(file.size) === c.bytes,
      409,
      "Driveの保存容量が一致しません。元動画を保持しています",
    );
    if (source?.checksums.md5 && file.md5Checksum) {
      const checksum = Array.from(new Uint8Array(source.checksums.md5))
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
      assert(
        checksum === file.md5Checksum,
        409,
        "Driveのチェックサムが一致しません",
      );
    }
    await e.DB.batch([
      e.DB.prepare(
        "UPDATE clips SET drive_id=?,updated=? WHERE id=? AND lease_owner=?",
      ).bind(file.id, Date.now(), c.id, c.lease_owner),
      e.DB.prepare(
        "UPDATE transfers SET status='verified',offset=bytes,error=NULL,updated=? WHERE id=?",
      ).bind(Date.now(), tr.id),
    ]);
    // Publication cannot add archiving clips, and player leases cannot acquire them.
    assert(
      !(await isProtected(e, c.id)),
      409,
      "上映で使用中のため削除を保留します",
    );
    await e.MEDIA.delete(c.r2_key);
    await e.DB.batch([
      e.DB.prepare(
        "UPDATE clips SET status='archived',r2_key=NULL,error=NULL,attempts=0,updated=? WHERE id=? AND lease_owner=?",
      ).bind(Date.now(), c.id, c.lease_owner),
      e.DB.prepare(
        "UPDATE transfers SET status='complete',error=NULL,updated=? WHERE id=?",
      ).bind(Date.now(), tr.id),
    ]);
    await audit(e, "自動処理", "archive:" + c.id);
    return;
  }
  assert(
    check.status === 404,
    502,
    "Driveの保存確認ができません。元動画を保持しています",
  );
  if (!tr.encrypted_url) {
    const folder = await driveFolder(e, token);
    const date = new Date(c.created).toISOString().slice(0, 10);
    const response = await google(
      e,
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,size,md5Checksum",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Upload-Content-Type": "video/mp4",
          "X-Upload-Content-Length": String(c.bytes),
        },
        body: JSON.stringify({
          id: tr.drive_id,
          name: `${date}_${c.title.replace(/[\/\\]/g, "_")}_${c.id}.mp4`,
          parents: [folder],
          appProperties: { nobori_clip: c.id },
        }),
      },
    );
    const upload = response.headers.get("location");
    assert(upload, 502, "Driveの転送先を取得できません");
    await e.DB.prepare(
      "UPDATE transfers SET encrypted_url=?,status='uploading',updated=? WHERE id=?",
    )
      .bind(await encrypt(e, upload), Date.now(), tr.id)
      .run();
    return;
  }
  const upload = await decrypt<string>(e, tr.encrypted_url);
  // Query the server's acknowledged range before each chunk to survive network interruptions.
  const probe = await fetch(upload, {
    method: "PUT",
    headers: {
      Authorization: "Bearer " + token.access_token,
      "Content-Length": "0",
      "Content-Range": `bytes */${c.bytes}`,
    },
  });
  if (probe.ok) return;
  if (probe.status === 404 || probe.status === 410) {
    await e.DB.prepare(
      "UPDATE transfers SET encrypted_url=NULL,offset=0,status='pending',updated=? WHERE id=?",
    )
      .bind(Date.now(), tr.id)
      .run();
    return;
  }
  assert(probe.status === 308, 502, "Driveの転送再開位置を確認できません");
  const acknowledged = probe.headers.get("range");
  const offset = acknowledged ? Number(acknowledged.split("-")[1]) + 1 : 0;
  assert(offset < c.bytes, 502, "転送完了を確認できません");
  const length = Math.min(CHUNK, c.bytes - offset);
  const chunk = await e.MEDIA.get(c.r2_key, { range: { offset, length } });
  assert(chunk, 409, "R2の元動画が見つかりません");
  const put = await fetch(upload, {
    method: "PUT",
    headers: {
      Authorization: "Bearer " + token.access_token,
      "Content-Type": "video/mp4",
      "Content-Length": String(length),
      "Content-Range": `bytes ${offset}-${offset + length - 1}/${c.bytes}`,
    },
    body: chunk.body,
  });
  assert(
    put.ok || put.status === 308,
    502,
    "Driveへの転送が中断しました。元動画を保持しています",
  );
  const range = put.headers.get("range");
  const received = put.ok
    ? c.bytes
    : range
      ? Number(range.split("-")[1]) + 1
      : offset;
  await e.DB.prepare(
    "UPDATE transfers SET offset=?,error=NULL,updated=? WHERE id=?",
  )
    .bind(received, Date.now(), tr.id)
    .run();
}
async function restore(e: Env, c: Clip) {
  assert(c.drive_id, 409, "アーカイブ先がありません");
  await capacity(e, c.bytes);
  const meta = await google(
    e,
    `https://www.googleapis.com/drive/v3/files/${c.drive_id}?fields=id,size,trashed`,
  );
  const file = (await meta.json()) as { size: string; trashed: boolean };
  assert(
    !file.trashed && Number(file.size) === c.bytes,
    409,
    "Driveの動画を確認できません",
  );
  const r = await google(
    e,
    `https://www.googleapis.com/drive/v3/files/${c.drive_id}?alt=media`,
  );
  assert(r.body, 502, "Driveから動画を取得できません");
  const key = "clips/" + c.id + ".mp4";
  await e.MEDIA.put(key, r.body, {
    httpMetadata: { contentType: "video/mp4" },
  });
  assert(
    (await e.MEDIA.head(key))?.size === c.bytes,
    502,
    "復元した容量の確認に失敗しました",
  );
  await e.DB.prepare(
    "UPDATE clips SET status='ready',r2_key=?,restore_until=?,archive_at=?,error=NULL,attempts=0,updated=? WHERE id=? AND lease_owner=?",
  )
    .bind(
      key,
      Date.now() + 86400000,
      Date.now() + 86400000,
      Date.now(),
      c.id,
      c.lease_owner,
    )
    .run();
}
export async function processClip(e: Env, id: string) {
  const c = await claim(e, id);
  if (!c) return;
  try {
    if (
      ["requested", "generating", "downloading", "storing", "retry"].includes(
        c.status,
      )
    )
      await ingest(e, c);
    else if (
      c.status === "archiving" ||
      (c.status === "ready" && c.archive_at <= Date.now())
    )
      await archive(e, c);
    else if (c.status === "restoring") await restore(e, c);
  } catch (error) {
    const message =
      error instanceof AppError
        ? error.message
        : "処理が中断しました。再試行してください";
    const attempts = c.attempts + 1;
    const stage =
      c.status === "archiving"
        ? "archiving"
        : c.status === "restoring"
          ? "restoring"
          : c.status === "ready"
            ? "ready"
            : !c.twitch_id && c.generation_started
              ? "error"
              : attempts >= 5
                ? "error"
                : "retry";
    await e.DB.prepare(
      "UPDATE clips SET status=?,error=?,attempts=?,retry_at=?,updated=? WHERE id=? AND lease_owner=?",
    )
      .bind(
        stage,
        message,
        attempts,
        Date.now() + Math.min(3600000, 2 ** attempts * 15000),
        Date.now(),
        c.id,
        c.lease_owner,
      )
      .run();
    await e.DB.prepare("UPDATE transfers SET error=?,updated=? WHERE clip_id=?")
      .bind(message, Date.now(), c.id)
      .run();
  } finally {
    await e.DB.prepare(
      "UPDATE clips SET lease_until=0,lease_owner=NULL WHERE id=? AND lease_owner=?",
    )
      .bind(c.id, c.lease_owner)
      .run();
  }
}
export async function tick(e: Env) {
  const row = await e.DB.prepare(
    "SELECT id FROM clips WHERE lease_until<? AND retry_at<? AND ((status IN ('requested','generating','downloading','storing','retry','archiving','restoring')) OR (status='ready' AND archive_at<? AND NOT EXISTS(SELECT 1 FROM draft_clip_refs WHERE clip_id=clips.id) AND NOT EXISTS(SELECT 1 FROM publication_clips WHERE clip_id=clips.id) AND NOT EXISTS(SELECT 1 FROM playback_clip_leases WHERE clip_id=clips.id AND expires>?))) ORDER BY CASE WHEN status IN ('requested','generating','downloading','storing','retry') THEN 0 ELSE 1 END,created LIMIT 1",
  )
    .bind(Date.now(), Date.now(), Date.now(), Date.now())
    .first<{ id: string }>();
  if (row) await processClip(e, row.id);
}
export async function cleanup(e: Env) {
  await e.DB.batch([
    e.DB.prepare("DELETE FROM sessions WHERE expires<?").bind(Date.now()),
    e.DB.prepare("DELETE FROM rate_limits WHERE expires<?").bind(Date.now()),
    e.DB.prepare("DELETE FROM oauth_states WHERE expires<?").bind(Date.now()),
    e.DB.prepare("DELETE FROM playback_frame_leases WHERE expires<?").bind(
      Date.now(),
    ),
    e.DB.prepare("DELETE FROM playback_clip_leases WHERE expires<?").bind(
      Date.now(),
    ),
    e.DB.prepare("DELETE FROM playback_leases WHERE expires<?").bind(
      Date.now(),
    ),
    e.DB.prepare("DELETE FROM audit WHERE at<?").bind(
      Date.now() - 90 * 86400000,
    ),
    e.DB.prepare(
      "INSERT INTO storage_history(day,bytes) SELECT ?,COALESCE(SUM(bytes),0) FROM clips WHERE r2_key IS NOT NULL ON CONFLICT(day) DO UPDATE SET bytes=excluded.bytes",
    ).bind(new Date().toISOString().slice(0, 10)),
  ]);
}
