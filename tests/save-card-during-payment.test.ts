/**
 * Save card during payment — PR B regression suite (2026-05-03).
 *
 * Locks the spec contract:
 *   1. saveForFuture=true on the single-invoice path:
 *      - resolveOrCreateProviderCustomer is called
 *      - the adapter receives `providerCustomerId` + `setupFutureUsage`
 *      - the adapter receives consent metadata embedded in `metadata`
 *   2. saveForFuture=true on the multi-invoice (Checkout Session) path:
 *      - same resolver call
 *      - adapter receives the pair on createCheckoutSession
 *   3. saveForFuture=false (default):
 *      - resolver NEVER called
 *      - adapter receives NO customer / setup_future_usage / consent_*
 *   4. saveForFuture=true + missing consentText → 400
 *   5. payment_method.attached webhook handler:
 *      - happy path: writes a row via paymentMethodsRepository.createPaymentMethod
 *      - replay (23505) → classified as "replay"
 *      - unknown provider customer → "skipped"
 *      - no consent metadata → "skipped"
 *
 * Mock-style harness consistent with `payment-application-service.test.ts`
 * and `multi-invoice-payments.test.ts`. No real DB, no real Stripe.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (hoisted) ───────────────────────────────────────────────────────

vi.mock("../server/db", () => {
  const db = {
    select: vi.fn(),
    transaction: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  };
  return { db };
});

vi.mock("../server/storage/invoices", () => ({
  invoiceRepository: {
    getInvoice: vi.fn(),
  },
}));

vi.mock("../server/storage/payments", () => ({
  paymentRepository: {
    createPayment: vi.fn(),
    createRefund: vi.fn(),
    findByProviderReference: vi.fn(),
    assertRefundAmountWithinParent: vi.fn(),
  },
}));

vi.mock("../server/storage/paymentAllocations", () => ({
  paymentAllocationRepository: {
    createAllocations: vi.fn().mockResolvedValue([]),
    listByPayment: vi.fn().mockResolvedValue([]),
    listByInvoice: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../server/storage/paymentMethods", () => ({
  paymentMethodsRepository: {
    createPaymentMethod: vi.fn(),
    listByCustomerCompany: vi.fn(),
    setDefault: vi.fn(),
    markDetached: vi.fn(),
    getById: vi.fn(),
  },
}));

vi.mock("../server/services/customerCompanyPaymentService", () => ({
  resolveOrCreateProviderCustomer: vi.fn(),
  customerCompanyPaymentService: {
    resolveOrCreateProviderCustomer: vi.fn(),
  },
}));

vi.mock("../server/lib/invoicePredicates", () => ({
  canAcceptInvoicePayment: vi.fn(() => true),
  isInvoicePaid: vi.fn(() => false),
  isInvoiceVoided: vi.fn(() => false),
}));

vi.mock("../server/services/emailDispatchService", () => ({
  emailDispatchService: {
    sendPaymentReceiptEmail: vi.fn().mockResolvedValue(undefined),
    sendMultiInvoicePaymentReceiptEmail: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../server/storage/paymentWebhookEvents", () => ({
  buildDedupeKey: vi.fn(() => "test-dedupe-key"),
  safeRecordPaymentWebhookEvent: vi.fn().mockResolvedValue(undefined),
}));

// 2026-05-03 PR4 — paymentProviderAccountService is on the hot path
// for every checkout / multi-checkout / off-session call. Mock it so
// the tests don't need to seed a real `payment_provider_accounts` row.
vi.mock("../server/services/payments/paymentProviderAccountService", () => ({
  paymentProviderAccountService: {
    getActiveAccount: vi.fn(async () => ({
      id: "ppa_test_1",
      companyId: "co_1",
      provider: "stripe",
      providerAccountId: "acct_test_1",
      status: "active",
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      requirementsDue: null,
      disabledReason: null,
      country: "US",
      defaultCurrency: "usd",
    })),
    applyAccountUpdate: vi.fn(),
    normalizeAccountStatus: vi.fn(),
    getAccountSnapshot: vi.fn(),
    getOrCreateAccount: vi.fn(),
    createOnboardingLink: vi.fn(),
    retrieveAndSyncAccount: vi.fn(),
    markAccountStatus: vi.fn(),
  },
}));

vi.mock("../server/storage/paymentProviderAccounts", () => ({
  paymentProviderAccountsRepository: {
    getByProviderAndProviderAccountId: vi.fn(async () => null),
    getByCompanyAndProvider: vi.fn(async () => null),
    listByCompany: vi.fn(async () => []),
    insertAccount: vi.fn(),
    updateAccountState: vi.fn(),
  },
}));

vi.mock("../server/services/payments/providers/resolver", () => {
  const stripeAdapter = {
    id: "stripe" as const,
    createCheckout: vi.fn(),
    createCheckoutSession: vi.fn(),
    createCustomer: vi.fn(),
    refundPayment: vi.fn(),
    verifyWebhook: vi.fn(),
  };
  return {
    resolveForCompany: vi.fn(() => stripeAdapter),
    resolveForCompanyAsync: vi.fn(async () => stripeAdapter),
    resolveById: vi.fn((id: string) => (id === "stripe" ? stripeAdapter : null)),
    resolveForProviderSource: vi.fn(() => ({ manual: true })),
    __testStripeAdapter: stripeAdapter,
  };
});

// ─── Imports under test ────────────────────────────────────────────────────
import { paymentApplicationService } from "../server/services/payments/paymentApplicationService";
import { invoiceRepository } from "../server/storage/invoices";
import { resolveOrCreateProviderCustomer } from "../server/services/customerCompanyPaymentService";
import { paymentMethodsRepository } from "../server/storage/paymentMethods";
import { db } from "../server/db";
import * as resolverModule from "../server/services/payments/providers/resolver";

const stripeAdapter = (resolverModule as unknown as { __testStripeAdapter: any })
  .__testStripeAdapter;

// ─── Helpers ───────────────────────────────────────────────────────────────

function uniqueViolation(message = "duplicate key"): Error {
  return Object.assign(new Error(message), { code: "23505" });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: invoice is payable + has a balance + has a customer-company.
  (invoiceRepository.getInvoice as any).mockResolvedValue({
    id: "inv_a",
    companyId: "co_1",
    customerCompanyId: "cust_1",
    invoiceNumber: "1001",
    status: "awaiting_payment",
    balance: "100.00",
  });
  // Stripe single-invoice mock returns a clientToken + provider PI id.
  (stripeAdapter.createCheckout as any).mockResolvedValue({
    providerId: "stripe",
    clientToken: "pi_test_secret",
    providerPaymentId: "pi_test_1",
    publishableKey: "pk_test",
  });
  // Stripe multi-invoice mock returns a session URL.
  (stripeAdapter.createCheckoutSession as any).mockResolvedValue({
    providerId: "stripe",
    sessionId: "cs_test_1",
    checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_1",
    providerPaymentIntentId: "pi_test_session_1",
  });
  // Resolver returns a synthetic Stripe customer id.
  (resolveOrCreateProviderCustomer as any).mockResolvedValue({
    providerCustomerId: "cus_test_1",
    created: true,
    providerSource: "stripe",
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (1) Single-invoice — saveForFuture=true happy path
// ═══════════════════════════════════════════════════════════════════════════

describe("createCheckout — saveForFuture=true", () => {
  it("calls the resolver and forwards customer + setup_future_usage to the adapter", async () => {
    const result = await paymentApplicationService.createCheckout({
      companyId: "co_1",
      invoiceId: "inv_a",
      source: "portal",
      saveForFuture: true,
      consentText: "I authorize {COMPANY_NAME} to securely store this card.",
      consentIp: "127.0.0.1",
      consentUserAgent: "vitest",
      contactId: "contact_1",
    });

    // 1. Resolver invoked once with the canonical pair.
    //    2026-05-03 PR4: providerAccountId is now also forwarded so
    //    Stripe Connect mints the customer on the connected account.
    expect(resolveOrCreateProviderCustomer).toHaveBeenCalledTimes(1);
    expect(resolveOrCreateProviderCustomer).toHaveBeenCalledWith({
      companyId: "co_1",
      customerCompanyId: "cust_1",
      providerAccountId: "acct_test_1",
    });

    // 2. Adapter received the customer id + setup_future_usage on the
    //    same call as the existing arguments.
    expect(stripeAdapter.createCheckout).toHaveBeenCalledTimes(1);
    const adapterArgs = (stripeAdapter.createCheckout as any).mock.calls[0][0];
    expect(adapterArgs.providerCustomerId).toBe("cus_test_1");
    expect(adapterArgs.setupFutureUsage).toBe("off_session");

    // 3. Adapter metadata carries consent context the webhook will
    //    read back from the PaymentIntent.
    expect(adapterArgs.metadata.consent_text).toBe(
      "I authorize {COMPANY_NAME} to securely store this card.",
    );
    expect(adapterArgs.metadata.consent_ip).toBe("127.0.0.1");
    expect(adapterArgs.metadata.consent_user_agent).toBe("vitest");
    expect(adapterArgs.metadata.created_by_contact_id).toBe("contact_1");

    // The function still returns the canonical CheckoutResponse.
    expect(result.providerPaymentId).toBe("pi_test_1");
    expect(result.clientToken).toBe("pi_test_secret");
    expect(typeof result.prospectivePaymentId).toBe("string");
  });

  it("rejects (400) when saveForFuture=true but consentText is missing — no resolver / no provider call", async () => {
    await expect(
      paymentApplicationService.createCheckout({
        companyId: "co_1",
        invoiceId: "inv_a",
        source: "portal",
        saveForFuture: true,
        // consentText omitted
      }),
    ).rejects.toMatchObject({ status: 400 });

    expect(resolveOrCreateProviderCustomer).not.toHaveBeenCalled();
    expect(stripeAdapter.createCheckout).not.toHaveBeenCalled();
  });

  it("rejects (400) when consentText is present but only whitespace", async () => {
    await expect(
      paymentApplicationService.createCheckout({
        companyId: "co_1",
        invoiceId: "inv_a",
        source: "portal",
        saveForFuture: true,
        consentText: "   ",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects (400) when the invoice has no customerCompanyId", async () => {
    (invoiceRepository.getInvoice as any).mockResolvedValueOnce({
      id: "inv_orphan",
      companyId: "co_1",
      customerCompanyId: null,
      status: "awaiting_payment",
      balance: "10.00",
    });
    await expect(
      paymentApplicationService.createCheckout({
        companyId: "co_1",
        invoiceId: "inv_orphan",
        source: "portal",
        saveForFuture: true,
        consentText: "I authorize.",
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(resolveOrCreateProviderCustomer).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (2) Single-invoice — saveForFuture=false (default) preserved
// ═══════════════════════════════════════════════════════════════════════════

describe("createCheckout — saveForFuture=false / omitted", () => {
  it("does NOT call the resolver and does NOT forward customer / setup_future_usage", async () => {
    await paymentApplicationService.createCheckout({
      companyId: "co_1",
      invoiceId: "inv_a",
      source: "portal",
    });

    expect(resolveOrCreateProviderCustomer).not.toHaveBeenCalled();

    const adapterArgs = (stripeAdapter.createCheckout as any).mock.calls[0][0];
    expect(adapterArgs.providerCustomerId).toBeUndefined();
    expect(adapterArgs.setupFutureUsage).toBeUndefined();
    // No consent metadata leaks when the customer didn't opt in.
    expect(adapterArgs.metadata.consent_text).toBeUndefined();
    expect(adapterArgs.metadata.consent_ip).toBeUndefined();
    expect(adapterArgs.metadata.consent_user_agent).toBeUndefined();
    expect(adapterArgs.metadata.created_by_contact_id).toBeUndefined();
  });

  it("explicit saveForFuture=false behaves identically to omitting the flag", async () => {
    await paymentApplicationService.createCheckout({
      companyId: "co_1",
      invoiceId: "inv_a",
      source: "portal",
      saveForFuture: false,
      // consentText present but ignored — opt-out wins.
      consentText: "Should be ignored.",
    });
    expect(resolveOrCreateProviderCustomer).not.toHaveBeenCalled();
    const adapterArgs = (stripeAdapter.createCheckout as any).mock.calls[0][0];
    expect(adapterArgs.providerCustomerId).toBeUndefined();
    expect(adapterArgs.metadata.consent_text).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (3) Multi-invoice — saveForFuture=true happy path + opt-out
// ═══════════════════════════════════════════════════════════════════════════

describe("createMultiCheckout — saveForFuture", () => {
  beforeEach(() => {
    // The invoiceRepository.getInvoice mock is per-invoice — for batch
    // we need it to return distinct rows for different ids.
    (invoiceRepository.getInvoice as any).mockImplementation(
      async (_companyId: string, invoiceId: string) => ({
        id: invoiceId,
        companyId: "co_1",
        customerCompanyId: "cust_1",
        invoiceNumber: "1001",
        status: "awaiting_payment",
        balance: "100.00",
      }),
    );
  });

  it("saveForFuture=true: resolver called, adapter receives customer + setup_future_usage", async () => {
    await paymentApplicationService.createMultiCheckout({
      companyId: "co_1",
      customerCompanyId: "cust_1",
      invoiceIds: ["inv_a", "inv_b"],
      source: "portal",
      successUrl: "https://app/done",
      cancelUrl: "https://app/cancel",
      saveForFuture: true,
      consentText: "I authorize.",
      consentIp: "10.0.0.1",
      consentUserAgent: "vitest-batch",
      contactId: "contact_2",
    });

    expect(resolveOrCreateProviderCustomer).toHaveBeenCalledTimes(1);
    expect(resolveOrCreateProviderCustomer).toHaveBeenCalledWith({
      companyId: "co_1",
      customerCompanyId: "cust_1",
      providerAccountId: "acct_test_1",
    });

    expect(stripeAdapter.createCheckoutSession).toHaveBeenCalledTimes(1);
    const sessArgs = (stripeAdapter.createCheckoutSession as any).mock.calls[0][0];
    expect(sessArgs.providerCustomerId).toBe("cus_test_1");
    expect(sessArgs.setupFutureUsage).toBe("off_session");
    expect(sessArgs.metadata.consent_text).toBe("I authorize.");
    expect(sessArgs.metadata.consent_ip).toBe("10.0.0.1");
    expect(sessArgs.metadata.consent_user_agent).toBe("vitest-batch");
    expect(sessArgs.metadata.created_by_contact_id).toBe("contact_2");
  });

  it("saveForFuture=false: no resolver, no customer / setup_future_usage on session call", async () => {
    await paymentApplicationService.createMultiCheckout({
      companyId: "co_1",
      customerCompanyId: "cust_1",
      invoiceIds: ["inv_a"],
      source: "portal",
      successUrl: "x",
      cancelUrl: "y",
    });
    expect(resolveOrCreateProviderCustomer).not.toHaveBeenCalled();
    const sessArgs = (stripeAdapter.createCheckoutSession as any).mock.calls[0][0];
    expect(sessArgs.providerCustomerId).toBeUndefined();
    expect(sessArgs.setupFutureUsage).toBeUndefined();
    expect(sessArgs.metadata.consent_text).toBeUndefined();
  });

  it("saveForFuture=true without consentText → 400, no resolver / no provider call", async () => {
    await expect(
      paymentApplicationService.createMultiCheckout({
        companyId: "co_1",
        customerCompanyId: "cust_1",
        invoiceIds: ["inv_a"],
        source: "portal",
        successUrl: "x",
        cancelUrl: "y",
        saveForFuture: true,
      }),
    ).rejects.toMatchObject({ status: 400 });

    expect(resolveOrCreateProviderCustomer).not.toHaveBeenCalled();
    expect(stripeAdapter.createCheckoutSession).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (4) Webhook — payment_method_attached
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Stub `db.select(...).from(...).where(...).limit(1)` to return a
 * canned customer-companies row. The webhook handler walks this chain
 * exactly once per event.
 */
function setOwnerLookup(row: { id: string; companyId: string } | null) {
  const result = row ? [row] : [];
  const limit = vi.fn().mockResolvedValue(result);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  (db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ from });
}

describe("payment_method_attached webhook handler", () => {
  const baseEvent = {
    kind: "payment_method_attached" as const,
    eventId: "evt_pm_attach_1",
    eventType: "payment_method.attached",
    providerCustomerId: "cus_pm_test_1",
    paymentMethodId: "pm_test_1",
    cardBrand: "visa",
    cardLast4: "4242",
    cardExpMonth: 12,
    cardExpYear: 2030,
    cardFunding: "credit" as string | null,
    cardCountry: "US" as string | null,
    consent: {
      text: "I authorize {COMPANY_NAME} to securely store this card.",
      ip: "127.0.0.1",
      userAgent: "vitest",
      contactId: "contact_pm_1",
    },
  };

  it("happy path: looks up tenant by provider_customer_id + writes the row", async () => {
    setOwnerLookup({ id: "cust_owned", companyId: "co_owned" });
    (db.transaction as any).mockImplementation(async (fn: any) => fn({} as any));
    (paymentMethodsRepository.createPaymentMethod as any).mockResolvedValueOnce({
      id: "pm_row_1",
    });

    const result = await paymentApplicationService.applyVerifiedWebhookBatch(
      "stripe",
      [baseEvent],
    );
    expect(result.accepted).toHaveLength(1);
    expect(result.replayed).toHaveLength(0);
    expect(result.failed).toHaveLength(0);

    expect(paymentMethodsRepository.createPaymentMethod).toHaveBeenCalledTimes(1);
    const args = (paymentMethodsRepository.createPaymentMethod as any).mock.calls[0][1];
    expect(args).toMatchObject({
      companyId: "co_owned",
      customerCompanyId: "cust_owned",
      providerSource: "stripe",
      providerCustomerId: "cus_pm_test_1",
      providerPaymentMethodId: "pm_test_1",
      cardBrand: "visa",
      cardLast4: "4242",
      cardExpMonth: 12,
      cardExpYear: 2030,
      cardFunding: "credit",
      cardCountry: "US",
      consentText: "I authorize {COMPANY_NAME} to securely store this card.",
      consentIp: "127.0.0.1",
      consentUserAgent: "vitest",
      createdByContactId: "contact_pm_1",
    });
    // consentAt is server-stamped at webhook time.
    expect(args.consentAt).toBeInstanceOf(Date);
  });

  it("replay (UNIQUE 23505 on insert) is classified as 'replayed' — no second row written", async () => {
    setOwnerLookup({ id: "cust_owned", companyId: "co_owned" });
    (db.transaction as any).mockImplementation(async (fn: any) => fn({} as any));
    (paymentMethodsRepository.createPaymentMethod as any).mockRejectedValueOnce(
      uniqueViolation(),
    );

    const result = await paymentApplicationService.applyVerifiedWebhookBatch(
      "stripe",
      [baseEvent],
    );
    expect(result.replayed).toHaveLength(1);
    expect(result.accepted).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });

  it("unknown provider_customer_id → 'ignored' (skipped) — no insert attempted", async () => {
    setOwnerLookup(null);
    (db.transaction as any).mockImplementation(async (fn: any) => fn({} as any));

    const result = await paymentApplicationService.applyVerifiedWebhookBatch(
      "stripe",
      [baseEvent],
    );
    expect(result.ignored).toHaveLength(1);
    expect(result.accepted).toHaveLength(0);
    expect(paymentMethodsRepository.createPaymentMethod).not.toHaveBeenCalled();
  });

  it("no consent metadata → 'ignored' (skipped) — no DB read, no insert", async () => {
    const evWithoutConsent = { ...baseEvent, consent: null };
    const result = await paymentApplicationService.applyVerifiedWebhookBatch(
      "stripe",
      [evWithoutConsent],
    );
    expect(result.ignored).toHaveLength(1);
    expect(result.accepted).toHaveLength(0);
    expect(paymentMethodsRepository.createPaymentMethod).not.toHaveBeenCalled();
  });

  it("transient error (non-unique) bubbles up as WebhookTransientFailure", async () => {
    setOwnerLookup({ id: "cust_owned", companyId: "co_owned" });
    (db.transaction as any).mockImplementation(async (fn: any) => fn({} as any));
    (paymentMethodsRepository.createPaymentMethod as any).mockRejectedValueOnce(
      new Error("connection terminated"),
    );

    await expect(
      paymentApplicationService.applyVerifiedWebhookBatch("stripe", [baseEvent]),
    ).rejects.toMatchObject({ name: "WebhookTransientFailure" });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (5) Source-grep regression — adapter forwards the canonical params
// ═══════════════════════════════════════════════════════════════════════════
//
// Verify the Stripe adapter wires `customer` + `setup_future_usage` on
// both PI and Session paths. Source-grep style consistent with the
// portal-invoice-visibility test.

import * as fs from "node:fs";
import * as path from "node:path";

describe("stripeAdapter — source-level forwards", () => {
  const ADAPTER_PATH = path.resolve(
    __dirname,
    "..",
    "server",
    "services",
    "payments",
    "providers",
    "stripeAdapter.ts",
  );
  const source = fs.readFileSync(ADAPTER_PATH, "utf-8");

  it("createCheckout forwards customer + setup_future_usage when set", () => {
    expect(source).toMatch(/params\.customer\s*=\s*input\.providerCustomerId/);
    expect(source).toMatch(/params\.setup_future_usage\s*=\s*input\.setupFutureUsage/);
  });

  it("createCheckoutSession forwards customer + payment_intent_data.setup_future_usage", () => {
    expect(source).toMatch(/sessionParams\.customer\s*=\s*input\.providerCustomerId/);
    expect(source).toMatch(/setup_future_usage:\s*input\.setupFutureUsage/);
  });

  it("verifyWebhook handles payment_method.attached", () => {
    expect(source).toMatch(/case\s+"payment_method\.attached"/);
    expect(source).toMatch(/kind:\s*"payment_method_attached"/);
  });
});
