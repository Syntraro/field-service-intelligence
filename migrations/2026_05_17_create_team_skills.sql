-- migrations/2026_05_17_create_team_skills.sql
-- Run: npm run db:migrate:one -- migrations/2026_05_17_create_team_skills.sql
--
-- Creates the company-scoped skill library (team_skills) and per-member
-- skill assignments (team_member_skills) for Team Hub Phase 3.
--
-- Tenant invariant: every row carries company_id.
-- Unique name: enforced via functional index on LOWER(TRIM(name)) per company.
-- Level domain: enforced via CHECK constraint; stored as text (no PG enum).
-- Cascade: deleting a company cascades all skills + assignments.
--          deleting a user cascades only their assignments (skills remain in library).
--          deleting a skill from library cascades member assignments.

CREATE TABLE IF NOT EXISTS team_skills (
  id              VARCHAR         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      VARCHAR         NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name            TEXT            NOT NULL,
  category        TEXT,
  description     TEXT,
  is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP,
  created_by      VARCHAR         REFERENCES users(id) ON DELETE SET NULL,
  updated_by      VARCHAR         REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS team_skills_company_id_idx
  ON team_skills(company_id);

-- Prevents duplicate skill names within a company (case- and whitespace-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS team_skills_company_name_unique
  ON team_skills(company_id, LOWER(TRIM(name)));

CREATE TABLE IF NOT EXISTS team_member_skills (
  id                        VARCHAR     PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                VARCHAR     NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id                   VARCHAR     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id                  VARCHAR     NOT NULL REFERENCES team_skills(id) ON DELETE CASCADE,
  level                     TEXT        NOT NULL DEFAULT 'basic',
  certification_name        TEXT,
  certification_expires_at  TIMESTAMP,
  notes                     TEXT,
  is_active                 BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at                TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                TIMESTAMP,
  created_by                VARCHAR     REFERENCES users(id) ON DELETE SET NULL,
  updated_by                VARCHAR     REFERENCES users(id) ON DELETE SET NULL,

  CONSTRAINT team_member_skills_level_check
    CHECK (level IN ('basic', 'intermediate', 'advanced', 'certified')),
  CONSTRAINT team_member_skills_company_user_skill_unique
    UNIQUE (company_id, user_id, skill_id)
);

CREATE INDEX IF NOT EXISTS team_member_skills_company_user_idx
  ON team_member_skills(company_id, user_id);

CREATE INDEX IF NOT EXISTS team_member_skills_skill_id_idx
  ON team_member_skills(skill_id);
