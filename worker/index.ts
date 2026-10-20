import { z, ZodError } from "zod";
import type { Env, Session, Clip, Draft, Playlist } from "./types";
import { uid, now } from "./types";
import {
  AppError,
  assert,
  body,
  daysSchema,
  draftSchema,
  validateDraft,
  archiveDate,
  getConfig,
  setConfig,
  json,
  audit,
  byteRange,
} from "./core";
import {
  hash,
  secretDigest,
  equal,
  limit,
  session,
  csrf,
  admin,
  cookie,
  issuePlayer,
  playerAuth,
} from "./security";
import { capture } from "./capture";
import { extensionRoute, issueExtensionCode, revokeExtensions } from "./extension";
import { oauthStart, oauthCallback, twitch } from "./connections";
import { capacity, processClip, tick, cleanup, isProtected } from "./jobs";
const titleSchema = z.string().trim().min(1).max(160);
const uuid = z.string().uuid();
async function all<T>(e: Env, sql: string, ...params: unknown[]) {
  return (
    await e.DB.prepare(sql)
      .bind(...params)
      .all<T>()
  ).results;
}
async function findClip(e: Env, id: string) {
  uuid.parse(id);
  const c = await e.DB.prepare("SELECT * FROM clips WHERE id=?")
    .bind(id)
    .first<Clip>();
  assert(c, 404, "クリップがありません");
  return c;
}
async function findPlaylist(e: Env, id: string) {
  uuid.parse(id);
  const p = await e.DB.prepare("SELECT * FROM playlists WHERE id=?")
    .bind(id)
    .first<Playlist>();
  assert(p, 404, "再生リストがありません");
  return p;
}
async function valid(e: Env, draft: Draft) {
  const ids = [...new Set(draft.items.map((i) => i.clipId))];
  const clips = ids.length
    ? await all<Clip>(
        e,
        "SELECT * FROM clips WHERE id IN (" +
          ids.map(() => "?").join(",") +
          ")",
        ...ids,
      )
    : [];
  const data = validateDraft(draft, clips);
  const frameIds = [
    ...new Set(
      data.items.map((i) => i.frameId).filter((v): v is string => !!v),
    ),
  ];
  if (frameIds.length) {
    const found = await all(
      e,
      "SELECT id FROM frames WHERE deleting=0 AND id IN (" +
        frameIds.map(() => "?").join(",") +
        ")",
      ...frameIds,
    );
    assert(found.length === frameIds.length, 400, "フレームがありません");
  }
  return data;
}
async function manifest(req: Request, e: Env) {
  await playerAuth(req, e);
  const u = new URL(req.url);
  const lease = uuid.parse(u.searchParams.get("lease"));
  const p = await e.DB.prepare("SELECT * FROM publication WHERE id=1").first<{
    snapshot: string;
    playlist_id: string;
    version: number;
    published: number;
  }>();
  if (!p) return json(null);
  const data = JSON.parse(p.snapshot) as {
    title: string;
    draft: Draft;
    duration: number;
  };
  await e.DB.batch([
    e.DB.prepare(
      "INSERT INTO playback_leases VALUES (?,?) ON CONFLICT(id) DO UPDATE SET expires=excluded.expires",
    ).bind(lease, now() + 90000),
    ...data.draft.items.map((item) =>
      e.DB.prepare(
        "INSERT INTO playback_clip_leases VALUES (?,?,?) ON CONFLICT(lease_id,clip_id) DO UPDATE SET expires=excluded.expires",
      ).bind(lease, item.clipId, now() + 90000),
    ),
  ]);
  const frameIds = [
    ...new Set(
      data.draft.items
        .map((item) => item.frameId)
        .filter((id): id is string => !!id),
    ),
  ];
  if (frameIds.length)
    await e.DB.batch(
      frameIds.map((id) =>
        e.DB.prepare(
          "INSERT INTO playback_frame_leases VALUES (?,?,?) ON CONFLICT(lease_id,frame_id) DO UPDATE SET expires=excluded.expires",
        ).bind(lease, id, now() + 90000),
      ),
    );
  return json({
    id: p.playlist_id + ":" + p.version + ":" + p.published,
    ...data,
    version: p.version,
  });
}
async function route(
  req: Request,
  e: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const u = new URL(req.url),
    path = u.pathname,
    method = req.method;
  if (!path.startsWith("/api") && !path.startsWith("/media"))
    return e.ASSETS.fetch(req);
  assert(
    e.AUTH_KEY && e.TOKEN_ENCRYPTION_KEY,
    503,
    "初期設定が未完了です。セットアップ手順を確認してください",
  );
  if (path.startsWith("/api/extension/")) return extensionRoute(req, e, ctx);
  if (path === "/api/login" && method === "POST") {
    assert(
      req.headers.get("origin") === e.APP_ORIGIN,
      403,
      "アクセス元を確認してください",
    );
    const input = await body(
      req,
      z.object({
        password: z.string().max(256),
        name: z.string().trim().max(40).default("スタッフ"),
      }),
    );
    const ip = await secretDigest(
      e,
      req.headers.get("cf-connecting-ip") || "local",
    );
    await limit(e, "login:" + ip);
    const expected = await getConfig(
      e,
      "staff_password_hash",
      e.STAFF_PASSWORD_HASH,
    );
    assert(
      equal(await secretDigest(e, input.password), expected),
      401,
      "パスワードが違います",
    );
    const id = uid() + uid(),
      token = uid();
    await e.DB.prepare("INSERT INTO sessions VALUES (?,?,?,?,?)")
      .bind(
        await hash(id),
        token,
        input.name || "スタッフ",
        now() + 43200000,
        Number(await getConfig(e, "credential_epoch", "1")),
      )
      .run();
    await e.DB.prepare("DELETE FROM rate_limits WHERE key=?")
      .bind("login:" + ip)
      .run();
    await audit(e, input.name || "スタッフ", "login");
    return new Response(
      JSON.stringify({
        csrf: token,
        name: input.name || "スタッフ",
        expires: now() + 43200000,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "Set-Cookie": cookie(id, e),
        },
      },
    );
  }
  if (path.startsWith("/api/player/")) {
    await playerAuth(req, e);
    assert(method === "GET", 405, "読み取り専用です");
    if (path.endsWith("/manifest")) return manifest(req, e);
    const lease = uuid.parse(u.searchParams.get("lease"));
    if (path.endsWith("/release")) {
      await e.DB.batch([
        e.DB.prepare("DELETE FROM playback_frame_leases WHERE lease_id=?").bind(
          lease,
        ),
        e.DB.prepare("DELETE FROM playback_clip_leases WHERE lease_id=?").bind(
          lease,
        ),
        e.DB.prepare("DELETE FROM playback_leases WHERE id=?").bind(lease),
      ]);
      return json({ ok: true });
    }
    if (path.endsWith("/heartbeat")) {
      await e.DB.batch([
        e.DB.prepare(
          "UPDATE playback_frame_leases SET expires=? WHERE lease_id=?",
        ).bind(now() + 90000, lease),
        e.DB.prepare(
          "UPDATE playback_clip_leases SET expires=? WHERE lease_id=?",
        ).bind(now() + 90000, lease),
        e.DB.prepare("UPDATE playback_leases SET expires=? WHERE id=?").bind(
          now() + 90000,
          lease,
        ),
      ]);
      return json({ ok: true });
    }
    throw new AppError(404, "再生APIがありません");
  }
  if (path.startsWith("/media/")) return serveMedia(req, e);
  const s = await session(req, e);
  if (!["GET", "HEAD"].includes(method)) csrf(req, e, s);
  if (path === "/api/extension-code" && method === "POST") return issueExtensionCode(e, s);
  if (path === "/api/extension-revoke" && method === "POST") return revokeExtensions(e, s);
  if (path === "/api/session")
    return json({ name: s.name, csrf: s.csrf, expires: s.expires });
  if (path === "/api/logout" && method === "POST") {
    await e.DB.prepare("DELETE FROM sessions WHERE id=?").bind(s.id).run();
    return new Response("{}", {
      headers: {
        "Set-Cookie": cookie("", e, 0),
        "Content-Type": "application/json",
      },
    });
  }
  if (path === "/api/state" && method === "GET") {
    const [
      clips,
      playlists,
      frames,
      connections,
      publication,
      history,
      transfers,
      logs,
      playback,
    ] = await Promise.all([
      all(
        e,
        "SELECT * FROM clips WHERE status<>'archived' OR id IN (SELECT id FROM clips ORDER BY created DESC LIMIT 1000) ORDER BY created DESC",
      ),
      all(e, "SELECT * FROM playlists ORDER BY updated DESC"),
      all(
        e,
        "SELECT id,name,width,height,bytes,created FROM frames ORDER BY created DESC",
      ),
      all(e, "SELECT provider,updated FROM connections"),
      e.DB.prepare(
        "SELECT playlist_id,version,published FROM publication WHERE id=1",
      ).first(),
      all(e, "SELECT * FROM storage_history ORDER BY day DESC LIMIT 30"),
      all(
        e,
        "SELECT id,clip_id,status,offset,bytes,error,updated FROM transfers ORDER BY updated DESC LIMIT 100",
      ),
      all(
        e,
        "SELECT at,name,action,result FROM audit ORDER BY id DESC LIMIT 100",
      ),
      e.DB.prepare(
        "SELECT COUNT(*) AS count FROM playback_leases WHERE expires>?",
      )
        .bind(now())
        .first<{ count: number }>(),
    ]);
    const usage = await e.DB.prepare(
      "SELECT (SELECT COALESCE(SUM(bytes),0) FROM clips WHERE r2_key IS NOT NULL)+(SELECT COALESCE(SUM(bytes),0) FROM frames) AS bytes",
    ).first<{ bytes: number }>();
    const counts = await e.DB.prepare(
      "SELECT SUM(status='ready') AS ready,SUM(status='ready' AND edit_status='pending') AS pending,SUM(drive_id IS NOT NULL) AS archived,SUM(error IS NOT NULL) AS errors,SUM(status IN ('archiving','restoring') OR status='ready' AND archive_at<=?) AS due FROM clips",
    )
      .bind(now())
      .first();
    const protectedClipIds = (
      await all<{ clip_id: string }>(
        e,
        "SELECT clip_id FROM draft_clip_refs UNION SELECT clip_id FROM publication_clips UNION SELECT clip_id FROM playback_clip_leases WHERE expires>?",
        now(),
      )
    ).map((row) => row.clip_id);
    return json({
      protectedClipIds,
      counts,
      clips,
      playlists,
      frames,
      connections,
      publication,
      history,
      transfers,
      audit: logs,
      retention: Number(await getConfig(e, "retention_days", "7")),
      limit: Number(await getConfig(e, "r2_limit_bytes", "8589934592")),
      bytes: usage?.bytes || 0,
      playbackActive: playback?.count || 0,
      origin: e.APP_ORIGIN,
    });
  }
  if (path === "/api/clips" && method === "GET") {
    const search = z
      .string()
      .max(160)
      .parse(u.searchParams.get("search") || "");
    const filter = z
      .enum(["all", "pending", "edited", "archived", "error", "due"])
      .parse(u.searchParams.get("filter") || "all");
    const page = Math.max(
      1,
      Math.min(100000, Number(u.searchParams.get("page")) || 1),
    );
    const direction = u.searchParams.get("sort") === "old" ? "ASC" : "DESC";
    const archived = u.searchParams.get("archived") === "1";
    const condition = [
      archived ? "drive_id IS NOT NULL" : "1=1",
      filter === "due"
        ? "(status IN ('archiving','restoring') OR status='ready' AND archive_at<=strftime('%s','now')*1000)"
        : filter === "pending"
          ? "edit_status='pending' AND status='ready'"
          : filter === "edited"
            ? "edit_status='edited'"
            : filter === "archived"
              ? "drive_id IS NOT NULL"
              : filter === "error"
                ? "error IS NOT NULL"
                : "1=1",
      "(title LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')",
    ].join(" AND ");
    const pattern = "%" + search.replace(/[\\%_]/g, "\\$&") + "%";
    const total = await e.DB.prepare(
      "SELECT COUNT(*) AS total FROM clips WHERE " + condition,
    )
      .bind(pattern, pattern)
      .first<{ total: number }>();
    const clips = await all<Clip>(
      e,
      "SELECT * FROM clips WHERE " +
        condition +
        " ORDER BY created " +
        direction +
        " LIMIT 48 OFFSET ?",
      pattern,
      pattern,
      (page - 1) * 48,
    );
    return json({ clips, total: total?.total || 0, page });
  }
  if (path === "/api/live" && method === "GET") {
    const c = await e.DB.prepare(
      "SELECT provider FROM connections WHERE provider='twitch'",
    ).first();
    if (!c) return json({ connected: false, live: false });
    const response = await twitch(e, "streams?user_login=nobori_official");
    return json({
      connected: true,
      live: response.data.length > 0,
      title: response.data[0]?.title || "",
      started: response.data[0]?.started_at || null,
    });
  }
  if (path === "/api/clips" && method === "POST") return capture(req, e, ctx, s);
  if (path === "/api/playlists" && method === "POST") {
    const input = await body(
      req,
      z.object({ title: titleSchema, draft: draftSchema.optional() }),
    );
    const draft = input.draft
      ? await valid(e, input.draft)
      : { items: [], loop: false, endBehavior: "black" };
    const id = uid();
    await e.DB.prepare("INSERT INTO playlists VALUES (?,?,1,?,?)")
      .bind(id, input.title, JSON.stringify(draft), now())
      .run();
    await audit(e, s.name, "playlist:create");
    return json({ id }, 201);
  }
  let m =
    /^\/api\/playlists\/([^/]+)(?:\/(publish|duplicate|unpublish))?$/.exec(
      path,
    );
  if (m) {
    const p = await findPlaylist(e, m[1]);
    if (method === "GET") return json(p);
    if (method === "PUT" && !m[2]) {
      const input = await body(
        req,
        z.object({
          title: titleSchema,
          version: z.number().int().positive(),
          draft: draftSchema,
        }),
      );
      const draft = await valid(e, input.draft);
      const r = await e.DB.prepare(
        "UPDATE playlists SET title=?,draft=?,version=version+1,updated=? WHERE id=? AND version=? RETURNING version",
      )
        .bind(input.title, JSON.stringify(draft), now(), p.id, input.version)
        .first();
      assert(r, 409, "別のスタッフがこの再生リストを更新しました");
      await audit(e, s.name, "playlist:save:" + p.id);
      return json(r);
    }
    if (method === "POST" && m[2] === "duplicate") {
      const id = uid();
      await e.DB.prepare("INSERT INTO playlists VALUES (?,?,1,?,?)")
        .bind(id, p.title + " のコピー", p.draft, now())
        .run();
      return json({ id }, 201);
    }
    if (method === "POST" && m[2] === "publish") {
      const input = await body(req, z.object({ version: z.number().int() }));
      assert(
        input.version === p.version,
        409,
        "公開前に最新版を保存してください",
      );
      const draft = await valid(e, JSON.parse(p.draft));
      assert(draft.items.length, 400, "クリップを追加してください");
      const snapshot = JSON.stringify({
        title: p.title,
        draft,
        duration: draft.items.reduce((n, i) => n + i.end - i.start, 0),
      });
      const ids = [...new Set(draft.items.map((x) => x.clipId))];
      try {
        await e.DB.batch([
          e.DB.prepare("DELETE FROM publication_clips"),
          e.DB.prepare("DELETE FROM publication_frames"),
          ...[
            ...new Set(
              draft.items
                .map((i) => i.frameId)
                .filter((id): id is string => !!id),
            ),
          ].map((id) =>
            e.DB.prepare("INSERT INTO publication_frames VALUES (?)").bind(id),
          ),
          ...ids.map((id) =>
            e.DB.prepare("INSERT INTO publication_clips VALUES (?)").bind(id),
          ),
          e.DB.prepare(
            "INSERT INTO publication VALUES (1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET playlist_id=excluded.playlist_id,version=excluded.version,snapshot=excluded.snapshot,published=excluded.published",
          ).bind(p.id, p.version, snapshot, now()),
        ]);
      } catch {
        throw new AppError(
          409,
          "内容または素材の状態が変わりました。最新版を確認して再度公開してください",
        );
      }
      await audit(e, s.name, "publish:" + p.id);
      return json({ ok: true });
    }
    if (method === "POST" && m[2] === "unpublish") {
      await e.DB.batch([
        e.DB.prepare("DELETE FROM publication WHERE playlist_id=?").bind(p.id),
        e.DB.prepare(
          "DELETE FROM publication_frames WHERE NOT EXISTS(SELECT 1 FROM publication)",
        ),
        e.DB.prepare(
          "DELETE FROM publication_clips WHERE NOT EXISTS(SELECT 1 FROM publication)",
        ),
      ]);
      await audit(e, s.name, "unpublish:" + p.id);
      return json({ ok: true });
    }
    if (method === "DELETE") {
      assert(
        !(await e.DB.prepare("SELECT id FROM publication WHERE playlist_id=?")
          .bind(p.id)
          .first()),
        409,
        "公開を停止してから削除してください",
      );
      await e.DB.prepare("DELETE FROM playlists WHERE id=?").bind(p.id).run();
      await audit(e, s.name, "playlist:delete:" + p.id);
      return json({ ok: true });
    }
  }
  m = /^\/api\/clips\/([^/]+)(?:\/(retry|archive|restore|process))?$/.exec(
    path,
  );
  if (m) {
    const c = await findClip(e, m[1]);
    if (method === "PUT") {
      const input = await body(
        req,
        z.object({
          title: titleSchema,
          tags: z.array(z.string().trim().max(40)).max(20),
          retention: daysSchema.optional(),
          updated: z.number(),
        }),
      );
      if (input.retention) await admin(req, e, s);
      const r = await e.DB.prepare(
        "UPDATE clips SET title=?,tags=?,retention_days=COALESCE(?,retention_days),archive_at=CASE WHEN ? IS NULL THEN archive_at ELSE ? END,updated=? WHERE id=? AND updated=? RETURNING id",
      )
        .bind(
          input.title,
          JSON.stringify(input.tags),
          input.retention ?? null,
          input.retention ?? null,
          input.retention ? archiveDate(c.created, input.retention) : null,
          now(),
          c.id,
          input.updated,
        )
        .first();
      assert(r, 409, "別のスタッフがこのクリップを更新しました");
      await audit(e, s.name, "clip:update:" + c.id);
      return json({ ok: true });
    }
    if (method === "POST" && m[2] === "process") {
      if (c.lease_owner) return json({ ok: true });
      ctx.waitUntil(processClip(e, c.id));
      return json({ ok: true }, 202);
    }
    if (method === "POST" && m[2] === "retry") {
      assert(
        c.error || ["retry", "error"].includes(c.status),
        409,
        "再試行する処理がありません",
      );
      const stage =
        c.drive_id && c.status === "restoring"
          ? "restoring"
          : c.status === "archiving"
            ? "archiving"
            : c.status === "ready"
              ? "ready"
              : "retry";
      await e.DB.prepare(
        "UPDATE clips SET status=?,retry_at=0,attempts=0,error=NULL,generation_started=CASE WHEN twitch_id IS NULL THEN NULL ELSE generation_started END WHERE id=? AND lease_until<?",
      )
        .bind(stage, c.id, now())
        .run();
      ctx.waitUntil(processClip(e, c.id));
      await audit(e, s.name, "retry:" + c.id);
      return json({ ok: true }, 202);
    }
    if (method === "POST" && m[2] === "archive") {
      assert(c.status === "ready", 409, "保存完了した動画だけを転送できます");
      assert(
        !(await isProtected(e, c.id)),
        409,
        "再生リストで使用中、または上映中の動画です。公開停止し、下書きからも除外した後に転送してください",
      );
      await e.DB.prepare("UPDATE clips SET archive_at=?,retry_at=0 WHERE id=?")
        .bind(now(), c.id)
        .run();
      ctx.waitUntil(processClip(e, c.id));
      await audit(e, s.name, "archive:request:" + c.id);
      return json({ ok: true }, 202);
    }
    if (method === "POST" && m[2] === "restore") {
      assert(
        c.status === "archived",
        409,
        "アーカイブ済み動画だけ復元できます",
      );
      await capacity(e, c.bytes);
      const changed = await e.DB.prepare(
        "UPDATE clips SET status='restoring',retry_at=0,attempts=0,error=NULL WHERE id=? AND status='archived' RETURNING id",
      )
        .bind(c.id)
        .first();
      assert(changed, 409, "復元はすでに開始されています");
      ctx.waitUntil(processClip(e, c.id));
      await audit(e, s.name, "restore:" + c.id);
      return json({ ok: true }, 202);
    }
    if (method === "DELETE") {
      assert(
        ![
          "archiving",
          "restoring",
          "downloading",
          "storing",
          "generating",
        ].includes(c.status),
        409,
        "処理が完了してから削除してください",
      );
      assert(
        !(await isProtected(e, c.id)),
        409,
        "公開中・上映中の動画は削除できません",
      );
      const used = await all<Playlist>(e, "SELECT * FROM playlists");
      assert(
        !used.some((p) =>
          (JSON.parse(p.draft) as Draft).items.some((i) => i.clipId === c.id),
        ),
        409,
        "再生リストからこの動画を外してから削除してください",
      );
      const lock = await e.DB.prepare(
        "UPDATE clips SET status='deleting',lease_until=? WHERE id=? AND lease_until<? AND NOT EXISTS(SELECT 1 FROM draft_clip_refs WHERE clip_id=?) AND NOT EXISTS(SELECT 1 FROM publication_clips WHERE clip_id=?) AND NOT EXISTS(SELECT 1 FROM playback_clip_leases WHERE clip_id=? AND expires>?) RETURNING id",
      )
        .bind(now() + 90000, c.id, now(), c.id, c.id, c.id, now())
        .first();
      assert(lock, 409, "別の操作が進行しています");
      if (c.r2_key) await e.MEDIA.delete(c.r2_key);
      await e.DB.batch([
        e.DB.prepare("DELETE FROM transfers WHERE clip_id=?").bind(c.id),
        e.DB.prepare("DELETE FROM clips WHERE id=?").bind(c.id),
      ]);
      await audit(e, s.name, "clip:delete:" + c.id);
      return json({ ok: true });
    }
  }
  if (path === "/api/settings/retention" && method === "POST") {
    await admin(req, e, s);
    const input = await body(
      req,
      z.object({ days: daysSchema, applyExisting: z.boolean() }),
    );
    const statements = [
      e.DB.prepare("UPDATE config SET value=? WHERE key='retention_days'").bind(
        String(input.days),
      ),
    ];
    if (input.applyExisting)
      statements.push(
        e.DB.prepare(
          "UPDATE clips SET archive_at=created+?*86400000,retention_days=NULL,updated=? WHERE status NOT IN ('archived','archiving','restoring')",
        ).bind(input.days, now()),
      );
    await e.DB.batch(statements);
    await audit(e, s.name, "retention:" + input.days);
    return json({ ok: true });
  }
  if (path === "/api/settings/storage" && method === "POST") {
    await admin(req, e, s);
    const input = await body(
      req,
      z.object({
        limitBytes: z
          .number()
          .int()
          .min(1024 ** 3)
          .max(9 * 1024 ** 3),
      }),
    );
    await setConfig(e, "r2_limit_bytes", String(input.limitBytes));
    await audit(e, s.name, "storage:limit");
    return json({ ok: true });
  }
  if (path === "/api/security" && method === "POST") {
    await admin(req, e, s);
    const input = await body(
      req,
      z.object({
        password: z.string().min(12).max(256).optional(),
        pin: z
          .string()
          .regex(/^\d{6,12}$/)
          .optional(),
        revoke: z.boolean().default(false),
      }),
    );
    if (input.password)
      await setConfig(
        e,
        "staff_password_hash",
        await secretDigest(e, input.password),
      );
    if (input.pin)
      await setConfig(e, "admin_pin_hash", await secretDigest(e, input.pin));
    if (input.password || input.revoke) {
      await e.DB.batch([
        e.DB.prepare(
          "UPDATE config SET value=CAST(value AS INTEGER)+1 WHERE key='credential_epoch'",
        ),
        e.DB.prepare("DELETE FROM sessions"),
      ]);
    }
    await audit(e, s.name, "security:update");
    return json({ ok: true });
  }
  if (path === "/api/player-token" && method === "POST") {
    await admin(req, e, s);
    const input = await body(
      req,
      z.object({ revoke: z.boolean().default(false) }),
    );
    if (input.revoke)
      await e.DB.batch([
        e.DB.prepare(
          "UPDATE config SET value=CAST(value AS INTEGER)+1 WHERE key='player_epoch'",
        ),
        e.DB.prepare("DELETE FROM playback_leases"),
        e.DB.prepare("DELETE FROM playback_clip_leases"),
        e.DB.prepare("DELETE FROM playback_frame_leases"),
      ]);
    const token = await issuePlayer(e);
    await audit(e, s.name, "player:token");
    return json({
      url:
        e.APP_ORIGIN + "/highlight/player?token=" + encodeURIComponent(token),
    });
  }
  m = /^\/api\/oauth\/(twitch|google)\/(start|callback|disconnect)$/.exec(path);
  if (m) {
    if (m[2] === "callback" && method === "GET")
      return oauthCallback(req, e, s, m[1]);
    if (method === "POST") {
      await admin(req, e, s);
      if (m[2] === "start") return json({ url: await oauthStart(e, s, m[1]) });
      if (m[2] === "disconnect") {
        await e.DB.prepare("DELETE FROM connections WHERE provider=?")
          .bind(m[1])
          .run();
        await audit(e, s.name, "disconnect:" + m[1]);
        return json({ ok: true });
      }
    }
  }
  if (path === "/api/frames" && method === "POST") {
    await admin(req, e, s);
    assert(
      req.headers.get("content-type") === "image/png",
      400,
      "PNGファイルを選択してください",
    );
    const size = Number(req.headers.get("content-length"));
    assert(
      size > 0 && size <= 5 * 1024 * 1024,
      413,
      "PNGは5MB以内にしてください",
    );
    const data = new Uint8Array(await req.arrayBuffer());
    assert(
      data.length === size && data.length >= 33,
      400,
      "PNGデータが不正です",
    );
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    assert(
      signature.every((v, i) => data[i] === v) &&
        new TextDecoder().decode(data.slice(12, 16)) === "IHDR",
      400,
      "PNG形式が不正です",
    );
    const view = new DataView(data.buffer);
    const width = view.getUint32(16),
      height = view.getUint32(20);
    assert(
      width > 0 && height > 0 && width <= 4096 && height <= 4096,
      400,
      "画像は4096px以内にしてください",
    );
    let offset = 8,
      ended = false,
      idat = false;
    while (offset + 12 <= data.length) {
      const len = view.getUint32(offset);
      assert(offset + 12 + len <= data.length, 400, "PNGの構造が不正です");
      const type = new TextDecoder().decode(data.slice(offset + 4, offset + 8));
      if (type === "IDAT") idat = true;
      if (type === "IEND") {
        ended = true;
        assert(offset + 12 === data.length, 400, "PNGに余分なデータがあります");
        break;
      }
      offset += 12 + len;
    }
    assert(ended && idat, 400, "PNGの画像データがありません");
    await capacity(e, size);
    const id = uid(),
      key = "frames/" + id + ".png";
    await e.MEDIA.put(key, data, {
      httpMetadata: { contentType: "image/png" },
    });
    const name = decodeURIComponent(
      req.headers.get("x-file-name") || "frame.png",
    ).slice(0, 160);
    await e.DB.prepare(
      "INSERT INTO frames(id,name,r2_key,width,height,bytes,created) VALUES (?,?,?,?,?,?,?)",
    )
      .bind(id, name, key, width, height, size, now())
      .run();
    await audit(e, s.name, "frame:upload");
    return json({ id, width, height }, 201);
  }
  m = /^\/api\/frames\/([^/]+)$/.exec(path);
  if (m && method === "DELETE") {
    await admin(req, e, s);
    const id = uuid.parse(m[1]);
    const playlists = await all<Playlist>(e, "SELECT * FROM playlists");
    assert(
      !playlists.some((p) =>
        (JSON.parse(p.draft) as Draft).items.some((i) => i.frameId === id),
      ),
      409,
      "再生リストで使用中のフレームです",
    );
    const pub = await e.DB.prepare("SELECT snapshot FROM publication").first<{
      snapshot: string;
    }>();
    assert(
      !pub ||
        !(JSON.parse(pub.snapshot).draft as Draft).items.some(
          (i) => i.frameId === id,
        ),
      409,
      "公開中のフレームです",
    );
    assert(
      !(await e.DB.prepare(
        "SELECT id FROM playback_leases WHERE expires>? LIMIT 1",
      )
        .bind(now())
        .first()),
      409,
      "OBSが再生中です。停止後に削除してください",
    );
    const f = await e.DB.prepare("SELECT r2_key FROM frames WHERE id=?")
      .bind(id)
      .first<{ r2_key: string }>();
    assert(f, 404, "フレームがありません");
    const locked = await e.DB.prepare(
      "UPDATE frames SET deleting=1 WHERE id=? AND NOT EXISTS(SELECT 1 FROM draft_frame_refs WHERE frame_id=?) AND NOT EXISTS(SELECT 1 FROM publication_frames WHERE frame_id=?) AND NOT EXISTS(SELECT 1 FROM playback_frame_leases WHERE frame_id=? AND expires>?) RETURNING id",
    )
      .bind(id, id, id, id, now())
      .first();
    assert(locked, 409, "使用中のフレームは削除できません");
    await e.MEDIA.delete(f.r2_key);
    await e.DB.prepare("DELETE FROM frames WHERE id=?").bind(id).run();
    await audit(e, s.name, "frame:delete");
    return json({ ok: true });
  }
  throw new AppError(404, "操作が見つかりません");
}
async function serveMedia(req: Request, e: Env) {
  assert(["GET", "HEAD"].includes(req.method), 405, "読み取り専用です");
  const u = new URL(req.url);
  const m = /^\/media\/(clip|frame)\/([^/]+)$/.exec(u.pathname);
  assert(m, 404, "素材がありません");
  const id = uuid.parse(m[2]);
  let player = false;
  try {
    await session(req, e);
  } catch {
    await playerAuth(req, e);
    player = true;
  }
  if (player) {
    const p = await e.DB.prepare("SELECT snapshot FROM publication").first<{
      snapshot: string;
    }>();
    let allowed =
      p &&
      (JSON.parse(p.snapshot).draft as Draft).items.some((i) =>
        m[1] === "clip" ? i.clipId === id : i.frameId === id,
      );
    if (!allowed && m[1] === "clip")
      allowed = !!(await e.DB.prepare(
        "SELECT clip_id FROM playback_clip_leases WHERE clip_id=? AND expires>? LIMIT 1",
      )
        .bind(id, now())
        .first());
    if (!allowed && m[1] === "frame")
      allowed = !!(await e.DB.prepare(
        "SELECT frame_id FROM playback_frame_leases WHERE frame_id=? AND expires>? LIMIT 1",
      )
        .bind(id, now())
        .first());
    assert(allowed, 403, "公開された素材のみ再生できます");
  }
  const row = await e.DB.prepare(
    m[1] === "clip"
      ? "SELECT r2_key FROM clips WHERE id=? AND r2_key IS NOT NULL"
      : "SELECT r2_key FROM frames WHERE id=?",
  )
    .bind(id)
    .first<{ r2_key: string }>();
  assert(row, 404, "素材はアーカイブ済みか削除されています");
  const meta = await e.MEDIA.head(row.r2_key);
  assert(meta, 404, "素材が見つかりません");
  let range;
  try {
    range = byteRange(req.headers.get("range"), meta.size);
  } catch {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${meta.size}` },
    });
  }
  const headers = new Headers({
    "Content-Type": m[1] === "clip" ? "video/mp4" : "image/png",
    "Accept-Ranges": "bytes",
    "Content-Length": String(range?.length || meta.size),
    ETag: meta.httpEtag,
    "Cache-Control": "private, no-store",
  });
  if (range)
    headers.set(
      "Content-Range",
      `bytes ${range.offset}-${range.offset + range.length - 1}/${meta.size}`,
    );
  if (req.method === "HEAD")
    return new Response(null, { status: range ? 206 : 200, headers });
  const data = await e.MEDIA.get(row.r2_key, range ? { range } : undefined);
  assert(data, 404, "素材が見つかりません");
  return new Response(data.body, { status: range ? 206 : 200, headers });
}
export default {
  async fetch(req: Request, e: Env, ctx: ExecutionContext) {
    let res: Response;
    try {
      res = await route(req, e, ctx);
    } catch (error) {
      if (
        !["GET", "HEAD"].includes(req.method) &&
        new URL(req.url).pathname !== "/api/login"
      ) {
        try {
          const actor = await session(req, e);
          await audit(
            e,
            actor.name,
            req.method + ":" + new URL(req.url).pathname,
            "failed",
          );
        } catch {}
      }
      res = json(
        {
          error:
            error instanceof AppError
              ? error.message
              : error instanceof ZodError
                ? "入力内容を確認してください"
                : "処理に失敗しました。再試行し、続く場合は接続設定を確認してください",
        },
        error instanceof AppError
          ? error.status
          : error instanceof ZodError
            ? 400
            : 500,
      );
    }
    const headers = new Headers(res.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("X-Frame-Options", "DENY");
    headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://*.twitch.tv https://*.twitchcdn.net data:; media-src 'self' blob:; connect-src 'self'; frame-src https://player.twitch.tv; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
    if (e.APP_ORIGIN?.startsWith("https:"))
      headers.set("Strict-Transport-Security", "max-age=31536000");
    return new Response(res.body, { status: res.status, headers });
  },
  async scheduled(event: ScheduledEvent, e: Env, ctx: ExecutionContext) {
    ctx.waitUntil(event.cron === "17 * * * *" ? cleanup(e) : tick(e));
  },
};
