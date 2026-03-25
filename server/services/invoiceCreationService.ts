/**
 * Invoice Creation Service
 *
 * Canonical owner for the create-from-job workflow:
 *   create invoice → refresh/populate lines → resolve tax → batch apply → snapshot
 *
 * All steps run inside a single transaction boundary (except the initial
 * createInvoiceFromJob which has its own internal locking transaction).
 *
 * 2026-03-19: Extracted from server/routes/invoices.ts (F-05, F-06 hardening).
 */

import { storage } from "../storage/index";
import { taxRepository } from "../storage/tax";
import { db } from "../db";
import { and, eq } from "drizzle-orm";
import { invoiceTaxLines } from "@shared/schema";
import type { InvoiceCreationSource } from "../storage/invoices";

// ============================================================================
// Due Date Calculation (F-06: single source of truth)
// ============================================================================

/**
 * Calculate invoice due date from issue date and payment terms.
 * Returns ISO date string (YYYY-MM-DD).
 *
 * Used by: PATCH /api/invoices/:id, POST /api/invoices/:id/send,
 * and any future endpoint that derives due date from terms.
 */
export function calculateDueDate(issuedAt: Date, paymentTermsDays: number): string {
  const dueDate = new Date(issuedAt.getTime() + paymentTermsDays * 24 * 60 * 60 * 1000);
  return dueDate.toISOString().split("T")[0];
}

// ============================================================================
// Create Invoice From Job (F-05: canonical workflow)
// ============================================================================

export interface CreateFromJobOptions {
  markJobCompleted?: boolean;
}

export interface CreateFromJobResult {
  invoice: any;
  created: boolean;
}

/**
 * Canonical create-from-job workflow:
 * 1. Create invoice (with SELECT FOR UPDATE locking + idempotency)
 * 2. Refresh/populate lines from job parts + labor
 * 3. Resolve default tax group
 * 4. Batch apply combined tax rate (single UPDATE + one recalculation)
 * 5. Snapshot tax component rates into invoice_tax_lines
 *
 * Steps 2–5 run inside a single transaction when the invoice is newly created.
 * Step 1 has its own internal locking transaction (createInvoiceFromJob).
 *
 * Returns { invoice, created } — caller decides lifecycle (markInvoiced, event log).
 */
export async function createInvoiceFromJob(
  companyId: string,
  jobId: string,
  options: CreateFromJobOptions = {},
  creationSource: InvoiceCreationSource = "INVOICE_ROUTE"
): Promise<CreateFromJobResult> {
  // Step 1: Create invoice (has own SELECT FOR UPDATE transaction internally)
  const result = await storage.createInvoiceFromJob(
    companyId,
    jobId,
    { markJobCompleted: options.markJobCompleted ?? false },
    creationSource
  );

  // If idempotent return (already existed), check for incomplete enrichment.
  // Scenario: Phase A committed (invoice row created) but Phase B failed (lines/tax
  // rolled back). On retry, Phase A returns created=false with the existing invoice.
  // If the invoice is still draft with 0 lines, re-run enrichment to complete it.
  if (!result.created) {
    const needsEnrichment =
      result.invoice.status === "draft" &&
      Array.isArray(result.lines) &&
      result.lines.length === 0;

    if (!needsEnrichment) {
      return { invoice: result.invoice, created: false };
    }
    // Fall through to Phase B enrichment below
  }

  // Steps 2–5: Populate lines, apply tax, snapshot — all in one transaction.
  // Storage methods receive the tx handle so they participate in this boundary
  // instead of creating their own independent committed transactions.
  await db.transaction(async (tx) => {
    // Step 2: Refresh/populate invoice lines from job parts + labor
    await storage.refreshInvoiceFromJob(companyId, result.invoice.id, tx);

    // Step 3: Resolve default tax group (read-only, runs on tx connection)
    const defaultGroup = await taxRepository.getDefaultTaxGroup(companyId);
    if (!defaultGroup || defaultGroup.rates.length === 0) {
      return; // No tax to apply
    }

    const combinedRate = defaultGroup.rates.reduce(
      (sum, r) => sum + parseFloat(r.rate || "0"), 0
    );

    // Set taxGroupId on the invoice
    await storage.updateInvoice(companyId, result.invoice.id, undefined, {
      taxGroupId: defaultGroup.id,
    }, tx);

    // Step 4: Batch apply combined rate (single UPDATE + one recalculation)
    const combinedRateDecimal = combinedRate / 100;
    const invoiceSubtotal = await storage.batchApplyLineTax(
      companyId, result.invoice.id, combinedRateDecimal, tx
    );

    // Step 5: Snapshot tax component rates (idempotent: delete existing first)
    await tx
      .delete(invoiceTaxLines)
      .where(and(
        eq(invoiceTaxLines.companyId, companyId),
        eq(invoiceTaxLines.invoiceId, result.invoice.id)
      ));
    const snapshotRows = defaultGroup.rates.map((r) => {
      const pct = parseFloat(r.rate || "0");
      const taxAmt = invoiceSubtotal * (pct / 100);
      return {
        companyId,
        invoiceId: result.invoice.id,
        taxRateId: r.id,
        taxRateName: r.name,
        ratePercent: r.rate,
        taxableAmount: String(invoiceSubtotal.toFixed(2)),
        taxAmount: String(taxAmt.toFixed(2)),
        taxGroupId: defaultGroup.id,
        taxGroupName: defaultGroup.name,
      };
    });
    if (snapshotRows.length > 0) {
      await tx.insert(invoiceTaxLines).values(snapshotRows);
    }
  });

  return { invoice: result.invoice, created: true };
}
