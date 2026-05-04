/**
 * Payment Allocations — schema + repository regression suite (PR 1).
 *
 * Covers the 2026-05-03 multi-invoice payment foundation:
 *   1. The new `payment_allocations` junction table exists and accepts
 *      a 2-allocation insert for a single payment row whose
 *      `invoice_id` is NULL (the modern multi-invoice shape).
 *   2. The unique index `payment_allocations_payment_invoice_uq`
 *      rejects a duplicate (payment_id, invoice_id) pair.
 *   3. `payments.invoice_id` is nullable end-to-end (Drizzle insert
 *      lands a row with `invoiceId = NULL`).
 *   4. The legacy 1:1 path is untouched: a payment row with
 *      `invoice_id` set still inserts and round-trips through the
 *      payment repository's read API.
 *
 * Real-DB integration test (mirrors the client-deletion test
 * pattern). Because the migration `2026_05_03_payment_allocations.sql`
 * has been applied to the dev DB the test suite uses, no test-only DDL
 * patch is needed in `tests/ensureTestDbInvariants.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import {
  companies,
  users,
  customerCompanies,
  clientLocations,
  invoices,
  payments,
  paymentAllocations,
} from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { paymentAllocationRepository } from "../server/storage/paymentAllocations";
import { paymentRepository } from "../server/storage/payments";

const TEST_PREFIX = "pay_alloc_test_";

let companyId: string;
let userId: string;
let customerCompanyId: string;
let locationId: string;
let invoiceA: string;
let invoiceB: string;
let invoiceLegacy: string;

async function cleanupFixtures() {
  // Delete in dependency order (allocations → payments → invoices → fixtures).
  await db.delete(paymentAllocations).where(eq(paymentAllocations.companyId, companyId));
  await db.delete(payments).where(eq(payments.companyId, companyId));
  await db.delete(invoices).where(eq(invoices.companyId, companyId));
  await db.delete(clientLocations).where(eq(clientLocations.companyId, companyId));
  await db.delete(customerCompanies).where(eq(customerCompanies.companyId, companyId));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(companies).where(eq(companies.id, companyId));
}

async function createFixtures() {
  await db.insert(companies).values({
    id: companyId,
    name: TEST_PREFIX + "tenant",
    subscription: "pro",
  });

  await db.insert(users).values({
    id: userId,
    companyId,
    username: TEST_PREFIX + "user",
    email: TEST_PREFIX + "user@test.local",
    password: "hashed",
    role: "admin",
  });

  await db.insert(customerCompanies).values({
    id: customerCompanyId,
    companyId,
    name: TEST_PREFIX + "Co",
    nameNormalized: TEST_PREFIX + "co",
  });

  await db.insert(clientLocations).values({
    id: locationId,
    companyId,
    userId,
    parentCompanyId: customerCompanyId,
    companyName: TEST_PREFIX + "Co",
    location: "Main",
    isPrimary: true,
    inactive: false,
    selectedMonths: [],
  });

  // Three invoices: A & B are paid by the multi-invoice payment row;
  // `legacy` is paid by the legacy 1:1 payment row.
  const invoiceCommon = {
    companyId,
    userId,
    locationId,
    clientId: locationId,
    customerCompanyId,
    issueDate: "2026-05-01",
    status: "awaiting_payment" as const,
  };

  await db.insert(invoices).values([
    { ...invoiceCommon, id: invoiceA, invoiceNumber: 80001, total: "100.00", balance: "100.00" },
    { ...invoiceCommon, id: invoiceB, invoiceNumber: 80002, total: "75.50", balance: "75.50" },
    { ...invoiceCommon, id: invoiceLegacy, invoiceNumber: 80003, total: "42.00", balance: "42.00" },
  ]);
}

beforeAll(async () => {
  companyId = uuidv4();
  userId = uuidv4();
  customerCompanyId = uuidv4();
  locationId = uuidv4();
  invoiceA = uuidv4();
  invoiceB = uuidv4();
  invoiceLegacy = uuidv4();

  await cleanupFixtures();
  await createFixtures();
});

afterAll(async () => {
  await cleanupFixtures();
});

describe("payment_allocations — schema + repository (PR 1)", () => {
  it("(1) inserts a multi-invoice payment with NULL invoice_id and 2 allocations", async () => {
    const paymentId = uuidv4();

    // Insert the parent payment with NULL invoiceId — the modern path.
    // We bypass `paymentRepository.createPayment` (which still requires
    // an invoiceId by signature) because PR 1 only ships the schema +
    // pure data layer; the orchestrator that writes the parent + the
    // allocations together is `paymentApplicationService` (PR 2).
    const [paymentRow] = await db
      .insert(payments)
      .values({
        id: paymentId,
        companyId,
        invoiceId: null,
        amount: "175.50",
        method: "credit",
        receivedAt: new Date(),
      })
      .returning();

    expect(paymentRow.invoiceId).toBeNull();

    const created = await db.transaction(async (tx) =>
      paymentAllocationRepository.createAllocations(tx, companyId, paymentId, [
        { invoiceId: invoiceA, allocatedAmount: "100.00" },
        { invoiceId: invoiceB, allocatedAmount: "75.50" },
      ]),
    );

    expect(created).toHaveLength(2);
    expect(created.every((r) => r.paymentId === paymentId)).toBe(true);
    expect(created.every((r) => r.companyId === companyId)).toBe(true);

    // Round-trip via the repo's read API.
    const byPayment = await paymentAllocationRepository.listByPayment(companyId, paymentId);
    expect(byPayment).toHaveLength(2);
    const byPaymentSum = byPayment.reduce((s, r) => s + Number(r.allocatedAmount), 0);
    expect(byPaymentSum).toBeCloseTo(175.5, 2);

    const byInvoiceA = await paymentAllocationRepository.listByInvoice(companyId, invoiceA);
    expect(byInvoiceA).toHaveLength(1);
    expect(byInvoiceA[0].paymentId).toBe(paymentId);
    expect(Number(byInvoiceA[0].allocatedAmount)).toBeCloseTo(100, 2);
  });

  it("(2) the unique (payment_id, invoice_id) index rejects duplicate allocations", async () => {
    const paymentId = uuidv4();
    await db.insert(payments).values({
      id: paymentId,
      companyId,
      invoiceId: null,
      amount: "100.00",
      method: "credit",
      receivedAt: new Date(),
    });

    // First insert: succeeds.
    await db.transaction(async (tx) =>
      paymentAllocationRepository.createAllocations(tx, companyId, paymentId, [
        { invoiceId: invoiceA, allocatedAmount: "50.00" },
      ]),
    );

    // Second insert with the SAME (payment_id, invoice_id): must fail.
    let dupeError: unknown = null;
    try {
      await db.transaction(async (tx) =>
        paymentAllocationRepository.createAllocations(tx, companyId, paymentId, [
          { invoiceId: invoiceA, allocatedAmount: "10.00" },
        ]),
      );
    } catch (err) {
      dupeError = err;
    }
    expect(dupeError).not.toBeNull();
    // Postgres unique-violation SQLSTATE.
    expect((dupeError as { code?: string }).code).toBe("23505");

    // Sanity: the original row is still the only one in place.
    const remaining = await paymentAllocationRepository.listByPayment(companyId, paymentId);
    expect(remaining).toHaveLength(1);
    expect(Number(remaining[0].allocatedAmount)).toBeCloseTo(50, 2);
  });

  it("(3) payments.invoice_id is nullable at the column level (information_schema audit)", async () => {
    const result = await db.execute(sql`
      SELECT is_nullable
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name   = 'payments'
         AND column_name  = 'invoice_id'
    `);
    const rows = result.rows as Array<{ is_nullable: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].is_nullable).toBe("YES");
  });

  it("(4) legacy 1:1 path: payment with invoice_id still inserts + reads through the repo", async () => {
    const legacyPayment = await paymentRepository.createPayment(companyId, invoiceLegacy, {
      amount: "42.00",
      method: "cheque",
      reference: TEST_PREFIX + "ref",
    });

    expect(legacyPayment).toBeDefined();
    expect(legacyPayment.invoiceId).toBe(invoiceLegacy);

    // The 1:1 row writes NO allocation row.
    const allocs = await paymentAllocationRepository.listByPayment(companyId, legacyPayment.id);
    expect(allocs).toHaveLength(0);

    // And the legacy read API still returns this payment under its invoice.
    const onInvoice = await paymentRepository.getPayments(companyId, invoiceLegacy);
    expect(onInvoice.some((p) => p.id === legacyPayment.id)).toBe(true);
  });

  it("(5) repository rejects empty allocation list and non-positive amounts (input validation)", async () => {
    const paymentId = uuidv4();
    await db.insert(payments).values({
      id: paymentId,
      companyId,
      invoiceId: null,
      amount: "10.00",
      method: "credit",
      receivedAt: new Date(),
    });

    await expect(
      db.transaction(async (tx) =>
        paymentAllocationRepository.createAllocations(tx, companyId, paymentId, []),
      ),
    ).rejects.toThrow(/at least one allocation/i);

    await expect(
      db.transaction(async (tx) =>
        paymentAllocationRepository.createAllocations(tx, companyId, paymentId, [
          { invoiceId: invoiceA, allocatedAmount: "0" },
        ]),
      ),
    ).rejects.toThrow(/positive number/i);

    await expect(
      db.transaction(async (tx) =>
        paymentAllocationRepository.createAllocations(tx, companyId, paymentId, [
          { invoiceId: invoiceA, allocatedAmount: "-5.00" },
        ]),
      ),
    ).rejects.toThrow(/positive number/i);
  });

  it("(6) tenant scoping — listByPayment / listByInvoice never return rows from another tenant", async () => {
    // Make a second tenant + invoice + payment + allocation.
    const otherCompanyId = uuidv4();
    const otherUserId = uuidv4();
    const otherCustomerId = uuidv4();
    const otherLocationId = uuidv4();
    const otherInvoiceId = uuidv4();
    const otherPaymentId = uuidv4();

    try {
      await db.insert(companies).values({
        id: otherCompanyId,
        name: TEST_PREFIX + "other_tenant",
        subscription: "pro",
      });
      await db.insert(users).values({
        id: otherUserId,
        companyId: otherCompanyId,
        username: TEST_PREFIX + "other_user",
        email: TEST_PREFIX + "other_user@test.local",
        password: "hashed",
        role: "admin",
      });
      await db.insert(customerCompanies).values({
        id: otherCustomerId,
        companyId: otherCompanyId,
        name: TEST_PREFIX + "OtherCo",
        nameNormalized: TEST_PREFIX + "otherco",
      });
      await db.insert(clientLocations).values({
        id: otherLocationId,
        companyId: otherCompanyId,
        userId: otherUserId,
        parentCompanyId: otherCustomerId,
        companyName: TEST_PREFIX + "OtherCo",
        location: "Other",
        isPrimary: true,
        inactive: false,
        selectedMonths: [],
      });
      await db.insert(invoices).values({
        id: otherInvoiceId,
        companyId: otherCompanyId,
        userId: otherUserId,
        locationId: otherLocationId,
        clientId: otherLocationId,
        customerCompanyId: otherCustomerId,
        invoiceNumber: 80100,
        issueDate: "2026-05-01",
        status: "awaiting_payment",
        total: "10.00",
        balance: "10.00",
      });
      await db.insert(payments).values({
        id: otherPaymentId,
        companyId: otherCompanyId,
        invoiceId: null,
        amount: "10.00",
        method: "credit",
        receivedAt: new Date(),
      });
      await db.transaction(async (tx) =>
        paymentAllocationRepository.createAllocations(tx, otherCompanyId, otherPaymentId, [
          { invoiceId: otherInvoiceId, allocatedAmount: "10.00" },
        ]),
      );

      // Querying with the test tenant's companyId must not see the other-tenant row.
      const crossPayment = await paymentAllocationRepository.listByPayment(
        companyId,
        otherPaymentId,
      );
      expect(crossPayment).toHaveLength(0);

      const crossInvoice = await paymentAllocationRepository.listByInvoice(
        companyId,
        otherInvoiceId,
      );
      expect(crossInvoice).toHaveLength(0);
    } finally {
      await db
        .delete(paymentAllocations)
        .where(eq(paymentAllocations.companyId, otherCompanyId));
      await db.delete(payments).where(eq(payments.companyId, otherCompanyId));
      await db.delete(invoices).where(eq(invoices.companyId, otherCompanyId));
      await db.delete(clientLocations).where(eq(clientLocations.companyId, otherCompanyId));
      await db.delete(customerCompanies).where(eq(customerCompanies.companyId, otherCompanyId));
      await db.delete(users).where(eq(users.id, otherUserId));
      await db.delete(companies).where(eq(companies.id, otherCompanyId));
    }
  });
});
