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
    } else {
      // 2026-05-01: structured warning when a tenant has no default tax
      // group (or has one with no rates). Pre-this-warning the guard
      // silently skipped tax application, surfacing as "No Tax" on the
      // resulting invoice with no operator visibility. The fix is a
      // one-time backfill migration that seeds a canonical group from
      // legacy `companies.defaultTaxRate` — see
      // `migrations/2026_05_01_seed_default_tax_groups.sql`. Logging at
      // the canonical write point makes any remaining gaps observable.
      console.warn(
        JSON.stringify({
          event: "invoice.created.no_default_tax_group",
          companyId,
          invoiceId: result.invoice.id,
          jobId,
          source: creationSource,
          hasGroup: !!defaultGroup,
          rateCount: defaultGroup?.rates.length ?? 0,
          timestamp: new Date().toISOString(),
        }),
      );
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

// ============================================================================
// 2026-05-02 (Audit #2 invoice-flow Phase 1) — Atomic Create From Builder
// ============================================================================
//
// Service wrapper for `POST /api/invoices/atomic`. Validates the payload,
// resolves the default tax group (when payload omits the field), wraps
// `storage.createInvoiceAtomic(...)` in the canonical create flow, then
// fires `lifecycle.markInvoiced` for any jobIds the caller asked to mark
// — the canonical lifecycle writer per `CLAUDE.md`.
//
// Lines are CLIENT-AUTHORITATIVE. The caller passes the final lines
// array; this service does NOT pull from jobs. `jobIds` are used for:
//   1. Validation (tenant ownership + same customer + ready-to-invoice).
//   2. Setting `invoices.jobId` to the FIRST jobId (the schema's
//      single-job primary pointer).
//   3. Lifecycle: optional `markInvoiced` per jobId (caller opt-in).

export interface CreateAtomicJobLine {
  description: string;
  quantity: string;
  unitPrice: string;
  unitCost?: string | null;
  productId?: string | null;
  lineItemType: "service" | "material" | "fee" | "discount";
  source: "manual" | "job" | "template" | "tech";
  jobLineItemId?: string | null;
  date?: string | null;
  technicianId?: string | null;
}

export interface CreateAtomicPayload {
  locationId: string;
  customerCompanyId?: string | null;
  jobIds?: string[];
  markJobsCompleted?: boolean;
  workDescription?: string | null;
  issueDate?: string;
  dueDate?: string | null;
  paymentTermsDays?: number | null;
  /** Caller can pin a tax group, set `null` to disable tax, or omit
   *  the field entirely to inherit the company default. */
  taxGroupId?: string | null;
  invoiceNumber?: string;
  notesInternal?: string;
  notesCustomer?: string;
  clientMessage?: string;
  showQuantity?: boolean;
  showUnitPrice?: boolean;
  showLineTotals?: boolean;
  showLineItems?: boolean;
  showBalance?: boolean;
  showJobDescription?: boolean;
  discountType?: "PERCENT" | "AMOUNT" | null;
  discountPercent?: string | null;
  discountAmount?: string | null;
  discountNotes?: string | null;
  lines?: CreateAtomicJobLine[];
}

export interface CreateAtomicActor {
  userId: string;
  role: string;
}

export interface CreateAtomicResult {
  invoice: any;
  invoiceNumber: string;
  /** Empty when no jobIds were sent or markJobsCompleted was false. */
  markedJobIds: string[];
}

/**
 * Validation error with optional structured detail. The route handler
 * unpacks this into the response body so the frontend can surface
 * conflict details (e.g. which job ids were already invoiced).
 */
export class CreateAtomicValidationError extends Error {
  status: number;
  detail?: Record<string, unknown>;
  constructor(status: number, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export async function createInvoiceAtomicService(
  companyId: string,
  payload: CreateAtomicPayload,
  actor: CreateAtomicActor,
): Promise<CreateAtomicResult> {
  assertWritableSupportContext("invoice.createAtomic");

  // ── 1) Location validation + customer derivation ───────────────────────
  const location = await storage.getClient(companyId, payload.locationId);
  if (!location) {
    throw new CreateAtomicValidationError(
      404,
      `Location not found for this company. Verify the location ID (${payload.locationId}) belongs to your account.`,
    );
  }

  const derivedCustomerCompanyId = location.parentCompanyId ?? null;
  const effectiveCustomerCompanyId =
    payload.customerCompanyId !== undefined
      ? payload.customerCompanyId
      : derivedCustomerCompanyId;

  // If caller asserted a customerCompanyId, it MUST match the location's
  // parent. Reject mismatches up front so the schema invariant
  // (`invoices.customerCompanyId === location.parentCompanyId`) holds.
  if (
    payload.customerCompanyId !== undefined &&
    payload.customerCompanyId !== null &&
    payload.customerCompanyId !== derivedCustomerCompanyId
  ) {
    throw new CreateAtomicValidationError(
      400,
      "customerCompanyId does not match the selected location's parent company.",
    );
  }

  // ── 2) Job validation (when jobIds present) ───────────────────────────
  const jobIds = (payload.jobIds ?? []).filter((id): id is string => typeof id === "string" && id.length > 0);
  const jobs: Array<{ id: string; companyId: string; locationId: string | null; status: string; invoiceId: string | null; version: number | null; customerCompanyId: string | null }> = [];

  if (jobIds.length > 0) {
    // Fetch each job once (canonical `storage.getJob` returns the row
    // with version + invoiceId + locationId fields we need).
    for (const jobId of jobIds) {
      const job = await storage.getJob(companyId, jobId);
      if (!job) {
        throw new CreateAtomicValidationError(
          404,
          `Job not found: ${jobId}`,
          { conflictJobIds: [jobId] },
        );
      }
      // Resolve customerCompanyId for the job: job → location.parent.
      const jobLocation = job.locationId
        ? await storage.getClient(companyId, job.locationId)
        : null;
      jobs.push({
        id: job.id,
        companyId: job.companyId,
        locationId: job.locationId ?? null,
        status: job.status,
        invoiceId: (job as any).invoiceId ?? null,
        version: (job as any).version ?? 0,
        customerCompanyId: jobLocation?.parentCompanyId ?? null,
      });
    }

    // 2a) All jobs share same customer as the picked location.
    const conflictByCustomer = jobs.filter(
      (j) => j.customerCompanyId !== effectiveCustomerCompanyId,
    );
    if (conflictByCustomer.length > 0) {
      throw new CreateAtomicValidationError(
        400,
        "All selected jobs must belong to the same customer as the picked location.",
        { conflictJobIds: conflictByCustomer.map((j) => j.id) },
      );
    }

    // 2b) Already-invoiced jobs → 409.
    const alreadyInvoiced = jobs.filter((j) => j.invoiceId !== null);
    if (alreadyInvoiced.length > 0) {
      throw new CreateAtomicValidationError(
        409,
        "One or more selected jobs are already invoiced.",
        { conflictJobIds: alreadyInvoiced.map((j) => j.id) },
      );
    }

    // 2c) Ready-to-invoice rule: status === 'completed'. Mirrors the
    //     existing `?readyToInvoiceOnly=true` filter in
    //     `server/storage/dashboard.ts:811` (status='completed' AND no
    //     invoice). The "no invoice" half is the prior check; this is
    //     the "completed" half.
    const notReady = jobs.filter((j) => j.status !== "completed");
    if (notReady.length > 0) {
      throw new CreateAtomicValidationError(
        400,
        "Selected jobs must be completed before they can be invoiced.",
        { conflictJobIds: notReady.map((j) => j.id) },
      );
    }
  }

  // ── 3) Tax group resolution ───────────────────────────────────────────
  // Caller can pass:
  //   - `null`     → no tax (zero rate, no snapshot)
  //   - <string>   → apply that group (validated below)
  //   - <missing>  → resolve to default (parity with existing standalone
  //                   create, which auto-applies default)
  let resolvedTaxGroupId: string | null;
  if (payload.taxGroupId === null) {
    resolvedTaxGroupId = null;
  } else if (typeof payload.taxGroupId === "string" && payload.taxGroupId.length > 0) {
    const group = await taxRepository.getTaxGroup(companyId, payload.taxGroupId);
    if (!group) {
      throw new CreateAtomicValidationError(
        404,
        `Tax group not found: ${payload.taxGroupId}`,
      );
    }
    resolvedTaxGroupId = group.id;
  } else {
    const defaultGroup = await taxRepository.getDefaultTaxGroup(companyId);
    resolvedTaxGroupId =
      defaultGroup && defaultGroup.rates.length > 0 ? defaultGroup.id : null;
  }

  // ── 4) Discount mutual validity ───────────────────────────────────────
  if (
    payload.discountType === "PERCENT" &&
    typeof payload.discountAmount === "string" &&
    payload.discountAmount.length > 0
  ) {
    throw new CreateAtomicValidationError(
      400,
      "discountType=PERCENT cannot include a discountAmount.",
    );
  }
  if (
    payload.discountType === "AMOUNT" &&
    typeof payload.discountPercent === "string" &&
    payload.discountPercent.length > 0
  ) {
    throw new CreateAtomicValidationError(
      400,
      "discountType=AMOUNT cannot include a discountPercent.",
    );
  }

  // ── 5) Storage create ─────────────────────────────────────────────────
  const primaryJobId = jobIds.length > 0 ? jobIds[0] : null;
  const linesToInsert = (payload.lines ?? []).map((l) => ({
    description: l.description,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    unitCost: l.unitCost ?? null,
    productId: l.productId ?? null,
    lineItemType: l.lineItemType,
    source: l.source,
    jobLineItemId: l.jobLineItemId ?? null,
    date: l.date ?? null,
    technicianId: l.technicianId ?? null,
  }));

  const { invoice, invoiceNumber } = await storage.createInvoiceAtomic(
    companyId,
    {
      locationId: payload.locationId,
      customerCompanyId: effectiveCustomerCompanyId,
      primaryJobId,
      workDescription: payload.workDescription ?? null,
      issueDate: payload.issueDate,
      dueDate: payload.dueDate,
      paymentTermsDays: payload.paymentTermsDays ?? undefined,
      invoiceNumber: payload.invoiceNumber,
      notesInternal: payload.notesInternal,
      notesCustomer: payload.notesCustomer,
      clientMessage: payload.clientMessage,
      showQuantity: payload.showQuantity,
      showUnitPrice: payload.showUnitPrice,
      showLineTotals: payload.showLineTotals,
      showLineItems: payload.showLineItems,
      showBalance: payload.showBalance,
      showJobDescription: payload.showJobDescription,
      discountType: payload.discountType,
      discountPercent: payload.discountPercent,
      discountAmount: payload.discountAmount,
      discountNotes: payload.discountNotes,
      taxGroupId: resolvedTaxGroupId,
    },
    linesToInsert,
    "ATOMIC_ROUTE",
  );

  // ── 6) Job lifecycle (markInvoiced per jobId) ─────────────────────────
  // Run AFTER the create transaction commits so the invoice exists when
  // the lifecycle writer reads `invoiceId`. Sequential is safe — each
  // markInvoiced opens its own short transaction and is idempotent on
  // re-run via the canonical lifecycle engine.
  const markedJobIds: string[] = [];
  if (payload.markJobsCompleted === true && jobs.length > 0) {
    // Lazy import to avoid a static import cycle: jobLifecycleOrchestrator
    // already imports from storage which transitively reaches here.
    const { markInvoiced } = await import("./jobLifecycleOrchestrator");
    for (const j of jobs) {
      try {
        await markInvoiced({
          type: "MARK_INVOICED",
          companyId,
          jobId: j.id,
          version: j.version ?? 0,
          actor: { userId: actor.userId, role: actor.role },
          invoiceId: invoice.id,
        });
        markedJobIds.push(j.id);
      } catch (err) {
        // Best-effort: a markInvoiced failure (e.g. version conflict from
        // a concurrent edit) does not roll back the invoice. Log + carry
        // on; operator can re-run the lifecycle transition manually.
        console.warn(
          JSON.stringify({
            event: "invoice.atomic.mark_invoiced_failed",
            companyId,
            invoiceId: invoice.id,
            jobId: j.id,
            error: err instanceof Error ? err.message : String(err),
            timestamp: new Date().toISOString(),
          }),
        );
      }
    }
  }

  return { invoice, invoiceNumber, markedJobIds };
}
