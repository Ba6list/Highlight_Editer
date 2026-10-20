import { z } from "zod";
import type { Env, Session } from "./types";
import { now, uid } from "./types";
import { body, json, assert, getConfig, archiveDate, audit } from "./core";
import { limit } from "./security";
import { capacity, processClip } from "./jobs";
export async function capture(req: Request, e: Env, ctx: ExecutionContext, s: Session) {
    const input = await body(
      req,
      z.object({
        requestKey: z.string().uuid(),
        title: z.string().trim().min(1).max(160).default("NOBORI Highlight"),
        duration: z.union([z.literal(30), z.literal(60)]).default(60),
      }),
    );
    const previous = await e.DB.prepare(
      "SELECT id FROM clips WHERE request_key=?",
    )
      .bind(input.requestKey)
      .first();
    if (previous) return json(previous, 202);
    await limit(e, "capture:" + s.id, 30);
    await capacity(e, 100 * 1024 * 1024);
    assert(
      await e.DB.prepare(
        "SELECT provider FROM connections WHERE provider='twitch'",
      ).first(),
      409,
      "管理者がTwitchを接続してください",
    );
    const id = uid(),
      created = now();
    await e.DB.prepare(
      "INSERT OR IGNORE INTO clips(id,request_key,title,created,updated,archive_at,requested_duration) VALUES (?,?,?,?,?,?,?)",
    )
      .bind(
        id,
        input.requestKey,
        input.title,
        created,
        created,
        archiveDate(created, Number(await getConfig(e, "retention_days", "7"))),
        input.duration,
      )
      .run();
    const row = await e.DB.prepare("SELECT id FROM clips WHERE request_key=?")
      .bind(input.requestKey)
      .first<{ id: string }>();
    ctx.waitUntil(processClip(e, row!.id));
    await audit(e, s.name, "capture:" + row!.id);
    return json(row, 202);
}
