import type { Clip, Draft, Frame, Item } from "./types";
// /api/state returns frames newest first. Freeze that choice in the saved item,
// so a later upload cannot change an existing draft or OBS playback snapshot.
export const defaultFrameId = (frames: readonly Frame[]) =>
  frames[0]?.id ?? null;
export function clipToItem(
  clip: Pick<Clip, "id" | "duration">,
  frames: readonly Frame[],
): Item {
  return {
    id: crypto.randomUUID(),
    clipId: clip.id,
    start: Math.max(0, clip.duration - 30),
    end: clip.duration,
    frameId: defaultFrameId(frames),
  };
}
export function applyLatestFrame(
  draft: Draft,
  frames: readonly Frame[],
): Draft {
  const frameId = defaultFrameId(frames);
  return frameId
    ? { ...draft, items: draft.items.map((item) => ({ ...item, frameId })) }
    : draft;
}
