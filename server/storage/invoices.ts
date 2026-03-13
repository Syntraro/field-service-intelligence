import { db } from "../db";
import { eq, and, sql, desc, or, lt, isNull, isNotNull, asc } from "drizzle-orm";
import { invoices, invoiceLines, clients, payments, jobs, jobParts, laborEntries, technicians, timeEntries, users, companySettings, customerCompanies } from "@shared/schema";
import { BaseRepository, parseDecimal } from "./base";
import { activeJobFilter } from "./jobFilters";
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
 * - Job status transition to 'invoiced'
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
      sentAt: invoices.sentAt,
      sentByUserId: invoices.sentByUserId,
      viewedAt: invoices.viewedAt,
      notesInternal: invoices.notesInternal,
      notesCustomer: invoices.notesCustomer,
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
      isActive: invoices.isActive,
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
        eq(invoices.companyId, companyId),
        // Legacy data compatibility: treat NULL isActive as active
        or(eq(invoices.isActive, true), isNull(invoices.isActive))
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
        sentAt: invoices.sentAt,
        sentByUserId: invoices.sentByUserId,
        viewedAt: invoices.viewedAt,
        notesInternal: invoices.notesInternal,
        notesCustomer: invoices.notesCustomer,
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
        isActive: invoices.isActive,
        version: invoices.version,
        createdAt: invoices.createdAt,
        updatedAt: invoices.updatedAt,
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
        eq(invoices.companyId, companyId),
        // Soft-delete filter: consistent with getInvoices
        or(eq(invoices.isActive, true), isNull(invoices.isActive))
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
   * Get invoice by job ID (for idempotency checks)
   */
  async getInvoiceByJobId(companyId: string, jobId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    const rows = await db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, companyId),
          eq(invoices.jobId, jobId),
          // Legacy data compatibility: treat NULL isActive as active
          or(eq(invoices.isActive, true), isNull(invoices.isActive))
        )
      )
      .limit(1);

    return rows[0] ?? null;
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
        eq(invoices.companyId, companyId),
        // Legacy data compatibility: treat NULL isActive as active
        or(eq(invoices.isActive, true), isNull(invoices.isActive))
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
    patch: any
  ) {
    this.assertCompanyId(companyId);
    this.validateUUID(invoiceId, "invoiceId");

    // If no version provided, skip version check (backward compatibility)
    if (currentVersion === undefined) {
      const rows = await db
        .update(invoices)
        .set({
          ...patch,
          version: sql`${invoices.version} + 1`,
          updatedAt: new Date()
        })
        .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)))
        .returning();

      return rows[0] ?? null;
    }

    // With version check - optimistic locking
    const rows = await db
      .update(invoices)
      .set({
        ...patch,
        version: sql`${invoices.version} + 1`, // Increment version
        updatedAt: new Date(),
      })
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

    // Fetch unpaid invoices (awaiting_payment or sent status) with balance > 0
    const unpaidStatuses = ["awaiting_payment", "sent", "partial_paid"];

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
        // Phase 4 Step D: COALESCE gives parent company name when available
        locationDisplayName: sql<string>`COALESCE(${customerCompanies.name}, ${clients.companyName})`,
      })
      .from(invoices)
      .leftJoin(clients, eq(invoices.locationId, clients.id))
      .leftJoin(customerCompanies, eq(clients.parentCompanyId, customerCompanies.id))
      .where(
        and(
          eq(invoices.companyId, companyId),
          or(eq(invoices.isActive, true), isNull(invoices.isActive)),
          isNull(invoices.deletedAt),
          sql`CAST(${invoices.balance} AS numeric) > 0`,
          sql`${invoices.status} IN ('awaiting_payment', 'sent', 'partial_paid')`
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
    // Unpaid statuses that can be past due
    const unpaidStatuses = ["draft", "awaiting_payment", "sent", "partial_paid"];
    if (!status || !unpaidStatuses.includes(status)) {
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
  async validateJobForInvoice(companyId: string, jobId: string): Promise<InvoiceValidationResult> {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    const errors: string[] = [];
    const warnings: string[] = [];

    // Get the job (exclude soft-deleted and inactive)
    const [job] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId), activeJobFilter()))
      .limit(1);

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
    const hasLegacyLabor = labor.length > 0;
    const hasTimeEntries = timeTrackingEntries.length > 0;
    if (parts.length === 0 && !hasLegacyLabor && !hasTimeEntries) {
      errors.push("Cannot create invoice: no billable items (parts or labor)");
    }

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
  async refreshInvoiceFromJob(companyId: string, invoiceId: string) {
    const invoice = await this.getInvoice(companyId, invoiceId);
    if (!invoice) {
      throw this.notFoundError("Invoice");
    }

    if (!invoice.jobId) {
      throw this.validationError("Invoice is not linked to a job");
    }

    // Use transaction for idempotency - delete then insert
    return await db.transaction(async (tx) => {
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

      // Step 2: Get current job parts with their CURRENT prices (snapshot)
      const parts = await tx
        .select()
        .from(jobParts)
        .where(and(
          eq(jobParts.companyId, companyId), // Tenant isolation
          eq(jobParts.jobId, invoice.jobId!),
          eq(jobParts.isActive, true)
        ))
        .orderBy(jobParts.sortOrder);

      // Step 3: Insert fresh invoice lines from job parts with SNAPSHOTTED prices
      let linesCreated = 0;
      if (parts.length > 0) {
        const newLines = parts.map((part, index) => {
          const qty = parseFloat(part.quantity?.toString() || "1");
          // SNAPSHOT: Use the price from jobPart at this moment
          const unitPrice = parseFloat(String(part.unitPrice || "0"));
          const unitCost = part.unitCost ? parseFloat(String(part.unitCost)) : null;
          const lineSubtotal = qty * unitPrice;

          return {
            companyId, // Add tenant isolation
            invoiceId,
            lineNumber: baseLineNumber + index + 1,
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

      // Step 3b: Add labor lines from uninvoiced billable time entries
      // Group by technician + type for cleaner invoice presentation
      const laborLinesCreated = await this.addLaborLinesFromTimeEntries(
        tx,
        companyId,
        invoiceId,
        invoice.jobId!,
        baseLineNumber + linesCreated
      );

      // Step 4: Recalculate invoice totals
      await this.recalculateInvoiceTotalsInTx(tx, companyId, invoiceId);

      return {
        invoiceId,
        jobId: invoice.jobId,
        linesRefreshed: linesCreated + laborLinesCreated,
      };
    });
  }

  /**
   * Add labor lines from time entries to an invoice (within transaction)
   * Applies company billing rules (rounding, minimums, multipliers, caps)
   * Groups entries by technician + type for cleaner presentation
   * Marks time entries as invoiced with billing snapshots
   *
   * Phase 8: Now applies billing rules before creating invoice lines
   */
  private async addLaborLinesFromTimeEntries(
    tx: any,
    companyId: string,
    invoiceId: string,
    jobId: string,
    startLineNumber: number
  ): Promise<number> {
    // Get company billing rules (or defaults)
    const rules = await timeBillingRulesRepository.getRules(companyId);

    // Get uninvoiced billable time entries for this job
    const entries = await tx
      .select({
        id: timeEntries.id,
        technicianId: timeEntries.technicianId,
        technicianName: users.fullName,
        type: timeEntries.type,
        durationMinutes: timeEntries.durationMinutes,
        billableRateSnapshot: timeEntries.billableRateSnapshot,
        costRateSnapshot: timeEntries.costRateSnapshot,
        jobId: timeEntries.jobId,
        startAt: timeEntries.startAt,
        // Phase 9: Include lock fields for validation
        lockedAt: timeEntries.lockedAt,
        lockedByInvoiceId: timeEntries.lockedByInvoiceId,
      })
      .from(timeEntries)
      .leftJoin(users, eq(timeEntries.technicianId, users.id))
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          eq(timeEntries.jobId, jobId),
          eq(timeEntries.billable, true),
          isNotNull(timeEntries.endAt), // Only completed entries
          isNull(timeEntries.invoicedAt) // Not yet invoiced
        )
      )
      .orderBy(asc(timeEntries.startAt)); // Oldest first for deterministic capping

    if (entries.length === 0) {
      return 0;
    }

    // Phase 9: Check for already-locked entries and abort if found
    const alreadyLocked = entries.filter((e: typeof entries[number]) => e.lockedAt !== null || e.lockedByInvoiceId !== null);
    if (alreadyLocked.length > 0) {
      const lockedIds = alreadyLocked.map((e: typeof entries[number]) => e.id).join(", ");
      const lockingInvoice = alreadyLocked[0].lockedByInvoiceId;
      throw this.conflictError(
        `Cannot invoice: ${alreadyLocked.length} time entries are already locked` +
        (lockingInvoice ? ` by invoice ${lockingInvoice}` : "") +
        `. Entry IDs: ${lockedIds}`
      );
    }

    // Apply billing rules to compute final billed minutes and rates
    const rulesResult = applyBillingRulesToEntries(
      rules,
      entries.map((e: typeof entries[number]) => ({
        id: e.id,
        type: e.type,
        durationMinutes: e.durationMinutes ?? 0,
        billableRateSnapshot: e.billableRateSnapshot,
        jobId: e.jobId,
        startAt: e.startAt,
      }))
    );

    // Create a lookup map for billed entries
    const billedMap = new Map(
      rulesResult.entries.map((be) => [be.entryId, be])
    );

    // Group entries by technician + type (only include non-excluded entries)
    const grouped = new Map<
      string,
      {
        technicianId: string;
        technicianName: string | null;
        type: string;
        totalBilledMinutes: number;
        billedRate: number;
        costRate: number;
        entrySnapshots: Array<{
          id: string;
          billedMinutes: number;
          billedRate: number;
        }>;
      }
    >();

    for (const entry of entries) {
      const billed = billedMap.get(entry.id);
      if (!billed || billed.wasExcluded || billed.billedMinutes === 0) {
        // Still mark as invoiced but with 0 billed minutes
        continue;
      }

      const key = `${entry.technicianId}:${entry.type}`;
      const costRate = parseFloat(entry.costRateSnapshot || "0");

      if (!grouped.has(key)) {
        grouped.set(key, {
          technicianId: entry.technicianId,
          technicianName: entry.technicianName,
          type: entry.type,
          totalBilledMinutes: 0,
          billedRate: billed.billedRate,
          costRate,
          entrySnapshots: [],
        });
      }

      const group = grouped.get(key)!;
      group.totalBilledMinutes += billed.billedMinutes;
      group.entrySnapshots.push({
        id: entry.id,
        billedMinutes: billed.billedMinutes,
        billedRate: billed.billedRate,
      });
    }

    // Create invoice lines from grouped entries
    const newLines = [];
    let lineNumber = startLineNumber;

    for (const group of Array.from(grouped.values())) {
      if (group.totalBilledMinutes === 0) continue;

      // Convert minutes to decimal hours with 2 decimal places
      const hours = group.totalBilledMinutes / 60;
      const unitPrice = group.billedRate || 0;
      const unitCost = group.costRate || 0;
      const lineSubtotal = hours * unitPrice;

      // Format type for display
      const typeDisplay = group.type
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c: string) => c.toUpperCase());

      const description = group.technicianName
        ? `Labor - ${typeDisplay} (${group.technicianName})`
        : `Labor - ${typeDisplay}`;

      const [insertedLine] = await tx
        .insert(invoiceLines)
        .values({
          companyId,
          invoiceId,
          lineNumber: ++lineNumber,
          lineItemType: "service" as const,
          description,
          quantity: hours.toFixed(2),
          source: "job" as const,
          unitPrice: String(unitPrice.toFixed(2)),
          unitCost: unitCost > 0 ? String(unitCost.toFixed(2)) : null,
          lineSubtotal: String(lineSubtotal.toFixed(2)),
          taxRate: "0",
          taxAmount: "0",
          lineTotal: String(lineSubtotal.toFixed(2)),
          technicianId: group.technicianId,
        })
        .returning({ id: invoiceLines.id });

      // Mark time entries as invoiced with billing snapshots and LOCK them
      const now = new Date();
      for (const snapshot of group.entrySnapshots) {
        await tx
          .update(timeEntries)
          .set({
            invoiceId,
            invoiceLineId: insertedLine.id,
            invoicedAt: now,
            billedMinutesSnapshot: snapshot.billedMinutes,
            billedRateSnapshot: String(snapshot.billedRate.toFixed(2)),
            billingRulesHash: rulesResult.rulesHash,
            // Phase 9: Lock entries to prevent edits
            lockedAt: now,
            lockedByInvoiceId: invoiceId,
            lockReason: "INVOICED",
            updatedAt: now,
          })
          .where(eq(timeEntries.id, snapshot.id));
      }

      newLines.push(insertedLine);
    }

    // Also mark excluded entries as processed (with 0 billed) and LOCK them
    const lockTime = new Date();
    for (const entry of entries) {
      const billed = billedMap.get(entry.id);
      if (billed && (billed.wasExcluded || billed.billedMinutes === 0)) {
        await tx
          .update(timeEntries)
          .set({
            invoiceId,
            invoicedAt: lockTime,
            billedMinutesSnapshot: 0,
            billedRateSnapshot: "0.00",
            billingRulesHash: rulesResult.rulesHash,
            // Phase 9: Lock entries to prevent edits
            lockedAt: lockTime,
            lockedByInvoiceId: invoiceId,
            lockReason: "INVOICED",
            updatedAt: lockTime,
          })
          .where(eq(timeEntries.id, entry.id));
      }
    }

    return newLines.length;
  }

  /**
   * Create a new invoice from an existing job (IDEMPOTENT)
   *
   * PHASE A SECURITY FIX: Uses SELECT FOR UPDATE to prevent race conditions
   * PHASE A.1.1 GUARD: Requires creationSource (COMPILE-TIME + RUNTIME enforced)
   *
   * IDEMPOTENCY GUARANTEE:
   * - If job already has an invoice, returns the existing invoice (created: false)
   * - Uses SELECT FOR UPDATE on job row to prevent concurrent invoice creation
   * - Falls back to unique constraint handling for extra safety
   *
   * CONCURRENCY PROTECTION:
   * - Job row is locked with FOR UPDATE at the start of transaction
   * - Idempotency check happens INSIDE the transaction under lock
   * - This prevents invoice number waste and race condition window
   *
   * PRICING SNAPSHOT:
   * - Job parts prices are snapshotted when refreshInvoiceFromJob is called
   * - Changes to product catalog after invoicing do NOT affect existing invoices
   *
   * STATUS TRANSITION:
   * - Always sets job.status to 'invoiced' (deterministic)
   *
   * AUTHORIZED CALLERS (defined in INVOICE_CREATION_SOURCES):
   * - POST /api/invoices/from-job/:jobId (invoices.ts) -> "INVOICE_ROUTE"
   * - POST /api/jobs/:id/close with mode=invoice_now (jobs.ts) -> "JOB_CLOSE_ROUTE"
   */
  async createInvoiceFromJob(
    companyId: string,
    jobId: string,
    options: { markJobCompleted?: boolean; skipValidation?: boolean } | undefined,
    creationSource: InvoiceCreationSource
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

    const { companyCounters } = await import("@shared/schema");

    // PRE-TRANSACTION VALIDATION: Get job and validate (avoids holding lock during validation)
    const [jobPreCheck] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId), activeJobFilter()))
      .limit(1);

    if (!jobPreCheck) {
      throw this.notFoundError("Job");
    }

    // PRE-INVOICE VALIDATION (unless skipped) - before acquiring lock
    if (!options?.skipValidation) {
      const validation = await this.validateJobForInvoice(companyId, jobId);
      if (!validation.valid) {
        throw this.validationError(validation.errors.join("; "));
      }
    }

    // Get client location to resolve customerCompanyId (before transaction)
    const [location] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, jobPreCheck.locationId), eq(clients.companyId, companyId)))
      .limit(1);

    if (!location) {
      throw this.validationError("Job has invalid location reference");
    }

    // Get company settings for payment terms defaults
    const [settings] = await db
      .select({ defaultPaymentTermsDays: companySettings.defaultPaymentTermsDays })
      .from(companySettings)
      .where(eq(companySettings.companyId, companyId))
      .limit(1);
    const paymentTermsDays = settings?.defaultPaymentTermsDays ?? 30;

    try {
      return await db.transaction(async (tx) => {
        // PHASE A FIX: Lock the job row with SELECT FOR UPDATE
        // This prevents concurrent invoice creation for the same job
        const [job] = await tx
          .select()
          .from(jobs)
          .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId), activeJobFilter()))
          .for("update") // Lock the row
          .limit(1);

        if (!job) {
          throw this.notFoundError("Job");
        }

        // IDEMPOTENCY CHECK: Now check under lock if invoice already exists
        // This is the key fix - checking INSIDE the transaction after acquiring lock
        const [existingInvoice] = await tx
          .select()
          .from(invoices)
          .where(
            and(
              eq(invoices.companyId, companyId),
              eq(invoices.jobId, jobId),
              // Legacy data compatibility: treat NULL isActive as active
              or(eq(invoices.isActive, true), isNull(invoices.isActive))
            )
          )
          .limit(1);

        if (existingInvoice) {
          // Invoice already exists - return it (idempotent behavior)
          // Fetch lines outside transaction since we're returning early
          const existingLines = await this.getInvoiceLines(companyId, existingInvoice.id);
          return {
            invoice: existingInvoice,
            created: false,
            lines: existingLines,
          };
        }

        // Get or create counter and increment (now protected by job lock)
        let [counter] = await tx
          .select()
          .from(companyCounters)
          .where(eq(companyCounters.companyId, companyId))
          .for("update") // Also lock counter to prevent race
          .limit(1);

        let invoiceNumber = 1001;
        if (counter) {
          invoiceNumber = counter.nextInvoiceNumber;
          await tx
            .update(companyCounters)
            .set({ nextInvoiceNumber: invoiceNumber + 1 })
            .where(eq(companyCounters.companyId, companyId));
        } else {
          // Create initial counter with 6-digit job numbers
          await tx.insert(companyCounters).values({
            companyId,
            nextJobNumber: 100000,
            nextInvoiceNumber: 1002,
          });
        }

        // Compute issue date and due date
        const now = new Date();
        const issueDate = now.toISOString().split("T")[0]; // 'YYYY-MM-DD' format
        const dueDate = new Date(now.getTime() + paymentTermsDays * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0];

        // Create invoice (unique constraint on companyId+jobId prevents duplicates as extra safety)
        const [invoice] = await tx
          .insert(invoices)
          .values({
            companyId,
            locationId: job.locationId,
            customerCompanyId: location.parentCompanyId, // Link to billing entity
            jobId: jobId,
            invoiceNumber: String(invoiceNumber),
            status: "draft",
            issueDate, // 'YYYY-MM-DD' format
            dueDate,   // Computed from issueDate + paymentTermsDays
            paymentTermsDays, // From company settings or default
            subtotal: "0",
            taxTotal: "0",
            total: "0",
            amountPaid: "0",
            balance: "0",
            // Copy work description from job for audit trail
            workDescription: job.description || job.summary || null,
          })
          .returning();

        // Update job: set invoiceId (and status when NOT called from close route)
        // When called from JOB_CLOSE_ROUTE, the lifecycle engine (transitionJobStatus)
        // owns the status transition — setting status here would cause a conflict because
        // transitionJobStatus re-reads the job and rejects non-open statuses.
        const jobUpdate: any = {
          invoiceId: invoice.id,
          updatedAt: new Date(),
        };
        if (creationSource !== "JOB_CLOSE_ROUTE") {
          // Standalone invoice creation: set status to invoiced directly
          jobUpdate.status = "invoiced";
        }

        await tx
          .update(jobs)
          .set(jobUpdate)
          .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)));

        return {
          invoice,
          created: true,
        };
      });
    } catch (error: any) {
      // FALLBACK RACE CONDITION HANDLING: Unique constraint violation
      // This should rarely trigger now with FOR UPDATE, but kept as safety net
      // PostgreSQL error code 23505 = unique_violation
      if (error.code === "23505" && error.constraint?.includes("invoices_company_job")) {
        // Re-fetch the invoice that was created by the other request
        const existingInvoice = await this.getInvoiceByJobId(companyId, jobId);
        if (existingInvoice) {
          const existingLines = await this.getInvoiceLines(companyId, existingInvoice.id);
          return {
            invoice: existingInvoice,
            created: false,
            lines: existingLines,
          };
        }
      }
      throw error;
    }
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

    const { companyCounters } = await import("@shared/schema");

    // Get company settings for payment terms
    const [settings] = await db
      .select({ defaultPaymentTermsDays: companySettings.defaultPaymentTermsDays })
      .from(companySettings)
      .where(eq(companySettings.companyId, companyId))
      .limit(1);
    const paymentTermsDays = settings?.defaultPaymentTermsDays ?? 30;

    return await db.transaction(async (tx) => {
      // Get or create counter and increment
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
        await tx.insert(companyCounters).values({
          companyId,
          nextJobNumber: 100000,
          nextInvoiceNumber: 1002,
        });
      }

      const now = new Date();
      const issueDate = now.toISOString().split("T")[0];
      const dueDate = new Date(now.getTime() + paymentTermsDays * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];

      // Format period description for invoice
      const periodDesc = params.billingModel === "annual_prepaid"
        ? `Annual Renewal: ${params.periodStart} to ${params.periodEnd}`
        : `Billing period: ${params.periodStart} to ${params.periodEnd}`;

      const amount = params.amount || "0";

      // Create the invoice (no jobId — contract billing)
      const [invoice] = await tx
        .insert(invoices)
        .values({
          companyId,
          locationId: params.locationId,
          customerCompanyId: params.customerCompanyId,
          jobId: null, // Contract billing — not tied to a job
          invoiceNumber: String(invoiceNumber),
          status: "draft",
          issueDate,
          dueDate,
          paymentTermsDays,
          subtotal: amount,
          taxTotal: "0",
          total: amount,
          amountPaid: "0",
          balance: amount,
          workDescription: `${params.billingLabel} — ${periodDesc}`,
        })
        .returning();

      // Create a single line item for the billing event
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

      return { invoice, invoiceNumber: String(invoiceNumber) };
    });
  }
}

export const invoiceRepository = new InvoiceRepository();
