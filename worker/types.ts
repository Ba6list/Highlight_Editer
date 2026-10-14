export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  APP_ORIGIN: string;
  AUTH_KEY: string;
  TOKEN_ENCRYPTION_KEY: string;
  STAFF_PASSWORD_HASH: string;
  ADMIN_PIN_HASH: string;
  TWITCH_CLIENT_ID: string;
  TWITCH_CLIENT_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
}
export interface Session {
  id: string;
  csrf: string;
  name: string;
  expires: number;
  epoch: number;
}
export interface Clip {
  id: string;
  twitch_id: string | null;
  title: string;
  created: number;
  updated: number;
  duration: number;
  status: string;
  edit_status: string;
  r2_key: string | null;
  thumbnail: string | null;
  bytes: number;
  tags: string;
  archive_at: number;
  drive_id: string | null;
  error: string | null;
  attempts: number;
  requested_duration: number;
  generation_started: number | null;
  restore_until: number | null;
  lease_owner: string | null;
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
export const now = () => Date.now();
export const uid = () => crypto.randomUUID();
export const DAYS = [1, 3, 7, 14, 21, 30] as const;
