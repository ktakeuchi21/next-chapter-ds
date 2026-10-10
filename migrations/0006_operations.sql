-- Operational ledgers survive item removal. Never restore credentials from backups.
CREATE TABLE backup_runs (
 id TEXT PRIMARY KEY, state TEXT NOT NULL DEFAULT 'queued',
 cursor INTEGER NOT NULL DEFAULT 0, file_count INTEGER NOT NULL DEFAULT 0,
 files TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(files)),
 inventory_hash TEXT, lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
 error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT
);
CREATE INDEX backup_runs_date ON backup_runs(created_at);
CREATE UNIQUE INDEX one_active_backup ON backup_runs((1)) WHERE state IN ('queued','copying');
CREATE TABLE marketplace_orders (
 id TEXT PRIMARY KEY, channel TEXT NOT NULL, environment TEXT NOT NULL, account_id TEXT NOT NULL,
 external_id TEXT NOT NULL, source TEXT NOT NULL, provider_updated_at TEXT NOT NULL,
 fingerprint TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)),
 state TEXT NOT NULL DEFAULT 'review', version INTEGER NOT NULL DEFAULT 1,
 accepted_at TEXT, process_token TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(channel,environment,account_id,external_id)
);
CREATE TABLE order_events (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL, provider_updated_at TEXT NOT NULL,
 fingerprint TEXT NOT NULL, outcome TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(order_id,provider_updated_at,fingerprint)
);
CREATE TABLE order_lines (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL, external_id TEXT NOT NULL,
 listing_id TEXT NOT NULL, sku TEXT NOT NULL, title TEXT NOT NULL,
 quantity INTEGER NOT NULL, amount_minor INTEGER NOT NULL, item_id TEXT,
 UNIQUE(order_id,external_id)
);
CREATE INDEX order_lines_order ON order_lines(order_id);
CREATE TABLE order_allocations (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL, line_id TEXT NOT NULL UNIQUE,
 item_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
);
CREATE TABLE order_tasks (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL, item_id TEXT, listing_id TEXT,
 kind TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'open', message TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX order_tasks_open ON order_tasks(state,order_id);
