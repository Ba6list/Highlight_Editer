let csrf = "";
export const setCsrf = (v: string) => {
  csrf = v;
};
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
  pin?: string,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (
    options.body &&
    !(options.body instanceof FormData) &&
    !(options.body instanceof File)
  )
    headers.set("Content-Type", "application/json");
  headers.set("X-CSRF-Token", csrf);
  if (pin) headers.set("X-Admin-Pin", pin);
  const r = await fetch("/api" + path, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  const data = await r
    .json()
    .catch(() => ({ error: "サーバー応答を読み取れません" }));
  if (!r.ok)
    throw new ApiError(
      r.status,
      (data as { error?: string }).error || "通信に失敗しました",
    );
  return data as T;
}
export const post = <T>(path: string, data: unknown = {}, pin?: string) =>
  api<T>(path, { method: "POST", body: JSON.stringify(data) }, pin);
export const media = (id: string) => "/media/clip/" + id;
export const frame = (id: string) => "/media/frame/" + id;
export const time = (n: number) =>
  `${Math.floor(n / 60)}:${(n % 60).toFixed(1).padStart(4, "0")}`;
export const date = (n: number) =>
  new Date(n).toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
export const bytes = (n: number) => `${(n / 1024 ** 3).toFixed(2)} GB`;
export const states: Record<string, string> = {
  requested: "リクエスト受付",
  generating: "Twitchで生成中",
  downloading: "動画取得中",
  storing: "R2へ保存中",
  ready: "保存完了",
  retry: "再試行待ち",
  error: "エラー",
  archiving: "アーカイブ転送中",
  archived: "アーカイブ済み",
  restoring: "復元中",
  deleting: "削除中",
};
