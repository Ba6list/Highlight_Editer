import { useEffect, useRef, useState } from "react";
import type { Item } from "./types";
import { shouldStart, type ObsControl } from "./obs";
export default function Player() {
  const [control, setControl] = useState<ObsControl | null>(null);
  const [active, setActive] = useState(0),
    [slot, setSlot] = useState(0);
  const [playing, setPlaying] = useState(false),
    [ready, setReady] = useState(false);
  const [manual, setManual] = useState(false);
  const failureText = useRef("");
  const [done, setDone] = useState(false),
    [message, setMessage] = useState("操作パネルから再生してください");
  const videos = useRef<(HTMLVideoElement | null)[]>([null, null]);
  const lease = useRef(crypto.randomUUID());
  const current = useRef<ObsControl | null>(null),
    seen = useRef(-1),
    position = useRef(0);
  const wanted = useRef(false),
    lastSuccess = useRef(0),
    failed = useRef(false),
    starting = useRef<number | null>(null);
  const reportSequence = useRef(0);
  const activeSlot = useRef(0),
    startDeadline = useRef(0);
  const token = new URLSearchParams(location.search).get("token") || "";
  const api = (path: string) =>
    "/api/player/" + path + "?token=" + encodeURIComponent(token);
  const media = (kind: string, id: string) =>
    "/media/" + kind + "/" + id + "?token=" + encodeURIComponent(token);
  async function report(status: string, error = "") {
    const c = current.current;
    if (!c) return;
    try {
      await fetch(api("report"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lease: lease.current,
          selection: c.selection,
          revision: c.revision,
          status,
          item: position.current,
          error,
          sequence: ++reportSequence.current,
        }),
      });
    } catch {
      /* polling detects the outage */
    }
  }
  function stop() {
    wanted.current = false;
    videos.current.forEach((v) => v?.pause());
    position.current = 0;
    activeSlot.current = 0;
    startDeadline.current = 0;
    setActive(0);
    setSlot(0);
    setPlaying(false);
    setReady(false);
    setDone(false);
    setManual(false);
  }
  function fail(error: string) {
    stop();
    failed.current = true;
    failureText.current = error;
    setMessage(error);
    void report("error", error);
  }
  useEffect(() => {
    document.body.classList.add("player-body");
    let cancelled = false,
      registered = false,
      timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        if (!registered) {
          const r = await fetch(api("register"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lease: lease.current }),
            signal: AbortSignal.timeout(5000),
          });
          if (!r.ok) {
            const e = (await r.json()) as { error?: string };
            throw Error(e.error || "接続できません");
          }
          const initial = (await r.json()) as { revision: number };
          if (cancelled) return;
          seen.current = initial.revision;
          lastSuccess.current = Date.now();
          registered = true;
        }
        const requestAt = performance.now();
        const r = await fetch(api("control") + "&lease=" + lease.current, {
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
        });
        if (!r.ok)
          throw Error(
            r.status === 401
              ? "再生URLが失効しています"
              : "プレーヤーの接続を確認してください",
          );
        const c = (await r.json()) as ObsControl;
        if (cancelled) return;
        lastSuccess.current = Date.now();
        const previous = current.current;
        const fresh = c.revision > seen.current;
        const start = shouldStart(
          c,
          seen.current,
          lease.current,
          (c.serverTime ?? Date.now()) +
            Math.max(0, performance.now() - requestAt),
        );
        current.current = c;
        setControl(c);
        if (!previous || c.selection !== previous.selection) {
          stop();
          failed.current = false;
          setMessage(
            c.snapshot
              ? "動画を読み込み中…"
              : "操作パネルで再生リストを選んでください",
          );
          if (!c.snapshot) void report("waiting");
          // Loading a selection never implies playback.
        } else if (fresh) {
          stop();
          failed.current = false;
          if (start && c.snapshot) {
            wanted.current = true;
            startDeadline.current = Date.now() + 10000;
            setPlaying(true);
            setMessage("再生準備中…");
          } else {
            setMessage("待機中");
            void report(c.snapshot ? "stopped" : "waiting");
          }
        } else if (failed.current) {
          void report("error", failureText.current);
        }
        seen.current = Math.max(seen.current, c.revision);
      } catch (e) {
        if (!cancelled) {
          setMessage((e as Error).message);
          if (
            registered &&
            Date.now() - lastSuccess.current > 6000 &&
            !failed.current
          )
            fail("通信が途切れたため停止しました");
        }
      } finally {
        if (!cancelled) timer = setTimeout(poll, 2000);
      }
    }
    void poll();
    const watchdog = setInterval(() => {
      if (
        wanted.current &&
        startDeadline.current &&
        Date.now() > startDeadline.current
      )
        fail("再生準備がタイムアウトしました。停止してから再実行してください");
      if (
        registered &&
        Date.now() - lastSuccess.current > 6000 &&
        !failed.current
      )
        fail("通信が途切れたため停止しました");
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(watchdog);
      videos.current.forEach((v) => v?.pause());
      document.body.classList.remove("player-body");
    };
  }, [token]);
  const items = control?.snapshot?.items || [],
    item = items[active];
  const next = items[active + 1] || (control?.snapshot?.loop ? items[0] : null);
  async function begin(v: HTMLVideoElement, i: Item) {
    const revision = current.current?.revision;
    if (
      revision === undefined ||
      starting.current === revision ||
      !wanted.current ||
      failed.current ||
      !v.paused
    )
      return;
    starting.current = revision;
    try {
      v.currentTime = i.start;
      await v.play();
      if (!wanted.current || current.current?.revision !== revision) {
        if (!wanted.current || videos.current[activeSlot.current] !== v)
          v.pause();
        return;
      }
      startDeadline.current = 0;
      setReady(true);
      void report("playing");
    } catch {
      if (current.current?.revision === revision && wanted.current) {
        fail("音声付き自動再生を許可し、操作パネルから再実行してください");
        setManual(true);
      }
    } finally {
      if (starting.current === revision) starting.current = null;
    }
  }
  useEffect(() => {
    const v = videos.current[slot];
    if (!v || !item) return;
    if (v.readyState >= 2) {
      if (wanted.current) void begin(v, item);
      else if (!failed.current && !done) {
        v.currentTime = item.start;
        setMessage("準備完了・操作パネルから再生してください");
        void report("ready");
      }
    }
  }, [control?.revision, control?.selection, active, slot, playing]);
  function advance() {
    if (!wanted.current || position.current !== active) return;
    videos.current[slot]?.pause();
    setReady(false);
    if (active + 1 >= items.length && !control?.snapshot?.loop) {
      wanted.current = false;
      setPlaying(false);
      setDone(true);
      void report("done");
      return;
    }
    const n = active + 1 >= items.length ? 0 : active + 1;
    position.current = n;
    activeSlot.current = 1 - slot;
    setActive(n);
    setSlot(1 - slot);
  }
  return (
    <div className="obs-player">
      {[slot === 0 ? item : next, slot === 1 ? item : next].map((i, n) => (
        <video
          key={n}
          ref={(v) => {
            videos.current[n] = v;
          }}
          className={n === slot && playing && ready ? "on" : ""}
          src={i ? media("clip", i.clipId) : undefined}
          preload="auto"
          playsInline
          muted={n !== slot}
          onLoadedMetadata={(e) => {
            if (i) e.currentTarget.currentTime = i.start;
          }}
          onCanPlay={(e) => {
            if (
              n !== slot ||
              !i ||
              done ||
              current.current?.selection !== control?.selection
            )
              return;
            if (wanted.current) void begin(e.currentTarget, i);
            else if (!failed.current) {
              setMessage("準備完了・操作パネルから再生してください");
              void report("ready");
            }
          }}
          onTimeUpdate={(e) => {
            if (
              n === slot &&
              item &&
              e.currentTarget.currentTime >= item.end - 0.025
            )
              advance();
          }}
          onEnded={() => {
            if (n === slot) advance();
          }}
          onError={() => {
            if (
              n === slot &&
              i &&
              current.current?.selection === control?.selection
            )
              fail("動画を読み込めません。再生リストを読み込み直してください");
          }}
        />
      ))}
      {item?.frameId && playing && ready && (
        <img className="obs-frame" src={media("frame", item.frameId)} alt="" />
      )}
      {done && control?.snapshot?.endBehavior === "standby" && (
        <div className="obs-standby">
          NOBORI <small>HIGHLIGHTS</small>
        </div>
      )}
      {manual && new URLSearchParams(location.search).has("debug") && (
        <button
          className="player-start"
          onClick={() => {
            const v = videos.current[slot];
            if (v && item) {
              failed.current = false;
              wanted.current = true;
              setPlaying(true);
              setManual(false);
              void begin(v, item);
            }
          }}
        >
          音声付き再生をテスト
        </button>
      )}
      {new URLSearchParams(location.search).has("debug") && (
        <div className="player-debug">
          {message} · {active + 1}/{items.length}
        </div>
      )}
    </div>
  );
}
