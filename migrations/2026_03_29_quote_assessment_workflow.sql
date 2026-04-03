-- Phase 2: Quote Assessment Workflow
-- Run: npm run db:migrate:one -- migrations/2026_03_29_quote_assessment_workflow.sql
--
-- Adds:
-- 1. quotes.sales_owner_user_id — commercial owner of the quote
-- 2. quotes.assessment_status — orthogonal assessment workflow state
-- 3. tasks.quote_id — links QUOTE_ASSESSMENT tasks to quotes
--
-- No new tables. Task type enum extended with QUOTE_ASSESSMENT at app level.

-- Quote ownership
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS sales_owner_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL;

-- Quote assessment workflow state (null | 'required' | 'scheduled' | 'completed')
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS assessment_status TEXT;

-- Task → Quote link for QUOTE_ASSESSMENT tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS quote_id VARCHAR REFERENCES quotes(id) ON DELETE SET NULL;

-- Index for looking up assessment tasks by quote
CREATE INDEX IF NOT EXISTS tasks_company_quote_idx ON tasks(company_id, quote_id);
