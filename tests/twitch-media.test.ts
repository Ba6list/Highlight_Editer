import { describe, it, expect, vi, afterEach } from "vitest";
import {
  validateClipDownload,
  fetchClipDownload,
} from "../worker/twitch-media";
afterEach(() => vi.restoreAllMocks());
describe("Twitch clip download destinations", () => {
  it.each([
    "https://d1ndex63qxojbr.cloudfront.net/clip.mp4?token=signed",
    "https://production.assets.clips.twitchcdn.net/clip.mp4",
    "https://clips-media-assets.twitch.tv/clip.mp4",
  ])("accepts a verified Twitch destination: %s", (url) => {
    expect(validateClipDownload(url).protocol).toBe("https:");
  });
  it.each([
    "http://d1ndex63qxojbr.cloudfront.net/clip.mp4",
    "https://other.cloudfront.net/clip.mp4",
    "https://d1ndex63qxojbr.cloudfront.net.evil.test/clip.mp4",
    "https://evil-twitchcdn.net/clip.mp4",
    "https://127.0.0.1/clip.mp4",
    "https://user:secret@d1ndex63qxojbr.cloudfront.net/clip.mp4",
    "https://d1ndex63qxojbr.cloudfront.net:8443/clip.mp4",
    "invalid",
  ])("rejects unverified destination: %s", (url) => {
    expect(() => validateClipDownload(url)).toThrow();
  });
  it("validates redirects before following them", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { Location: "https://127.0.0.1/private" },
        }),
      );
    await expect(
      fetchClipDownload("https://d1ndex63qxojbr.cloudfront.net/clip.mp4"),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]).toEqual({ redirect: "manual" });
  });
  it("follows verified redirects without attaching Twitch authorization", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            Location: "https://production.assets.clips.twitchcdn.net/clip.mp4",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2]), { status: 200 }),
      );
    expect(
      (
        await fetchClipDownload(
          "https://d1ndex63qxojbr.cloudfront.net/clip.mp4",
        )
      ).status,
    ).toBe(200);
    expect(fetcher.mock.calls[1][1]).toEqual({ redirect: "manual" });
  });
  it("bounds redirect loops", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        async () =>
          new Response(null, {
            status: 302,
            headers: { Location: "/clip.mp4" },
          }),
      );
    await expect(
      fetchClipDownload("https://d1ndex63qxojbr.cloudfront.net/clip.mp4"),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
