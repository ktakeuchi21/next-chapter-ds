CREATE TABLE IF NOT EXISTS items (
 id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, sample_id TEXT UNIQUE,
 data TEXT NOT NULL CHECK(json_valid(data)), status TEXT NOT NULL DEFAULT 'intake', version INTEGER NOT NULL DEFAULT 1,
 research TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS media (
 id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id), kind TEXT NOT NULL, name TEXT NOT NULL,
 mime TEXT NOT NULL, size INTEGER NOT NULL, object_key TEXT NOT NULL UNIQUE, transcript TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS media_item ON media(item_id);
CREATE TABLE IF NOT EXISTS listings (
 id TEXT PRIMARY KEY,item_id TEXT NOT NULL REFERENCES items(id),channel TEXT NOT NULL,url TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'active',updated_at TEXT NOT NULL, UNIQUE(item_id,url)
);
CREATE TABLE IF NOT EXISTS jobs (
 id TEXT PRIMARY KEY,item_id TEXT NOT NULL REFERENCES items(id),kind TEXT NOT NULL,media_id TEXT,
 state TEXT NOT NULL DEFAULT 'queued',error TEXT,result TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS active_item_job ON jobs(item_id,kind) WHERE state IN ('queued','running');
CREATE INDEX IF NOT EXISTS job_date ON jobs(created_at);
CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY,item_id TEXT NOT NULL REFERENCES items(id),message TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS activity_item ON activity(item_id);

CREATE TRIGGER IF NOT EXISTS flag_cross_listings_after_sale
AFTER UPDATE OF status ON items
WHEN NEW.status IN ('sold','archived') AND OLD.status != NEW.status
BEGIN
 UPDATE listings SET state='removal_needed',updated_at=NEW.updated_at
 WHERE item_id=NEW.id AND state='active';
END;
