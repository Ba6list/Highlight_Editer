const status = document.querySelector("#status");
const pair = document.querySelector("#pair");
const code = document.querySelector("#code");
const disconnect = document.querySelector("#disconnect");
async function send(action, extra = {}) {
  const r = await chrome.runtime.sendMessage({ action, ...extra });
  if (!r?.ok) throw Error(r?.error || "拡張機能を再読み込みしてください");
  return r.data;
}
function connected(data) {
  status.textContent = `${data.name} として接続済み（${new Date(data.expires).toLocaleTimeString("ja-JP")}まで）。公式Twitch画面のSAVE CLIPを使えます。`;
  pair.hidden = true; disconnect.hidden = false; code.value = "";
}
pair.addEventListener("submit", async e => {
  e.preventDefault(); if (!e.isTrusted) return;
  const button = pair.querySelector("button"); button.disabled = true;
  try { connected(await send("pair", { code: code.value })); }
  catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});
disconnect.addEventListener("click", async e => {
  if (!e.isTrusted) return;
  disconnect.disabled = true;
  try { await send("disconnect"); pair.hidden = false; disconnect.hidden = true; status.textContent = "接続を解除しました。"; }
  catch (error) { status.textContent = error.message; }
  finally { disconnect.disabled = false; }
});
send("status").then(connected).catch(error => { status.textContent = error.message; });
