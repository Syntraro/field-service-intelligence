-- Equipment Nameplate Photo (2026-03-06)
-- Adds nameplatePhotoId FK to location_equipment for nameplate image storage.
-- Run: npm run db:migrate:one -- migrations/2026_03_06_equipment_nameplate_photo.sql

ALTER TABLE location_equipment
  ADD COLUMN nameplate_photo_id VARCHAR REFERENCES files(id) ON DELETE SET NULL;

COMMENT ON COLUMN location_equipment.nameplate_photo_id IS 'FK to files table — primary nameplate photo for OCR and reference';
