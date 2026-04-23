-- Technician Calendar Tokens — Phase 1 (2026-04-23)
--
-- Per-technician private ICS feed tokens for external calendar subscription
-- (Google Calendar / Apple Calendar / Outlook — subscribe by URL). Read-only.
-- Not a new scheduling source — the public /calendar/technician/:token.ics
-- endpoint reads the canonical job_visits rows.
--
-- One row per user. Rotation = overwrite the `token` column. Disable =
-- flip `is_active` to false; the row survives so re-enabling reuses the
-- same (or a freshly rotated) token.
--
-- Run: npm run db:migrate:one -- migrations/2026_04_23_technician_calendar_tokens.sql

CREATE TABLE IF NOT EXISTS technician_calendar_tokens (
  id               VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id          VARCHAR NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  token            VARCHAR(64) NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  last_accessed_at TIMESTAMP,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP
);

-- One token row per user.
CREATE UNIQUE INDEX IF NOT EXISTS tct_user_uq
  ON technician_calendar_tokens(user_id);

-- Token uniqueness — the token IS the secret; collisions (vanishingly
-- unlikely at 256-bit entropy) must still be caught by the DB.
CREATE UNIQUE INDEX IF NOT EXISTS tct_token_uq
  ON technician_calendar_tokens(token);

-- Public-endpoint lookup: resolve active tokens only.
CREATE INDEX IF NOT EXISTS tct_active_token_idx
  ON technician_calendar_tokens(token) WHERE is_active;
