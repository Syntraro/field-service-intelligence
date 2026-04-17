-- 2026-04-16: midnight rollover auto-pause system.
--
-- Adds a `auto_paused_at` timestamp column to `time_entries`. The
-- midnight rollover worker (`server/services/midnightRolloverWorker.ts`)
-- closes any still-open entry at tenant-local 23:59:59.999 on the
-- calendar day the entry started in, and stamps this column. Non-null
-- means the entry was auto-paused (vs manually stopped); the column
-- stays null for every other stop path (manual stop, shift clock-out,
-- task close) so existing queries are unaffected.
--
-- A partial index on `auto_paused_at IS NOT NULL` supports office-side
-- reporting queries without adding write overhead to the common
-- manual-stop path.
--
-- No data backfill: existing open entries will be auto-paused at the
-- next sweep, which is the correct behavior for the ghost-state fix
-- shipped earlier today (running-state guard already stops surfacing
-- them in the Labour Summary).
--
-- Run via: npm run db:migrate

ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS auto_paused_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_time_entries_auto_paused_at
  ON time_entries (auto_paused_at)
  WHERE auto_paused_at IS NOT NULL;

-- Note: the `notification_type` column on `notifications` is plain TEXT
-- (validated at the application layer via `notificationTypeEnum` in
-- `shared/schema.ts`), so adding the new `time_entry_auto_paused`
-- value requires only the TS enum update — no DB enum migration.
