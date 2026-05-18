/**
 * resetTenantData.ts — Per-tenant hard wipe of operational data.
 *
 * Scope: exactly one tenant (companyId). Preserves the tenant row and
 * everything platform/system-level (see `docs/TENANT_RESET.md`).
 *
 * Use the global sibling `server/scripts/resetBusinessData.ts` when you
 * want to wipe every tenant at once; this script is for surgical resets
 * where a specific tenant needs to be re-tested without touching others.
 *
 * Safety guardrails — ALL must be satisfied:
 *   1. `NODE_ENV` must not be "production"
 *   2. `RESET_TENANT_DATA=true` must be explicitly set.
 *
 * Usage:
 *   RESET_TENANT_DATA=true npx tsx --env-file=.env scripts/resetTenantData.ts [companyId]
 *
 * If no companyId is provided, the script targets the first company in the DB.
 *
 * 2026-04-22: Added the RESET_TENANT_DATA env gate to match the global
 *             reset script. No behavioral change to the deletion manifest.
 */

import pg from "pg";

if (process.env.NODE_ENV === "production") {
  console.error("FATAL: resetTenantData cannot run in production.");
  process.exit(1);
}
if (process.env.RESET_TENANT_DATA !== "true") {
  console.error(
    "FATAL: Set RESET_TENANT_DATA=true to confirm you want to hard-wipe tenant data.\n" +
    "Usage: RESET_TENANT_DATA=true npx tsx --env-file=.env scripts/resetTenantData.ts [companyId]"
  );
  process.exit(1);
}

const { Pool } = pg;

// ── Deletion manifest (order respects FK constraints: children first) ──
// Each entry: [tableName, tenantColumn]
// Tables with no company_id use CASCADE from their parent FK and are
// deleted via a subquery join (marked with special "SUB:" prefix).
const DELETION_ORDER: Array<[string, string]> = [
  // Time tracking (deepest children first)
  ["time_entry_lock_overrides", "company_id"],
  ["time_approvals", "company_id"],
  ["technician_job_status_events", "company_id"],
  ["time_entries", "company_id"],
  ["work_sessions", "company_id"],

  // Job children
  ["job_schedule_audit", "company_id"],
  ["job_status_events", "company_id"],
  ["job_parts", "company_id"],
  ["job_equipment", "company_id"],
  ["job_notes", "company_id"],
  ["job_visits", "company_id"],

  // Recurring job instances (FK to jobs + templates)
  ["recurring_job_instances", "company_id"],

  // Tasks (FK to jobs, client_locations)
  ["tasks", "company_id"],

  // Invoice children
  ["invoice_tax_lines", "company_id"],
  ["payments", "company_id"],
  ["invoice_lines", "company_id"],

  // Invoices (FK to client_locations, jobs)
  ["invoices", "company_id"],

  // Quote children
  ["quote_lines", "company_id"],
  ["quotes", "company_id"],
  ["quote_template_lines", "company_id"],
  ["quote_templates", "company_id"],

  // Jobs (FK to client_locations, recurring_job_series)
  ["jobs", "company_id"],

  // Recurring job templates (FK to client_locations, customer_companies)
  ["recurring_job_templates", "company_id"],
  // recurring_job_phases: no company_id — FK cascade from recurring_job_series
  ["recurring_job_phases", "SUB:series_id:recurring_job_series"],
  ["recurring_job_series", "company_id"],

  // Location children
  ["location_pm_part_templates", "company_id"],
  ["location_pm_plans", "company_id"],
  ["location_equipment", "company_id"],
  ["location_tag_assignments", "company_id"],

  // Equipment catalog items (FK to location_equipment)
  ["equipment_catalog_items", "company_id"],

  // Client notes / contacts / files / attachments
  ["note_attachments", "company_id"],
  ["client_files", "company_id"],
  ["contract_files", "company_id"],
  ["technician_files", "company_id"],
  ["files", "company_id"],
  ["client_notes", "company_id"],
  // 2026-04-22: canonical contact table is `contact_persons` (the
  // `client_contacts` entry was a stale alias from the pre-unification era).
  ["contact_assignments", "company_id"],
  ["contact_persons", "company_id"],

  // Client locations (FK to customer_companies)
  ["client_locations", "company_id"],

  // Client tag assignments + tags
  ["client_tag_assignments", "company_id"],
  ["client_tags", "company_id"],

  // Customer companies
  ["customer_companies", "company_id"],

  // Items / parts / equipment / maintenance
  ["client_parts", "company_id"],
  ["items", "company_id"],
  ["equipment", "company_id"],
  ["maintenance_records", "company_id"],

  // Job templates (line items have no company_id — cascade from job_templates)
  ["job_template_line_items", "SUB:template_id:job_templates"],
  ["job_templates", "company_id"],

  // QBO sync data
  ["qbo_sync_events", "company_id"],
  ["qbo_sync_queue", "company_id"],
  ["qbo_webhook_events", "company_id"],

  // Events & attention (use tenant_id)
  ["attention_items", "tenant_id"],
  ["events", "tenant_id"],

  // Notifications + email deliveries
  ["notification_targets", "company_id"],
  ["notifications", "company_id"],
  ["email_deliveries", "company_id"],

  // Audit / activity
  ["company_audit_logs", "company_id"],
  ["audit_logs", "target_company_id"],  // platform admin audit uses target_company_id
  ["audit_events", "company_id"],
  ["impersonation_sessions", "company_id"],

  // Legacy tables (technicians + labor entries)
  ["labor_entries", "company_id"],
  ["technicians", "company_id"],

  // Invitations
  ["invitations", "company_id"],
  ["invitation_tokens", "company_id"],

  // Technician GPS
  ["technician_positions", "company_id"],
  ["technician_live_positions", "company_id"],

  // Feedback
  ["feedback", "company_id"],

  // Company counters (reset job number sequences)
  ["company_counters", "company_id"],

  // Portal magic tokens
  ["portal_magic_tokens", "company_id"],

  // Company tax configuration (group_rates has no company_id — cascade from groups)
  ["company_tax_group_rates", "SUB:group_id:company_tax_groups"],
  ["company_tax_groups", "company_id"],
  ["company_tax_rates", "company_id"],

  // Subscription events (operational log, safe to clear)
  ["subscription_events", "company_id"],

  // Notification snoozes (operational)
  ["notification_snoozes", "company_id"],

  // Reference field values (tenant-owned data; definitions preserved)
  ["reference_field_values", "company_id"],

  // Leads + lead notes
  ["lead_notes", "company_id"],
  ["leads", "company_id"],

  // Quote notes (tenant annotations on quotes)
  ["quote_notes", "company_id"],
];

// Tables to verify are preserved (spot-check counts after reset)
const PRESERVE_TABLES: Array<[string, string]> = [
  ["companies", "id"],
  ["users", "company_id"],
  ["tenant_features", "company_id"],
];

// Key operational tables to report before/after counts
const REPORT_TABLES: Array<[string, string]> = [
  ["customer_companies", "company_id"],
  ["client_locations", "company_id"],
  ["client_contacts", "company_id"],
  ["jobs", "company_id"],
  ["job_visits", "company_id"],
  ["tasks", "company_id"],
  ["invoices", "company_id"],
  ["payments", "company_id"],
  ["quotes", "company_id"],
  ["items", "company_id"],
  ["events", "tenant_id"],
  ["attention_items", "tenant_id"],
  ["notifications", "company_id"],
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // ── Step 1: Resolve tenant ──
    let companyId = process.argv[2];
    if (!companyId) {
      const res = await pool.query("SELECT id, name FROM companies LIMIT 1");
      if (res.rows.length === 0) {
        console.error("No companies found in database.");
        process.exit(1);
      }
      companyId = res.rows[0].id;
      console.log(`No companyId argument provided — using first company: "${res.rows[0].name}" (${companyId})`);
    } else {
      const res = await pool.query("SELECT id, name FROM companies WHERE id = $1", [companyId]);
      if (res.rows.length === 0) {
        console.error(`Company not found: ${companyId}`);
        process.exit(1);
      }
      console.log(`Target tenant: "${res.rows[0].name}" (${companyId})`);
    }

    // ── Step 2: Pre-reset counts (safety check) ──
    console.log("\n=== PRE-RESET COUNTS ===");
    const preCounts: Record<string, number> = {};
    for (const [table, col] of REPORT_TABLES) {
      try {
        const colFilter = col === "id" ? `id = $1` : `${col} = $1`;
        const r = await pool.query(`SELECT COUNT(*)::int AS cnt FROM ${table} WHERE ${colFilter}`, [companyId]);
        preCounts[table] = r.rows[0].cnt;
        console.log(`  ${table}: ${r.rows[0].cnt}`);
      } catch {
        // Table may not exist yet in the live DB
        preCounts[table] = 0;
        console.log(`  ${table}: (table not found)`);
      }
    }

    if (Object.values(preCounts).every((c) => c === 0)) {
      console.log("\nAll operational tables are already empty. Nothing to reset.");
      process.exit(0);
    }

    // ── Step 3: Execute deletion in a transaction ──
    console.log("\n=== EXECUTING RESET (transaction) ===");
    const client = await pool.connect();
    const deletedCounts: Record<string, number> = {};

    try {
      await client.query("BEGIN");

      for (const [table, col] of DELETION_ORDER) {
        // Use SAVEPOINT so a missing-table error doesn't abort the entire txn
        const sp = `sp_${table.replace(/[^a-z0-9_]/g, "")}`;
        await client.query(`SAVEPOINT ${sp}`);
        try {
          let result;
          if (col.startsWith("SUB:")) {
            // Subquery delete: col = "SUB:fk_column:parent_table"
            const [, fkCol, parentTable] = col.split(":");
            result = await client.query(
              `DELETE FROM ${table} WHERE ${fkCol} IN (SELECT id FROM ${parentTable} WHERE company_id = $1)`,
              [companyId],
            );
          } else {
            result = await client.query(`DELETE FROM ${table} WHERE ${col} = $1`, [companyId]);
          }
          await client.query(`RELEASE SAVEPOINT ${sp}`);
          const count = result.rowCount ?? 0;
          deletedCounts[table] = count;
          if (count > 0) {
            console.log(`  DELETE ${table}: ${count} rows`);
          }
        } catch (err: any) {
          await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
          // Skip tables/columns that don't exist in the live DB yet
          if (err.code === "42P01" || err.code === "42703") {
            // 42P01 = undefined_table, 42703 = undefined_column
            const reason = err.code === "42P01" ? "table does not exist" : "column does not exist";
            console.log(`  SKIP  ${table}: ${reason}`);
            deletedCounts[table] = 0;
          } else {
            throw err; // re-throw real errors to trigger rollback
          }
        }
      }

      await client.query("COMMIT");
      console.log("\nTransaction committed successfully.");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("\nTransaction ROLLED BACK due to error:");
      console.error(err);
      process.exit(1);
    } finally {
      client.release();
    }

    // ── Step 4: Post-reset verification ──
    console.log("\n=== POST-RESET VERIFICATION ===");
    let allZero = true;
    for (const [table, col] of REPORT_TABLES) {
      try {
        const colFilter = col === "id" ? `id = $1` : `${col} = $1`;
        const r = await pool.query(`SELECT COUNT(*)::int AS cnt FROM ${table} WHERE ${colFilter}`, [companyId]);
        const cnt = r.rows[0].cnt;
        console.log(`  ${table}: ${cnt}${cnt > 0 ? " *** NOT ZERO ***" : ""}`);
        if (cnt > 0) allZero = false;
      } catch {
        console.log(`  ${table}: (table not found)`);
      }
    }

    // Verify preserved tables
    console.log("\n=== PRESERVED TABLES (must still have data) ===");
    for (const [table, col] of PRESERVE_TABLES) {
      try {
        const colFilter = col === "id" ? `id = $1` : `${col} = $1`;
        const r = await pool.query(`SELECT COUNT(*)::int AS cnt FROM ${table} WHERE ${colFilter}`, [companyId]);
        console.log(`  ${table}: ${r.rows[0].cnt}${r.rows[0].cnt === 0 ? " *** MISSING ***" : " OK"}`);
      } catch {
        console.log(`  ${table}: (table not found)`);
      }
    }

    // ── Step 5: Summary report ──
    console.log("\n========================================");
    console.log("       TENANT RESET COMPLETE");
    console.log("========================================");
    console.log(`  Tenant ID:          ${companyId}`);
    console.log(`  Clients Deleted:    ${deletedCounts["customer_companies"] ?? 0}`);
    console.log(`  Locations Deleted:  ${deletedCounts["client_locations"] ?? 0}`);
    console.log(`  Contacts Deleted:   ${deletedCounts["client_contacts"] ?? 0}`);
    console.log(`  Jobs Deleted:       ${deletedCounts["jobs"] ?? 0}`);
    console.log(`  Visits Deleted:     ${deletedCounts["job_visits"] ?? 0}`);
    console.log(`  Tasks Deleted:      ${deletedCounts["tasks"] ?? 0}`);
    console.log(`  Invoices Deleted:   ${deletedCounts["invoices"] ?? 0}`);
    console.log(`  Payments Deleted:   ${deletedCounts["payments"] ?? 0}`);
    console.log(`  Quotes Deleted:     ${deletedCounts["quotes"] ?? 0}`);
    console.log(`  Items Deleted:      ${deletedCounts["items"] ?? 0}`);
    console.log(`  Events Deleted:     ${deletedCounts["events"] ?? 0}`);
    console.log(`  Notifications:      ${deletedCounts["notifications"] ?? 0}`);
    console.log("========================================");

    if (!allZero) {
      console.log("\nWARNING: Some operational tables still have data. Review above.");
      process.exit(1);
    }
    console.log("\nTenant is ready for production QuickBooks import.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
