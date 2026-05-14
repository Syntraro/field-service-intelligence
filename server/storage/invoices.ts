import { db } from "../db";
import { eq, and, sql, desc, or, lt, isNull, isNotNull, asc, inArray } from "drizzle-orm";
import { invoices, invoiceLines, invoiceTaxLines, clients, payments, jobs, jobParts, laborEntries, technicians, timeEntries, users, companySettings, customerCompanies, items, type InvoiceStatus } from "@shared/schema";
import { BaseRepository, parseDecimal } from "./base";
import { activeJobFilter } from "./jobFilters";
import { UNPAID_INVOICE_STATUSES } from "./invoicesFeed";
// 2026-04-09: activeInvoiceFilter removed from runtime — invoices have no
// soft-delete state under the permanent-delete model. See migrations/2026_04_09_invoice_permanent_delete.sql.
import { locationDisplayNameExpr } from "../lib/queryHelpers";
import { encodeCursor, decodeCursor } from "../utils/cursor";
import type { PaginationParams } from "../utils/pagination";
import type { PaginatedResult } from "./types";
import {
  timeBillingRulesRepository,
  applyBillingRulesToEntries,
  type TimeBillingRulesWithDefaults,
} from "./timeBillingRules";

// ============================================================================
// PHASE A.1.1: INVOICE CREATION SOURCE GUARD (COMPILE-TIME + RUNTIME)
// ============================================================================
/**
 * Authoritative list of allowed invoice creation sources.
 * Adding a new source requires intentional edit here and documentation update.
 *
 * INVOICE_ROUTE: POST /api/invoices/from-job/:jobId
 * JOB_CLOSE_ROUTE: POST /api/jobs/:id/close (mode=invoice_now)
 */
export const INVOICE_CREATION_SOURCES = [
  "INVOICE_ROUTE",
  "JOB_CLOSE_ROUTE",
  "PM_BILLING_SERVICE", // PM Billing Phase 2: Contract-period billing events
  "STANDALONE_ROUTE",   // Standalone invoice creation without job/PM dependency
  "IMPORT_ROUTE",       // 2026-04-22: Canonical invoice CSV importer (InvoiceImportAdapter)
  // 2026-05-02 (Audit #2 invoice-flow Phase 1): atomic create-with-lines
  // route used by the future client-side `/invoices/new` builder. Single
  // POST `/api/invoices/atomic` carries all header fields + line items +
  // discount + tax + optional jobIds in one transaction. Lines are
  // CLIENT-AUTHORITATIVE (server does not pull from jobs); jobIds are
  // used only for validation, primary-pointer, and lifecycle markInvoiced.
  "ATOMIC_ROUTE",
] as const;

/**
 * Type for invoice creation source - compile-time enforcement.
 * Any call to createInvoiceFromJob() MUST pass one of these values.
 */
export type InvoiceCreationSource = (typeof INVOICE_CREATION_SOURCES)[number];

/**
 * Result from idempotent invoice creation
 */
export interface CreateInvoiceResult {
  invoice: any;
  created: boolean; // true if newly created, false if already existed
  lines?: any[];
}

/**
 * Invoice pre-validation result
 */
export interface InvoiceValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  billableItems: {
    partsCount: number;
    laborMinutes: number;
    timeEntriesCount: number;
    estimatedTotal: number;
  };
}

/**
 * InvoiceRepository - Handles all invoice database operations
 *
 * PHASE A.1 INVOICE CREATION SAFETY:
 * ================================
 * ALL invoice creation MUST go through createInvoiceFromJob() which provides:
 * - SELECT FOR UPDATE locking to prevent race conditions
 * - Idempotency guarantees (same job = same invoice)
 * - Proper invoice number sequencing
 * - Invoice-to-job linking (invoiceId set on job)
 *
 * There is NO public createInvoice() method by design.
 * Direct db.insert(invoices) outside of createInvoiceFromJob() is PROHIBITED.
 *
 * Routes that create invoices:
 * - POST /api/invoices/from-job/:jobId -> calls createInvoiceFromJob()
 * - POST /api/jobs/:id/close (mode=invoice_now) -> calls createInvoiceFromJob()
 */
export class InvoiceRepository extends BaseRepository {
  /**
   * Get invoices for a company with client data (paginated)
   * Supports cursor-based or offset-based pagination
   * Order: createdAt DESC, id DESC (stable cursor ordering)
   */
  async getInvoices(companyId: string, pagination: PaginationParams): Promise<PaginatedResult<any>> {
    this.assertCompanyId(companyId);

    const { limit, cursor, offset } = pagination;
    const fetchLimit = limit + 1;

    const selectFields = {
      id: invoices.id,
      companyId: invoices.companyId,
      locationId: invoices.locationId,
      customerCompanyId: invoices.customerCompanyId,
      invoiceNumber: invoices.invoiceNumber,
      status: invoices.status,
      issueDate: invoices.issueDate,
      dueDate: invoices.dueDate,
      // Payment terms fields
      paymentTermsDays: invoices.paymentTermsDays,
      issuedAt: invoices.issuedAt,
      currency: invoices.currency,
      subtotal: invoices.subtotal,
      taxTotal: invoices.taxTotal,
      total: invoices.total,
      amountPaid: invoices.amountPaid,
      balance: invoices.balance,
      jobId: invoices.jobId,
      taxGroupId: invoices.taxGroupId,
      sentAt: invoices.sentAt,
      sentByUserId: invoices.sentByUserId,
      viewedAt: invoices.viewedAt,
      workDescription: invoices.workDescription,
      clientMessage: invoices.clientMessage,
      showQuantity: invoices.showQuantity,
      showUnitPrice: invoices.showUnitPrice,
      showLineTotals: invoices.showLineTotals,
      showLineItems: invoices.showLineItems,
      showBalance: invoices.showBalance,
      qboInvoiceId: invoices.qboInvoiceId,
      qboSyncToken: invoices.qboSyncToken,
      qboLastSyncedAt: invoices.qboLastSyncedAt,
      qboDocNumber: invoices.qboDocNumber,
      qboOutOfSync: invoices.qboOutOfSync,
      // Phase 11: Discount fields
      discountType: invoices.discountType,
      discountPercent: invoices.discountPercent,
      discountAmount: invoices.discountAmount,
      discountNotes: invoices.discountNotes,
      dirty: invoices.dirty,
      version: invoices.version,
      createdAt: invoices.createdAt,
      updatedAt: invoices.updatedAt,
      client: {
        id: clients.id,
        companyName: clients.companyName,
        location: clients.location,
      }
    };

    let query = db
      .select(selectFields)
      .from(invoices)
      .leftJoin(clients, eq(invoices.locationId, clients.id))
      .where(and(
        eq(invoices.companyId, companyId)
      ))
      .$dynamic();

    if (cursor) {
      const { createdAtISO, id: cursorId } = decodeCursor(cursor);
      const cursorDate = new Date(createdAtISO);
      query = query.where(
        or(
          lt(invoices.createdAt, cursorDate),
          and(eq(invoices.createdAt, cursorDate), lt(invoices.id, cursorId))
        )
      );
    }

    query = query
      .orderBy(desc(invoices.createdAt), desc(invoices.id))
      .limit(fetchLimit);

    if (offset !== undefined && !cursor) {
      query = query.offset(offset);
    }

    const rows = await query;
    const hasMore = rows.length > limit;
    const rawItems = hasMore ? rows.slice(0, limit) : rows;

    // Transform items to add computed display names for client and derived isPastDue
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const items = rawItems.map(row => ({
      ...row,
      // Computed: locationName = location site name OR fallback to company name + address
      locationName: row.client?.location || row.client?.companyName || null,
      // Computed: customerCompanyName = the parent company name (stored in companyName)
      customerCompanyName: row.client?.companyName || null,
      // Derived: isPastDue - true if unpaid and past due date
      isPastDue: this.computeIsPastDue(row.status, row.dueDate, row.balance, today),
    }));

    const meta: PaginatedResult<any>["meta"] = { limit, hasMore };

    if (hasMore && items.length > 0) {
      const lastItem = items[items.length - 1];
      if (cursor !== undefined || offset === undefined) {
        meta.nextCursor = encodeCursor(
          (lastItem.createdAt as Date).toISOString(),
          lastItem.id
        );
      } else {
        meta.nextOffset = offset + limit;
      }
    }

    return { items, meta };
  }

  /**
   * Get single invoice with client data
   */
  async getInvoice(companyId: string, invoiceId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(invoiceId, "invoiceId");

    const rows = await db
      .select({
        // All invoice fields
        id: invoices.id,
        companyId: invoices.companyId,
        locationId: invoices.locationId,
        customerCompanyId: invoices.customerCompanyId,
        invoiceNumber: invoices.invoiceNumber,
        status: invoices.status,
        issueDate: invoices.issueDate,
        dueDate: invoices.dueDate,
        // Payment terms fields
        paymentTermsDays: invoices.paymentTermsDays,
        issuedAt: invoices.issuedAt,
        currency: invoices.currency,
        subtotal: invoices.subtotal,
        taxTotal: invoices.taxTotal,
        total: invoices.total,
        amountPaid: invoices.amountPaid,
        balance: invoices.balance,
        jobId: invoices.jobId,
        taxGroupId: invoices.taxGroupId,
        sentAt: invoices.sentAt,
        sentByUserId: invoices.sentByUserId,
        viewedAt: invoices.viewedAt,
        // 2026-05-03: canonical short invoice title.
        summary: invoices.summary,
        workDescription: invoices.workDescription,
        clientMessage: invoices.clientMessage,
        showQuantity: invoices.showQuantity,
        showUnitPrice: invoices.showUnitPrice,
        showLineTotals: invoices.showLineTotals,
        showLineItems: invoices.showLineItems,
        showBalance: invoices.showBalance,
        // 2026-05-06: previously missing from the explicit projection,
        // which meant the API silently dropped `showJobDescription` from
        // every invoice read. The InvoiceDetailPage Client Visibility
        // card couldn't see operator toggles round-trip and the resolver
        // received `undefined` for the per-invoice flag (resolver fell
        // through to tenant default — accidentally correct for the
        // "inherit" case but broken for the "explicit override" case).
        showJobDescription: invoices.showJobDescription,
        qboInvoiceId: invoices.qboInvoiceId,
        qboSyncToken: invoices.qboSyncToken,
        qboLastSyncedAt: invoices.qboLastSyncedAt,
        qboDocNumber: invoices.qboDocNumber,
        qboSyncStatus: invoices.qboSyncStatus,
        qboSyncError: invoices.qboSyncError,
        // Phase 10A: QBO lock fields
        billingLockedAt: invoices.billingLockedAt,
        billingLockReason: invoices.billingLockReason,
        qboOutOfSync: invoices.qboOutOfSync,
        qboOutOfSyncAt: invoices.qboOutOfSyncAt,
        qboOutOfSyncReason: invoices.qboOutOfSyncReason,
        lastBillingEditAt: invoices.lastBillingEditAt,
        lastBillingEditBy: invoices.lastBillingEditBy,
        // Phase 11: Discount fields
        discountType: invoices.discountType,
        discountPercent: invoices.discountPercent,
        discountAmount: invoices.discountAmount,
        discountNotes: invoices.discountNotes,
        dirty: invoices.dirty,
        version: invoices.version,
        createdAt: invoices.createdAt,
        updatedAt: invoices.updatedAt,
        // 2026-05-03 generalized email-send tracking (was reminder-specific
        // until that pass; renamed in the same commit). The
        // automated reminder sweep + the canonical email send path
        // both bump these.
        lastEmailedAt: invoices.lastEmailedAt,
        emailSendCount: invoices.emailSendCount,
        remindersPaused: invoices.remindersPaused,
        reminderSnoozeUntil: invoices.reminderSnoozeUntil,
        // Add client data
        client: {
          id: clients.id,
          companyName: clients.companyName,
          location: clients.location,
          address: clients.address,
          city: clients.city,
          province: clients.province,
          postalCode: clients.postalCode,
        }
      })
      .from(invoices)
      .leftJoin(clients, eq(invoices.locationId, clients.id))
      .where(and(
        eq(invoices.id, invoiceId),
        eq(invoices.companyId, companyId)
      ))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    // Add derived isPastDue
    return {
      ...row,
      isPastDue: this.computeIsPastDue(row.status, row.dueDate, row.balance),
    };
  }

  /**
   * Get the primary invoice for a job (canonical primary-pointer read).
   *
   * 2026-04-18 Phase 5 (billing): under the multi-invoice model, a job
   * may have many invoices. The singular "by job" lookup now resolves to
   * `jobs.invoiceId` — the primary pointer set at first-invoice creation.
   * When no primary is set (no invoices yet), returns null.
   *
   * Callers that want every invoice for a job should use
   * `listInvoicesByJobId()` (or the canonical `/api/invoices/list?jobId=`).
   */
  async getPrimaryInvoiceByJobId(companyId: string, jobId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    const [job] = await db
      .select({ invoiceId: jobs.invoiceId })
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)))
      .limit(1);
    if (!job?.invoiceId) return null;

    const [row] = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.companyId, companyId), eq(invoices.id, job.invoiceId)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Compute what's currently billable for a job — the un-allocated job
   * parts only. Labour was removed from this preview 2026-05-05; tracked
   * labour never auto-creates invoice lines.
   *
   * Parts eligibility mirrors the Phase 7 allocation guard in
   * `refreshInvoiceFromJob`: no existing `invoice_lines.jobLineItemId`
   * row references this part from any invoice on this job.
   *
   * Returns money fields as strings to match the rest of the invoice
   * pipeline (numeric-as-string is the canonical precision discipline).
   *
   * The response still carries `labor: []` and `laborSubtotal: "0.00"`
   * so older clients (InvoiceCompositionDialog before 2026-05-05) do not
   * crash on missing fields. Both fields will always be empty.
   */
  async getBillablePreviewForJob(companyId: string, jobId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    // ── Labour ───────────────────────────────────────────────────────
    // 2026-05-05: tracked labour does NOT flow onto invoices. Always empty.
    const labor: Array<never> = [];
    const laborSubtotalCents = 0;

    // ── Parts ────────────────────────────────────────────────────────
    const partsRaw = await db
      .select({
        id: jobParts.id,
        description: jobParts.description,
        quantity: jobParts.quantity,
        unitPrice: jobParts.unitPrice,
      })
      .from(jobParts)
      .where(
        and(
          eq(jobParts.companyId, companyId),
          eq(jobParts.jobId, jobId),
          eq(jobParts.isActive, true),
          sql`NOT EXISTS (
            SELECT 1
              FROM ${invoiceLines} AS il_sibling
              JOIN ${invoices}     AS inv_sibling
                ON inv_sibling.id = il_sibling.invoice_id
             WHERE il_sibling.company_id = ${companyId}
               AND il_sibling.source = 'job'
               AND il_sibling.job_line_item_id = ${jobParts.id}
               AND inv_sibling.company_id = ${companyId}
               AND inv_sibling.job_id = ${jobId}
          )`,
        ),
      )
      .orderBy(asc(jobParts.sortOrder));

    let partsSubtotalCents = 0;
    const parts = partsRaw.map((p) => {
      const qty = parseFloat(p.quantity || "1");
      const unitPrice = parseFloat(String(p.unitPrice || "0"));
      const lineCents = Math.round(qty * unitPrice * 100);
      partsSubtotalCents += lineCents;
      return {
        id: p.id,
        description: p.description,
        quantity: p.quantity,
        unitPrice: unitPrice.toFixed(2),
        lineSubtotal: (lineCents / 100).toFixed(2),
      };
    });

    const subtotalCents = laborSubtotalCents + partsSubtotalCents;
    return {
      labor,
      parts,
      laborSubtotal: (laborSubtotalCents / 100).toFixed(2),
      partsSubtotal: (partsSubtotalCents / 100).toFixed(2),
      subtotal: (subtotalCents / 100).toFixed(2),
    };
  }

  /**
   * List every invoice for a job (canonical plural read).
   * 2026-04-18 Phase 5: multi-invoice-per-job is now valid.
   * Ordered newest-first by `issueDate` then `createdAt` for deterministic paging.
   */
  async listInvoicesByJobId(companyId: string, jobId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    return db
      .select()
      .from(invoices)
      .where(and(eq(invoices.companyId, companyId), eq(invoices.jobId, jobId)))
      .orderBy(desc(invoices.issueDate), desc(invoices.createdAt));
  }

  /**
   * Phase 6 (multi-invoice usability): short-lived duplicate-submit
   * guard. Returns the most recently created invoice for this job if
   * its `createdAt` is within the given window, else null.
   *
   * Used by `invoiceCreationService.createInvoiceFromJob()` to short-
   * circuit accidental double-clicks / network retries without
   * reintroducing the cardinality guard that Phase 5 removed. A
   * legitimate second invoice created after the window passes is
   * unaffected — this is a submit-dedupe, not a cardinality constraint.
   */
  async findRecentInvoiceByJob(
    companyId: string,
    jobId: string,
    windowSeconds: number,
  ) {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");
    if (windowSeconds <= 0) return null;

    const cutoff = new Date(Date.now() - windowSeconds * 1000);
    const [row] = await db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, companyId),
          eq(invoices.jobId, jobId),
          sql`${invoices.createdAt} > ${cutoff}`,
        ),
      )
      .orderBy(desc(invoices.createdAt))
      .limit(1);
    return row ?? null;
  }

  /**
   * Phase 6 (primary invoice management): explicit manual primary
   * reassignment. Sets `jobs.invoiceId = invoiceId` for the job that
   * the invoice belongs to. Caller is responsible for authorization.
   *
   * Validates:
   *   - the invoice exists and is tenant-scoped
   *   - the invoice's own `jobId` is set (cannot promote a PM-billing
   *     invoice with no job link to be a job's primary)
   *
   * Returns the updated job row. Throws if validation fails.
   * No auto-promotion on delete — this method is the ONLY path that
   * writes a non-null `jobs.invoiceId` after the initial auto-set in
   * `createInvoiceFromJob()`.
   */
  async setPrimaryInvoiceForJob(companyId: string, invoiceId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(invoiceId, "invoiceId");

    const [inv] = await db
      .select({ id: invoices.id, jobId: invoices.jobId })
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)))
      .limit(1);
    if (!inv) throw this.notFoundError("Invoice");
    if (!inv.jobId) {
      throw this.validationError(
        "Cannot set a job-less (e.g. PM-billing) invoice as a job's primary invoice.",
      );
    }

    const [job] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.id, inv.jobId), eq(jobs.companyId, companyId)))
      .limit(1);
    if (!job) throw this.notFoundError("Job");

    const [updated] = await db
      .update(jobs)
      .set({ invoiceId: invoiceId, updatedAt: new Date() })
      .where(and(eq(jobs.id, inv.jobId), eq(jobs.companyId, companyId)))
      .returning();
    return updated;
  }

  /**
   * Get invoice statistics
   */
  async getInvoiceStats(companyId: string) {
    const result = await db
      .select({
        status: invoices.status,
        count: sql<number>`count(*)`,
        totalAmount: sql<number>`COALESCE(sum(${invoices.total}), 0)`,
      })
      .from(invoices)
      .where(and(
        eq(invoices.companyId, companyId)
      ))
      .groupBy(invoices.status);

    return result;
  }

  /**
   * Update invoice with optimistic locking
   * @param currentVersion - Current version from client (for optimistic locking)
   */
  async updateInvoice(
    companyId: string,
    invoiceId: string,
    currentVersion: number | undefined,
    patch: any,
    txHandle?: any
  ) {
    const queryDb = txHandle ?? db;
    this.assertCompanyId(companyId);
    this.validateUUID(invoiceId, "invoiceId");

    // If no version provided, skip version check (backward compatibility)
    if (currentVersion === undefined) {
      const rows = await queryDb
        .update(invoices)
        .set({
          ...patch,
          version: sql`${invoices.version} + 1`,
          updatedAt: new Date()
        })
        // 2026-04-09: soft-delete guard removed — invoices have no soft-delete state
        // under the permanent-delete model.
        .where(and(
          eq(invoices.id, invoiceId),
          eq(invoices.companyId, companyId)
        ))
        .returning();

      return rows[0] ?? null;
    }

    // With version check - optimistic locking
    const rows = await queryDb
      .update(invoices)
      .set({
        ...patch,
        version: sql`${invoices.version} + 1`, // Increment version
        updatedAt: new Date(),
      })
      // 2026-04-09: soft-delete guard removed — invoices have no soft-delete state
      // under the permanent-delete model.
      .where(
        and(
          eq(invoices.id, invoiceId),
          eq(invoices.companyId, companyId),
          eq(invoices.version, currentVersion) // Check version matches!
        )
      )
      .returning();

    if (rows.length === 0) {
      // Either invoice doesn't exist OR version mismatch
      const existing = await this.getInvoice(companyId, invoiceId);
      if (!existing) {
        throw this.notFoundError("Invoice");
      }

      // Version mismatch
      throw new Error(
        `Invoice was modified by another user. Please reload and try again. ` +
        `(Expected version: ${currentVersion}, Actual version: ${existing.version})`
      );
    }

    return rows[0];
  }

  /**
   * Get invoice lines
   */
  async getInvoiceLines(companyId: string, invoiceId: string) {
    // Verify invoice belongs to company
    const invoice = await this.getInvoice(companyId, invoiceId);
    if (!invoice) {
      throw this.notFoundError("Invoice");
    }

    return await db
      .select()
      .from(invoiceLines)
      .where(and(
        eq(invoiceLines.companyId, companyId),
        eq(invoiceLines.invoiceId, invoiceId)
      ))
      .orderBy(invoiceLines.lineNumber);
  }

  /**
   * Create invoice line (with transaction)
   */
  async createInvoiceLine(companyId: string, invoiceId: string, lineData: any) {
    // Verify invoice belongs to company
    const invoice = await this.getInvoice(companyId, invoiceId);
    if (!invoice) {
      throw this.notFoundError("Invoice");
    }

    // Use transaction to ensure line + totals are atomic
    return await db.transaction(async (tx) => {
      // Determine next line_number if not provided
      if (!lineData.lineNumber) {
        const [maxRow] = await tx
          .select({ maxNum: sql<number>`coalesce(max(${invoiceLines.lineNumber}), 0)` })
          .from(invoiceLines)
          .where(and(eq(invoiceLines.invoiceId, invoiceId), eq(invoiceLines.companyId, companyId)));
        lineData.lineNumber = (maxRow?.maxNum ?? 0) + 1;
      }

      const [line] = await tx
        .insert(invoiceLines)
        .values({
          ...lineData,
          companyId, // Add tenant isolation
          source: lineData?.source ?? "manual",
          invoiceId
        })
        .returning();

      // Recalculate totals within same transaction
      await this.recalculateInvoiceTotalsInTx(tx, companyId, invoiceId);

      return line;
    });
  }

  /**
   * Update an invoice line (with total recalculation).
   * Used by tax group integration to apply per-line tax rates.
   */
  async updateInvoiceLine(companyId: string, invoiceId: string, lineId: string, data: Record<string, unknown>) {
    return await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(invoiceLines)
        .set(data)
        .where(and(
          eq(invoiceLines.companyId, companyId),
          eq(invoiceLines.id, lineId),
          eq(invoiceLines.invoiceId, invoiceId)
        ))
        .returning();

      if (!updated) return null;

      // Recalculate totals
      await this.recalculateInvoiceTotalsInTx(tx, companyId, invoiceId);
      return updated;
    });
  }

  /**
   * Batch-apply a uniform tax rate to all lines of an invoice in a single statement,
   * then recalculate invoice totals once. Used by tax group integration during
   * invoice creation to avoid N individual updateInvoiceLine() round-trips.
   *
   * Returns the total lineSubtotal across all lines (needed for tax snapshot).
   */
  async batchApplyLineTax(companyId: string, invoiceId: string, combinedRateDecimal: number, txHandle?: any): Promise<number> {
    const runInTx = async (tx: any) => {
      // Single UPDATE: apply tax rate, compute taxAmount and lineTotal for all lines.
      // 2026-05-03 numeric/text fix: the prior SQL cast the computed
      // `tax_amount` and `line_total` expressions to `::text` before the
      // assignment, which Postgres rejected as
      //   `column "tax_amount" is of type numeric but expression is of type text`.
      // numeric → numeric is the correct assignment shape; the
      // ::text cast was an authoring mistake (Drizzle reads numeric
      // columns as strings on the JS side, but the wire-format cast is
      // automatic — the SQL expression itself must remain numeric so
      // Postgres can match the column type).
      await (tx as any).execute(sql`
        UPDATE invoice_lines
        SET tax_rate = ${String(combinedRateDecimal)},
            tax_amount = ROUND(CAST(line_subtotal AS numeric) * ${combinedRateDecimal}, 2),
            line_total = ROUND(CAST(line_subtotal AS numeric) + CAST(line_subtotal AS numeric) * ${combinedRateDecimal}, 2),
            updated_at = NOW()
        WHERE company_id = ${companyId}
          AND invoice_id = ${invoiceId}
      `);

      // Sum lineSubtotal for tax snapshot (one query)
      const [sumRow] = await tx
        .select({ total: sql<string>`COALESCE(SUM(CAST(${invoiceLines.lineSubtotal} AS numeric)), 0)::text` })
        .from(invoiceLines)
        .where(and(eq(invoiceLines.companyId, companyId), eq(invoiceLines.invoiceId, invoiceId)));
      const invoiceSubtotal = parseFloat(sumRow?.total ?? "0");

      // Recalculate invoice totals once (not N times)
      await this.recalculateInvoiceTotalsInTx(tx, companyId, invoiceId);

      return invoiceSubtotal;
    };

    // If caller provided a tx handle, run directly on it. Otherwise wrap in own tx.
    return txHandle ? runInTx(txHandle) : db.transaction(runInTx);
  }

  /**
   * Delete invoice line (with transaction)
   */
  async deleteInvoiceLine(companyId: string, invoiceId: string, lineId: string) {
    // Verify invoice belongs to company
    const invoice = await this.getInvoice(companyId, invoiceId);
    if (!invoice) {
      throw this.notFoundError("Invoice");
    }

    // Use transaction to ensure delete + totals are atomic
    return await db.transaction(async (tx) => {
      const [deleted] = await tx
        .delete(invoiceLines)
        .where(and(
          eq(invoiceLines.companyId, companyId), // Tenant isolation
          eq(invoiceLines.id, lineId),
          eq(invoiceLines.invoiceId, invoiceId)
        ))
        .returning();

      if (!deleted) {
        return null;
      }

      // Recalculate totals within same transaction
      await this.recalculateInvoiceTotalsInTx(tx, companyId, invoiceId);

      return deleted;
    });
  }

  /**
   * Recalculate invoice totals (delegates to transaction version)
   * Phase 11: Now handles discounts
   */
  private async recalculateInvoiceTotals(companyId: string, invoiceId: string): Promise<void> {
    await db.transaction(async (tx) => {
      await this.recalculateInvoiceTotalsInTx(tx, companyId, invoiceId);
    });
  }

  /**
   * Recalculate invoice totals within a transaction
   */
  private async recalculateInvoiceTotalsInTx(tx: any, companyId: string, invoiceId: string): Promise<void> {
    // Get current invoice to read discount settings
    const [invoice] = await tx
      .select({
        discountType: invoices.discountType,
        discountPercent: invoices.discountPercent,
        discountAmount: invoices.discountAmount,
        amountPaid: invoices.amountPaid,
      })
      .from(invoices)
      .where(and(eq(invoices.companyId, companyId), eq(invoices.id, invoiceId)));

    // Sum line items
    const rows = await tx
      .select({
        subtotal: sql<number>`COALESCE(SUM(${invoiceLines.lineSubtotal}), 0)`,
        taxTotal: sql<number>`COALESCE(SUM(${invoiceLines.lineSubtotal} * ${invoiceLines.taxRate}), 0)`,
      })
      .from(invoiceLines)
      .where(and(
        eq(invoiceLines.companyId, companyId), // Tenant isolation
        eq(invoiceLines.invoiceId, invoiceId)
      ));

    const lineTotals = rows[0] ?? { subtotal: 0, taxTotal: 0 };
    const subtotal = parseFloat(String(lineTotals.subtotal)) || 0;

    // Phase 11: Calculate discount
    let discountAmountComputed = 0;
    let discountPercentComputed = 0;
    const discountType = invoice?.discountType;

    if (discountType === "PERCENT" && invoice?.discountPercent) {
      discountPercentComputed = parseFloat(invoice.discountPercent) || 0;
      discountAmountComputed = this.roundCurrency(subtotal * (discountPercentComputed / 100));
    } else if (discountType === "AMOUNT" && invoice?.discountAmount) {
      discountAmountComputed = Math.min(parseFloat(invoice.discountAmount) || 0, subtotal);
      discountPercentComputed = subtotal > 0
        ? this.roundPercent((discountAmountComputed / subtotal) * 100)
        : 0;
    }

    // Discounted subtotal (never negative)
    const discountedSubtotal = Math.max(0, subtotal - discountAmountComputed);

    // Recalculate tax on discounted subtotal
    // Note: We calculate proportional tax reduction based on discount
    const originalTax = parseFloat(String(lineTotals.taxTotal)) || 0;
    const taxRatio = subtotal > 0 ? discountedSubtotal / subtotal : 0;
    const adjustedTax = this.roundCurrency(originalTax * taxRatio);

    // Final total
    const total = this.roundCurrency(discountedSubtotal + adjustedTax);

    // Balance = total - amountPaid
    const amountPaid = parseFloat(invoice?.amountPaid || "0") || 0;
    const balance = this.roundCurrency(total - amountPaid);

    await tx
      .update(invoices)
      .set({
        subtotal: String(subtotal.toFixed(2)),
        taxTotal: String(adjustedTax.toFixed(2)),
        total: String(total.toFixed(2)),
        balance: String(balance.toFixed(2)),
        // Update computed discount values (keep original type, update complementary value)
        discountPercent: discountType ? String(discountPercentComputed.toFixed(2)) : null,
        discountAmount: discountType ? String(discountAmountComputed.toFixed(2)) : null,
        updatedAt: new Date(),
      })
      .where(and(eq(invoices.companyId, companyId), eq(invoices.id, invoiceId)));
  }

  /** Round to 2 decimal places for currency */
  private roundCurrency(value: number): number {
    return Math.round(value * 100) / 100;
  }

  /** Round to 2 decimal places for percentage */
  private roundPercent(value: number): number {
    return Math.round(value * 100) / 100;
  }

  /**
   * Get invoices for dashboard widget:
   * - Past due invoices first (sorted by dueDate ascending - oldest overdue first)
   * - Then awaiting payment invoices (sorted by dueDate ascending - soonest due first)
   * - Returns up to `limit` invoices with minimal fields
   */
  async getDashboardInvoices(companyId: string, limit: number = 10) {
    this.assertCompanyId(companyId);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Fetch unpaid invoices with balance > 0

    // Phase 4 Step D: join customerCompanies for correct display name
    const rows = await db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        status: invoices.status,
        dueDate: invoices.dueDate,
        total: invoices.total,
        balance: invoices.balance,
        locationName: clients.location,
        // Phase 4 Step D: canonical location display name helper
        locationDisplayName: locationDisplayNameExpr,
      })
      .from(invoices)
      .leftJoin(clients, eq(invoices.locationId, clients.id))
      .leftJoin(customerCompanies, eq(clients.parentCompanyId, customerCompanies.id))
      .where(
        and(
          eq(invoices.companyId, companyId),
          sql`CAST(${invoices.balance} AS numeric) > 0`,
          inArray(invoices.status, UNPAID_INVOICE_STATUSES)
        )
      )
      .orderBy(asc(invoices.dueDate));

    // Compute isPastDue and split into two groups
    const pastDue: typeof rows = [];
    const awaitingPayment: typeof rows = [];

    for (const row of rows) {
      const isPastDue = this.computeIsPastDue(row.status, row.dueDate, row.balance, today);
      if (isPastDue) {
        pastDue.push(row);
      } else {
        awaitingPayment.push(row);
      }
    }

    // Combine: past due first, then awaiting payment, limited to `limit`
    const combined = [...pastDue, ...awaitingPayment].slice(0, limit);

    // Add isPastDue flag; use COALESCE'd locationDisplayName as primary label
    return combined.map(row => ({
      ...row,
      isPastDue: this.computeIsPastDue(row.status, row.dueDate, row.balance, today),
      // Phase 4 Step D: canonical display name from COALESCE
      locationName: row.locationDisplayName || row.locationName || null,
    }));
  }

  /**
   * Compute derived isPastDue flag for an invoice
   * Past due = unpaid statuses + balance > 0 + due date < today
   */
  private computeIsPastDue(
    status: string | null,
    dueDate: string | Date | null,
    balance: string | number | null,
    today?: Date
  ): boolean {
    // 2026-03-18: Removed "draft" — draft invoices have not been sent to the customer
    // and cannot be meaningfully past due. Matches dashboard pastDueCount SQL predicate.
    if (!status || !UNPAID_INVOICE_STATUSES.includes(status)) {
      return false;
    }

    // Must have a balance > 0
    const balanceNum = typeof balance === "string" ? parseFloat(balance) : (balance ?? 0);
    if (balanceNum <= 0) {
      return false;
    }

    // Must have a due date in the past
    if (!dueDate) {
      return false;
    }

    const dueDateObj = typeof dueDate === "string" ? new Date(dueDate) : dueDate;
    const compareDate = today ?? new Date();
    compareDate.setHours(0, 0, 0, 0);
    dueDateObj.setHours(0, 0, 0, 0);

    return dueDateObj < compareDate;
  }

  /**
   * Pre-invoice validation: Check if job has billable items
   * Returns validation result with errors, warnings, and billable item counts
   */
  // P3-04: Optional preloadedJob avoids redundant job fetch when caller already has it
  async validateJobForInvoice(companyId: string, jobId: string, preloadedJob?: typeof jobs.$inferSelect): Promise<InvoiceValidationResult> {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    const errors: string[] = [];
    const warnings: string[] = [];

    // Get the job (skip fetch if preloaded by caller)
    const job = preloadedJob ?? (await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId), activeJobFilter()))
      .limit(1))[0];

    if (!job) {
      return {
        valid: false,
        errors: ["Job not found or has been deleted"],
        warnings: [],
        billableItems: { partsCount: 0, laborMinutes: 0, timeEntriesCount: 0, estimatedTotal: 0 },
      };
    }

    // Check required fields
    if (!job.locationId) {
      errors.push("Job is missing location reference");
    }

    // Get job parts (billable items)
    const parts = await db
      .select()
      .from(jobParts)
      .where(
        and(
          eq(jobParts.companyId, companyId),
          eq(jobParts.jobId, jobId),
          eq(jobParts.isActive, true)
        )
      );

    // Get legacy labor entries
    const labor = await db
      .select({
        minutes: laborEntries.minutes,
        technicianId: laborEntries.technicianId,
      })
      .from(laborEntries)
      .where(
        and(
          eq(laborEntries.companyId, companyId),
          eq(laborEntries.jobId, jobId)
        )
      );

    // Get time entries (V1 time tracking)
    const timeTrackingEntries = await db
      .select({
        durationMinutes: timeEntries.durationMinutes,
        billable: timeEntries.billable,
        billableRateSnapshot: timeEntries.billableRateSnapshot,
      })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          eq(timeEntries.jobId, jobId),
          eq(timeEntries.billable, true),
          isNotNull(timeEntries.endAt), // Only completed entries
          isNull(timeEntries.invoicedAt) // Not yet invoiced
        )
      );

    // Calculate totals
    let partsTotal = 0;
    for (const part of parts) {
      const qty = parseFloat(part.quantity?.toString() || "1");
      const price = parseFloat(String(part.unitPrice || "0"));
      partsTotal += qty * price;
    }

    const totalLegacyLaborMinutes = labor.reduce((sum, l) => sum + l.minutes, 0);
    const totalTimeTrackingMinutes = timeTrackingEntries.reduce(
      (sum, e) => sum + (e.durationMinutes ?? 0),
      0
    );
    const totalLaborMinutes = totalLegacyLaborMinutes + totalTimeTrackingMinutes;

    // Calculate estimated labor total from time entries
    let laborTotal = 0;
    for (const entry of timeTrackingEntries) {
      const hours = (entry.durationMinutes ?? 0) / 60;
      const rate = parseFloat(entry.billableRateSnapshot || "0");
      laborTotal += hours * rate;
    }

    // Validation checks
    if (partsTotal === 0 && parts.length > 0) {
      warnings.push("All parts have $0 price");
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      billableItems: {
        partsCount: parts.length,
        laborMinutes: totalLaborMinutes,
        timeEntriesCount: timeTrackingEntries.length,
        estimatedTotal: partsTotal + laborTotal,
      },
    };
  }

  /**
   * Refresh invoice from job with SNAPSHOTTED pricing (IDEMPOTENT)
   * Replaces all job-sourced invoice lines with current job parts
   * Prices are snapshotted at the time of invoicing
   * Can be called multiple times safely - always produces same result
   */
  async refreshInvoiceFromJob(
    companyId: string,
    invoiceId: string,
    txHandle?: any,
    selection?: { partIds?: string[]; timeEntryIds?: string[] },
  ) {
    // Use txHandle for the lookup so newly-created invoices are visible
    // within the same transaction (fixes READ COMMITTED isolation issue)
    const queryDb = txHandle ?? db;
    const [invoice] = await queryDb
      .select({ id: invoices.id, jobId: invoices.jobId, companyId: invoices.companyId })
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)))
      .limit(1);
    if (!invoice) {
      throw this.notFoundError("Invoice");
    }

    if (!invoice.jobId) {
      throw this.validationError("Invoice is not linked to a job");
    }

    // When txHandle is provided, run directly on that handle (caller owns tx).
    // Otherwise, wrap in own transaction for standalone idempotency.
    const runInTx = async (tx: any) => {
      // Step 1: Delete ALL existing job-sourced invoice lines (idempotent - always start fresh)
      await tx
        .delete(invoiceLines)
        .where(and(
          eq(invoiceLines.companyId, companyId), // Tenant isolation
          eq(invoiceLines.invoiceId, invoiceId),
          eq(invoiceLines.source, "job")
        ));

      // Step 1b: Find next lineNumber after remaining manual lines
      const [{ maxLine }] = await tx
        .select({ maxLine: sql<number>`COALESCE(MAX(${invoiceLines.lineNumber}), 0)` })
        .from(invoiceLines)
        .where(and(
          eq(invoiceLines.companyId, companyId), // Tenant isolation
          eq(invoiceLines.invoiceId, invoiceId)
        ));
      const baseLineNumber = Number(maxLine || 0);

      // Step 2: Get current job parts with their CURRENT prices (snapshot).
      // LEFT JOIN items to resolve item type — no active/deleted filter on items.
      //
      // 2026-04-18 Phase 7 (multi-invoice allocation): exclude parts that
      // are already linked to ANOTHER invoice for the same job. We use
      // `invoice_lines.jobLineItemId` (set when a part's snapshot becomes
      // a line in `refreshInvoiceFromJob`) as the allocation signal —
      // no schema change needed.
      //
      // 2026-04-18 Phase 8 (invoice composition): when `selection.partIds`
      // is provided, further restrict to exactly that set. The allocation
      // guard still runs so a stale selection from the client can never
      // double-bill — IDs that are already on a sibling's invoice_lines
      // are silently dropped rather than letting the request create a
      // duplicate.
      //
      // The CURRENT invoice is excluded from the NOT-EXISTS check: when
      // this call is the refresh path on an already-populated draft
      // invoice, we still want its own previously-captured parts to
      // reappear after the Step-1 delete-and-rebuild cycle.
      const partSelectionConditions = [
        eq(jobParts.companyId, companyId),
        eq(jobParts.jobId, invoice.jobId!),
        eq(jobParts.isActive, true),
        sql`NOT EXISTS (
          SELECT 1
            FROM ${invoiceLines} AS il_sibling
            JOIN ${invoices}     AS inv_sibling
              ON inv_sibling.id = il_sibling.invoice_id
           WHERE il_sibling.company_id = ${companyId}
             AND il_sibling.source = 'job'
             AND il_sibling.job_line_item_id = ${jobParts.id}
             AND inv_sibling.company_id = ${companyId}
             AND inv_sibling.job_id = ${invoice.jobId!}
             AND inv_sibling.id <> ${invoiceId}
        )`,
      ];
      if (Array.isArray(selection?.partIds)) {
        if (selection!.partIds.length === 0) {
          // Caller explicitly selected zero parts — emit an always-false
          // predicate so nothing matches.
          partSelectionConditions.push(sql`false`);
        } else {
          partSelectionConditions.push(inArray(jobParts.id, selection!.partIds));
        }
      }
      const partsWithType = await tx
        .select({
          part: jobParts,
          catalogType: items.type,
        })
        .from(jobParts)
        .leftJoin(items, eq(jobParts.productId, items.id))
        .where(and(...partSelectionConditions))
        .orderBy(jobParts.sortOrder);

      const parts = partsWithType.map((r: { part: typeof jobParts.$inferSelect; catalogType: string | null }) => ({
        ...r.part,
        catalogType: r.catalogType,
      }));

      // Step 3: Insert fresh invoice lines from job parts with SNAPSHOTTED prices
      let linesCreated = 0;
      if (parts.length > 0) {
        const newLines = parts.map((part: any, index: number) => {
          const qty = parseFloat(part.quantity?.toString() || "1");
          // SNAPSHOT: Use the price from jobPart at this moment
          const unitPrice = parseFloat(String(part.unitPrice || "0"));
          const unitCost = part.unitCost ? parseFloat(String(part.unitCost)) : null;
          const lineSubtotal = qty * unitPrice;

          // Resolve lineItemType from catalog: product→material, service→service
          // If no catalog link (ad-hoc line) or orphaned reference, default to "service" with warning
          let lineItemType: "service" | "material" = "service";
          if (part.catalogType === "product") {
            lineItemType = "material";
          } else if (part.catalogType === "service") {
            lineItemType = "service";
          } else if (part.productId) {
            // productId set but no catalog match — orphaned reference
            console.warn(`[refreshInvoiceFromJob] Job part ${part.id} has productId ${part.productId} but no catalog item found — defaulting lineItemType to "service"`);
          }

          return {
            companyId, // Add tenant isolation
            invoiceId,
            lineNumber: baseLineNumber + index + 1,
            lineItemType,
            description: part.description,
            quantity: part.quantity?.toString() || "1",
            source: "job" as const,
            // SNAPSHOTTED prices - stored at invoice creation time
            unitPrice: String(unitPrice),
            unitCost: unitCost !== null ? String(unitCost) : null,
            lineSubtotal: String(lineSubtotal),
            taxRate: "0",
            taxAmount: "0",
            lineTotal: String(lineSubtotal),
            // Link back to source for audit trail
            jobLineItemId: part.id,
            productId: part.productId,
          };
        });

        await tx.insert(invoiceLines).values(newLines);
        linesCreated = newLines.length;
      }

      // 2026-05-05 — Labour auto-add REMOVED from all invoice paths.
      // Tracked labour / time entries no longer create invoice line items
      // automatically (was Step 3b). Labour stays operational data only —
      // visible on the Job + Invoice labour cards. Users who want to bill
      // labour must add a line item manually.
      // The `selection.timeEntryIds` field on the request body is now a
      // no-op; kept on the schema for backward compat so older clients
      // do not 400 when they send it.

      // Step 4: Recalculate invoice totals
      await this.recalculateInvoiceTotalsInTx(tx, companyId, invoiceId);

      return {
        invoiceId,
        jobId: invoice.jobId,
        linesRefreshed: linesCreated,
      };
    };

    // If caller provided a tx handle, run directly on it. Otherwise wrap in own tx.
    return txHandle ? runInTx(txHandle) : db.transaction(runInTx);
  }

  /**
   * 2026-05-05 — DELETED: addLaborLinesFromTimeEntries
   *
   * Previously auto-converted billable time entries into invoice lines
   * (`lineItemType: "service"`, `source: "job"`) and locked the entries
   * via `invoicedAt` / `lockedAt` / `lockedByInvoiceId` on `time_entries`.
   *
   * That path is gone. Tracked labour is operational-only:
   *   - Job detail "Labour" card shows tracked time as data
   *   - Invoice detail "Labour" card shows tracked time as data
   *   - To bill labour, the user adds a line item manually
   *
   * The `time_entries.invoiced_at` / `locked_at` / `locked_by_invoice_id`
   * / `billed_*_snapshot` columns remain on the schema for historical
   * rows but are never written by new code.
   *
   * `selection.timeEntryIds` on the refresh-from-job request body is
   * accepted for backward compat but ignored.
   *
   * Do NOT re-introduce this function. A regression test in
   * `tests/labour-no-auto-lines.test.ts` pins its absence.
   */
  /**
   * Canonical shared invoice shell creation — single runtime owner of:
   * - invoice number generation (counter SELECT FOR UPDATE + increment)
   * - counter initialization fallback
   * - issue date / due date computation (uses canonical calculateDueDate)
   * - base invoice INSERT with default fields
   *
   * Source-agnostic: no job/PM/standalone branching.
   * Callers provide tx handle, resolved fields, and optional overrides.
   *
   * 2026-03-29: Extracted from duplicated logic in createInvoiceFromJob + createInvoiceFromBillingEvent.
   */
  async createInvoiceShell(
    companyId: string,
    params: {
      locationId: string;
      customerCompanyId: string | null;
      jobId: string | null;
      /** 2026-05-03: canonical invoice title. Optional; nullable. */
      summary?: string | null;
      workDescription: string | null;
      /** Override subtotal/total/balance (PM sets these to billing amount; job leaves at "0" for later recalc) */
      initialSubtotal?: string;
      initialTotal?: string;
      initialBalance?: string;
      /**
       * 2026-05-05: prefill text for `invoices.client_message`. Resolved
       * upstream from the tenant's Invoice Display settings (only set
       * when the Client Message toggle is on AND a default message
       * exists). Caller-supplied undefined / null / "" → no prefill.
       */
      clientMessage?: string | null;
    },
    tx: any,
    paymentTermsDays: number
  ): Promise<{ invoice: any; invoiceNumber: string }> {
    const { companyCounters } = await import("@shared/schema");
    const { calculateDueDate } = await import("../services/invoiceCreationService");

    // Counter SELECT FOR UPDATE + increment (atomic invoice number generation)
    let [counter] = await tx
      .select()
      .from(companyCounters)
      .where(eq(companyCounters.companyId, companyId))
      .for("update")
      .limit(1);

    let invoiceNumber = 1001;
    if (counter) {
      invoiceNumber = counter.nextInvoiceNumber;
      await tx
        .update(companyCounters)
        .set({ nextInvoiceNumber: invoiceNumber + 1 })
        .where(eq(companyCounters.companyId, companyId));
    } else {
      // Counter initialization fallback
      await tx.insert(companyCounters).values({
        companyId,
        nextJobNumber: 100000,
        nextInvoiceNumber: 1002,
      });
    }

    // Issue date + due date via canonical calculateDueDate()
    const now = new Date();
    const issueDate = now.toISOString().split("T")[0];
    const dueDate = calculateDueDate(now, paymentTermsDays);

    const subtotal = params.initialSubtotal ?? "0";
    const total = params.initialTotal ?? "0";
    const balance = params.initialBalance ?? "0";

    // 2026-05-05: prefilled client_message — only insert when caller passed
    // a non-empty string. Undefined / null / "" leave the column NULL so
    // the per-invoice editor stays empty (matches pre-tenant-policy behavior).
    const clientMessageValue =
      typeof params.clientMessage === "string" && params.clientMessage.trim().length > 0
        ? params.clientMessage
        : null;

    // Base invoice INSERT with default fields
    const [invoice] = await tx
      .insert(invoices)
      .values({
        companyId,
        locationId: params.locationId,
        customerCompanyId: params.customerCompanyId,
        jobId: params.jobId,
        invoiceNumber: String(invoiceNumber),
        status: "draft",
        issueDate,
        dueDate,
        paymentTermsDays,
        subtotal,
        taxTotal: "0",
        total,
        amountPaid: "0",
        balance,
        summary: params.summary ?? null,
        workDescription: params.workDescription,
        clientMessage: clientMessageValue,
      })
      .returning();

    return { invoice, invoiceNumber: String(invoiceNumber) };
  }

  /**
   * Create a new invoice from an existing job (IDEMPOTENT)
   *
   * PHASE A.1.1 GUARD: Requires creationSource (COMPILE-TIME + RUNTIME enforced).
   *
   * 2026-04-18 Phase 5 (multi-invoice-per-job): this method no longer
   * enforces one-invoice-per-job. Each call creates a fresh invoice,
   * even when the job already has others. The pre-Phase-5 SELECT FOR
   * UPDATE idempotency check has been removed; duplicate-request
   * idempotency (if needed) moves to the request/transaction layer.
   *
   * PRIMARY-POINTER SEMANTICS:
   * - `jobs.invoiceId` is now the "primary invoice" pointer, not a
   *   cardinality guard.
   * - First invoice on the job sets `jobs.invoiceId` automatically.
   * - Subsequent invoices DO NOT overwrite the pointer — they're just
   *   linked via `invoices.jobId`. The primary stays stable unless it's
   *   deleted (FK onDelete: 'set null') or explicitly reassigned later.
   *
   * PRICING SNAPSHOT:
   * - Job parts prices are snapshotted when refreshInvoiceFromJob is called
   * - Changes to product catalog after invoicing do NOT affect existing invoices
   *
   * LIFECYCLE NOTE:
   * - Does NOT set job.status — lifecycle transition is the caller's responsibility
   * - Use MARK_INVOICED orchestrator intent to transition job to "invoiced" status
   *
   * AUTHORIZED CALLERS (defined in INVOICE_CREATION_SOURCES):
   * - POST /api/invoices/from-job/:jobId (invoices.ts) -> "INVOICE_ROUTE"
   * - POST /api/jobs/:id/close with mode=invoice_now (jobs.ts) -> "JOB_CLOSE_ROUTE"
   */
  async createInvoiceFromJob(
    companyId: string,
    jobId: string,
    options: { markJobCompleted?: boolean; skipValidation?: boolean } | undefined,
    creationSource: InvoiceCreationSource,
    txHandle?: any
  ): Promise<CreateInvoiceResult> {
    // PHASE A.1.1 GUARD: Runtime check (complements compile-time enforcement)
    // Protects against dynamic calls or miscompiled code
    if (!creationSource) {
      throw new Error(
        "INVOICE_CREATION_GUARD: createInvoiceFromJob() requires an explicit creationSource. " +
        "Valid sources are defined in INVOICE_CREATION_SOURCES. " +
        "All invoice creation paths must be documented and audited."
      );
    }

    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");
    const queryDb = txHandle ?? db;

    // PRE-TRANSACTION VALIDATION: Get job and validate
    const [jobPreCheck] = await queryDb
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId), activeJobFilter()))
      .limit(1);

    if (!jobPreCheck) {
      throw this.notFoundError("Job");
    }

    if (!options?.skipValidation) {
      const validation = await this.validateJobForInvoice(companyId, jobId, jobPreCheck);
      if (!validation.valid) {
        throw this.validationError(validation.errors.join("; "));
      }
    }

    const [location] = await queryDb
      .select()
      .from(clients)
      .where(and(eq(clients.id, jobPreCheck.locationId), eq(clients.companyId, companyId)))
      .limit(1);

    if (!location) {
      throw this.validationError("Job has invalid location reference");
    }

    // 2026-05-05: also pull the tenant's Invoice Display defaults so the
    // shell can be seeded with the prefilled client message when the
    // tenant has the Client Message block enabled and a default text set.
    const [settings] = await queryDb
      .select({
        defaultPaymentTermsDays: companySettings.defaultPaymentTermsDays,
        invoiceShowClientMessage: companySettings.invoiceShowClientMessage,
        invoiceDefaultClientMessage: companySettings.invoiceDefaultClientMessage,
      })
      .from(companySettings)
      .where(eq(companySettings.companyId, companyId))
      .limit(1);
    const paymentTermsDays = settings?.defaultPaymentTermsDays ?? 30;
    const prefilledClientMessage = (() => {
      if (settings?.invoiceShowClientMessage === false) return null;
      const raw = (settings?.invoiceDefaultClientMessage ?? "").trim();
      return raw.length > 0 ? raw : null;
    })();

    // 2026-04-18 Phase 5 (multi-invoice-per-job): straight create — no
    // idempotency guard, no row lock on the job. Each call produces a
    // fresh invoice shell. If the caller needs duplicate-request
    // protection, that now belongs at the request layer (idempotency
    // key / mutation deduplication), not the cardinality layer.
    const runInTx = async (tx: any) => {
      const [job] = await tx
        .select()
        .from(jobs)
        .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId), activeJobFilter()))
        .limit(1);
      if (!job) {
        throw this.notFoundError("Job");
      }

      const { invoice } = await this.createInvoiceShell(
        companyId,
        {
          locationId: job.locationId,
          customerCompanyId: location.parentCompanyId,
          jobId: jobId,
          // 2026-05-03: canonical invoice title defaults to the job's
          // own short `summary` when creating from a job. Distinct
          // from the long-body workDescription below.
          summary: job.summary ?? null,
          workDescription: job.description || job.summary || null,
          // 2026-05-05: prefill client message from tenant defaults.
          clientMessage: prefilledClientMessage,
        },
        tx,
        paymentTermsDays,
      );

      // Primary-pointer write: only set `jobs.invoiceId` on the FIRST
      // invoice for the job. Subsequent invoices leave the primary
      // unchanged so downstream readers of `jobs.invoiceId` get a
      // stable "preferred" pointer. The authoritative link stays on
      // `invoices.jobId` (one-to-many from the job side).
      if (!job.invoiceId) {
        await tx
          .update(jobs)
          .set({
            invoiceId: invoice.id,
            updatedAt: new Date(),
          })
          .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)));
      } else {
        // Bump updatedAt so downstream feeds / activity log see the change,
        // but leave the primary pointer alone.
        await tx
          .update(jobs)
          .set({ updatedAt: new Date() })
          .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)));
      }

      return { invoice, created: true };
    };

    if (txHandle) {
      return await runInTx(txHandle);
    }
    return await db.transaction(runInTx);
  }
  /**
   * PM Billing Phase 2: Create an invoice from a PM billing event (contract-period billing).
   * Unlike createInvoiceFromJob(), this creates invoices NOT tied to a specific job.
   * Used for monthly_fixed and annual_prepaid PM contracts.
   */
  async createInvoiceFromBillingEvent(
    companyId: string,
    params: {
      locationId: string;
      customerCompanyId: string | null;
      billingLabel: string;
      amount: string;
      periodStart: string;
      periodEnd: string;
      billingModel: string;
    },
    creationSource: InvoiceCreationSource
  ): Promise<{ invoice: any; invoiceNumber: string }> {
    if (creationSource !== "PM_BILLING_SERVICE") {
      throw new Error("INVOICE_CREATION_GUARD: createInvoiceFromBillingEvent() only allowed from PM_BILLING_SERVICE");
    }
    this.assertCompanyId(companyId);

    // Get company settings for payment terms
    const [settings] = await db
      .select({ defaultPaymentTermsDays: companySettings.defaultPaymentTermsDays })
      .from(companySettings)
      .where(eq(companySettings.companyId, companyId))
      .limit(1);
    const paymentTermsDays = settings?.defaultPaymentTermsDays ?? 30;

    return await db.transaction(async (tx) => {
      // PM-specific: format period description and resolve amount
      const periodDesc = params.billingModel === "annual_prepaid"
        ? `Annual Renewal: ${params.periodStart} to ${params.periodEnd}`
        : `Billing period: ${params.periodStart} to ${params.periodEnd}`;
      const amount = params.amount || "0";

      // Delegate shell creation to canonical shared method (numbering, defaults, INSERT)
      const { invoice, invoiceNumber } = await this.createInvoiceShell(
        companyId,
        {
          locationId: params.locationId,
          customerCompanyId: params.customerCompanyId,
          jobId: null,
          // 2026-05-03: PM billing invoices use the billing label as the
          // canonical short title; the period description goes on the
          // workDescription body line.
          summary: params.billingLabel,
          workDescription: `${params.billingLabel} — ${periodDesc}`,
          initialSubtotal: amount,
          initialTotal: amount,
          initialBalance: amount,
        },
        tx,
        paymentTermsDays
      );

      // PM-specific: Create a single line item for the billing event
      await tx
        .insert(invoiceLines)
        .values({
          companyId,
          invoiceId: invoice.id,
          lineNumber: 1,
          lineItemType: "service",
          description: `${params.billingLabel} — ${periodDesc}`,
          quantity: "1",
          unitPrice: amount,
          lineSubtotal: amount,
          taxRate: "0",
          taxAmount: "0",
          lineTotal: amount,
          source: "manual",
        });

      return { invoice, invoiceNumber };
    });
  }

  /**
   * Standalone invoice creation — draft invoice shell with no job/PM dependency.
   * No line items created. No tax applied. No source linkage.
   * 2026-03-29: Added as first-class creation path for standalone invoices.
   */
  async createStandaloneInvoice(
    companyId: string,
    params: {
      locationId: string;
      customerCompanyId: string | null;
      /** 2026-05-03: optional canonical short invoice title. */
      summary?: string | null;
      workDescription?: string | null;
    },
    creationSource: InvoiceCreationSource
  ): Promise<{ invoice: any; invoiceNumber: string }> {
    if (creationSource !== "STANDALONE_ROUTE") {
      throw new Error("INVOICE_CREATION_GUARD: createStandaloneInvoice() only allowed from STANDALONE_ROUTE");
    }
    this.assertCompanyId(companyId);

    // Get company settings for payment terms + Invoice Display defaults
    // (2026-05-05: prefill client_message from tenant defaults).
    const [settings] = await db
      .select({
        defaultPaymentTermsDays: companySettings.defaultPaymentTermsDays,
        invoiceShowClientMessage: companySettings.invoiceShowClientMessage,
        invoiceDefaultClientMessage: companySettings.invoiceDefaultClientMessage,
      })
      .from(companySettings)
      .where(eq(companySettings.companyId, companyId))
      .limit(1);
    const paymentTermsDays = settings?.defaultPaymentTermsDays ?? 30;
    const prefilledClientMessage = (() => {
      if (settings?.invoiceShowClientMessage === false) return null;
      const raw = (settings?.invoiceDefaultClientMessage ?? "").trim();
      return raw.length > 0 ? raw : null;
    })();

    return await db.transaction(async (tx) => {
      const { invoice, invoiceNumber } = await this.createInvoiceShell(
        companyId,
        {
          locationId: params.locationId,
          customerCompanyId: params.customerCompanyId,
          jobId: null,
          summary: params.summary ?? null,
          workDescription: params.workDescription ?? null,
          clientMessage: prefilledClientMessage,
        },
        tx,
        paymentTermsDays
      );

      return { invoice, invoiceNumber };
    });
  }

  /**
   * 2026-05-02 (Audit #2 invoice-flow Phase 1) — atomic create-with-lines
   * for the future client-side `/invoices/new` builder.
   *
   * Single transaction: counter allocation → base shell INSERT → header
   * overrides UPDATE → bulk line INSERT → tax group application
   * (which itself does batch-apply + snapshot + recalc) → fresh fetch.
   *
   * Lines are CLIENT-AUTHORITATIVE. The caller passes the final lines
   * array (manual + any job-derived lines the client hydrated locally
   * via `GET /api/jobs/:id/billable-preview` in a future Phase 2). The
   * server does NOT pull from jobs here — that's the responsibility
   * of `createInvoiceFromJobService` (the existing `/from-job/:jobId`
   * route, unchanged). This avoids any double-add risk between client
   * preview lines and server pull.
   *
   * `primaryJobId` (if provided) is set on `invoices.jobId` for the
   * single-job linkage the schema supports. Multi-job lifecycle
   * (`lifecycle.markInvoiced`) is the service-layer's responsibility.
   *
   * Tax group resolution mirrors `applyTaxGroupCore` from
   * `invoiceCreationService`:
   *   - `taxGroupId === null`           → no tax (zero rate, no snapshot)
   *   - `taxGroupId === undefined`      → caller hasn't decided; service
   *                                       layer should resolve to default
   *                                       group BEFORE calling this method
   *                                       so storage stays deterministic.
   *   - any other string                → apply that tax group.
   */
  async createInvoiceAtomic(
    companyId: string,
    params: {
      locationId: string;
      customerCompanyId: string | null;
      /** When ≥ 1 job was selected, its FIRST id goes here as the
       *  schema-supported primary pointer. Multi-job linkage is
       *  driven by `lifecycle.markInvoiced` at the service layer. */
      primaryJobId: string | null;
      /** 2026-05-03: canonical invoice title. Resolved upstream by the
       *  service layer (caller-supplied or derived from the first
       *  selected job's summary). Nullable when no job is linked
       *  AND the caller didn't supply one. */
      summary?: string | null;
      workDescription: string | null;
      issueDate?: string;
      dueDate?: string | null;
      paymentTermsDays?: number;
      invoiceNumber?: string;
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
      /** Resolved by the service layer BEFORE the call:
       *   - explicit `null` → no tax,
       *   - explicit string → apply that group. */
      taxGroupId: string | null;
    },
    lines: Array<{
      description: string;
      quantity: string;
      unitPrice: string;
      unitCost?: string | null;
      productId?: string | null;
      lineItemType: "service" | "material" | "fee" | "discount";
      source: "manual" | "job" | "template" | "tech";
      /** Reference back to the source job_part row when this line was
       *  hydrated client-side from a job's billable items. */
      jobLineItemId?: string | null;
      date?: string | null;
      technicianId?: string | null;
    }>,
    creationSource: InvoiceCreationSource,
  ): Promise<{ invoice: any; invoiceNumber: string }> {
    if (creationSource !== "ATOMIC_ROUTE") {
      throw new Error(
        "INVOICE_CREATION_GUARD: createInvoiceAtomic() only allowed from ATOMIC_ROUTE",
      );
    }
    this.assertCompanyId(companyId);

    // Default payment terms from company settings unless caller overrides.
    // 2026-05-05: also pull tenant Invoice Display defaults so the shell
    // can be seeded with the prefilled client message when the caller
    // didn't supply one explicitly. Caller-supplied wins.
    // 2026-05-07: client-level payment terms now sit BETWEEN the
    // caller override and the company default. Resolution chain:
    //   params.paymentTermsDays (explicit override on the create call)
    //   → customer_companies.paymentTermsDays (per-client default)
    //   → companies.defaultPaymentTermsDays (tenant default)
    //   → 30 (hard fallback)
    // Only fetched when a customerCompanyId is present on the create
    // call — no extra DB read for cash-sale / no-customer invoices.
    const [settings] = await db
      .select({
        defaultPaymentTermsDays: companySettings.defaultPaymentTermsDays,
        invoiceShowClientMessage: companySettings.invoiceShowClientMessage,
        invoiceDefaultClientMessage: companySettings.invoiceDefaultClientMessage,
      })
      .from(companySettings)
      .where(eq(companySettings.companyId, companyId))
      .limit(1);
    let clientPaymentTermsDays: number | null = null;
    if (params.customerCompanyId) {
      const [customerRow] = await db
        .select({ paymentTermsDays: customerCompanies.paymentTermsDays })
        .from(customerCompanies)
        .where(
          and(
            eq(customerCompanies.id, params.customerCompanyId),
            eq(customerCompanies.companyId, companyId),
          ),
        )
        .limit(1);
      clientPaymentTermsDays = customerRow?.paymentTermsDays ?? null;
    }
    const effectiveTerms =
      params.paymentTermsDays
        ?? clientPaymentTermsDays
        ?? settings?.defaultPaymentTermsDays
        ?? 30;
    const prefilledClientMessage = (() => {
      if (params.clientMessage !== undefined) return params.clientMessage;
      if (settings?.invoiceShowClientMessage === false) return null;
      const raw = (settings?.invoiceDefaultClientMessage ?? "").trim();
      return raw.length > 0 ? raw : null;
    })();

    // Lazy import: applyTaxGroupToInvoice lives in the service layer and
    // would create a circular import if pulled at module top.
    const { applyTaxGroupToInvoice } = await import(
      "../services/invoiceCreationService"
    );

    return await db.transaction(async (tx) => {
      // 1) Counter + shell INSERT (canonical, atomic).
      const { invoice: shell, invoiceNumber } = await this.createInvoiceShell(
        companyId,
        {
          locationId: params.locationId,
          customerCompanyId: params.customerCompanyId,
          jobId: params.primaryJobId,
          summary: params.summary ?? null,
          workDescription: params.workDescription ?? null,
          clientMessage: prefilledClientMessage,
        },
        tx,
        effectiveTerms,
      );

      // 2) Header overrides — single UPDATE for everything that's not
      //    in the shell defaults. Skip fields that the caller didn't
      //    pass (undefined) so we don't clobber shell defaults.
      const headerPatch: Record<string, unknown> = { updatedAt: new Date() };
      if (params.issueDate !== undefined) headerPatch.issueDate = params.issueDate;
      if (params.dueDate !== undefined) headerPatch.dueDate = params.dueDate;
      if (params.invoiceNumber !== undefined) headerPatch.invoiceNumber = params.invoiceNumber;
      if (params.clientMessage !== undefined) headerPatch.clientMessage = params.clientMessage;
      if (params.showQuantity !== undefined) headerPatch.showQuantity = params.showQuantity;
      if (params.showUnitPrice !== undefined) headerPatch.showUnitPrice = params.showUnitPrice;
      if (params.showLineTotals !== undefined) headerPatch.showLineTotals = params.showLineTotals;
      if (params.showLineItems !== undefined) headerPatch.showLineItems = params.showLineItems;
      if (params.showBalance !== undefined) headerPatch.showBalance = params.showBalance;
      if (params.showJobDescription !== undefined) headerPatch.showJobDescription = params.showJobDescription;
      if (params.discountType !== undefined) headerPatch.discountType = params.discountType;
      if (params.discountPercent !== undefined) headerPatch.discountPercent = params.discountPercent;
      if (params.discountAmount !== undefined) headerPatch.discountAmount = params.discountAmount;
      if (params.discountNotes !== undefined) headerPatch.discountNotes = params.discountNotes;

      if (Object.keys(headerPatch).length > 1) {
        await tx
          .update(invoices)
          .set(headerPatch)
          .where(and(eq(invoices.id, shell.id), eq(invoices.companyId, companyId)));
      }

      // 3) Bulk INSERT lines. Compute `lineSubtotal = qty * unitPrice`
      //    inline so we don't depend on the caller; tax-derived fields
      //    (taxRate, taxAmount, lineTotal) are stamped by the tax-group
      //    application step below — these initial values are
      //    placeholders that get rewritten in step 4.
      if (lines.length > 0) {
        const lineRows = lines.map((line, idx) => {
          const qtyNum = parseFloat(line.quantity || "0");
          const priceNum = parseFloat(line.unitPrice || "0");
          const subtotalNum = Math.round(qtyNum * priceNum * 100) / 100;
          const subtotalStr = subtotalNum.toFixed(2);
          return {
            companyId,
            invoiceId: shell.id,
            lineNumber: idx + 1,
            lineItemType: line.lineItemType,
            description: line.description,
            date: line.date ?? null,
            technicianId: line.technicianId ?? null,
            quantity: line.quantity,
            unitCost: line.unitCost ?? null,
            unitPrice: line.unitPrice,
            taxRate: "0.0000",
            lineSubtotal: subtotalStr,
            taxAmount: "0.00",
            lineTotal: subtotalStr,
            jobLineItemId: line.jobLineItemId ?? null,
            productId: line.productId ?? null,
            source: line.source,
          };
        });
        await tx.insert(invoiceLines).values(lineRows);
      }

      // 4) Apply tax group via the canonical service helper. This:
      //      - sets `invoices.taxGroupId`
      //      - runs `batchApplyLineTax` (single UPDATE on lines + recalc
      //        of invoice totals via the embedded recalculate call)
      //      - writes the per-rate `invoice_tax_lines` snapshot
      //    For `taxGroupId === null` it sets zero tax + clears the
      //    snapshot. Either way, totals reflect the discount fields we
      //    set in step 2 because the recalc reads them inside the tx.
      await applyTaxGroupToInvoice(companyId, shell.id, params.taxGroupId, tx);

      // 5) Re-fetch the final invoice row inside the same tx so the
      //    caller sees the post-recalc totals + the patched header.
      const [finalInvoice] = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, shell.id), eq(invoices.companyId, companyId)))
        .limit(1);

      return { invoice: finalInvoice ?? shell, invoiceNumber };
    });
  }

  /**
   * Canonical invoice-import creation path (2026-04-22).
   *
   * Called from the InvoiceImportAdapter inside the import pipeline's
   * transaction. Reuses `createInvoiceShell` for atomic invoice-number
   * assignment + the guarded INSERT, then applies source-provided
   * overrides (issueDate, dueDate, source status, final totals) in a
   * single UPDATE, and inserts the summarized line items in one batch.
   *
   * KEY DESIGN CHOICES:
   *   • Imported invoices carry FINALIZED historical totals from the source
   *     CSV. We do NOT recompute tax per line — the 2026-03-18 performance
   *     baseline mandates batchApplyLineTax() for NEW invoices created by
   *     the app; historical imports record what already happened and so
   *     bypass tax application entirely (lines are persisted with their
   *     pre-computed taxAmount / lineTotal).
   *   • `invoiceNumber` override is optional. Callers that detect a
   *     collision with an existing invoice number upstream pass null; the
   *     auto-assigned number is kept instead.
   *   • No line creation loop with per-line recalculation — single
   *     bulk INSERT.
   */
  async createImportedInvoice(
    companyId: string,
    params: {
      locationId: string;
      customerCompanyId: string | null;
      jobId: string | null;
      /** Source-provided invoice number to override shell's auto-assigned number. Null → keep auto-assigned. */
      invoiceNumber: string | null;
      /** ISO date "YYYY-MM-DD". */
      issueDate: string;
      /** ISO date "YYYY-MM-DD" or null. */
      dueDate: string | null;
      status: InvoiceStatus;
      subtotal: string;
      taxTotal: string;
      total: string;
      amountPaid: string;
      balance: string;
      workDescription: string | null;
    },
    lines: Array<{
      description: string;
      quantity: string;
      unitPrice: string;
      unitCost: string | null;
      taxRate: string;
      lineSubtotal: string;
      taxAmount: string;
      lineTotal: string;
      lineItemType: "service" | "material" | "fee" | "discount";
    }>,
    creationSource: InvoiceCreationSource,
    txHandle: any,
  ): Promise<{ invoice: any; invoiceNumber: string }> {
    if (creationSource !== "IMPORT_ROUTE") {
      throw new Error(
        "INVOICE_CREATION_GUARD: createImportedInvoice() only allowed from IMPORT_ROUTE",
      );
    }
    if (!txHandle) {
      throw new Error(
        "createImportedInvoice() requires a caller-supplied txHandle — the import pipeline wraps each row in its own transaction.",
      );
    }
    this.assertCompanyId(companyId);

    const [settings] = await txHandle
      .select({ defaultPaymentTermsDays: companySettings.defaultPaymentTermsDays })
      .from(companySettings)
      .where(eq(companySettings.companyId, companyId))
      .limit(1);
    const paymentTermsDays = settings?.defaultPaymentTermsDays ?? 30;

    const { invoice: shell, invoiceNumber: autoNumber } = await this.createInvoiceShell(
      companyId,
      {
        locationId: params.locationId,
        customerCompanyId: params.customerCompanyId,
        jobId: params.jobId,
        workDescription: params.workDescription,
        initialSubtotal: params.subtotal,
        initialTotal: params.total,
        initialBalance: params.balance,
      },
      txHandle,
      paymentTermsDays,
    );

    const effectiveNumber = params.invoiceNumber ?? autoNumber;

    // Single UPDATE to apply source-truth overrides the shell can't accept
    // (issueDate/dueDate are shell-derived from "today"; status/taxTotal/
    // amountPaid have no override slots). Historical imports must preserve
    // the original dates + status + finalized tax, so we overwrite in one statement.
    const [finalInvoice] = await txHandle
      .update(invoices)
      .set({
        invoiceNumber: effectiveNumber,
        issueDate: params.issueDate,
        dueDate: params.dueDate,
        status: params.status,
        taxTotal: params.taxTotal,
        amountPaid: params.amountPaid,
        updatedAt: new Date(),
      })
      .where(and(eq(invoices.id, shell.id), eq(invoices.companyId, companyId)))
      .returning();

    if (lines.length > 0) {
      await txHandle.insert(invoiceLines).values(
        lines.map((line, idx) => ({
          companyId,
          invoiceId: shell.id,
          lineNumber: idx + 1,
          lineItemType: line.lineItemType,
          description: line.description,
          quantity: line.quantity,
          unitCost: line.unitCost,
          unitPrice: line.unitPrice,
          taxRate: line.taxRate,
          lineSubtotal: line.lineSubtotal,
          taxAmount: line.taxAmount,
          lineTotal: line.lineTotal,
          // Catalog-exempt: productId intentionally null so "Imported Line
          // Item" summary rows never pollute the products/services catalog.
          productId: null,
          source: "imported",
        })),
      );
    }

    return { invoice: finalInvoice ?? shell, invoiceNumber: effectiveNumber };
  }

  /**
   * Counter-drift guard: bump companyCounters.nextInvoiceNumber if minValue exceeds current counter.
   * Called when a user manually sets an invoice number to a higher numeric value.
   * Uses UPDATE ... WHERE nextInvoiceNumber < minValue to avoid race conditions.
   */
  async bumpInvoiceCounterIfNeeded(companyId: string, minValue: number): Promise<void> {
    this.assertCompanyId(companyId);
    const { companyCounters } = await import("@shared/schema");
    await db
      .update(companyCounters)
      .set({ nextInvoiceNumber: minValue })
      .where(and(
        eq(companyCounters.companyId, companyId),
        sql`${companyCounters.nextInvoiceNumber} < ${minValue}`
      ));
  }

  /**
   * Reorder invoice lines — sets lineNumber for each line atomically.
   * Validates: no duplicate IDs, all IDs must belong to this invoice, complete coverage.
   */
  async reorderInvoiceLines(
    companyId: string,
    invoiceId: string,
    ordering: { id: string; lineNumber: number }[]
  ): Promise<void> {
    this.assertCompanyId(companyId);
    this.validateUUID(invoiceId, "invoiceId");

    // Verify invoice belongs to company
    const invoice = await this.getInvoice(companyId, invoiceId);
    if (!invoice) {
      throw this.notFoundError("Invoice");
    }

    // Validate: no duplicate IDs in payload
    const payloadIds = ordering.map(o => o.id);
    const uniqueIds = new Set(payloadIds);
    if (uniqueIds.size !== payloadIds.length) {
      throw new Error("Reorder payload contains duplicate line IDs");
    }

    // Validate: all IDs must belong to this invoice
    const existingLines = await db
      .select({ id: invoiceLines.id })
      .from(invoiceLines)
      .where(and(
        eq(invoiceLines.companyId, companyId),
        eq(invoiceLines.invoiceId, invoiceId)
      ));
    const existingIds = new Set(existingLines.map(l => l.id));

    for (const id of payloadIds) {
      if (!existingIds.has(id)) {
        throw new Error(`Line ID ${id} does not belong to this invoice`);
      }
    }

    // Validate: payload must cover all active lines (complete reorder)
    if (uniqueIds.size !== existingIds.size) {
      throw new Error(
        `Reorder payload has ${uniqueIds.size} lines but invoice has ${existingIds.size}. ` +
        `Full reorder required — all line IDs must be included.`
      );
    }

    await db.transaction(async (tx) => {
      for (const item of ordering) {
        await tx
          .update(invoiceLines)
          .set({ lineNumber: item.lineNumber })
          .where(and(
            eq(invoiceLines.companyId, companyId),
            eq(invoiceLines.invoiceId, invoiceId),
            eq(invoiceLines.id, item.id)
          ));
      }
    });
  }

  /**
   * Permanently delete an invoice (2026-04-09 — permanent-delete model).
   *
   * Eligibility (matches the `canDelete` UI gate on InvoiceDetailPage):
   *   - status === 'draft'
   *   - qboInvoiceId is null (never delete a QBO-synced invoice)
   *   - amountPaid is zero (cannot delete an invoice that has any payment activity)
   *
   * Transactional steps (in order):
   *   1. SELECT FOR UPDATE the invoice row (tenant-isolated). Throw 404 if missing.
   *   2. Validate eligibility. Throw 409 with a clean message if any rule fails.
   *   3. Release any time_entries lock fields that point at this invoice. The
   *      time_entries.invoice_id FK is ON DELETE SET NULL and would handle that
   *      column on its own, but the lock-related columns (locked_at,
   *      locked_by_invoice_id, lock_reason, invoice_line_id, invoiced_at) have
   *      no FK and would dangle. Clear them inside this tx.
   *   4. Explicitly delete invoice_tax_lines for this invoice. The schema
   *      declares ON DELETE CASCADE, but the live DB has historically been
   *      missing the FK constraint on this child table — the explicit delete
   *      keeps the operation correct regardless of the FK state. (The 2026-04-09
   *      permanent-delete migration adds the FK.)
   *   5. DELETE FROM invoices. The DB then fires:
   *        - CASCADE on invoice_lines, payments
   *        - SET NULL on jobs.invoice_id, pm_billing_events.invoice_id,
   *          qbo_sync_events.invoice_id, time_entries.invoice_id
   *      Job remains valid as a standalone record per the locked product decision.
   *
   * Returns true on success. Tenant isolation: every query filters by companyId.
   */
  async deleteInvoice(companyId: string, invoiceId: string): Promise<boolean> {
    this.assertCompanyId(companyId);
    this.validateUUID(invoiceId, "invoiceId");

    return await db.transaction(async (tx) => {
      // 1. Lock the invoice row
      const [invoice] = await tx
        .select()
        .from(invoices)
        .where(and(
          eq(invoices.id, invoiceId),
          eq(invoices.companyId, companyId),
        ))
        .for("update")
        .limit(1);

      if (!invoice) {
        throw this.notFoundError("Invoice");
      }

      // 2. Eligibility checks (matches UI canDelete gate)
      if (invoice.status !== "draft") {
        throw this.conflictError(
          `Cannot delete invoice in status '${invoice.status}'. Only draft invoices can be deleted.`
        );
      }
      if (invoice.qboInvoiceId) {
        throw this.conflictError(
          "Cannot delete an invoice that has been synced to QuickBooks. Void it in QuickBooks first."
        );
      }
      if (parseFloat(invoice.amountPaid || "0") > 0) {
        throw this.conflictError(
          "Cannot delete an invoice with payments recorded. Remove the payments first."
        );
      }

      // 3. Release time_entries lock + invoice linkage. The FK on
      //    time_entries.invoice_id is ON DELETE SET NULL, so it would clear on
      //    its own — but the lock fields (no FK) would dangle. Clear them all
      //    explicitly here so post-delete state is clean.
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
        .where(and(
          eq(timeEntries.companyId, companyId),
          or(
            eq(timeEntries.invoiceId, invoiceId),
            eq(timeEntries.lockedByInvoiceId, invoiceId),
          )!
        ));

      // 4. Explicit invoice_tax_lines delete (defense-in-depth — see header).
      await tx
        .delete(invoiceTaxLines)
        .where(and(
          eq(invoiceTaxLines.companyId, companyId),
          eq(invoiceTaxLines.invoiceId, invoiceId),
        ));

      // 5. Delete the invoice. CASCADE on invoice_lines + payments fires;
      //    SET NULL on jobs.invoice_id and other soft links fires automatically.
      await tx
        .delete(invoices)
        .where(and(
          eq(invoices.id, invoiceId),
          eq(invoices.companyId, companyId),
        ));

      return true;
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Email-send tracking (2026-05-03; was reminder-specific until then).
  //
  // Writes are atomic against a single invoice row. No status transition
  // side effects — sending an email is a communication event, not a
  // lifecycle change. The canonical email send path
  // (emailDispatchService) and the automated reminder sweep both bump
  // these; callers outside those two paths should not touch
  // `last_emailed_at` / `email_send_count` directly.
  // ──────────────────────────────────────────────────────────────────────

  async recordEmailSent(companyId: string, invoiceId: string): Promise<void> {
    await db
      .update(invoices)
      .set({
        lastEmailedAt: new Date(),
        emailSendCount: sql`${invoices.emailSendCount} + 1`,
      })
      .where(and(
        eq(invoices.id, invoiceId),
        eq(invoices.companyId, companyId),
      ));
  }

  async setRemindersPaused(
    companyId: string,
    invoiceId: string,
    paused: boolean,
    snoozeUntil: Date | null = null,
  ): Promise<void> {
    await db
      .update(invoices)
      .set({
        remindersPaused: paused,
        reminderSnoozeUntil: snoozeUntil,
      })
      .where(and(
        eq(invoices.id, invoiceId),
        eq(invoices.companyId, companyId),
      ));
  }
}

export const invoiceRepository = new InvoiceRepository();
