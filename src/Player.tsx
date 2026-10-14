import { useEffect, useRef, useState } from "react";
import type { Draft, Item } from "./types";
type Manifest = {
  id: string;
  version: number;
  title: string;
  draft: Draft;
  duration: number;
  leaseId: string;
};
export default function Player() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [active, setActive] = useState(0);
  const [slot, setSlot] = useState(0);
  const [done, setDone] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [manual, setManual] = useState(false);
  const [offline, setOffline] = useState(false);
  const [ready, setReady] = useState(false);
  const videos = useRef<(HTMLVideoElement | null)[]>([null, null]);
  const index = useRef(0);
  const loaded = useRef<string | null>(null);
  const retries = useRef(0);
  const starting = useRef(false);
  const token = new URLSearchParams(location.search).get("token") || "";
  const url = (kind: string, id: string) =>
    `/media/${kind}/${id}?token=${encodeURIComponent(token)}`;
  useEffect(() => {
    document.body.classList.add("player-body");
    let cancelled = false;
    const leaseId = crypto.randomUUID();
    async function poll() {
      try {
        const r = await fetch(
          `/api/player/manifest?token=${encodeURIComponent(token)}&lease=${leaseId}`,
          { cache: "no-store" },
        );
        if (!r.ok) throw Error();
        const m = (await r.json()) as Manifest | null;
        setOffline(false);
        if (!cancelled && m && loaded.current !== m.id) {
          if (loaded.current === null || index.current === -1) {
            loaded.current = m.id;
            index.current = 0;
            setActive(0);
            setSlot(0);
            setDone(false);
            setManifest({ ...m, leaseId });
            setReady(false);
          }
        }
      } catch {
        if (!cancelled) setOffline(true);
      }
    }
    void poll();
    const t = setInterval(poll, 15000);
    return () => {
      cancelled = true;
      clearInterval(t);
      document.body.classList.remove("player-body");
    };
  }, [token]);
  useEffect(() => {
    if (!manifest || done) return;
    async function heartbeat() {
      try {
        await fetch(
          `/api/player/heartbeat?token=${encodeURIComponent(token)}&lease=${manifest!.leaseId}&publication=${encodeURIComponent(manifest!.id)}`,
          { cache: "no-store" },
        );
      } catch {
        setOffline(true);
      }
    }
    void heartbeat();
    const timer = setInterval(heartbeat, 20000);
    return () => {
      clearInterval(timer);
      void fetch(
        `/api/player/release?token=${encodeURIComponent(token)}&lease=${manifest.leaseId}`,
      ).catch(() => {});
    };
  }, [manifest, done, token]);
  const items = manifest?.draft.items || [];
  const current = items[active];
  const next = items[active + 1] || (manifest?.draft.loop ? items[0] : null);
  async function begin(v: HTMLVideoElement, item: Item) {
    if (starting.current || !v.paused) return;
    starting.current = true;
    try {
      if (Math.abs(v.currentTime - item.start) > 0.08)
        v.currentTime = item.start;
      await v.play();
      setManual(false);
      setBlocked(false);
      setReady(true);
      retries.current = 0;
    } catch {
      setManual(true);
    } finally {
      starting.current = false;
    }
  }
  useEffect(() => {
    const v = videos.current[slot];
    if (v && current) {
      if (v.error) v.load();
      else if (v.readyState >= 2) void begin(v, current);
    }
  }, [active, slot, current]);
  function advance() {
    if (index.current !== active) return;
    const v = videos.current[slot];
    v?.pause();
    setReady(false);
    if (active + 1 >= items.length) {
      if (manifest?.draft.loop) {
        index.current = 0;
        setActive(0);
        setSlot(1 - slot);
      } else {
        index.current = -1;
        setDone(true);
        setReady(false);
      }
    } else {
      index.current = active + 1;
      setActive(active + 1);
      setSlot(1 - slot);
    }
  }
  const assignments = [
    slot === 0 ? current : next,
    slot === 1 ? current : next,
  ];
  return (
    <div className="obs-player">
      {assignments.map((item, n) => (
        <video
          key={n}
          ref={(v) => {
            videos.current[n] = v;
          }}
          className={n === slot && !done && !blocked ? "on" : ""}
          src={item ? url("clip", item.clipId) : undefined}
          preload="auto"
          playsInline
          muted={n !== slot}
          onLoadedMetadata={(e) => {
            if (item) e.currentTarget.currentTime = item.start;
          }}
          onCanPlay={(e) => {
            if (n === slot && item && !done) void begin(e.currentTarget, item);
          }}
          onTimeUpdate={(e) => {
            if (
              n === slot &&
              current &&
              !done &&
              e.currentTarget.currentTime >= current.end - 0.025
            )
              advance();
          }}
          onEnded={() => {
            if (n === slot) advance();
          }}
          onError={() => {
            if (n !== slot) return;
            setReady(false);
            if (retries.current++ < 3) {
              setTimeout(
                () => videos.current[n]?.load(),
                2000 * retries.current,
              );
            } else setBlocked(true);
          }}
        />
      ))}
      {current?.frameId && !done && ready && !blocked && (
        <img className="obs-frame" src={url("frame", current.frameId)} alt="" />
      )}
      {done && manifest?.draft.endBehavior === "standby" && (
        <div className="obs-standby">
          NOBORI <small>HIGHLIGHTS</small>
        </div>
      )}
      {manual && (
        <button
          className="player-start"
          onClick={() => {
            const v = videos.current[slot];
            if (v && current) void begin(v, current);
          }}
        >
          音声付きで再生を開始
        </button>
      )}
      {new URLSearchParams(location.search).has("debug") && (
        <div className="player-debug">
          {blocked
            ? "読み込み失敗"
            : done
              ? "再生終了"
              : offline
                ? "通信再接続待ち"
                : "再生準備・上映中"}{" "}
          · {active + 1}/{items.length}
        </div>
      )}
    </div>
  );
}
