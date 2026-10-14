import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import {
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import worker from "../worker/index";
import type { Env } from "../worker/types";
import { archiveDate, byteRange, daysSchema } from "../worker/core";
import {
  secretDigest,
  encrypt,
  decrypt,
  issuePlayer,
} from "../worker/security";
import { saveConnection } from "../worker/connections";
import { processClip, claim } from "../worker/jobs";
const replies = new Map<
  string,
  {
    status: number;
    body: string | Uint8Array;
    headers?: Record<string, string>;
  }
>();
const fetchMock = {
  get: (origin: string) => ({
    intercept: ({ path }: { path: string }) => ({
      reply: (
        status: number,
        body: string | Uint8Array,
        headers?: Record<string, string>,
      ) => {
        replies.set(origin + path, { status, body, headers });
      },
    }),
  }),
};
const e = env as unknown as Env & { TEST_SCHEMA: string };
let cookie = "",
  csrf = "";
async function request(
  path: string,
  method = "GET",
  data?: unknown,
  extra: Record<string, string> = {},
) {
  const ctx = createExecutionContext();
  const r = await worker.fetch(
    new Request("https://studio.test" + path, {
      method,
      headers: {
        Cookie: cookie,
        Origin: "https://studio.test",
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
        ...extra,
      },
      body: data ? JSON.stringify(data) : undefined,
    }),
    e,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return r;
}
async function clip(status = "ready", size = 8) {
  const id = crypto.randomUUID();
  await e.DB.prepare(
    "INSERT INTO clips(id,request_key,title,created,updated,status,duration,r2_key,bytes,archive_at,twitch_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
  )
    .bind(
      id,
      crypto.randomUUID(),
      "テストプレー",
      Date.now() - 86400000,
      Date.now(),
      status,
      60,
      status === "archived" ? null : "clips/" + id + ".mp4",
      size,
      Date.now() - 1,
      "clip-twitch",
    )
    .run();
  if (status !== "archived")
    await e.MEDIA.put("clips/" + id + ".mp4", new Uint8Array(size).fill(1));
  return id;
}
async function playlist(id: string) {
  const r = await request("/api/playlists", "POST", {
    title: "決勝ハイライト",
    draft: {
      items: [
        {
          id: crypto.randomUUID(),
          clipId: id,
          start: 10,
          end: 40,
          frameId: null,
        },
      ],
      loop: false,
      endBehavior: "black",
    },
  });
  expect(r.status).toBe(201);
  return ((await r.json()) as { id: string }).id;
}
async function googleConnection() {
  await saveConnection(e, "google", {
    access_token: "test",
    refresh_token: "test",
    expires_at: Date.now() + 3600000,
    folder_id: "folder",
  });
}
beforeAll(async () => {
  await applyD1Migrations(e.DB, JSON.parse(e.TEST_SCHEMA));
});
beforeEach(async () => {
  await e.DB.batch(
    [
      "publication_clips",
      "publication_frames",
      "publication",
      "playback_clip_leases",
      "playback_frame_leases",
      "playback_leases",
      "transfers",
      "draft_clip_refs",
      "draft_frame_refs",
      "frames",
      "playlists",
      "clips",
      "sessions",
      "rate_limits",
      "connections",
      "oauth_states",
      "audit",
    ].map((t) => e.DB.prepare("DELETE FROM " + t)),
  );
  await e.DB.prepare(
    "UPDATE config SET value='1' WHERE key IN ('credential_epoch','player_epoch')",
  ).run();
  await e.DB.prepare(
    "INSERT INTO config(key,value) VALUES ('staff_password_hash',?),('admin_pin_hash',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  )
    .bind(
      await secretDigest(e, "test-password-123"),
      await secretDigest(e, "654321"),
    )
    .run();
  cookie = "";
  csrf = "";
  const r = await request("/api/login", "POST", {
    password: "test-password-123",
    name: "テストスタッフ",
  });
  expect(r.status).toBe(200);
  cookie = r.headers.get("set-cookie")!.split(";")[0];
  csrf = ((await r.json()) as { csrf: string }).csrf;
  replies.clear();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const response = replies.get(url);
    if (!response) throw Error("Unmocked HTTP: " + url);
    return new Response(response.body, {
      status: response.status,
      headers: { "Content-Type": "application/json", ...response.headers },
    });
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});
describe("認証・アクセス保護", () => {
  it("HttpOnly Secure SameSite Cookieと12時間セッション", async () => {
    const r = await request("/api/login", "POST", {
      password: "test-password-123",
      name: "スタッフ",
    });
    const c = r.headers.get("set-cookie")!;
    expect(c).toContain("HttpOnly");
    expect(c).toContain("Secure");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Max-Age=43200");
    expect((await request("/api/session")).status).toBe(200);
  });
  it("CSRF・異なるOriginを拒否", async () => {
    expect(
      (
        await request(
          "/api/playlists",
          "POST",
          { title: "test" },
          { "X-CSRF-Token": "" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          "/api/playlists",
          "POST",
          { title: "test" },
          { Origin: "https://evil.test" },
        )
      ).status,
    ).toBe(403);
  });
  it("誤ったPINを拒否し正しいPINで6種の期限を変更", async () => {
    expect(
      (
        await request(
          "/api/settings/retention",
          "POST",
          { days: 14, applyExisting: false },
          { "X-Admin-Pin": "000000" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          "/api/settings/retention",
          "POST",
          { days: 14, applyExisting: false },
          { "X-Admin-Pin": "654321" },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          "/api/settings/retention",
          "POST",
          { days: 2, applyExisting: false },
          { "X-Admin-Pin": "654321" },
        )
      ).status,
    ).toBe(400);
  });
  it("ログイン試行制限", async () => {
    for (let i = 0; i < 8; i++)
      await request("/api/login", "POST", { password: "bad" });
    expect(
      (await request("/api/login", "POST", { password: "bad" })).status,
    ).toBe(429);
  });
  it("セッションの一括失効", async () => {
    expect(
      (
        await request(
          "/api/security",
          "POST",
          { revoke: true },
          { "X-Admin-Pin": "654321" },
        )
      ).status,
    ).toBe(200);
    expect((await request("/api/session")).status).toBe(401);
  });
  it("更新トークンは暗号化され改ざんを検知", async () => {
    const s = await encrypt(e, { refresh_token: "secret" });
    expect(s).not.toContain("secret");
    expect(await decrypt(e, s)).toEqual({ refresh_token: "secret" });
    await expect(decrypt(e, s.slice(0, -4) + "AAAA")).rejects.toThrow();
  });
  it("再生トークンは管理操作に使えず失効可能", async () => {
    const token = await issuePlayer(e);
    cookie = "";
    expect((await request("/api/state?token=" + token)).status).toBe(401);
    const lease = crypto.randomUUID();
    expect(
      (await request("/api/player/manifest?token=" + token + "&lease=" + lease))
        .status,
    ).toBe(200);
    await e.DB.prepare(
      "UPDATE config SET value='2' WHERE key='player_epoch'",
    ).run();
    expect(
      (await request("/api/player/manifest?token=" + token + "&lease=" + lease))
        .status,
    ).toBe(401);
  });
});
describe("編集・公開・上映保護", () => {
  it("0.1秒の範囲保存と更新競合", async () => {
    const id = await clip();
    const p = await playlist(id);
    const data = (await (await request("/api/playlists/" + p)).json()) as any;
    const draft = JSON.parse(data.draft);
    draft.items[0].start = 10.1;
    const update = { title: "edited", version: 1, draft };
    expect((await request("/api/playlists/" + p, "PUT", update)).status).toBe(
      200,
    );
    expect((await request("/api/playlists/" + p, "PUT", update)).status).toBe(
      409,
    );
  });
  it("範囲外・逆転したトリミングを拒否", async () => {
    const id = await clip();
    const p = await playlist(id);
    const data = (await (await request("/api/playlists/" + p)).json()) as any;
    const draft = JSON.parse(data.draft);
    draft.items[0].end = 80;
    expect(
      (
        await request("/api/playlists/" + p, "PUT", {
          title: "x",
          version: 1,
          draft,
        })
      ).status,
    ).toBe(400);
  });
  it("公開スナップショットは下書き変更で変わらない", async () => {
    const id = await clip();
    const p = await playlist(id);
    expect(
      (
        await request("/api/playlists/" + p + "/publish", "POST", {
          version: 1,
        })
      ).status,
    ).toBe(200);
    const data = (await (await request("/api/playlists/" + p)).json()) as any;
    const draft = JSON.parse(data.draft);
    draft.items[0].end = 45;
    await request("/api/playlists/" + p, "PUT", {
      title: "modified",
      version: 1,
      draft,
    });
    const pub = await e.DB.prepare("SELECT snapshot FROM publication").first<{
      snapshot: string;
    }>();
    expect(JSON.parse(pub!.snapshot).draft.items[0].end).toBe(40);
  });
  it("公開中の動画はアーカイブ・削除を拒否", async () => {
    const id = await clip();
    const p = await playlist(id);
    await request("/api/playlists/" + p + "/publish", "POST", { version: 1 });
    expect(
      (await request("/api/clips/" + id + "/archive", "POST", {})).status,
    ).toBe(409);
    expect((await request("/api/clips/" + id, "DELETE")).status).toBe(409);
    await processClip(e, id);
    expect(await e.MEDIA.head("clips/" + id + ".mp4")).not.toBeNull();
  });
  it("公開停止後も再生中の素材を保護", async () => {
    const id = await clip();
    const p = await playlist(id);
    await request("/api/playlists/" + p + "/publish", "POST", { version: 1 });
    const token = await issuePlayer(e);
    await request(
      "/api/player/manifest?token=" + token + "&lease=" + crypto.randomUUID(),
    );
    await request("/api/playlists/" + p + "/unpublish", "POST", {});
    expect(
      (await request("/api/clips/" + id + "/archive", "POST", {})).status,
    ).toBe(409);
  });
  it("二重処理のロックと期限切れ回復", async () => {
    const id = await clip();
    expect(await claim(e, id)).not.toBeNull();
    expect(await claim(e, id)).toBeNull();
    await e.DB.prepare("UPDATE clips SET lease_until=0 WHERE id=?")
      .bind(id)
      .run();
    expect(await claim(e, id)).not.toBeNull();
  });
  it("動画を再生範囲指定で配信", async () => {
    const id = await clip();
    const r = await request("/media/clip/" + id, "GET", undefined, {
      Range: "bytes=2-4",
    });
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe("bytes 2-4/8");
    expect((await r.arrayBuffer()).byteLength).toBe(3);
    expect(
      (
        await request("/media/clip/" + id, "GET", undefined, {
          Range: "bytes=999-",
        })
      ).status,
    ).toBe(416);
  });
});
describe("Driveアーカイブの保存確認", () => {
  it("Driveの容量不一致ならR2を保持", async () => {
    const id = await clip();
    await googleConnection();
    await e.DB.prepare(
      "INSERT INTO transfers(id,clip_id,status,drive_id,bytes,updated) VALUES (?,?,'uploading','drive-file',8,?)",
    )
      .bind(crypto.randomUUID(), id, Date.now())
      .run();
    fetchMock
      .get("https://www.googleapis.com")
      .intercept({
        path: "/drive/v3/files/drive-file?fields=id,size,md5Checksum,trashed",
      })
      .reply(
        200,
        JSON.stringify({ id: "drive-file", size: "7", trashed: false }),
      );
    await processClip(e, id);
    expect(await e.MEDIA.head("clips/" + id + ".mp4")).not.toBeNull();
    expect(
      (
        await e.DB.prepare("SELECT error FROM clips WHERE id=?")
          .bind(id)
          .first<any>()
      ).error,
    ).toContain("一致しません");
  });
  it("Driveを検証してからR2を削除", async () => {
    const id = await clip();
    await googleConnection();
    await e.DB.prepare(
      "INSERT INTO transfers(id,clip_id,status,drive_id,bytes,updated) VALUES (?,?,'uploading','drive-file',8,?)",
    )
      .bind(crypto.randomUUID(), id, Date.now())
      .run();
    fetchMock
      .get("https://www.googleapis.com")
      .intercept({
        path: "/drive/v3/files/drive-file?fields=id,size,md5Checksum,trashed",
      })
      .reply(
        200,
        JSON.stringify({ id: "drive-file", size: "8", trashed: false }),
      );
    await processClip(e, id);
    expect(await e.MEDIA.head("clips/" + id + ".mp4")).toBeNull();
    const row = await e.DB.prepare(
      "SELECT status,drive_id,r2_key FROM clips WHERE id=?",
    )
      .bind(id)
      .first<any>();
    expect(row).toMatchObject({
      status: "archived",
      drive_id: "drive-file",
      r2_key: null,
    });
  });
  it("Drive通信失敗でもR2を保持", async () => {
    const id = await clip();
    await googleConnection();
    fetchMock
      .get("https://www.googleapis.com")
      .intercept({
        path: "/drive/v3/files/generateIds?count=1&space=drive&type=files",
      })
      .reply(503, "unavailable");
    await processClip(e, id);
    expect(await e.MEDIA.head("clips/" + id + ".mp4")).not.toBeNull();
  });
});
describe("境界条件", () => {
  it.each([1, 3, 7, 14, 21, 30])("%d日の起算点は作成日時", (d) => {
    expect(daysSchema.parse(d)).toBe(d);
    expect(archiveDate(0, d)).toBe(d * 86400000);
  });
  it("サフィックス・オープン範囲・不正範囲", () => {
    expect(byteRange("bytes=-3", 10)).toEqual({ offset: 7, length: 3 });
    expect(byteRange("bytes=5-", 10)).toEqual({ offset: 5, length: 5 });
    expect(() => byteRange("bytes=6-3", 10)).toThrow();
    expect(() => byteRange("bytes=0-1,2-3", 10)).toThrow();
  });
});

describe("Twitchの公式API取り込み", () => {
  it("60秒を要求し、公式URLからR2保存して実際の長さを反映", async () => {
    const id = await clip("requested");
    await e.DB.prepare(
      "UPDATE clips SET twitch_id=NULL,r2_key=NULL,bytes=0 WHERE id=?",
    )
      .bind(id)
      .run();
    await saveConnection(e, "twitch", {
      access_token: "test",
      refresh_token: "test",
      expires_at: Date.now() + 3600000,
      validated_at: Date.now(),
      user_id: "broadcaster",
      login: "nobori_official",
    });
    fetchMock
      .get("https://api.twitch.tv")
      .intercept({
        path: "/helix/clips?broadcaster_id=broadcaster&duration=60",
      })
      .reply(202, JSON.stringify({ data: [{ id: "official-clip" }] }));
    await processClip(e, id);
    expect(
      await e.DB.prepare("SELECT status,twitch_id FROM clips WHERE id=?")
        .bind(id)
        .first<any>(),
    ).toMatchObject({ status: "generating", twitch_id: "official-clip" });
    await e.MEDIA.delete("clips/" + id + ".mp4");
    fetchMock
      .get("https://api.twitch.tv")
      .intercept({ path: "/helix/clips?id=official-clip" })
      .reply(
        200,
        JSON.stringify({
          data: [
            {
              duration: 58.3,
              thumbnail_url: "https://clips-media-assets.twitch.tv/image.jpg",
            },
          ],
        }),
      );
    fetchMock
      .get("https://api.twitch.tv")
      .intercept({
        path: "/helix/clips/downloads?broadcaster_id=broadcaster&editor_id=broadcaster&clip_id=official-clip",
      })
      .reply(
        200,
        JSON.stringify({
          data: [
            {
              landscape_download_url:
                "https://production.assets.clips.twitchcdn.net/video.mp4",
            },
          ],
        }),
      );
    fetchMock
      .get("https://production.assets.clips.twitchcdn.net")
      .intercept({ path: "/video.mp4" })
      .reply(200, new Uint8Array(8).fill(1), {
        "Content-Length": "8",
        "Content-Type": "video/mp4",
      });
    await processClip(e, id);
    const c = await e.DB.prepare(
      "SELECT status,duration,bytes,error FROM clips WHERE id=?",
    )
      .bind(id)
      .first<any>();
    expect(c).toMatchObject({
      status: "ready",
      duration: 58.3,
      bytes: 8,
      error: null,
    });
    expect((await e.MEDIA.head("clips/" + id + ".mp4"))?.size).toBe(8);
  });
  it("同じ保存要求IDは再作成しない", async () => {
    const id = await clip("requested");
    const key = (
      await e.DB.prepare("SELECT request_key FROM clips WHERE id=?")
        .bind(id)
        .first<any>()
    ).request_key;
    const r = await request("/api/clips", "POST", {
      requestKey: key,
      title: "retry",
      duration: 60,
    });
    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({ id });
  });
  it("作成応答が不明なら自動再作成せず警告", async () => {
    const id = await clip("requested");
    await e.DB.prepare(
      "UPDATE clips SET twitch_id=NULL,generation_started=? WHERE id=?",
    )
      .bind(Date.now(), id)
      .run();
    await processClip(e, id);
    const c = await e.DB.prepare("SELECT status,error FROM clips WHERE id=?")
      .bind(id)
      .first<any>();
    expect(c.status).toBe("error");
    expect(c.error).toContain("作成済みの可能性");
  });
});
describe("転送中断からの回復", () => {
  it("Driveの受信済み位置から転送を再開", async () => {
    const id = await clip();
    await googleConnection();
    const transfer = crypto.randomUUID();
    await e.DB.prepare(
      "INSERT INTO transfers(id,clip_id,status,drive_id,encrypted_url,bytes,updated) VALUES (?,?,'uploading','drive-file',?,8,?)",
    )
      .bind(
        transfer,
        id,
        await encrypt(e, "https://www.googleapis.com/upload/session"),
        Date.now(),
      )
      .run();
    fetchMock
      .get("https://www.googleapis.com")
      .intercept({
        path: "/drive/v3/files/drive-file?fields=id,size,md5Checksum,trashed",
      })
      .reply(404, "{}");
    let sentRange = "";
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/drive/v3/files/"))
        return new Response("{}", { status: 404 });
      if (init?.headers?.["Content-Range"] === "bytes */8")
        return new Response(null, {
          status: 308,
          headers: { Range: "bytes=0-3" },
        });
      sentRange = init?.headers?.["Content-Range"] || "";
      return new Response(JSON.stringify({ id: "drive-file" }), {
        status: 200,
      });
    });
    await processClip(e, id);
    expect(sentRange).toBe("bytes 4-7/8");
    expect(
      (
        await e.DB.prepare("SELECT offset FROM transfers WHERE id=?")
          .bind(transfer)
          .first<any>()
      ).offset,
    ).toBe(8);
    expect(await e.MEDIA.head("clips/" + id + ".mp4")).not.toBeNull();
  });
  it("R2削除後・DB完了前の中断を回復", async () => {
    const id = await clip("archiving");
    await googleConnection();
    await e.DB.prepare("UPDATE clips SET drive_id=? WHERE id=?")
      .bind("drive-file", id)
      .run();
    await e.DB.prepare(
      "INSERT INTO transfers(id,clip_id,status,drive_id,bytes,offset,updated) VALUES (?,?,'verified','drive-file',8,8,?)",
    )
      .bind(crypto.randomUUID(), id, Date.now())
      .run();
    await e.MEDIA.delete("clips/" + id + ".mp4");
    fetchMock
      .get("https://www.googleapis.com")
      .intercept({
        path: "/drive/v3/files/drive-file?fields=id,size,md5Checksum,trashed",
      })
      .reply(
        200,
        JSON.stringify({ id: "drive-file", size: "8", trashed: false }),
      );
    await processClip(e, id);
    expect(
      await e.DB.prepare("SELECT status,r2_key FROM clips WHERE id=?")
        .bind(id)
        .first<any>(),
    ).toMatchObject({ status: "archived", r2_key: null });
  });
  it("下書きに含む素材もアーカイブを保留", async () => {
    const id = await clip();
    await playlist(id);
    await processClip(e, id);
    expect(
      (
        await e.DB.prepare("SELECT status FROM clips WHERE id=?")
          .bind(id)
          .first<any>()
      ).status,
    ).toBe("ready");
    expect(await e.MEDIA.head("clips/" + id + ".mp4")).not.toBeNull();
  });
});

describe("一覧と保管期限", () => {
  it("検索・並び順とページ情報を返す", async () => {
    const id = await clip();
    const r = await request(
      "/api/clips?search=" +
        encodeURIComponent("テスト") +
        "&filter=pending&page=1",
    );
    expect(r.status).toBe(200);
    const data = (await r.json()) as any;
    expect(data.total).toBe(1);
    expect(data.clips[0].id).toBe(id);
    expect(
      ((await (await request("/api/clips?search=absent")).json()) as any).total,
    ).toBe(0);
  });
  it("検索記号をSQLワイルドカードとして解釈しない", async () => {
    await clip();
    const r = await request("/api/clips?search=" + encodeURIComponent("%"));
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).total).toBe(0);
  });
  it("全体変更の既存適用は作成日時から期限を再計算", async () => {
    const id = await clip();
    await request(
      "/api/settings/retention",
      "POST",
      { days: 3, applyExisting: true },
      { "X-Admin-Pin": "654321" },
    );
    const c = await e.DB.prepare(
      "SELECT created,archive_at FROM clips WHERE id=?",
    )
      .bind(id)
      .first<any>();
    expect(c.archive_at - c.created).toBe(3 * 86400000);
  });
  it("未登録PNGでもOBS用の公開データを取得できる", async () => {
    const id = await clip();
    const p = await playlist(id);
    await request("/api/playlists/" + p + "/publish", "POST", { version: 1 });
    const token = await issuePlayer(e);
    const r = await request(
      "/api/player/manifest?token=" + token + "&lease=" + crypto.randomUUID(),
    );
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).draft.items[0].frameId).toBeNull();
  });
});

describe("PNG・OAuth・復元", () => {
  async function upload(bytes: Uint8Array) {
    const ctx = createExecutionContext();
    const r = await worker.fetch(
      new Request("https://studio.test/api/frames", {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: "https://studio.test",
          "X-CSRF-Token": csrf,
          "X-Admin-Pin": "654321",
          "Content-Type": "image/png",
          "Content-Length": String(bytes.length),
          "X-File-Name": "validation-fixture.png",
        },
        body: bytes,
      }),
      e,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return r;
  }
  it("PNGを登録し、編集中・公開中の参照がある間は削除を拒否", async () => {
    // Internal 1px validation fixture; no production frame artwork is generated.
    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jc1sAAAAASUVORK5CYII=",
      ),
      (c) => c.charCodeAt(0),
    );
    const r = await upload(png);
    expect(r.status).toBe(201);
    const f = (await r.json()) as any;
    expect(f).toMatchObject({ width: 1, height: 1 });
    const id = await clip();
    const p = await playlist(id);
    const source = (await (await request("/api/playlists/" + p)).json()) as any;
    const draft = JSON.parse(source.draft);
    draft.items[0].frameId = f.id;
    expect(
      (
        await request("/api/playlists/" + p, "PUT", {
          version: 1,
          title: source.title,
          draft,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request("/api/frames/" + f.id, "DELETE", undefined, {
          "X-Admin-Pin": "654321",
        })
      ).status,
    ).toBe(409);
    await request("/api/playlists/" + p + "/publish", "POST", { version: 2 });
    const token = await issuePlayer(e);
    const lease = crypto.randomUUID();
    await request("/api/player/manifest?token=" + token + "&lease=" + lease);
    await request("/api/playlists/" + p + "/unpublish", "POST", {});
    cookie = "";
    expect(
      (await request("/media/frame/" + f.id + "?token=" + token)).status,
    ).toBe(200);
  });
  it("PNG以外のデータを拒否", async () => {
    expect(
      (await upload(new TextEncoder().encode("<script>not-a-png</script>")))
        .status,
    ).toBe(400);
  });
  it("Twitch接続は最小限の権限・stateを使い不正なcallbackを拒否", async () => {
    const r = await request(
      "/api/oauth/twitch/start",
      "POST",
      {},
      { "X-Admin-Pin": "654321" },
    );
    expect(r.status).toBe(200);
    const data = (await r.json()) as any;
    const url = new URL(data.url);
    expect(url.searchParams.get("scope")).toBe(
      "clips:edit channel:manage:clips",
    );
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(
      (await request("/api/oauth/twitch/callback?code=not-real&state=invalid"))
        .status,
    ).toBe(403);
  });
  it("Driveから復元し、Drive原本を維持して24時間の期限を設定", async () => {
    const id = await clip("archived");
    await googleConnection();
    await e.DB.prepare(
      "UPDATE clips SET drive_id='drive-file',status='restoring' WHERE id=?",
    )
      .bind(id)
      .run();
    fetchMock
      .get("https://www.googleapis.com")
      .intercept({ path: "/drive/v3/files/drive-file?fields=id,size,trashed" })
      .reply(
        200,
        JSON.stringify({ id: "drive-file", size: "8", trashed: false }),
      );
    fetchMock
      .get("https://www.googleapis.com")
      .intercept({ path: "/drive/v3/files/drive-file?alt=media" })
      .reply(200, new Uint8Array(8), { "Content-Length": "8" });
    await processClip(e, id);
    const c = await e.DB.prepare(
      "SELECT status,drive_id,archive_at FROM clips WHERE id=?",
    )
      .bind(id)
      .first<any>();
    expect(c.status).toBe("ready");
    expect(c.drive_id).toBe("drive-file");
    expect(Math.abs(c.archive_at - Date.now() - 86400000)).toBeLessThan(10000);
    expect((await e.MEDIA.head("clips/" + id + ".mp4"))?.size).toBe(8);
  });
});

describe("自動アーカイブの定期実行", () => {
  it("Cronが期限切れの未使用動画の転送を開始する", async () => {
    const id = await clip();
    await googleConnection();
    fetchMock
      .get("https://www.googleapis.com")
      .intercept({
        path: "/drive/v3/files/generateIds?count=1&space=drive&type=files",
      })
      .reply(200, JSON.stringify({ ids: ["new-drive-file"] }));
    const ctx = createExecutionContext();
    await worker.scheduled({ cron: "* * * * *" } as ScheduledEvent, e, ctx);
    await waitOnExecutionContext(ctx);
    expect(
      (
        await e.DB.prepare("SELECT status FROM clips WHERE id=?")
          .bind(id)
          .first<any>()
      ).status,
    ).toBe("archiving");
    expect(
      (
        await e.DB.prepare("SELECT drive_id FROM transfers WHERE clip_id=?")
          .bind(id)
          .first<any>()
      ).drive_id,
    ).toBe("new-drive-file");
    expect(await e.MEDIA.head("clips/" + id + ".mp4")).not.toBeNull();
  });
  it("定期清掃で期限切れ認証を削除し容量履歴を記録", async () => {
    await e.DB.prepare(
      "INSERT INTO sessions VALUES ('expired','csrf','old',0,1)",
    ).run();
    const ctx = createExecutionContext();
    await worker.scheduled({ cron: "17 * * * *" } as ScheduledEvent, e, ctx);
    await waitOnExecutionContext(ctx);
    expect(
      await e.DB.prepare("SELECT * FROM sessions WHERE id='expired'").first(),
    ).toBeNull();
    expect(
      await e.DB.prepare("SELECT * FROM storage_history LIMIT 1").first(),
    ).not.toBeNull();
  });
});
