import { db } from "../db";
import { eq, and, sql, desc, or, lt, isNull, isNotNull, asc, inArray } from "drizzle-orm";
import { invoices, invoiceLines, invoiceTaxLines, clients, payments, jobs, jobParts, laborEntries, technicians, timeEntries, users, companySettings, customerCompanies, items } from "@shared/schema";
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
          eq(invoices.jobId, jobId)
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
      // Single UPDATE: apply tax rate, compute taxAmount and lineTotal for all lines
      await (tx as any).execute(sql`
        UPDATE invoice_lines
        SET tax_rate = ${String(combinedRateDecimal)},
            tax_amount = ROUND(CAST(line_subtotal AS numeric) * ${combinedRateDecimal}, 2)::text,
            line_total = ROUND(CAST(line_subtotal AS numeric) + CAST(line_subtotal AS numeric) * ${combinedRateDecimal}, 2)::text,
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
  async refreshInvoiceFromJob(companyId: string, invoiceId: string, txHandle?: any) {
    const invoice = await this.getInvoice(companyId, invoiceId);
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

      // Step 2: Get current job parts with their CURRENT prices (snapshot)
      // LEFT JOIN items to resolve item type — no active/deleted filter on items
      const partsWithType = await tx
        .select({
          part: jobParts,
          catalogType: items.type,
        })
        .from(jobParts)
        .leftJoin(items, eq(jobParts.productId, items.id))
        .where(and(
          eq(jobParts.companyId, companyId), // Tenant isolation
          eq(jobParts.jobId, invoice.jobId!),
          eq(jobParts.isActive, true)
        ))
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
    };

    // If caller provided a tx handle, run directly on it. Otherwise wrap in own tx.
    return txHandle ? runInTx(txHandle) : db.transaction(runInTx);
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

    // P3-02 Phase 1: Pre-build all invoice line values, then batch INSERT
    const allLineValues: Array<{
      companyId: string; invoiceId: string; lineNumber: number;
      lineItemType: "service"; description: string; quantity: string;
      source: "job"; unitPrice: string; unitCost: string | null;
      lineSubtotal: string; taxRate: string; taxAmount: string;
      lineTotal: string; technicianId: string;
    }> = [];
    // Track which groups get which lineNumber for the back-reference mapping
    const groupsByLineNumber = new Map<number, typeof grouped extends Map<string, infer V> ? V : never>();
    let lineNumber = startLineNumber;

    for (const group of Array.from(grouped.values())) {
      if (group.totalBilledMinutes === 0) continue;

      const hours = group.totalBilledMinutes / 60;
      const unitPrice = group.billedRate || 0;
      const unitCost = group.costRate || 0;
      const lineSubtotal = hours * unitPrice;

      const typeDisplay = group.type
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c: string) => c.toUpperCase());

      const description = group.technicianName
        ? `Labor - ${typeDisplay} (${group.technicianName})`
        : `Labor - ${typeDisplay}`;

      const assignedLineNumber = ++lineNumber;
      groupsByLineNumber.set(assignedLineNumber, group);

      allLineValues.push({
        companyId,
        invoiceId,
        lineNumber: assignedLineNumber,
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
      });
    }

    if (allLineValues.length === 0) {
      // No non-zero groups — still need to process excluded entries below
    } else {
      // Single batch INSERT with RETURNING for lineId mapping
      const insertedLines = await tx
        .insert(invoiceLines)
        .values(allLineValues)
        .returning({ id: invoiceLines.id, lineNumber: invoiceLines.lineNumber });

      // Build lineId lookup by lineNumber
      const lineIdByNumber = new Map<number, string>();
      for (const row of insertedLines) {
        lineIdByNumber.set(row.lineNumber, row.id);
      }

      // P3-02 Phase 2: Per-entry UPDATEs for included entries (unchanged semantics)
      // Each entry has unique billedMinutesSnapshot + billedRateSnapshot
      const now = new Date();
      for (const [assignedLineNumber, group] of Array.from(groupsByLineNumber.entries())) {
        const lineId = lineIdByNumber.get(assignedLineNumber);
        if (!lineId) continue; // Should not happen — defensive guard
        for (const snapshot of group.entrySnapshots) {
          await tx
            .update(timeEntries)
            .set({
              invoiceId,
              invoiceLineId: lineId,
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
      }
    }

    // P3-02 Phase 3: Batch UPDATE excluded entries (uniform values)
    const excludedIds: string[] = [];
    for (const entry of entries) {
      const billed = billedMap.get(entry.id);
      if (billed && (billed.wasExcluded || billed.billedMinutes === 0)) {
        excludedIds.push(entry.id);
      }
    }
    if (excludedIds.length > 0) {
      const lockTime = new Date();
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
        .where(inArray(timeEntries.id, excludedIds));
    }

    return allLineValues.length;
  }

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
      workDescription: string | null;
      /** Override subtotal/total/balance (PM sets these to billing amount; job leaves at "0" for later recalc) */
      initialSubtotal?: string;
      initialTotal?: string;
      initialBalance?: string;
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
        workDescription: params.workDescription,
      })
      .returning();

    return { invoice, invoiceNumber: String(invoiceNumber) };
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
   * LIFECYCLE NOTE (2026-03-18):
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

    const [settings] = await queryDb
      .select({ defaultPaymentTermsDays: companySettings.defaultPaymentTermsDays })
      .from(companySettings)
      .where(eq(companySettings.companyId, companyId))
      .limit(1);
    const paymentTermsDays = settings?.defaultPaymentTermsDays ?? 30;

    // When txHandle is provided, run directly in the outer transaction.
    // When not provided, create our own transaction for isolation.
    const runInTx = async (tx: any) => {
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
              eq(invoices.jobId, jobId)
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

        // Delegate shell creation to canonical shared method (numbering, defaults, INSERT)
        const { invoice } = await this.createInvoiceShell(
          companyId,
          {
            locationId: job.locationId,
            customerCompanyId: location.parentCompanyId,
            jobId: jobId,
            workDescription: job.description || job.summary || null,
          },
          tx,
          paymentTermsDays
        );

        // 2026-03-18: Invoice creation ONLY links invoice to job.
        // Lifecycle transition (status → invoiced) is the caller's responsibility
        // via the canonical jobLifecycleOrchestrator.
        // Previously, standalone invoice creation autonomously set status="invoiced"
        // which violated single-authority lifecycle contract.
        await tx
          .update(jobs)
          .set({
            invoiceId: invoice.id,
            updatedAt: new Date(),
          })
          .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)));

        return {
          invoice,
          created: true,
        };
    };

    try {
      // Use provided transaction or create a new one
      if (txHandle) {
        return await runInTx(txHandle);
      }
      return await db.transaction(runInTx);
    } catch (error: any) {
      // FALLBACK RACE CONDITION HANDLING: Unique constraint violation
      if (error.code === "23505" && error.constraint?.includes("invoices_company_job")) {
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
      workDescription?: string | null;
    },
    creationSource: InvoiceCreationSource
  ): Promise<{ invoice: any; invoiceNumber: string }> {
    if (creationSource !== "STANDALONE_ROUTE") {
      throw new Error("INVOICE_CREATION_GUARD: createStandaloneInvoice() only allowed from STANDALONE_ROUTE");
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
      const { invoice, invoiceNumber } = await this.createInvoiceShell(
        companyId,
        {
          locationId: params.locationId,
          customerCompanyId: params.customerCompanyId,
          jobId: null,
          workDescription: params.workDescription ?? null,
        },
        tx,
        paymentTermsDays
      );

      return { invoice, invoiceNumber };
    });
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
   * Eligibility (matches `InvoiceHeaderCard.tsx` `canDelete` UI gate):
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
}

export const invoiceRepository = new InvoiceRepository();
