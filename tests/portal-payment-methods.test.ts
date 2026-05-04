/**
 * Portal payment methods (PR C, 2026-05-03) — regression suite.
 *
 * Coverage:
 *   1. GET    /api/portal/payment-methods  — list, scope, entitlement gate
 *   2. POST   /api/portal/payment-methods/setup-intent  — consent gate, success
 *   3. PATCH  /api/portal/payment-methods/:id/default   — flip + scope
 *   4. DELETE /api/portal/payment-methods/:id           — detach + scope
 *   5. payment_method.detached webhook handler          — happy + unknown PM
 *   6. payment_method.updated webhook handler           — happy + unknown PM
 *   7. PortalPaymentMethods.tsx UI source guards
 *
 * Mock-style harness — same pattern as `portal-batch-checkout.test.ts`
 * for the route tests + `save-card-during-payment.test.ts` for the
 * webhook tests. No real DB, no real Stripe.
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

vi.mock("../server/services/payments/paymentApplicationService", () => ({
  paymentApplicationService: {
    createCheckout: vi.fn(),
    createMultiCheckout: vi.fn(),
    createPortalSetupIntent: vi.fn(),
    setDefaultSavedPaymentMethod: vi.fn(),
    removeSavedPaymentMethod: vi.fn(),
    refundPayment: vi.fn(),
    verifyInboundWebhook: vi.fn(),
    handleInboundWebhook: vi.fn(),
    applyVerifiedWebhookBatch: vi.fn(),
  },
}));

vi.mock("../server/services/entitlementService", () => ({
  entitlementService: { getEntitlement: vi.fn() },
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

vi.mock("../server/resendClient", () => ({ getResendClient: vi.fn() }));
vi.mock("../server/services/invoicePdfService", () => ({
  generateInvoicePdf: vi.fn(),
}));
vi.mock("../server/storage/index", () => ({ storage: {} }));
vi.mock("../server/auth/tenantIsolation", () => ({
  rateLimitPerTenant: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../server/services/payments/providers/resolver", () => {
  const stripeAdapter = {
    id: "stripe" as const,
    createCheckout: vi.fn(),
    createCheckoutSession: vi.fn(),
    createCustomer: vi.fn(),
    createSetupIntent: vi.fn(),
    detachPaymentMethod: vi.fn(),
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

// ─── App harness ──────────────────────────────────────────────────────────
import express from "express";
import request from "supertest";

import portalRouter from "../server/routes/portal";
import { entitlementService } from "../server/services/entitlementService";
import { paymentApplicationService } from "../server/services/payments/paymentApplicationService";
import { paymentMethodsRepository } from "../server/storage/paymentMethods";

const TENANT_A = "co_a";
const CUSTOMER_X = "cust_x";
const CONTACT_X = "contact_x";

function makeApp(session: { companyId: string; customerCompanyId: string } | null) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.session = session
      ? {
          portal: {
            contactId: CONTACT_X,
            customerCompanyId: session.customerCompanyId,
            companyId: session.companyId,
            email: "test@test.local",
            firstName: "Test",
            lastName: "User",
            companyName: "Test Inc",
            customerCompanyName: "Test Co",
          },
        }
      : {};
    next();
  });
  app.use("/api/portal", portalRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    const status = err.statusCode ?? err.status ?? 500;
    res.status(status).json({ error: err.message ?? "Internal error" });
  });
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  (entitlementService.getEntitlement as any).mockResolvedValue({ enabled: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/portal/payment-methods
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/portal/payment-methods", () => {
  it("returns 401 without portal session", async () => {
    const app = makeApp(null);
    const res = await request(app).get("/api/portal/payment-methods");
    expect(res.status).toBe(401);
    expect(paymentMethodsRepository.listByCustomerCompany).not.toHaveBeenCalled();
  });

  it("returns 403 when customer_portal_payments is disabled", async () => {
    (entitlementService.getEntitlement as any).mockResolvedValueOnce({
      enabled: false,
    });
    const app = makeApp({ companyId: TENANT_A, customerCompanyId: CUSTOMER_X });
    const res = await request(app).get("/api/portal/payment-methods");
    expect(res.status).toBe(403);
    expect(paymentMethodsRepository.listByCustomerCompany).not.toHaveBeenCalled();
  });

  it("scopes the lookup to (companyId, customerCompanyId) and returns sanitized rows", async () => {
    (paymentMethodsRepository.listByCustomerCompany as any).mockResolvedValueOnce([
      {
        id: "pm_1",
        companyId: TENANT_A,
        customerCompanyId: CUSTOMER_X,
        providerSource: "stripe",
        providerCustomerId: "cus_xyz",
        providerPaymentMethodId: "pm_stripe_xyz",
        cardBrand: "visa",
        cardLast4: "4242",
        cardExpMonth: 12,
        cardExpYear: 2030,
        cardFunding: "credit",
        cardCountry: "US",
        isDefault: true,
        consentAt: new Date(),
        consentText: "...",
        createdAt: new Date("2026-05-01T00:00:00Z"),
        detachedAt: null,
      },
    ]);
    const app = makeApp({ companyId: TENANT_A, customerCompanyId: CUSTOMER_X });
    const res = await request(app).get("/api/portal/payment-methods");

    expect(res.status).toBe(200);
    expect(paymentMethodsRepository.listByCustomerCompany).toHaveBeenCalledWith(
      TENANT_A,
      CUSTOMER_X,
    );
    expect(res.body.paymentMethods).toHaveLength(1);
    const row = res.body.paymentMethods[0];
    // Provider tokens NOT returned to the browser.
    expect(row).not.toHaveProperty("providerSource");
    expect(row).not.toHaveProperty("providerCustomerId");
    expect(row).not.toHaveProperty("providerPaymentMethodId");
    expect(row).not.toHaveProperty("consentText");
    // Canonical card-display fields ARE returned.
    expect(row).toMatchObject({
      id: "pm_1",
      cardBrand: "visa",
      cardLast4: "4242",
      cardExpMonth: 12,
      cardExpYear: 2030,
      isDefault: true,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/portal/payment-methods/setup-intent
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/portal/payment-methods/setup-intent", () => {
  it("rejects (400) when consentText is missing", async () => {
    const app = makeApp({ companyId: TENANT_A, customerCompanyId: CUSTOMER_X });
    const res = await request(app)
      .post("/api/portal/payment-methods/setup-intent")
      .send({});
    expect(res.status).toBe(400);
    expect(paymentApplicationService.createPortalSetupIntent).not.toHaveBeenCalled();
  });

  it("rejects (400) when consentText is whitespace-only", async () => {
    const app = makeApp({ companyId: TENANT_A, customerCompanyId: CUSTOMER_X });
    const res = await request(app)
      .post("/api/portal/payment-methods/setup-intent")
      .send({ consentText: "   " });
    expect(res.status).toBe(400);
  });

  it("forwards canonical payload + returns provider-neutral response", async () => {
    (paymentApplicationService.createPortalSetupIntent as any).mockResolvedValueOnce({
      providerId: "stripe",
      clientToken: "seti_test_secret",
      providerSetupIntentId: "seti_test_1",
      publishableKey: "pk_test",
    });

    const app = makeApp({ companyId: TENANT_A, customerCompanyId: CUSTOMER_X });
    const res = await request(app)
      .post("/api/portal/payment-methods/setup-intent")
      .set("user-agent", "vitest-pmc")
      .send({ consentText: "I authorize." });

    expect(res.status).toBe(201);
    expect(paymentApplicationService.createPortalSetupIntent).toHaveBeenCalledOnce();
    const args = (paymentApplicationService.createPortalSetupIntent as any).mock
      .calls[0][0];
    expect(args).toMatchObject({
      companyId: TENANT_A,
      customerCompanyId: CUSTOMER_X,
      consentText: "I authorize.",
      contactId: CONTACT_X,
    });
    expect(args.consentUserAgent).toMatch(/vitest-pmc/);

    // Provider neutral. SetupIntent id is NOT returned to the browser
    // (it's not needed — Elements uses the client_secret).
    expect(res.body).toMatchObject({
      providerId: "stripe",
      clientToken: "seti_test_secret",
      publishableKey: "pk_test",
    });
    expect(res.body).not.toHaveProperty("providerSetupIntentId");
  });

  it("returns 401 without portal session", async () => {
    const app = makeApp(null);
    const res = await request(app)
      .post("/api/portal/payment-methods/setup-intent")
      .send({ consentText: "x" });
    expect(res.status).toBe(401);
  });

  it("returns 403 when entitlement is disabled", async () => {
    (entitlementService.getEntitlement as any).mockResolvedValueOnce({
      enabled: false,
    });
    const app = makeApp({ companyId: TENANT_A, customerCompanyId: CUSTOMER_X });
    const res = await request(app)
      .post("/api/portal/payment-methods/setup-intent")
      .send({ consentText: "x" });
    expect(res.status).toBe(403);
    expect(paymentApplicationService.createPortalSetupIntent).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /api/portal/payment-methods/:id/default
// ═══════════════════════════════════════════════════════════════════════════

describe("PATCH /api/portal/payment-methods/:id/default", () => {
  it("forwards (companyId, customerCompanyId, paymentMethodId) to the service", async () => {
    (paymentApplicationService.setDefaultSavedPaymentMethod as any).mockResolvedValueOnce({
      id: "pm_target",
      isDefault: true,
    });
    const app = makeApp({ companyId: TENANT_A, customerCompanyId: CUSTOMER_X });
    const res = await request(app)
      .patch("/api/portal/payment-methods/pm_target/default")
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: "pm_target", isDefault: true });
    expect(paymentApplicationService.setDefaultSavedPaymentMethod).toHaveBeenCalledWith({
      companyId: TENANT_A,
      customerCompanyId: CUSTOMER_X,
      paymentMethodId: "pm_target",
    });
  });

  it("propagates 404 from the service (cross-customer / unknown id)", async () => {
    const err: any = new Error("Payment method not found");
    err.status = 404;
    (paymentApplicationService.setDefaultSavedPaymentMethod as any).mockRejectedValueOnce(err);
    const app = makeApp({ companyId: TENANT_A, customerCompanyId: CUSTOMER_X });
    const res = await request(app)
      .patch("/api/portal/payment-methods/pm_other/default")
      .send({});
    expect(res.status).toBe(404);
  });

  it("returns 401 without portal session", async () => {
    const app = makeApp(null);
    const res = await request(app)
      .patch("/api/portal/payment-methods/pm_x/default")
      .send({});
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /api/portal/payment-methods/:id
// ═══════════════════════════════════════════════════════════════════════════

describe("DELETE /api/portal/payment-methods/:id", () => {
  it("forwards to removeSavedPaymentMethod with the portal session contact + reason", async () => {
    const detachedDate = new Date("2026-05-03T12:00:00Z");
    (paymentApplicationService.removeSavedPaymentMethod as any).mockResolvedValueOnce({
      id: "pm_remove",
      detachedAt: detachedDate,
    });
    const app = makeApp({ companyId: TENANT_A, customerCompanyId: CUSTOMER_X });
    const res = await request(app).delete("/api/portal/payment-methods/pm_remove");
    expect(res.status).toBe(200);
    expect(paymentApplicationService.removeSavedPaymentMethod).toHaveBeenCalledWith({
      companyId: TENANT_A,
      customerCompanyId: CUSTOMER_X,
      paymentMethodId: "pm_remove",
      contactId: CONTACT_X,
      reason: "portal_remove",
    });
    expect(res.body.id).toBe("pm_remove");
  });

  it("returns 403 when entitlement is off (engine never invoked)", async () => {
    (entitlementService.getEntitlement as any).mockResolvedValueOnce({ enabled: false });
    const app = makeApp({ companyId: TENANT_A, customerCompanyId: CUSTOMER_X });
    const res = await request(app).delete("/api/portal/payment-methods/pm_x");
    expect(res.status).toBe(403);
    expect(paymentApplicationService.removeSavedPaymentMethod).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Webhook handlers — payment_method.detached + payment_method.updated
// ═══════════════════════════════════════════════════════════════════════════
//
// These tests directly exercise applyVerifiedWebhookBatch — separate
// vi.mock setup so the application service is NOT mocked for these
// (we use the real handlers).

describe.sequential("payment_method webhook handlers — exercised directly", () => {
  // Fresh import dance: re-import the actual application service into
  // a local. The vi.mock for `paymentApplicationService` above only
  // intercepts default imports / named imports of that module; the
  // real handlers ship via `applyVerifiedWebhookBatch`. Because the
  // route-level mock above replaces the export, we use the module
  // surface directly through dynamic import + requireActual.
  let realService: any;
  let dbMock: any;
  let pmRepoMock: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Bypass the module mock for THIS describe block by going through
    // vi.importActual.
    realService = await vi.importActual<
      typeof import("../server/services/payments/paymentApplicationService")
    >("../server/services/payments/paymentApplicationService");
    dbMock = (await import("../server/db")).db as any;
    pmRepoMock = (await import("../server/storage/paymentMethods"))
      .paymentMethodsRepository as any;
  });

  function setOwnerLookup(
    row: { id: string; companyId: string } | null,
  ) {
    const result = row ? [row] : [];
    const limit = vi.fn().mockResolvedValue(result);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    (dbMock.select as ReturnType<typeof vi.fn>).mockReturnValue({ from });
  }

  it("payment_method_detached: marks detached when row exists", async () => {
    setOwnerLookup({ id: "pm_local_1", companyId: "co_owner" });
    (dbMock.transaction as any).mockImplementation(async (fn: any) => fn({} as any));
    (pmRepoMock.markDetached as any).mockResolvedValueOnce({
      id: "pm_local_1",
      detachedAt: new Date(),
    });

    const result = await realService.paymentApplicationService.applyVerifiedWebhookBatch(
      "stripe",
      [
        {
          kind: "payment_method_detached",
          eventId: "evt_detach_1",
          eventType: "payment_method.detached",
          paymentMethodId: "pm_stripe_xyz",
        },
      ],
    );
    expect(result.accepted).toHaveLength(1);
    expect(pmRepoMock.markDetached).toHaveBeenCalledTimes(1);
    const callArgs = (pmRepoMock.markDetached as any).mock.calls[0];
    expect(callArgs[1]).toBe("co_owner");
    expect(callArgs[2]).toBe("pm_local_1");
    expect(callArgs[3]).toMatchObject({ reason: "provider_webhook_detached" });
  });

  it("payment_method_detached: skipped when local row not found (idempotent)", async () => {
    setOwnerLookup(null);
    (dbMock.transaction as any).mockImplementation(async (fn: any) => fn({} as any));

    const result = await realService.paymentApplicationService.applyVerifiedWebhookBatch(
      "stripe",
      [
        {
          kind: "payment_method_detached",
          eventId: "evt_detach_unknown",
          eventType: "payment_method.detached",
          paymentMethodId: "pm_unknown",
        },
      ],
    );
    expect(result.ignored).toHaveLength(1);
    expect(pmRepoMock.markDetached).not.toHaveBeenCalled();
  });

  it("payment_method_updated: refreshes card metadata when row exists", async () => {
    setOwnerLookup({ id: "pm_local_2", companyId: "co_owner" });
    (dbMock.transaction as any).mockImplementation(async (fn: any) => fn({} as any));
    (pmRepoMock.updateCardMetadata as any).mockResolvedValueOnce({});

    const result = await realService.paymentApplicationService.applyVerifiedWebhookBatch(
      "stripe",
      [
        {
          kind: "payment_method_updated",
          eventId: "evt_update_1",
          eventType: "payment_method.updated",
          paymentMethodId: "pm_stripe_upd",
          cardBrand: "visa",
          cardLast4: "4242",
          cardExpMonth: 11,
          cardExpYear: 2031,
          cardFunding: "credit",
          cardCountry: "US",
        },
      ],
    );
    expect(result.accepted).toHaveLength(1);
    expect(pmRepoMock.updateCardMetadata).toHaveBeenCalledTimes(1);
    const args = (pmRepoMock.updateCardMetadata as any).mock.calls[0];
    expect(args[1]).toBe("co_owner");           // companyId
    expect(args[2]).toBe("stripe");             // providerSource
    expect(args[3]).toBe("pm_stripe_upd");      // providerPaymentMethodId
    expect(args[4]).toMatchObject({
      cardBrand: "visa",
      cardLast4: "4242",
      cardExpMonth: 11,
      cardExpYear: 2031,
    });
  });

  it("payment_method_updated: skipped when local row not found", async () => {
    setOwnerLookup(null);
    const result = await realService.paymentApplicationService.applyVerifiedWebhookBatch(
      "stripe",
      [
        {
          kind: "payment_method_updated",
          eventId: "evt_upd_unknown",
          eventType: "payment_method.updated",
          paymentMethodId: "pm_unknown",
          cardBrand: "visa",
          cardLast4: "4242",
          cardExpMonth: 12,
          cardExpYear: 2030,
          cardFunding: null,
          cardCountry: null,
        },
      ],
    );
    expect(result.ignored).toHaveLength(1);
    expect(pmRepoMock.updateCardMetadata).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Source-grep guards on the portal UI page
// ═══════════════════════════════════════════════════════════════════════════

import * as fs from "node:fs";
import * as path from "node:path";

describe("PortalPaymentMethods.tsx — source-level UI guards", () => {
  const PAGE_PATH = path.resolve(
    __dirname,
    "..",
    "client",
    "src",
    "pages",
    "portal",
    "PortalPaymentMethods.tsx",
  );
  const source = fs.readFileSync(PAGE_PATH, "utf-8");

  it("uses the canonical /api/portal/payment-methods endpoints", () => {
    expect(source).toMatch(/\/api\/portal\/payment-methods["`]/);
    expect(source).toMatch(/\/api\/portal\/payment-methods\/setup-intent/);
    expect(source).toMatch(/\/api\/portal\/payment-methods\/\$\{id\}\/default/);
  });

  it("DELETE method used for the remove flow", () => {
    expect(source).toMatch(/method:\s*"DELETE"/);
  });

  it("PATCH method used for set-default", () => {
    expect(source).toMatch(/method:\s*"PATCH"/);
  });

  it("Add card flow mounts Stripe Elements with the SetupIntent client_secret", () => {
    expect(source).toMatch(/<Elements[\s\S]*?clientSecret:\s*intent\.clientToken/);
    expect(source).toMatch(/stripe\.confirmSetup/);
  });

  it("does NOT call any pay/charge endpoint (PR D scope)", () => {
    // The management page is read+save-card-only; PR D will add the
    // "pay with saved card" affordance on invoice pages.
    expect(source).not.toMatch(/\/api\/portal\/invoices\/[^"`]*pay-with-saved/);
    expect(source).not.toMatch(/off_session/);
  });
});

describe("PortalDashboard.tsx — saved-card hook", () => {
  const PAGE_PATH = path.resolve(
    __dirname,
    "..",
    "client",
    "src",
    "pages",
    "portal",
    "PortalDashboard.tsx",
  );
  const source = fs.readFileSync(PAGE_PATH, "utf-8");

  it("queries /api/portal/payment-methods for the default-card line", () => {
    expect(source).toMatch(/\/api\/portal\/payment-methods/);
  });

  it("default-card link points to /portal/payment-methods", () => {
    expect(source).toMatch(/href="\/portal\/payment-methods"/);
  });

  it("renders only when a card exists (defensive)", () => {
    expect(source).toMatch(/\{defaultCard\s*&&/);
  });
});
