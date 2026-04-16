-- Phase 4: Support Session System
--
-- Run with: npm run db:migrate:one -- migrations/2026_04_15_phase4_support_sessions.sql
--
-- Extends the existing `impersonation_sessions` table rather than creating a
-- parallel `support_sessions` table. The physical table name is preserved to
-- avoid invalidating existing cookies or FK references; the code namespace
-- broadens to "support sessions". Existing active sessions migrate to
-- access_mode='impersonation' with status='active' via backfill.

BEGIN;

-- 1. New columns (all idempotent)
ALTER TABLE impersonation_sessions ADD COLUMN IF NOT EXISTS access_mode         TEXT;
ALTER TABLE impersonation_sessions ADD COLUMN IF NOT EXISTS approved_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE impersonation_sessions ADD COLUMN IF NOT EXISTS status              TEXT;
ALTER TABLE impersonation_sessions ADD COLUMN IF NOT EXISTS started_at          TIMESTAMP;
ALTER TABLE impersonation_sessions ADD COLUMN IF NOT EXISTS revoked_at          TIMESTAMP;

-- 2. Backfill for pre-existing rows
UPDATE impersonation_sessions SET access_mode = 'impersonation' WHERE access_mode IS NULL;
UPDATE impersonation_sessions SET started_at  = created_at       WHERE started_at  IS NULL;
UPDATE impersonation_sessions
  SET status = CASE
    WHEN ended_at IS NULL THEN 'active'
    WHEN ended_reason IN ('expired', 'idle') THEN 'expired'
    WHEN ended_reason IN ('manual', 'logout') THEN 'closed'
    ELSE 'closed'
  END
  WHERE status IS NULL;

-- 3. Apply NOT NULL + defaults now that backfill is complete
ALTER TABLE impersonation_sessions ALTER COLUMN access_mode SET NOT NULL;
ALTER TABLE impersonation_sessions ALTER COLUMN access_mode SET DEFAULT 'impersonation';
ALTER TABLE impersonation_sessions ALTER COLUMN status      SET NOT NULL;
ALTER TABLE impersonation_sessions ALTER COLUMN status      SET DEFAULT 'active';

-- 4. target_user_id must be nullable — read-only support sessions do not have
--    an impersonation target. Existing rows always have a value, so the
--    NULL constraint was never enforcing anything application-meaningful.
ALTER TABLE impersonation_sessions ALTER COLUMN target_user_id DROP NOT NULL;

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_imp_sessions_status  ON impersonation_sessions(status);
CREATE INDEX IF NOT EXISTS idx_imp_sessions_company ON impersonation_sessions(company_id);
CREATE INDEX IF NOT EXISTS idx_imp_sessions_owner   ON impersonation_sessions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_imp_sessions_mode    ON impersonation_sessions(access_mode);

COMMIT;
