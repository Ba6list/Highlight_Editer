import { useEffect, useRef, useState } from "react";
import type { Clip, Draft, Item, Playlist, Frame } from "./types";
import { api, ApiError, media, frame, time } from "./api";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Plus,
  Trash2,
  Play,
  Save,
  Radio,
  GripVertical,
} from "lucide-react";
const blank: Draft = { items: [], loop: false, endBehavior: "black" };
export default function Editor({
  playlist,
  clips,
  frames,
  onChange,
  notify,
}: {
  playlist: Playlist;
  clips: Clip[];
  frames: Frame[];
  onChange: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => JSON.parse(playlist.draft));
  const [title, setTitle] = useState(playlist.title);
  const [version, setVersion] = useState(playlist.version);
  const [selected, setSelected] = useState(0);
  const [status, setStatus] = useState("保存済み");
  const [conflict, setConflict] = useState(false);
  const [preview, setPreview] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const drag = useRef<number | null>(null);
  const serial = useRef(0);
  const saved = useRef(0);
  const versionRef = useRef(version);
  const busy = useRef(false);
  const latest = useRef({ draft, title });
  latest.current = { draft, title };
  const previewIndex = useRef(0);
  const [position, setPosition] = useState(0);
  const item = draft.items[selected];
  const clip = clips.find((c) => c.id === item?.clipId);
  const duration = draft.items.reduce((n, x) => n + x.end - x.start, 0);
  const recoveryKey = "nobori-draft:" + playlist.id;
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (serial.current !== saved.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, []);
  function change(next: Draft) {
    serial.current++;
    setDraft(next);
    setDirty(true);
    setStatus("未保存");
    localStorage.setItem(
      recoveryKey,
      JSON.stringify({
        draft: next,
        title: latest.current.title,
        baseVersion: versionRef.current,
      }),
    );
  }
  async function save() {
    if (busy.current || conflict || serial.current === saved.current)
      return !conflict;
    busy.current = true;
    setSaving(true);
    const count = serial.current;
    setStatus("保存中…");
    try {
      const data = await api<{ version: number }>("/playlists/" + playlist.id, {
        method: "PUT",
        body: JSON.stringify({
          ...latest.current,
          version: versionRef.current,
        }),
      });
      versionRef.current = data.version;
      setVersion(data.version);
      saved.current = count;
      if (serial.current === count) {
        localStorage.removeItem(recoveryKey);
        setDirty(false);
        setStatus("保存済み");
      }
      return true;
    } catch (e) {
      if (
        e instanceof ApiError &&
        e.status === 409 &&
        e.message.includes("別のスタッフ")
      ) {
        setConflict(true);
        setStatus("更新が競合しています");
      } else
        setStatus(
          (e as Error).message || "保存できません。接続を確認してください",
        );
      return false;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  useEffect(() => {
    if (!dirty) return;
    localStorage.setItem(
      recoveryKey,
      JSON.stringify({ ...latest.current, baseVersion: versionRef.current }),
    );
    if (conflict) return;
    const t = setTimeout(() => void save(), 1200);
    return () => clearTimeout(t);
  }, [draft, title, dirty, conflict, version]);
  useEffect(() => {
    const raw = localStorage.getItem(recoveryKey);
    if (raw) {
      setStatus("未送信の編集内容があります");
    }
  }, [recoveryKey]);
  useEffect(() => {
    if (!preview) {
      const v = video.current;
      v?.pause();
      if (v && item && v.readyState) v.currentTime = item.start;
    }
  }, [selected, preview, item?.clipId]);
  function edit(patch: Partial<Item>) {
    if (!item) return;
    change({
      ...draft,
      items: draft.items.map((v, i) =>
        i === selected ? { ...v, ...patch } : v,
      ),
    });
  }
  function move(from: number, to: number) {
    if (to < 0 || to >= draft.items.length) return;
    const items = [...draft.items];
    items.splice(to, 0, items.splice(from, 1)[0]);
    change({ ...draft, items });
    setSelected(to);
  }
  async function publish() {
    if (!(await save())) return;
    try {
      await api("/playlists/" + playlist.id + "/publish", {
        method: "POST",
        body: JSON.stringify({ version: versionRef.current }),
      });
      notify("公開しました。OBS操作パネルで読み込んでから再生してください");
      await onChange();
    } catch (e) {
      notify((e as Error).message);
    }
  }
  function playAll() {
    if (!draft.items.length) return;
    previewIndex.current = 0;
    setSelected(0);
    setPreview(true);
    const v = video.current;
    if (v && selected === 0) {
      v.currentTime = draft.items[0].start;
      void v.play().catch(() => notify("再生ボタンを押してください"));
    }
  }
  const available = clips.filter((c) => c.status === "ready");
  return (
    <div className="editor-layout">
      <div className="editor-main">
        <div className="toolbar">
          <input
            aria-label="再生リスト名"
            className="title-input"
            value={title}
            onChange={(e) => {
              serial.current++;
              setTitle(e.target.value);
              setDirty(true);
            }}
          />
          <span className={conflict ? "error-text" : "muted"}>{status}</span>
          <button onClick={() => void save()} disabled={saving || conflict}>
            <Save size={15} />
            保存
          </button>
          <button
            className="primary"
            onClick={() => void publish()}
            disabled={conflict || saving || !draft.items.length}
          >
            <Radio size={15} />
            公開する
          </button>
        </div>
        {conflict && (
          <div className="notice error">
            別のスタッフが更新しました。編集内容はこの端末に保管しています。
            <button
              onClick={async () => {
                try {
                  const p = await api<Playlist>("/playlists/" + playlist.id);
                  setDraft(JSON.parse(p.draft));
                  setTitle(p.title);
                  setVersion(p.version);
                  versionRef.current = p.version;
                  saved.current = serial.current;
                  setConflict(false);
                  setDirty(false);
                  setStatus("最新版を読み込みました");
                  localStorage.removeItem(recoveryKey);
                } catch (e) {
                  notify((e as Error).message);
                }
              }}
            >
              自分の変更を破棄して最新版を読む
            </button>
          </div>
        )}
        {localStorage.getItem(recoveryKey) && !dirty && !conflict && (
          <div className="notice">
            前回の未送信データがあります。
            <button
              onClick={() => {
                const raw = JSON.parse(localStorage.getItem(recoveryKey)!);
                setDraft(raw.draft);
                setTitle(raw.title);
                serial.current++;
                setDirty(true);
                if (raw.baseVersion !== versionRef.current) setConflict(true);
              }}
            >
              復元する
            </button>
          </div>
        )}
        <div className="preview-screen">
          {clip ? (
            <>
              <video
                ref={video}
                src={media(clip.id)}
                controls={!preview}
                preload="auto"
                playsInline
                onLoadedMetadata={(e) => {
                  e.currentTarget.currentTime = item.start;
                  if (preview)
                    void e.currentTarget
                      .play()
                      .catch(() =>
                        notify(
                          "音声付き再生を開始するには再生ボタンを押してください",
                        ),
                      );
                }}
                onTimeUpdate={(e) => {
                  setPosition(e.currentTarget.currentTime);
                  if (
                    preview &&
                    e.currentTarget.currentTime >= item.end - 0.03
                  ) {
                    if (previewIndex.current + 1 < draft.items.length) {
                      const next = previewIndex.current + 1;
                      previewIndex.current = next;
                      if (draft.items[next].clipId === item.clipId) {
                        e.currentTarget.currentTime = draft.items[next].start;
                        setSelected(next);
                      } else setSelected(next);
                    } else {
                      e.currentTarget.pause();
                      setPreview(false);
                    }
                  }
                }}
              />
              {item.frameId && (
                <img
                  src={frame(item.frameId)}
                  alt="選択したフレーム"
                  className="frame-overlay"
                />
              )}
            </>
          ) : (
            <div className="empty">
              <Play size={32} />
              <p>クリップを追加して編集を開始</p>
              <span>元動画を変更せず、再生範囲と順番を保存します</span>
            </div>
          )}
        </div>
        <div className="preview-footer">
          <span>{clip?.title || "プレビュー"}</span>
          <button onClick={playAll} disabled={!draft.items.length}>
            <Play size={15} />
            全体をプレビュー
          </button>
          <span className="mono">合計 {time(duration)}</span>
        </div>
        {item && clip && (
          <div className="panel trim-panel">
            <div className="section-line">
              <h3>再生範囲</h3>
              <span className="muted mono">
                現在 {time(position)} / 素材 {time(clip.duration)}
              </span>
            </div>
            <div className="trim-inputs">
              <label>
                開始
                <input
                  type="number"
                  min="0"
                  max={item.end - 0.1}
                  step="0.1"
                  value={item.start}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (n >= 0 && n < item.end) {
                      edit({ start: n });
                      if (video.current) video.current.currentTime = n;
                    }
                  }}
                />
              </label>
              <input
                aria-label="開始位置"
                type="range"
                min="0"
                max={Math.max(0, clip.duration - 0.1)}
                step="0.1"
                value={item.start}
                onChange={(e) =>
                  edit({
                    start: Math.min(Number(e.target.value), item.end - 0.1),
                  })
                }
              />
              <label>
                終了
                <input
                  type="number"
                  min={item.start + 0.1}
                  max={clip.duration}
                  step="0.1"
                  value={item.end}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (n > item.start && n <= clip.duration) edit({ end: n });
                  }}
                />
              </label>
              <input
                aria-label="終了位置"
                type="range"
                min="0.1"
                max={clip.duration}
                step="0.1"
                value={item.end}
                onChange={(e) =>
                  edit({
                    end: Math.max(Number(e.target.value), item.start + 0.1),
                  })
                }
              />
            </div>
            <label className="inline-label">
              PNGフレーム
              <select
                value={item.frameId || ""}
                onChange={(e) => edit({ frameId: e.target.value || null })}
              >
                <option value="">フレームなし</option>
                {frames.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <div className="section-line">
          <h3>
            再生順 <span className="muted">{draft.items.length} CLIPS</span>
          </h3>
          <button onClick={() => setShowPicker(!showPicker)}>
            <Plus size={16} />
            クリップを追加
          </button>
        </div>
        {showPicker && (
          <div className="panel picker">
            {available.length ? (
              available.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    change({
                      ...draft,
                      items: [
                        ...draft.items,
                        {
                          id: crypto.randomUUID(),
                          clipId: c.id,
                          start: Math.max(0, c.duration - 30),
                          end: c.duration,
                          frameId: null,
                        },
                      ],
                    });
                    setSelected(draft.items.length);
                  }}
                >
                  {c.title} <span>{time(c.duration)}</span>
                  <Plus size={15} />
                </button>
              ))
            ) : (
              <p className="muted">保存済みクリップがありません</p>
            )}
          </div>
        )}
        <div className="timeline">
          {draft.items.map((x, i) => {
            const c = clips.find((c) => c.id === x.clipId);
            return (
              <div
                key={x.id}
                className={"timeline-row " + (i === selected ? "selected" : "")}
                draggable
                onDragStart={() => {
                  drag.current = i;
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (drag.current !== null) move(drag.current, i);
                  drag.current = null;
                }}
              >
                <GripVertical size={16} className="muted" />
                <button
                  className="timeline-select"
                  onClick={() => {
                    setPreview(false);
                    setSelected(i);
                  }}
                >
                  <span className="order">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span>
                    {c?.title || "削除された素材"}
                    <small>
                      {time(x.start)} → {time(x.end)}
                    </small>
                  </span>
                  <span className="mono">{time(x.end - x.start)}</span>
                </button>
                <div className="row-actions">
                  <button
                    aria-label="上へ"
                    disabled={i === 0}
                    onClick={() => move(i, i - 1)}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    aria-label="下へ"
                    disabled={i === draft.items.length - 1}
                    onClick={() => move(i, i + 1)}
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    aria-label="複製"
                    onClick={() => {
                      const items = [...draft.items];
                      items.splice(i + 1, 0, { ...x, id: crypto.randomUUID() });
                      change({ ...draft, items });
                    }}
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    aria-label="再生リストから外す"
                    onClick={() => {
                      change({
                        ...draft,
                        items: draft.items.filter((_, n) => n !== i),
                      });
                      setSelected(
                        Math.max(0, Math.min(selected, draft.items.length - 2)),
                      );
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <aside className="panel editor-side">
        <p className="eyebrow">PLAYLIST SETTINGS</p>
        <h3>上映設定</h3>
        <label className="check-label">
          <input
            type="checkbox"
            checked={draft.loop}
            onChange={(e) => change({ ...draft, loop: e.target.checked })}
          />
          繰り返し再生
        </label>
        <label>
          終了後
          <select
            value={draft.endBehavior}
            onChange={(e) =>
              change({
                ...draft,
                endBehavior: e.target.value as Draft["endBehavior"],
              })
            }
          >
            <option value="black">黒画面で停止</option>
            <option value="standby">NOBORI 待機表示</option>
          </select>
        </label>
        <hr />
        <p className="muted">
          保存と公開は別の操作です。OBSでは操作パネルで読み込んだ時点の保存内容を再生します。変更を反映するときは停止後に読み込み直してください。
        </p>
        <p className="muted">
          公開時点のフレームを固定します。差し替え後は新しいフレームを選んで再公開してください。
        </p>
        <span className="mono muted">VERSION {version}</span>
      </aside>
    </div>
  );
}
export { blank };
