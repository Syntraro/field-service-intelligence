/**
 * scripts/deleteImportedInvoices.ts
 *
 * Targeted cleanup for invoices created via the 2026-04-22 canonical
 * invoice importer (InvoiceImportAdapter). Use this to remove test
 * imports so nothing can fire reminder emails, overdue notices, or PDF
 * sends against them.
 *
 * IDENTIFICATION (bulletproof — the "imported" line source was introduced
 * by this importer and cannot collide with existing data):
 *   A row is a candidate when the invoice has at least one invoice_line
 *   where `source = 'imported'`. As a secondary cross-check, invoices
 *   whose `notes_internal` begins with the importer's snapshot header
 *   (`--- Imported Historical Invoice Details ---`) are also included.
 *
 * WHY NOT `InvoiceRepository.deleteInvoice()`:
 *   The canonical method enforces user-facing deletion rules (status must
 *   be "draft", no QBO sync, no payments). Imported test invoices often
 *   land with status "paid" / "partial_paid" / "awaiting_payment" and
 *   would be refused. This script is a test-data cleanup path, not a
 *   user workflow — it mirrors the canonical method's transactional
 *   steps but skips the status/QBO/payment gates.
 *
 * CASCADE TOPOLOGY (same as InvoiceRepository.deleteInvoice header):
 *   1. Release time_entries lock fields (no FK on lock columns).
 *   2. Explicit DELETE on invoice_tax_lines (live DB historically missing
 *      the FK; schema declares ON DELETE CASCADE).
 *   3. DELETE FROM invoices — DB fires:
 *        - CASCADE on invoice_lines, payments
 *        - SET NULL on jobs.invoice_id, pm_billing_events.invoice_id,
 *          qbo_sync_events.invoice_id, time_entries.invoice_id
 *
 * REMINDER RISK:
 *   Reminder state lives in columns on invoices (last_reminder_at,
 *   reminder_count, reminders_paused, reminder_snooze_until). There is
 *   no separate reminder queue table. Deleting the invoice row removes
 *   reminder risk automatically — the sweep worker scans the invoices
 *   table and finds nothing.
 *
 * SAFETY GUARDRAILS (every run):
 *   - Dry-run by default. Prints per-tenant candidate lists + counts
 *     and exits without writing anything.
 *   - Commit requires DELETE_IMPORTED_INVOICES=true.
 *   - COMPANY_ID=<uuid> optional scope (recommended). Without it, the
 *     script deletes across every tenant that has imported invoices.
 *   - NODE_ENV=production is REFUSED by default. Set
 *     ALLOW_PROD_IMPORTED_INVOICE_DELETE=true to override if you
 *     genuinely need to purge a prod test tenant.
 *
 * USAGE:
 *   # See what would be deleted (no writes):
 *   npx tsx --env-file=.env scripts/deleteImportedInvoices.ts
 *
 *   # Delete for one tenant:
 *   COMPANY_ID=<uuid> DELETE_IMPORTED_INVOICES=true \
 *     npx tsx --env-file=.env scripts/deleteImportedInvoices.ts
 *
 *   # Delete across every tenant (use with care):
 *   DELETE_IMPORTED_INVOICES=true \
 *     npx tsx --env-file=.env scripts/deleteImportedInvoices.ts
 */

import { sql, inArray, or, and, eq } from "drizzle-orm";
import { db } from "../server/db";
import {
  invoices,
  invoiceTaxLines,
  timeEntries,
} from "../shared/schema";

// ── Parse guardrails ────────────────────────────────────────────────────────
const COMMIT = process.env.DELETE_IMPORTED_INVOICES === "true";
const COMPANY_ID = (process.env.COMPANY_ID || "").trim() || null;
const ALLOW_PROD = process.env.ALLOW_PROD_IMPORTED_INVOICE_DELETE === "true";
const isProd = process.env.NODE_ENV === "production";

if (isProd && !ALLOW_PROD) {
  console.error(
    "FATAL: NODE_ENV=production detected. This script is designed for test-data cleanup.\n" +
    "If you really need to purge a production test tenant, set\n" +
    "  ALLOW_PROD_IMPORTED_INVOICE_DELETE=true\n" +
    "AND scope the run with COMPANY_ID=<uuid>.",
  );
  process.exit(1);
}
if (isProd && ALLOW_PROD && !COMPANY_ID) {
  console.error(
    "FATAL: running against production without COMPANY_ID is refused.\n" +
    "Scope the run with COMPANY_ID=<uuid>.",
  );
  process.exit(1);
}

async function main() {
  console.log(
    `[deleteImportedInvoices] mode=${COMMIT ? "COMMIT" : "DRY-RUN"}` +
    `${COMPANY_ID ? ` tenant=${COMPANY_ID}` : " scope=all-tenants"}` +
    `${isProd ? " NODE_ENV=production" : ""}`,
  );

  // ── 1. Identify candidates ────────────────────────────────────────────────
  // Primary: any invoice with at least one line where source='imported'.
  // Secondary: any invoice whose notes_internal starts with the importer's
  // snapshot header — defense-in-depth in case a future writer tags lines
  // differently.
  const tenantFilter = COMPANY_ID
    ? sql` AND i.company_id = ${COMPANY_ID}`
    : sql``;

  const candidates = await db.execute(sql`
    SELECT
      i.id AS invoice_id,
      i.company_id,
      i.invoice_number,
      i.status,
      i.total,
      i.balance,
      i.amount_paid,
      i.qbo_invoice_id,
      i.last_reminder_at,
      i.reminder_count,
      i.reminders_paused,
      i.reminder_snooze_until,
      (SELECT COUNT(*) FROM invoice_lines il WHERE il.invoice_id = i.id) AS line_count,
      (SELECT COUNT(*) FROM invoice_lines il WHERE il.invoice_id = i.id AND il.source = 'imported') AS imported_line_count,
      (SELECT COUNT(*) FROM payments p WHERE p.invoice_id = i.id) AS payment_count,
      (SELECT COUNT(*) FROM invoice_tax_lines itl WHERE itl.invoice_id = i.id) AS tax_line_count
    FROM invoices i
    WHERE (
      EXISTS (
        SELECT 1 FROM invoice_lines il
        WHERE il.invoice_id = i.id AND il.source = 'imported'
      )
      OR i.notes_internal LIKE '--- Imported Historical Invoice Details ---%'
    )
    ${tenantFilter}
    ORDER BY i.company_id, i.created_at DESC
  `);

  const rows = (candidates as any).rows ?? (candidates as any);
  const list: Array<{
    invoice_id: string;
    company_id: string;
    invoice_number: string | null;
    status: string;
    total: string;
    balance: string;
    amount_paid: string;
    qbo_invoice_id: string | null;
    last_reminder_at: Date | null;
    reminder_count: number;
    reminders_paused: boolean;
    reminder_snooze_until: Date | null;
    line_count: string;
    imported_line_count: string;
    payment_count: string;
    tax_line_count: string;
  }> = Array.isArray(rows) ? rows : [];

  if (list.length === 0) {
    console.log("[deleteImportedInvoices] No candidates found. Nothing to do.");
    process.exit(0);
  }

  // ── 2. Group + print per-tenant summary ──────────────────────────────────
  const byTenant = new Map<string, typeof list>();
  for (const row of list) {
    const arr = byTenant.get(row.company_id) ?? [];
    arr.push(row);
    byTenant.set(row.company_id, arr);
  }

  console.log(`\n[deleteImportedInvoices] Candidates: ${list.length} invoice(s) across ${byTenant.size} tenant(s).\n`);

  for (const [tenantId, tenantRows] of byTenant.entries()) {
    console.log(`─── tenant ${tenantId} — ${tenantRows.length} invoice(s) ───`);
    for (const r of tenantRows) {
      const reminderMark =
        r.last_reminder_at
          ? `sent ${r.last_reminder_at.toISOString?.() ?? r.last_reminder_at} (count=${r.reminder_count})`
          : `never sent (count=${r.reminder_count}, paused=${r.reminders_paused})`;
      const qboFlag = r.qbo_invoice_id ? ` QBO=${r.qbo_invoice_id}` : "";
      console.log(
        `  • invoice=${r.invoice_id} num=${r.invoice_number ?? "(null)"} ` +
        `status=${r.status} total=${r.total} balance=${r.balance} ` +
        `paid=${r.amount_paid}${qboFlag} ` +
        `lines=${r.line_count} (imported=${r.imported_line_count}) ` +
        `payments=${r.payment_count} tax_lines=${r.tax_line_count} ` +
        `reminders: ${reminderMark}`,
      );
    }
    console.log("");
  }

  // QBO safety: warn if any candidate is QBO-synced. Don't block — the
  // operator may still want to clean local test copies — but make it loud.
  const qboSynced = list.filter((r) => r.qbo_invoice_id);
  if (qboSynced.length > 0) {
    console.log(
      `[deleteImportedInvoices] WARNING: ${qboSynced.length} candidate(s) are QBO-synced ` +
      `(qbo_invoice_id is not null). Deleting locally will NOT void them in QuickBooks. ` +
      `Review the list above before committing.\n`,
    );
  }

  if (!COMMIT) {
    console.log("[deleteImportedInvoices] DRY-RUN complete. No rows were changed.");
    console.log("[deleteImportedInvoices] To commit: DELETE_IMPORTED_INVOICES=true ...\n");
    process.exit(0);
  }

  // ── 3. Commit path — bulk delete per tenant in one transaction ───────────
  const allIds = list.map((r) => r.invoice_id);
  const tenantIds = Array.from(byTenant.keys());

  console.log(`[deleteImportedInvoices] COMMITTING deletion of ${allIds.length} invoice(s)...\n`);

  await db.transaction(async (tx) => {
    // 1. Release time_entries locks (invoice_id FK is SET NULL, but lock
    //    columns have no FK and would dangle). Scoped to the same tenants
    //    for defense-in-depth.
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
          inArray(timeEntries.companyId, tenantIds),
          or(
            inArray(timeEntries.invoiceId, allIds),
            inArray(timeEntries.lockedByInvoiceId, allIds),
          )!,
        ),
      );
    console.log(`  [1/3] released time_entries locks`);

    // 2. Explicit invoice_tax_lines delete (live DB may be missing the FK).
    await tx
      .delete(invoiceTaxLines)
      .where(
        and(
          inArray(invoiceTaxLines.companyId, tenantIds),
          inArray(invoiceTaxLines.invoiceId, allIds),
        ),
      );
    console.log(`  [2/3] deleted invoice_tax_lines`);

    // 3. DELETE FROM invoices — CASCADE handles invoice_lines + payments;
    //    SET NULL handles jobs.invoice_id, pm_billing_events.invoice_id,
    //    qbo_sync_events.invoice_id, time_entries.invoice_id.
    await tx
      .delete(invoices)
      .where(
        and(
          inArray(invoices.companyId, tenantIds),
          inArray(invoices.id, allIds),
        ),
      );
    console.log(`  [3/3] deleted invoices`);
  });

  // ── 4. Post-commit verification ──────────────────────────────────────────
  const remaining = await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM invoices i
    WHERE (
      EXISTS (
        SELECT 1 FROM invoice_lines il
        WHERE il.invoice_id = i.id AND il.source = 'imported'
      )
      OR i.notes_internal LIKE '--- Imported Historical Invoice Details ---%'
    )
    ${tenantFilter}
  `);
  const remainingRows = (remaining as any).rows ?? (remaining as any);
  const n = Array.isArray(remainingRows) && remainingRows[0] ? remainingRows[0].n : 0;
  console.log(
    `\n[deleteImportedInvoices] post-commit verify: ${n} imported invoice(s) still match the identifier.`,
  );
  if (n !== 0) {
    console.error("[deleteImportedInvoices] UNEXPECTED: non-zero remaining set after commit.");
    process.exit(2);
  }
  console.log("[deleteImportedInvoices] Done.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("[deleteImportedInvoices] FATAL:", err);
  process.exit(1);
});
