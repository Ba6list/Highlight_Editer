import { useEffect, useRef, useState } from "react";
import { Play, Square, RotateCcw, RefreshCw, LogOut } from "lucide-react";
import { api, post, setCsrf, ApiError, time } from "./api";
import { Login } from "./App";
import type { Session } from "./types";
import { obsStatus, type ObsState } from "./obs";
export default function ObsDock() {
  const [session, setSession] = useState<Session | null>(null),
    [checking, setChecking] = useState(true);
  const [state, setState] = useState<ObsState | null>(null),
    [selected, setSelected] = useState("");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [offline, setOffline] = useState(false);
  const refreshing = useRef(false);
  async function refresh() {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const s = await api<ObsState>("/obs/state");
      setState(s);
      setOffline(false);
    } catch (e) {
      setOffline(true);
      if (e instanceof ApiError && e.status === 401) {
        setSession(null);
        setCsrf("");
        setState(null);
      } else setError((e as Error).message);
    } finally {
      refreshing.current = false;
    }
  }
  useEffect(() => {
    api<Session>("/session")
      .then((s) => {
        setCsrf(s.csrf);
        setSession(s);
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    if (!session) return;
    void refresh();
    const id = setInterval(() => void refresh(), 4000);
    return () => clearInterval(id);
  }, [session]);
  async function act(path: string, data: unknown, label: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await post(path, data);
      setNotice(label);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  const c = state?.control,
    p = state?.player;
  const ack = !!c && p?.selection === c.selection && p?.revision === c.revision;
  const ready =
    !!p?.online &&
    ack &&
    ["ready", "stopped", "done", "playing"].includes(p.status);
  const playing =
    !!p?.online && (p.status === "playing" || (c?.action === "play" && !ack));
  const choice = state?.playlists.find((v) => v.id === selected);
  return (
    <main className="obs-dock">
      {checking ? (
        <p className="muted">接続を確認中…</p>
      ) : !session ? (
        <Login
          onLogin={(s) => {
            setCsrf(s.csrf);
            setSession(s);
          }}
        />
      ) : (
        <>
          <header className="dock-header">
            <div>
              <p className="eyebrow">NOBORI / OBS CONTROL</p>
              <h1>ハイライト操作</h1>
            </div>
            <button
              aria-label="状態を更新"
              disabled={busy}
              onClick={() => void refresh()}
            >
              <RefreshCw size={17} />
            </button>
          </header>
          <p className="dock-hint">
            配信に映すシーンを確認してから再生してください。
          </p>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
          <section className="panel dock-section">
            <p className="eyebrow">1 / 再生する素材</p>
            <label>
              再生リスト
              <select
                value={selected}
                disabled={busy}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">再生リストを選ぶ</option>
                {state?.playlists.map((v) => (
                  <option key={v.id} value={v.id} disabled={!v.count}>
                    {v.title}（{v.count}本 / v{v.version}）
                  </option>
                ))}
              </select>
            </label>
            <button
              className="dock-wide"
              disabled={busy || offline || !choice || playing}
              onClick={() =>
                void act(
                  "/obs/prepare",
                  {
                    playlistId: selected,
                    version: choice?.version,
                    revision: c?.revision,
                  },
                  "読み込みを依頼しました。準備完了をお待ちください。",
                )
              }
            >
              読み込んで待機
            </button>
            <p className="muted">
              保存済みの内容を読み込みます。編集中の変更は、もう一度読み込むまで反映しません。
            </p>
          </section>
          <section className="panel dock-section" aria-label="プレーヤー状態">
            <div className="dock-status">
              <span
                className={
                  "status-dot " + (p?.online && !offline ? "connected" : "")
                }
              />
              <strong>
                {offline
                  ? "操作パネルの通信が切れています"
                  : !p?.online
                    ? "プレーヤー接続待ち"
                    : !ack
                      ? "操作の反映待ち"
                      : obsStatus[p.status] || "準備待ち"}
              </strong>
            </div>
            <h2>{c?.title || "素材未選択"}</h2>
            {c?.snapshot && (
              <p className="muted">
                {c.snapshot.items.length}本 · 合計
                {time(
                  c.snapshot.items.reduce((n, i) => n + i.end - i.start, 0),
                )}{" "}
                · 読み込み時 v{c.version}
                {c.snapshot.loop ? " · 繰り返し" : ""}
              </p>
            )}
            {p?.online && p.status === "playing" && (
              <p>再生中：{p.item + 1}本目</p>
            )}
            {p?.online && p.error && <p className="error-text">{p.error}</p>}
            <button
              className="primary dock-play"
              disabled={busy || offline || !ready || playing || !c?.snapshot}
              onClick={() =>
                void act(
                  "/obs/command",
                  { action: "play", revision: c?.revision },
                  "再生を依頼しました。状態表示を確認してください。",
                )
              }
            >
              <Play size={22} />
              再生
            </button>
            <div className="dock-buttons">
              <button
                disabled={busy || offline || !c}
                onClick={() =>
                  void act(
                    "/obs/command",
                    { action: "stop", revision: c?.revision },
                    "停止を依頼しました。",
                  )
                }
              >
                <Square size={17} />
                停止
              </button>
              <button
                disabled={busy || offline || !ready || !c?.snapshot}
                onClick={() =>
                  void act(
                    "/obs/command",
                    { action: "restart", revision: c?.revision },
                    "先頭からの再生を依頼しました。",
                  )
                }
              >
                <RotateCcw size={17} />
                先頭から
              </button>
            </div>
            <button
              className="dock-clear"
              disabled={busy || offline || playing || !c?.snapshot}
              onClick={() =>
                void act(
                  "/obs/prepare",
                  { playlistId: null, revision: c?.revision },
                  "素材を外しました。",
                )
              }
            >
              待機素材を外す
            </button>
          </section>
          <details className="dock-help">
            <summary>初回設定・使い方</summary>
            <ol>
              <li>
                Webサイトのシステム設定で発行したOBS用URLをブラウザソースに登録します。
              </li>
              <li>
                ソースの「表示されていないときにシャットダウン」「シーンがアクティブになったときに表示を更新」は両方オフにします。
              </li>
              <li>このパネルで素材を読み込み、準備完了を待ちます。</li>
              <li>HIGHLIGHTシーンを配信画面に切り替え、「再生」を押します。</li>
              <li>
                終了後は試合のシーンへ戻します。途中で戻す場合は「停止」も押してください。
              </li>
            </ol>
            <p>
              操作は通常約2秒以内に届きます。映像の読み込みには別途時間がかかります。配信遅延180秒はそのまま適用されます。シーン切り替えは手動です。プレビューに置いただけでは再生しません。
            </p>
            <p>
              接続待ちの場合は再生用ブラウザソースを確認してください。接続できるプレーヤーは1つです。テスト画面を閉じた後は15秒お待ちください。通信が途切れると映像を停止し、復旧後も再生操作が必要です。
            </p>
            <p>
              Macなどでカスタムブラウザドックが使えない場合は、このURLを通常のブラウザで開いて操作できます。
            </p>
          </details>
          <footer className="dock-footer">
            <span>{session.name}</span>
            <button
              disabled={busy}
              onClick={async () => {
                try {
                  await post("/logout");
                  setSession(null);
                  setState(null);
                  setCsrf("");
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <LogOut size={14} />
              ログアウト
            </button>
          </footer>
        </>
      )}
    </main>
  );
}
