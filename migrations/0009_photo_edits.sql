ALTER TABLE media ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE media ADD COLUMN rotation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE media ADD COLUMN edited_key TEXT;
ALTER TABLE media ADD COLUMN edited_preview_key TEXT;
ALTER TABLE media ADD COLUMN edited_mime TEXT;
ALTER TABLE media ADD COLUMN edited_size INTEGER;
ALTER TABLE media ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
UPDATE media SET sort_order=(SELECT COUNT(*) FROM media other WHERE other.item_id=media.item_id AND (other.created_at<media.created_at OR (other.created_at=media.created_at AND other.id<media.id)));
CREATE INDEX media_item_order ON media(item_id,sort_order,created_at,id);
