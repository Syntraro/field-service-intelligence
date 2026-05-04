/**
 * scripts/cleanup-samcor-external.ts — One-time external cleanup for the
 * already-deleted Samcor tenant (companyId 290c20d3-4e61-4766-af4e-953fbdfc465f).
 *
 * The DB row was hard-deleted by `scripts/reset-samcor-tenant.ts` on
 * 2026-05-03. R2 objects under the tenant prefix were NOT swept by that
 * earlier run — the file-level R2 inventory script confirmed 1 orphan
 * object at 3.4 MB remains under `tenants/<id>/...`.
 *
 * This script targets the OLD tenant id directly, lists every R2 object
 * under the prefix, deletes them on --confirm, and verifies the prefix
 * is empty after. It also probes provider tables for any rows that
 * survived the cascade (none expected — every PR-2-era FK is CASCADE).
 *
 * Usage:
 *   npx tsx scripts/cleanup-samcor-external.ts --dry-run
 *   npx tsx scripts/cleanup-samcor-external.ts --confirm
 *
 * Idempotent: if the prefix is already empty, this prints "Nothing to do."
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, "../.env");
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const SAMCOR_COMPANY_ID = "290c20d3-4e61-4766-af4e-953fbdfc465f";
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const confirm = args.has("--confirm");
if (!dryRun && !confirm) {
  console.error("One of --dry-run or --confirm is required.");
  process.exit(1);
}
if (process.env.NODE_ENV === "production" && process.env.ALLOW_PRODUCTION_RESET !== "true") {
  console.error("Refused: NODE_ENV=production. Set ALLOW_PRODUCTION_RESET=true to override.");
  process.exit(2);
}

async function main() {
  console.log(`\nTarget company id: ${SAMCOR_COMPANY_ID}`);
  console.log(`Mode:              ${dryRun ? "DRY RUN" : "CONFIRMED DELETE"}\n`);

  const { teardownTenant } = await import(
    "../server/services/tenantTeardownService"
  );

  // The DB row is already gone, but the service still has work to do:
  //   • R2 prefix sweep under tenants/<id>/
  //   • Verify zero provider rows survived the cascade
  //   • Verify session rows are clean
  // We pass --skip-db only when the company row is confirmed gone — the
  // service's `cascadeDeleteCompanies` is a no-op against a missing
  // company id (DELETE returns 0 rows) but skipping the BEGIN/COMMIT
  // tx is one fewer round-trip.
  const result = await teardownTenant({
    companyId: SAMCOR_COMPANY_ID,
    reason: "samcor-orphan-cleanup-2026-05-04",
    actor: "cli",
    dryRun,
    skipDb: false, // run the cascade even though we expect 0 rows — verifies the SET NULL leftovers + orphan tables
    skipR2: false,
  });

  console.log("══════ INVENTORY ══════");
  console.log(`R2 objects under prefix:  ${result.inventory.r2.objectCount}`);
  console.log(`R2 total bytes:           ${result.inventory.r2.totalBytes}`);
  if (result.inventory.r2.sampleKeys.length > 0) {
    console.log("Sample keys:");
    for (const k of result.inventory.r2.sampleKeys) console.log(`  ${k}`);
  }
  console.log(`\nDB FK row count:          ${result.inventory.totalFkRows}`);
  if (result.inventory.fkRowCounts.length > 0) {
    console.table(result.inventory.fkRowCounts);
  }
  console.log(`Sessions:                 staff=${result.inventory.sessions.staffSessions} portal=${result.inventory.sessions.portalSessions}`);

  if (dryRun) {
    console.log("\nDRY RUN — re-run with --confirm to execute.");
    return;
  }

  console.log("\n══════ EXECUTED ══════");
  console.log(`R2 objects deleted:       ${result.executed.r2DeletedObjects}`);
  console.log(`R2 bytes deleted:         ${result.executed.r2DeletedBytes}`);
  if (result.executed.r2DeleteErrors.length > 0) {
    console.log("R2 delete errors:");
    console.table(result.executed.r2DeleteErrors);
  }
  console.log(`Sessions deleted:         ${result.executed.sessionsDeleted}`);
  console.log(`DB cascade rows (approx): ${result.executed.dbCascadeRowsApprox}`);

  if (result.verification) {
    console.log("\n══════ VERIFICATION ══════");
    console.log(`companies remaining:                 ${result.verification.companiesRemaining}`);
    console.log(`users (email) remaining:             ${result.verification.usersWithEmailRemaining}`);
    console.log(`users (id) remaining:                ${result.verification.userIdsRemaining}`);
    console.log(`audit_logs.target_company_id rows:   ${result.verification.auditLogsTargetingTenant} (expected 0 — SET NULL)`);
    console.log(`R2 objects remaining:                ${result.verification.r2ObjectsRemaining}`);
    console.log(
      `Tenant-scoped DB rows remaining:     ${result.verification.fkTablesWithRows.reduce((s, r) => s + r.rows, 0)}`,
    );
  }

  console.log("\n══════ DONE ══════\n");
}

main().catch((err) => {
  console.error("cleanup-samcor-external failed:", err);
  process.exit(1);
});
