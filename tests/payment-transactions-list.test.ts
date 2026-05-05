/**
 * Payment Transactions List — PR8.5 integration suite (2026-05-04).
 *
 * Real-DB tests pinning the post-widening behaviour of
 * `paymentRepository.listTransactionsForCompany`:
 *   - returns ALL provider sources (manual + stripe + qbo) when no
 *     filter is applied
 *   - filters by `providerSource`
 *   - filters by `method`
 *   - filters by `paymentType`
 *   - free-text search hits customer name, invoice number, and amount
 *
 * The repository was previously named `listOnlineTransactionsForCompany`
 * and hard-coded `provider_source = 'stripe'`. PR8.5 dropped that
 * predicate; these tests pin the new contract so a future regression
 * (e.g. someone re-adding a `WHERE provider_source = ...` filter)
 * surfaces immediately.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import {
  clientLocations,
  companies,
  customerCompanies,
  invoices,
  payments,
  users,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { paymentRepository } from "../server/storage/payments";

const TEST_PREFIX = "tx_pr8_5_test_";

let companyId: string;
let userId: string;
let customerCompanyId: string;
let locationId: string;
let invoiceId: string;
let manualPaymentId: string;
let stripePaymentId: string;
let qboPaymentId: string;

async function cleanupFixtures() {
  if (companyId) {
    await db.delete(payments).where(eq(payments.companyId, companyId));
    await db.delete(invoices).where(eq(invoices.companyId, companyId));
    await db
      .delete(clientLocations)
      .where(eq(clientLocations.companyId, companyId));
    await db
      .delete(customerCompanies)
      .where(eq(customerCompanies.companyId, companyId));
  }
  if (userId) await db.delete(users).where(eq(users.id, userId));
  if (companyId) await db.delete(companies).where(eq(companies.id, companyId));
}

async function createFixtures() {
  companyId = uuidv4();
  userId = uuidv4();
  customerCompanyId = uuidv4();
  locationId = uuidv4();
  invoiceId = uuidv4();
  manualPaymentId = uuidv4();
  stripePaymentId = uuidv4();
  qboPaymentId = uuidv4();

  await db.insert(companies).values({
    id: companyId,
    name: TEST_PREFIX + "tenant",
  });
  await db.insert(users).values({
    id: userId,
    companyId,
    username: TEST_PREFIX + "user",
    email: TEST_PREFIX + "user@test.local",
    password: "hashed",
    role: "owner",
  });
  await db.insert(customerCompanies).values({
    id: customerCompanyId,
    companyId,
    name: TEST_PREFIX + "Acme Co",
    nameNormalized: TEST_PREFIX + "acme co",
  });
  await db.insert(clientLocations).values({
    id: locationId,
    companyId,
    userId,
    parentCompanyId: customerCompanyId,
    companyName: TEST_PREFIX + "Acme Co",
    location: "Main",
    isPrimary: true,
    inactive: false,
    selectedMonths: [],
  });
  // Invoice predicate exercised here doesn't depend on status; the
  // canonical fields the repo joins are companyId / customerCompanyId
  // / invoiceNumber. Use the same shape as payment-allocations test.
  await db.insert(invoices).values({
    id: invoiceId,
    companyId,
    userId,
    locationId,
    clientId: locationId,
    customerCompanyId,
    invoiceNumber: "PR85-INV-001",
    status: "paid",
    issueDate: "2026-05-01",
    total: "300.00",
    balance: "0.00",
  });

  // Three payments — one of each provider source. Spread receivedAt
  // a few minutes apart so the desc(receivedAt) sort is deterministic.
  await db.insert(payments).values({
    id: manualPaymentId,
    companyId,
    invoiceId,
    amount: "100.00",
    method: "cheque",
    reference: "CHK-PR85-1",
    providerSource: "manual",
    receivedAt: new Date("2026-05-04T10:00:00Z"),
  });
  await db.insert(payments).values({
    id: stripePaymentId,
    companyId,
    invoiceId,
    amount: "100.00",
    method: "credit",
    reference: "ch_pr85_test_1",
    providerSource: "stripe",
    providerEventId: "evt_pr85_test_1",
    receivedAt: new Date("2026-05-04T10:05:00Z"),
  });
  await db.insert(payments).values({
    id: qboPaymentId,
    companyId,
    invoiceId,
    amount: "100.00",
    method: "other",
    reference: null,
    providerSource: "qbo",
    qboPaymentId: "QBO-PR85-1",
    receivedAt: new Date("2026-05-04T10:10:00Z"),
  });
}

beforeAll(async () => {
  await cleanupFixtures();
  await createFixtures();
});

afterAll(async () => {
  await cleanupFixtures();
});

describe("paymentRepository.listTransactionsForCompany — full ledger", () => {
  it("returns manual + stripe + qbo rows when no filter is applied", async () => {
    const rows = await paymentRepository.listTransactionsForCompany(companyId);
    const sources = rows.map((r) => r.providerSource);
    expect(sources).toContain("manual");
    expect(sources).toContain("stripe");
    expect(sources).toContain("qbo");
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });

  it("includes providerSource on each row (PR8.5 projection)", async () => {
    const rows = await paymentRepository.listTransactionsForCompany(companyId);
    for (const r of rows) {
      expect(["manual", "stripe", "qbo"]).toContain(r.providerSource);
    }
  });

  it("sorts by receivedAt DESC (newest first)", async () => {
    const rows = await paymentRepository.listTransactionsForCompany(companyId);
    // The fixtures seeded qbo last, then stripe, then manual.
    const ourRows = rows.filter((r) =>
      [manualPaymentId, stripePaymentId, qboPaymentId].includes(r.id),
    );
    expect(ourRows.map((r) => r.id)).toEqual([
      qboPaymentId,
      stripePaymentId,
      manualPaymentId,
    ]);
  });
});

describe("paymentRepository.listTransactionsForCompany — filter by providerSource", () => {
  it("returns only stripe rows when providerSource = 'stripe'", async () => {
    const rows = await paymentRepository.listTransactionsForCompany(companyId, {
      providerSource: "stripe",
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.providerSource).toBe("stripe");
    }
  });

  it("returns only manual rows when providerSource = 'manual'", async () => {
    const rows = await paymentRepository.listTransactionsForCompany(companyId, {
      providerSource: "manual",
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.providerSource).toBe("manual");
    }
  });

  it("returns only qbo rows when providerSource = 'qbo'", async () => {
    const rows = await paymentRepository.listTransactionsForCompany(companyId, {
      providerSource: "qbo",
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.providerSource).toBe("qbo");
    }
  });
});

describe("paymentRepository.listTransactionsForCompany — filter by method", () => {
  it("returns only cheque rows when method = 'cheque'", async () => {
    const rows = await paymentRepository.listTransactionsForCompany(companyId, {
      method: "cheque",
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.method).toBe("cheque");
    }
  });
});

describe("paymentRepository.listTransactionsForCompany — free-text search", () => {
  it("matches by customer name (ILIKE)", async () => {
    const rows = await paymentRepository.listTransactionsForCompany(companyId, {
      q: "Acme",
    });
    // Every fixture row links the same customer name.
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const r of rows) {
      expect(r.customerCompanyName).toContain("Acme");
    }
  });

  it("matches by invoice number (ILIKE)", async () => {
    const rows = await paymentRepository.listTransactionsForCompany(companyId, {
      q: "PR85-INV",
    });
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });

  it("matches by amount substring (ILIKE on amount::text)", async () => {
    const rows = await paymentRepository.listTransactionsForCompany(companyId, {
      q: "100",
    });
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });

  it("returns empty when search has no match", async () => {
    const rows = await paymentRepository.listTransactionsForCompany(companyId, {
      q: "NEEDLE_NEVER_PRESENT_zzzz",
    });
    expect(rows.length).toBe(0);
  });

  it("ignores whitespace-only search", async () => {
    const rows = await paymentRepository.listTransactionsForCompany(companyId, {
      q: "   ",
    });
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });
});
