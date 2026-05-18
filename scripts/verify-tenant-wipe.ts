/**
 * verify-tenant-wipe — Post-wipe sanity query.
 *
 * Runs COUNT(*) against every table touched by the reset scripts and
 * prints the totals in the categories the wipe deliverable asks for.
 * Read-only: no writes, no guards needed.
 */

import { sql } from "drizzle-orm";
import { db } from "../server/db";

interface Group {
  heading: string;
  tables: string[];
}

const GROUPS: Group[] = [
  { heading: "Clients",          tables: ["customer_companies", "client_locations", "contact_persons", "contact_assignments", "client_tags", "client_tag_assignments", "location_tag_assignments", "client_notes", "client_files", "contract_files", "technician_files", "client_parts"] },
  { heading: "Leads",            tables: ["leads", "lead_notes"] },
  { heading: "Jobs",             tables: ["jobs", "job_notes", "job_status_events", "job_schedule_audit", "job_parts", "job_equipment", "job_expenses", "job_note_attachments", "job_templates", "job_template_line_items"] },
  { heading: "Visits / dispatch",tables: ["job_visits", "events", "attention_items", "technician_positions", "technician_live_positions"] },
  { heading: "Quotes",           tables: ["quotes", "quote_lines", "quote_notes", "quote_templates", "quote_template_lines"] },
  { heading: "Invoices",         tables: ["invoices", "invoice_lines", "invoice_tax_lines"] },
  { heading: "Payments",         tables: ["payments"] },
  { heading: "Tasks",            tables: ["tasks"] },
  { heading: "PM / recurring",   tables: ["pm_templates", "pm_billing_events", "recurring_job_series", "recurring_job_phases", "recurring_job_templates", "recurring_job_instances", "location_pm_plans", "location_pm_part_templates", "maintenance_records"] },
  { heading: "Files / notes",    tables: ["files", "note_attachments"] },
  { heading: "Time tracking",    tables: ["time_entries", "time_entry_lock_overrides", "time_approvals", "work_sessions", "labor_entries", "technician_job_status_events"] },
  { heading: "Notifications",    tables: ["notifications", "notification_targets", "notification_snoozes", "email_deliveries"] },
  { heading: "Audit logs",       tables: ["audit_events", "audit_logs", "company_audit_logs", "impersonation_sessions"] },
  { heading: "Reference values", tables: ["reference_field_values", "reference_field_definitions"] },
  { heading: "Catalog / equipment", tables: ["items", "equipment", "equipment_catalog_items", "location_equipment", "equipment_types"] },
  { heading: "QBO integration",  tables: ["qbo_sync_events", "qbo_sync_queue", "qbo_webhook_events", "qbo_connections"] },
  { heading: "Portal tokens",    tables: ["portal_magic_tokens"] },
  { heading: "Feedback (tenant-submitted)", tables: ["feedback"] },
  { heading: "Tenant config",    tables: ["company_settings", "company_business_hours", "company_counters", "company_tax_rates", "company_tax_groups", "company_tax_group_rates", "payroll_settings", "time_alert_settings", "time_billing_rules", "communication_templates", "notification_preferences"] },
  { heading: "Tenant users/tech",tables: ["technicians", "technician_profiles", "working_hours", "invitations", "invitation_tokens", "user_permission_overrides"] },
  { heading: "Tenant subs",      tables: ["tenant_subscriptions", "subscription_events", "tenant_feature_overrides"] },
];

const PRESERVE_CHECK: { table: string; desc: string }[] = [
  { table: "companies",                desc: "tenant root — 1 row preserved for login FK" },
  { table: "users",                    desc: "user accounts — preserved for login" },
  { table: "user_identities",          desc: "auth identities — preserved for login" },
  { table: "roles",                    desc: "RBAC roles — preserved" },
  { table: "permissions",              desc: "RBAC permissions — preserved" },
  { table: "role_permissions",         desc: "RBAC mapping — preserved" },
  { table: "subscription_plans",       desc: "platform plan catalog — preserved" },
  { table: "subscription_features",    desc: "platform feature catalog — preserved" },
  { table: "subscription_plan_features", desc: "platform plan↔feature — preserved" },
  { table: "subscription_plan_metadata", desc: "platform plan metadata — preserved" },
];

async function countTable(table: string): Promise<number | null> {
  try {
    const result = await db.execute<{ cnt: string }>(
      sql.raw(`SELECT COUNT(*)::text AS cnt FROM "${table}"`),
    );
    const row = (result as any).rows?.[0] ?? (result as any)[0];
    const raw = row?.cnt ?? row?.count ?? "0";
    return Number(raw);
  } catch (err: any) {
    if (err.message?.includes("does not exist")) return null;
    throw err;
  }
}

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  POST-WIPE VERIFICATION");
  console.log("═══════════════════════════════════════════════════");
  console.log("");

  let grandTotal = 0;
  let missingTables = 0;

  for (const group of GROUPS) {
    let groupTotal = 0;
    const details: string[] = [];
    for (const t of group.tables) {
      const cnt = await countTable(t);
      if (cnt === null) {
        missingTables++;
        details.push(`${t}: (table not found)`);
      } else {
        groupTotal += cnt;
        if (cnt > 0) details.push(`${t}: ${cnt}`);
      }
    }
    const status = groupTotal === 0 ? "✓ empty" : `*** ${groupTotal} rows ***`;
    console.log(`  ${group.heading.padEnd(32)} ${status}`);
    for (const d of details) console.log(`      ${d}`);
    grandTotal += groupTotal;
  }

  console.log("");
  console.log("═══════════════════════════════════════════════════");
  console.log("  PRESERVED TABLES (must still be populated)");
  console.log("═══════════════════════════════════════════════════");
  for (const p of PRESERVE_CHECK) {
    const cnt = await countTable(p.table);
    if (cnt === null) {
      console.log(`  ${p.table.padEnd(28)} (not found)   ${p.desc}`);
    } else {
      const mark = cnt > 0 ? "✓" : "⚠";
      console.log(`  ${mark} ${p.table.padEnd(26)} ${String(cnt).padStart(6)}   ${p.desc}`);
    }
  }

  console.log("");
  console.log("═══════════════════════════════════════════════════");
  if (grandTotal === 0) {
    console.log(`  RESULT: ALL TENANT DATA WIPED (missing tables: ${missingTables})`);
  } else {
    console.log(`  RESULT: ${grandTotal} TENANT ROWS REMAIN — REVIEW ABOVE`);
  }
  console.log("═══════════════════════════════════════════════════");

  process.exit(grandTotal === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(2);
});
