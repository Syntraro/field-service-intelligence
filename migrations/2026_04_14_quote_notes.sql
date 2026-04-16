-- 2026-04-14 — Quote notes canonical system.
--
-- Phase 3D adds an interactive notes surface to Quote Detail matching the
-- Job Detail `jobNotes` pattern. Tenant-scoped, author-attributed,
-- cascades on quote delete. No attachments in this phase (deferred).
--
-- Apply with: npm run db:migrate:one -- migrations/2026_04_14_quote_notes.sql

CREATE TABLE IF NOT EXISTS quote_notes (
    id          varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  varchar NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    quote_id    varchar NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    user_id     varchar NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    note_text   text NOT NULL,
    created_at  timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  timestamp
);

CREATE INDEX IF NOT EXISTS idx_quote_notes_quote_company
    ON quote_notes (quote_id, company_id);

CREATE INDEX IF NOT EXISTS idx_quote_notes_company_created
    ON quote_notes (company_id, created_at DESC);
