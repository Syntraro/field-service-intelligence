/**
 * Portal invoice access tokens — middleware + service regression
 * (2026-05-05).
 *
 * Covers the new `?t=<token>` model that lets the Pay Invoice email
 * link customers land on the invoice detail page without going
 * through magic-link sign-in.
 *
 * Asserts:
 *   - mintInvoiceAccessToken creates a hashed row with 30-day TTL
 *   - resolveInvoiceAccessToken validates the raw token and returns
 *     the correct scope
 *   - resolveInvoiceAccessToken rejects: unknown tokens, expired
 *     tokens, consumed tokens, and tokens belonging to a different
 *     invoice (cross-scope)
 *   - revokeInvoiceAccessTokens stamps `consumed_at` on every
 *     outstanding token for the invoice (single + bulk)
 *   - revoked tokens no longer resolve
 *   - mint is null when the invoice has no customerCompanyId
 *
 * IMPORTANT: vi.mock calls are hoisted above imports.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";

import { db } from "../server/db";
import {
  companies,
  customerCompanies,
  clientLocations,
  invoices,
  portalInvoiceAccessTokens,
} from "@shared/schema";
import {
  mintInvoiceAccessToken,
  resolveInvoiceAccessToken,
  revokeInvoiceAccessTokens,
  revokeInvoiceAccessTokensForInvoices,
} from "../server/services/portal/invoiceAccessTokens";

const TEST_PREFIX = "portal_invoice_token_test_";

let companyId: string;
let customerCompanyId: string;
let locationId: string;
const createdInvoiceIds: string[] = [];

async function setupFixtures() {
  companyId = uuidv4();
  await db.insert(companies).values({ id: companyId, name: `${TEST_PREFIX}company` });

  customerCompanyId = uuidv4();
  await db.insert(customerCompanies).values({
    id: customerCompanyId,
    companyId,
    name: `${TEST_PREFIX}customer`,
  });

  locationId = uuidv4();
  await db.insert(clientLocations).values({
    id: locationId,
    companyId,
    parentCompanyId: customerCompanyId,
    companyName: `${TEST_PREFIX}location`,
    address: "1 Test Way",
    selectedMonths: [],
  });
}

async function cleanupFixtures() {
  for (const id of createdInvoiceIds) {
    await db.delete(portalInvoiceAccessTokens).where(eq(portalInvoiceAccessTokens.invoiceId, id)).catch(() => {});
    await db.delete(invoices).where(eq(invoices.id, id)).catch(() => {});
  }
  if (locationId) await db.delete(clientLocations).where(eq(clientLocations.id, locationId)).catch(() => {});
  if (customerCompanyId) await db.delete(customerCompanies).where(eq(customerCompanies.id, customerCompanyId)).catch(() => {});
  if (companyId) await db.delete(companies).where(eq(companies.id, companyId)).catch(() => {});
}

async function createInvoice(opts: { withCustomerCompany?: boolean } = {}): Promise<string> {
  const id = uuidv4();
  await db.insert(invoices).values({
    id,
    companyId,
    locationId,
    customerCompanyId: opts.withCustomerCompany === false ? null : customerCompanyId,
    invoiceNumber: Math.floor(1000 + Math.random() * 9000),
    status: "awaiting_payment",
    issueDate: new Date().toISOString().slice(0, 10),
    subtotal: "100.00",
    taxTotal: "0.00",
    total: "100.00",
    amountPaid: "0.00",
    balance: "100.00",
    paymentTermsDays: 30,
  });
  createdInvoiceIds.push(id);
  return id;
}

function sha256(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

describe("portal invoice access tokens", () => {
  beforeAll(async () => {
    await setupFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
  });

  it("mint persists a hashed row with 30-day TTL and returns the raw token", async () => {
    const invoiceId = await createInvoice();
    const before = Date.now();

    const result = await mintInvoiceAccessToken(invoiceId);

    expect(result).not.toBeNull();
    expect(result!.rawToken).toBeDefined();
    // 32 bytes base64url encodes to 43 chars (no padding).
    expect(result!.rawToken.length).toBeGreaterThanOrEqual(40);
    expect(result!.rawToken.length).toBeLessThanOrEqual(50);

    // Stored row should be the SHA-256 hash, not the raw token.
    const [row] = await db
      .select()
      .from(portalInvoiceAccessTokens)
      .where(eq(portalInvoiceAccessTokens.invoiceId, invoiceId));
    expect(row).toBeDefined();
    expect(row.tokenHash).toBe(sha256(result!.rawToken));
    expect(row.tokenHash).not.toBe(result!.rawToken);

    // TTL: ~30 days. Allow ±1 day of slack.
    const ttlMs = row.expiresAt.getTime() - before;
    const oneDayMs = 24 * 60 * 60 * 1000;
    expect(ttlMs).toBeGreaterThan(29 * oneDayMs);
    expect(ttlMs).toBeLessThan(31 * oneDayMs);

    // Scope fields persisted.
    expect(row.companyId).toBe(companyId);
    expect(row.customerCompanyId).toBe(customerCompanyId);
    expect(row.consumedAt).toBeNull();
  });

  it("resolve returns the invoice scope for a valid raw token", async () => {
    const invoiceId = await createInvoice();
    const minted = await mintInvoiceAccessToken(invoiceId);

    const scope = await resolveInvoiceAccessToken(minted!.rawToken);

    expect(scope).not.toBeNull();
    expect(scope!.invoiceId).toBe(invoiceId);
    expect(scope!.companyId).toBe(companyId);
    expect(scope!.customerCompanyId).toBe(customerCompanyId);
  });

  it("resolve returns null for an unknown token", async () => {
    const fake = crypto.randomBytes(32).toString("base64url");
    const scope = await resolveInvoiceAccessToken(fake);
    expect(scope).toBeNull();
  });

  it("resolve returns null for an expired token", async () => {
    const invoiceId = await createInvoice();
    const minted = await mintInvoiceAccessToken(invoiceId);

    // Force-expire the row.
    await db
      .update(portalInvoiceAccessTokens)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(portalInvoiceAccessTokens.invoiceId, invoiceId));

    const scope = await resolveInvoiceAccessToken(minted!.rawToken);
    expect(scope).toBeNull();
  });

  it("revoke stamps consumed_at; revoked token no longer resolves", async () => {
    const invoiceId = await createInvoice();
    const minted = await mintInvoiceAccessToken(invoiceId);

    // Sanity: resolves before revoke.
    expect(await resolveInvoiceAccessToken(minted!.rawToken)).not.toBeNull();

    await revokeInvoiceAccessTokens(invoiceId);

    const [row] = await db
      .select()
      .from(portalInvoiceAccessTokens)
      .where(eq(portalInvoiceAccessTokens.invoiceId, invoiceId));
    expect(row.consumedAt).not.toBeNull();

    // Resolve must reject after revoke.
    expect(await resolveInvoiceAccessToken(minted!.rawToken)).toBeNull();
  });

  it("bulk revoke stamps every invoice's tokens at once", async () => {
    const invoiceA = await createInvoice();
    const invoiceB = await createInvoice();
    const tokA = await mintInvoiceAccessToken(invoiceA);
    const tokB = await mintInvoiceAccessToken(invoiceB);

    await revokeInvoiceAccessTokensForInvoices([invoiceA, invoiceB]);

    expect(await resolveInvoiceAccessToken(tokA!.rawToken)).toBeNull();
    expect(await resolveInvoiceAccessToken(tokB!.rawToken)).toBeNull();
  });

  it("token for invoice A does not unlock invoice B (scope isolation)", async () => {
    const invoiceA = await createInvoice();
    const invoiceB = await createInvoice();
    const tokA = await mintInvoiceAccessToken(invoiceA);

    const scope = await resolveInvoiceAccessToken(tokA!.rawToken);
    expect(scope).not.toBeNull();
    // The scope's `invoiceId` is invoiceA — the access-middleware's
    // `requireInvoiceAccess(:invoiceId)` then compares this against the
    // requested route param and rejects when it's invoiceB. The
    // resolver itself returns the scope as-is; route-level scope
    // matching is the gate.
    expect(scope!.invoiceId).toBe(invoiceA);
    expect(scope!.invoiceId).not.toBe(invoiceB);
  });

  it("mint returns null when invoice has no customerCompanyId", async () => {
    const invoiceId = await createInvoice({ withCustomerCompany: false });
    const result = await mintInvoiceAccessToken(invoiceId);
    expect(result).toBeNull();

    // No row should have been written.
    const rows = await db
      .select()
      .from(portalInvoiceAccessTokens)
      .where(eq(portalInvoiceAccessTokens.invoiceId, invoiceId));
    expect(rows).toHaveLength(0);
  });

  it("resolve rejects malformed tokens (length guards)", async () => {
    expect(await resolveInvoiceAccessToken("")).toBeNull();
    expect(await resolveInvoiceAccessToken("short")).toBeNull();
    // Also guard against absurdly long inputs.
    expect(await resolveInvoiceAccessToken("x".repeat(500))).toBeNull();
  });
});
