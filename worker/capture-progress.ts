import type { Env } from "./types";
import { processClip } from "./jobs";
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
// A small, bounded burst keeps the first generation checks independent of the UI.
// Longer waits/retries remain recoverable through the client pump and minute cron.
export async function progressCapture(e: Env, id: string, wait = pause) {
  await processClip(e, id, true);
  for (let check = 0; check < 4; check++) {
    const c = await e.DB.prepare("SELECT status FROM clips WHERE id=?")
      .bind(id)
      .first<{ status: string }>();
    if (c?.status !== "generating") return;
    await wait(2000);
    await processClip(e, id, true);
  }
}
