-- Run: npm run db:migrate:one -- migrations/2026_05_11_technician_jobs_edit_permission.sql
--
-- Grant jobs.edit to the technician role.
--
-- Context: POST /api/tech/jobs now explicitly checks jobs.edit (in addition to
-- the requireSchedulable middleware). Technicians have always been able to
-- create jobs from the field app, but the permission was missing from the
-- default technician role seeding, creating an inconsistency between the
-- enforced route gate and the catalog grant.
--
-- Effect: additive only — no existing permissions are removed.

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'technician'
  AND p.key = 'jobs.edit'
ON CONFLICT DO NOTHING;
