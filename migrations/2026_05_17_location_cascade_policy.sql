-- Migration: Location hard-delete cascade policy
-- Run: npm run db:migrate:one -- migrations/2026_05_17_location_cascade_policy.sql
-- Date: 2026-05-17
--
-- Changes all child-table FKs pointing at client_locations(id) from
-- ON DELETE RESTRICT (or SET NULL for recurring_job_templates) to ON DELETE CASCADE.
--
-- Policy: location/client hard delete is intentionally destructive and user-confirmed.
-- DB CASCADE aligns with deleteLocationCascadeInTx, which remains the primary deletion
-- engine. CASCADE is a safety net for any path that reaches the location delete without
-- going through the manual cascade.
--
-- No backfill: production data is wiped before launch.
-- Uses dynamic constraint discovery (pg_constraint) to avoid hardcoded names.

-- ── 1. jobs.location_id ──────────────────────────────────────────────────────
DO $$ DECLARE v text;
BEGIN
  SELECT conname INTO v
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE c.conrelid = 'jobs'::regclass AND c.contype = 'f' AND a.attname = 'location_id';
  IF v IS NOT NULL THEN EXECUTE 'ALTER TABLE jobs DROP CONSTRAINT ' || quote_ident(v); END IF;
END $$;
ALTER TABLE jobs
  ADD CONSTRAINT jobs_location_id_client_locations_fk
  FOREIGN KEY (location_id) REFERENCES client_locations(id)
  ON DELETE CASCADE;

-- ── 2. invoices.location_id ──────────────────────────────────────────────────
DO $$ DECLARE v text;
BEGIN
  SELECT conname INTO v
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE c.conrelid = 'invoices'::regclass AND c.contype = 'f' AND a.attname = 'location_id';
  IF v IS NOT NULL THEN EXECUTE 'ALTER TABLE invoices DROP CONSTRAINT ' || quote_ident(v); END IF;
END $$;
ALTER TABLE invoices
  ADD CONSTRAINT invoices_location_id_client_locations_fk
  FOREIGN KEY (location_id) REFERENCES client_locations(id)
  ON DELETE CASCADE;

-- ── 3. quotes.location_id ────────────────────────────────────────────────────
DO $$ DECLARE v text;
BEGIN
  SELECT conname INTO v
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE c.conrelid = 'quotes'::regclass AND c.contype = 'f' AND a.attname = 'location_id';
  IF v IS NOT NULL THEN EXECUTE 'ALTER TABLE quotes DROP CONSTRAINT ' || quote_ident(v); END IF;
END $$;
ALTER TABLE quotes
  ADD CONSTRAINT quotes_location_id_client_locations_fk
  FOREIGN KEY (location_id) REFERENCES client_locations(id)
  ON DELETE CASCADE;

-- ── 4. leads.location_id ─────────────────────────────────────────────────────
DO $$ DECLARE v text;
BEGIN
  SELECT conname INTO v
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE c.conrelid = 'leads'::regclass AND c.contype = 'f' AND a.attname = 'location_id';
  IF v IS NOT NULL THEN EXECUTE 'ALTER TABLE leads DROP CONSTRAINT ' || quote_ident(v); END IF;
END $$;
ALTER TABLE leads
  ADD CONSTRAINT leads_location_id_client_locations_fk
  FOREIGN KEY (location_id) REFERENCES client_locations(id)
  ON DELETE CASCADE;

-- ── 5. client_notes.location_id ──────────────────────────────────────────────
-- Known name from migrations/2026_01_11_add_location_id_columns.sql: fk_client_notes_location
ALTER TABLE client_notes DROP CONSTRAINT IF EXISTS fk_client_notes_location;
DO $$ DECLARE v text;
BEGIN
  SELECT conname INTO v
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE c.conrelid = 'client_notes'::regclass AND c.contype = 'f' AND a.attname = 'location_id'
    AND conname != 'client_notes_location_id_client_locations_fk';
  IF v IS NOT NULL THEN EXECUTE 'ALTER TABLE client_notes DROP CONSTRAINT ' || quote_ident(v); END IF;
END $$;
ALTER TABLE client_notes
  ADD CONSTRAINT client_notes_location_id_client_locations_fk
  FOREIGN KEY (location_id) REFERENCES client_locations(id)
  ON DELETE CASCADE;

-- ── 6. client_notes.client_id (deprecated FK) ───────────────────────────────
DO $$ DECLARE v text;
BEGIN
  SELECT conname INTO v
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE c.conrelid = 'client_notes'::regclass AND c.contype = 'f' AND a.attname = 'client_id';
  IF v IS NOT NULL THEN EXECUTE 'ALTER TABLE client_notes DROP CONSTRAINT ' || quote_ident(v); END IF;
END $$;
ALTER TABLE client_notes
  ADD CONSTRAINT client_notes_client_id_client_locations_fk
  FOREIGN KEY (client_id) REFERENCES client_locations(id)
  ON DELETE CASCADE;

-- ── 7. maintenance_records.location_id ──────────────────────────────────────
-- Known name from migrations/2026_01_11_add_location_id_columns.sql: fk_maintenance_records_location
ALTER TABLE maintenance_records DROP CONSTRAINT IF EXISTS fk_maintenance_records_location;
DO $$ DECLARE v text;
BEGIN
  SELECT conname INTO v
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE c.conrelid = 'maintenance_records'::regclass AND c.contype = 'f' AND a.attname = 'location_id'
    AND conname != 'maintenance_records_location_id_client_locations_fk';
  IF v IS NOT NULL THEN EXECUTE 'ALTER TABLE maintenance_records DROP CONSTRAINT ' || quote_ident(v); END IF;
END $$;
ALTER TABLE maintenance_records
  ADD CONSTRAINT maintenance_records_location_id_client_locations_fk
  FOREIGN KEY (location_id) REFERENCES client_locations(id)
  ON DELETE CASCADE;

-- ── 8. maintenance_records.client_id (deprecated FK) ────────────────────────
-- Known name from migrations/0000_massive_mac_gargan.sql: maintenance_records_client_id_clients_id_fk
DO $$ DECLARE v text;
BEGIN
  SELECT conname INTO v
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE c.conrelid = 'maintenance_records'::regclass AND c.contype = 'f' AND a.attname = 'client_id';
  IF v IS NOT NULL THEN EXECUTE 'ALTER TABLE maintenance_records DROP CONSTRAINT ' || quote_ident(v); END IF;
END $$;
ALTER TABLE maintenance_records
  ADD CONSTRAINT maintenance_records_client_id_client_locations_fk
  FOREIGN KEY (client_id) REFERENCES client_locations(id)
  ON DELETE CASCADE;

-- ── 9. recurring_job_templates.location_id: SET NULL → CASCADE ───────────────
DO $$ DECLARE v text;
BEGIN
  SELECT conname INTO v
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE c.conrelid = 'recurring_job_templates'::regclass AND c.contype = 'f' AND a.attname = 'location_id';
  IF v IS NOT NULL THEN EXECUTE 'ALTER TABLE recurring_job_templates DROP CONSTRAINT ' || quote_ident(v); END IF;
END $$;
ALTER TABLE recurring_job_templates
  ADD CONSTRAINT recurring_job_templates_location_id_client_locations_fk
  FOREIGN KEY (location_id) REFERENCES client_locations(id)
  ON DELETE CASCADE;
