import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import { invoices, invoiceLines, clients } from "@shared/schema";
import { BaseRepository, parseDecimal } from "./base";

export class InvoiceRepository extends BaseRepository {
  /**
   * Get all invoices for a company with client data
   */
  async getInvoices(companyId: string) {
    return await db
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
        currency: invoices.currency,
        subtotal: invoices.subtotal,
        taxTotal: invoices.taxTotal,
        total: invoices.total,
        amountPaid: invoices.amountPaid,
        balance: invoices.balance,
        jobId: invoices.jobId,
        sentAt: invoices.sentAt,
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
        }
      })
      .from(invoices)
      .leftJoin(clients, eq(invoices.locationId, clients.id))
      .where(and(eq(invoices.companyId, companyId), eq(invoices.isActive, true)))
      .orderBy(invoices.createdAt);
  }

  /**
   * Get single invoice with client data
   */
  async getInvoice(companyId: string, invoiceId: string) {
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
        currency: invoices.currency,
        subtotal: invoices.subtotal,
        taxTotal: invoices.taxTotal,
        total: invoices.total,
        amountPaid: invoices.amountPaid,
        balance: invoices.balance,
        jobId: invoices.jobId,
        sentAt: invoices.sentAt,
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
      .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)))
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
      .where(and(eq(invoices.companyId, companyId), eq(invoices.isActive, true)))
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
      .where(eq(invoiceLines.invoiceId, invoiceId))
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
        .values({ ...lineData, source: lineData?.source ?? "manual", invoiceId })
        .returning();

      // Recalculate totals within same transaction
      await this.recalculateInvoiceTotalsInTx(tx, companyId, invoiceId);

      return line;
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
        .where(and(eq(invoiceLines.id, lineId), eq(invoiceLines.invoiceId, invoiceId)))
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
   * Recalculate invoice totals from line items
   */
  private async recalculateInvoiceTotals(companyId: string, invoiceId: string): Promise<void> {
    const rows = await db
      .select({
        subtotal: sql<number>`COALESCE(SUM(${invoiceLines.lineSubtotal}), 0)`,
        taxTotal: sql<number>`COALESCE(SUM(${invoiceLines.lineSubtotal} * ${invoiceLines.taxRate}), 0)`,
        total: sql<number>`COALESCE(SUM(${invoiceLines.lineSubtotal} * (1 + ${invoiceLines.taxRate})), 0)`,
      })
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoiceId));

    const totals = rows[0] ?? { subtotal: 0, taxTotal: 0, total: 0 };

    await db
      .update(invoices)
      .set({
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        updatedAt: new Date(),
      })
      .where(and(eq(invoices.companyId, companyId), eq(invoices.id, invoiceId)));
  }

  /**
   * Recalculate invoice totals within a transaction
   */
  private async recalculateInvoiceTotalsInTx(tx: any, companyId: string, invoiceId: string): Promise<void> {
    const rows = await tx
      .select({
        subtotal: sql<number>`COALESCE(SUM(${invoiceLines.lineSubtotal}), 0)`,
        taxTotal: sql<number>`COALESCE(SUM(${invoiceLines.lineSubtotal} * ${invoiceLines.taxRate}), 0)`,
        total: sql<number>`COALESCE(SUM(${invoiceLines.lineSubtotal} * (1 + ${invoiceLines.taxRate})), 0)`,
      })
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoiceId));

    const totals = rows[0] ?? { subtotal: 0, taxTotal: 0, total: 0 };

    await tx
      .update(invoices)
      .set({
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        updatedAt: new Date(),
      })
      .where(and(eq(invoices.companyId, companyId), eq(invoices.id, invoiceId)));
  }

  /**
   * Refresh invoice from job (IDEMPOTENT)
   * Replaces all invoice lines with current job parts
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

    // Import jobParts for querying
    const { jobParts } = await import("@shared/schema");

    // Use transaction for idempotency - delete then insert
    return await db.transaction(async (tx) => {
      // Step 1: Delete ALL existing invoice lines (idempotent - always start fresh)
      await tx
        .delete(invoiceLines)
        .where(and(eq(invoiceLines.invoiceId, invoiceId), eq(invoiceLines.source, "job")));

      // Step 2: Get current job parts

      // Step 1b: Find next lineNumber after remaining manual lines
      const [{ maxLine }] = await tx
        .select({ maxLine: sql<number>`COALESCE(MAX(${invoiceLines.lineNumber}), 0)` })
        .from(invoiceLines)
        .where(eq(invoiceLines.invoiceId, invoiceId));
      const baseLineNumber = Number(maxLine || 0);

      // Step 2: Get current job parts
      const parts = await tx
        .select()
        .from(jobParts)
        .where(and(
          eq(jobParts.jobId, invoice.jobId),
          eq(jobParts.isActive, true)
        ))
        .orderBy(jobParts.sortOrder);

      // Step 3: Insert fresh invoice lines from job parts
      let linesCreated = 0;
      if (parts.length > 0) {
        const newLines = parts.map((part, index) => {
          const qty = parseFloat(part.quantity?.toString() || "1");
          const price = part.unitPrice || 0;  // Already NUMERIC!
          const lineSubtotal = qty * price;
          
          return {
            invoiceId,
            lineNumber: baseLineNumber + index + 1,
            description: part.description,
            quantity: part.quantity?.toString() || "1",
          source: "job",
            unitPrice: price,
            lineSubtotal: lineSubtotal,
            taxRate: 0,
            taxAmount: 0,
            lineTotal: lineSubtotal,
          };
        });

        await tx.insert(invoiceLines).values(newLines);
        linesCreated = newLines.length;
      }

      // Step 4: Recalculate invoice totals
      await this.recalculateInvoiceTotalsInTx(tx, companyId, invoiceId);

      return {
        invoiceId,
        jobId: invoice.jobId,
        linesRefreshed: linesCreated,
      };
    });
  }
}

export const invoiceRepository = new InvoiceRepository();