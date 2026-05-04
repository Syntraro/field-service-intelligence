/**
 * scripts/reset-tenant.ts — Generic tenant teardown CLI.
 *
 * Wraps the canonical `tenantTeardownService` so the same flow runs
 * from a CLI, an admin UI, or a programmatic call.
 *
 * Usage:
 *   tsx scripts/reset-tenant.ts --company-id=<uuid> --dry-run
 *   tsx scripts/reset-tenant.ts --email=foo@bar.com --confirm
 *   tsx scripts/reset-tenant.ts --company-id=<uuid> --confirm --skip-r2
 *   tsx scripts/reset-tenant.ts --company-id=<uuid> --confirm --skip-db --include-external
 *
 * Flags:
 *   --company-id=<uuid>       Resolve tenant by company id.
 *   --email=<email>           Resolve tenant by user email (refuses if ambiguous).
 *   --dry-run                 Print summary; no destructive operations.
 *   --confirm                 Execute the cascade.
 *   --include-external        (Default) include R2 + provider cleanup.
 *   --skip-r2                 Skip the R2 prefix sweep.
 *   --skip-db                 Skip the DB cascade (external-only cleanup).
 *   --reason="<text>"         Audit string for log lines.
 *
 * Safety:
 *   • Refuses production unless ALLOW_PRODUCTION_RESET=true.
 *   • Logs DB host + R2 bucket + prefix BEFORE any work.
 *   • One of --dry-run / --confirm is required.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── .env loader (matches runMigrations.ts) ────────────────────────────────
const envPath = path.resolve(__dirname, "../.env");
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

// ─── Parse flags ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function flag(name: string): boolean {
  return args.includes(`--${name}`);
}
function value(name: string): string | null {
  for (const a of args) {
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3).replace(/^"|"$/g, "");
  }
  return null;
}

const companyId = value("company-id");
const email = value("email");
const reason = value("reason") ?? "cli-reset";
const dryRun = flag("dry-run");
const confirm = flag("confirm");
const skipR2 = flag("skip-r2");
const skipDb = flag("skip-db");
// `--include-external` is the default; flag preserved for explicit usage.
void flag("include-external");

if (!dryRun && !confirm) {
  console.error("One of --dry-run or --confirm is required.");
  process.exit(1);
}
if (!companyId && !email) {
  console.error("One of --company-id or --email is required.");
  process.exit(1);
}

// ─── Production guard ──────────────────────────────────────────────────────
const NODE_ENV = process.env.NODE_ENV ?? "(unset)";
if (NODE_ENV === "production" && process.env.ALLOW_PRODUCTION_RESET !== "true") {
  console.error("\n══════ REFUSED ══════");
  console.error("NODE_ENV=production. Set ALLOW_PRODUCTION_RESET=true to override.\n");
  process.exit(2);
}

function maskUrl(u: string): string {
  return u.replace(/(:\/\/[^:]+:)[^@]+@/, "$1***@");
}

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  console.log("\n══════ DATABASE TARGET ══════");
  console.log(`Host:     ${url.hostname}`);
  console.log(`Database: ${url.pathname.slice(1)}`);
  console.log(`URL:      ${maskUrl(process.env.DATABASE_URL!)}`);
  console.log(`NODE_ENV: ${NODE_ENV}`);
  console.log("\n══════ R2 TARGET ══════");
  console.log(`Bucket:   ${process.env.R2_BUCKET ?? "(R2 not configured)"}`);
  console.log(`Prefix:   ${companyId ? `tenants/${companyId}/` : "(resolved per company)"}`);
  console.log(`\nMode:     ${dryRun ? "DRY RUN (no destructive ops)" : "CONFIRMED DELETE"}`);
  console.log(`Filter:   companyId=${companyId ?? "(via email)"} email=${email ?? "—"}`);
  console.log(`Reason:   ${reason}\n`);

  const { teardownTenant } = await import(
    "../server/services/tenantTeardownService"
  );

  const result = await teardownTenant({
    companyId: companyId ?? null,
    email: email ?? null,
    reason,
    actor: "cli",
    dryRun,
    skipDb,
    skipR2,
  });

  console.log("══════ RESOLVED TENANT ══════");
  console.log(`companyIds: ${JSON.stringify(result.resolved.companyIds)}`);
  console.log(`userIds:    ${JSON.stringify(result.resolved.userIds)}\n`);

  if (result.resolved.companyIds.length === 0) {
    console.log("→ No company resolved. Already clean. Exiting.");
    return;
  }

  console.log("══════ INVENTORY (pre-action) ══════");
  console.log(`DB tenant rows across FK tables: ${result.inventory.totalFkRows}`);
  if (result.inventory.fkRowCounts.length > 0) {
    console.table(result.inventory.fkRowCounts);
  }
  if (result.inventory.orphanRowCounts.length > 0) {
    console.log("Orphan-table rows (no FK to companies):");
    console.table(result.inventory.orphanRowCounts);
  }
  console.log(`\nR2:`);
  console.log(`  enabled:      ${result.inventory.r2.enabled}`);
  console.log(`  bucket:       ${result.inventory.r2.bucket ?? "—"}`);
  console.log(`  prefix:       ${result.inventory.r2.prefix ?? "—"}`);
  console.log(`  object count: ${result.inventory.r2.objectCount}`);
  console.log(`  total bytes:  ${result.inventory.r2.totalBytes}`);
  if (result.inventory.r2.sampleKeys.length > 0) {
    console.log(`  sample keys:`);
    for (const k of result.inventory.r2.sampleKeys) console.log(`    ${k}`);
  }
  console.log(`\nProviders:`);
  console.log(`  QBO connection:   ${result.inventory.providers.qbo.hasConnection}`);
  console.log(`  QBO realm id:     ${result.inventory.providers.qbo.hasRealmId}`);
  console.log(`  Stripe acct row:  ${result.inventory.providers.stripeConnect.hasAccountRow}`);
  console.log(
    `  Stripe acct id:   ${result.inventory.providers.stripeConnect.providerAccountIdPresent}`,
  );
  console.log(`\nSessions:`);
  console.log(`  staff:  ${result.inventory.sessions.staffSessions}`);
  console.log(`  portal: ${result.inventory.sessions.portalSessions}\n`);

  if (dryRun) {
    console.log("══════ DRY RUN — NO DELETE PERFORMED ══════");
    console.log("Re-run with --confirm to execute.\n");
    if (result.providerRetentions.length > 0) {
      console.log("Provider retention notes (would still apply):");
      for (const r of result.providerRetentions) {
        console.log(`  • [${r.provider}] ${r.reason}`);
      }
      console.log("");
    }
    return;
  }

  console.log("══════ EXECUTED ══════");
  console.log(`R2 objects deleted:           ${result.executed.r2DeletedObjects}`);
  console.log(`R2 bytes deleted:             ${result.executed.r2DeletedBytes}`);
  if (result.executed.r2DeleteErrors.length > 0) {
    console.log(`R2 delete errors:`);
    console.table(result.executed.r2DeleteErrors);
  }
  console.log(
    `QBO revoke:                   attempted=${result.executed.qboRevokeAttempted} success=${result.executed.qboRevokeSuccess} ${result.executed.qboRevokeMessage ?? ""}`,
  );
  console.log(`Sessions deleted:             ${result.executed.sessionsDeleted}`);
  console.log(`DB cascade companies deleted: ${result.executed.dbCascadeDeletedCompanies}`);
  console.log(`DB cascade rows (approx):     ${result.executed.dbCascadeRowsApprox}\n`);

  console.log("══════ PROVIDER RETENTIONS ══════");
  for (const r of result.providerRetentions) {
    console.log(`  • [${r.provider}] ${r.reason}`);
  }

  if (result.verification) {
    console.log("\n══════ FINAL VERIFICATION ══════");
    console.log(`companies row(s) for resolved id(s):     ${result.verification.companiesRemaining}`);
    console.log(`users for email:                          ${result.verification.usersWithEmailRemaining}`);
    console.log(`users for old tenant ids:                 ${result.verification.userIdsRemaining}`);
    console.log(`audit_logs.target_company_id stragglers:  ${result.verification.auditLogsTargetingTenant} (expected 0 — SET NULL)`);
    console.log(`R2 objects remaining under prefix:        ${result.verification.r2ObjectsRemaining}`);
    if (result.verification.fkTablesWithRows.length === 0) {
      console.log(`Tenant-scoped DB rows remaining:          0`);
    } else {
      console.log(`Tenant-scoped DB rows remaining:`);
      console.table(result.verification.fkTablesWithRows);
    }
  }
  console.log("\n══════ DONE ══════\n");
}

main().catch((err) => {
  console.error("\n✗ reset-tenant failed:", err);
  process.exit(1);
});
