/**
 * Collect Payment — zero-balance allocation validation (2026-05-14)
 *
 * Pins the behaviour added so that a zero-balance invoice can be closed
 * by a $0.00 manual payment allocation without triggering a validation
 * error. Covers four invariants:
 *
 *   1. Zero allocation on a zero-balance invoice → succeeds.
 *   2. Zero allocation on a positive-balance invoice → 400 error.
 *   3. Negative allocation → 400 error.
 *   4. Over-allocation → 400 error.
 *
 * Uses `paymentRepository.createManualMultiInvoicePayment` directly
 * (same path as POST /api/payments).
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
import { and, eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { paymentRepository } from "../server/storage/payments";

const TEST_PREFIX = "pay_zero_bal_test_";

let companyId: string;
let userId: string;
let customerCompanyId: string;
let locationId: string;
let zeroBalanceInvoiceId: string;
let positiveBalanceInvoiceId: string;

async function cleanupFixtures() {
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
    // Already-covered invoice: full amount was paid via another mechanism,
    // leaving a $0.00 balance but status not yet transitioned to "paid".
    {
      ...invoiceCommon,
      id: zeroBalanceInvoiceId,
      invoiceNumber: 90001,
      total: "100.00",
      amountPaid: "100.00",
      balance: "0.00",
    },
    // Normal invoice with an outstanding balance.
    {
      ...invoiceCommon,
      id: positiveBalanceInvoiceId,
      invoiceNumber: 90002,
      total: "75.00",
      balance: "75.00",
    },
  ]);
}

beforeAll(async () => {
  companyId = uuidv4();
  userId = uuidv4();
  customerCompanyId = uuidv4();
  locationId = uuidv4();
  zeroBalanceInvoiceId = uuidv4();
  positiveBalanceInvoiceId = uuidv4();

  await cleanupFixtures();
  await createFixtures();
});

afterAll(async () => {
  await cleanupFixtures();
});

describe("createManualMultiInvoicePayment — zero-balance allocation rules", () => {
  it("(1) accepts $0.00 allocation for a zero-balance invoice", async () => {
    const result = await paymentRepository.createManualMultiInvoicePayment(
      companyId,
      {
        customerCompanyId,
        method: "cash",
        receivedAt: new Date().toISOString(),
        allocations: [{ invoiceId: zeroBalanceInvoiceId, allocatedAmount: "0.00" }],
      },
    );

    // All allocations are zero → no ledger row created, payment is null.
    expect(result.payment).toBeNull();
    expect(result.invoices).toHaveLength(1);
    // Zero-balance invoice should be transitioned to "paid".
    const updated = result.invoices.find((i) => i.id === zeroBalanceInvoiceId);
    expect(updated?.status).toBe("paid");
    expect(updated?.balance).toBe("0.00");
  });

  it("(2) rejects $0.00 allocation for a positive-balance invoice", async () => {
    await expect(
      paymentRepository.createManualMultiInvoicePayment(
        companyId,
        {
          customerCompanyId,
          method: "cash",
          receivedAt: new Date().toISOString(),
          allocations: [{ invoiceId: positiveBalanceInvoiceId, allocatedAmount: "0.00" }],
        },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("(3) rejects a negative allocation amount", async () => {
    await expect(
      paymentRepository.createManualMultiInvoicePayment(
        companyId,
        {
          customerCompanyId,
          method: "cash",
          receivedAt: new Date().toISOString(),
          allocations: [{ invoiceId: positiveBalanceInvoiceId, allocatedAmount: "-10.00" }],
        },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("(4) rejects an allocation that exceeds the invoice balance", async () => {
    await expect(
      paymentRepository.createManualMultiInvoicePayment(
        companyId,
        {
          customerCompanyId,
          method: "cash",
          receivedAt: new Date().toISOString(),
          allocations: [{ invoiceId: positiveBalanceInvoiceId, allocatedAmount: "999.99" }],
        },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
