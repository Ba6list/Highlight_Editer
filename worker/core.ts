import { z } from "zod";
import type { Env, Draft, Clip } from "./types";
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function assert(
  test: unknown,
  status: number,
  message: string,
): asserts test {
  if (!test) throw new AppError(status, message);
}
export const daysSchema = z.union([
  z.literal(1),
  z.literal(3),
  z.literal(7),
  z.literal(14),
  z.literal(21),
  z.literal(30),
]);
export const draftSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        clipId: z.string().uuid(),
        start: z.number().finite().min(0),
        end: z.number().finite().positive(),
        frameId: z.string().uuid().nullable(),
      }),
    )
    .max(100),
  loop: z.boolean(),
  endBehavior: z.enum(["black", "standby"]),
});
export function validateDraft(draft: Draft, clips: Clip[]) {
  const parsed = draftSchema.parse(draft);
  const ids = new Set<string>();
  for (const item of parsed.items) {
    assert(!ids.has(item.id), 400, "同じ項目IDが重複しています");
    ids.add(item.id);
    const c = clips.find((x) => x.id === item.clipId);
    assert(
      c && c.status === "ready" && c.r2_key,
      409,
      "使用できないクリップがあります。復元または取り込みを完了してください",
    );
    assert(
      item.start < item.end && item.end <= c.duration + 0.05,
      400,
      "トリミング範囲が動画の長さを超えています",
    );
  }
  return parsed;
}
export const archiveDate = (created: number, days: number) =>
  created + days * 86400000;
export function byteRange(
  header: string | null,
  size: number,
): { offset: number; length: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!m || (!m[1] && !m[2])) throw new AppError(416, "不正な再生範囲");
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1]
    ? m[2]
      ? Math.min(Number(m[2]), size - 1)
      : size - 1
    : size - 1;
  assert(
    Number.isSafeInteger(start) && start >= 0 && start < size && end >= start,
    416,
    "再生範囲外",
  );
  return { offset: start, length: end - start + 1 };
}
export async function getConfig(e: Env, key: string, fallback = "") {
  return (
    (
      await e.DB.prepare("SELECT value FROM config WHERE key=?")
        .bind(key)
        .first<{ value: string }>()
    )?.value ?? fallback
  );
}
export async function setConfig(e: Env, key: string, value: string) {
  await e.DB.prepare(
    "INSERT INTO config(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  )
    .bind(key, value)
    .run();
}
export const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
export async function body<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  const len = Number(req.headers.get("content-length") || 0);
  assert(len < 1024 * 1024, 413, "入力が大きすぎます");
  const reader = req.body?.getReader();
  assert(reader, 400, "入力がありません");
  const decoder = new TextDecoder();
  let text = "",
    size = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size >= 1024 * 1024) {
      await reader.cancel();
      throw new AppError(413, "入力が大きすぎます");
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  text += decoder.decode();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AppError(400, "JSONの入力内容を確認してください");
  }
  return schema.parse(parsed);
}
export async function audit(
  e: Env,
  name: string,
  action: string,
  result = "ok",
) {
  await e.DB.prepare(
    "INSERT INTO audit(at,name,action,result) VALUES (?,?,?,?)",
  )
    .bind(Date.now(), name, action, result)
    .run();
}
