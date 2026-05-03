/**
 * audit-location-name-drift.ts (2026-05-01)
 *
 * READ-ONLY diagnostic. No writes, no migrations, no auto-fix.
 *
 * Reports three classes of identity drift between customer_companies
 * and client_locations that surface as "stale name" symptoms in the UI
 * (global search, Create Job prefill, etc.):
 *
 *   1. STALE DENORMALIZATION — locations whose `company_name` differs
 *      from the parent's current `customer_companies.name`. After a
 *      parent rename these rows will keep showing the OLD name in any
 *      surface that doesn't honor the parent fallback. The post-fix
 *      read paths now prefer the parent's name for display, so this
 *      list is informational; if you want the override column itself
 *      cleaned, NULL out rows in this list ONLY after confirming none
 *      of them are intentional per-location overrides.
 *
 *   2. DUPLICATE COMPANIES — customer_companies rows within the same
 *      tenant that share a normalized name. Could be legit (same name,
 *      different entities) or a duplicate created accidentally. NEVER
 *      auto-merge — surface for manual review only.
 *
 *   3. ORPHANED LOCATIONS — client_locations whose `parent_company_id`
 *      points at a soft-deleted or non-existent customer_companies row.
 *      Treated separately from drift since the fix is "reattach" not
 *      "rename".
 *
 * Run:
 *   npx tsx scripts/audit-location-name-drift.ts                # all tenants
 *   npx tsx scripts/audit-location-name-drift.ts --company <id> # one tenant
 *
 * Exit code is always 0 (informational only). Prints findings via
 * console.table; pipe to `tee` if you need persistence.
 */

import { pool } from "../server/db";

interface CliArgs {
  companyId?: string;
}

function parseArgs(): CliArgs {
  const args: CliArgs = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--company" && argv[i + 1]) {
      args.companyId = argv[i + 1];
      i++;
    }
  }
  return args;
}

async function reportDrift(scopeCompanyId?: string): Promise<void> {
  const params: string[] = [];
  const scopeClause = scopeCompanyId
    ? `AND cl.company_id = $${params.push(scopeCompanyId)}`
    : "";

  // 1. STALE DENORMALIZATION
  // Locations where the location-level `company_name` is non-empty AND
  // differs from the parent's current `name`. Trim+lower compare so
  // whitespace/case differences don't show up as drift.
  const driftSql = `
    SELECT
      cl.company_id          AS tenant_company_id,
      cl.id                  AS location_id,
      cl.company_name        AS location_company_name,
      cc.id                  AS parent_company_id,
      cc.name                AS parent_company_name,
      cl.created_at          AS location_created_at
    FROM client_locations cl
    JOIN customer_companies cc ON cl.parent_company_id = cc.id
    WHERE cl.deleted_at IS NULL
      AND cc.deleted_at IS NULL
      AND COALESCE(NULLIF(TRIM(cl.company_name), ''), '') <> ''
      AND LOWER(TRIM(COALESCE(cl.company_name, ''))) <> LOWER(TRIM(COALESCE(cc.name, '')))
      ${scopeClause}
    ORDER BY cl.company_id, cc.name, cl.created_at
  `;
  const drift = await pool.query(driftSql, params);

  console.log(`\n[1] STALE LOCATION DENORMALIZATION  (rows: ${drift.rowCount})`);
  if (drift.rowCount && drift.rowCount > 0) {
    console.table(drift.rows);
    console.log(
      "→ These locations display their own `company_name` column when consumed " +
      "by code paths that don't honor the parent fallback. The 2026-05-01 read-path " +
      "fix now prefers `customer_companies.name` for display. To CLEAN the override " +
      "column, run (per-tenant, after MANUAL review):\n" +
      "    UPDATE client_locations\n" +
      "       SET company_name = NULL\n" +
      "     WHERE id = '<location_id>';\n" +
      "Do not bulk-update without spot-checking — some rows may be intentional overrides."
    );
  } else {
    console.log("→ No drifted denormalization detected.");
  }

  // 2. DUPLICATE COMPANIES (same tenant, normalized name match)
  const dupSql = `
    SELECT
      cc.company_id          AS tenant_company_id,
      cc.name_normalized,
      COUNT(*)               AS dup_count,
      ARRAY_AGG(cc.id ORDER BY cc.created_at)         AS company_ids,
      ARRAY_AGG(cc.name ORDER BY cc.created_at)       AS raw_names,
      ARRAY_AGG(cc.created_at ORDER BY cc.created_at) AS created_at
    FROM customer_companies cc
    WHERE cc.deleted_at IS NULL
      AND cc.name_normalized <> ''
      ${scopeCompanyId ? `AND cc.company_id = $1` : ""}
    GROUP BY cc.company_id, cc.name_normalized
    HAVING COUNT(*) > 1
    ORDER BY cc.company_id, dup_count DESC
  `;
  const dups = await pool.query(dupSql, scopeCompanyId ? [scopeCompanyId] : []);

  console.log(`\n[2] DUPLICATE CUSTOMER COMPANIES  (groups: ${dups.rowCount})`);
  if (dups.rowCount && dups.rowCount > 0) {
    console.table(dups.rows);
    console.log(
      "→ Each group shares a normalized name within a single tenant. Investigate " +
      "manually — a merge requires reassigning child locations, jobs, invoices, etc., " +
      "which is out of scope for this diagnostic."
    );
  } else {
    console.log("→ No duplicate customer companies detected.");
  }

  // 3. ORPHANED LOCATIONS
  const orphanSql = `
    SELECT
      cl.company_id    AS tenant_company_id,
      cl.id            AS location_id,
      cl.company_name  AS location_company_name,
      cl.parent_company_id,
      cc.deleted_at    AS parent_deleted_at
    FROM client_locations cl
    LEFT JOIN customer_companies cc ON cl.parent_company_id = cc.id
    WHERE cl.deleted_at IS NULL
      AND cl.parent_company_id IS NOT NULL
      AND (cc.id IS NULL OR cc.deleted_at IS NOT NULL)
      ${scopeClause}
    ORDER BY cl.company_id, cl.created_at
  `;
  const orphans = await pool.query(orphanSql, params);

  console.log(`\n[3] ORPHANED LOCATIONS  (rows: ${orphans.rowCount})`);
  if (orphans.rowCount && orphans.rowCount > 0) {
    console.table(orphans.rows);
    console.log(
      "→ These locations point at a missing/soft-deleted customer company. " +
      "Reattach via the canonical edit-location flow or set parent_company_id NULL " +
      "(treating the location as standalone)."
    );
  } else {
    console.log("→ No orphaned locations detected.");
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (args.companyId) {
    console.log(`Auditing tenant: ${args.companyId}`);
  } else {
    console.log("Auditing ALL tenants");
  }
  await reportDrift(args.companyId);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(99);
});
