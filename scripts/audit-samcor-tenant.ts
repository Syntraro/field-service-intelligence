/**
 * Audit-only script — locate the tenant tied to service@samcor.ca and
 * enumerate every FK that points at companies(id) so the reset script
 * can iterate them in the correct order.
 *
 * Read-only. No destructive operations.
 *
 * Usage:
 *   tsx scripts/audit-samcor-tenant.ts
 */
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env locally.
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
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const TARGET_EMAIL = "service@samcor.ca";

function maskUrl(u: string): string {
  return u.replace(/(:\/\/[^:]+:)[^@]+@/, "$1***@");
}

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const url = new URL(DATABASE_URL);
    console.log("\n══════ DATABASE TARGET ══════");
    console.log(`Host:     ${url.hostname}`);
    console.log(`Database: ${url.pathname.slice(1)}`);
    console.log(`NODE_ENV: ${process.env.NODE_ENV ?? "(unset)"}\n`);

    // 1) User row(s) for service@samcor.ca.
    console.log("══════ USERS matching email ══════");
    const userRows = await client.query<{
      id: string;
      email: string;
      first_name: string | null;
      last_name: string | null;
      role: string | null;
      status: string | null;
      company_id: string | null;
      deleted_at: string | null;
    }>(
      `SELECT id, email, first_name, last_name, role, status, company_id, deleted_at
         FROM users
        WHERE lower(email) = $1`,
      [TARGET_EMAIL.toLowerCase()],
    );
    console.table(userRows.rows);

    const companyIds = Array.from(
      new Set(userRows.rows.map((r) => r.company_id).filter(Boolean)),
    ) as string[];
    console.log(`\n→ Distinct companyIds owned by this email: ${JSON.stringify(companyIds)}\n`);

    // 2) The companies row itself.
    if (companyIds.length > 0) {
      console.log("══════ COMPANIES rows ══════");
      const compRows = await client.query(
        `SELECT id, name, email, subscription_status, created_at
           FROM companies WHERE id = ANY($1::varchar[])`,
        [companyIds],
      );
      console.table(compRows.rows);
    }

    // 3) Look for the email anywhere else (platform_users, magic links, etc.)
    console.log("══════ Email occurrences across other tables ══════");
    const emailCheck = await client.query<{
      table_name: string;
      column_name: string;
      hits: number;
    }>(`
      WITH email_cols AS (
        SELECT table_name, column_name
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND data_type = 'text'
           AND column_name ILIKE '%email%'
           AND table_name <> 'users'
      )
      SELECT table_name, column_name,
             (SELECT count(*)::int
                FROM (SELECT 1 FROM ONLY %I.%I WHERE lower(%I) = $1 LIMIT 1) z) AS hits
        FROM email_cols
        LIMIT 0
    `, []).catch(() => null);
    // The above doesn't work in pure SQL — re-do with a per-table loop.
    const cols = await client.query<{ table_name: string; column_name: string }>(`
      SELECT table_name, column_name
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND data_type = 'text'
         AND column_name ILIKE '%email%'
         AND table_name <> 'users'
       ORDER BY table_name, column_name
    `);
    const hits: Array<{ table: string; column: string; count: number }> = [];
    for (const c of cols.rows) {
      try {
        const r = await client.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM "${c.table_name}" WHERE lower("${c.column_name}") = $1`,
          [TARGET_EMAIL.toLowerCase()],
        );
        const n = parseInt(r.rows[0]?.n ?? "0", 10);
        if (n > 0) hits.push({ table: c.table_name, column: c.column_name, count: n });
      } catch {
        /* table may have RLS or be a view; skip */
      }
    }
    console.table(hits);

    // 4) Every FK pointing at companies(id) — the reset script's delete order.
    console.log("\n══════ FOREIGN KEYS → companies(id) ══════");
    const fks = await client.query<{
      table: string;
      column: string;
      delete_rule: string;
    }>(`
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
    console.table(fks.rows);

    if (companyIds.length > 0) {
      console.log("\n══════ Per-table row counts for the matched company(s) ══════");
      const counts: Array<{ table: string; column: string; rows: number }> = [];
      for (const fk of fks.rows) {
        try {
          const r = await client.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM "${fk.table}" WHERE "${fk.column}" = ANY($1::varchar[])`,
            [companyIds],
          );
          const n = parseInt(r.rows[0]?.n ?? "0", 10);
          if (n > 0) counts.push({ table: fk.table, column: fk.column, rows: n });
        } catch {
          /* skip — typing edge */
        }
      }
      console.table(counts);
      const total = counts.reduce((s, r) => s + r.rows, 0);
      console.log(`Total tenant-scoped rows across FK tables: ${total}\n`);
    }

    // 5) Tables with `company_id` but NO FK to companies(id) (orphan risk).
    console.log("══════ Tables with company_id column but no FK to companies(id) ══════");
    const orphanCols = await client.query<{ table_name: string }>(`
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
    console.table(orphanCols.rows);

    console.log(`\n══════ End of audit (DB: ${maskUrl(DATABASE_URL)}) ══════\n`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("audit failed:", err);
  process.exit(1);
});
