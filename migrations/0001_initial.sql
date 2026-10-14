PRAGMA foreign_keys = ON;
CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO config VALUES ('retention_days','7'),('r2_limit_bytes','8589934592'),('credential_epoch','1'),('player_epoch','1');
CREATE TABLE sessions (id TEXT PRIMARY KEY, csrf TEXT NOT NULL, name TEXT NOT NULL, expires INTEGER NOT NULL, epoch INTEGER NOT NULL);
CREATE INDEX sessions_expires ON sessions(expires);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE oauth_states (state TEXT PRIMARY KEY, provider TEXT NOT NULL, session_id TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE connections (provider TEXT PRIMARY KEY, encrypted TEXT NOT NULL, updated INTEGER NOT NULL);
CREATE TABLE clips (
 id TEXT PRIMARY KEY, request_key TEXT UNIQUE NOT NULL, twitch_id TEXT, title TEXT NOT NULL,
 created INTEGER NOT NULL, updated INTEGER NOT NULL, duration REAL NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'requested', edit_status TEXT NOT NULL DEFAULT 'pending',
 r2_key TEXT, thumbnail TEXT, bytes INTEGER NOT NULL DEFAULT 0, tags TEXT NOT NULL DEFAULT '[]',
 archive_at INTEGER NOT NULL, retention_days INTEGER, drive_id TEXT, error TEXT,
 retry_at INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
 requested_duration INTEGER NOT NULL DEFAULT 60, lease_until INTEGER NOT NULL DEFAULT 0,
 lease_owner TEXT, generation_started INTEGER, restore_until INTEGER
);
CREATE INDEX clips_due ON clips(status, archive_at, retry_at);
CREATE TABLE playlists (id TEXT PRIMARY KEY, title TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, draft TEXT NOT NULL, updated INTEGER NOT NULL);
CREATE TABLE publication (id INTEGER PRIMARY KEY CHECK(id=1), playlist_id TEXT NOT NULL, version INTEGER NOT NULL, snapshot TEXT NOT NULL, published INTEGER NOT NULL);
CREATE TABLE publication_clips (clip_id TEXT PRIMARY KEY REFERENCES clips(id) ON DELETE RESTRICT);
CREATE TABLE playback_leases (id TEXT PRIMARY KEY, expires INTEGER NOT NULL);
CREATE TABLE frames (id TEXT PRIMARY KEY, name TEXT NOT NULL, r2_key TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, bytes INTEGER NOT NULL, created INTEGER NOT NULL);
CREATE TABLE transfers (id TEXT PRIMARY KEY, clip_id TEXT NOT NULL UNIQUE REFERENCES clips(id), status TEXT NOT NULL, encrypted_url TEXT, drive_id TEXT, offset INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL, error TEXT, updated INTEGER NOT NULL);
CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, name TEXT NOT NULL, action TEXT NOT NULL, result TEXT NOT NULL);
CREATE TABLE storage_history (day TEXT PRIMARY KEY, bytes INTEGER NOT NULL);
CREATE TABLE playback_clip_leases (lease_id TEXT NOT NULL, clip_id TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(lease_id,clip_id));
CREATE INDEX playback_clip_expires ON playback_clip_leases(clip_id,expires);
CREATE TRIGGER publication_ready BEFORE INSERT ON publication_clips BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM clips WHERE id=NEW.clip_id AND status='ready' AND lease_until=0) THEN RAISE(ABORT,'clip unavailable') END;
END;
CREATE TABLE draft_clip_refs (playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE, clip_id TEXT NOT NULL REFERENCES clips(id) ON DELETE RESTRICT, PRIMARY KEY(playlist_id,clip_id));
CREATE TRIGGER draft_refs_insert AFTER INSERT ON playlists BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.draft,'$.items') j LEFT JOIN clips c ON c.id=json_extract(j.value,'$.clipId') WHERE c.id IS NULL OR c.status<>'ready' OR c.lease_until<>0) THEN RAISE(ABORT,'clip unavailable') END;
 INSERT INTO draft_clip_refs SELECT NEW.id,json_extract(value,'$.clipId') FROM json_each(NEW.draft,'$.items') GROUP BY json_extract(value,'$.clipId');
END;
CREATE TRIGGER draft_refs_update AFTER UPDATE OF draft ON playlists BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.draft,'$.items') j LEFT JOIN clips c ON c.id=json_extract(j.value,'$.clipId') WHERE c.id IS NULL OR c.status<>'ready' OR c.lease_until<>0) THEN RAISE(ABORT,'clip unavailable') END;
 DELETE FROM draft_clip_refs WHERE playlist_id=NEW.id;
 INSERT INTO draft_clip_refs SELECT NEW.id,json_extract(value,'$.clipId') FROM json_each(NEW.draft,'$.items') GROUP BY json_extract(value,'$.clipId');
 UPDATE clips SET edit_status='edited' WHERE id IN(SELECT clip_id FROM draft_clip_refs WHERE playlist_id=NEW.id);
END;
CREATE TRIGGER publication_version_insert BEFORE INSERT ON publication BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM playlists WHERE id=NEW.playlist_id AND version=NEW.version) THEN RAISE(ABORT,'version conflict') END;
END;
CREATE TRIGGER publication_version_update BEFORE UPDATE ON publication BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM playlists WHERE id=NEW.playlist_id AND version=NEW.version) THEN RAISE(ABORT,'version conflict') END;
END;
ALTER TABLE frames ADD COLUMN deleting INTEGER NOT NULL DEFAULT 0;
CREATE TABLE draft_frame_refs (playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE, frame_id TEXT NOT NULL REFERENCES frames(id) ON DELETE RESTRICT, PRIMARY KEY(playlist_id,frame_id));
CREATE TABLE publication_frames (frame_id TEXT PRIMARY KEY REFERENCES frames(id) ON DELETE RESTRICT);
CREATE TABLE playback_frame_leases (lease_id TEXT NOT NULL, frame_id TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(lease_id,frame_id));
CREATE TRIGGER draft_frames_insert AFTER INSERT ON playlists BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.draft,'$.items') j LEFT JOIN frames f ON f.id=json_extract(j.value,'$.frameId') WHERE json_extract(j.value,'$.frameId') IS NOT NULL AND (f.id IS NULL OR f.deleting=1)) THEN RAISE(ABORT,'frame unavailable') END;
 INSERT INTO draft_frame_refs SELECT NEW.id,json_extract(value,'$.frameId') FROM json_each(NEW.draft,'$.items') WHERE json_extract(value,'$.frameId') IS NOT NULL GROUP BY json_extract(value,'$.frameId');
END;
CREATE TRIGGER draft_frames_update AFTER UPDATE OF draft ON playlists BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.draft,'$.items') j LEFT JOIN frames f ON f.id=json_extract(j.value,'$.frameId') WHERE json_extract(j.value,'$.frameId') IS NOT NULL AND (f.id IS NULL OR f.deleting=1)) THEN RAISE(ABORT,'frame unavailable') END;
 DELETE FROM draft_frame_refs WHERE playlist_id=NEW.id;
 INSERT INTO draft_frame_refs SELECT NEW.id,json_extract(value,'$.frameId') FROM json_each(NEW.draft,'$.items') WHERE json_extract(value,'$.frameId') IS NOT NULL GROUP BY json_extract(value,'$.frameId');
END;
CREATE TRIGGER publication_frame_ready BEFORE INSERT ON publication_frames BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM frames WHERE id=NEW.frame_id AND deleting=0) THEN RAISE(ABORT,'frame unavailable') END;
END;
CREATE TRIGGER clip_capacity_insert BEFORE INSERT ON clips WHEN NEW.status='requested' AND NOT EXISTS(SELECT 1 FROM clips WHERE request_key=NEW.request_key) BEGIN
 SELECT CASE WHEN (SELECT COALESCE(SUM(bytes),0) FROM clips WHERE r2_key IS NOT NULL)+(SELECT COALESCE(SUM(bytes),0) FROM frames)+(SELECT COUNT(*)*104857600 FROM clips WHERE status IN ('requested','generating','downloading','storing','retry','restoring'))+104857600>=CAST((SELECT value FROM config WHERE key='r2_limit_bytes') AS INTEGER) THEN RAISE(ABORT,'storage capacity') END;
END;
CREATE TRIGGER playback_clip_ready BEFORE INSERT ON playback_clip_leases BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM clips WHERE id=NEW.clip_id AND status='ready' AND lease_until=0) THEN RAISE(ABORT,'clip unavailable') END;
END;
CREATE TRIGGER playback_frame_ready BEFORE INSERT ON playback_frame_leases BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM frames WHERE id=NEW.frame_id AND deleting=0) THEN RAISE(ABORT,'frame unavailable') END;
END;
