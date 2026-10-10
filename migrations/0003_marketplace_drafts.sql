CREATE TABLE marketplace_drafts (
 id TEXT PRIMARY KEY,
 item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
 channel TEXT NOT NULL CHECK(channel IN ('ebay','etsy')),
 data TEXT NOT NULL,
 source_version INTEGER NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(item_id, channel)
);
CREATE TABLE marketplace_connections (
 id TEXT PRIMARY KEY,
 channel TEXT NOT NULL CHECK(channel IN ('ebay','etsy')),
 environment TEXT NOT NULL CHECK(environment IN ('sandbox','production')),
 encrypted_tokens TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,
 updated_at TEXT NOT NULL,
 UNIQUE(channel, environment)
);
CREATE TABLE marketplace_oauth_states (
 id TEXT PRIMARY KEY,
 channel TEXT NOT NULL,
 environment TEXT NOT NULL,
 owner TEXT NOT NULL,
 browser_hash TEXT NOT NULL,
 encrypted_verifier TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
