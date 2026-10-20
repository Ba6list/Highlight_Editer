import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  Archive,
  Clapperboard,
  Film,
  Folder,
  HardDrive,
  Image,
  LayoutDashboard,
  LogOut,
  Plus,
  Radio,
  Settings,
  Shield,
  Video,
  ExternalLink,
  RefreshCw,
  Check,
  AlertCircle,
  Search,
  Copy,
  Trash2,
  Download,
  Menu,
  X,
} from "lucide-react";
import type { Clip, Playlist, State, Session } from "./types";
import {
  api,
  post,
  setCsrf,
  ApiError,
  media,
  frame,
  time,
  date,
  bytes,
  states,
} from "./api";
import Editor from "./Editor";
import ExtensionPanel from "./ExtensionPanel";
const nav = [
  ["dashboard", "概要", LayoutDashboard],
  ["capture", "クリップを保存", Video],
  ["clips", "クリップ一覧", Film],
  ["playlists", "再生リスト", Clapperboard],
  ["archive", "アーカイブ", Archive],
  ["storage", "ストレージ", HardDrive],
  ["frames", "PNGフレーム", Image],
  ["settings", "システム設定", Settings],
] as const;
const labels: Record<string, string> = {
  dashboard: "DASHBOARD",
  capture: "CAPTURE",
  clips: "CLIPS",
  playlists: "PLAYLISTS",
  editor: "EDITOR",
  archive: "ARCHIVE",
  storage: "STORAGE",
  frames: "FRAMES",
  settings: "SYSTEM SETTINGS",
};
const durations = [1, 3, 7, 14, 21, 30];
const dayName = (d: number) =>
  ({
    1: "1日",
    3: "3日",
    7: "1週間",
    14: "2週間",
    21: "3週間",
    30: "1ヶ月（30日）",
  })[d] || `${d}日`;
function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div className={"notice " + (error ? "error" : "")}>
      <AlertCircle size={16} />
      {children}
    </div>
  );
}
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [state, setState] = useState<State | null>(null);
  const [page, setPage] = useState(
    location.hash.slice(1).split("?")[0] || "dashboard",
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [connectionError, setConnectionError] = useState(false);
  const [editorId, setEditorId] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [dialog, setDialog] = useState<{
    title: string;
    description: string;
    admin: boolean;
    run: (pin: string) => Promise<void>;
  } | null>(null);
  const [pin, setPin] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [preview, setPreview] = useState<Clip | null>(null);
  const [live, setLive] = useState<{
    connected: boolean;
    live: boolean;
    title?: string;
  } | null>(null);
  const polling = useRef(false);
  function notify(m: string) {
    setMessage(m);
  }
  async function refresh() {
    try {
      setState(await api<State>("/state"));
      setConnectionError(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setSession(null);
        setCsrf("");
      } else setConnectionError(true);
    }
  }
  useEffect(() => {
    api<Session>("/session")
      .then((s) => {
        setSession(s);
        setCsrf(s.csrf);
      })
      .catch(() => {})
      .finally(() => setAuthLoading(false));
  }, []);
  useEffect(() => {
    if (!session) return;
    void refresh();
    const t = setInterval(() => {
      if (document.hidden || polling.current) return;
      polling.current = true;
      void refresh().finally(() => {
        polling.current = false;
      });
    }, 10000);
    return () => clearInterval(t);
  }, [session]);
  useEffect(() => {
    if (!session) return;
    async function check() {
      try {
        setLive(await api("/live"));
      } catch {
        setLive(null);
      }
    }
    void check();
    const t = setInterval(check, 60000);
    return () => clearInterval(t);
  }, [session]);
  useEffect(() => {
    const f = () => {
      setPage(location.hash.slice(1).split("?")[0] || "dashboard");
      setMenu(false);
    };
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(""), 6500);
    return () => clearTimeout(t);
  }, [message]);
  function confirm(
    title: string,
    description: string,
    run: (pin: string) => Promise<void>,
    admin = false,
  ) {
    setDialog({ title, description, run, admin });
    setPin("");
    setDialogError("");
  }
  async function action(run: () => Promise<unknown>, success?: string) {
    if (busy) return;
    setBusy(true);
    try {
      await run();
      if (success) notify(success);
      await refresh();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const openEditor = (id: string) => {
    setEditorId(id);
    location.hash = "editor";
    setPage("editor");
  };
  async function newPlaylist() {
    await action(async () => {
      const p = await post<{ id: string }>("/playlists", {
        title: "ハイライト " + new Date().toLocaleDateString("ja-JP"),
      });
      await refresh();
      openEditor(p.id);
    });
  }
  if (authLoading)
    return (
      <div className="login-wrap">
        <p className="muted">読み込み中…</p>
      </div>
    );
  if (!session)
    return (
      <Login
        onLogin={(s) => {
          setSession(s);
          setCsrf(s.csrf);
        }}
      />
    );
  const p = state?.playlists.find((x) => x.id === editorId);
  return (
    <div className="app-shell">
      <aside className={"sidebar " + (menu ? "mobile-open" : "")}>
        <a href="#dashboard" className="brand">
          <div className="brand-mark">N</div>
          <div>
            NOBORI<small>HIGHLIGHT STUDIO</small>
          </div>
        </a>
        <div className="workspace-label">TOURNAMENT WORKSPACE</div>
        <nav>
          {nav.map(([key, title, Icon]) => (
            <a
              key={key}
              href={"#" + key}
              className={
                page === key || (page === "editor" && key === "playlists")
                  ? "active"
                  : ""
              }
            >
              <Icon size={18} />
              {title}
              {key === "clips" && state && (
                <span className="nav-count">
                  {state.clips.filter((c) => c.status === "ready").length}
                </span>
              )}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="staff-avatar">{session.name.slice(0, 1)}</div>
          <div>
            {session.name}
            <small>スタッフ・共通ログイン</small>
          </div>
          <button
            aria-label="ログアウト"
            onClick={() =>
              void action(async () => {
                await post("/logout");
                setSession(null);
                setState(null);
              })
            }
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <button
            className="mobile-menu"
            aria-label="メニューを開く"
            onClick={() => setMenu(!menu)}
          >
            <Menu size={20} />
          </button>
          <span>
            WORKSPACE <span className="divider">/</span>{" "}
            {labels[page] || labels.dashboard}
          </span>
          <div className="topbar-right">
            <span className={"live-indicator " + (live?.live ? "online" : "")}>
              <i />
              {live?.live
                ? "配信中"
                : live?.connected
                  ? "オフライン"
                  : live === null
                    ? "接続確認中"
                    : "TWITCH 未接続"}
            </span>
            <a
              href="https://www.twitch.tv/nobori_official"
              target="_blank"
              rel="noreferrer"
            >
              公式配信
              <ExternalLink size={13} />
            </a>
          </div>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">NOBORI / HIGHLIGHT STUDIO</p>
              <h1>
                {page === "editor"
                  ? "ハイライトを編集"
                  : nav.find((x) => x[0] === page)?.[1] || "概要"}
              </h1>
              <p className="muted">
                {page === "dashboard"
                  ? "最高のプレーを、次のインターバルへ。"
                  : page === "capture"
                    ? "プレーを見つけたら保存。編集スタッフへ自動で引き継ぎます。"
                    : page === "editor"
                      ? "必要なシーンだけを選び、配信する順番に。"
                      : page === "clips"
                        ? "保存した素材を確認して、ハイライトに仕上げます。"
                        : "大会スタッフで共有するワークスペース"}
              </p>
            </div>
            {["dashboard", "clips", "playlists"].includes(page) && (
              <button
                className="primary"
                onClick={() => void newPlaylist()}
                disabled={busy}
              >
                <Plus size={16} />
                再生リストを作成
              </button>
            )}
          </div>
          {connectionError && (
            <Notice error>
              サーバーに接続できません。表示は前回取得時の内容です。
              <button onClick={() => void refresh()}>再接続</button>
            </Notice>
          )}
          {!state ? (
            <div className="panel empty">
              <RefreshCw size={28} />
              <p>ワークスペースを読み込み中</p>
            </div>
          ) : (
            <>
              {page === "dashboard" && (
                <Dashboard
                  state={state}
                  openEditor={openEditor}
                  newPlaylist={newPlaylist}
                  setPreview={setPreview}
                  live={live}
                />
              )}
              {page === "capture" && (
                <Capture
                  clips={state.clips}
                  connected={
                    !!state.connections.find((x) => x.provider === "twitch")
                  }
                  live={live?.live || false}
                  action={action}
                  refresh={refresh}
                />
              )}
              {(page === "clips" || page === "archive") && (
                <Clips
                  state={state}
                  archived={page === "archive"}
                  busy={busy}
                  action={action}
                  confirm={confirm}
                  setPreview={setPreview}
                  openEditor={openEditor}
                  refresh={refresh}
                />
              )}
              {page === "playlists" && (
                <Playlists
                  state={state}
                  openEditor={openEditor}
                  action={action}
                  confirm={confirm}
                />
              )}
              {page === "editor" &&
                (p ? (
                  <Editor
                    key={p.id}
                    playlist={p}
                    clips={state.clips}
                    frames={state.frames}
                    onChange={refresh}
                    notify={notify}
                  />
                ) : (
                  <div className="panel empty">
                    <Clapperboard size={32} />
                    <p>編集する再生リストを選択してください</p>
                    <a href="#playlists" className="button primary">
                      再生リストを開く
                    </a>
                  </div>
                ))}
              {page === "storage" && (
                <Storage
                  state={state}
                  busy={busy}
                  confirm={confirm}
                  refresh={refresh}
                />
              )}
              {page === "frames" && (
                <Frames state={state} confirm={confirm} refresh={refresh} />
              )}
              {page === "settings" && (
                <SettingsPage
                  state={state}
                  confirm={confirm}
                  refresh={refresh}
                  notify={notify}
                />
              )}
            </>
          )}
        </div>
        <footer>
          NOBORI HIGHLIGHT STUDIO{" "}
          <span>素材と公開映像を、ひとつの場所で。</span>
        </footer>
      </main>
      {message && (
        <div role="status" className="toast">
          <Check size={17} />
          {message}
        </div>
      )}
      {dialog && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!busy) setDialog(null);
          }}
        >
          <form
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              setDialogError("");
              try {
                await dialog.run(pin);
                setDialog(null);
                await refresh();
              } catch (error) {
                setDialogError((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="section-line">
              <h2>{dialog.title}</h2>
              <button
                type="button"
                aria-label="閉じる"
                onClick={() => setDialog(null)}
                disabled={busy}
              >
                <X size={17} />
              </button>
            </div>
            <p className="muted">{dialog.description}</p>
            {dialog.admin && (
              <label>
                管理者PIN
                <input
                  autoFocus
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  required
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                />
              </label>
            )}
            {dialogError && (
              <p role="alert" className="error-text">
                {dialogError}
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                onClick={() => setDialog(null)}
                disabled={busy}
              >
                キャンセル
              </button>
              <button className="primary" disabled={busy}>
                {busy ? "処理中…" : "実行する"}
              </button>
            </div>
          </form>
        </div>
      )}
      {preview && (
        <div className="modal-backdrop" onClick={() => setPreview(null)}>
          <div
            className="modal video-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="section-line">
              <h2>{preview.title}</h2>
              <button aria-label="閉じる" onClick={() => setPreview(null)}>
                <X size={18} />
              </button>
            </div>
            {preview.status === "ready" ? (
              <video src={media(preview.id)} controls autoPlay playsInline />
            ) : (
              <p className="muted">プレビューにはR2への復元が必要です。</p>
            )}
            <p className="muted">
              {time(preview.duration)} · {date(preview.created)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [password, setPassword] = useState(""),
    [name, setName] = useState(localStorage.getItem("nobori-name") || ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand">
          <div className="brand-mark">N</div>
          <div>
            NOBORI<small>HIGHLIGHT STUDIO</small>
          </div>
        </div>
        <p className="eyebrow">STAFF WORKSPACE</p>
        <h1>
          大会のプレーを、
          <br />
          ハイライトへ。
        </h1>
        <p className="muted">スタッフ共通パスワードでログインしてください。</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const s = await post<Session>("/login", { password, name });
              localStorage.setItem("nobori-name", name);
              onLogin(s);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            表示名 <span className="muted">任意</span>
            <input
              value={name}
              maxLength={40}
              placeholder="例：配信スタッフ"
              onChange={(e) => setName(e.target.value)}
              autoComplete="nickname"
            />
          </label>
          <label>
            共通パスワード
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <button className="primary login-submit" disabled={busy}>
            {busy ? "確認中…" : "ワークスペースに入る"}
            <span>→</span>
          </button>
        </form>
        <div className="login-note">
          <Shield size={14} />
          個別アカウントの登録は不要です
        </div>
      </div>
    </div>
  );
}
function Dashboard({
  state: s,
  openEditor,
  newPlaylist,
  setPreview,
  live,
}: {
  state: State;
  openEditor: (id: string) => void;
  newPlaylist: () => Promise<void>;
  setPreview: (c: Clip) => void;
  live: { live: boolean; title?: string } | null;
}) {
  const ready = s.clips.filter((c) => c.status === "ready"),
    pending = s.clips.filter(
      (c) => c.edit_status === "pending" && c.status === "ready",
    );
  const p = s.playlists.find((p) => p.id === s.publication?.playlist_id);
  return (
    <>
      <div className="stats-grid">
        <Stat
          label="使用できるクリップ"
          value={String(s.counts.ready || 0)}
          sub={`${s.counts.pending || 0} 本が編集待ち`}
          icon={<Film size={18} />}
        />
        <Stat
          label="再生リスト"
          value={String(s.playlists.length)}
          sub={p ? "1件をOBSに公開中" : "公開中の再生リストなし"}
          icon={<Clapperboard size={18} />}
        />
        <Stat
          label="R2 保存容量"
          value={bytes(s.bytes)}
          sub={`取り込み上限 ${bytes(s.limit)}`}
          icon={<HardDrive size={18} />}
        />
        <Stat
          label="アーカイブ済み"
          value={String(s.counts.archived || 0)}
          sub={`保存期間 ${dayName(s.retention)}`}
          icon={<Archive size={18} />}
        />
      </div>
      <div className="dashboard-grid">
        <section className="panel broadcast-panel">
          <div className="section-line">
            <p className="eyebrow">ON AIR / HIGHLIGHTS</p>
            <span className={"pill " + (p ? "teal" : "")}>
              {p ? "公開中" : "未公開"}
            </span>
          </div>
          <div className="broadcast-empty">
            <Radio size={32} />
            <h2>{p?.title || "次のハイライトを準備しましょう"}</h2>
            <p className="muted">
              {p
                ? "公開済みの内容がOBSプレーヤーに反映されています。"
                : "クリップを選んで再生リストを作成し、完成したら公開します。"}
            </p>
            {p ? (
              <button onClick={() => openEditor(p.id)}>
                再生リストを編集 →
              </button>
            ) : (
              <button className="primary" onClick={() => void newPlaylist()}>
                <Plus size={16} />
                再生リストを作成
              </button>
            )}
          </div>
          <div className="broadcast-status">
            <span>
              <i className={s.playbackActive ? "dot teal-dot" : "dot"} />
              OBS {s.playbackActive ? "プレーヤー接続あり" : "接続待ち"}
            </span>
            <span className="muted">
              {s.publication
                ? "公開 " + date(s.publication.published)
                : "公開操作で映像を反映"}
            </span>
          </div>
        </section>
        <section className="panel quick-capture">
          <p className="eyebrow">CAPTURE</p>
          <h2>そのプレーを残す。</h2>
          <p className="muted">
            公式Twitchの映像を最大60秒のクリップとして保存。必要なシーンを後から選べます。
          </p>
          <a href="#capture" className="button primary">
            <Video size={18} />
            クリップを保存する →
          </a>
          <div className="capture-channel">
            <span className={"dot " + (live?.live ? "teal-dot" : "")} />
            <span>nobori_official</span>
            <small>{live?.live ? "配信中" : "配信状態を確認"}</small>
          </div>
        </section>
      </div>
      <div className="section-line section-gap">
        <h2>最新のクリップ</h2>
        <a href="#clips">すべて見る →</a>
      </div>
      {s.clips.length ? (
        <div className="clip-grid">
          {s.clips.slice(0, 4).map((c) => (
            <ClipCard key={c.id} clip={c} onPreview={() => setPreview(c)} />
          ))}
        </div>
      ) : (
        <Empty
          icon={<Film size={28} />}
          title="クリップはまだありません"
          detail="Twitchを接続し、配信中にSAVE CLIPを押してください。"
        />
      )}
      {!s.connections.length && (
        <Notice>
          初期設定：システム設定からTwitchとGoogle Driveを接続してください。
          <a href="#settings">設定を開く →</a>
        </Notice>
      )}
    </>
  );
}
function Stat({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub: string;
  icon: ReactNode;
}) {
  return (
    <div className="panel stat">
      <div>
        {label}
        {icon}
      </div>
      <strong>{value}</strong>
      <span>{sub}</span>
    </div>
  );
}
function Empty({
  icon,
  title,
  detail,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="panel empty">
      {icon}
      <h3>{title}</h3>
      <p className="muted">{detail}</p>
    </div>
  );
}
function ClipCard({
  clip: c,
  onPreview,
  children,
}: {
  clip: Clip;
  onPreview: () => void;
  children?: ReactNode;
}) {
  return (
    <article className="clip-card">
      <button
        className="thumbnail"
        onClick={onPreview}
        disabled={c.status !== "ready"}
      >
        {c.thumbnail ? (
          <img src={c.thumbnail} alt="" loading="lazy" />
        ) : (
          <div className="thumbnail-placeholder">
            <Film size={27} />
            <span>NOBORI</span>
          </div>
        )}
        <span className="duration mono">{time(c.duration)}</span>
        <span className={"clip-state " + (c.status === "ready" ? "teal" : "")}>
          {states[c.status] || c.status}
        </span>
      </button>
      <div className="clip-card-body">
        <h3>{c.title}</h3>
        <div className="clip-meta">
          <span>{date(c.created)}</span>
          <span>{c.edit_status === "edited" ? "編集済み" : "編集待ち"}</span>
        </div>
        <div className="clip-meta">
          <span>
            {c.status === "archived" ? "Google Drive" : "R2 / 一時保存"}
          </span>
          <span>
            {c.status === "archived"
              ? "保存済み"
              : `${Math.max(0, Math.ceil((c.archive_at - Date.now()) / 86400000))}日後に転送`}
          </span>
        </div>
        {JSON.parse(c.tags).length > 0 && (
          <div className="tags">
            {JSON.parse(c.tags).map((tag: string) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        )}
        {c.error && <p className="error-text">{c.error}</p>}
        {children}
      </div>
    </article>
  );
}
function Capture({
  clips,
  connected,
  live,
  action,
  refresh,
}: {
  clips: Clip[];
  connected: boolean;
  live: boolean;
  action: (fn: () => Promise<unknown>, msg?: string) => Promise<void>;
  refresh: () => Promise<void>;
}) {
  const [duration, setDuration] = useState(60),
    [title, setTitle] = useState(""),
    [capturing, setCapturing] = useState(false),
    [error, setError] = useState("");
  const request = useRef<string | null>(
    sessionStorage.getItem("nobori-pending-capture"),
  );
  const lock = useRef(false);
  useEffect(() => {
    const waiting = clips.filter((c) =>
      ["requested", "generating", "downloading", "storing", "retry"].includes(
        c.status,
      ),
    );
    if (!waiting.length) return;
    const t = setInterval(() => {
      for (const c of waiting.slice(0, 2))
        void post("/clips/" + c.id + "/process")
          .then(refresh)
          .catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, [clips]);
  return (
    <>
      <div className="capture-layout">
        <section className="panel capture-panel">
          <div className="section-line">
            <span className="eyebrow">TWITCH / NOBORI_OFFICIAL</span>
            <span className={"pill " + (live ? "teal" : "")}>
              {live ? "配信中" : connected ? "配信確認待ち" : "未接続"}
            </span>
          </div>
          <h2>スーパープレーを保存</h2>
          <p className="muted">
            ボタンを押した時点付近の映像を取得します。
            <br />
            視聴側の配信遅延によって、必要なプレーの位置は前後します。
          </p>
          <button
            className="save-clip"
            disabled={!connected || capturing}
            onClick={async () => {
              if (lock.current) return;
              lock.current = true;
              setCapturing(true);
              setError("");
              request.current ??= crypto.randomUUID();
              sessionStorage.setItem("nobori-pending-capture", request.current);
              try {
                await post("/clips", {
                  requestKey: request.current,
                  title:
                    title.trim() ||
                    "NOBORI Highlight " +
                      new Date().toLocaleTimeString("ja-JP"),
                  duration,
                });
                request.current = null;
                sessionStorage.removeItem("nobori-pending-capture");
                setTitle("");
                await refresh();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setTimeout(() => {
                  lock.current = false;
                  setCapturing(false);
                }, 1500);
              }
            }}
          >
            <Video size={34} />
            <strong>{capturing ? "REQUESTING…" : "SAVE CLIP"}</strong>
            <span>
              {capturing ? "受付中" : "最大 " + duration + " 秒の素材を保存"}
            </span>
          </button>
          {error && (
            <Notice error>{error} 同じリクエストで再試行できます。</Notice>
          )}
          <div className="capture-options">
            <label>
              取得する長さ
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              >
                <option value={60}>最大60秒（おすすめ）</option>
                <option value={30}>最大30秒</option>
              </select>
            </label>
            <label>
              タイトル（任意）
              <input
                value={title}
                maxLength={160}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例：第2試合 / 決勝ラウンド"
              />
            </label>
          </div>
          <p className="muted small">
            保存要求は重複しないよう保護しています。受付後は次のプレーを続けて保存できます。
          </p>
        </section>
        <section className="panel">
          <p className="eyebrow">CAPTURE QUEUE</p>
          <h3>最近の保存状況</h3>
          {clips.slice(0, 8).map((c) => (
            <div className="queue-row" key={c.id}>
              <span
                className={"dot " + (c.status === "ready" ? "teal-dot" : "")}
              />
              <div>
                <strong>{c.title}</strong>
                <small>
                  {states[c.status]} · {date(c.created)}
                </small>
                {c.error && <small className="error-text">{c.error}</small>}
              </div>
              {c.error && (
                <button
                  onClick={() =>
                    void action(
                      () => post("/clips/" + c.id + "/retry"),
                      "再試行を受け付けました",
                    )
                  }
                >
                  <RefreshCw size={14} />
                </button>
              )}
            </div>
          ))}
          {!clips.length && <p className="muted">保存要求はまだありません。</p>}
        </section>
      </div>
      {!connected && (
        <Notice>
          Twitchの初回接続は管理者がシステム設定で行います。スタッフ個別のTwitchログインは不要です。
          <a href="#settings">接続設定 →</a>
        </Notice>
      )}
    </>
  );
}
function Clips({
  state: s,
  archived,
  busy,
  action,
  confirm,
  setPreview,
  openEditor,
  refresh,
}: {
  state: State;
  archived: boolean;
  busy: boolean;
  action: Action;
  confirm: Confirm;
  setPreview: (c: Clip) => void;
  openEditor: (id: string) => void;
  refresh: () => Promise<void>;
}) {
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState(
      new URLSearchParams(location.hash.split("?")[1] || "").get("filter") ||
        "all",
    ),
    [sort, setSort] = useState("new"),
    [editing, setEditing] = useState<Clip | null>(null),
    [title, setTitle] = useState(""),
    [tags, setTags] = useState("");
  const [days, setDays] = useState(0);
  const [page, setListPage] = useState(1),
    [total, setTotal] = useState(0),
    [list, setList] = useState<Clip[]>([]),
    [loading, setLoading] = useState(true),
    [fetchError, setFetchError] = useState("");
  useEffect(() => setListPage(1), [search, filter, sort, archived]);
  useEffect(() => {
    let current = true;
    setLoading(true);
    const timer = setTimeout(() => {
      const query = new URLSearchParams({
        search,
        filter,
        sort,
        archived: archived ? "1" : "0",
        page: String(page),
      });
      api<{ clips: Clip[]; total: number }>("/clips?" + query)
        .then((result) => {
          if (current) {
            setList(result.clips);
            setTotal(result.total);
            setFetchError("");
          }
        })
        .catch((e) => {
          if (current) setFetchError((e as Error).message);
        })
        .finally(() => {
          if (current) setLoading(false);
        });
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [search, filter, sort, archived, page, s.clips]);
  return (
    <>
      <div className="filters">
        <div className="search">
          <Search size={17} />
          <input
            aria-label="クリップを検索"
            placeholder="タイトル・タグを検索"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          aria-label="状態で絞り込み"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">すべて</option>
          <option value="pending">編集待ち</option>
          <option value="edited">編集済み</option>
          <option value="archived">アーカイブ済み</option>
          <option value="error">エラー</option>
          <option value="due">アーカイブ期限超過・転送中</option>
        </select>
        <select
          aria-label="並び順"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="new">新しい順</option>
          <option value="old">古い順</option>
        </select>
        <span className="muted">{total} CLIPS</span>
      </div>
      {fetchError && <Notice error>{fetchError}</Notice>}
      {loading && !list.length ? (
        <p className="muted">読み込み中…</p>
      ) : list.length ? (
        <div className="clip-grid">
          {list.map((c) => (
            <ClipCard key={c.id} clip={c} onPreview={() => setPreview(c)}>
              <div className="clip-actions">
                <button
                  onClick={() => {
                    setEditing(c);
                    setTitle(c.title);
                    setTags(JSON.parse(c.tags).join(", "));
                    setDays(0);
                  }}
                >
                  詳細・変更
                </button>
                {c.status === "ready" && (
                  <button
                    onClick={() =>
                      void action(async () => {
                        const p = await post<{ id: string }>("/playlists", {
                          title: c.title,
                          draft: {
                            items: [
                              {
                                id: crypto.randomUUID(),
                                clipId: c.id,
                                start: Math.max(0, c.duration - 30),
                                end: c.duration,
                                frameId: null,
                              },
                            ],
                            loop: false,
                            endBehavior: "black",
                          },
                        });
                        await refresh();
                        openEditor(p.id);
                      })
                    }
                  >
                    編集する →
                  </button>
                )}
                {c.status === "archived" && (
                  <button
                    onClick={() =>
                      void action(
                        () => post("/clips/" + c.id + "/restore"),
                        "復元を開始しました（R2に24時間保存）",
                      )
                    }
                  >
                    <Download size={14} />
                    復元する
                  </button>
                )}
              </div>
            </ClipCard>
          ))}
        </div>
      ) : (
        <Empty
          icon={<Archive size={28} />}
          title={
            archived
              ? "アーカイブはまだありません"
              : "該当するクリップがありません"
          }
          detail={
            archived
              ? "保存期限を迎えるとGoogle Driveへ自動転送します。"
              : "検索条件を変えるか、CAPTUREから素材を保存してください。"
          }
        />
      )}
      {total > 48 && (
        <div className="pagination">
          <button
            disabled={page === 1 || loading}
            onClick={() => setListPage(page - 1)}
          >
            前へ
          </button>
          <span>
            {page} / {Math.ceil(total / 48)}
          </span>
          <button
            disabled={page >= Math.ceil(total / 48) || loading}
            onClick={() => setListPage(page + 1)}
          >
            次へ
          </button>
        </div>
      )}
      {editing && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="section-line">
              <h2>クリップの詳細</h2>
              <button aria-label="閉じる" onClick={() => setEditing(null)}>
                <X size={18} />
              </button>
            </div>
            <label>
              タイトル
              <input
                value={title}
                maxLength={160}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              タグ（カンマ区切り）
              <input value={tags} onChange={(e) => setTags(e.target.value)} />
            </label>
            <label>
              アーカイブ期限の変更（管理者PINが必要）
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              >
                <option value={0}>現在の期限を維持</option>
                {durations.map((d) => (
                  <option key={d} value={d}>
                    {dayName(d)}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted">
              予定日時：
              {date(
                days ? editing.created + days * 86400000 : editing.archive_at,
              )}
              （作成日時から起算）
            </p>
            <p className="muted">
              状態：{states[editing.status]}
              <br />
              最終更新：{date(editing.updated)}
            </p>
            {editing.error && <Notice error>{editing.error}</Notice>}
            <div className="modal-actions">
              <button
                className="primary"
                disabled={busy}
                onClick={() => {
                  const data = {
                    title,
                    tags: tags
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                    updated: editing.updated,
                    ...(days ? { retention: days } : {}),
                  };
                  if (days)
                    confirm(
                      "個別の保存期限を変更",
                      "新しい予定日時：" +
                        date(editing.created + days * 86400000),
                      async (pin) => {
                        await api(
                          "/clips/" + editing.id,
                          { method: "PUT", body: JSON.stringify(data) },
                          pin,
                        );
                        setEditing(null);
                      },
                      true,
                    );
                  else
                    void action(async () => {
                      await api("/clips/" + editing.id, {
                        method: "PUT",
                        body: JSON.stringify(data),
                      });
                      setEditing(null);
                    }, "変更を保存しました");
                }}
              >
                変更を保存
              </button>
            </div>
            <hr />
            <div className="row-actions wrap">
              {editing.status === "ready" && (
                <button
                  onClick={() =>
                    confirm(
                      "今すぐアーカイブ",
                      "Driveへの保存確認後にR2から削除します。公開中の素材は転送できません。",
                      async () => {
                        await post("/clips/" + editing.id + "/archive");
                        setEditing(null);
                      },
                    )
                  }
                >
                  手動アーカイブ
                </button>
              )}
              {editing.error && (
                <button
                  onClick={() =>
                    void action(async () => {
                      await post("/clips/" + editing.id + "/retry");
                      setEditing(null);
                    })
                  }
                >
                  再試行
                </button>
              )}
              <button
                className="danger"
                onClick={() =>
                  confirm(
                    "クリップを削除",
                    "R2の動画と管理情報を削除します。Google Driveの保存済みファイルは削除しません。再生リストで使用中の素材は削除できません。",
                    async () => {
                      await api("/clips/" + editing.id, { method: "DELETE" });
                      setEditing(null);
                    },
                  )
                }
              >
                <Trash2 size={14} />
                削除
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
type Action = (fn: () => Promise<unknown>, message?: string) => Promise<void>;
type Confirm = (
  title: string,
  description: string,
  run: (pin: string) => Promise<void>,
  admin?: boolean,
) => void;
function Playlists({
  state: s,
  openEditor,
  action,
  confirm,
}: {
  state: State;
  openEditor: (id: string) => void;
  action: Action;
  confirm: Confirm;
}) {
  return s.playlists.length ? (
    <div className="playlist-list">
      {s.playlists.map((p) => {
        const d = JSON.parse(p.draft);
        const published = s.publication?.playlist_id === p.id;
        return (
          <div className="panel playlist-row" key={p.id}>
            <div className="playlist-icon">
              <Clapperboard size={24} />
            </div>
            <div className="playlist-info">
              <h3>
                {p.title}{" "}
                {published && <span className="pill teal">公開中</span>}
              </h3>
              <p className="muted">
                {d.items.length} クリップ · 合計{" "}
                {time(
                  d.items.reduce((n: number, i: any) => n + i.end - i.start, 0),
                )}{" "}
                · 更新 {date(p.updated)}
              </p>
              {published && s.publication?.version !== p.version && (
                <small className="warning-text">
                  保存済みの変更はまだOBSに公開されていません
                </small>
              )}
            </div>
            <div className="row-actions wrap">
              <button className="primary" onClick={() => openEditor(p.id)}>
                編集する
              </button>
              <button
                aria-label="再生リストを複製"
                onClick={() =>
                  void action(
                    () => post("/playlists/" + p.id + "/duplicate"),
                    "再生リストを複製しました",
                  )
                }
              >
                <Copy size={16} />
              </button>
              {published && (
                <button
                  onClick={() =>
                    confirm(
                      "公開を停止",
                      "新規のOBS上映を停止します。すでに再生中の映像は終了まで保護します。",
                      async () => {
                        await post("/playlists/" + p.id + "/unpublish");
                      },
                    )
                  }
                >
                  公開停止
                </button>
              )}
              <button
                aria-label="再生リストを削除"
                onClick={() =>
                  confirm(
                    "再生リストを削除",
                    "素材の動画は残ります。公開中の場合は先に公開停止してください。",
                    async () => {
                      await api("/playlists/" + p.id, { method: "DELETE" });
                    },
                  )
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  ) : (
    <Empty
      icon={<Clapperboard size={30} />}
      title="最初の再生リストを作成"
      detail="クリップを追加し、再生範囲と順番を設定して公開します。"
    />
  );
}
function Storage({
  state: s,
  confirm,
  refresh,
}: {
  state: State;
  busy: boolean;
  confirm: Confirm;
  refresh: () => Promise<void>;
}) {
  const [days, setDays] = useState(s.retention),
    [existing, setExisting] = useState(false),
    [limit, setLimit] = useState(Math.round(s.limit / 1024 ** 3));
  const due = s.clips
    .filter((c) => c.status === "ready")
    .sort((a, b) => a.archive_at - b.archive_at);
  const waiting = s.clips.filter(
    (c) =>
      ["archiving", "restoring"].includes(c.status) ||
      (c.status === "ready" && c.archive_at <= Date.now()),
  );
  const errors = s.clips.filter((c) => c.error);
  return (
    <>
      <div className="stats-grid">
        <Stat
          label="R2 / 一時保存"
          value={bytes(s.bytes)}
          sub={`${s.counts.ready || 0} 本`}
          icon={<HardDrive size={18} />}
        />
        <Stat
          label="Drive / 保存済み"
          value={String(s.counts.archived || 0)}
          sub="管理情報に記録した本数"
          icon={<Archive size={18} />}
        />
        <Stat
          label="アーカイブ待ち"
          value={String(s.counts.due || 0)}
          sub="公開・上映中は保留"
          icon={<Activity size={18} />}
        />
        <Stat
          label="処理エラー"
          value={String(s.counts.errors || 0)}
          sub="元動画を保持して再試行"
          icon={<AlertCircle size={18} />}
        />
      </div>
      <div className="settings-grid">
        <section className="panel">
          <p className="eyebrow">RETENTION</p>
          <h2>自動アーカイブ</h2>
          <p className="muted">
            作成日時から設定期間が経過した素材をDriveへ転送します。
          </p>
          <label>
            R2の保存期間
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              {durations.map((d) => (
                <option key={d} value={d}>
                  {dayName(d)}
                </option>
              ))}
            </select>
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={existing}
              onChange={(e) => setExisting(e.target.checked)}
            />
            既存クリップにも適用する（個別期限をリセット）
          </label>
          <button
            className="primary"
            onClick={() =>
              confirm(
                "保存期間を変更",
                `${dayName(days)}に変更します。${existing ? "期限を過ぎる既存素材は転送対象になります。" : "今後のクリップに適用します。"}`,
                async (pin) => {
                  await post(
                    "/settings/retention",
                    { days, applyExisting: existing },
                    pin,
                  );
                  await refresh();
                },
                true,
              )
            }
          >
            管理者PINで変更
          </button>
        </section>
        <section className="panel">
          <p className="eyebrow">CAPACITY</p>
          <h2>保存容量と上限</h2>
          <div className="capacity-number">
            {bytes(s.bytes)} <small>/ {bytes(s.limit)}</small>
          </div>
          <div className="capacity-bar">
            <div
              style={{ width: Math.min(100, (s.bytes / s.limit) * 100) + "%" }}
            />
          </div>
          {s.bytes / s.limit > 0.8 && (
            <Notice error>
              取り込み上限に近づいています。使用済み素材をアーカイブしてください。
            </Notice>
          )}
          <label>
            取り込み停止の上限
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
            >
              {[1, 2, 4, 6, 8, 9].map((n) => (
                <option key={n} value={n}>
                  {n} GB
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() =>
              confirm(
                "取り込み上限を変更",
                "容量に加え処理中動画の予約枠を見積もって停止します。操作回数による課金はこの制限では防げません。",
                async (pin) => {
                  await post(
                    "/settings/storage",
                    { limitBytes: limit * 1024 ** 3 },
                    pin,
                  );
                },
                true,
              )
            }
          >
            上限を変更
          </button>
          <p className="muted small">
            R2は従量課金です。容量制限だけで0円を保証できません。
          </p>
          <a
            href="https://dash.cloudflare.com/"
            target="_blank"
            rel="noreferrer"
          >
            Cloudflareで実際の使用量を確認 <ExternalLink size={13} />
          </a>
        </section>
      </div>
      <section className="panel section-gap">
        <div className="section-line">
          <h3>保存容量の推移</h3>
          <span className="muted">R2動画 / 過去30日・UTC日付</span>
        </div>
        {s.history.length ? (
          <div className="history-chart">
            {[...s.history].reverse().map((x) => (
              <div key={x.day} title={`${x.day}: ${bytes(x.bytes)}`}>
                <div
                  className="history-bar"
                  style={{
                    height: Math.max(2, (x.bytes / s.limit) * 100) + "%",
                  }}
                />
                <small>{x.day.slice(5)}</small>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">稼働後、1時間ごとに容量を記録します。</p>
        )}
      </section>
      <section className="panel section-gap">
        <div className="section-line">
          <h3>次にアーカイブされる動画</h3>
          <a href="#clips?filter=due">期限超過・転送待ち一覧 →</a>
        </div>
        {due.slice(0, 5).map((c) => (
          <div key={c.id} className="table-row">
            <span>{c.title}</span>
            <span>{date(c.archive_at)}</span>
            <span className="muted">
              {s.protectedClipIds.includes(c.id) ? "使用中・保留" : "期限待ち"}
            </span>
          </div>
        ))}
        {!due.length && <p className="muted">対象動画がありません。</p>}
      </section>
      <section className="panel section-gap">
        <h3>転送履歴・進捗</h3>
        {s.transfers.map((t) => (
          <div className="table-row" key={t.id}>
            <span>
              {s.clips.find((c) => c.id === t.clip_id)?.title || t.clip_id}
            </span>
            <span>
              {t.status === "complete"
                ? "完了"
                : Math.round((t.offset / Math.max(1, t.bytes)) * 100) + "%"}
            </span>
            <span className={t.error ? "error-text" : "muted"}>
              {t.error || t.status}
            </span>
          </div>
        ))}
        {!s.transfers.length && <p className="muted">転送履歴がありません。</p>}
      </section>
    </>
  );
}
function Frames({
  state: s,
  confirm,
  refresh,
}: {
  state: State;
  confirm: Confirm;
  refresh: () => Promise<void>;
}) {
  return (
    <>
      <Notice>
        フレーム未登録でも編集・OBS上映を利用できます。新しいPNGは別素材として保存され、公開済み映像へ自動で差し替わりません。
      </Notice>
      <section className="panel">
        <p className="eyebrow">PNG OVERLAY</p>
        <h2>透過フレームを追加</h2>
        <p className="muted">
          PNG形式 / 5MB以内 /
          推奨1920×1080px。編集画面で素材ごとに表示・非表示を選択できます。
        </p>
        <label className="upload-box">
          <Image size={26} />
          <span>PNGファイルを選択</span>
          <input
            type="file"
            accept="image/png"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              e.target.value = "";
              confirm(
                "PNGフレームを追加",
                `${file.name} をアップロードします。既存の公開内容は変わりません。`,
                async (pin) => {
                  const res = await api<{ width: number; height: number }>(
                    "/frames",
                    {
                      method: "POST",
                      body: file,
                      headers: {
                        "Content-Type": "image/png",
                        "X-File-Name": encodeURIComponent(file.name),
                      },
                    },
                    pin,
                  );
                  await refresh();
                  if (res.width !== 1920 || res.height !== 1080)
                    alert(
                      "登録できました。推奨サイズ1920×1080pxとは異なります。",
                    );
                },
                true,
              );
            }}
          />
        </label>
      </section>
      {s.frames.length ? (
        <div className="frame-grid section-gap">
          {s.frames.map((f) => (
            <article key={f.id} className="panel">
              <div className="checkerboard">
                <img src={frame(f.id)} alt={f.name} />
              </div>
              <h3>{f.name}</h3>
              <p className="muted">
                {f.width} × {f.height}px · {(f.bytes / 1024 ** 2).toFixed(2)} MB
              </p>
              <button
                onClick={() =>
                  confirm(
                    "フレームを削除",
                    "使用中のフレームは削除できません。先に編集画面でフレームを外して保存・公開してください。",
                    async (pin) => {
                      await api("/frames/" + f.id, { method: "DELETE" }, pin);
                    },
                    true,
                  )
                }
              >
                <Trash2 size={15} />
                削除する
              </button>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          icon={<Image size={28} />}
          title="フレーム未登録"
          detail="制作済みの透過PNGを後から追加してください。"
        />
      )}
    </>
  );
}
function SettingsPage({
  state: s,
  confirm,
  refresh,
  notify,
}: {
  state: State;
  confirm: Confirm;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [url, setUrl] = useState(""),
    [password, setPassword] = useState(""),
    [newPin, setNewPin] = useState("");
  return (
    <>
      <div className="settings-grid">
        {(["twitch", "google"] as const).map((provider) => {
          const connected = s.connections.find((c) => c.provider === provider);
          return (
            <section className="panel" key={provider}>
              <div className="section-line">
                <p className="eyebrow">
                  {provider === "twitch" ? "TWITCH" : "GOOGLE DRIVE"}
                </p>
                <span className={"pill " + (connected ? "teal" : "")}>
                  {connected ? "接続済み" : "未接続"}
                </span>
              </div>
              <h2>
                {provider === "twitch"
                  ? "配信のクリップ収集"
                  : "動画の長期保存"}
              </h2>
              <p className="muted">
                {provider === "twitch"
                  ? "nobori_officialの管理者で一度接続します。作成・動画取得に必要な権限のみ要求します。"
                  : "動画の保存に使うGoogleアカウントで接続します。本アプリが作成したファイルだけを操作する権限を使います。"}
              </p>
              <button
                className="primary"
                onClick={() =>
                  confirm(
                    provider === "twitch"
                      ? "Twitchを接続"
                      : "Google Driveを接続",
                    "外部サービスの認証画面へ移動します。Client IDとSecretの初期設定が必要です。",
                    async (pin) => {
                      const result = await post<{ url: string }>(
                        "/oauth/" + provider + "/start",
                        {},
                        pin,
                      );
                      location.assign(result.url);
                    },
                    true,
                  )
                }
              >
                <ExternalLink size={15} />
                {connected ? "再接続" : "接続する"}
              </button>
              {connected && (
                <button
                  className="danger"
                  onClick={() =>
                    confirm(
                      "接続を解除",
                      "自動取り込み・転送が止まります。保存済み動画は削除しません。",
                      async (pin) => {
                        await post(
                          "/oauth/" + provider + "/disconnect",
                          {},
                          pin,
                        );
                      },
                      true,
                    )
                  }
                >
                  解除
                </button>
              )}
            </section>
          );
        })}
      </div>
      <ExtensionPanel notify={notify} />
      <section className="panel section-gap">
        <p className="eyebrow">OBS BROWSER SOURCE</p>
        <h2>OBSプレーヤー</h2>
        <p className="muted">
          幅1920・高さ1080でブラウザソースを追加。下の専用URLを登録します。「表示されていないときにソースをシャットダウン」と「シーンがアクティブになったときにブラウザの表示を更新」を有効にしてください。
        </p>
        <div className="row-actions wrap">
          <button
            className="primary"
            onClick={() =>
              confirm(
                "OBS用URLを発行",
                "読み取り専用URLです。配信スタッフだけに共有してください。管理操作には使えません。",
                async (pin) => {
                  const r = await post<{ url: string }>(
                    "/player-token",
                    {},
                    pin,
                  );
                  setUrl(r.url);
                },
                true,
              )
            }
          >
            専用URLを発行
          </button>
          <button
            onClick={() =>
              confirm(
                "再生トークンを失効・再発行",
                "現在のOBS用URLは使えなくなります。OBSのURLも更新してください。",
                async (pin) => {
                  const r = await post<{ url: string }>(
                    "/player-token",
                    { revoke: true },
                    pin,
                  );
                  setUrl(r.url);
                },
                true,
              )
            }
          >
            失効して再発行
          </button>
          <span className="muted">
            OBS {s.playbackActive ? "接続あり" : "接続待ち"}
          </span>
        </div>
        {url && (
          <div className="player-url">
            <input aria-label="OBS用URL" readOnly value={url} />
            <button
              onClick={() =>
                void navigator.clipboard
                  .writeText(url)
                  .then(() => notify("URLをコピーしました"))
                  .catch(() => notify("URL欄からコピーしてください"))
              }
            >
              <Copy size={15} />
              コピー
            </button>
            <a href={url + "&debug=1"} target="_blank" rel="noreferrer">
              テスト再生 <ExternalLink size={13} />
            </a>
          </div>
        )}
      </section>
      <section className="panel section-gap">
        <p className="eyebrow">SECURITY</p>
        <h2>パスワード・PIN</h2>
        <div className="settings-grid">
          <label>
            新しい共通パスワード（12文字以上）
            <input
              type="password"
              value={password}
              minLength={12}
              maxLength={256}
              autoComplete="new-password"
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label>
            新しい管理者PIN（数字6〜12桁）
            <input
              type="password"
              inputMode="numeric"
              value={newPin}
              autoComplete="new-password"
              onChange={(e) => setNewPin(e.target.value)}
            />
          </label>
        </div>
        <div className="row-actions wrap">
          <button
            disabled={!password && !newPin}
            onClick={() =>
              confirm(
                "認証情報を変更",
                "現在の管理者PINで確認します。共通パスワードを変更すると全スタッフがログアウトします。",
                async (pin) => {
                  await post(
                    "/security",
                    {
                      ...(password ? { password } : {}),
                      ...(newPin ? { pin: newPin } : {}),
                    },
                    pin,
                  );
                  setPassword("");
                  setNewPin("");
                  await refresh();
                },
                true,
              )
            }
          >
            変更する
          </button>
          <button
            onClick={() =>
              confirm(
                "全セッションを失効",
                "あなたを含む全スタッフがログアウトします。OBS専用トークンは別管理です。",
                async (pin) => {
                  await post("/security", { revoke: true }, pin);
                },
                true,
              )
            }
          >
            全スタッフをログアウト
          </button>
        </div>
      </section>
      <section className="panel section-gap">
        <h3>操作ログ</h3>
        <p className="muted">
          表示名は任意です。スタッフ本人を証明する情報ではありません。90日間保存します。
        </p>
        {s.audit.slice(0, 20).map((l, i) => (
          <div className="table-row" key={i}>
            <span className="muted">{date(l.at)}</span>
            <span>{l.name}</span>
            <span>{l.action}</span>
            <span>{l.result}</span>
          </div>
        ))}
      </section>
    </>
  );
}
