CREATE TABLE obs_control (
 id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0,
 selection TEXT NOT NULL DEFAULT '', playlist_id TEXT, title TEXT NOT NULL DEFAULT '',
 version INTEGER NOT NULL DEFAULT 0, snapshot TEXT,
 action TEXT NOT NULL DEFAULT 'stop', issued INTEGER NOT NULL DEFAULT 0,
 target TEXT NOT NULL DEFAULT ''
);
INSERT INTO obs_control(id) VALUES(1);
CREATE TABLE obs_runtime (
 id INTEGER PRIMARY KEY CHECK(id=1), lease TEXT NOT NULL, seen INTEGER NOT NULL,
 selection TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'waiting', item INTEGER NOT NULL DEFAULT 0,
 error TEXT NOT NULL DEFAULT '', sequence INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE obs_clips (clip_id TEXT PRIMARY KEY REFERENCES clips(id) ON DELETE RESTRICT);
CREATE TABLE obs_frames (frame_id TEXT PRIMARY KEY REFERENCES frames(id) ON DELETE RESTRICT);
CREATE TRIGGER obs_snapshot_refs AFTER UPDATE OF snapshot ON obs_control BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.snapshot,'$.items') j LEFT JOIN clips c ON c.id=json_extract(j.value,'$.clipId') WHERE c.id IS NULL OR c.status<>'ready' OR c.lease_until<>0) THEN RAISE(ABORT,'clip unavailable') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.snapshot,'$.items') j LEFT JOIN frames f ON f.id=json_extract(j.value,'$.frameId') WHERE json_extract(j.value,'$.frameId') IS NOT NULL AND (f.id IS NULL OR f.deleting=1)) THEN RAISE(ABORT,'frame unavailable') END;
 DELETE FROM obs_clips;
 DELETE FROM obs_frames;
 INSERT INTO obs_clips SELECT json_extract(value,'$.clipId') FROM json_each(NEW.snapshot,'$.items') GROUP BY json_extract(value,'$.clipId');
 INSERT INTO obs_frames SELECT json_extract(value,'$.frameId') FROM json_each(NEW.snapshot,'$.items') WHERE json_extract(value,'$.frameId') IS NOT NULL GROUP BY json_extract(value,'$.frameId');
END;
