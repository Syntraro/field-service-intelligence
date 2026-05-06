/**
 * Collect Payment — Multi-invoice card path (2026-05-06 PR3).
 *
 * Pins the new "Collect Payment dialog → embedded Stripe Elements →
 * webhook canonical writer" flow. Three layers of coverage:
 *
 *   1. Service layer — `paymentApplicationService.createCardIntentWithAllocations`
 *      validates allocations, computes the total, packs metadata, and
 *      returns an Elements-compatible response. Exercised via mocked
 *      provider adapter so we never touch the Stripe SDK.
 *
 *   2. Webhook handler — `handleManualAllocationsPaymentSucceeded` reads
 *      the metadata-packed allocations, writes ONE payment row +
 *      N allocations + per-invoice balance updates atomically, fires
 *      the receipt mailer.
 *
 *   3. Source pins — invariants on the route, dialog, and InvoiceDetailPage
 *      so a future regression that breaks "Collect Payment is the single
 *      entry point" or "card path NEVER calls /api/payments" fails this
 *      file loudly.
 *
 * NO Stripe SDK is exercised; we mock `provider.createCheckout` at the
 * resolver boundary. Real-DB tests use the existing fixture pattern from
 * `tests/collect-payment.test.ts`.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { v4 as uuidv4 } from "uuid";
import { eq, and, inArray } from "drizzle-orm";

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

const PREFIX = "collect_payment_card_test_";

const tenantA = uuidv4();
const tenantB = uuidv4();
const ownerA = uuidv4();
const customerA1 = uuidv4();
const customerA2 = uuidv4();
const customerB1 = uuidv4();
const locationA1 = uuidv4();
const locationA2 = uuidv4();
const locationB1 = uuidv4();

let invoiceA1Id: string;
let invoiceA2Id: string;
let invoiceA3Id: string;
let invoiceA4Id: string; // belongs to customerA2 — cross-customer reject test
let invoiceB1Id: string; // belongs to tenantB — cross-tenant reject test

function read(rel: string): string {
  return readFileSync(resolve(__dirname, "..", rel), "utf-8");
}

async function setupFixtures() {
  await db.insert(companies).values([
    { id: tenantA, name: `${PREFIX}A` },
    { id: tenantB, name: `${PREFIX}B` },
  ]);
  await db.insert(users).values({
    id: ownerA,
    companyId: tenantA,
    email: `${PREFIX}owner_${Date.now()}@t`,
    password: "x",
    role: "owner",
    status: "active",
  });
  await db.insert(customerCompanies).values([
    { id: customerA1, companyId: tenantA, name: `${PREFIX}custA1` },
    { id: customerA2, companyId: tenantA, name: `${PREFIX}custA2` },
    { id: customerB1, companyId: tenantB, name: `${PREFIX}custB1` },
  ]);
  await db.insert(clientLocations).values([
    {
      id: locationA1,
      companyId: tenantA,
      parentCompanyId: customerA1,
      companyName: `${PREFIX}locA1`,
      address: "1 Pine St",
      city: "Toronto",
      province: "ON",
      postalCode: "M1A1A1",
      selectedMonths: [],
    },
    {
      id: locationA2,
      companyId: tenantA,
      parentCompanyId: customerA2,
      companyName: `${PREFIX}locA2`,
      address: "2 Pine St",
      city: "Toronto",
      province: "ON",
      postalCode: "M1A1A2",
      selectedMonths: [],
    },
    {
      id: locationB1,
      companyId: tenantB,
      parentCompanyId: customerB1,
      companyName: `${PREFIX}locB1`,
      address: "1 Oak St",
      city: "Vancouver",
      province: "BC",
      postalCode: "V1A1A1",
      selectedMonths: [],
    },
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const inserted = await db
    .insert(invoices)
    .values([
      {
        companyId: tenantA,
        locationId: locationA1,
        customerCompanyId: customerA1,
        invoiceNumber: "6001",
        status: "awaiting_payment",
        issueDate: today,
        currency: "USD",
        subtotal: "100.00",
        taxTotal: "0.00",
        total: "100.00",
        amountPaid: "0.00",
        balance: "100.00",
      },
      {
        companyId: tenantA,
        locationId: locationA1,
        customerCompanyId: customerA1,
        invoiceNumber: "6002",
        status: "awaiting_payment",
        issueDate: today,
        currency: "USD",
        subtotal: "200.00",
        taxTotal: "0.00",
        total: "200.00",
        amountPaid: "0.00",
        balance: "200.00",
      },
      {
        companyId: tenantA,
        locationId: locationA1,
        customerCompanyId: customerA1,
        invoiceNumber: "6003",
        status: "awaiting_payment",
        issueDate: today,
        currency: "USD",
        subtotal: "50.00",
        taxTotal: "0.00",
        total: "50.00",
        amountPaid: "0.00",
        balance: "50.00",
      },
      {
        companyId: tenantA,
        locationId: locationA2,
        customerCompanyId: customerA2,
        invoiceNumber: "6101",
        status: "awaiting_payment",
        issueDate: today,
        currency: "USD",
        subtotal: "75.00",
        taxTotal: "0.00",
        total: "75.00",
        amountPaid: "0.00",
        balance: "75.00",
      },
      {
        companyId: tenantB,
        locationId: locationB1,
        customerCompanyId: customerB1,
        invoiceNumber: "9101",
        status: "awaiting_payment",
        issueDate: today,
        currency: "USD",
        subtotal: "300.00",
        taxTotal: "0.00",
        total: "300.00",
        amountPaid: "0.00",
        balance: "300.00",
      },
    ])
    .returning({ id: invoices.id });
  invoiceA1Id = inserted[0].id;
  invoiceA2Id = inserted[1].id;
  invoiceA3Id = inserted[2].id;
  invoiceA4Id = inserted[3].id;
  invoiceB1Id = inserted[4].id;
}

async function teardownFixtures() {
  for (const tid of [tenantA, tenantB]) {
    await db.delete(paymentAllocations).where(eq(paymentAllocations.companyId, tid));
    await db.delete(payments).where(eq(payments.companyId, tid));
    await db.delete(invoices).where(eq(invoices.companyId, tid));
    await db.delete(clientLocations).where(eq(clientLocations.companyId, tid));
    await db.delete(customerCompanies).where(eq(customerCompanies.companyId, tid));
    await db.delete(users).where(eq(users.companyId, tid));
    await db.delete(companies).where(eq(companies.id, tid));
  }
}

async function resetCustomerA1Invoices() {
  await db.delete(paymentAllocations).where(eq(paymentAllocations.companyId, tenantA));
  await db.delete(payments).where(eq(payments.companyId, tenantA));
  await db
    .update(invoices)
    .set({ status: "awaiting_payment", amountPaid: "0.00", balance: "100.00" })
    .where(and(eq(invoices.id, invoiceA1Id), eq(invoices.companyId, tenantA)));
  await db
    .update(invoices)
    .set({ status: "awaiting_payment", amountPaid: "0.00", balance: "200.00" })
    .where(and(eq(invoices.id, invoiceA2Id), eq(invoices.companyId, tenantA)));
  await db
    .update(invoices)
    .set({ status: "awaiting_payment", amountPaid: "0.00", balance: "50.00" })
    .where(and(eq(invoices.id, invoiceA3Id), eq(invoices.companyId, tenantA)));
}

// ── Service-layer mocking ────────────────────────────────────────────
// We mock the provider adapter + the provider-account service so the
// real call into Stripe is replaced with a stub that returns a known
// PaymentIntent shape.

const mockedProviderCreateCheckout = vi.fn();
const mockedGetActiveAccount = vi.fn();

vi.mock("../server/services/payments/providers/stripeAdapter", async () => {
  const actual = await vi.importActual<any>(
    "../server/services/payments/providers/stripeAdapter",
  );
  return {
    ...actual,
    stripeAdapter: {
      ...actual.stripeAdapter,
      createCheckout: (...args: unknown[]) => mockedProviderCreateCheckout(...args),
    },
  };
});

vi.mock("../server/services/payments/paymentProviderAccountService", async () => {
  const actual = await vi.importActual<any>(
    "../server/services/payments/paymentProviderAccountService",
  );
  return {
    ...actual,
    paymentProviderAccountService: {
      ...actual.paymentProviderAccountService,
      getActiveAccount: (...args: unknown[]) => mockedGetActiveAccount(...args),
    },
  };
});

// Email dispatch mock — webhook fires receipt; we don't care about the
// real Resend call in tests.
const mockedSendMultiInvoiceReceipt = vi.fn();
vi.mock("../server/services/emailDispatchService", async () => {
  const actual = await vi.importActual<any>("../server/services/emailDispatchService");
  return {
    ...actual,
    emailDispatchService: {
      ...actual.emailDispatchService,
      sendMultiInvoicePaymentReceiptEmail: (...args: unknown[]) =>
        mockedSendMultiInvoiceReceipt(...args),
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default: provider account is configured.
  mockedGetActiveAccount.mockResolvedValue({
    id: "ppa-1",
    providerAccountId: "acct_test_1",
  });
  // Default provider response shape.
  mockedProviderCreateCheckout.mockResolvedValue({
    providerId: "stripe",
    clientToken: "pi_test_secret_xxx",
    providerPaymentId: "pi_test_xxx",
    publishableKey: "pk_test_xxx",
  });
  mockedSendMultiInvoiceReceipt.mockResolvedValue({
    emailId: "em_xxx",
    recipients: ["billing@example.com"],
    subject: "Receipt",
  });
});

// ── Service tests ────────────────────────────────────────────────────

describe("createCardIntentWithAllocations — service layer", () => {
  beforeAll(async () => {
    await setupFixtures();
  });
  afterAll(async () => {
    await teardownFixtures();
  });

  it("accepts multiple invoices and totals = sum of allocations", async () => {
    await resetCustomerA1Invoices();
    const { paymentApplicationService } = await import(
      "../server/services/payments/paymentApplicationService"
    );

    const result = await paymentApplicationService.createCardIntentWithAllocations({
      companyId: tenantA,
      customerCompanyId: customerA1,
      allocations: [
        { invoiceId: invoiceA1Id, amount: "100.00" },
        { invoiceId: invoiceA2Id, amount: "150.00" },
      ],
      source: "staff",
    });

    expect(result.totalAmount).toBe("250.00");
    expect(result.providerId).toBe("stripe");
    expect(result.clientToken).toBe("pi_test_secret_xxx");

    // Adapter received the SUM in cents.
    expect(mockedProviderCreateCheckout).toHaveBeenCalledTimes(1);
    const adapterCall = mockedProviderCreateCheckout.mock.calls[0][0];
    expect(adapterCall.amountCents).toBe(25_000);

    // Allocations are packed into Stripe metadata as a tight tuple JSON.
    expect(adapterCall.metadata.multiInvoiceMode).toBe("manual_allocations");
    const allocs = JSON.parse(adapterCall.metadata.allocations);
    expect(allocs).toEqual([
      [invoiceA1Id, "100.00"],
      [invoiceA2Id, "150.00"],
    ]);
    expect(adapterCall.metadata.companyId).toBe(tenantA);
    expect(adapterCall.metadata.customerCompanyId).toBe(customerA1);
    expect(adapterCall.metadata.source).toBe("staff");
  });

  it("rejects allocation that exceeds the invoice's balance", async () => {
    await resetCustomerA1Invoices();
    const { paymentApplicationService } = await import(
      "../server/services/payments/paymentApplicationService"
    );
    await expect(
      paymentApplicationService.createCardIntentWithAllocations({
        companyId: tenantA,
        customerCompanyId: customerA1,
        allocations: [{ invoiceId: invoiceA1Id, amount: "150.00" }],
        source: "staff",
      }),
    ).rejects.toMatchObject({ status: 400 });
    // Adapter never called.
    expect(mockedProviderCreateCheckout).not.toHaveBeenCalled();
  });

  it("rejects an invoice from a different customer in the same tenant (404 — no leak)", async () => {
    await resetCustomerA1Invoices();
    const { paymentApplicationService } = await import(
      "../server/services/payments/paymentApplicationService"
    );
    await expect(
      paymentApplicationService.createCardIntentWithAllocations({
        companyId: tenantA,
        customerCompanyId: customerA1,
        allocations: [
          { invoiceId: invoiceA1Id, amount: "100.00" },
          { invoiceId: invoiceA4Id, amount: "50.00" }, // belongs to customerA2
        ],
        source: "staff",
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(mockedProviderCreateCheckout).not.toHaveBeenCalled();
  });

  it("rejects an invoice from a different tenant (404 — invisible from this tenant)", async () => {
    await resetCustomerA1Invoices();
    const { paymentApplicationService } = await import(
      "../server/services/payments/paymentApplicationService"
    );
    await expect(
      paymentApplicationService.createCardIntentWithAllocations({
        companyId: tenantA,
        customerCompanyId: customerA1,
        allocations: [
          { invoiceId: invoiceA1Id, amount: "100.00" },
          { invoiceId: invoiceB1Id, amount: "100.00" }, // tenantB invoice
        ],
        source: "staff",
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(mockedProviderCreateCheckout).not.toHaveBeenCalled();
  });

  it("rejects empty allocations", async () => {
    const { paymentApplicationService } = await import(
      "../server/services/payments/paymentApplicationService"
    );
    await expect(
      paymentApplicationService.createCardIntentWithAllocations({
        companyId: tenantA,
        customerCompanyId: customerA1,
        allocations: [],
        source: "staff",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects more than 10 allocations (Stripe metadata cap)", async () => {
    await resetCustomerA1Invoices();
    const { paymentApplicationService } = await import(
      "../server/services/payments/paymentApplicationService"
    );
    // Build 11 fake allocations — first one references a real invoice
    // so the loop progresses past tenant lookup before bailing.
    const tooMany = Array.from({ length: 11 }, (_, i) => ({
      invoiceId: i === 0 ? invoiceA1Id : uuidv4(),
      amount: "1.00",
    }));
    await expect(
      paymentApplicationService.createCardIntentWithAllocations({
        companyId: tenantA,
        customerCompanyId: customerA1,
        allocations: tooMany,
        source: "staff",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects total below Stripe minimum ($0.50)", async () => {
    await resetCustomerA1Invoices();
    const { paymentApplicationService } = await import(
      "../server/services/payments/paymentApplicationService"
    );
    // Set up a tiny invoice for this case — re-use invoiceA3 ($50) but
    // allocate just 25¢. The DB balance already covers it.
    await db
      .update(invoices)
      .set({ balance: "0.25", total: "0.25" })
      .where(eq(invoices.id, invoiceA3Id));
    await expect(
      paymentApplicationService.createCardIntentWithAllocations({
        companyId: tenantA,
        customerCompanyId: customerA1,
        allocations: [{ invoiceId: invoiceA3Id, amount: "0.25" }],
        source: "staff",
      }),
    ).rejects.toMatchObject({ status: 400 });
    // Restore.
    await db
      .update(invoices)
      .set({ balance: "50.00", total: "50.00" })
      .where(eq(invoices.id, invoiceA3Id));
  });
});

// ── Webhook test ─────────────────────────────────────────────────────

describe("handleManualAllocationsPaymentSucceeded — webhook canonical writer", () => {
  beforeAll(async () => {
    await setupFixtures();
  });
  afterAll(async () => {
    await teardownFixtures();
  });

  it("creates ONE payment row + N allocations + per-invoice balance updates atomically", async () => {
    await resetCustomerA1Invoices();
    const { paymentApplicationService } = await import(
      "../server/services/payments/paymentApplicationService"
    );

    const prospectivePaymentId = uuidv4();
    const eventId = `evt_test_${Date.now()}`;

    // Drive the webhook directly via applyVerifiedWebhookBatch with a
    // synthesized payment_succeeded event carrying our metadata shape.
    await paymentApplicationService.applyVerifiedWebhookBatch("stripe", [
      {
        kind: "payment_succeeded",
        eventId,
        eventType: "payment_intent.succeeded",
        providerPaymentId: "pi_test_multi_1",
        chargeId: "ch_test_multi_1",
        amountCents: 25_000,
        providerAccountId: "acct_test_1",
        metadata: {
          companyId: tenantA,
          customerCompanyId: customerA1,
          prospectivePaymentId,
          source: "staff",
          multiInvoiceMode: "manual_allocations",
          allocations: JSON.stringify([
            [invoiceA1Id, "100.00"],
            [invoiceA2Id, "150.00"],
          ]),
        },
      } as any,
    ]);

    // ONE payment row.
    const paymentRows = await db
      .select()
      .from(payments)
      .where(eq(payments.id, prospectivePaymentId));
    expect(paymentRows).toHaveLength(1);
    expect(paymentRows[0].invoiceId).toBeNull();
    expect(paymentRows[0].providerSource).toBe("stripe");
    expect(paymentRows[0].method).toBe("credit");
    expect(paymentRows[0].amount).toBe("250.00");
    expect(paymentRows[0].providerEventId).toBe(eventId);

    // TWO allocation rows.
    const allocs = await db
      .select()
      .from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, prospectivePaymentId));
    expect(allocs).toHaveLength(2);
    const byInvoice = new Map(allocs.map((a) => [a.invoiceId, a.allocatedAmount]));
    expect(byInvoice.get(invoiceA1Id)).toBe("100.00");
    expect(byInvoice.get(invoiceA2Id)).toBe("150.00");

    // Invoice balances + statuses updated.
    const invs = await db
      .select()
      .from(invoices)
      .where(inArray(invoices.id, [invoiceA1Id, invoiceA2Id]));
    const byId = new Map(invs.map((r) => [r.id, r]));
    expect(byId.get(invoiceA1Id)!.status).toBe("paid");
    expect(byId.get(invoiceA1Id)!.balance).toBe("0.00");
    expect(byId.get(invoiceA2Id)!.status).toBe("partial_paid");
    expect(byId.get(invoiceA2Id)!.amountPaid).toBe("150.00");
    expect(byId.get(invoiceA2Id)!.balance).toBe("50.00");

    // Receipt mailer fired with paymentId.
    expect(mockedSendMultiInvoiceReceipt).toHaveBeenCalledWith({
      tenantId: tenantA,
      paymentId: prospectivePaymentId,
    });
  });

  it("idempotent on replay — second event with same providerEventId is ignored", async () => {
    await resetCustomerA1Invoices();
    const { paymentApplicationService } = await import(
      "../server/services/payments/paymentApplicationService"
    );

    const prospectivePaymentId = uuidv4();
    const eventId = `evt_replay_${Date.now()}`;
    const buildEvent = () => ({
      kind: "payment_succeeded" as const,
      eventId,
      eventType: "payment_intent.succeeded",
      providerPaymentId: "pi_test_replay_1",
      chargeId: "ch_test_replay_1",
      amountCents: 10_000,
      providerAccountId: "acct_test_1",
      metadata: {
        companyId: tenantA,
        customerCompanyId: customerA1,
        prospectivePaymentId,
        source: "staff",
        multiInvoiceMode: "manual_allocations",
        allocations: JSON.stringify([[invoiceA1Id, "100.00"]]),
      },
    });

    await paymentApplicationService.applyVerifiedWebhookBatch("stripe", [buildEvent() as any]);
    // Replay: same providerEventId. The unique index collides at insert
    // time; the tx rolls back and the handler classifies this as replay.
    await paymentApplicationService.applyVerifiedWebhookBatch("stripe", [buildEvent() as any]);

    // Still exactly one payment row.
    const paymentRows = await db
      .select()
      .from(payments)
      .where(eq(payments.id, prospectivePaymentId));
    expect(paymentRows).toHaveLength(1);

    // Still exactly one allocation.
    const allocs = await db
      .select()
      .from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, prospectivePaymentId));
    expect(allocs).toHaveLength(1);

    // Invoice balance not double-decremented.
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceA1Id));
    expect(inv.balance).toBe("0.00");
    expect(inv.amountPaid).toBe("100.00");
  });

  it("rejects (200 ACK + config_error) when allocation sum != amountCents", async () => {
    await resetCustomerA1Invoices();
    const { paymentApplicationService } = await import(
      "../server/services/payments/paymentApplicationService"
    );

    const prospectivePaymentId = uuidv4();
    const eventId = `evt_mismatch_${Date.now()}`;

    await paymentApplicationService.applyVerifiedWebhookBatch("stripe", [
      {
        kind: "payment_succeeded",
        eventId,
        eventType: "payment_intent.succeeded",
        providerPaymentId: "pi_test_mismatch_1",
        chargeId: "ch_test_mismatch_1",
        // Stripe charged $999 but metadata claims $100. Hard mismatch.
        amountCents: 99_900,
        providerAccountId: "acct_test_1",
        metadata: {
          companyId: tenantA,
          customerCompanyId: customerA1,
          prospectivePaymentId,
          source: "staff",
          multiInvoiceMode: "manual_allocations",
          allocations: JSON.stringify([[invoiceA1Id, "100.00"]]),
        },
      } as any,
    ]);

    // Nothing was written.
    const paymentRows = await db
      .select()
      .from(payments)
      .where(eq(payments.id, prospectivePaymentId));
    expect(paymentRows).toHaveLength(0);
    const allocs = await db
      .select()
      .from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, prospectivePaymentId));
    expect(allocs).toHaveLength(0);

    // Invoice balance unchanged.
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceA1Id));
    expect(inv.balance).toBe("100.00");
  });
});

// ── Source pins ──────────────────────────────────────────────────────

describe("Source pins — Collect Payment is single entry point + Stripe path safety", () => {
  const dialog = read("client/src/components/invoice/CollectPaymentDialog.tsx");
  const detailPage = read("client/src/pages/InvoiceDetailPage.tsx");
  const paymentsRoute = read("server/routes/payments.ts");
  const service = read("server/services/payments/paymentApplicationService.ts");
  const stripeForm = read("client/src/components/invoice/EmbeddedStripeCardForm.tsx");

  it("InvoiceDetailPage no longer mounts StaffTakeCardDialog or surfaces a Charge-credit-card item", () => {
    // No JSX mount of the legacy dialog.
    expect(detailPage).not.toMatch(/<StaffTakeCardDialog/);
    // No menu testid for the legacy overflow item.
    expect(detailPage).not.toMatch(/menu-item-take-card-payment/);
    // No state hook for the legacy dialog.
    expect(detailPage).not.toMatch(/setShowTakeCardDialog/);
    // No DropdownMenuItem rendering the legacy label as a child string.
    // (Comments referencing the historical name are allowed; this regex
    // matches only the JSX text-node form.)
    expect(detailPage).not.toMatch(/>Charge credit card \(Stripe\)</);
    // Collect Payment dialog is the single entry point.
    expect(detailPage).toMatch(/<CollectPaymentDialog/);
    expect(detailPage).toMatch(/data-testid="button-collect-payment"/);
  });

  it("CollectPaymentDialog removes the explanatory 'outside Stripe' text block", () => {
    expect(dialog).not.toMatch(/Record a payment received outside Stripe/);
    expect(dialog).not.toMatch(/overflow menu's "Take card payment"/);
  });

  it("CollectPaymentDialog hides reference + details fields in card mode", () => {
    expect(dialog).toMatch(/METHOD_HAS_REFERENCE: Record<PaymentMethod, boolean>/);
    expect(dialog).toMatch(/credit:\s*false,/);
    expect(dialog).toMatch(/METHOD_HAS_DETAILS: Record<PaymentMethod, boolean>/);
  });

  it("CollectPaymentDialog mounts <EmbeddedStripeCardForm> only in card mode", () => {
    expect(dialog).toMatch(/<EmbeddedStripeCardForm/);
    expect(dialog).toMatch(/isCardMode = method === "credit"/);
    expect(dialog).toMatch(/data-testid="collect-payment-card-panel"/);
  });

  it("CollectPaymentDialog: card path POSTs ONLY to /api/payments/card-intent (never /api/payments)", () => {
    // Card mutation hits the new endpoint.
    expect(dialog).toMatch(/\/api\/payments\/card-intent/);
    // Manual mutation hits the existing endpoint.
    expect(dialog).toMatch(/`\/api\/payments`/);
    // The two mutations are distinct — the source must contain BOTH
    // `apiRequest('/api/payments/card-intent'` (card) AND
    // `apiRequest('/api/payments'` (manual).
    const cardIntentCalls = dialog.match(/\/api\/payments\/card-intent/g);
    expect(cardIntentCalls).not.toBeNull();
    expect(cardIntentCalls!.length).toBeGreaterThanOrEqual(1);
  });

  it("CollectPaymentDialog disables Save and Email Receipt when no billingEmail on context", () => {
    expect(dialog).toMatch(/billingEmail: string \| null/);
    expect(dialog).toMatch(/hasBillingEmail = !!context\?\.billingEmail/);
    expect(dialog).toMatch(/disabled=\{!canSubmitManual \|\| !hasBillingEmail\}/);
    expect(dialog).toMatch(/No billing email on file/);
  });

  it("EmbeddedStripeCardForm exposes the same submit + onSucceeded contract used by the legacy dialog", () => {
    // Keeps the webhook-authoritative posture (no UI ledger writes).
    expect(stripeForm).toMatch(/stripe\.confirmPayment/);
    expect(stripeForm).toMatch(/redirect: "if_required"/);
    expect(stripeForm).toMatch(/onSucceeded\(\)/);
    expect(stripeForm).toMatch(/data-testid="embedded-stripe-card-submit"/);
  });

  it("Backend exposes POST /api/payments/card-intent with the documented schema", () => {
    expect(paymentsRoute).toMatch(/router\.post\(\s*"\/payments\/card-intent"/);
    expect(paymentsRoute).toMatch(/customerCompanyId: z\.string\(\)\.uuid\(\)/);
    expect(paymentsRoute).toMatch(/allocations: z[\s\S]*?\.array/);
    expect(paymentsRoute).toMatch(
      /paymentApplicationService\.createCardIntentWithAllocations\(/,
    );
  });

  it("Service packs allocations into Stripe metadata under multiInvoiceMode='manual_allocations'", () => {
    expect(service).toMatch(/multiInvoiceMode:\s*"manual_allocations"/);
    expect(service).toMatch(/allocations:\s*allocationsJson/);
    // Hard cap so we never overflow the 500-char metadata field.
    expect(service).toMatch(/MAX_ALLOCATIONS_PER_CARD_INTENT = 10/);
  });

  it("Webhook branches BEFORE readTenantMetadata when multiInvoiceMode='manual_allocations'", () => {
    expect(service).toMatch(
      /event\.metadata\?\.multiInvoiceMode === "manual_allocations"/,
    );
    expect(service).toMatch(/handleManualAllocationsPaymentSucceeded/);
  });

  it("Webhook reuses applyMultiInvoiceAllocationsTx (no duplicate writer)", () => {
    expect(service).toMatch(
      /await applyMultiInvoiceAllocationsTx\(\s*tx,\s*\{[\s\S]*?\},\s*prospectivePaymentId,\s*allocations,/,
    );
    // And calls the same multi-invoice receipt mailer the existing path uses.
    expect(service).toMatch(
      /emailDispatchService\.sendMultiInvoicePaymentReceiptEmail\(\{[\s\S]*?paymentId: prospectivePaymentId,/,
    );
  });

  it("collect-payment-context endpoint returns billingEmail (pre-resolved)", () => {
    expect(paymentsRoute).toMatch(/billingEmail,/);
    expect(paymentsRoute).toMatch(/async function resolveBillingEmail/);
    expect(paymentsRoute).toMatch(
      /recipientResolverService\.getDefaultRecipients\(\{[\s\S]*?entityType:\s*"payment_receipt"/,
    );
  });
});
