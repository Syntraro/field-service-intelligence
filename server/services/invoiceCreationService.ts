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
import { assertWritableSupportContext } from "../auth/supportContext";

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
  /** 2026-04-18 Phase 8 (invoice composition control):
   *  optional explicit selection of which time entries and/or parts to
   *  include. When omitted, the existing "all eligible" behavior runs.
   *  When provided, the enrichment step filters to exactly these IDs
   *  (intersected with the canonical eligibility predicates, so stale
   *  selections can never double-bill). */
  selection?: {
    partIds?: string[];
    timeEntryIds?: string[];
  };
}

export interface CreateFromJobResult {
  invoice: any;
  created: boolean;
}

/**
 * Canonical create-from-job workflow:
 * 1. Create invoice shell (new row every call, after dedupe guard).
 * 2. Refresh/populate lines from job parts + labor.
 * 3. Resolve default tax group.
 * 4. Batch apply combined tax rate (single UPDATE + one recalculation).
 * 5. Snapshot tax component rates into invoice_tax_lines.
 *
 * 2026-04-18 Phase 5/6 (multi-invoice-per-job + safety):
 *   - Phase 5 removed the one-invoice-per-job cardinality guard; a job
 *     may legitimately carry many invoices.
 *   - Phase 6 adds a narrow duplicate-submit guard here: if an invoice
 *     for THIS job was created within the last `DUPLICATE_SUBMIT_WINDOW_SEC`
 *     seconds, return it with `created: false` instead of making a new
 *     one. Prevents accidental double-click / network-retry duplicates
 *     without reintroducing cardinality enforcement. Legitimate second
 *     invoices created after the window passes are unaffected.
 *
 *   - The guard is intentionally short (3s) so it can't silently block
 *     an intentional rapid second invoice; the natural user path to
 *     create two invoices in quick succession involves at least a
 *     navigation round-trip.
 *   - When the caller passes `txHandle` (the atomic close+invoice flow
 *     in `POST /api/jobs/:id/close`), the guard is skipped — that path
 *     is not exposed to double-click risk and has its own lifecycle.
 *
 * `created: false` on the return type signals "deduped existing invoice";
 * downstream (event log + MARK_INVOICED) treat that like the prior
 * idempotent return so no second event / lifecycle transition fires.
 */
const DUPLICATE_SUBMIT_WINDOW_SEC = 3;

export async function createInvoiceFromJob(
  companyId: string,
  jobId: string,
  options: CreateFromJobOptions = {},
  creationSource: InvoiceCreationSource = "INVOICE_ROUTE",
  txHandle?: any
): Promise<CreateFromJobResult> {
  assertWritableSupportContext("invoice.createFromJob");

  // Duplicate-submit guard (skipped when caller owns the transaction).
  if (!txHandle) {
    const recent = await storage.findRecentInvoiceByJob(
      companyId,
      jobId,
      DUPLICATE_SUBMIT_WINDOW_SEC,
    );
    if (recent) {
      return { invoice: recent, created: false };
    }
  }

  const result = await storage.createInvoiceFromJob(
    companyId,
    jobId,
    { markJobCompleted: options.markJobCompleted ?? false },
    creationSource,
    txHandle
  );

  // Enrichment always runs now — the pre-Phase-5 !result.created
  // short-circuit was the only caller of the idempotent branch.
  // Phase 8: forward `options.selection` to `refreshInvoiceFromJob`
  // so the caller's explicit labor/parts choice flows end-to-end.
  const enrichInTx = async (tx: any) => {
    await storage.refreshInvoiceFromJob(companyId, result.invoice.id, tx, options.selection);
    const defaultGroup = await taxRepository.getDefaultTaxGroup(companyId);
    if (defaultGroup && defaultGroup.rates.length > 0) {
      await applyTaxGroupToInvoice(companyId, result.invoice.id, defaultGroup.id, tx);
    }
  };

  if (txHandle) {
    await enrichInTx(txHandle);
  } else {
    await db.transaction(enrichInTx);
  }

  return { invoice: result.invoice, created: true };
}

// ============================================================================
// Apply Tax Group to Invoice (shared canonical logic)
// ============================================================================

/**
 * Apply a specific tax group to an invoice, or remove tax (taxGroupId=null).
 * Canonical shared logic — used by both apply-tax route and standalone creation.
 *
 * When applying a group:
 *   1. Sets invoice.taxGroupId
 *   2. Batch applies combined rate to all lines
 *   3. Creates invoice_tax_lines snapshot
 *
 * When removing tax (taxGroupId=null):
 *   1. Clears invoice.taxGroupId
 *   2. Batch applies zero rate
 *   3. Deletes invoice_tax_lines snapshot
 *
 * Does NOT mutate company settings. Invoice-scoped only.
 */
/**
 * Core tax application logic — runs within a provided transaction or creates its own.
 * This is the SINGLE implementation of: resolve group → set taxGroupId → batch-apply rate → write snapshot.
 */
async function applyTaxGroupCore(
  companyId: string,
  invoiceId: string,
  taxGroupId: string | null,
  txHandle: any
): Promise<void> {
  if (taxGroupId === null) {
    await storage.batchApplyLineTax(companyId, invoiceId, 0, txHandle);
    await storage.updateInvoice(companyId, invoiceId, undefined, { taxGroupId: null }, txHandle);
    await txHandle.delete(invoiceTaxLines).where(and(
      eq(invoiceTaxLines.companyId, companyId),
      eq(invoiceTaxLines.invoiceId, invoiceId)
    ));
    return;
  }

  const group = await taxRepository.getTaxGroup(companyId, taxGroupId);
  if (!group || !group.rates || group.rates.length === 0) {
    return; // No-op if group missing/empty
  }

  const combinedRate = group.rates.reduce(
    (sum, r) => sum + parseFloat(r.rate || "0"), 0
  );
  const combinedRateDecimal = combinedRate / 100;

  await storage.updateInvoice(companyId, invoiceId, undefined, {
    taxGroupId: group.id,
  }, txHandle);

  const invoiceSubtotal = await storage.batchApplyLineTax(
    companyId, invoiceId, combinedRateDecimal, txHandle
  );

  // Snapshot: delete existing, insert fresh (audit/display only — not used for calculations)
  await txHandle.delete(invoiceTaxLines).where(and(
    eq(invoiceTaxLines.companyId, companyId),
    eq(invoiceTaxLines.invoiceId, invoiceId)
  ));
  const snapshotRows = group.rates.map((r) => {
    const pct = parseFloat(r.rate || "0");
    const taxAmt = invoiceSubtotal * (pct / 100);
    return {
      companyId,
      invoiceId,
      taxRateId: r.id,
      taxRateName: r.name,
      ratePercent: r.rate,
      taxableAmount: String(invoiceSubtotal.toFixed(2)),
      taxAmount: String(taxAmt.toFixed(2)),
      taxGroupId: group.id,
      taxGroupName: group.name,
    };
  });
  if (snapshotRows.length > 0) {
    await txHandle.insert(invoiceTaxLines).values(snapshotRows);
  }
}

/**
 * Apply a tax group to an invoice, or remove tax (taxGroupId=null).
 * Canonical shared function — used by apply-tax route and invoice creation paths.
 * Accepts optional txHandle to participate in an existing transaction.
 */
export async function applyTaxGroupToInvoice(
  companyId: string,
  invoiceId: string,
  taxGroupId: string | null,
  txHandle?: any
): Promise<void> {
  assertWritableSupportContext("invoice.applyTaxGroup");
  if (txHandle) {
    return applyTaxGroupCore(companyId, invoiceId, taxGroupId, txHandle);
  }
  return db.transaction(async (tx) => {
    return applyTaxGroupCore(companyId, invoiceId, taxGroupId, tx);
  });
}
