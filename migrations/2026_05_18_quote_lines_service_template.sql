-- Run: npm run db:migrate:one -- migrations/2026_05_18_quote_lines_service_template.sql
--
-- RALPH Service Templates Phase 3: Quote Integration
-- Adds service_template_id attribution column to quote_lines so flat-rate
-- service template applications can be traced back to their source template.
-- ON DELETE SET NULL: deleting or soft-deleting a template does not remove
-- the quote lines that were generated from it.

ALTER TABLE quote_lines
  ADD COLUMN IF NOT EXISTS service_template_id varchar
    REFERENCES service_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quote_lines_service_template
  ON quote_lines(service_template_id)
  WHERE service_template_id IS NOT NULL;
