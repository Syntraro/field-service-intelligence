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
   * Create invoice line
   */
  async createInvoiceLine(companyId: string, invoiceId: string, lineData: any) {
    // Verify invoice belongs to company
    const invoice = await this.getInvoice(companyId, invoiceId);
    if (!invoice) {
      throw this.notFoundError("Invoice");
    }

    const rows = await db
      .insert(invoiceLines)
      .values({ ...lineData, invoiceId })
      .returning();

    // Recalculate invoice totals
    await this.recalculateInvoiceTotals(companyId, invoiceId);

    return rows[0];
  }

  /**
   * Delete invoice line
   */
  async deleteInvoiceLine(companyId: string, invoiceId: string, lineId: string) {
    // Verify invoice belongs to company
    const invoice = await this.getInvoice(companyId, invoiceId);
    if (!invoice) {
      throw this.notFoundError("Invoice");
    }

    const result = await db
      .delete(invoiceLines)
      .where(and(eq(invoiceLines.id, lineId), eq(invoiceLines.invoiceId, invoiceId)))
      .returning();

    // Recalculate invoice totals (tenant-scoped update)
    await this.recalculateInvoiceTotals(companyId, invoiceId);

    return result[0] ?? null;
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
   * Refresh invoice from job
   * Copies job parts to invoice lines
   */
  async refreshInvoiceFromJob(companyId: string, invoiceId: string) {
    const invoice = await this.getInvoice(companyId, invoiceId);
    if (!invoice) {
      throw this.notFoundError("Invoice");
    }

    if (!invoice.jobId) {
      throw this.validationError("Invoice is not linked to a job");
    }

    // This would sync job parts to invoice lines
    // For now, return placeholder
    return {
      invoiceId,
      jobId: invoice.jobId,
      linesRefreshed: 0,
    };
  }
}

export const invoiceRepository = new InvoiceRepository();