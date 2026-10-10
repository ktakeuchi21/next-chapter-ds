-- Ordinary captures are intended for sale. Preserve sample uncertainty,
-- explicit unavailability and all reserved/sold/finished inventory.
INSERT INTO activity(id,item_id,message,created_at)
SELECT lower(hex(randomblob(16))),id,'New-capture default applied: available to sell.',strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM items
WHERE sample_id IS NULL AND record_type IN ('item','batch')
  AND status IN ('intake','review')
  AND COALESCE(json_extract(data,'$.availability'),'unknown')='unknown';

UPDATE items
SET data=json_set(data,'$.availability','available'),version=version+1,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE sample_id IS NULL AND record_type IN ('item','batch')
  AND status IN ('intake','review')
  AND COALESCE(json_extract(data,'$.availability'),'unknown')='unknown';
