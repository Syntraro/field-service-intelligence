-- Equipment OCR Scans — Phase 0 nameplate capture backend (2026-05-13)
--
-- Run: npm run db:migrate:one -- migrations/2026_05_13_equipment_ocr_scans.sql
--
-- Creates a separate scan-history table (Option B from audit) so:
--   - The location_equipment row stays the owner of truth
--   - Multiple scan attempts per equipment are preserved
--   - nameplatePhotoId is set on the equipment row only after user review + save
--
-- No changes to existing tables.

CREATE TABLE IF NOT EXISTS equipment_ocr_scans (
  id               varchar        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       varchar        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  equipment_id     varchar        NOT NULL REFERENCES location_equipment(id) ON DELETE CASCADE,
  -- RESTRICT prevents deleting the source image while a scan record references it.
  file_id          varchar        NOT NULL REFERENCES files(id) ON DELETE RESTRICT,
  raw_text         text,
  -- Canonical field map JSON — shape mirrors OcrFieldMap in server/services/ocr/OcrProvider.ts.
  -- Keys: manufacturer, modelNumber, serialNumber, equipmentType, tagNumber, installDate.
  -- Each key: { value: string, confidence: number (0-1) }
  parsed_fields    jsonb,
  -- Overall confidence from the OCR provider (0.0000 – 1.0000).
  confidence       numeric(5,4)   CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  -- Provider identifier: "tesseract" | "google_vision" | "azure_cv"
  provider         varchar        NOT NULL,
  -- Populated when the tech taps "Save" after reviewing fields (Phase 1 UI).
  -- NULL means the scan result has not been confirmed by a human yet.
  reviewed_at      timestamp,
  reviewed_by_id   varchar        REFERENCES users(id),
  -- Populated when the reviewed fields are written back to location_equipment (Phase 1 UI).
  -- NULL means the scan has not been applied to the equipment record.
  applied_at       timestamp,
  created_at       timestamp      NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Tenant-scoped lookup by equipment (most common access pattern).
CREATE INDEX IF NOT EXISTS equipment_ocr_scans_equipment_idx
  ON equipment_ocr_scans(company_id, equipment_id);

-- Tenant-scoped lookup by file (used when deleting a file to check RESTRICT feasibility).
CREATE INDEX IF NOT EXISTS equipment_ocr_scans_file_idx
  ON equipment_ocr_scans(company_id, file_id);
