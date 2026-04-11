-- Reference Fields — Controlled, tenant-scoped, searchable reference data
-- 2026-04-10: Centralized reference field system for Jobs, Quotes, and Invoices.
--
-- Two tables:
--   1. reference_field_definitions — field registry (label, key, type, applies-to)
--   2. reference_field_values — per-record typed values
--
-- Run: npm run db:migrate:one -- migrations/2026_04_10_reference_fields.sql

-- ============================================================================
-- TABLE 1: reference_field_definitions
-- ============================================================================

CREATE TABLE IF NOT EXISTS reference_field_definitions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  label VARCHAR(200) NOT NULL,
  key VARCHAR(100) NOT NULL,

  type VARCHAR(20) NOT NULL,

  applies_to_jobs BOOLEAN NOT NULL DEFAULT false,
  applies_to_quotes BOOLEAN NOT NULL DEFAULT false,
  applies_to_invoices BOOLEAN NOT NULL DEFAULT false,

  searchable BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,

  display_order INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP,

  -- Constraints
  CONSTRAINT ref_field_defs_type_check
    CHECK (type IN ('text', 'number', 'date')),

  CONSTRAINT ref_field_defs_applies_to_check
    CHECK (applies_to_jobs = true OR applies_to_quotes = true OR applies_to_invoices = true)
);

-- Unique key per tenant
CREATE UNIQUE INDEX IF NOT EXISTS ref_field_defs_company_key_uq
  ON reference_field_definitions(company_id, key);

-- ============================================================================
-- TABLE 2: reference_field_values
-- ============================================================================

CREATE TABLE IF NOT EXISTS reference_field_values (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  field_definition_id VARCHAR NOT NULL REFERENCES reference_field_definitions(id) ON DELETE CASCADE,

  entity_type VARCHAR(20) NOT NULL,
  entity_id VARCHAR NOT NULL,

  text_value VARCHAR(500),
  number_value NUMERIC(18, 6),
  date_value TIMESTAMP,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP,

  -- Constraints
  CONSTRAINT ref_field_vals_entity_type_check
    CHECK (entity_type IN ('job', 'quote', 'invoice')),

  CONSTRAINT ref_field_vals_single_value_check
    CHECK (
      (CASE WHEN text_value IS NOT NULL THEN 1 ELSE 0 END +
       CASE WHEN number_value IS NOT NULL THEN 1 ELSE 0 END +
       CASE WHEN date_value IS NOT NULL THEN 1 ELSE 0 END) <= 1
    )
);

-- One value per field per entity (upsert target)
CREATE UNIQUE INDEX IF NOT EXISTS ref_field_vals_field_entity_uq
  ON reference_field_values(company_id, field_definition_id, entity_type, entity_id);

-- Lookup: all values for a specific entity
CREATE INDEX IF NOT EXISTS ref_field_vals_entity_lookup_idx
  ON reference_field_values(company_id, entity_type, entity_id);

-- Lookup: all values for a specific definition
CREATE INDEX IF NOT EXISTS ref_field_vals_definition_idx
  ON reference_field_values(company_id, field_definition_id);

-- Text search: GIN trigram index on text_value for ILIKE search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS ref_field_vals_text_search_gin
  ON reference_field_values USING gin (text_value gin_trgm_ops)
  WHERE text_value IS NOT NULL;
