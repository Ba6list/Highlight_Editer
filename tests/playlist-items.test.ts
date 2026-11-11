import { describe, it, expect } from "vitest";
import { clipToItem, applyLatestFrame } from "../src/playlist-items";
import type { Frame, Draft } from "../src/types";
const frames: Frame[] = [
  { id: "latest", name: "最新PNG", width: 1920, height: 1080, bytes: 20 },
  { id: "older", name: "旧PNG", width: 1920, height: 1080, bytes: 20 },
];
describe("default PNG on playlist clips", () => {
  it("freezes the latest uploaded frame when adding a clip, without changing clip timing", () => {
    const item = clipToItem({ id: "clip", duration: 60 }, frames);
    expect(item).toMatchObject({
      clipId: "clip",
      start: 30,
      end: 60,
      frameId: "latest",
    });
    const another = clipToItem({ id: "clip", duration: 15 }, []);
    expect(another).toMatchObject({ start: 0, end: 15, frameId: null });
    expect(another.id).not.toBe(item.id);
    frames[0] = { ...frames[0], id: "new-upload" };
    expect(item.frameId).toBe("latest");
    frames[0] = { ...frames[0], id: "latest" };
  });
  it("bulk applies only the frame field and preserves timing, IDs, ordering, loop and end behavior", () => {
    const draft: Draft = {
      items: [
        { id: "a", clipId: "clip", start: 4, end: 12, frameId: null },
        { id: "b", clipId: "clip", start: 20, end: 25, frameId: "older" },
      ],
      loop: true,
      endBehavior: "standby",
    };
    const next = applyLatestFrame(draft, frames);
    expect(next).toEqual({
      ...draft,
      items: draft.items.map((i) => ({ ...i, frameId: "latest" })),
    });
    expect(draft.items[0].frameId).toBeNull();
    expect(draft.items[1].frameId).toBe("older");
  });
  it("leaves an existing draft untouched if no PNG is uploaded", () => {
    const draft: Draft = {
      items: [{ id: "a", clipId: "clip", start: 1, end: 3, frameId: null }],
      loop: false,
      endBehavior: "black",
    };
    expect(applyLatestFrame(draft, [])).toBe(draft);
  });
});
