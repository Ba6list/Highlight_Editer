import { z } from "zod";
import type { Env, Session } from "./types";
import { uid, now } from "./types";
import { assert, body, json, getConfig, audit } from "./core";
import { hash, limit, secretDigest } from "./security";
import { capture } from "./capture";
import { processClip } from "./jobs";

const tokenValue = () => uid() + uid();
export async function issueExtensionCode(e: Env, s: Session) {
  await limit(e, "extension-code:" + s.id, 15);
  const code = tokenValue();
  const expires = Math.min(now() + 5 * 60000, s.expires);
  await e.DB.batch([
    e.DB.prepare("DELETE FROM extension_pair_codes WHERE session_id=? OR expires<?").bind(s.id, now()),
    e.DB.prepare("INSERT INTO extension_pair_codes VALUES (?,?,?)").bind(await hash(code), s.id, expires),
  ]);
  return json({ code, expires });
}
export async function revokeExtensions(e: Env, s: Session) {
  await e.DB.batch([
    e.DB.prepare("DELETE FROM extension_pair_codes WHERE session_id=?").bind(s.id),
    e.DB.prepare("DELETE FROM extension_tokens WHERE session_id=?").bind(s.id),
  ]);
  await audit(e, s.name, "extension:revoke");
  return json({ ok: true });
}
async function extensionSession(req: Request, e: Env) {
  const token = /^Bearer ([a-f0-9-]{72})$/i.exec(req.headers.get("authorization") || "")?.[1];
  assert(token, 401, "拡張機能を接続してください");
  const s = await e.DB.prepare("SELECT s.* FROM extension_tokens t JOIN sessions s ON s.id=t.session_id WHERE t.token_hash=? AND t.expires>? AND s.expires>?")
    .bind(await hash(token), now(), now()).first<Session>();
  assert(s && s.epoch === Number(await getConfig(e, "credential_epoch", "1")), 401, "接続期限が切れました。アプリから接続コードを発行してください");
  return s;
}
export async function extensionRoute(req: Request, e: Env, ctx: ExecutionContext) {
  const path = new URL(req.url).pathname;
  if (path === "/api/extension/pair" && req.method === "POST") {
    await limit(e, "extension-pair:" + await secretDigest(e, req.headers.get("cf-connecting-ip") || "local"), 15);
    const { code } = await body(req, z.object({ code: z.string().regex(/^[a-f0-9-]{72}$/i) }));
    // DELETE RETURNING makes redemption atomic: parallel requests cannot reuse a code.
    const row = await e.DB.prepare("DELETE FROM extension_pair_codes WHERE code_hash=? AND expires>? RETURNING session_id")
      .bind(await hash(code), now()).first<{ session_id: string }>();
    assert(row, 401, "接続コードが無効、使用済み、または期限切れです");
    const s = await e.DB.prepare("SELECT * FROM sessions WHERE id=? AND expires>?").bind(row.session_id, now()).first<Session>();
    assert(s && s.epoch === Number(await getConfig(e, "credential_epoch", "1")), 401, "アプリへログインし直してください");
    const token = tokenValue();
    await e.DB.prepare("INSERT INTO extension_tokens VALUES (?,?,?)").bind(await hash(token), s.id, s.expires).run();
    await audit(e, s.name, "extension:pair");
    return json({ token, expires: s.expires, name: s.name });
  }
  const s = await extensionSession(req, e);
  if (path === "/api/extension/disconnect" && req.method === "POST") {
    await e.DB.prepare("DELETE FROM extension_tokens WHERE token_hash=?").bind(await hash(req.headers.get("authorization")!.slice(7))).run();
    return json({ ok: true });
  }
  if (path === "/api/extension/capture" && req.method === "POST") return capture(req, e, ctx, s);
  if (path === "/api/extension/process" && req.method === "POST") {
    await limit(e, "extension-process:" + s.id, 600);
    const { id } = await body(req, z.object({ id: z.string().uuid() }));
    const c = await e.DB.prepare("SELECT id FROM clips WHERE id=? AND status IN ('requested','generating','downloading','storing','retry')").bind(id).first();
    assert(c, 409, "保存処理中のクリップではありません");
    ctx.waitUntil(processClip(e, id, true));
    return json({ ok: true }, 202);
  }
  if (path === "/api/extension/status" && req.method === "GET") {
    const clips = await e.DB.prepare("SELECT id,title,status,error,created FROM clips ORDER BY created DESC LIMIT 5").all();
    return json({ name: s.name, expires: s.expires, clips: clips.results });
  }
  assert(false, 404, "拡張機能ではこの操作は利用できません");
}
