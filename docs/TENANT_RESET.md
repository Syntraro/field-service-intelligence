# Tenant Data Reset

Canonical procedure for hard-wiping tenant operational data so the app can be
re-tested from a clean baseline, without breaking auth, subscriptions, or
required system configuration.

> **This is a destructive operation.** It truncates client, job, visit, invoice,
> quote, file, lead, and notification data across every tenant in the target
> database. Run it only against a development or staging database that you
> explicitly want to wipe.

---

## Scripts

The repo ships two reset scripts with the same classification rules and the
same env gates. Pick the one that matches your scope:

| Script | Scope | Typical use |
|---|---|---|
| `server/scripts/resetBusinessData.ts` | **All tenants** — wipes the whole database of tenant operational data | Full dev reset before a feature-testing sweep. Canonical for "start fresh". |
| `scripts/resetTenantData.ts` | **One tenant** (by `companyId`) | Targeted reset when only one test tenant needs a clean slate. |

Both scripts preserve boot-critical platform data, keep users logged in, and
leave subscriptions/settings/QBO tokens intact.

---

## Safety guardrails

Both scripts refuse to run unless **every** guard is satisfied:

1. `NODE_ENV` is not `"production"`.
2. `RESET_TENANT_DATA=true` is set in the environment.
   (The legacy flag `CONFIRM_DEV_RESET=yes` on `resetBusinessData.ts` is still
   accepted for back-compat with pre-2026-04-22 CI scripts.)

If either guard is missing, the script prints a fatal error and exits
non-zero before touching the database.

---

## Usage

### Wipe every tenant

```bash
RESET_TENANT_DATA=true npm run db:reset:business
```

…or call the script directly:

```bash
RESET_TENANT_DATA=true npx tsx --env-file=.env server/scripts/resetBusinessData.ts
```

The script logs every table it truncates, skips tables that don't exist yet
(useful during schema drift), and finishes by resetting company counters
(`next_job_number`, `next_invoice_number`, `next_quote_number`) to 1.

### Wipe one tenant

```bash
RESET_TENANT_DATA=true npx tsx --env-file=.env scripts/resetTenantData.ts <companyId>
```

Omit `<companyId>` to target the first company in the database (useful when
you're running against a single-tenant dev DB).

The per-tenant script runs inside a single transaction with savepoints; any
unexpected error rolls back the whole reset.

---

## What gets wiped

Tenant-owned operational data (FK-ordered; `TRUNCATE … CASCADE` handles the
children automatically in the global script):

- **CRM** — `customer_companies`, `client_locations`, `contact_persons`,
  `contact_assignments`, `client_tags`, `client_tag_assignments`,
  `location_tag_assignments`, `client_notes`, `client_files`, `contract_files`,
  `technician_files`, `leads`, `lead_notes`
- **Catalog** — `items`, `client_parts`, `maintenance_records`, `equipment`,
  `location_equipment`, `equipment_catalog_items`, `job_equipment`
- **Jobs** — `jobs`, `job_notes`, `job_visits`, `job_status_events`,
  `job_schedule_audit`, `job_parts`, `job_expenses`, `job_note_attachments`,
  `recurring_job_series`, `recurring_job_phases`, `recurring_job_templates`,
  `recurring_job_instances`, `job_templates`, `job_template_line_items`,
  `location_pm_plans`, `location_pm_part_templates`, `pm_templates`,
  `pm_billing_events`
- **Tasks / suppliers** — `tasks`, `supplier_visit_details`, `suppliers`,
  `supplier_locations`
- **Invoicing** — `invoices`, `invoice_lines`, `invoice_tax_lines`, `payments`,
  `quotes`, `quote_lines`, `quote_notes`, `quote_templates`, `quote_template_lines`
- **Files / attachments** — `files`, `note_attachments`
- **Time tracking** — `work_sessions`, `time_entries`, `time_entry_lock_overrides`,
  `time_approvals`, `technician_job_status_events`, `labor_entries`
- **Notifications** — `notifications`, `notification_targets`,
  `notification_snoozes`, `email_deliveries`
- **GPS / events** — `technician_positions`, `technician_live_positions`,
  `events`, `attention_items`
- **Portal** — `portal_magic_tokens`
- **Audit / activity logs** — `audit_events`, `audit_logs`,
  `company_audit_logs`, `impersonation_sessions`
- **QBO sync log** — `qbo_sync_events`, `qbo_sync_queue`, `qbo_webhook_events`
- **Reference field values** — `reference_field_values` (definitions preserved)
- **Feedback** — `feedback` (tenant-submitted)
- **Counters** — `company_counters` numeric sequences reset to 1 at the end
  of the global script (the row itself is preserved).

## What gets preserved

Anything the app needs to boot, authenticate, or resume tenant configuration:

- **Tenant roots** — `companies`
- **Auth** — `users`, `user_identities`, `password_reset_tokens`, `session`
- **RBAC** — `roles`, `permissions`, `role_permissions`,
  `user_permission_overrides`
- **Per-tenant config** — `company_settings`, `company_business_hours`,
  `company_counters` (row), `company_tax_rates`, `company_tax_groups`,
  `company_tax_group_rates`, `payroll_settings`, `time_alert_settings`,
  `time_billing_rules`
- **Subscription catalog + state** — `subscription_plans`,
  `subscription_features`, `subscription_plan_features`,
  `subscription_plan_metadata`, `tenant_subscriptions`, `subscription_events`,
  `tenant_feature_overrides`
- **Technician config** — `technicians`, `technician_profiles`, `working_hours`
- **Invites in-flight** — `invitations`, `invitation_tokens`
- **Reference / catalogs** — `equipment_types`, `reference_field_definitions`,
  `communication_templates`
- **Per-user preferences** — `notification_preferences`
- **Platform support artifacts** — `issue_reports`, `internal_support_notes`
- **Integrations** — `qbo_connections` (OAuth tokens; preserved so the tenant
  doesn't have to reconnect QBO after every reset)

---

## Post-reset state

After the wipe you can log back in with the same credentials. You will land on
a clean account with:

- No clients, locations, contacts, jobs, visits, invoices, quotes, items,
  tasks, notifications, or files.
- Your existing subscription, role assignments, permissions, and settings
  (timezone, business hours, tax, payroll rules) intact.
- Job / invoice / quote numbering restarted at 1.
- QBO connection (if any) preserved — no reconnect needed.
- Dashboard view preference (`syntraro:dashboard-view` in localStorage) is
  client-side and persists across DB resets. Clear it manually if you want
  fresh-user behavior on the Dashboard.

---

## Orphan-storage note

File metadata rows (`files`, `client_files`, `contract_files`,
`technician_files`, `note_attachments`, `job_note_attachments`) are truncated
by these scripts, but the underlying object-storage (R2) blobs referenced by
those rows are **not** cleaned up here. For dev/staging buckets this is
usually acceptable — the orphaned blobs are cheap and the canonical
`deleteFile` service already drops R2 objects when files are individually
deleted. If you need the bucket to match the reset DB, purge the bucket
manually as a separate step.

Out-of-scope risks explicitly acknowledged:

- Orphan R2 blobs (see above).
- Any external integration that mirrors tenant data (QBO, Stripe) — those
  services will retain their records; reconnect/repoint as needed.

---

## Extending the reset

If you add a new tenant-owned table:

1. Add it to `WIPE_TABLES` in `server/scripts/resetBusinessData.ts`.
2. Add it to `DELETION_ORDER` in `scripts/resetTenantData.ts`, respecting
   FK parent-before-child order. Use the `"SUB:fkCol:parentTable"` marker
   for tables that don't carry `company_id` directly.
3. Update the wipe list in this document.

If you add a new reference / config / catalog table that every tenant
depends on:

1. Add it to `KEEP_TABLES` in the global script.
2. Leave it out of `DELETION_ORDER` in the per-tenant script.
3. Update the preserve list above.
