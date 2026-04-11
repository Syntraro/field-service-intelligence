/**
 * resetBusinessData — Wipe all business data from the dev database.
 *
 * Keeps auth, system, and configuration tables intact (companies, users, roles,
 * permissions, settings, tax rates, technician profiles, etc.).
 * Truncates everything else (clients, jobs, visits, invoices, suppliers, etc.).
 *
 * Safety guardrails:
 *   1. NODE_ENV must NOT be "production"
 *   2. CONFIRM_DEV_RESET=yes must be set
 *
 * Usage:
 *   CONFIRM_DEV_RESET=yes npx tsx --env-file=.env server/scripts/resetBusinessData.ts
 *
 * 2026-04-10: Created as part of dev database normalization cleanup.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";

// ── Safety checks ──────────────────────────────────────────────────────────
if (process.env.NODE_ENV === "production") {
  console.error("FATAL: resetBusinessData cannot run in production.");
  process.exit(1);
}
if (process.env.CONFIRM_DEV_RESET !== "yes") {
  console.error(
    "FATAL: Set CONFIRM_DEV_RESET=yes to confirm you want to wipe business data.\n" +
    "Usage: CONFIRM_DEV_RESET=yes npx tsx --env-file=.env server/scripts/resetBusinessData.ts"
  );
  process.exit(1);
}

// ── Tables to KEEP (auth, system, config) ──────────────────────────────────
const KEEP_TABLES = new Set([
  "companies",
  "qbo_connections",
  "users",
  "user_identities",
  "password_reset_tokens",
  "roles",
  "permissions",
  "role_permissions",
  "user_permission_overrides",
  "company_settings",
  "company_business_hours",
  "company_counters",
  "company_tax_rates",
  "company_tax_groups",
  "company_tax_group_rates",
  "subscription_plans",
  "tenant_features",
  "tenant_subscriptions",
  "subscription_events",
  "technicians",
  "technician_profiles",
  "working_hours",
  "time_alert_settings",
  "time_billing_rules",
  "session",
  "invitations",
  "invitation_tokens",
]);

// ── Tables to WIPE (business data) ────────────────────────────────────────
// Order matters: children before parents to respect FK constraints.
// Using TRUNCATE ... CASCADE handles most FK chains, but explicit ordering
// avoids surprises.
const WIPE_TABLES = [
  // Attachments / notes
  "job_note_attachments",
  "note_attachments",
  "files",
  "job_notes",
  "client_notes",
  // Feedback
  "feedback",
  // Notifications
  "notifications",
  "notification_snoozes",
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
  "supplier_visit_details",
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
  // PM billing
  "pm_billing_events",
  // Recurring jobs
  "recurring_job_instances",
  "recurring_job_phases",
  "recurring_job_series",
  "recurring_job_templates",
  // Jobs
  "jobs",
  // PM templates
  "pm_templates",
  "job_template_line_items",
  "job_templates",
  // Tasks
  "tasks",
  // Suppliers
  "supplier_locations",
  "suppliers",
  // Equipment & catalog
  "equipment_catalog_items",
  "location_equipment",
  "equipment",
  // Location PM
  "location_pm_plans",
  "location_pm_part_templates",
  // Maintenance
  "maintenance_records",
  // Client parts / items
  "client_parts",
  "items",
  // Tag assignments
  "client_tag_assignments",
  "location_tag_assignments",
  "client_tags",
  // Contact assignments
  "contact_assignments",
  "contact_persons",
  // Client locations / customer companies
  "client_locations",
  "customer_companies",
  // Technician positions
  "technician_positions",
  "technician_live_positions",
  // Audit
  "audit_events",
  "audit_logs",
  "company_audit_logs",
  "impersonation_sessions",
  // QBO sync
  "qbo_sync_events",
  "qbo_sync_queue",
  "qbo_webhook_events",
  // Portal
  "portal_magic_tokens",
  // Events / attention
  "events",
  "attention_items",
  // Leads
  "lead_notes",
  "leads",
];

async function main() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║   DEV DATABASE — BUSINESS DATA RESET        ║");
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
