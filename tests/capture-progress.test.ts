import { describe, it, expect, vi, afterEach } from "vitest";
import { startCaptureProgress } from "../src/capture-progress";
afterEach(() => vi.useRealTimers());
describe("workspace capture processing", () => {
  it("continues when pending items and views change, without restarting its schedule", async () => {
    vi.useFakeTimers();
    let pending = ["a"];
    const process = vi.fn(async (_id: string) => {}),
      refresh = vi.fn(async () => {});
    const stop = startCaptureProgress({
      pending: () => pending,
      process,
      refresh,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(process).toHaveBeenCalledWith("a");
    pending = ["b"];
    await vi.advanceTimersByTimeAsync(3000);
    expect(process).toHaveBeenCalledWith("b");
    pending = [];
    await vi.advanceTimersByTimeAsync(3000);
    expect(process).toHaveBeenCalledTimes(2);
    stop();
  });
  it("rotates pending jobs fairly and stops at logout/unmount", async () => {
    vi.useFakeTimers();
    const process = vi.fn(async (_id: string) => {});
    const stop = startCaptureProgress({
      pending: () => ["a", "b", "c"],
      process,
      refresh: async () => {},
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(process.mock.calls.map((c) => c[0])).toEqual(["a", "b"]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(process.mock.calls.map((c) => c[0])).toEqual(["a", "b", "c", "a"]);
    stop();
    await vi.advanceTimersByTimeAsync(9000);
    expect(process).toHaveBeenCalledTimes(4);
  });
  it("does not overlap batches or let a failed job block other jobs", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const process = vi.fn((id: string) =>
      id === "a"
        ? new Promise<void>((r) => (finish = r))
        : Promise.reject(Error("offline")),
    );
    const refresh = vi.fn(async () => {});
    const stop = startCaptureProgress({
      pending: () => ["a", "b"],
      process,
      refresh,
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect(process).toHaveBeenCalledTimes(2);
    expect(refresh).not.toHaveBeenCalled();
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });
});
