-- Run: npm run db:migrate:one -- migrations/2026_05_18_pricebook_item_images.sql
-- Adds optional client-presentable image metadata to catalog items and
-- flat-rate service templates. No existing rows are affected (all nullable).
-- Images are stored in R2; the DB holds metadata only (no base64 blobs).

-- items (materials + services)
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS image_file_id    varchar,
  ADD COLUMN IF NOT EXISTS image_storage_key text,
  ADD COLUMN IF NOT EXISTS image_mime_type  text,
  ADD COLUMN IF NOT EXISTS image_file_name  text,
  ADD COLUMN IF NOT EXISTS image_alt_text   text,
  ADD COLUMN IF NOT EXISTS thumbnail_storage_key text;

-- flat-rate service templates
ALTER TABLE service_templates
  ADD COLUMN IF NOT EXISTS image_file_id    varchar,
  ADD COLUMN IF NOT EXISTS image_storage_key text,
  ADD COLUMN IF NOT EXISTS image_mime_type  text,
  ADD COLUMN IF NOT EXISTS image_file_name  text,
  ADD COLUMN IF NOT EXISTS image_alt_text   text,
  ADD COLUMN IF NOT EXISTS thumbnail_storage_key text;
