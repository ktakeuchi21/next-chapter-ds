-- Keep the remote-operation ledger even if a local item is removed. Never
-- recreate a remote draft just because its local source disappeared.
CREATE TABLE etsy_transfers (
 id TEXT PRIMARY KEY,
 item_id TEXT NOT NULL UNIQUE,
 shop_id TEXT NOT NULL,
 listing_id TEXT,
 draft_version INTEGER NOT NULL,
 source_version INTEGER NOT NULL,
 payload TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'ready',
 step TEXT NOT NULL DEFAULT 'create',
 uploaded TEXT NOT NULL DEFAULT '[]',
 message TEXT NOT NULL DEFAULT '',
 started_at INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
