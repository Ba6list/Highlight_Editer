import { describe, it, expect } from "vitest";
import { shouldStart, type ObsControl } from "../src/obs";
const c: ObsControl = {
  revision: 5,
  selection: "s",
  playlist_id: "p",
  title: "test",
  version: 1,
  snapshot: null,
  action: "play",
  target: "player",
  issued: 10000,
};
describe("OBS start safety", () => {
  it("starts only a fresh command addressed to this player", () => {
    expect(shouldStart(c, 4, "player", 11000)).toBe(true);
    expect(shouldStart(c, 5, "player", 11000)).toBe(false); // refresh/reconnect
    expect(shouldStart(c, 4, "another-player", 11000)).toBe(false);
    expect(shouldStart(c, 4, "player", 20000)).toBe(false); // expired queued command
    expect(shouldStart({ ...c, action: "prepare" }, 4, "player", 11000)).toBe(
      false,
    );
    expect(shouldStart({ ...c, action: "stop" }, 4, "player", 11000)).toBe(
      false,
    );
  });
});
