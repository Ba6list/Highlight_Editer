import { z } from "zod";
import type { Env, Draft, Session, Playlist } from "./types";
import { assert, body, json, audit } from "./core";
export interface Control {
  revision: number;
  selection: string;
  playlist_id: string | null;
  title: string;
  version: number;
  snapshot: string | null;
  action: "prepare" | "play" | "stop";
  issued: number;
  target: string;
}
interface Runtime {
  lease: string;
  seen: number;
  selection: string;
  revision: number;
  status: string;
  item: number;
  error: string;
}
const uuid = z.string().uuid();
export const getControl = (e: Env) =>
  e.DB.prepare("SELECT * FROM obs_control WHERE id=1").first<Control>();
const runtime = (e: Env) =>
  e.DB.prepare("SELECT * FROM obs_runtime WHERE id=1").first<Runtime>();
const online = (r: Runtime | null) => !!r && r.seen > Date.now() - 15000;
export async function obsState(e: Env) {
  const [control, player, lists] = await Promise.all([
    getControl(e),
    runtime(e),
    e.DB.prepare(
      "SELECT id,title,version,draft FROM playlists ORDER BY updated DESC",
    ).all<Playlist>(),
  ]);
  return json({
    control: control && {
      ...control,
      snapshot: control.snapshot ? JSON.parse(control.snapshot) : null,
    },
    player: player
      ? { ...player, online: online(player), lease: undefined }
      : null,
    playlists: lists.results.map((p) => ({
      id: p.id,
      title: p.title,
      version: p.version,
      count: (JSON.parse(p.draft) as Draft).items.length,
    })),
  });
}
export async function obsPrepare(
  req: Request,
  e: Env,
  s: Session,
  validate: (draft: Draft) => Promise<Draft>,
) {
  const input = await body(
    req,
    z.object({
      playlistId: uuid.nullable(),
      version: z.number().int().optional(),
      revision: z.number().int(),
    }),
  );
  const p = input.playlistId
    ? await e.DB.prepare("SELECT * FROM playlists WHERE id=?")
        .bind(input.playlistId)
        .first<Playlist>()
    : null;
  if (input.playlistId) assert(p, 404, "再生リストがありません");
  if (p)
    assert(
      p.version === input.version,
      409,
      "再生リストが更新されました。一覧を確認してください",
    );
  const draft = p ? await validate(JSON.parse(p.draft)) : null;
  if (draft) assert(draft.items.length, 400, "クリップを追加してください");
  // The conditional UPDATE and snapshot-reference triggers run in one transaction.
  const changed = await e.DB.prepare(
    `UPDATE obs_control SET revision=revision+1,selection=?,playlist_id=?,title=?,version=?,snapshot=?,action='prepare',issued=?,target=''
    WHERE id=1 AND revision=? AND NOT EXISTS(SELECT 1 FROM obs_runtime r WHERE r.id=1 AND r.seen>? AND (r.status='playing' OR (obs_control.action='play' AND r.revision<obs_control.revision))) RETURNING revision`,
  )
    .bind(
      crypto.randomUUID(),
      p?.id || null,
      p?.title || "",
      p?.version || 0,
      draft ? JSON.stringify(draft) : null,
      Date.now(),
      input.revision,
      Date.now() - 15000,
    )
    .first();
  assert(
    changed,
    409,
    "再生中の場合は停止を確認してください。別の操作があった場合は画面を更新してください",
  );
  await audit(e, s.name, "obs:prepare:" + (p?.id || "clear"));
  return json(changed);
}
export async function obsCommand(req: Request, e: Env, s: Session) {
  const input = await body(
    req,
    z.object({
      action: z.enum(["play", "stop", "restart"]),
      revision: z.number().int(),
    }),
  );
  const t = Date.now();
  const play = input.action !== "stop";
  const changed = await e.DB.prepare(
    `UPDATE obs_control SET revision=revision+1,action=?,issued=?,target=COALESCE((SELECT lease FROM obs_runtime WHERE id=1),'')
    WHERE id=1 AND revision=? ${play ? `AND snapshot IS NOT NULL AND EXISTS(SELECT 1 FROM obs_runtime r WHERE r.id=1 AND r.seen>? AND r.selection=obs_control.selection AND r.revision=obs_control.revision AND r.status IN ('ready','stopped','done','playing'))` : ""} RETURNING revision`,
  )
    .bind(
      play ? "play" : "stop",
      t,
      input.revision,
      ...(play ? [t - 15000] : []),
    )
    .first();
  assert(
    changed,
    409,
    "プレーヤーの準備完了を待ってください。別の操作があった場合は画面を更新してください",
  );
  await audit(e, s.name, "obs:" + input.action);
  return json(changed);
}
export async function obsRegister(req: Request, e: Env) {
  const { lease } = await body(req, z.object({ lease: uuid }));
  const t = Date.now();
  const result = await e.DB.prepare(
    `INSERT INTO obs_runtime(id,lease,seen,revision) VALUES(1,?,?,(SELECT revision FROM obs_control WHERE id=1))
    ON CONFLICT(id) DO UPDATE SET lease=excluded.lease,seen=excluded.seen,selection='',revision=excluded.revision,status='waiting',item=0,error='',sequence=0
    WHERE obs_runtime.seen<? OR obs_runtime.lease=excluded.lease RETURNING revision`,
  )
    .bind(lease, t, t - 15000)
    .first<{ revision: number }>();
  assert(
    result,
    409,
    "別のプレーヤーが接続中です。テスト画面を閉じて15秒お待ちください",
  );
  return json(result);
}
export async function obsPoll(req: Request, e: Env) {
  const lease = uuid.parse(new URL(req.url).searchParams.get("lease"));
  const r = await e.DB.prepare(
    "UPDATE obs_runtime SET seen=? WHERE id=1 AND lease=? RETURNING revision",
  )
    .bind(Date.now(), lease)
    .first();
  assert(r, 409, "プレーヤーの接続が切り替わりました。再読み込みしてください");
  const c = (await getControl(e))!;
  return json({
    ...c,
    serverTime: Date.now(),
    snapshot: c.snapshot ? JSON.parse(c.snapshot) : null,
  });
}
export async function obsReport(req: Request, e: Env) {
  const input = await body(
    req,
    z.object({
      lease: uuid,
      selection: z.string().max(36),
      revision: z.number().int(),
      status: z.enum([
        "ready",
        "stopped",
        "playing",
        "done",
        "error",
        "waiting",
      ]),
      item: z.number().int().min(0).max(1000),
      error: z.string().max(160).default(""),
      sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    }),
  );
  // A delayed report must not overwrite the status of a newer command/selection.
  const r = await e.DB.prepare(
    `UPDATE obs_runtime SET selection=?,revision=?,status=?,item=?,error=?,seen=?,sequence=? WHERE id=1 AND lease=? AND sequence<?
    AND revision<=? AND EXISTS(SELECT 1 FROM obs_control WHERE id=1 AND revision=? AND selection=?) RETURNING id`,
  )
    .bind(
      input.selection,
      input.revision,
      input.status,
      input.item,
      input.error,
      Date.now(),
      input.sequence,
      input.lease,
      input.sequence,
      input.revision,
      input.revision,
      input.selection,
    )
    .first();
  assert(r, 409, "操作状態が更新されています");
  return json({ ok: true });
}
