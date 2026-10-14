import type { Env, Session } from "./types";
import { AppError, assert, getConfig } from "./core";
const enc = new TextEncoder();
const b64 = (a: Uint8Array) =>
  btoa(String.fromCharCode(...a))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
const unb64 = (s: string) =>
  Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
    c.charCodeAt(0),
  );
export async function hash(value: string) {
  return b64(
    new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value))),
  );
}
export async function secretDigest(e: Env, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(e.AUTH_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64(
    new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(value))),
  );
}
export function equal(a: string, b: string) {
  let n = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    n |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return n === 0;
}
export async function encrypt(e: Env, value: unknown) {
  const key = await crypto.subtle.importKey(
    "raw",
    unb64(e.TOKEN_ENCRYPTION_KEY),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(JSON.stringify(value)),
  );
  return b64(iv) + "." + b64(new Uint8Array(data));
}
export async function decrypt<T>(e: Env, value: string): Promise<T> {
  const [iv, data] = value.split(".");
  const key = await crypto.subtle.importKey(
    "raw",
    unb64(e.TOKEN_ENCRYPTION_KEY),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  return JSON.parse(
    new TextDecoder().decode(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: unb64(iv) },
        key,
        unb64(data),
      ),
    ),
  );
}
export async function limit(e: Env, key: string, max = 8) {
  const t = Date.now();
  const result = await e.DB.prepare(
    "INSERT INTO rate_limits(key,attempts,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN expires<? THEN 1 ELSE attempts+1 END, expires=CASE WHEN expires<? THEN excluded.expires ELSE expires END RETURNING attempts",
  )
    .bind(key, t + 15 * 60000, t, t)
    .first<{ attempts: number }>();
  assert(
    result && result.attempts <= max,
    429,
    "試行回数が多すぎます。15分後にお試しください",
  );
}
export function csrf(req: Request, e: Env, s: Session) {
  assert(
    req.headers.get("origin") === e.APP_ORIGIN,
    403,
    "アクセス元が一致しません",
  );
  assert(
    equal(req.headers.get("x-csrf-token") || "", s.csrf),
    403,
    "画面を再読み込みしてから操作してください",
  );
}
export async function session(req: Request, e: Env) {
  const id = /(?:^|;\s*)nobori_session=([^;]+)/.exec(
    req.headers.get("cookie") || "",
  )?.[1];
  if (!id) throw new AppError(401, "ログインしてください");
  const s = await e.DB.prepare(
    "SELECT * FROM sessions WHERE id=? AND expires>?",
  )
    .bind(await hash(id), Date.now())
    .first<Session>();
  assert(
    s && s.epoch === Number(await getConfig(e, "credential_epoch", "1")),
    401,
    "セッションの期限が切れました",
  );
  return s;
}
export async function admin(req: Request, e: Env, s: Session) {
  const ipKey =
    "pin-ip:" +
    (await secretDigest(e, req.headers.get("cf-connecting-ip") || "local"));
  await limit(e, ipKey, 8);
  await limit(e, "pin:" + s.id, 8);
  const expected = await getConfig(e, "admin_pin_hash", e.ADMIN_PIN_HASH);
  assert(
    equal(
      await secretDigest(e, req.headers.get("x-admin-pin") || ""),
      expected,
    ),
    403,
    "管理者PINが違います",
  );
  await e.DB.prepare("DELETE FROM rate_limits WHERE key IN (?,?)")
    .bind("pin:" + s.id, ipKey)
    .run();
}
export const cookie = (id: string, e: Env, maxAge = 43200) =>
  `nobori_session=${id}; Path=/; HttpOnly; ${e.APP_ORIGIN.startsWith("https:") ? "Secure; " : ""}SameSite=Lax; Max-Age=${maxAge}`;
export async function issuePlayer(e: Env) {
  const payload = b64(
    enc.encode(
      JSON.stringify({
        epoch: Number(await getConfig(e, "player_epoch", "1")),
        nonce: crypto.randomUUID(),
      }),
    ),
  );
  return payload + "." + (await secretDigest(e, payload));
}
export async function playerAuth(req: Request, e: Env) {
  const token =
    new URL(req.url).searchParams.get("token") ||
    req.headers.get("x-player-token") ||
    "";
  const [payload, sig] = token.split(".");
  assert(
    payload && sig && equal(await secretDigest(e, payload), sig),
    401,
    "再生トークンが無効です",
  );
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(unb64(payload)));
  } catch {
    throw new AppError(401, "再生トークンが無効です");
  }
  assert(
    data.epoch === Number(await getConfig(e, "player_epoch", "1")),
    401,
    "再生トークンが失効しています",
  );
}
