CREATE TABLE extension_pair_codes (code_hash TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE TABLE extension_tokens (token_hash TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE INDEX extension_codes_expiry ON extension_pair_codes(expires);
CREATE INDEX extension_tokens_expiry ON extension_tokens(expires);
