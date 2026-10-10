CREATE TABLE clients (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE,
 default_location TEXT NOT NULL, next_number INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE visits (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id),
 location TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL
);
CREATE TABLE label_reservations (
 id TEXT PRIMARY KEY, visit_id TEXT NOT NULL REFERENCES visits(id), code TEXT NOT NULL UNIQUE,
 block_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX labels_block ON label_reservations(block_id);
ALTER TABLE items ADD COLUMN client_id TEXT REFERENCES clients(id);
ALTER TABLE items ADD COLUMN visit_id TEXT REFERENCES visits(id);
ALTER TABLE items ADD COLUMN record_type TEXT NOT NULL DEFAULT 'item';
ALTER TABLE items ADD COLUMN intake_report TEXT;
ALTER TABLE media ADD COLUMN preview_key TEXT;
ALTER TABLE media ADD COLUMN origin_item_id TEXT;
CREATE TABLE intake_commits (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE note_suggestions (
 id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES items(id), media_id TEXT REFERENCES media(id),
 item_id TEXT REFERENCES items(id), field TEXT NOT NULL, value TEXT NOT NULL, quote TEXT NOT NULL,
 confidence TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', previous_value TEXT, applied_version INTEGER,
 created_at TEXT NOT NULL
);
CREATE INDEX items_visit ON items(visit_id,record_type);
CREATE INDEX notes_source ON note_suggestions(source_id,state);
