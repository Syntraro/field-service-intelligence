/**
 * Payment Allocation Repository — 2026-05-03 (PR 1 of multi-invoice payments).
 *
 * Pure data layer for the `payment_allocations` junction table introduced
 * by `migrations/2026_05_03_payment_allocations.sql`. One allocation row
 * captures how much of a single payment row was applied to a specific
 * invoice; multi-invoice payments use N rows here, one per covered
 * invoice.
 *
 * INVARIANT (enforced by callers, not this repo):
 *   Every payment row is in exactly ONE of these states:
 *     • `payments.invoice_id IS NOT NULL`  (legacy 1:1 — no allocations)
 *     • `payments.invoice_id IS NULL` AND ≥1 row here    (modern multi)
 *
 * This repo deliberately holds NO business logic — no balance recalc, no
 * sum-equals-payment validation, no provider hooks. Those live in the
 * upcoming `paymentApplicationService` (PR 2). Anything that needs to
 * read/write allocation rows from inside a transaction MUST pass the
 * `tx` handle so the write joins the caller's atomic unit.
 */
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { paymentAllocations } from "@shared/schema";
import type {
  PaymentAllocation,
  InsertPaymentAllocation,
} from "@shared/schema";
import { BaseRepository } from "./base";

/**
 * Caller-supplied row shape for a single allocation. Tenant + payment
 * scope are passed separately to `createAllocations` so the caller
 * cannot accidentally mix companyIds across rows in one batch.
 */
export interface AllocationInput {
  invoiceId: string;
  allocatedAmount: string; // numeric(12,2) string — same convention as payments.amount
}

export class PaymentAllocationRepository extends BaseRepository {
  /**
   * Insert one or more allocations for a single payment.
   *
   * - Tx-aware: pass the transaction handle from the caller so the
   *   insert is part of the same atomic unit that wrote the payment.
   * - Tenant-scoped: every row gets the same `companyId` and
   *   `paymentId` — callers cannot smuggle cross-tenant or cross-payment
   *   rows in a single batch.
   * - The unique index `payment_allocations_payment_invoice_uq`
   *   guarantees at most one row per `(payment_id, invoice_id)`. A
   *   duplicate raises a Postgres unique violation; the caller is
   *   responsible for surfacing a 409.
   */
  async createAllocations(
    tx: any,
    companyId: string,
    paymentId: string,
    allocations: AllocationInput[],
  ): Promise<PaymentAllocation[]> {
    this.assertCompanyId(companyId);
    this.validateUUID(paymentId, "paymentId");

    if (!Array.isArray(allocations) || allocations.length === 0) {
      throw this.validationError("At least one allocation is required");
    }

    for (const a of allocations) {
      this.validateUUID(a.invoiceId, "invoiceId");
      const n = Number(a.allocatedAmount);
      if (!Number.isFinite(n) || n <= 0) {
        throw this.validationError(
          "Allocation amount must be a positive number",
        );
      }
    }

    const rows: InsertPaymentAllocation[] = allocations.map((a) => ({
      companyId,
      paymentId,
      invoiceId: a.invoiceId,
      allocatedAmount: a.allocatedAmount,
    }));

    return await tx
      .insert(paymentAllocations)
      .values(rows)
      .returning();
  }

  /**
   * List every allocation row for a given payment, tenant-scoped.
   *
   * Returns [] for legacy 1:1 payments (no allocation rows ever written
   * for them). Used by the upcoming receipt + payment-detail surfaces
   * to answer "which invoices did this payment cover?".
   */
  async listByPayment(
    companyId: string,
    paymentId: string,
  ): Promise<PaymentAllocation[]> {
    this.assertCompanyId(companyId);
    this.validateUUID(paymentId, "paymentId");

    return await db
      .select()
      .from(paymentAllocations)
      .where(
        and(
          eq(paymentAllocations.companyId, companyId),
          eq(paymentAllocations.paymentId, paymentId),
        ),
      );
  }

  /**
   * List every allocation row that touched a given invoice, tenant-scoped.
   *
   * Used by invoice-balance / "show me how much has been paid against
   * this invoice" paths to fold in multi-invoice payment contributions
   * alongside the legacy 1:1 payments. Indexed by
   * `payment_allocations_invoice_idx (company_id, invoice_id)`.
   */
  async listByInvoice(
    companyId: string,
    invoiceId: string,
  ): Promise<PaymentAllocation[]> {
    this.assertCompanyId(companyId);
    this.validateUUID(invoiceId, "invoiceId");

    return await db
      .select()
      .from(paymentAllocations)
      .where(
        and(
          eq(paymentAllocations.companyId, companyId),
          eq(paymentAllocations.invoiceId, invoiceId),
        ),
      );
  }
}

export const paymentAllocationRepository = new PaymentAllocationRepository();
