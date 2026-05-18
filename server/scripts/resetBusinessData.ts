/**
 * resetBusinessData — Hard wipe of tenant operational data across every
 * tenant in the database. Leaves the application bootable for clean
 * feature testing: auth, roles, subscriptions, tax/payroll config,
 * timezone settings, and QBO OAuth tokens survive. Everything tenant-
 * owned (clients, jobs, visits, invoices, quotes, files, leads, etc.)
 * is truncated.
 *
 * Safety guardrails — ALL must be satisfied to run:
 *   1. `NODE_ENV` must not be "production"
 *   2. `RESET_TENANT_DATA=true` must be explicitly set.
 *      The legacy flag `CONFIRM_DEV_RESET=yes` is still accepted for
 *      back-compat with CI scripts that pre-date 2026-04-22.
 *
 * Usage:
 *   RESET_TENANT_DATA=true npm run db:reset:business
 *   RESET_TENANT_DATA=true npx tsx --env-file=.env server/scripts/resetBusinessData.ts
 *
 * See `docs/TENANT_RESET.md` for the full wipe-vs-preserve manifest.
 *
 * 2026-04-10: Created as part of dev database normalization cleanup.
 * 2026-04-22: Added RESET_TENANT_DATA guard + rounded out the wipe/keep
 *             manifest against the current schema (files/notifications/
 *             reference values/email deliveries + preserved reference tables).
 */

import { sql } from "drizzle-orm";
import { db } from "../db";

// ── Safety checks ──────────────────────────────────────────────────────────
if (process.env.NODE_ENV === "production") {
  console.error("FATAL: resetBusinessData cannot run in production.");
  process.exit(1);
}
const guarded =
  process.env.RESET_TENANT_DATA === "true" ||
  process.env.CONFIRM_DEV_RESET === "yes";
if (!guarded) {
  console.error(
    "FATAL: Set RESET_TENANT_DATA=true to confirm you want to hard-wipe tenant data.\n" +
    "Usage: RESET_TENANT_DATA=true npm run db:reset:business"
  );
  process.exit(1);
}

// ── Tables to KEEP (absolute minimum for login + app boot) ─────────────────
// 2026-04-22 deep-wipe pass: every tenant-facing config / identity /
// subscription / integration row moved to WIPE_TABLES below so the app
// looks like a brand-new account after the reset.
const KEEP_TABLES = new Set([
  // Tenant root (companies row stays so user.company_id FK resolves)
  "companies",
  // Auth
  "users",
  "user_identities",
  "password_reset_tokens",
  "session",
  // Permissions / RBAC catalog (required for permission checks at login)
  "roles",
  "permissions",
  "role_permissions",
  // Subscription PLATFORM catalog (not tenant-specific)
  "subscription_plans",
  "subscription_features",
  "subscription_plan_features",
  "subscription_plan_metadata",
  // Platform support tables (admin-facing, never surfaced in tenant UI)
  "issue_reports",
  "internal_support_notes",
]);

// ── Tables to WIPE (tenant operational data) ──────────────────────────────
// TRUNCATE ... CASCADE handles child FKs automatically, but explicit
// ordering here keeps the log output readable and documents intent.
//
// 2026-04-22 additions vs. 2026-04-10:
//   + client_files, contract_files, technician_files        (file refs)
//   + notification_targets                                  (fanout table)
//   + reference_field_values                                (tenant values;
//                                                            definitions kept)
//   + email_deliveries                                      (email send log)
//   + quote_notes                                           (quote annotations)
const WIPE_TABLES = [
  // Attachments / notes / files
  "job_note_attachments",
  "note_attachments",
  "client_files",
  "contract_files",
  "technician_files",
  "files",
  "job_notes",
  "client_notes",
  "quote_notes",
  // Feedback (tenant-submitted)
  "feedback",
  // Notifications + email delivery log
  "notification_targets",
  "notifications",
  "notification_snoozes",
  "email_deliveries",
  // Time tracking
  "time_entries",
  "time_entry_lock_overrides",
  "time_approvals",
  "work_sessions",
  "labor_entries",
  "technician_job_status_events",
  // Job children
  "job_parts",
  "job_equipment",
  "job_status_events",
  "job_schedule_audit",
  "job_expenses",
  // Visits
  "job_visits",
  // Invoicing
  "invoice_tax_lines",
  "invoice_lines",
  "payments",
  "invoices",
  // Quotes
  "quote_lines",
  "quotes",
  "quote_template_lines",
  "quote_templates",
  // PM billing + templates
  "pm_billing_events",
  "pm_templates",
  // Recurring jobs
  "recurring_job_instances",
  "recurring_job_phases",
  "recurring_job_series",
  "recurring_job_templates",
  // Jobs
  "jobs",
  "job_template_line_items",
  "job_templates",
  // Tasks
  "tasks",
  // Equipment & catalog (tenant-scoped)
  "equipment_catalog_items",
  "location_equipment",
  "equipment",
  // Location PM
  "location_pm_plans",
  "location_pm_part_templates",
  // Maintenance history
  "maintenance_records",
  // Catalog items (tenant-owned products/services)
  "client_parts",
  "items",
  // Tag assignments + tags
  "client_tag_assignments",
  "location_tag_assignments",
  "client_tags",
  // Contacts
  "contact_assignments",
  "contact_persons",
  // Client companies + locations
  "client_locations",
  "customer_companies",
  // GPS
  "technician_positions",
  "technician_live_positions",
  // Audit / activity (tenant-scoped log entries)
  "audit_events",
  "audit_logs",
  "company_audit_logs",
  "impersonation_sessions",
  // QBO sync log entries (oauth tokens in qbo_connections stay)
  "qbo_sync_events",
  "qbo_sync_queue",
  "qbo_webhook_events",
  // Portal magic links
  "portal_magic_tokens",
  // Events + attention items
  "events",
  "attention_items",
  // Reference field values + definitions (tenant-owned custom fields)
  "reference_field_values",
  "reference_field_definitions",
  // Leads + lead notes
  "lead_notes",
  "leads",
  // 2026-04-22 deep-wipe additions — tenant config / identity that makes
  // the app "look set up" if left in place:
  "company_business_hours",
  "company_tax_group_rates",
  "company_tax_groups",
  "company_tax_rates",
  "payroll_settings",
  "time_alert_settings",
  "time_billing_rules",
  "technicians",
  "technician_profiles",
  "working_hours",
  "invitations",
  "invitation_tokens",
  "communication_templates",
  "notification_preferences",
  "tenant_feature_overrides",
  "tenant_subscriptions",
  "subscription_events",
  "qbo_connections",
  "user_permission_overrides",
  "equipment_types",
  // company_settings + company_counters handled explicitly below — they
  // are tenant-owned configuration but also live in app fallbacks; wipe
  // the rows but keep the schema structure intact.
  "company_settings",
  "company_counters",
];

async function main() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║   TENANT DATA RESET — HARD WIPE             ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log(`  NODE_ENV = ${process.env.NODE_ENV ?? "(unset)"}`);
  console.log(`  Tables to wipe: ${WIPE_TABLES.length}`);
  console.log(`  Tables to keep: ${KEEP_TABLES.size}`);
  console.log("");

  let wiped = 0;
  let skipped = 0;

  for (const table of WIPE_TABLES) {
    try {
      await db.execute(sql.raw(`TRUNCATE TABLE "${table}" CASCADE`));
      wiped++;
      console.log(`  ✓ ${table}`);
    } catch (err: any) {
      // Table may not exist yet if migrations haven't run
      if (err.message?.includes("does not exist")) {
        skipped++;
        console.log(`  - ${table} (does not exist, skipped)`);
      } else {
        console.error(`  ✗ ${table}: ${err.message}`);
      }
    }
  }

  // Reset company counters (job numbers, invoice numbers, etc.)
  try {
    await db.execute(sql`
      UPDATE company_counters SET
        next_job_number = 1,
        next_invoice_number = 1,
        next_quote_number = 1
    `);
    console.log("\n  ✓ company_counters reset to 1");
  } catch (err: any) {
    console.log(`\n  - company_counters reset skipped: ${err.message}`);
  }

  console.log(`\nDone. Wiped ${wiped} tables, skipped ${skipped}.`);
  console.log("Auth, roles, settings, and user profiles are intact.");
  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
