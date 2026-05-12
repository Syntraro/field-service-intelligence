/**
 * Client Pricing History — HTTP contract tests.
 *
 * These tests mount the real `clients` router behind a minimal Express
 * harness that simulates the global `requireAuth` + `ensureTenantContext`
 * gates by injecting `req.user` + `req.companyId` directly. They exercise
 * the route's input-validation surface and the cross-tenant 404 contract:
 *
 *   - sourceType=job              → 400 (intentional rejection)
 *   - sourceType=garbage          → 400
 *   - limit=abc / limit=0         → 400
 *   - locationId=<bogus>          → 404 (cross-tenant probe protection)
 *   - clientId belongs to other   → 404 (cross-tenant probe protection)
 *     tenant
 *   - empty history               → 200 with `{ items: [] }`
 *   - happy path                  → 200 with the documented shape
 *
 * The unit/service-level tests for ordering, filters, tenant isolation
 * inside the SQL layer, and the no-job-parts regression live in
 * `tests/client-pricing-history.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

import { db } from "../server/db";
import {
  companies,
  users,
  clientLocations,
  customerCompanies,
  invoices,
  invoiceLines,
} from "@shared/schema";
import clientsRouter from "../server/routes/clients";

// ────────────────────────────────────────────────────────────────────────────
// Test harness — minimal Express app that injects auth context.
// ────────────────────────────────────────────────────────────────────────────

const TEST_PREFIX = "pricing_hist_http_test_";

let companyA: string;
let companyB: string;
let userA: string;
let userB: string;

let custA: string;
let custB: string;

let locationA: string;
let locationAEmpty: string;
let locationB: string;

let invoiceA: string;
let invoiceLineA: string;

/**
 * Per-request "logged-in" identity. Tests flip this between Company A and
 * Company B to assert tenant isolation through the real auth contract
 * (companyId comes from the user, not from the URL).
 */
let activeUser: { id: string; companyId: string; role: string } | null = null;

function makeApp() {
  const app = express();
  app.use(express.json());

  // Simulate requireAuth + ensureTenantContext: if the test set an active
  // user, attach it just like the real middlewares would. Otherwise return
  // 401 the same way `requireAuth` does in production.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!activeUser) return res.status(401).json({ error: "Unauthorized" });
    (req as any).user = {
      id: activeUser.id,
      companyId: activeUser.companyId,
      role: activeUser.role,
    };
    (req as any).companyId = activeUser.companyId;
    return next();
  });

  app.use("/api/clients", clientsRouter);

  // Mirror the real error handler shape (status + JSON body) so supertest
  // assertions against `createError(...)` line up with prod behavior.
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err?.status || err?.statusCode || 500;
    res.status(status).json({ error: err?.message ?? "Server error" });
  });

  return app;
}

const app = makeApp();

// ────────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────────

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

  locationA = uuidv4();
  locationAEmpty = uuidv4();
  locationB = uuidv4();
  await db.insert(clientLocations).values([
    {
      id: locationA,
      companyId: companyA,
      parentCompanyId: custA,
      companyName: `${TEST_PREFIX}LocA`,
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
      id: locationB,
      companyId: companyB,
      parentCompanyId: custB,
      companyName: `${TEST_PREFIX}LocB`,
      selectedMonths: [1],
    },
  ]);

  invoiceA = uuidv4();
  await db.insert(invoices).values({
    id: invoiceA,
    companyId: companyA,
    locationId: locationA,
    customerCompanyId: custA,
    invoiceNumber: "INV-PHHTTP-001",
    status: "sent",
    issueDate: "2026-04-15",
    subtotal: "100.00",
    taxTotal: "13.00",
    total: "113.00",
    balance: "113.00",
  });
  invoiceLineA = uuidv4();
  await db.insert(invoiceLines).values({
    id: invoiceLineA,
    companyId: companyA,
    invoiceId: invoiceA,
    lineNumber: 1,
    description: "Filter swap",
    quantity: "2",
    unitPrice: "25.00",
    lineSubtotal: "50.00",
    taxAmount: "6.50",
    lineTotal: "56.50",
  });
}

async function cleanup() {
  await db.delete(invoiceLines).where(eq(invoiceLines.id, invoiceLineA)).catch(() => {});
  await db.delete(invoices).where(eq(invoices.id, invoiceA)).catch(() => {});

  await db.delete(clientLocations).where(eq(clientLocations.id, locationA)).catch(() => {});
  await db.delete(clientLocations).where(eq(clientLocations.id, locationAEmpty)).catch(() => {});
  await db.delete(clientLocations).where(eq(clientLocations.id, locationB)).catch(() => {});

  await db.delete(customerCompanies).where(eq(customerCompanies.id, custA)).catch(() => {});
  await db.delete(customerCompanies).where(eq(customerCompanies.id, custB)).catch(() => {});

  await db.delete(users).where(eq(users.id, userA)).catch(() => {});
  await db.delete(users).where(eq(users.id, userB)).catch(() => {});

  await db.delete(companies).where(eq(companies.id, companyA)).catch(() => {});
  await db.delete(companies).where(eq(companies.id, companyB)).catch(() => {});
}

function loginAsCompanyA() {
  activeUser = { id: userA, companyId: companyA, role: "owner" };
}
function loginAsCompanyB() {
  activeUser = { id: userB, companyId: companyB, role: "owner" };
}
function logout() {
  activeUser = null;
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("GET /api/clients/:clientId/pricing-history — HTTP contract", () => {
  beforeAll(async () => {
    await seed();
  });

  afterAll(async () => {
    await cleanup();
  });

  // ── Happy path ────────────────────────────────────────────────────────
  it("200 — returns the documented shape for a real client", async () => {
    loginAsCompanyA();
    const res = await request(app).get(`/api/clients/${locationA}/pricing-history`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("items");
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBe(1);

    const item = res.body.items[0];
    // Every documented field is present and typed correctly.
    expect(item.clientId).toBe(locationA);
    expect(item.locationId).toBe(locationA);
    expect(item.itemId).toBeNull();
    expect(typeof item.itemName).toBe("string");
    expect(item.category).toBeNull();
    expect(item.sourceType).toBe("invoice");
    expect(item.sourceId).toBe(invoiceA);
    expect(item.sourceNumber).toBe("INV-PHHTTP-001");
    // Money fields are strings, not numbers.
    expect(typeof item.unitPrice).toBe("string");
    expect(typeof item.total).toBe("string");
    expect(typeof item.quantity).toBe("string");
    expect(item.unitPrice).toBe("25.00");
    expect(item.total).toBe("56.50");
    // Date is ISO 8601.
    expect(typeof item.date).toBe("string");
    expect(item.date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    // Service location — seeded with companyName only, no address.
    expect(item.serviceLocationName).toBe(`${TEST_PREFIX}LocA`);
    expect(item.serviceLocationAddress).toBeNull();
  });

  it("200 — empty history returns { items: [] }", async () => {
    loginAsCompanyA();
    const res = await request(app).get(`/api/clients/${locationAEmpty}/pricing-history`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
  });

  // ── 401 (no auth) ─────────────────────────────────────────────────────
  it("401 — no authenticated user", async () => {
    logout();
    const res = await request(app).get(`/api/clients/${locationA}/pricing-history`);
    expect(res.status).toBe(401);
  });

  // ── 400 — bad sourceType ─────────────────────────────────────────────
  it("400 — sourceType=job is rejected (job_parts intentionally excluded)", async () => {
    loginAsCompanyA();
    const res = await request(app)
      .get(`/api/clients/${locationA}/pricing-history`)
      .query({ sourceType: "job" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sourceType/i);
  });

  it("400 — sourceType=garbage is rejected", async () => {
    loginAsCompanyA();
    const res = await request(app)
      .get(`/api/clients/${locationA}/pricing-history`)
      .query({ sourceType: "garbage" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sourceType/i);
  });

  // ── 400 — invalid limit ───────────────────────────────────────────────
  it("400 — limit=abc is rejected", async () => {
    loginAsCompanyA();
    const res = await request(app)
      .get(`/api/clients/${locationA}/pricing-history`)
      .query({ limit: "abc" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/limit/i);
  });

  it("400 — limit=0 is rejected", async () => {
    loginAsCompanyA();
    const res = await request(app)
      .get(`/api/clients/${locationA}/pricing-history`)
      .query({ limit: "0" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/limit/i);
  });

  it("200 — limit=999999 is accepted; service silently clamps to 200", async () => {
    // Sanity: oversize values must not 400. The clamp is a service
    // concern, not a validation concern.
    loginAsCompanyA();
    const res = await request(app)
      .get(`/api/clients/${locationA}/pricing-history`)
      .query({ limit: "999999" });
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeLessThanOrEqual(200);
  });

  it("200 — limit query absent → default 50 (no error)", async () => {
    loginAsCompanyA();
    const res = await request(app).get(`/api/clients/${locationA}/pricing-history`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeLessThanOrEqual(50);
  });

  // ── 400 — invalid locationId ──────────────────────────────────────────
  it("400 — empty locationId query string is rejected", async () => {
    loginAsCompanyA();
    // express parses ?locationId= as locationId="" — the validator must
    // reject zero-length strings.
    const res = await request(app)
      .get(`/api/clients/${locationA}/pricing-history`)
      .query({ locationId: "" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/locationId/i);
  });

  it("400 — oversized locationId is rejected", async () => {
    loginAsCompanyA();
    const res = await request(app)
      .get(`/api/clients/${locationA}/pricing-history`)
      .query({ locationId: "x".repeat(200) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/locationId/i);
  });

  // ── 404 — cross-tenant location probe via locationId param ────────────
  it("404 — locationId belonging to another tenant is rejected (no leak, no 500)", async () => {
    loginAsCompanyA();
    const res = await request(app)
      .get(`/api/clients/${locationA}/pricing-history`)
      .query({ locationId: locationB });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/location/i);
  });

  // ── 404 — unauthorized client access via :clientId path segment ───────
  it("404 — clientId from another tenant is rejected (no leak, no 500)", async () => {
    loginAsCompanyA();
    const res = await request(app).get(`/api/clients/${locationB}/pricing-history`);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/client/i);
    // Crucially: no rows from companyB leak through in the body.
    expect(res.body.items).toBeUndefined();
  });

  it("404 — non-existent clientId is rejected", async () => {
    loginAsCompanyA();
    const ghost = uuidv4();
    const res = await request(app).get(`/api/clients/${ghost}/pricing-history`);
    expect(res.status).toBe(404);
  });

  // ── 200 — same-tenant client visible from its own session ─────────────
  it("200 — companyB CAN see its own location, proving the 404 above is auth-driven", async () => {
    loginAsCompanyB();
    const res = await request(app).get(`/api/clients/${locationB}/pricing-history`);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });
});
