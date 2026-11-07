export const capturePending = (status: string) =>
  ["requested", "generating", "downloading", "storing", "retry"].includes(
    status,
  );
interface Options {
  pending: () => string[];
  process: (id: string) => Promise<unknown>;
  refresh: () => Promise<unknown>;
}
// Lives at workspace level, not in the capture screen. Refreshes never reset its timer.
export function startCaptureProgress(options: Options) {
  let cancelled = false,
    cursor = 0;
  let timer: ReturnType<typeof setTimeout>;
  async function pump() {
    const ids = options.pending();
    if (ids.length) {
      const batch = Array.from(
        { length: Math.min(2, ids.length) },
        (_, n) => ids[(cursor + n) % ids.length],
      );
      cursor = (cursor + batch.length) % ids.length;
      await Promise.allSettled(batch.map((id) => options.process(id)));
      if (!cancelled) await options.refresh().catch(() => {});
    }
    if (!cancelled) timer = setTimeout(pump, 3000);
  }
  timer = setTimeout(pump, 0);
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}
