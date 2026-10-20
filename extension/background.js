const APP = "https://nobori-highlight-studio.nbrhg.workers.dev";
const UUID = /^[a-f0-9-]{36}$/i;
const TOKEN = /^[a-f0-9-]{72}$/i;
let captureFlight;
const securedStorage = Promise.all([
  chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
  chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
]);
async function auth() {
  const { connection } = await chrome.storage.session.get("connection");
  if (!connection || connection.expires <= Date.now()) {
    await chrome.storage.session.remove("connection");
    throw Error("拡張アイコンから接続コードを入力してください");
  }
  return connection;
}
async function api(path, method = "GET", body, token) {
  const r = await fetch(APP + "/api/extension/" + path, {
    method, credentials: "omit", redirect: "error", cache: "no-store",
    signal: AbortSignal.timeout(20000),
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && token) await chrome.storage.session.remove("connection");
    throw Error(data.error || "接続できません。しばらくしてから再試行してください");
  }
  return data;
}
async function capture(message) {
  const c = await auth();
  const stored = await chrome.storage.local.get("pendingCapture");
  let pending = stored.pendingCapture;
  if (!pending || !UUID.test(pending.requestKey)) {
    pending = {
      requestKey: crypto.randomUUID(), duration: message.duration === 30 ? 30 : 60,
      title: typeof message.title === "string" && message.title.trim() ? message.title.trim().slice(0, 160) : "NOBORI Highlight " + new Date().toLocaleString("ja-JP"),
    };
    // Preserve the exact request across worker suspension or uncertain HTTP responses.
    await chrome.storage.local.set({ pendingCapture: pending });
  }
  const result = await api("capture", "POST", pending, c.token);
  await chrome.storage.local.remove("pendingCapture");
  return result;
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  const popup = sender.url === chrome.runtime.getURL("popup.html");
  const twitch = /^https:\/\/www\.twitch\.tv\/nobori_official\/?(?:[?#].*)?$/i.test(sender.url || "") && sender.frameId === 0;
  if (!popup && !twitch) { reply({ ok: false, error: "公式配信ページで操作してください" }); return; }
  (async () => {
    await securedStorage;
    if (message?.action === "pair" && popup) {
      const code = typeof message.code === "string" ? message.code.trim() : "";
      if (!TOKEN.test(code)) throw Error("アプリで発行した接続コードを貼り付けてください");
      const connection = await api("pair", "POST", { code });
      await chrome.storage.session.set({ connection });
      return { name: connection.name, expires: connection.expires };
    }
    if (message?.action === "disconnect" && popup) {
      const { connection } = await chrome.storage.session.get("connection");
      if (connection) {
        // Keep a live credential locally if server revocation failed; the user can retry.
        try { await api("disconnect", "POST", {}, connection.token); }
        catch (error) { if ((await chrome.storage.session.get("connection")).connection) throw error; }
      }
      await chrome.storage.session.remove("connection");
      return { disconnected: true };
    }
    if (message?.action === "status") {
      const c = await auth();
      const result = await api("status", "GET", undefined, c.token);
      const { pendingCapture } = await chrome.storage.local.get("pendingCapture");
      return { ...result, pending: !!pendingCapture };
    }
    if (message?.action === "capture" && twitch) {
      if (!captureFlight) captureFlight = capture(message).finally(() => { captureFlight = undefined; });
      return await captureFlight;
    }
    if (message?.action === "process" && twitch && UUID.test(message.id || "")) {
      const c = await auth();
      return await api("process", "POST", { id: message.id }, c.token);
    }
    throw Error("この操作は利用できません");
  })().then(data => reply({ ok: true, data }), error => reply({ ok: false, error: error?.message || "通信に失敗しました。同じ保存要求で再試行できます。" }));
  return true;
});
