-- Inactive until a verified seller connection is explicitly enabled in code.
CREATE TABLE marketplace_sync_cursors (
 id TEXT PRIMARY KEY, channel TEXT NOT NULL, environment TEXT NOT NULL, account_id TEXT NOT NULL,
 watermark TEXT NOT NULL, window_start TEXT, window_end TEXT, page_offset INTEGER NOT NULL DEFAULT 0,
 pass_ids TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(pass_ids)), previous_pass_hash TEXT, pass_number INTEGER NOT NULL DEFAULT 0,
 state TEXT NOT NULL DEFAULT 'idle', failures INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0, message TEXT, updated_at TEXT NOT NULL,
 UNIQUE(channel,environment,account_id)
);
-- Remote identifiers come from authenticated provider reads, never a pasted URL.
CREATE TABLE listing_removals (
 id TEXT PRIMARY KEY, listing_id TEXT NOT NULL UNIQUE, item_id TEXT NOT NULL,
 target TEXT NOT NULL CHECK(json_valid(target)), state TEXT NOT NULL DEFAULT 'ready',
 attempt_token TEXT, started_at INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, verified_at TEXT
);
