export interface Clip {
  id: string;
  title: string;
  duration: number;
  created: number;
  updated: number;
  status: string;
  edit_status: string;
  thumbnail: string | null;
  bytes: number;
  tags: string;
  archive_at: number;
  error: string | null;
  drive_id: string | null;
}
export interface Item {
  id: string;
  clipId: string;
  start: number;
  end: number;
  frameId: string | null;
}
export interface Draft {
  items: Item[];
  loop: boolean;
  endBehavior: "black" | "standby";
}
export interface Playlist {
  id: string;
  title: string;
  version: number;
  draft: string;
  updated: number;
}
export interface Frame {
  id: string;
  name: string;
  width: number;
  height: number;
  bytes: number;
}
export interface State {
  protectedClipIds: string[];
  counts: {
    ready: number;
    pending: number;
    archived: number;
    errors: number;
    due: number;
  };
  clips: Clip[];
  playlists: Playlist[];
  frames: Frame[];
  retention: number;
  limit: number;
  bytes: number;
  connections: { provider: string; updated: number }[];
  publication: {
    playlist_id: string;
    version: number;
    published: number;
  } | null;
  history: { day: string; bytes: number }[];
  transfers: {
    id: string;
    clip_id: string;
    status: string;
    offset: number;
    bytes: number;
    error: string | null;
  }[];
  audit: { at: number; name: string; action: string; result: string }[];
  playbackActive: number;
  origin: string;
}
export interface Session {
  name: string;
  csrf: string;
  expires: number;
}
