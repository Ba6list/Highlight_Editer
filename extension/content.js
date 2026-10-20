(() => {
  const APP = "https://nobori-highlight-studio.nbrhg.workers.dev";
  const labels = { requested: "受付済み", generating: "生成中", downloading: "動画取得中", storing: "保存中", ready: "保存完了", retry: "再試行待ち", error: "エラー", archiving: "転送中", archived: "アーカイブ済み", restoring: "復元中" };
  const host = document.createElement("div");
  host.id = "nobori-clip-extension";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `<style>
    :host{all:initial;position:fixed;right:24px;bottom:80px;z-index:2147483646;font-family:system-ui,sans-serif;color:#eef5f5;font-size:13px;line-height:1.5;color-scheme:dark}
    *{box-sizing:border-box}section{width:288px;background:#11191ff5;border:1px solid #33515c;border-radius:12px;box-shadow:0 8px 36px #0008;overflow:hidden}header{display:flex;align-items:center;justify-content:space-between;padding:12px 15px;border-bottom:1px solid #30414a}strong{color:#27c8cb;letter-spacing:2px;font-size:12px}button{font:inherit;cursor:pointer}header button{background:transparent;border:0;color:#a5b4bd;padding:2px 8px;font-size:17px}.body{padding:14px}p{margin:0 0 12px;color:#b8c7ce;font-size:12px;overflow-wrap:anywhere}input,select{font:inherit;background:#0c1116;border:1px solid #405560;border-radius:5px;padding:7px;color:#eaf1f1;width:100%;margin-bottom:10px}label{font-size:11px;color:#a8bac4;display:block}#save{width:100%;border:0;border-radius:6px;background:#1cc3c7;color:#09282b;padding:14px 10px;font-size:17px;font-weight:800;margin-bottom:12px}#save:disabled{opacity:.45;cursor:default}#feedback{color:#d9e7eb;min-height:32px;margin-bottom:12px}a{color:#54d9db;font-size:11px;text-underline-offset:3px}ul{padding:0;margin:10px 0;list-style:none}li{font-size:11px;color:#abbec7;padding:6px 0;border-top:1px solid #27373f;overflow-wrap:anywhere}.note{font-size:10px;margin:12px 0 0;color:#869ba7}[hidden]{display:none!important}
  </style><section aria-label="NOBORIクリップ保存"><header><strong>NOBORI CLIP</strong><button id="toggle" aria-label="パネルを折りたたむ">−</button></header><div class="body"><p id="connection">拡張アイコンから接続してください</p><label>タイトル（任意）<input id="title" maxlength="160" placeholder="例：決勝 / 第2試合"></label><label>素材の長さ<select id="duration"><option value="60">最大60秒</option><option value="30">最大30秒</option></select></label><button id="save" disabled>SAVE CLIP</button><p id="feedback" role="status" aria-live="polite"></p><ul id="clips" aria-label="最近の保存状況"></ul><a id="editor" target="_blank" rel="noopener noreferrer">編集画面を開く ↗</a><p class="note">公式配信専用。視聴遅延により保存位置は前後します。動画はあとで編集できます。</p></div></section>`;
  shadow.querySelector("#editor").href = APP + "/#clips";
  const save = shadow.querySelector("#save"), feedback = shadow.querySelector("#feedback");
  let connected = false, busy = false, active = false, lastRefresh = 0, refreshing = false, collapsed = false, interval = 15000;
  async function send(action, extra = {}) {
    const r = await chrome.runtime.sendMessage({ action, ...extra });
    if (!r?.ok) throw Error(r?.error || "拡張を更新した場合はTwitchを再読み込みしてください");
    return r.data;
  }
  function available() { save.disabled = !connected || busy; }
  async function refresh() {
    if (refreshing || !active || document.hidden || collapsed) return;
    refreshing = true; lastRefresh = Date.now();
    try {
      const r = await send("status"); connected = true;
      shadow.querySelector("#connection").textContent = r.name + " として接続済み";
      save.textContent = r.pending ? "保存要求を再試行" : "SAVE CLIP";
      if (r.pending) feedback.textContent = "前回の受付結果が未確認です。同じ要求で再試行します。";
      const list = shadow.querySelector("#clips"); list.replaceChildren();
      for (const c of r.clips || []) { const li = document.createElement("li"); li.textContent = `${labels[c.status] || c.status} · ${c.title}${c.error ? " — " + c.error : ""}`; list.append(li); }
      const waiting = (r.clips || []).filter(c => ["requested", "generating", "downloading", "storing", "retry"].includes(c.status));
      interval = waiting.length ? 5000 : 30000;
      await Promise.allSettled(waiting.slice(0, 2).map(c => send("process", { id: c.id })));
    } catch (error) { connected = false; shadow.querySelector("#connection").textContent = error.message; }
    finally { refreshing = false; available(); }
  }
  save.addEventListener("click", async e => {
    if (!e.isTrusted || busy || !active) return;
    busy = true; available(); feedback.textContent = "保存を受け付けています…";
    try {
      await send("capture", { title: shadow.querySelector("#title").value, duration: Number(shadow.querySelector("#duration").value) });
      shadow.querySelector("#title").value = "";
      feedback.textContent = "受付済み。生成・保存状況を下に表示します。";
      await refresh();
    } catch (error) { feedback.textContent = error.message + " 同じ保存要求で再試行できます。"; }
    finally { setTimeout(() => { busy = false; available(); }, 1500); }
  });
  shadow.querySelector("#toggle").addEventListener("click", e => {
    if (!e.isTrusted) return;
    collapsed = !collapsed; shadow.querySelector(".body").hidden = collapsed;
    e.currentTarget.textContent = collapsed ? "+" : "−";
    e.currentTarget.setAttribute("aria-label", collapsed ? "パネルを開く" : "パネルを折りたたむ");
    if (!collapsed) void refresh();
  });
  function update() {
    active = /^\/nobori_official\/?$/i.test(location.pathname);
    if (!active) { host.remove(); return; }
    const parent = document.fullscreenElement || document.body;
    if (host.parentNode !== parent) { parent.append(host); lastRefresh = 0; }
    if (Date.now() - lastRefresh > interval) void refresh();
  }
  // Twitch uses in-page navigation. Do not depend on Twitch's private DOM classes.
  const timer = setInterval(update, 1000);
  addEventListener("pagehide", () => clearInterval(timer), { once: true });
  update();
})();
