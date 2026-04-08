/**
 * Payment Repository
 *
 * Handles payment CRUD operations with automatic invoice balance recalculation.
 * Auto-updates invoice status to partial_paid or paid based on balance.
 */

import { db } from "../db";
import { eq, and, sql, desc } from "drizzle-orm";
import { payments, invoices } from "@shared/schema";
import { BaseRepository } from "./base";
import type { InvoiceStatus } from "@shared/schema";
import { canAcceptInvoicePayment, isInvoiceVoided } from "../lib/invoicePredicates";

export class PaymentRepository extends BaseRepository {
  /**
   * Get all payments for an invoice
   */
  async getPayments(companyId: string, invoiceId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(invoiceId, "invoiceId");

    return await db
      .select()
      .from(payments)
      .where(
        and(eq(payments.companyId, companyId), eq(payments.invoiceId, invoiceId))
      )
      .orderBy(desc(payments.receivedAt));
  }

  /**
   * Create a payment and recalculate invoice balance
   * Auto-updates invoice status to partial_paid or paid based on balance
   */
  async createPayment(
    companyId: string,
    invoiceId: string,
    paymentData: {
      amount: string;
      method: string;
      reference?: string | null;
      notes?: string | null;
      receivedAt?: string;
    }
  ) {
    this.assertCompanyId(companyId);
    this.validateUUID(invoiceId, "invoiceId");

    return await db.transaction(async (tx) => {
      // 1. Verify invoice exists and is payable
      const [invoice] = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)))
        .limit(1);

      if (!invoice) {
        throw this.notFoundError("Invoice");
      }

      // Only allow payments on issued invoices: awaiting_payment (canonical),
      // sent (legacy alias), or partial_paid. Uses canonical predicate to avoid drift.
      if (!canAcceptInvoicePayment(invoice.status)) {
        throw this.validationError(
          `Cannot add payment to invoice with status "${invoice.status}". Invoice must be issued first.`
        );
      }

      // 2. Create the payment
      const [payment] = await tx
        .insert(payments)
        .values({
          companyId,
          invoiceId,
          amount: paymentData.amount,
          method: paymentData.method,
          reference: paymentData.reference ?? null,
          notes: paymentData.notes ?? null,
          receivedAt: paymentData.receivedAt
            ? new Date(paymentData.receivedAt)
            : new Date(),
        })
        .returning();

      // 3. Recalculate invoice totals from all payments
      await this.recalculateInvoiceBalance(tx, companyId, invoiceId);

      return payment;
    });
  }

  /**
   * Update a payment and recalculate invoice balance
   */
  async updatePayment(
    companyId: string,
    paymentId: string,
    patch: {
      amount?: string;
      method?: string;
      reference?: string | null;
      notes?: string | null;
      receivedAt?: string;
    }
  ) {
    this.assertCompanyId(companyId);
    this.validateUUID(paymentId, "paymentId");

    return await db.transaction(async (tx) => {
      // Get current payment
      const [payment] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.id, paymentId), eq(payments.companyId, companyId)))
        .limit(1);

      if (!payment) {
        throw this.notFoundError("Payment");
      }

      // Update payment
      const updateData: Record<string, any> = {};
      if (patch.amount !== undefined) updateData.amount = patch.amount;
      if (patch.method !== undefined) updateData.method = patch.method;
      if (patch.reference !== undefined) updateData.reference = patch.reference;
      if (patch.notes !== undefined) updateData.notes = patch.notes;
      if (patch.receivedAt !== undefined) {
        updateData.receivedAt = new Date(patch.receivedAt);
      }

      const [updated] = await tx
        .update(payments)
        .set(updateData)
        .where(and(eq(payments.id, paymentId), eq(payments.companyId, companyId)))
        .returning();

      // Recalculate invoice balance
      await this.recalculateInvoiceBalance(tx, companyId, payment.invoiceId);

      return updated;
    });
  }

  /**
   * Delete a payment and recalculate invoice balance
   */
  async deletePayment(companyId: string, paymentId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(paymentId, "paymentId");

    return await db.transaction(async (tx) => {
      // Get payment to find invoiceId
      const [payment] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.id, paymentId), eq(payments.companyId, companyId)))
        .limit(1);

      if (!payment) {
        throw this.notFoundError("Payment");
      }

      // Check if invoice is in a modifiable state
      const [invoice] = await tx
        .select()
        .from(invoices)
        .where(
          and(eq(invoices.id, payment.invoiceId), eq(invoices.companyId, companyId))
        )
        .limit(1);

      if (invoice && isInvoiceVoided(invoice.status)) {
        throw this.validationError("Cannot delete payments from a voided invoice");
      }

      // Delete payment
      await tx
        .delete(payments)
        .where(and(eq(payments.id, paymentId), eq(payments.companyId, companyId)));

      // Recalculate invoice balance
      await this.recalculateInvoiceBalance(tx, companyId, payment.invoiceId);

      return { success: true };
    });
  }

  /**
   * Recalculate invoice amountPaid, balance, and status from payments
   * Called within a transaction after any payment change
   */
  private async recalculateInvoiceBalance(
    tx: any,
    companyId: string,
    invoiceId: string
  ) {
    const [invoice] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)))
      .limit(1);

    if (!invoice) return;

    // Sum all payments for this invoice
    const [totals] = await tx
      .select({
        amountPaid: sql<string>`COALESCE(SUM(${payments.amount}), '0')`,
      })
      .from(payments)
      .where(
        and(eq(payments.companyId, companyId), eq(payments.invoiceId, invoiceId))
      );

    const amountPaid = parseFloat(totals.amountPaid || "0");
    const total = parseFloat(invoice.total || "0");
    const balance = total - amountPaid;

    // Determine new status based on payment state
    let newStatus: InvoiceStatus = invoice.status as InvoiceStatus;

    // Only recalc status if invoice is in an issued/payable state.
    // Includes legacy "sent" alias for backward compatibility with existing rows;
    // modern flows write the canonical "awaiting_payment".
    if (["awaiting_payment", "sent", "partial_paid", "paid"].includes(invoice.status)) {
      if (balance <= 0 && amountPaid > 0) {
        newStatus = "paid";
      } else if (amountPaid > 0 && balance > 0) {
        newStatus = "partial_paid";
      } else if (amountPaid === 0) {
        // All payments removed → return to canonical issued state.
        // 2026-04-08: Write "awaiting_payment" (canonical) instead of legacy "sent"
        // to stop perpetuating the legacy alias.
        newStatus = "awaiting_payment";
      }
    }

    await tx
      .update(invoices)
      .set({
        amountPaid: amountPaid.toFixed(2),
        balance: Math.max(0, balance).toFixed(2),
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)));
  }
}

export const paymentRepository = new PaymentRepository();
