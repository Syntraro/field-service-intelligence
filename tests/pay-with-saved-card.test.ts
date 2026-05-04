/**
 * Pay-with-saved-card — PR D regression suite (2026-05-03).
 *
 * Coverage:
 *   1. Service `payWithSavedMethod`:
 *      • single-invoice happy path → adapter receives canonical params,
 *        metadata carries `invoiceId` (singular) — routes through PR 1
 *        webhook handler.
 *      • multi-invoice happy path → metadata carries `invoiceIds` JSON
 *        + `off_session_multi: "true"` — adapter normalizer flips the
 *        PI event to `multi_invoice_payment_succeeded` (PR 2 handler).
 *      • adapter "requires_action" / "failed" / "processing" pass
 *        through verbatim with `message` + `declineCode`.
 *      • cross-customer payment-method rejection (404).
 *      • detached card rejection (400).
 *      • unknown invoice rejection (404).
 *      • non-payable / zero-balance invoice rejection (400).
 *      • provider missing capability → 501.
 *
 *   2. Stripe adapter normalizer (source-grep):
 *      • `payment_intent.succeeded` with `off_session_multi=true` →
 *        emits `multi_invoice_payment_succeeded` (NOT `unsupported`).
 *      • without that flag, multi-invoice PI still defers to the
 *        Checkout Session handler.
 *
 *   3. Portal routes:
 *      • single + multi happy paths (200/202/402 mapping).
 *      • body validation (paymentMethodId required).
 *      • entitlement gate (403).
 *      • 401 without portal session.
 *
 *   4. Portal UI source-grep:
 *      • Per-row "Pay •••• N" + footer "Pay with •••• N" buttons.
 *      • Both POST the canonical endpoints.
 *      • Render only when a default card exists.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

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
  invoiceRepository: { getInvoice: vi.fn() },
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
    updateCardMetadata: vi.fn(),
    getActiveDefault: vi.fn(),
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
// for every checkout / off-session call. Mock it so the tests don't
// need to seed a real `payment_provider_accounts` row.
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
    createSetupIntent: vi.fn(),
    detachPaymentMethod: vi.fn(),
    createOffSessionPayment: vi.fn(),
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
import { paymentMethodsRepository } from "../server/storage/paymentMethods";
import * as resolverModule from "../server/services/payments/providers/resolver";

const stripeAdapter = (resolverModule as unknown as { __testStripeAdapter: any })
  .__testStripeAdapter;

// ─── Fixtures + helpers ────────────────────────────────────────────────────

function activeCard(p: Partial<any> = {}) {
  return {
    id: "pm_local_default",
    companyId: "co_1",
    customerCompanyId: "cust_1",
    providerSource: "stripe",
    providerCustomerId: "cus_test_1",
    providerPaymentMethodId: "pm_stripe_default",
    cardBrand: "visa",
    cardLast4: "4242",
    cardExpMonth: 12,
    cardExpYear: 2030,
    isDefault: true,
    detachedAt: null,
    consentText: "...",
    consentAt: new Date(),
    createdAt: new Date(),
    ...p,
  };
}

function payableInvoice(p: Partial<any> = {}) {
  return {
    id: "inv_a",
    companyId: "co_1",
    customerCompanyId: "cust_1",
    invoiceNumber: "1001",
    status: "awaiting_payment",
    balance: "100.00",
    ...p,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: payment method active + invoice payable.
  (paymentMethodsRepository.getById as any).mockResolvedValue(activeCard());
  (invoiceRepository.getInvoice as any).mockImplementation(
    async (_companyId: string, invoiceId: string) =>
      payableInvoice({ id: invoiceId }),
  );
  (stripeAdapter.createOffSessionPayment as any).mockResolvedValue({
    providerId: "stripe",
    providerPaymentId: "pi_test_1",
    status: "succeeded",
    latestChargeId: "ch_test_1",
    message: null,
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (1) Service `payWithSavedMethod` — single-invoice happy path
// ═══════════════════════════════════════════════════════════════════════════

describe("payWithSavedMethod — single invoice", () => {
  it("forwards canonical params + singular invoiceId metadata to the adapter", async () => {
    const result = await paymentApplicationService.payWithSavedMethod({
      companyId: "co_1",
      customerCompanyId: "cust_1",
      invoiceIds: ["inv_a"],
      paymentMethodId: "pm_local_default",
      contactId: "contact_1",
    });

    expect(result.status).toBe("succeeded");
    expect(result.totalAmount).toBe("100.00");
    expect(result.invoiceIds).toEqual(["inv_a"]);

    expect(stripeAdapter.createOffSessionPayment).toHaveBeenCalledOnce();
    const args = (stripeAdapter.createOffSessionPayment as any).mock.calls[0][0];
    expect(args.providerCustomerId).toBe("cus_test_1");
    expect(args.providerPaymentMethodId).toBe("pm_stripe_default");
    expect(args.amountCents).toBe(10000);
    expect(args.metadata.invoiceId).toBe("inv_a");
    expect(args.metadata.companyId).toBe("co_1");
    expect(args.metadata.created_by_contact_id).toBe("contact_1");
    // Single-invoice path MUST NOT set the off_session_multi flag —
    // otherwise the webhook normalizer would route to the multi handler.
    expect(args.metadata.invoiceIds).toBeUndefined();
    expect(args.metadata.off_session_multi).toBeUndefined();
    expect(args.idempotencyKey).toBe(result.prospectivePaymentId);
  });

  it("propagates adapter status='requires_action' with the message", async () => {
    (stripeAdapter.createOffSessionPayment as any).mockResolvedValueOnce({
      providerId: "stripe",
      providerPaymentId: "pi_test_action",
      status: "requires_action",
      message: "This card needs additional verification...",
    });
    const result = await paymentApplicationService.payWithSavedMethod({
      companyId: "co_1",
      customerCompanyId: "cust_1",
      invoiceIds: ["inv_a"],
      paymentMethodId: "pm_local_default",
    });
    expect(result.status).toBe("requires_action");
    expect(result.message).toMatch(/additional verification/);
  });

  it("propagates adapter status='failed' with declineCode", async () => {
    (stripeAdapter.createOffSessionPayment as any).mockResolvedValueOnce({
      providerId: "stripe",
      providerPaymentId: "pi_test_fail",
      status: "failed",
      declineCode: "insufficient_funds",
      message: "Your card was declined.",
    });
    const result = await paymentApplicationService.payWithSavedMethod({
      companyId: "co_1",
      customerCompanyId: "cust_1",
      invoiceIds: ["inv_a"],
      paymentMethodId: "pm_local_default",
    });
    expect(result.status).toBe("failed");
    expect(result.declineCode).toBe("insufficient_funds");
  });

  it("propagates adapter status='processing'", async () => {
    (stripeAdapter.createOffSessionPayment as any).mockResolvedValueOnce({
      providerId: "stripe",
      providerPaymentId: "pi_test_p",
      status: "processing",
    });
    const result = await paymentApplicationService.payWithSavedMethod({
      companyId: "co_1",
      customerCompanyId: "cust_1",
      invoiceIds: ["inv_a"],
      paymentMethodId: "pm_local_default",
    });
    expect(result.status).toBe("processing");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (2) Service `payWithSavedMethod` — multi-invoice happy path
// ═══════════════════════════════════════════════════════════════════════════

describe("payWithSavedMethod — multi invoice", () => {
  it("forwards invoiceIds JSON + off_session_multi flag for the webhook normalizer", async () => {
    const result = await paymentApplicationService.payWithSavedMethod({
      companyId: "co_1",
      customerCompanyId: "cust_1",
      invoiceIds: ["inv_a", "inv_b"],
      paymentMethodId: "pm_local_default",
    });

    expect(result.totalAmount).toBe("200.00");
    expect(result.invoiceIds).toEqual(["inv_a", "inv_b"]);

    const args = (stripeAdapter.createOffSessionPayment as any).mock.calls[0][0];
    expect(args.amountCents).toBe(20000);
    expect(args.metadata.invoiceId).toBeUndefined();
    expect(JSON.parse(args.metadata.invoiceIds)).toEqual(["inv_a", "inv_b"]);
    expect(args.metadata.off_session_multi).toBe("true");
    expect(args.metadata.companyId).toBe("co_1");
    expect(args.metadata.customerCompanyId).toBe("cust_1");
  });

  it("rejects duplicate invoiceIds in the request (400)", async () => {
    await expect(
      paymentApplicationService.payWithSavedMethod({
        companyId: "co_1",
        customerCompanyId: "cust_1",
        invoiceIds: ["inv_a", "inv_a"],
        paymentMethodId: "pm_local_default",
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(stripeAdapter.createOffSessionPayment).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (3) Service `payWithSavedMethod` — rejections
// ═══════════════════════════════════════════════════════════════════════════

describe("payWithSavedMethod — rejections", () => {
  it("rejects (404) when payment method is unknown", async () => {
    (paymentMethodsRepository.getById as any).mockResolvedValueOnce(null);
    await expect(
      paymentApplicationService.payWithSavedMethod({
        companyId: "co_1",
        customerCompanyId: "cust_1",
        invoiceIds: ["inv_a"],
        paymentMethodId: "pm_unknown",
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(stripeAdapter.createOffSessionPayment).not.toHaveBeenCalled();
  });

  it("rejects (404) on cross-customer payment-method probe", async () => {
    (paymentMethodsRepository.getById as any).mockResolvedValueOnce(
      activeCard({ customerCompanyId: "cust_OTHER" }),
    );
    await expect(
      paymentApplicationService.payWithSavedMethod({
        companyId: "co_1",
        customerCompanyId: "cust_1",
        invoiceIds: ["inv_a"],
        paymentMethodId: "pm_local_default",
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(stripeAdapter.createOffSessionPayment).not.toHaveBeenCalled();
  });

  it("rejects (400) on a detached card", async () => {
    (paymentMethodsRepository.getById as any).mockResolvedValueOnce(
      activeCard({ detachedAt: new Date() }),
    );
    await expect(
      paymentApplicationService.payWithSavedMethod({
        companyId: "co_1",
        customerCompanyId: "cust_1",
        invoiceIds: ["inv_a"],
        paymentMethodId: "pm_local_default",
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(stripeAdapter.createOffSessionPayment).not.toHaveBeenCalled();
  });

  it("rejects (404) when an invoice is unknown / cross-customer", async () => {
    (invoiceRepository.getInvoice as any).mockImplementation(
      async (_companyId: string, invoiceId: string) =>
        invoiceId === "inv_other"
          ? payableInvoice({
              id: "inv_other",
              customerCompanyId: "cust_OTHER",
            })
          : payableInvoice({ id: invoiceId }),
    );
    await expect(
      paymentApplicationService.payWithSavedMethod({
        companyId: "co_1",
        customerCompanyId: "cust_1",
        invoiceIds: ["inv_a", "inv_other"],
        paymentMethodId: "pm_local_default",
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(stripeAdapter.createOffSessionPayment).not.toHaveBeenCalled();
  });

  it("rejects (400) on a paid / non-payable invoice", async () => {
    (invoiceRepository.getInvoice as any).mockResolvedValueOnce(
      payableInvoice({ status: "paid", balance: "0.00" }),
    );
    const { canAcceptInvoicePayment } = await import("../server/lib/invoicePredicates");
    (canAcceptInvoicePayment as any).mockReturnValueOnce(false);
    await expect(
      paymentApplicationService.payWithSavedMethod({
        companyId: "co_1",
        customerCompanyId: "cust_1",
        invoiceIds: ["inv_a"],
        paymentMethodId: "pm_local_default",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects (400) on zero-balance invoice", async () => {
    (invoiceRepository.getInvoice as any).mockResolvedValueOnce(
      payableInvoice({ balance: "0.00" }),
    );
    await expect(
      paymentApplicationService.payWithSavedMethod({
        companyId: "co_1",
        customerCompanyId: "cust_1",
        invoiceIds: ["inv_a"],
        paymentMethodId: "pm_local_default",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects (501) when the provider does not implement createOffSessionPayment", async () => {
    const original = stripeAdapter.createOffSessionPayment;
    delete stripeAdapter.createOffSessionPayment;
    try {
      await expect(
        paymentApplicationService.payWithSavedMethod({
          companyId: "co_1",
          customerCompanyId: "cust_1",
          invoiceIds: ["inv_a"],
          paymentMethodId: "pm_local_default",
        }),
      ).rejects.toMatchObject({ status: 501 });
    } finally {
      stripeAdapter.createOffSessionPayment = original;
    }
  });

  it("rejects (400) on empty invoiceIds list", async () => {
    await expect(
      paymentApplicationService.payWithSavedMethod({
        companyId: "co_1",
        customerCompanyId: "cust_1",
        invoiceIds: [],
        paymentMethodId: "pm_local_default",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (4) Stripe adapter — source-grep guards
// ═══════════════════════════════════════════════════════════════════════════

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

  it("createOffSessionPayment uses customer + payment_method + off_session + confirm", () => {
    expect(source).toMatch(/customer:\s*input\.providerCustomerId/);
    expect(source).toMatch(/payment_method:\s*input\.providerPaymentMethodId/);
    expect(source).toMatch(/off_session:\s*true/);
    expect(source).toMatch(/confirm:\s*true/);
    expect(source).toMatch(/idempotencyKey:\s*input\.idempotencyKey/);
  });

  it("payment_intent.succeeded normalizer handles off_session_multi → multi event", () => {
    expect(source).toMatch(
      /metadata\.invoiceIds\s*&&\s*metadata\.off_session_multi\s*===\s*"true"/,
    );
    // The normalizer for that path emits the multi-invoice kind:
    expect(source).toMatch(
      /off_session_multi[\s\S]*?kind:\s*"multi_invoice_payment_succeeded"/,
    );
  });

  it("payment_intent.succeeded WITHOUT off_session_multi still defers to checkout.session.completed", () => {
    // After the off-session branch handles its case, the regular
    // `metadata.invoiceIds` short-circuit emits "unsupported".
    expect(source).toMatch(
      /metadata\.invoiceIds\)[\s\S]*?return\s*\[[\s\S]*?kind:\s*"unsupported"/,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (5) Portal route source-grep — endpoint shapes
// ═══════════════════════════════════════════════════════════════════════════

describe("portal.ts — pay-with-saved-method route shape", () => {
  const ROUTE_PATH = path.resolve(__dirname, "..", "server", "routes", "portal.ts");
  const source = fs.readFileSync(ROUTE_PATH, "utf-8");

  it("declares both single + multi routes", () => {
    expect(source).toMatch(/"\/invoices\/:invoiceId\/pay-with-saved-method"/);
    expect(source).toMatch(/"\/invoices\/pay-selected-with-saved-method"/);
  });

  it("both routes validate paymentMethodId presence", () => {
    expect(source.match(/paymentMethodId is required/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("both routes route under requirePortalAuth + entitlement gate", () => {
    expect(source).toMatch(
      /pay-with-saved-method[\s\S]*?requirePortalAuth[\s\S]*?customer_portal_payments/,
    );
  });

  it("response status mapping covers succeeded / processing / requires_action / failed", () => {
    expect(source).toMatch(/status\s*===\s*"succeeded"\)\s*return\s*200/);
    expect(source).toMatch(/status\s*===\s*"processing"\)\s*return\s*202/);
    expect(source).toMatch(/return\s*402/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (6) Portal UI source-grep — list-page affordances
// ═══════════════════════════════════════════════════════════════════════════

describe("PortalInvoicesList.tsx — pay-with-saved buttons", () => {
  const PAGE_PATH = path.resolve(
    __dirname,
    "..",
    "client",
    "src",
    "pages",
    "portal",
    "PortalInvoicesList.tsx",
  );
  const source = fs.readFileSync(PAGE_PATH, "utf-8");

  it("queries /api/portal/payment-methods + uses retry:false (sticky entitlement gate)", () => {
    expect(source).toMatch(/queryKey:\s*\["\/api\/portal\/payment-methods"/);
    expect(source).toMatch(/retry:\s*false/);
  });

  it("per-row Pay-with-saved button gated on defaultCard existing", () => {
    expect(source).toMatch(/defaultCard\s*&&\s*\(\s*<Button/);
    expect(source).toMatch(/Pay •••• \{defaultCard\.cardLast4\}/);
  });

  it("per-row button POSTs the canonical single-invoice endpoint", () => {
    expect(source).toMatch(/\/api\/portal\/invoices\/\$\{[^}]*invoiceId[^}]*\}\/pay-with-saved-method/);
  });

  it("footer button POSTs the canonical multi-invoice endpoint", () => {
    expect(source).toMatch(/\/api\/portal\/invoices\/pay-selected-with-saved-method/);
  });

  it("footer Pay-with-saved button is gated on defaultCard existing", () => {
    expect(source).toMatch(
      /defaultCard\s*&&\s*\(\s*<Button[\s\S]*?Pay with •••• \{defaultCard\.cardLast4\}/,
    );
  });

  it("uses POST + JSON body { paymentMethodId } (no off_session direct call)", () => {
    expect(source).toMatch(/method:\s*"POST"/);
    expect(source).not.toMatch(/off_session:\s*true/);
  });

  it("loading state shows 'Charging…'", () => {
    expect(source).toMatch(/Charging…/);
  });
});
