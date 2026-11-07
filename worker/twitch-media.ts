import { assert, AppError } from "./core";
// Observed in Get Clips Download for the failed production clip on 2026-11-07.
// CloudFront is shared infrastructure: allow this Twitch distribution only.
const clipDistributions = new Set(["d1ndex63qxojbr.cloudfront.net"]);
export function validateClipDownload(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(502, "Twitchの動画URLの形式が正しくありません");
  }
  assert(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443") &&
      (url.hostname.endsWith(".twitchcdn.net") ||
        url.hostname.endsWith(".twitch.tv") ||
        clipDistributions.has(url.hostname)),
    502,
    "Twitchの動画URLを検証できません",
  );
  return url;
}
export async function fetchClipDownload(value: string) {
  let url = validateClipDownload(value);
  for (let redirect = 0; redirect <= 3; redirect++) {
    const response = await fetch(url.toString(), { redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    assert(location && redirect < 3, 502, "Twitchの動画転送先を確認できません");
    url = validateClipDownload(new URL(location, url).toString());
  }
  throw new AppError(502, "Twitchの動画転送回数が多すぎます");
}
