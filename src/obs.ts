import type { Draft } from "./types";
export interface ObsControl {
  revision: number;
  selection: string;
  playlist_id: string | null;
  title: string;
  version: number;
  snapshot: Draft | null;
  action: "prepare" | "play" | "stop";
  target: string;
  issued: number;
  serverTime?: number;
}
export interface ObsState {
  control: ObsControl;
  player: {
    online: boolean;
    status: string;
    selection: string;
    revision: number;
    item: number;
    error: string;
  } | null;
  playlists: { id: string; title: string; version: number; count: number }[];
}
// Never resume a retained command after refresh, reconnect, or delayed delivery.
export function shouldStart(
  c: ObsControl,
  seen: number,
  lease: string,
  now: number,
) {
  return (
    c.revision > seen &&
    c.action === "play" &&
    c.target === lease &&
    now >= c.issued &&
    now - c.issued < 10000
  );
}
export const obsStatus: Record<string, string> = {
  waiting: "準備待ち",
  ready: "準備完了",
  stopped: "停止・待機",
  playing: "再生中",
  done: "再生終了",
  error: "確認が必要",
};
