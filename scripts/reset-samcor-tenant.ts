/**
 * scripts/reset-samcor-tenant.ts — Hard reset of the tenant tied to
 * service@samcor.ca and ALL tenant-scoped data.
 *
 * USE CASES (dev/test only):
 *   • The Samcor demo tenant accumulated test data we need to clear so
 *     the same email can re-onboard from a clean slate.
 *
 * SAFETY GUARANTEES:
 *   1. Refuses to run against a production database. The default is
 *      REFUSAL when NODE_ENV === "production". Override only with an
 *      explicit `ALLOW_PRODUCTION_RESET=true` env var (we still log a
 *      bright warning).
 *   2. Logs the connected DB host + database name BEFORE any work.
 *   3. Dry-run first by default. Hard delete only when --confirm is
 *      passed.
 *   4. All deletes run inside a single transaction so a mid-flight
 *      failure rolls back atomically.
 *   5. Idempotent — rerunning after a successful delete is a no-op
 *      (the company id is already gone; the script exits cleanly).
 *   6. Tenant-scoped only — the script resolves `companies.id` from
 *      the email and deletes ONLY rows under that one tenant id. It
 *      never touches platform seed (roles, plan_features, etc.) or
 *      other tenants.
 *
 * USAGE:
 *   npx tsx scripts/reset-samcor-tenant.ts --dry-run
 *   npx tsx scripts/reset-samcor-tenant.ts --confirm
 *
 * The script needs --dry-run OR --confirm to do anything; running with
 * no flags prints a usage banner and exits.
 */

import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── .env loader (matches runMigrations.ts) ────────────────────────────────
const envPath = path.resolve(__dirname, "../.env");
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not set.");
  process.exit(1);
}

const TARGET_EMAIL = "service@samcor.ca";
// Optional belt-and-suspenders: if email lookup misses, fall back to
// matching `companies.name` so a renamed/legacy data shape can still
// be cleaned. Disabled by default; enable explicitly via the
// `--by-name="Samcor Mechanical Inc."` arg.
const argv = new Set(process.argv.slice(2));
const DRY_RUN = argv.has("--dry-run");
const CONFIRM = argv.has("--confirm");
const BY_NAME = (() => {
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--by-name=")) return a.slice("--by-name=".length).replace(/^"|"$/g, "");
  }
  return null;
})();

if (!DRY_RUN && !CONFIRM) {
  console.error(
    [
      "Usage:",
      "  --dry-run   print what WOULD be deleted (no destructive operations)",
      "  --confirm   actually delete the tenant + all tenant-scoped data",
      "",
      `One of the two flags is required. (Target email: ${TARGET_EMAIL})`,
    ].join("\n"),
  );
  process.exit(1);
}

// ─── Production guard ──────────────────────────────────────────────────────
const NODE_ENV = process.env.NODE_ENV ?? "(unset)";
const ALLOW_PROD = process.env.ALLOW_PRODUCTION_RESET === "true";
if (NODE_ENV === "production" && !ALLOW_PROD) {
  console.error("\n══════ REFUSED ══════");
  console.error("NODE_ENV=production. This script will not run against production.");
  console.error("If this is INTENTIONAL, set ALLOW_PRODUCTION_RESET=true and rerun.");
  console.error("Default: refusal.\n");
  process.exit(2);
}
if (NODE_ENV === "production" && ALLOW_PROD) {
  console.warn(
    "\n⚠️  ALLOW_PRODUCTION_RESET=true while NODE_ENV=production. Proceeding under explicit operator authorization.\n",
  );
}

function maskUrl(u: string): string {
  return u.replace(/(:\/\/[^:]+:)[^@]+@/, "$1***@");
}

interface TableCount {
  table: string;
  column: string;
  rows: number;
}

async function main() {
  const url = new URL(DATABASE_URL!);
  const dbHost = url.hostname;
  const dbName = url.pathname.slice(1);

  console.log("\n══════ DATABASE TARGET ══════");
  console.log(`Host:     ${dbHost}`);
  console.log(`Database: ${dbName}`);
  console.log(`URL:      ${maskUrl(DATABASE_URL!)}`);
  console.log(`NODE_ENV: ${NODE_ENV}`);
  console.log(`Mode:     ${DRY_RUN ? "DRY RUN (no destructive ops)" : "CONFIRMED DELETE"}\n`);

  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    // 1) Resolve the target tenant.
    let companyIds: string[] = [];
    let userIds: string[] = [];
    {
      const r = await client.query<{ id: string; company_id: string | null }>(
        `SELECT id, company_id FROM users WHERE lower(email) = $1`,
        [TARGET_EMAIL.toLowerCase()],
      );
      userIds = r.rows.map((x) => x.id);
      companyIds = Array.from(
        new Set(r.rows.map((x) => x.company_id).filter((x): x is string => !!x)),
      );
    }
    if (companyIds.length === 0 && BY_NAME) {
      const r = await client.query<{ id: string }>(
        `SELECT id FROM companies WHERE name = $1`,
        [BY_NAME],
      );
      companyIds = r.rows.map((x) => x.id);
    }

    console.log("══════ RESOLVED TENANT ══════");
    console.log(`Email:        ${TARGET_EMAIL}`);
    console.log(`User ids:     ${JSON.stringify(userIds)}`);
    console.log(`Company ids:  ${JSON.stringify(companyIds)}`);
    if (companyIds.length === 0) {
      console.log(
        "\n→ No company resolved. Either the email is unknown, the user has been deleted, or the legacy data was already cleaned.",
      );
      console.log("  Nothing to do. Exiting cleanly (idempotent).");
      return;
    }
    if (companyIds.length > 1) {
      console.warn(
        `\n⚠️  ${companyIds.length} companies resolved from this email. Will delete ALL of them.\n`,
      );
    }

    // 2) Print the company row(s) we're about to delete.
    {
      const r = await client.query(
        `SELECT id, name, email, subscription_status, created_at
           FROM companies WHERE id = ANY($1::varchar[]) ORDER BY name`,
        [companyIds],
      );
      console.log("\n══════ COMPANY ROW(S) ══════");
      console.table(r.rows);
    }

    // 3) Pre-delete row counts (FK tables).
    const fks = await client.query<{ table: string; column: string; delete_rule: string }>(`
      SELECT tc.table_name AS table,
             kcu.column_name AS column,
             rc.delete_rule
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema    = kcu.table_schema
        JOIN information_schema.referential_constraints rc
          ON tc.constraint_name = rc.constraint_name
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_schema    = 'public'
         AND ccu.table_name     = 'companies'
         AND ccu.column_name    = 'id'
       ORDER BY tc.table_name, kcu.column_name
    `);

    const preCounts = await collectCounts(client, fks.rows, companyIds);
    const populated = preCounts.filter((c) => c.rows > 0);
    const totalRows = populated.reduce((s, c) => s + c.rows, 0);
    console.log("\n══════ PRE-DELETE COUNTS (tenant-scoped rows) ══════");
    console.table(populated);
    console.log(`Total tenant-scoped rows across FK tables: ${totalRows}`);

    // 4) Tables with company_id but NO FK — orphan-risk path.
    const orphans = await listOrphanTables(client);
    if (orphans.length > 0) {
      console.log("\n══════ ORPHAN-RISK TABLES (company_id but no FK) ══════");
      console.table(orphans);
    }
    const orphanCounts: TableCount[] = [];
    for (const t of orphans) {
      try {
        const r = await client.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM "${t.table_name}" WHERE company_id = ANY($1::varchar[])`,
          [companyIds],
        );
        const n = parseInt(r.rows[0]?.n ?? "0", 10);
        if (n > 0) orphanCounts.push({ table: t.table_name, column: "company_id", rows: n });
      } catch {
        /* skip */
      }
    }
    if (orphanCounts.length > 0) {
      console.log("══════ ORPHAN ROWS PRESENT ══════");
      console.table(orphanCounts);
    }

    // 5) Session rows referencing any of the to-be-deleted users (auth artifact cleanup).
    const sessionUserHits = userIds.length
      ? await client.query<{ sid: string }>(
          `SELECT sid FROM session
            WHERE sess::jsonb -> 'passport' ->> 'user' = ANY($1::text[])`,
          [userIds],
        )
      : { rows: [] as Array<{ sid: string }> };
    console.log("\n══════ SESSION ARTIFACTS ══════");
    console.log(
      `Sessions referencing tenant user(s) directly via passport.user: ${sessionUserHits.rows.length}`,
    );
    // Portal sessions are keyed by an opaque sid — but the JSON shape is
    // `{ portal: { contactId, customerCompanyId, companyId, ... } }`. Match
    // by companyId.
    const portalSessionHits = await client.query<{ sid: string }>(
      `SELECT sid FROM session
        WHERE sess::jsonb -> 'portal' ->> 'companyId' = ANY($1::text[])`,
      [companyIds],
    );
    console.log(
      `Sessions referencing tenant via portal.companyId:               ${portalSessionHits.rows.length}`,
    );

    // 6) DRY RUN — exit here.
    if (DRY_RUN) {
      console.log("\n══════ DRY RUN — NO DELETE PERFORMED ══════");
      console.log("Re-run with --confirm to execute.\n");
      return;
    }

    // 7) CONFIRMED DELETE.
    console.log("\n══════ EXECUTING DELETE ══════");
    await client.query("BEGIN");
    try {
      // 7a) Orphan-risk tables (no FK cascade).
      let orphanDeleted = 0;
      for (const r of orphanCounts) {
        const res = await client.query(
          `DELETE FROM "${r.table}" WHERE company_id = ANY($1::varchar[])`,
          [companyIds],
        );
        orphanDeleted += res.rowCount ?? 0;
        console.log(`  ✓ DELETE FROM ${r.table}                — ${res.rowCount} rows`);
      }

      // 7b) Session rows for the users + portal sessions for the company.
      let sessionsDeleted = 0;
      if (userIds.length > 0) {
        const r = await client.query(
          `DELETE FROM session
            WHERE sess::jsonb -> 'passport' ->> 'user' = ANY($1::text[])`,
          [userIds],
        );
        sessionsDeleted += r.rowCount ?? 0;
        console.log(`  ✓ DELETE staff sessions                  — ${r.rowCount} rows`);
      }
      {
        const r = await client.query(
          `DELETE FROM session
            WHERE sess::jsonb -> 'portal' ->> 'companyId' = ANY($1::text[])`,
          [companyIds],
        );
        sessionsDeleted += r.rowCount ?? 0;
        console.log(`  ✓ DELETE portal sessions                 — ${r.rowCount} rows`);
      }

      // 7c) The big one: DELETE FROM companies cascades to every CASCADE FK.
      // SET NULL FKs (audit_logs.target_company_id, internal_support_notes.tenant_id,
      // issue_reports.tenant_id, payment_webhook_events.company_id,
      // qbo_webhook_events.company_id) end up with NULL → safe to leave.
      const compRes = await client.query(
        `DELETE FROM companies WHERE id = ANY($1::varchar[])`,
        [companyIds],
      );
      console.log(`  ✓ DELETE FROM companies                  — ${compRes.rowCount} rows`);

      await client.query("COMMIT");
      console.log("\n✓ Transaction committed.");
      console.log(`  Orphan-table rows deleted:    ${orphanDeleted}`);
      console.log(`  Session rows deleted:         ${sessionsDeleted}`);
      console.log(`  Cascade-deleted via DELETE FROM companies: ${totalRows} (pre-count)`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }

    // 8) Verification.
    console.log("\n══════ FINAL VERIFICATION ══════");
    const postCounts = await collectCounts(client, fks.rows, companyIds);
    const stillThere = postCounts.filter((c) => c.rows > 0);
    if (stillThere.length === 0) {
      console.log("✓ Zero rows remain across all FK tables for the deleted company id(s).");
    } else {
      console.log("⚠ Some rows remain (unexpected — review SET NULL FK policy):");
      console.table(stillThere);
    }
    {
      const r = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM companies WHERE id = ANY($1::varchar[])`,
        [companyIds],
      );
      console.log(`companies row(s) for resolved id(s): ${r.rows[0]?.n}`);
    }
    {
      const r = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM users WHERE lower(email) = $1`,
        [TARGET_EMAIL.toLowerCase()],
      );
      console.log(`users row(s) with email ${TARGET_EMAIL}: ${r.rows[0]?.n}`);
    }
    if (userIds.length > 0) {
      const r = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM users WHERE id = ANY($1::varchar[])`,
        [userIds],
      );
      console.log(`users row(s) for old tenant user ids:   ${r.rows[0]?.n}`);
    }
    // Also check audit_logs SET NULL trail — these rows are intentionally
    // kept (they record platform-admin activity targeting the now-gone
    // tenant), but `target_company_id` should be NULL.
    {
      const r = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM audit_logs
          WHERE target_company_id = ANY($1::varchar[])`,
        [companyIds],
      );
      console.log(
        `audit_logs.target_company_id still pointing at deleted tenant: ${r.rows[0]?.n} (expected 0 — should be SET NULL)`,
      );
    }

    console.log("\n══════ DONE ══════\n");
  } finally {
    await client.end();
  }
}

async function collectCounts(
  client: pg.Client,
  fks: Array<{ table: string; column: string }>,
  companyIds: string[],
): Promise<TableCount[]> {
  const out: TableCount[] = [];
  for (const fk of fks) {
    try {
      const r = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM "${fk.table}" WHERE "${fk.column}" = ANY($1::varchar[])`,
        [companyIds],
      );
      out.push({
        table: fk.table,
        column: fk.column,
        rows: parseInt(r.rows[0]?.n ?? "0", 10),
      });
    } catch {
      out.push({ table: fk.table, column: fk.column, rows: -1 });
    }
  }
  return out;
}

async function listOrphanTables(client: pg.Client) {
  const r = await client.query<{ table_name: string }>(`
    SELECT c.table_name
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.column_name  = 'company_id'
       AND NOT EXISTS (
         SELECT 1
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_name = kcu.constraint_name
           JOIN information_schema.constraint_column_usage ccu
             ON ccu.constraint_name = tc.constraint_name
          WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_schema    = 'public'
            AND tc.table_name      = c.table_name
            AND kcu.column_name    = 'company_id'
            AND ccu.table_name     = 'companies'
            AND ccu.column_name    = 'id'
       )
     ORDER BY c.table_name
  `);
  return r.rows;
}

main().catch((err) => {
  console.error("\n✗ reset-samcor-tenant failed:", err);
  process.exit(1);
});
