/**
 * Saved-payment-method foundation — PR A regression suite (2026-05-03).
 *
 * Two harnesses in one file:
 *
 *   1. Integration tests against the dev DB for the repository:
 *      - 2-row insert under one customer_company
 *      - unique-violation on duplicate (company, provider_source, provider_pm_id)
 *      - at-most-one active default per (company, customer_company)
 *      - tenant scoping on listByCustomerCompany
 *      - setDefault flips correctly + preserves the partial unique index
 *      - markDetached is idempotent + clears is_default
 *      - migration applied: customer_companies has provider_customer_id;
 *        payment_methods table + indexes exist
 *
 *   2. Mock tests for the resolver service:
 *      - first call → provider.createCustomer fires, row updated
 *      - second call → cache hit, no provider call
 *      - missing customer_company → 404
 *      - provider without createCustomer capability → 501
 *
 *   3. Source-grep guards for provider neutrality:
 *      - server/storage/paymentMethods.ts MUST NOT import the Stripe SDK
 *        or the stripe adapter
 *
 * Mirrors the PR-1 / PR-3 / PR-4 testing patterns established earlier in
 * this codebase.
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ═══════════════════════════════════════════════════════════════════════════
// Integration tests — real DB
// ═══════════════════════════════════════════════════════════════════════════

import { db } from "../server/db";
import {
  companies,
  users,
  customerCompanies,
  contactPersons,
  paymentMethods,
} from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { paymentMethodsRepository } from "../server/storage/paymentMethods";

const TEST_PREFIX = "pm_pr_a_test_";

let companyId: string;
let userId: string;
let customerCompanyAId: string;
let customerCompanyBId: string;
let contactId: string;

// A second tenant to exercise cross-tenant isolation.
let otherCompanyId: string;
let otherUserId: string;
let otherCustomerCompanyId: string;

async function cleanupFixtures() {
  // Order: payment_methods → contact_persons → customer_companies
  // → users → companies. FKs cascade where set; we delete explicitly
  // so cleanup works whether or not the test ran to completion.
  for (const c of [companyId, otherCompanyId]) {
    if (!c) continue;
    await db.delete(paymentMethods).where(eq(paymentMethods.companyId, c));
    await db.delete(contactPersons).where(eq(contactPersons.companyId, c));
    await db.delete(customerCompanies).where(eq(customerCompanies.companyId, c));
  }
  if (userId) await db.delete(users).where(eq(users.id, userId));
  if (otherUserId) await db.delete(users).where(eq(users.id, otherUserId));
  if (companyId) await db.delete(companies).where(eq(companies.id, companyId));
  if (otherCompanyId) await db.delete(companies).where(eq(companies.id, otherCompanyId));
}

async function createFixtures() {
  await db.insert(companies).values({
    id: companyId,
    name: TEST_PREFIX + "tenant_a",
    subscription: "pro",
  });
  await db.insert(users).values({
    id: userId,
    companyId,
    username: TEST_PREFIX + "user_a",
    email: TEST_PREFIX + "user_a@test.local",
    password: "hashed",
    role: "admin",
  });

  await db.insert(customerCompanies).values([
    {
      id: customerCompanyAId,
      companyId,
      name: TEST_PREFIX + "Acme",
      nameNormalized: TEST_PREFIX + "acme",
    },
    {
      id: customerCompanyBId,
      companyId,
      name: TEST_PREFIX + "Bravo",
      nameNormalized: TEST_PREFIX + "bravo",
    },
  ]);
  await db.insert(contactPersons).values({
    id: contactId,
    companyId,
    customerCompanyId: customerCompanyAId,
    firstName: "Test",
    lastName: "Contact",
    email: TEST_PREFIX + "contact@test.local",
  });

  // Second tenant.
  await db.insert(companies).values({
    id: otherCompanyId,
    name: TEST_PREFIX + "tenant_b",
    subscription: "pro",
  });
  await db.insert(users).values({
    id: otherUserId,
    companyId: otherCompanyId,
    username: TEST_PREFIX + "user_b",
    email: TEST_PREFIX + "user_b@test.local",
    password: "hashed",
    role: "admin",
  });
  await db.insert(customerCompanies).values({
    id: otherCustomerCompanyId,
    companyId: otherCompanyId,
    name: TEST_PREFIX + "OtherCo",
    nameNormalized: TEST_PREFIX + "otherco",
  });
}

beforeAll(async () => {
  companyId = uuidv4();
  userId = uuidv4();
  customerCompanyAId = uuidv4();
  customerCompanyBId = uuidv4();
  contactId = uuidv4();
  otherCompanyId = uuidv4();
  otherUserId = uuidv4();
  otherCustomerCompanyId = uuidv4();
  await cleanupFixtures();
  await createFixtures();
});

afterAll(async () => {
  await cleanupFixtures();
});

function baseInput(overrides: Partial<Parameters<typeof paymentMethodsRepository.createPaymentMethod>[1]> = {}) {
  return {
    companyId,
    customerCompanyId: customerCompanyAId,
    providerSource: "stripe" as const,
    providerCustomerId: "cus_test_a",
    providerPaymentMethodId: "pm_test_" + Math.random().toString(36).slice(2, 10),
    cardBrand: "visa",
    cardLast4: "4242",
    cardExpMonth: 12,
    cardExpYear: 2030,
    cardFunding: "credit",
    cardCountry: "US",
    consentAt: new Date(),
    consentText: "I authorize {COMPANY_NAME} to securely store this card.",
    consentIp: "127.0.0.1",
    consentUserAgent: "vitest",
    createdByContactId: contactId,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// (1) Migration applied — schema audit
// ═══════════════════════════════════════════════════════════════════════════

describe("migration — schema audit", () => {
  it("customer_companies has provider_customer_id (nullable)", async () => {
    const result = await db.execute(sql`
      SELECT is_nullable FROM information_schema.columns
       WHERE table_schema='public' AND table_name='customer_companies'
         AND column_name='provider_customer_id'
    `);
    const rows = result.rows as Array<{ is_nullable: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].is_nullable).toBe("YES");
  });

  it("payment_methods table exists with the canonical column set", async () => {
    const result = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='payment_methods'
    `);
    const cols = (result.rows as Array<{ column_name: string }>).map(r => r.column_name);
    for (const expected of [
      "id", "company_id", "customer_company_id",
      "provider_source", "provider_customer_id", "provider_payment_method_id",
      "card_brand", "card_last4", "card_exp_month", "card_exp_year",
      "card_funding", "card_country",
      "is_default",
      "consent_at", "consent_text", "consent_ip", "consent_user_agent",
      "created_by_contact_id",
      "detached_at", "detached_by_contact_id", "detach_reason",
      "created_at", "updated_at",
    ]) {
      expect(cols).toContain(expected);
    }
  });

  it("payment_methods has the three expected indexes", async () => {
    const result = await db.execute(sql`
      SELECT indexname FROM pg_indexes
       WHERE schemaname='public' AND tablename='payment_methods'
    `);
    const names = (result.rows as Array<{ indexname: string }>).map(r => r.indexname);
    expect(names).toContain("payment_methods_provider_pm_uq");
    expect(names).toContain("payment_methods_one_default_per_customer");
    expect(names).toContain("payment_methods_lookup_idx");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (2) Repository — insert + unique constraints + listing
// ═══════════════════════════════════════════════════════════════════════════

describe("paymentMethodsRepository — insert + uniqueness", () => {
  it("inserts a saved payment method row", async () => {
    const row = await db.transaction(async (tx) =>
      paymentMethodsRepository.createPaymentMethod(
        tx,
        baseInput({ providerPaymentMethodId: "pm_insert_1" }),
      ),
    );
    expect(row.id).toBeTruthy();
    expect(row.companyId).toBe(companyId);
    expect(row.customerCompanyId).toBe(customerCompanyAId);
    expect(row.cardBrand).toBe("visa");
    expect(row.cardLast4).toBe("4242");
    expect(row.detachedAt).toBeNull();
    expect(row.isDefault).toBe(false);
  });

  it("rejects duplicate (company, provider_source, provider_pm_id) — SQLSTATE 23505", async () => {
    await db.transaction(async (tx) =>
      paymentMethodsRepository.createPaymentMethod(
        tx,
        baseInput({ providerPaymentMethodId: "pm_dupe_1" }),
      ),
    );
    let err: unknown = null;
    try {
      await db.transaction(async (tx) =>
        paymentMethodsRepository.createPaymentMethod(
          tx,
          baseInput({
            providerPaymentMethodId: "pm_dupe_1",
            cardLast4: "0000",
          }),
        ),
      );
    } catch (e) {
      err = e;
    }
    expect(err).not.toBeNull();
    expect((err as { code?: string }).code).toBe("23505");
  });

  it("rejects two active defaults for the same customer_company — SQLSTATE 23505", async () => {
    // Insert two rows on the same customer-company.
    await db.transaction(async (tx) => {
      await paymentMethodsRepository.createPaymentMethod(
        tx,
        baseInput({
          providerPaymentMethodId: "pm_default_1",
          isDefault: true,
        }),
      );
    });

    let err: unknown = null;
    try {
      // Second row with isDefault=true while the first is still active.
      await db.transaction(async (tx) => {
        await paymentMethodsRepository.createPaymentMethod(
          tx,
          baseInput({
            providerPaymentMethodId: "pm_default_2",
            isDefault: true,
          }),
        );
      });
    } catch (e) {
      err = e;
    }
    expect(err).not.toBeNull();
    expect((err as { code?: string }).code).toBe("23505");
  });

  it("ALLOWS the same customer_company on a different tenant to have its own default", async () => {
    // Tenant B has its own customerCompany and own pm row with
    // is_default=true. Different tenant scope = different default
    // partial-unique row → no collision.
    await db.transaction(async (tx) => {
      await paymentMethodsRepository.createPaymentMethod(tx, {
        ...baseInput({
          providerPaymentMethodId: "pm_other_tenant_default",
          isDefault: true,
        }),
        companyId: otherCompanyId,
        customerCompanyId: otherCustomerCompanyId,
      });
    });
    const rows = await paymentMethodsRepository.listByCustomerCompany(
      otherCompanyId,
      otherCustomerCompanyId,
    );
    expect(rows.filter((r) => r.isDefault)).toHaveLength(1);
  });

  it("listByCustomerCompany is tenant-scoped (cross-tenant returns []) ", async () => {
    // Querying tenant A's customer-company id under tenant B's
    // companyId returns nothing.
    const rows = await paymentMethodsRepository.listByCustomerCompany(
      otherCompanyId,
      customerCompanyAId, // tenant A's customer_company
    );
    expect(rows).toEqual([]);
  });

  it("listByCustomerCompany excludes detached rows + sorts default first", async () => {
    const rows = await paymentMethodsRepository.listByCustomerCompany(
      companyId,
      customerCompanyAId,
    );
    // From the prior tests: pm_insert_1 (no default), pm_dupe_1 (no default),
    // pm_default_1 (DEFAULT). pm_default_2 was rejected. None are detached yet.
    expect(rows.length).toBeGreaterThanOrEqual(3);
    // Default first.
    expect(rows[0].isDefault).toBe(true);
    expect(rows[0].providerPaymentMethodId).toBe("pm_default_1");
    // Every row in the list belongs to the right tenant + customer-company
    // and is non-detached.
    for (const r of rows) {
      expect(r.companyId).toBe(companyId);
      expect(r.customerCompanyId).toBe(customerCompanyAId);
      expect(r.detachedAt).toBeNull();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (3) Repository — setDefault + markDetached
// ═══════════════════════════════════════════════════════════════════════════

describe("paymentMethodsRepository — setDefault + markDetached", () => {
  it("setDefault flips the flag + clears the previous default", async () => {
    // Find the current default (pm_default_1) and a non-default
    // (pm_insert_1) to flip into.
    const before = await paymentMethodsRepository.listByCustomerCompany(
      companyId,
      customerCompanyAId,
    );
    const oldDefault = before.find((r) => r.providerPaymentMethodId === "pm_default_1")!;
    const target = before.find((r) => r.providerPaymentMethodId === "pm_insert_1")!;
    expect(oldDefault.isDefault).toBe(true);
    expect(target.isDefault).toBe(false);

    await db.transaction(async (tx) =>
      paymentMethodsRepository.setDefault(tx, companyId, target.id),
    );

    const after = await paymentMethodsRepository.listByCustomerCompany(
      companyId,
      customerCompanyAId,
    );
    const newDefault = after.find((r) => r.id === target.id);
    const oldNow = after.find((r) => r.id === oldDefault.id);
    expect(newDefault?.isDefault).toBe(true);
    expect(oldNow?.isDefault).toBe(false);
    // Only one default remains.
    expect(after.filter((r) => r.isDefault)).toHaveLength(1);
  });

  it("setDefault on a detached row throws", async () => {
    // Detach a row first.
    const list = await paymentMethodsRepository.listByCustomerCompany(
      companyId,
      customerCompanyAId,
    );
    const dupeRow = list.find((r) => r.providerPaymentMethodId === "pm_dupe_1")!;
    await db.transaction(async (tx) =>
      paymentMethodsRepository.markDetached(tx, companyId, dupeRow.id, {
        reason: "test_detach",
      }),
    );
    // Now try to setDefault on the detached row.
    await expect(
      db.transaction(async (tx) =>
        paymentMethodsRepository.setDefault(tx, companyId, dupeRow.id),
      ),
    ).rejects.toThrow(/detached/i);
  });

  it("markDetached is idempotent (second call keeps original timestamp)", async () => {
    const list = await paymentMethodsRepository.listByCustomerCompany(
      companyId,
      customerCompanyAId,
    );
    // Pick any active row.
    const row = list[list.length - 1];
    expect(row).toBeTruthy();

    const first = await db.transaction(async (tx) =>
      paymentMethodsRepository.markDetached(tx, companyId, row.id, {
        reason: "first_detach",
      }),
    );
    const second = await db.transaction(async (tx) =>
      paymentMethodsRepository.markDetached(tx, companyId, row.id, {
        reason: "second_call_should_be_noop",
      }),
    );
    expect(first.detachedAt).toBeTruthy();
    expect(second.detachedAt?.getTime?.()).toBe(first.detachedAt?.getTime?.());
    expect(second.detachReason).toBe("first_detach");
  });

  it("markDetached clears is_default so a new default can be set", async () => {
    // Insert two rows on customerCompanyB, one default. Detach the
    // default. Setting a new default on the second row must succeed
    // (i.e. the partial unique index didn't get tripped by the
    // detached row still flagged as default).
    const cId = customerCompanyBId;
    const a = await db.transaction(async (tx) =>
      paymentMethodsRepository.createPaymentMethod(tx, {
        ...baseInput({
          providerPaymentMethodId: "pm_b_alpha",
          isDefault: true,
        }),
        customerCompanyId: cId,
      }),
    );
    const b = await db.transaction(async (tx) =>
      paymentMethodsRepository.createPaymentMethod(tx, {
        ...baseInput({ providerPaymentMethodId: "pm_b_bravo" }),
        customerCompanyId: cId,
      }),
    );

    await db.transaction(async (tx) =>
      paymentMethodsRepository.markDetached(tx, companyId, a.id, {
        reason: "rotating_card",
      }),
    );
    // Now b can be set default without 23505.
    await db.transaction(async (tx) =>
      paymentMethodsRepository.setDefault(tx, companyId, b.id),
    );
    const rows = await paymentMethodsRepository.listByCustomerCompany(
      companyId,
      cId,
    );
    expect(rows).toHaveLength(1); // a is detached + excluded
    expect(rows[0].id).toBe(b.id);
    expect(rows[0].isDefault).toBe(true);
  });

  it("getById returns null on cross-tenant access (no info leak)", async () => {
    const list = await paymentMethodsRepository.listByCustomerCompany(
      companyId,
      customerCompanyAId,
    );
    if (list.length === 0) return;
    const row = list[0];
    // Same id, wrong tenant.
    const result = await paymentMethodsRepository.getById(otherCompanyId, row.id);
    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (4) Resolver service — mock tests
// ═══════════════════════════════════════════════════════════════════════════
//
// The resolver service is integration-friendly but we test it with a
// mocked PaymentProvider so the suite doesn't hit Stripe. The DB IS
// real — that's where idempotency lives. After every mock test we
// clean up the persisted provider_customer_id so subsequent runs are
// idempotent.

vi.mock("../server/services/payments/providers/resolver", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../server/services/payments/providers/resolver")
  >();
  const stripeAdapter = {
    id: "stripe" as const,
    createCheckout: vi.fn(),
    createCheckoutSession: vi.fn(),
    createCustomer: vi.fn(),
    refundPayment: vi.fn(),
    verifyWebhook: vi.fn(),
  };
  return {
    ...actual,
    resolveForCompany: vi.fn(() => stripeAdapter as any),
    __testStripeAdapter: stripeAdapter,
  };
});

import { resolveOrCreateProviderCustomer } from "../server/services/customerCompanyPaymentService";
import * as resolverModule from "../server/services/payments/providers/resolver";

const stripeMock = (resolverModule as unknown as {
  __testStripeAdapter: { createCustomer: ReturnType<typeof vi.fn> };
}).__testStripeAdapter;

describe("resolveOrCreateProviderCustomer — idempotency", () => {
  let scratchCustomerCompanyId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Use a freshly-minted customer-company so each test starts clean.
    scratchCustomerCompanyId = uuidv4();
    const slug = scratchCustomerCompanyId.slice(0, 8);
    await db.insert(customerCompanies).values({
      id: scratchCustomerCompanyId,
      companyId,
      name: TEST_PREFIX + "scratch_" + slug,
      // Each scratch row needs a unique name_normalized — there's a
      // partial unique on (companyId, name_normalized) for active rows.
      nameNormalized: TEST_PREFIX + "scratch_" + slug,
    });
  });

  it("first call invokes provider.createCustomer and persists the id", async () => {
    stripeMock.createCustomer.mockResolvedValueOnce({
      providerId: "stripe",
      providerCustomerId: "cus_first_call",
    });

    const result = await resolveOrCreateProviderCustomer({
      companyId,
      customerCompanyId: scratchCustomerCompanyId,
      providerAccountId: "acct_test_1",
    });

    expect(stripeMock.createCustomer).toHaveBeenCalledTimes(1);
    expect(result.created).toBe(true);
    expect(result.providerCustomerId).toBe("cus_first_call");

    // Persisted on the row.
    const [row] = await db
      .select()
      .from(customerCompanies)
      .where(eq(customerCompanies.id, scratchCustomerCompanyId))
      .limit(1);
    expect(row.providerCustomerId).toBe("cus_first_call");
  });

  it("second call short-circuits — no provider call, returns persisted id", async () => {
    // First call mints.
    stripeMock.createCustomer.mockResolvedValueOnce({
      providerId: "stripe",
      providerCustomerId: "cus_second_call",
    });
    await resolveOrCreateProviderCustomer({
      companyId,
      customerCompanyId: scratchCustomerCompanyId,
      providerAccountId: "acct_test_1",
    });

    // Second call must NOT touch the provider.
    stripeMock.createCustomer.mockClear();
    const result = await resolveOrCreateProviderCustomer({
      companyId,
      customerCompanyId: scratchCustomerCompanyId,
      providerAccountId: "acct_test_1",
    });
    expect(stripeMock.createCustomer).not.toHaveBeenCalled();
    expect(result.created).toBe(false);
    expect(result.providerCustomerId).toBe("cus_second_call");
  });

  it("forwards canonical metadata to the provider adapter", async () => {
    stripeMock.createCustomer.mockResolvedValueOnce({
      providerId: "stripe",
      providerCustomerId: "cus_metadata_check",
    });
    await resolveOrCreateProviderCustomer({
      companyId,
      customerCompanyId: scratchCustomerCompanyId,
      providerAccountId: "acct_test_1",
    });
    const args = stripeMock.createCustomer.mock.calls[0][0];
    expect(args.metadata).toEqual({
      companyId,
      customerCompanyId: scratchCustomerCompanyId,
    });
    // Display name resolved from customer_companies.name (we set
    // a non-null name in the fixture).
    expect(typeof args.name).toBe("string");
    expect(args.name.length).toBeGreaterThan(0);
  });

  it("missing customer-company → 404, no provider call", async () => {
    const fakeId = uuidv4();
    await expect(
      resolveOrCreateProviderCustomer({
        companyId,
        customerCompanyId: fakeId,
        providerAccountId: "acct_test_1",
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(stripeMock.createCustomer).not.toHaveBeenCalled();
  });

  it("cross-tenant access → 404 (no info leak)", async () => {
    // tenant A's scratchCustomerCompanyId, asked for under tenant B.
    await expect(
      resolveOrCreateProviderCustomer({
        companyId: otherCompanyId,
        customerCompanyId: scratchCustomerCompanyId,
        providerAccountId: "acct_test_1",
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(stripeMock.createCustomer).not.toHaveBeenCalled();
  });

  it("provider without createCustomer → 501", async () => {
    // Temporarily swap the resolver's adapter for one that lacks
    // createCustomer.
    const original = (resolverModule as any).resolveForCompany;
    (resolverModule as any).resolveForCompany = vi.fn(() => ({
      id: "stripe",
      createCheckout: vi.fn(),
      refundPayment: vi.fn(),
      verifyWebhook: vi.fn(),
      // no createCustomer
    }));
    try {
      await expect(
        resolveOrCreateProviderCustomer({
          companyId,
          customerCompanyId: scratchCustomerCompanyId,
          providerAccountId: "acct_test_1",
        }),
      ).rejects.toMatchObject({ status: 501 });
    } finally {
      (resolverModule as any).resolveForCompany = original;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (5) Provider neutrality — source-grep guards
// ═══════════════════════════════════════════════════════════════════════════

describe("paymentMethods repo — provider neutrality", () => {
  const REPO_PATH = path.resolve(
    __dirname,
    "..",
    "server",
    "storage",
    "paymentMethods.ts",
  );
  const source = fs.readFileSync(REPO_PATH, "utf-8");

  it("does NOT import the Stripe SDK", () => {
    expect(source).not.toMatch(/from\s+"stripe"/);
    expect(source).not.toMatch(/import\s+Stripe/);
    expect(source).not.toMatch(/getStripeClient/);
  });

  it("does NOT import the Stripe adapter (or any specific adapter)", () => {
    expect(source).not.toMatch(/stripeAdapter/);
    expect(source).not.toMatch(/providers\/stripeAdapter/);
  });

  it("uses provider-neutral column names (provider_source / provider_*)", () => {
    // Sanity that the repo deals with `provider_*` columns, not
    // `stripe_*` ones — the migration + schema agree.
    expect(source).toMatch(/providerSource/);
    expect(source).toMatch(/providerPaymentMethodId/);
    expect(source).toMatch(/providerCustomerId/);
    expect(source).not.toMatch(/stripePaymentMethodId/);
    expect(source).not.toMatch(/stripeCustomerId/);
  });
});
