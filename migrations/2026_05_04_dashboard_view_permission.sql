-- ============================================================================
-- Migration: 2026_05_04_dashboard_view_permission
-- ============================================================================
--
-- Purpose
--   Introduces the canonical `dashboard.view` permission that gates entry
--   to the office app's main dashboard surface (`/api/dashboard/*` on the
--   backend, `/` and `/financials` on the frontend). Maps the permission
--   to the canonical tenant roles `owner`, `admin`, `manager`.
--
--   Audit (this session) found a critical gap: `/api/dashboard/*` was
--   reachable by any authenticated tenant user including technicians,
--   while the frontend `<ProtectedRoute requireAdmin>` blocked manager
--   and dispatcher from the UI. That left the dashboard data API open
--   to anyone with a tenant session — UI-only protection. This
--   permission, combined with the backend `requirePermission(
--   "dashboard.view")` middleware mounted on the dashboard router,
--   makes the API authoritative.
--
-- Role grant matrix
--   owner       → granted (always — owner has every permission)
--   admin       → granted (always — admin has every permission)
--   manager     → granted (managers operate the dashboard day-to-day)
--   dispatcher  → NOT granted (current product policy unclear; default
--                 deny per spec. A tenant admin can grant this via
--                 the existing role-permission editor at
--                 `/manage-roles` if their workflow needs it.)
--   technician  → NOT granted (techs use the /tech PWA, not the office
--                 dashboard)
--
-- Schema source
--   The `permissions` and `role_permissions` tables come from
--   `migrations/2026_04_21_seed_rbac_catalog.sql`. This migration is
--   strictly additive against that schema.
--
-- Run instructions
--   Local / dev:   npm run db:migrate:one -- migrations/2026_05_04_dashboard_view_permission.sql
--   Full sweep:    npm run db:migrate
--
-- Reversibility
--   DELETE FROM role_permissions
--     WHERE permission_id = (SELECT id FROM permissions WHERE key = 'dashboard.view');
--   DELETE FROM permissions WHERE key = 'dashboard.view';
--   No FK from any other table to either row.
--
-- Idempotency
--   `INSERT … ON CONFLICT DO UPDATE` on the catalog row.
--   `INSERT … ON CONFLICT DO NOTHING` on every role-permission link.
--   Re-runs are no-ops.
-- ============================================================================

-- 1) Catalog row
INSERT INTO permissions (key, "group", label, description) VALUES
  (
    'dashboard.view',
    'admin',
    'View Dashboard',
    'Access the office dashboard (Jobs/Operations summary, financial overview, today''s schedule).'
  )
ON CONFLICT (key) DO UPDATE SET
  "group"     = EXCLUDED."group",
  label       = EXCLUDED.label,
  description = EXCLUDED.description;

-- 2) Role grants — owner, admin, manager only.
--    Dispatcher is intentionally NOT granted; a tenant admin can grant
--    via /manage-roles if their workflow requires it.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('owner', 'admin', 'manager')
  AND p.key = 'dashboard.view'
ON CONFLICT DO NOTHING;
