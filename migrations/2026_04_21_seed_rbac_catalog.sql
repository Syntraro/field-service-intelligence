-- 2026-04-21 Phase 1: RBAC catalog promoted from on-demand to migration-driven.
--
-- Prior implementation (server/routes/roles.ts:ensureRolesAndPermissionsSeeded)
-- lazily seeded the roles + permissions tables on the first GET /api/roles.
-- That is fragile: new tenants whose admins never open Manage Roles have no
-- catalog rows, and per-tenant caches can resolve different effective
-- permissions than expected.
--
-- This migration seeds the canonical 36 permissions + 5 default roles + the
-- role→permission mappings up front. Idempotent via ON CONFLICT.
--
-- Canonical permission contract (per Phase 1 plan):
--   Coarse gate  = code-based roles (MANAGER_ROLES etc. in server/auth/roles.ts)
--   Fine gate    = requirePermission(key) — ONE demonstration adoption in
--                  Phase 1 (permissions.manage on permission-management routes)
--   User exception = user_permission_overrides (write path shipped in Phase 1)
--
-- Run via: npm run db:migrate

-- ========================================================================
-- PERMISSIONS CATALOG (36 keys)
-- ========================================================================

INSERT INTO permissions (key, "group", label, description) VALUES
  -- Schedule
  ('schedule.own.view',      'schedule', 'View Own Schedule',       'View your assigned jobs and schedule'),
  ('schedule.own.complete',  'schedule', 'Complete Own Jobs',       'Mark your assigned jobs as complete'),
  ('schedule.own.edit',      'schedule', 'Edit Own Schedule',       'Modify your own scheduled jobs'),
  ('schedule.all.view',      'schedule', 'View All Schedules',      'View all technicians schedules'),
  ('schedule.all.edit',      'schedule', 'Edit All Schedules',      'Modify any technicians schedule'),
  ('schedule.all.delete',    'schedule', 'Delete Scheduled Jobs',   'Remove jobs from the schedule'),

  -- Time Tracking
  ('time.own.edit',          'time',     'Edit Own Time',           'Track and edit your own time entries'),
  ('time.all.view',          'time',     'View All Time',           'View all team members time entries'),
  ('time.all.edit',          'time',     'Edit All Time',           'Edit any team members time entries'),
  ('time.approve',           'time',     'Approve Timesheets',      'Approve submitted timesheets'),

  -- Notes
  ('notes.jobs.view',        'notes',    'View Job Notes',          'View notes on jobs you are assigned to'),
  ('notes.all.view',         'notes',    'View All Notes',          'View all notes across jobs and clients'),
  ('notes.all.edit',         'notes',    'Edit All Notes',          'Create and edit notes on any job or client'),
  ('notes.all.delete',       'notes',    'Delete Notes',            'Delete any notes'),

  -- Expenses
  ('expenses.own.edit',      'expenses', 'Edit Own Expenses',       'Submit and edit your own expenses'),
  ('expenses.all.view',      'expenses', 'View All Expenses',       'View all team expenses'),
  ('expenses.all.edit',      'expenses', 'Edit All Expenses',       'Edit any team members expenses'),
  ('expenses.approve',       'expenses', 'Approve Expenses',        'Approve submitted expenses'),

  -- Clients
  ('clients.view.basic',     'clients',  'View Client Basics',      'View client names and addresses'),
  ('clients.view.full',      'clients',  'View Full Client Info',   'View complete client details including contacts'),
  ('clients.edit',           'clients',  'Edit Clients',            'Create and modify client information'),
  ('clients.delete',         'clients',  'Delete Clients',          'Delete client records'),

  -- Work (Quotes, Jobs, Invoices)
  ('quotes.view',            'work',     'View Quotes',             'View quote details'),
  ('quotes.edit',            'work',     'Edit Quotes',             'Create and modify quotes'),
  ('quotes.approve',         'work',     'Approve Quotes',          'Approve quotes for sending'),
  ('jobs.view',              'work',     'View Jobs',               'View job details'),
  ('jobs.edit',              'work',     'Edit Jobs',               'Create and modify jobs'),
  ('jobs.delete',            'work',     'Delete Jobs',             'Delete job records'),
  ('invoices.view',          'work',     'View Invoices',           'View invoice details'),
  ('invoices.edit',          'work',     'Edit Invoices',           'Create and modify invoices'),
  ('invoices.send',          'work',     'Send Invoices',           'Send invoices to clients'),

  -- Pricing & Costing
  ('pricing.view',           'pricing',  'View Pricing',            'View item and service pricing'),
  ('pricing.edit',           'pricing',  'Edit Pricing',            'Modify item and service pricing'),
  ('job_costing.view',       'pricing',  'View Job Costing',        'View job cost breakdowns and profitability'),

  -- Payments
  ('payments.view',          'payments', 'View Payments',           'View payment records'),
  ('payments.collect',       'payments', 'Collect Payments',        'Record and collect payments'),
  ('payments.refund',        'payments', 'Process Refunds',         'Process payment refunds'),

  -- Reports
  ('reports.view.basic',     'reports',  'View Basic Reports',      'View operational reports'),
  ('reports.view.financial', 'reports',  'View Financial Reports',  'View financial and revenue reports'),

  -- Admin
  ('team.view',              'admin',    'View Team',               'View team member list'),
  ('team.manage',            'admin',    'Manage Team',             'Add, edit, and remove team members'),
  ('roles.manage',           'admin',    'Manage Roles',            'Create and modify roles and permissions'),
  ('permissions.manage',     'admin',    'Manage Permissions',      'Grant or revoke permissions for specific users; configure role-permission mappings'),
  ('settings.manage',        'admin',    'Manage Settings',         'Modify company settings'),
  ('integrations.manage',    'admin',    'Manage Integrations',     'Configure third-party integrations')
ON CONFLICT (key) DO UPDATE SET
  "group"     = EXCLUDED."group",
  label       = EXCLUDED.label,
  description = EXCLUDED.description;

-- ========================================================================
-- ROLES (5 system roles + 1 custom template)
-- ========================================================================

INSERT INTO roles (name, description, is_system_role) VALUES
  ('owner',      'Full system access with all permissions',         true),
  ('admin',      'Administrative access to manage team and settings', true),
  ('manager',    'Manage jobs, clients, invoices, and view reports', true),
  ('dispatcher', 'Schedule jobs and manage daily operations',        true),
  ('technician', 'Field work with limited administrative access',    true),
  ('custom',     'Custom role with configurable permissions',        false)
ON CONFLICT (name) DO UPDATE SET
  description    = EXCLUDED.description,
  is_system_role = EXCLUDED.is_system_role;

-- ========================================================================
-- ROLE-PERMISSION MAPPINGS
-- ========================================================================
--
-- owner + admin get every permission (system-wide administrators).
-- manager gets operational + financial view.
-- dispatcher gets scheduling + client ops without financial writes.
-- technician gets own-schedule + own-time only.
-- custom starts with no permissions.

-- owner: ALL permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.name = 'owner'
ON CONFLICT DO NOTHING;

-- admin: ALL permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;

-- manager: operational + reporting + basic team view (no team.manage,
-- no permissions.manage, no roles.manage, no pricing.edit,
-- no reports.view.financial? → include financial view per current catalog,
-- exclude edit-pricing / delete-clients / delete-jobs)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.name = 'manager' AND p.key IN (
  'schedule.own.view', 'schedule.own.complete', 'schedule.own.edit',
  'schedule.all.view', 'schedule.all.edit',
  'time.own.edit', 'time.all.view', 'time.all.edit', 'time.approve',
  'notes.jobs.view', 'notes.all.view', 'notes.all.edit',
  'expenses.own.edit', 'expenses.all.view', 'expenses.all.edit', 'expenses.approve',
  'clients.view.basic', 'clients.view.full', 'clients.edit',
  'quotes.view', 'quotes.edit', 'quotes.approve',
  'jobs.view', 'jobs.edit',
  'invoices.view', 'invoices.edit', 'invoices.send',
  'pricing.view', 'job_costing.view',
  'payments.view', 'payments.collect',
  'reports.view.basic', 'reports.view.financial',
  'team.view'
)
ON CONFLICT DO NOTHING;

-- dispatcher: scheduling + job ops + client view
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.name = 'dispatcher' AND p.key IN (
  'schedule.own.view', 'schedule.own.complete', 'schedule.own.edit',
  'schedule.all.view', 'schedule.all.edit',
  'time.own.edit', 'time.all.view',
  'notes.jobs.view', 'notes.all.view', 'notes.all.edit',
  'expenses.own.edit',
  'clients.view.basic', 'clients.view.full', 'clients.edit',
  'quotes.view',
  'jobs.view', 'jobs.edit',
  'invoices.view',
  'team.view'
)
ON CONFLICT DO NOTHING;

-- technician: own-work only
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.name = 'technician' AND p.key IN (
  'schedule.own.view', 'schedule.own.complete',
  'time.own.edit',
  'notes.jobs.view',
  'expenses.own.edit',
  'clients.view.basic',
  'jobs.view'
)
ON CONFLICT DO NOTHING;
