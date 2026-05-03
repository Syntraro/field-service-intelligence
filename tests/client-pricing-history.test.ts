/**
 * Client Pricing History Service Tests
 *
 * Validates the derived per-client pricing-history service:
 *   - tenant isolation (cross-tenant data must never leak)
 *   - invoice line items show up
 *   - quote line items show up
 *   - filters: limit / itemId / search / sourceType
 *   - newest-first ordering across mixed sources
 *   - empty result for a client with no history
 *
 * Plus a regression assertion that the service does NOT mutate any
 * write paths (no job-to-invoice conversion warnings, no overrides).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { promises as fs } from "fs";
import path from "path";

import { db } from "../server/db";
import {
  companies,
  users,
  clientLocations,
  customerCompanies,
  jobs,
  jobParts,
  invoices,
  invoiceLines,
  quotes,
  quoteLines,
  items,
} from "@shared/schema";
import {
  getClientPricingHistory,
  type PricingHistoryItem,
} from "../server/services/clientPricingHistoryService";
import type { QueryCtx } from "../server/lib/queryCtx";

// ========================================
// Fixtures
// ========================================

const TEST_PREFIX = "pricing_hist_test_";

let companyA: string;
let companyB: string;

let userA: string;
let userB: string;

let custA: string;
let custB: string;

let locationA1: string;
let locationA2: string;
let locationB1: string;

let itemA: string; // shared product/service for filter tests

let invoiceA1: string;
let invoiceLineA1Old: string;
let invoiceLineA1New: string;

let quoteA1: string;
let quoteLineA1: string;

let jobA1: string;
let jobPartA1: string;

let invoiceB1: string;
let invoiceLineB1: string;

let locationAEmpty: string; // location with zero history

function makeCtx(tenantId: string, userId: string): QueryCtx {
  return {
    db: db as any,
    tenantId,
    userId,
    role: "owner",
  };
}

async function seed() {
  companyA = uuidv4();
  companyB = uuidv4();
  await db.insert(companies).values([
    { id: companyA, name: `${TEST_PREFIX}A` },
    { id: companyB, name: `${TEST_PREFIX}B` },
  ]);

  userA = uuidv4();
  userB = uuidv4();
  await db.insert(users).values([
    {
      id: userA,
      companyId: companyA,
      email: `${TEST_PREFIX}a_${Date.now()}@test.com`,
      password: "hash",
      role: "owner",
    },
    {
      id: userB,
      companyId: companyB,
      email: `${TEST_PREFIX}b_${Date.now()}@test.com`,
      password: "hash",
      role: "owner",
    },
  ]);

  custA = uuidv4();
  custB = uuidv4();
  await db.insert(customerCompanies).values([
    { id: custA, companyId: companyA, name: `${TEST_PREFIX}custA` },
    { id: custB, companyId: companyB, name: `${TEST_PREFIX}custB` },
  ]);

  locationA1 = uuidv4();
  locationA2 = uuidv4();
  locationAEmpty = uuidv4();
  locationB1 = uuidv4();
  await db.insert(clientLocations).values([
    {
      id: locationA1,
      companyId: companyA,
      parentCompanyId: custA,
      companyName: `${TEST_PREFIX}LocA1`,
      selectedMonths: [1],
    },
    {
      id: locationA2,
      companyId: companyA,
      parentCompanyId: custA,
      companyName: `${TEST_PREFIX}LocA2`,
      selectedMonths: [1],
    },
    {
      id: locationAEmpty,
      companyId: companyA,
      parentCompanyId: custA,
      companyName: `${TEST_PREFIX}LocAEmpty`,
      selectedMonths: [1],
    },
    {
      id: locationB1,
      companyId: companyB,
      parentCompanyId: custB,
      companyName: `${TEST_PREFIX}LocB1`,
      selectedMonths: [1],
    },
  ]);

  itemA = uuidv4();
  await db.insert(items).values({
    id: itemA,
    companyId: companyA,
    userId: userA,
    type: "product",
    name: "Standard Filter",
    category: "Filters",
    isActive: true,
  });

  // -----------------------------------
  // Invoice + 2 lines for locationA1
  // (one OLD, one NEW — to verify ordering)
  // -----------------------------------
  invoiceA1 = uuidv4();
  await db.insert(invoices).values({
    id: invoiceA1,
    companyId: companyA,
    locationId: locationA1,
    customerCompanyId: custA,
    invoiceNumber: "INV-PH-001",
    status: "sent",
    issueDate: "2026-04-15",
    subtotal: "100.00",
    taxTotal: "13.00",
    total: "113.00",
    balance: "113.00",
  });
  invoiceLineA1Old = uuidv4();
  invoiceLineA1New = uuidv4();
  await db.insert(invoiceLines).values([
    {
      id: invoiceLineA1Old,
      companyId: companyA,
      invoiceId: invoiceA1,
      lineNumber: 1,
      description: "Old filter swap",
      quantity: "2",
      unitPrice: "25.00",
      lineSubtotal: "50.00",
      taxAmount: "6.50",
      lineTotal: "56.50",
      productId: itemA,
    },
    {
      id: invoiceLineA1New,
      companyId: companyA,
      invoiceId: invoiceA1,
      lineNumber: 2,
      description: "Premium service charge",
      quantity: "1",
      unitPrice: "50.00",
      lineSubtotal: "50.00",
      taxAmount: "6.50",
      lineTotal: "56.50",
    },
  ]);

  // -----------------------------------
  // Quote + 1 line for locationA1 (date BEFORE the invoice)
  // -----------------------------------
  quoteA1 = uuidv4();
  await db.insert(quotes).values({
    id: quoteA1,
    companyId: companyA,
    locationId: locationA1,
    customerCompanyId: custA,
    quoteNumber: "QTE-PH-001",
    status: "sent",
    issueDate: "2026-01-10",
    subtotal: "200.00",
    taxTotal: "26.00",
    total: "226.00",
  });
  quoteLineA1 = uuidv4();
  await db.insert(quoteLines).values({
    id: quoteLineA1,
    companyId: companyA,
    quoteId: quoteA1,
    lineNumber: 1,
    description: "Quoted compressor install",
    quantity: "1",
    unitPrice: "200.00",
    lineSubtotal: "200.00",
    taxAmount: "26.00",
    lineTotal: "226.00",
  });

  // -----------------------------------
  // Job + jobPart for locationA1 (date between quote and invoice)
  // -----------------------------------
  jobA1 = uuidv4();
  await db.insert(jobs).values({
    id: jobA1,
    companyId: companyA,
    locationId: locationA1,
    jobNumber: 900001,
    status: "open",
    summary: "Test PM",
    scheduledStart: new Date("2026-03-01T09:00:00Z"),
  });
  jobPartA1 = uuidv4();
  await db.insert(jobParts).values({
    id: jobPartA1,
    companyId: companyA,
    jobId: jobA1,
    description: "Replacement belt",
    quantity: "3",
    unitPrice: "10.00",
    productId: itemA,
  });

  // -----------------------------------
  // Cross-tenant data: invoice + line under companyB / locationB1
  // -----------------------------------
  invoiceB1 = uuidv4();
  await db.insert(invoices).values({
    id: invoiceB1,
    companyId: companyB,
    locationId: locationB1,
    customerCompanyId: custB,
    invoiceNumber: "INV-PH-OTHER",
    status: "sent",
    issueDate: "2026-04-20",
    subtotal: "999.00",
    taxTotal: "0.00",
    total: "999.00",
    balance: "999.00",
  });
  invoiceLineB1 = uuidv4();
  await db.insert(invoiceLines).values({
    id: invoiceLineB1,
    companyId: companyB,
    invoiceId: invoiceB1,
    lineNumber: 1,
    description: "Cross-tenant secret",
    quantity: "1",
    unitPrice: "999.00",
    lineSubtotal: "999.00",
    taxAmount: "0.00",
    lineTotal: "999.00",
  });
}

async function cleanup() {
  await db.delete(invoiceLines).where(eq(invoiceLines.id, invoiceLineA1Old)).catch(() => {});
  await db.delete(invoiceLines).where(eq(invoiceLines.id, invoiceLineA1New)).catch(() => {});
  await db.delete(invoiceLines).where(eq(invoiceLines.id, invoiceLineB1)).catch(() => {});
  await db.delete(invoices).where(eq(invoices.id, invoiceA1)).catch(() => {});
  await db.delete(invoices).where(eq(invoices.id, invoiceB1)).catch(() => {});

  await db.delete(quoteLines).where(eq(quoteLines.id, quoteLineA1)).catch(() => {});
  await db.delete(quotes).where(eq(quotes.id, quoteA1)).catch(() => {});

  await db.delete(jobParts).where(eq(jobParts.id, jobPartA1)).catch(() => {});
  await db.delete(jobs).where(eq(jobs.id, jobA1)).catch(() => {});

  await db.delete(items).where(eq(items.id, itemA)).catch(() => {});

  await db.delete(clientLocations).where(eq(clientLocations.id, locationA1)).catch(() => {});
  await db.delete(clientLocations).where(eq(clientLocations.id, locationA2)).catch(() => {});
  await db.delete(clientLocations).where(eq(clientLocations.id, locationAEmpty)).catch(() => {});
  await db.delete(clientLocations).where(eq(clientLocations.id, locationB1)).catch(() => {});

  await db.delete(customerCompanies).where(eq(customerCompanies.id, custA)).catch(() => {});
  await db.delete(customerCompanies).where(eq(customerCompanies.id, custB)).catch(() => {});

  await db.delete(users).where(eq(users.id, userA)).catch(() => {});
  await db.delete(users).where(eq(users.id, userB)).catch(() => {});

  await db.delete(companies).where(eq(companies.id, companyA)).catch(() => {});
  await db.delete(companies).where(eq(companies.id, companyB)).catch(() => {});
}

// ========================================
// Tests
// ========================================

describe("clientPricingHistoryService — derived read", () => {
  beforeAll(async () => {
    await seed();
  });

  afterAll(async () => {
    await cleanup();
  });

  it("returns invoice line items for the requested client", async () => {
    const ctx = makeCtx(companyA, userA);
    const { items } = await getClientPricingHistory(ctx, locationA1);

    const invoiceItems = items.filter((i) => i.sourceType === "invoice");
    expect(invoiceItems.length).toBe(2);

    const oldLine = invoiceItems.find((i) => i.itemName === "Old filter swap");
    expect(oldLine).toBeDefined();
    expect(oldLine?.itemId).toBe(itemA);
    expect(oldLine?.unitPrice).toBe("25.00");
    expect(oldLine?.quantity).toBe("2");
    expect(oldLine?.total).toBe("56.50");
    expect(oldLine?.sourceNumber).toBe("INV-PH-001");
    expect(oldLine?.sourceId).toBe(invoiceA1);
    expect(oldLine?.category).toBe("Filters");

    const noProductLine = invoiceItems.find((i) => i.itemName === "Premium service charge");
    expect(noProductLine).toBeDefined();
    expect(noProductLine?.itemId).toBeNull();
    expect(noProductLine?.category).toBeNull();
  });

  it("returns quote line items for the requested client", async () => {
    const ctx = makeCtx(companyA, userA);
    const { items } = await getClientPricingHistory(ctx, locationA1);

    const quoteItems = items.filter((i) => i.sourceType === "quote");
    expect(quoteItems.length).toBe(1);
    expect(quoteItems[0].sourceNumber).toBe("QTE-PH-001");
    expect(quoteItems[0].sourceId).toBe(quoteA1);
    expect(quoteItems[0].itemName).toBe("Quoted compressor install");
    expect(quoteItems[0].unitPrice).toBe("200.00");
    expect(quoteItems[0].total).toBe("226.00");
  });

  it("does NOT return job_parts even when present in the schema", async () => {
    // The seed inserts a jobPart with productId=itemA, qty=3, unitPrice=10.00
    // for jobA1 under locationA1. Pricing history must ignore it because
    // job_parts can represent internal/staged data, not confirmed customer
    // pricing.
    const ctx = makeCtx(companyA, userA);
    const { items } = await getClientPricingHistory(ctx, locationA1);

    expect(items.find((i: any) => (i as any).sourceType === "job")).toBeUndefined();
    expect(items.find((i) => i.sourceId === jobA1)).toBeUndefined();
    expect(items.find((i) => i.itemName === "Replacement belt")).toBeUndefined();
  });

  it("sorts results newest-first across mixed sources", async () => {
    const ctx = makeCtx(companyA, userA);
    const { items } = await getClientPricingHistory(ctx, locationA1);
    expect(items.length).toBe(3); // 2 invoice + 1 quote (job_parts excluded)

    // Expected chronological order, newest first:
    //   invoice 2026-04-15 (×2)  →  quote 2026-01-10
    expect(items[0].sourceType).toBe("invoice");
    expect(items[1].sourceType).toBe("invoice");
    expect(items[2].sourceType).toBe("quote");
  });

  it("returns an empty array when the client has no history", async () => {
    const ctx = makeCtx(companyA, userA);
    const { items } = await getClientPricingHistory(ctx, locationAEmpty);
    expect(items).toEqual([]);
  });

  it("does not leak cross-tenant lines (companyA cannot see companyB invoice)", async () => {
    const ctx = makeCtx(companyA, userA);
    const { items: aSeenFromA } = await getClientPricingHistory(ctx, locationB1);
    expect(aSeenFromA).toEqual([]);

    // From companyB we DO see locationB1's data — proves the test fixture is real.
    const ctxB = makeCtx(companyB, userB);
    const { items: bSeenFromB } = await getClientPricingHistory(ctxB, locationB1);
    expect(bSeenFromB.length).toBe(1);
    expect(bSeenFromB[0].sourceNumber).toBe("INV-PH-OTHER");
  });

  it("filter: sourceType=invoice returns only invoice rows", async () => {
    const ctx = makeCtx(companyA, userA);
    const { items } = await getClientPricingHistory(ctx, locationA1, { sourceType: "invoice" });
    expect(items.length).toBe(2);
    expect(items.every((i: PricingHistoryItem) => i.sourceType === "invoice")).toBe(true);
  });

  it("filter: itemId filters to one product across invoice + quote sources only", async () => {
    const ctx = makeCtx(companyA, userA);
    const { items } = await getClientPricingHistory(ctx, locationA1, { itemId: itemA });
    // itemA appears on invoice line 1 (filter swap). The 'Premium service
    // charge' invoice line and the quote line have no productId, and the
    // jobPart that uses itemA is excluded because job_parts is not a source.
    expect(items.length).toBe(1);
    expect(items[0].sourceType).toBe("invoice");
    expect(items[0].itemId).toBe(itemA);
  });

  it("filter: limit caps the number of returned items", async () => {
    const ctx = makeCtx(companyA, userA);
    const { items } = await getClientPricingHistory(ctx, locationA1, { limit: 2 });
    expect(items.length).toBe(2);
    // Newest-first invariant must still hold
    expect(items[0].sourceType).toBe("invoice");
    expect(items[1].sourceType).toBe("invoice");
  });

  it("filter: search is ILIKE across descriptions / item names", async () => {
    const ctx = makeCtx(companyA, userA);
    const { items } = await getClientPricingHistory(ctx, locationA1, { search: "compressor" });
    expect(items.length).toBe(1);
    expect(items[0].sourceType).toBe("quote");
  });
});

// ============================================================================
// Regression: the new service does NOT touch the job-to-invoice conversion
// path and never adds pricing-difference warnings. We assert this two ways:
//
//   1. The service's source code contains no INSERT/UPDATE/DELETE — proving
//      it is read-only.
//   2. The conversion service (`createInvoiceFromJob`) does not import the
//      pricing-history module — proving the new code can never inject
//      warning logic into the conversion flow.
// ============================================================================

describe("clientPricingHistoryService — conversion regression guard", () => {
  it("service module is read-only (no INSERT/UPDATE/DELETE)", async () => {
    const file = path.resolve(
      __dirname,
      "..",
      "server",
      "services",
      "clientPricingHistoryService.ts",
    );
    const src = await fs.readFile(file, "utf8");
    // Tolerant patterns: catch Drizzle helpers as well as raw SQL keywords.
    expect(/\.insert\s*\(/.test(src)).toBe(false);
    expect(/\.update\s*\(/.test(src)).toBe(false);
    expect(/\.delete\s*\(/.test(src)).toBe(false);
    expect(/\bINSERT\s+INTO\b/i.test(src)).toBe(false);
    expect(/\bUPDATE\s+\w+\s+SET\b/i.test(src)).toBe(false);
    expect(/\bDELETE\s+FROM\b/i.test(src)).toBe(false);
  });

  it("invoiceCreationService does not depend on clientPricingHistoryService", async () => {
    const file = path.resolve(
      __dirname,
      "..",
      "server",
      "services",
      "invoiceCreationService.ts",
    );
    const src = await fs.readFile(file, "utf8");
    expect(src.includes("clientPricingHistoryService")).toBe(false);
    expect(src.toLowerCase().includes("pricing-difference")).toBe(false);
    expect(src.toLowerCase().includes("price-warning")).toBe(false);
  });
});
