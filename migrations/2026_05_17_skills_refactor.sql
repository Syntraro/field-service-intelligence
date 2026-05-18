-- Run: npm run db:migrate:one -- migrations/2026_05_17_skills_refactor.sql
--
-- Skills & Licenses architecture refactor:
--   1. Add library metadata flags (requires_certification, has_expiry_tracking) to team_skills.
--   2. Drop proficiency level column from team_member_skills (proficiency system removed).

ALTER TABLE team_skills
  ADD COLUMN IF NOT EXISTS requires_certification boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_expiry_tracking boolean NOT NULL DEFAULT false;

ALTER TABLE team_member_skills
  DROP COLUMN IF EXISTS level;
