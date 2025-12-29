import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import { invoices, invoiceLines } from "@shared/schema";
import { BaseRepository, parseDecimal } from "./base";

export class InvoiceRepository extends BaseRepository {
  /**
   * Get all invoices for a company
   */
  async getInvoices(companyId: string) {
    return await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.companyId, companyId), eq(invoices.isActive, true)))
      .orderBy(invoices.createdAt);
  }

  /**
   * Get single invoice
   */
  async getInvoice(companyId: string, invoiceId: string) {
    const rows = await db
      .select()
      .from(invoices)
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
        totalAmount: sql<string>`sum(CAST(${invoices.total} AS DECIMAL))`,
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
        .values({ ...lineData, invoiceId })
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
    const lines = await db
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoiceId));

    let subtotal = 0;
    let taxTotal = 0;

    for (const line of lines) {
      const lineSubtotal = parseFloat(line.lineSubtotal || "0");
      const taxRate = parseFloat(line.taxRate || "0");
      const lineTax = lineSubtotal * taxRate;

      subtotal += lineSubtotal;
      taxTotal += lineTax;
    }

    const total = subtotal + taxTotal;

    await db
      .update(invoices)
      .set({
        subtotal: subtotal.toFixed(2),
        taxTotal: taxTotal.toFixed(2),
        total: total.toFixed(2),
        updatedAt: new Date(),
      })
      .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)));
  }

  /**
   * Recalculate invoice totals within a transaction
   */
  private async recalculateInvoiceTotalsInTx(tx: any, companyId: string, invoiceId: string): Promise<void> {
    const lines = await tx
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoiceId));

    let subtotal = 0;
    let taxTotal = 0;

    for (const line of lines) {
      const lineSubtotal = parseFloat(line.lineSubtotal || "0");
      const taxRate = parseFloat(line.taxRate || "0");
      const lineTax = lineSubtotal * taxRate;

      subtotal += lineSubtotal;
      taxTotal += lineTax;
    }

    const total = subtotal + taxTotal;

    await tx
      .update(invoices)
      .set({
        subtotal: subtotal.toFixed(2),
        taxTotal: taxTotal.toFixed(2),
        total: total.toFixed(2),
        updatedAt: new Date(),
      })
      .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)));
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
        .where(eq(invoiceLines.invoiceId, invoiceId));

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
        const newLines = parts.map((part, index) => ({
          invoiceId,
          lineNumber: index + 1,
          description: part.description,
          quantity: part.quantity?.toString() || "1",
          unitPrice: part.unitPrice || "0.00",
          lineSubtotal: (
            parseFloat(part.quantity?.toString() || "1") * 
            parseFloat(part.unitPrice || "0")
          ).toFixed(2),
          taxRate: "0.00",
          taxAmount: "0.00",
          lineTotal: (
            parseFloat(part.quantity?.toString() || "1") * 
            parseFloat(part.unitPrice || "0")
          ).toFixed(2),
        }));

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