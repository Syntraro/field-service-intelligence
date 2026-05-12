-- Run: npm run db:migrate:one -- migrations/2026_05_11_user_appearance_preference.sql
--
-- Add per-user appearance preference column (Phase 3 theme persistence).
-- Defaults to 'dark' so all existing users stay on the current dark shell.
-- CHECK constraint mirrors the userAppearanceEnum in shared/schema.ts.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS appearance TEXT NOT NULL DEFAULT 'dark'
  CHECK (appearance IN ('dark', 'light'));
