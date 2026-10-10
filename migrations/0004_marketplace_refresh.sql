ALTER TABLE marketplace_connections ADD COLUMN refresh_owner TEXT;
ALTER TABLE marketplace_connections ADD COLUMN refresh_until INTEGER NOT NULL DEFAULT 0;
