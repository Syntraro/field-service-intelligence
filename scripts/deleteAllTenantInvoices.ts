/**
 * scripts/deleteAllTenantInvoices.ts
 *
 * Tenant-scoped "wipe all invoices" cleanup. Resolves a company by name
 * (case-insensitive exact match) and drops every invoice row for that
 * tenant along with its dependents. Uses the exact cascade topology
 * documented at scripts/deleteImportedInvoices.ts — the only difference
 * is the candidate query: every invoice for the tenant, not just rows
 * whose lines were tagged by the importer.
 *
 * CASCADE TOPOLOGY (canonical):
 *   1. Release time_entries lock fields (no FK on lock columns).
 *   2. Explicit DELETE on invoice_tax_lines (live DB historically missing
 *      the FK; schema declares ON DELETE CASCADE).
 *   3. DELETE FROM invoices WHERE company_id = $1 — DB fires:
 *        - CASCADE on invoice_lines, payments
 *        - SET NULL on jobs.invoice_id, pm_billing_events.invoice_id,
 *          qbo_sync_events.invoice_id, time_entries.invoice_id
 *
 * REMINDER RISK: reminder state is stored as columns on the invoice row
 * (last_reminder_at, reminder_count, reminders_paused,
 * reminder_snooze_until). Removing the row removes the reminder
 * automatically — the sweep worker scans the invoices table.
 *
 * GUARDRAILS:
 *   - COMPANY_NAME=<exact name> required.
 *   - DELETE_ALL_TENANT_INVOICES=true required to commit (no dry-run
 *     default for this invocation — the caller explicitly asked for
 *     immediate execution).
 *   - Ambiguous name (multiple matches) → abort, no writes.
 *   - NODE_ENV=production is refused unless
 *     ALLOW_PROD_INVOICE_DELETE=true is set as well.
 *
 * USAGE:
 *   COMPANY_NAME="Samcor Mechanical Inc." \
 *   DELETE_ALL_TENANT_INVOICES=true \
 *   ALLOW_PROD_INVOICE_DELETE=true \
 *     npx tsx --env-file=.env scripts/deleteAllTenantInvoices.ts
 */

import { sql, inArray, or, and } from "drizzle-orm";
import { db } from "../server/db";
import {
  invoices,
  invoiceTaxLines,
  timeEntries,
} from "../shared/schema";

const COMMIT = process.env.DELETE_ALL_TENANT_INVOICES === "true";
const COMPANY_NAME = (process.env.COMPANY_NAME || "").trim();
const ALLOW_PROD = process.env.ALLOW_PROD_INVOICE_DELETE === "true";
const isProd = process.env.NODE_ENV === "production";

if (!COMPANY_NAME) {
  console.error("FATAL: COMPANY_NAME env var is required.");
  process.exit(1);
}
if (!COMMIT) {
  console.error(
    "FATAL: DELETE_ALL_TENANT_INVOICES=true is required. This script has no " +
    "dry-run default — callers asking for previews should use " +
    "scripts/deleteImportedInvoices.ts with its dry-run mode instead.",
  );
  process.exit(1);
}
if (isProd && !ALLOW_PROD) {
  console.error(
    "FATAL: NODE_ENV=production detected and ALLOW_PROD_INVOICE_DELETE is " +
    "not set. Refusing to run.",
  );
  process.exit(1);
}

async function main() {
  console.log(
    `[deleteAllTenantInvoices] mode=COMMIT tenant-name="${COMPANY_NAME}"` +
    `${isProd ? " NODE_ENV=production" : ""}`,
  );

  // ── 1. Resolve tenant by name ───────────────────────────────────────────
  // Case-insensitive exact match. If multiple rows come back we abort
  // without touching anything — caller must disambiguate.
  const resolved = await db.execute(sql`
    SELECT id, name
    FROM companies
    WHERE LOWER(name) = LOWER(${COMPANY_NAME})
    ORDER BY created_at ASC
  `);
  const resolvedRows = (resolved as any).rows ?? (resolved as any);
  const matches: Array<{ id: string; name: string }> = Array.isArray(resolvedRows) ? resolvedRows : [];

  if (matches.length === 0) {
    console.error(`[deleteAllTenantInvoices] No company matched "${COMPANY_NAME}". Aborting.`);
    process.exit(2);
  }
  if (matches.length > 1) {
    console.error(
      `[deleteAllTenantInvoices] Ambiguous: ${matches.length} companies matched "${COMPANY_NAME}":`,
    );
    for (const m of matches) console.error(`  • ${m.id}  ${m.name}`);
    console.error("Aborting without writes.");
    process.exit(3);
  }
  const tenant = matches[0];
  console.log(`[deleteAllTenantInvoices] resolved tenant: ${tenant.id}  ${tenant.name}`);

  // ── 2. Preflight counts (the "before" numbers for the deliverable) ─────
  const preCountRows = await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM invoices           WHERE company_id = ${tenant.id}) AS invoice_count,
      (SELECT COUNT(*)::int FROM invoice_lines      WHERE company_id = ${tenant.id}) AS line_count,
      (SELECT COUNT(*)::int FROM invoice_tax_lines  WHERE company_id = ${tenant.id}) AS tax_line_count,
      (SELECT COUNT(*)::int FROM payments p
         WHERE p.company_id = ${tenant.id}
           AND p.invoice_id IS NOT NULL
           AND EXISTS (SELECT 1 FROM invoices i WHERE i.id = p.invoice_id AND i.company_id = ${tenant.id})
      ) AS invoice_linked_payment_count,
      (SELECT COUNT(*)::int FROM invoices
         WHERE company_id = ${tenant.id} AND qbo_invoice_id IS NOT NULL) AS qbo_synced_count,
      (SELECT COUNT(*)::int FROM jobs
         WHERE company_id = ${tenant.id} AND invoice_id IS NOT NULL
           AND EXISTS (SELECT 1 FROM invoices i WHERE i.id = jobs.invoice_id AND i.company_id = ${tenant.id})
      ) AS jobs_with_invoice_ref
  `);
  const pre = ((preCountRows as any).rows ?? (preCountRows as any))[0] ?? {};
  console.log(
    `[deleteAllTenantInvoices] pre-delete counts: invoices=${pre.invoice_count} ` +
    `lines=${pre.line_count} tax_lines=${pre.tax_line_count} ` +
    `invoice-linked-payments=${pre.invoice_linked_payment_count} ` +
    `jobs-with-invoice-ref=${pre.jobs_with_invoice_ref} ` +
    `qbo-synced=${pre.qbo_synced_count}`,
  );

  if (pre.invoice_count === 0) {
    console.log("[deleteAllTenantInvoices] No invoices to delete. Exiting.");
    process.exit(0);
  }

  if (pre.qbo_synced_count > 0) {
    console.log(
      `[deleteAllTenantInvoices] WARNING: ${pre.qbo_synced_count} invoice(s) are QBO-synced. ` +
      `Deleting locally will NOT void them in QuickBooks.`,
    );
  }

  // Collect the invoice ids we're about to delete — needed for the
  // time_entries update in step 1 of the cascade.
  const invoiceIdRows = await db.execute(sql`
    SELECT id FROM invoices WHERE company_id = ${tenant.id}
  `);
  const idsList: string[] = (((invoiceIdRows as any).rows ?? (invoiceIdRows as any)) as Array<{ id: string }>).map((r) => r.id);
  console.log(`[deleteAllTenantInvoices] collected ${idsList.length} invoice id(s) for tenant`);

  // ── 3. Commit — three-step cascade in a single transaction ─────────────
  await db.transaction(async (tx) => {
    // 1. Release time_entries locks. invoice_id FK is SET NULL but the
    //    lock_* columns have no FK — null them explicitly.
    if (idsList.length > 0) {
      await tx
        .update(timeEntries)
        .set({
          invoiceId: null,
          invoiceLineId: null,
          invoicedAt: null,
          lockedAt: null,
          lockedByInvoiceId: null,
          lockReason: null,
        })
        .where(
          and(
            // Tenant scope for defense-in-depth. Matches the pattern in
            // scripts/deleteImportedInvoices.ts.
            sql`${timeEntries.companyId} = ${tenant.id}`,
            or(
              inArray(timeEntries.invoiceId, idsList),
              inArray(timeEntries.lockedByInvoiceId, idsList),
            )!,
          ),
        );
    }
    console.log(`  [1/3] released time_entries locks`);

    // 2. Explicit DELETE on invoice_tax_lines. The live DB historically
    //    lacks the FK → CASCADE won't fire; delete explicitly first.
    await tx
      .delete(invoiceTaxLines)
      .where(sql`${invoiceTaxLines.companyId} = ${tenant.id}`);
    console.log(`  [2/3] deleted invoice_tax_lines`);

    // 3. DELETE FROM invoices — schema cascades handle the rest:
    //    CASCADE on invoice_lines + payments;
    //    SET NULL on jobs.invoice_id, pm_billing_events.invoice_id,
    //    qbo_sync_events.invoice_id, time_entries.invoice_id.
    await tx
      .delete(invoices)
      .where(sql`${invoices.companyId} = ${tenant.id}`);
    console.log(`  [3/3] deleted invoices`);
  });

  // ── 4. Post-commit verification ─────────────────────────────────────────
  const postCountRows = await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM invoices          WHERE company_id = ${tenant.id}) AS invoice_count_after,
      (SELECT COUNT(*)::int FROM invoice_lines     WHERE company_id = ${tenant.id}) AS line_count_after,
      (SELECT COUNT(*)::int FROM invoice_tax_lines WHERE company_id = ${tenant.id}) AS tax_line_count_after,
      (SELECT COUNT(*)::int FROM invoice_lines il
         WHERE il.company_id = ${tenant.id}
           AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.id = il.invoice_id)
      ) AS orphan_lines,
      (SELECT COUNT(*)::int FROM invoice_tax_lines itl
         WHERE itl.company_id = ${tenant.id}
           AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.id = itl.invoice_id)
      ) AS orphan_tax_lines,
      (SELECT COUNT(*)::int FROM payments p
         WHERE p.company_id = ${tenant.id}
           AND p.invoice_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.id = p.invoice_id)
      ) AS orphan_invoice_linked_payments,
      (SELECT COUNT(*)::int FROM jobs
         WHERE company_id = ${tenant.id} AND invoice_id IS NOT NULL
      ) AS jobs_still_with_invoice_ref
  `);
  const post = ((postCountRows as any).rows ?? (postCountRows as any))[0] ?? {};
  console.log(
    `[deleteAllTenantInvoices] post-delete counts: ` +
    `invoices=${post.invoice_count_after} lines=${post.line_count_after} ` +
    `tax_lines=${post.tax_line_count_after} ` +
    `orphan_lines=${post.orphan_lines} orphan_tax_lines=${post.orphan_tax_lines} ` +
    `orphan_invoice_linked_payments=${post.orphan_invoice_linked_payments} ` +
    `jobs_still_with_invoice_ref=${post.jobs_still_with_invoice_ref}`,
  );

  if (
    post.invoice_count_after !== 0 ||
    post.line_count_after !== 0 ||
    post.tax_line_count_after !== 0 ||
    post.orphan_lines !== 0 ||
    post.orphan_tax_lines !== 0 ||
    post.orphan_invoice_linked_payments !== 0 ||
    post.jobs_still_with_invoice_ref !== 0
  ) {
    console.error("[deleteAllTenantInvoices] UNEXPECTED: post-delete verification failed.");
    process.exit(4);
  }

  // ── 5. Non-invoice data untouched sanity (counts only, read-only) ──────
  const sanity = await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM client_locations   WHERE company_id = ${tenant.id}) AS client_locations,
      (SELECT COUNT(*)::int FROM customer_companies WHERE company_id = ${tenant.id}) AS customer_companies,
      (SELECT COUNT(*)::int FROM jobs               WHERE company_id = ${tenant.id}) AS jobs_total,
      (SELECT COUNT(*)::int FROM quotes             WHERE company_id = ${tenant.id}) AS quotes_total,
      (SELECT COUNT(*)::int FROM users              WHERE company_id = ${tenant.id}) AS users_total
  `);
  const s = ((sanity as any).rows ?? (sanity as any))[0] ?? {};
  console.log(
    `[deleteAllTenantInvoices] tenant non-invoice inventory (unchanged by this script): ` +
    `client_locations=${s.client_locations} customer_companies=${s.customer_companies} ` +
    `jobs=${s.jobs_total} quotes=${s.quotes_total} users=${s.users_total}`,
  );

  console.log("[deleteAllTenantInvoices] Done.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("[deleteAllTenantInvoices] FATAL:", err);
  process.exit(1);
});
