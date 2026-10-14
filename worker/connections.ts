import { z } from "zod";
import type { Env, Session } from "./types";
import { assert, AppError, audit } from "./core";
import { encrypt, decrypt } from "./security";
export interface Connection {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user_id?: string;
  login?: string;
  folder_id?: string;
  validated_at?: number;
}
export async function saveConnection(
  e: Env,
  provider: string,
  data: Connection,
) {
  await e.DB.prepare(
    "INSERT INTO connections VALUES (?,?,?) ON CONFLICT(provider) DO UPDATE SET encrypted=excluded.encrypted, updated=excluded.updated",
  )
    .bind(provider, await encrypt(e, data), Date.now())
    .run();
}
export async function connection(
  e: Env,
  provider: string,
): Promise<Connection> {
  const row = await e.DB.prepare(
    "SELECT encrypted FROM connections WHERE provider=?",
  )
    .bind(provider)
    .first<{ encrypted: string }>();
  assert(
    row,
    409,
    `${provider === "twitch" ? "Twitch" : "Google Drive"}が未接続です`,
  );
  let data = await decrypt<Connection>(e, row.encrypted);
  if (data.expires_at < Date.now() + 120000) {
    const form = new URLSearchParams({
      client_id:
        provider === "twitch" ? e.TWITCH_CLIENT_ID : e.GOOGLE_CLIENT_ID,
      client_secret:
        provider === "twitch" ? e.TWITCH_CLIENT_SECRET : e.GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: data.refresh_token,
    });
    const res = await fetch(
      provider === "twitch"
        ? "https://id.twitch.tv/oauth2/token"
        : "https://oauth2.googleapis.com/token",
      { method: "POST", body: form },
    );
    assert(
      res.ok,
      409,
      "接続の認可が失効しています。管理画面から再接続してください",
    );
    const fresh = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };
    data = {
      ...data,
      ...fresh,
      refresh_token: fresh.refresh_token || data.refresh_token,
      expires_at: Date.now() + fresh.expires_in * 1000,
    };
    await saveConnection(e, provider, data);
  }
  if (
    provider === "twitch" &&
    Date.now() - (data.validated_at || 0) > 3600000
  ) {
    const r = await fetch("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: "OAuth " + data.access_token },
    });
    assert(r.ok, 409, "Twitch認可が失効しました。再接続してください");
    data.validated_at = Date.now();
    await saveConnection(e, provider, data);
  }
  return data;
}
export async function external(res: Response, service: string) {
  if (res.status === 429)
    throw new AppError(
      429,
      `${service}の利用制限です。時間をおいて再試行してください`,
    );
  if (res.status === 401 || res.status === 403)
    throw new AppError(
      409,
      `${service}の認可または権限を確認して再接続してください`,
    );
  assert(res.ok, 502, `${service}との通信に失敗しました (${res.status})`);
  return res;
}
export async function twitch(e: Env, path: string, method = "GET") {
  const c = await connection(e, "twitch");
  let r = await fetch("https://api.twitch.tv/helix/" + path, {
    method,
    headers: {
      Authorization: "Bearer " + c.access_token,
      "Client-Id": e.TWITCH_CLIENT_ID,
    },
  });
  if (r.status === 401) {
    c.expires_at = 0;
    await saveConnection(e, "twitch", c);
    const refreshed = await connection(e, "twitch");
    r = await fetch("https://api.twitch.tv/helix/" + path, {
      method,
      headers: {
        Authorization: "Bearer " + refreshed.access_token,
        "Client-Id": e.TWITCH_CLIENT_ID,
      },
    });
  }
  if (r.status === 404)
    throw new AppError(409, "配信がオフラインか、クリップが見つかりません");
  await external(r, "Twitch");
  return r.json() as Promise<{ data: Record<string, any>[] }>;
}
export async function google(e: Env, url: string, init: RequestInit = {}) {
  const c = await connection(e, "google");
  return await external(
    await fetch(url, {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init.headers).entries()),
        Authorization: "Bearer " + c.access_token,
      },
    }),
    "Google Drive",
  );
}
export async function oauthStart(e: Env, s: Session, provider: string) {
  assert(["twitch", "google"].includes(provider), 404, "接続先がありません");
  const client =
    provider === "twitch" ? e.TWITCH_CLIENT_ID : e.GOOGLE_CLIENT_ID;
  assert(client, 409, "初期設定手順に沿ってClient IDを設定してください");
  const state = crypto.randomUUID();
  await e.DB.prepare("INSERT INTO oauth_states VALUES (?,?,?,?)")
    .bind(state, provider, s.id, Date.now() + 600000)
    .run();
  const url = new URL(
    provider === "twitch"
      ? "https://id.twitch.tv/oauth2/authorize"
      : "https://accounts.google.com/o/oauth2/v2/auth",
  );
  url.search = new URLSearchParams({
    client_id: client,
    redirect_uri: e.APP_ORIGIN + "/api/oauth/" + provider + "/callback",
    response_type: "code",
    state,
    scope:
      provider === "twitch"
        ? "clips:edit channel:manage:clips"
        : "https://www.googleapis.com/auth/drive.file",
    ...(provider === "google"
      ? { access_type: "offline", prompt: "consent" }
      : { force_verify: "true" }),
  }).toString();
  return url.toString();
}
export async function oauthCallback(
  req: Request,
  e: Env,
  s: Session,
  provider: string,
) {
  const u = new URL(req.url);
  const state = await e.DB.prepare(
    "DELETE FROM oauth_states WHERE state=? AND provider=? AND session_id=? AND expires>? RETURNING state",
  )
    .bind(u.searchParams.get("state"), provider, s.id, Date.now())
    .first();
  assert(state, 403, "認証の有効期限が切れたか、開始したブラウザと違います");
  assert(!u.searchParams.has("error"), 400, "接続がキャンセルされました");
  const code = z.string().min(1).parse(u.searchParams.get("code"));
  const form = new URLSearchParams({
    client_id: provider === "twitch" ? e.TWITCH_CLIENT_ID : e.GOOGLE_CLIENT_ID,
    client_secret:
      provider === "twitch" ? e.TWITCH_CLIENT_SECRET : e.GOOGLE_CLIENT_SECRET,
    code,
    grant_type: "authorization_code",
    redirect_uri: e.APP_ORIGIN + "/api/oauth/" + provider + "/callback",
  });
  const res = await external(
    await fetch(
      provider === "twitch"
        ? "https://id.twitch.tv/oauth2/token"
        : "https://oauth2.googleapis.com/token",
      { method: "POST", body: form },
    ),
    provider,
  );
  const token = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  assert(
    token.refresh_token,
    409,
    "更新用の認可が取得できません。再接続してください",
  );
  const data: Connection = {
    ...token,
    expires_at: Date.now() + token.expires_in * 1000,
  };
  if (provider === "twitch") {
    const me = await external(
      await fetch("https://api.twitch.tv/helix/users", {
        headers: {
          Authorization: "Bearer " + token.access_token,
          "Client-Id": e.TWITCH_CLIENT_ID,
        },
      }),
      "Twitch",
    );
    const user = (
      (await me.json()) as { data: { id: string; login: string }[] }
    ).data[0];
    assert(
      user?.login === "nobori_official",
      403,
      "nobori_official アカウントで接続してください",
    );
    data.user_id = user.id;
    data.login = user.login;
  }
  if (provider === "google") {
    // Reuse this application's folder on reconnect; never modify pre-existing unrelated files.
    const existing = await e.DB.prepare(
      "SELECT encrypted FROM connections WHERE provider='google'",
    ).first<{ encrypted: string }>();
    if (existing)
      data.folder_id = (
        await decrypt<Connection>(e, existing.encrypted)
      ).folder_id;
  }
  await saveConnection(e, provider, data);
  await audit(e, s.name, "connect:" + provider);
  return Response.redirect(e.APP_ORIGIN + "/?connected=" + provider, 303);
}
export async function driveFolder(e: Env, c: Connection) {
  if (c.folder_id) {
    await google(
      e,
      `https://www.googleapis.com/drive/v3/files/${c.folder_id}?fields=id`,
    );
    return c.folder_id;
  }
  const r = await google(
    e,
    "https://www.googleapis.com/drive/v3/files?fields=id",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "NOBORI Highlight Studio",
        mimeType: "application/vnd.google-apps.folder",
        appProperties: { nobori: "archive-root" },
      }),
    },
  );
  c.folder_id = ((await r.json()) as { id: string }).id;
  await saveConnection(e, "google", c);
  return c.folder_id;
}
