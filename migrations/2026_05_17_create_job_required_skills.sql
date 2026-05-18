-- migrations/2026_05_17_create_job_required_skills.sql
-- Run: npm run db:migrate:one -- migrations/2026_05_17_create_job_required_skills.sql
--
-- Adds optional skill requirements to individual jobs and reusable job templates.
-- Skills are pulled from the company-scoped team_skills library (Phase 3).
--
-- Design decisions:
--   - `required` flag: true = dispatcher should be warned if assignee lacks skill;
--     false = preferred but not blocking. System never auto-blocks assignment.
--   - `minimum_level`: NULL = any active skill level accepted.
--   - Cascade: deleting a job or template removes its requirements.
--     Deleting a skill from the library (if used) cascades here too.

CREATE TABLE IF NOT EXISTS job_required_skills (
  id              VARCHAR     PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      VARCHAR     NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id          VARCHAR     NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  skill_id        VARCHAR     NOT NULL REFERENCES team_skills(id) ON DELETE CASCADE,
  minimum_level   TEXT,                          -- nullable: any level accepted when NULL
  required        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP,

  CONSTRAINT job_required_skills_level_check
    CHECK (minimum_level IS NULL OR minimum_level IN ('basic', 'intermediate', 'advanced', 'certified')),
  CONSTRAINT job_required_skills_job_skill_unique
    UNIQUE (job_id, skill_id)
);

CREATE INDEX IF NOT EXISTS job_required_skills_company_job_idx
  ON job_required_skills(company_id, job_id);

CREATE INDEX IF NOT EXISTS job_required_skills_skill_id_idx
  ON job_required_skills(skill_id);

-- Reusable template-level skill requirements.
-- When a job is created from a template, dispatchers can use these as
-- guidance without automatically copying them to the job (manual copy
-- workflow deferred to a future phase).
CREATE TABLE IF NOT EXISTS job_template_required_skills (
  id              VARCHAR     PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      VARCHAR     NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  template_id     VARCHAR     NOT NULL REFERENCES job_templates(id) ON DELETE CASCADE,
  skill_id        VARCHAR     NOT NULL REFERENCES team_skills(id) ON DELETE CASCADE,
  minimum_level   TEXT,
  required        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP,

  CONSTRAINT job_template_required_skills_level_check
    CHECK (minimum_level IS NULL OR minimum_level IN ('basic', 'intermediate', 'advanced', 'certified')),
  CONSTRAINT job_template_required_skills_tmpl_skill_unique
    UNIQUE (template_id, skill_id)
);

CREATE INDEX IF NOT EXISTS job_template_required_skills_company_template_idx
  ON job_template_required_skills(company_id, template_id);
