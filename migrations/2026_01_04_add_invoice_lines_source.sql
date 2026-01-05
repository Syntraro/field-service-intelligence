-- Add source marker to invoice lines so refresh-from-job can be idempotent
-- while preserving manual invoice-only lines.
ALTER TABLE invoice_lines
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

-- Optional: speed up refresh deletes
CREATE INDEX IF NOT EXISTS invoice_lines_invoice_id_source_idx
  ON invoice_lines (invoice_id, source);
