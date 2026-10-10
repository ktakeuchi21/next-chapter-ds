CREATE TABLE browser_devices (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL,
 created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, revoked_at TEXT
);
CREATE TABLE facebook_handoffs (
 id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id), owner TEXT NOT NULL,
 source_version INTEGER NOT NULL, payload TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','preparing','prepared','attention','link_received','complete','cancelled')),
 revision INTEGER NOT NULL DEFAULT 1, device_id TEXT, attempt_id TEXT,
 reason TEXT NOT NULL DEFAULT '', listing_url TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX one_facebook_handoff ON facebook_handoffs(item_id) WHERE state NOT IN ('complete','cancelled');
CREATE INDEX facebook_handoffs_owner ON facebook_handoffs(owner,updated_at);
