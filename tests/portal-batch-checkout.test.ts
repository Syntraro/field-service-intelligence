/**
 * Portal batch-checkout route — PR 3 regression suite (2026-05-03).
 *
 * Mounts the real `server/routes/portal.ts` router behind a tiny
 * Express app, stubs the portal session middleware to seed
 * (companyId, customerCompanyId), and mocks the things the route
 * delegates to:
 *   - `entitlementService.getEntitlement` (feature gate)
 *   - `invoiceRepository.getInvoice`     (per-id scope check)
 *   - `paymentApplicationService.createMultiCheckout` (engine)
 *
 * This keeps the test focused on the ROUTE surface — body parsing,
 * tenant-scope guards, feature-gate behavior, response shape — and
 * doesn't re-test PR 2's engine validation, which already has its
 * own test coverage in `tests/multi-invoice-payments.test.ts`.
 *
 * Spec coverage (PR 3 task 6, backend):
 *   1. rejects empty body
 *   2. rejects cross-tenant invoice (404, no info leak)
 *   3. rejects cross-customer invoice (404)
 *   4. rejects when payments entitlement is OFF (403)
 *   5. happy path: returns the engine's checkoutUrl + sessionId,
 *      forwards no Stripe-specific names
 *   6. duplicate ids in body are rejected (400)
 *   7. malformed body shapes (non-array, non-string) → 400
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (hoisted) ───────────────────────────────────────────────────────

vi.mock("../server/db", () => ({
  db: {},
}));

vi.mock("../server/storage/invoices", () => ({
  invoiceRepository: {
    getInvoice: vi.fn(),
  },
}));

vi.mock("../server/services/payments/paymentApplicationService", () => ({
  paymentApplicationService: {
    createCheckout: vi.fn(),
    createMultiCheckout: vi.fn(),
  },
}));

vi.mock("../server/services/entitlementService", () => ({
  entitlementService: {
    getEntitlement: vi.fn(),
  },
}));

// The portal route also calls these lazily; stubbed minimally so the
// router module can import.
vi.mock("../server/resendClient", () => ({
  getResendClient: vi.fn(),
}));

vi.mock("../server/services/invoicePdfService", () => ({
  generateInvoicePdf: vi.fn(),
}));

vi.mock("../server/storage/index", () => ({
  storage: {},
}));

// `rateLimitPerTenant` returns an Express middleware. The portal
// router wires it to the magic-link + payment-intent endpoints; for
// our batch-checkout tests we want a no-op so we don't have to seed
// any rate-limit state.
vi.mock("../server/auth/tenantIsolation", () => ({
  rateLimitPerTenant: () => (_req: any, _res: any, next: any) => next(),
}));

// ─── App harness ──────────────────────────────────────────────────────────
import express from "express";
import request from "supertest";

import portalRouter from "../server/routes/portal";
import { invoiceRepository } from "../server/storage/invoices";
import { paymentApplicationService } from "../server/services/payments/paymentApplicationService";
import { entitlementService } from "../server/services/entitlementService";

const TENANT_A = "co_tenant_a";
const CUSTOMER_X = "cust_customer_x";

/**
 * Build a fresh Express app per-test-suite. The portal session is
 * seeded by a tiny middleware right before the router so we don't
 * need to mock the express-session machinery itself.
 */
function makeApp(session: { companyId: string; customerCompanyId: string } | null) {
  const app = express();
  app.use(express.json());

  // Inject portal session. The route's `requirePortalAuth` reads from
  // `req.session?.portal`, so mimic exactly that shape.
  app.use((req: any, _res, next) => {
    req.session = session
      ? {
          portal: {
            contactId: "contact_x",
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

  // Central error mapper — `createError(status, msg)` sets
  // `(err as any).statusCode`, so mirror the production handler that
  // forwards that to the HTTP response.
  app.use((err: any, _req: any, res: any, _next: any) => {
    const status = err.statusCode ?? err.status ?? 500;
    res.status(status).json({ error: err.message ?? "Internal error" });
  });

  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: payments entitlement enabled. Individual tests override.
  (entitlementService.getEntitlement as any).mockResolvedValue({
    enabled: true,
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Spec: rejects empty / malformed body
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/portal/invoices/batch-checkout — body validation", () => {
  it("returns 401 without a portal session", async () => {
    const app = makeApp(null);
    const res = await request(app)
      .post("/api/portal/invoices/batch-checkout")
      .send({ invoiceIds: ["i_1"] });
    expect(res.status).toBe(401);
    expect(paymentApplicationService.createMultiCheckout).not.toHaveBeenCalled();
  });

  it("rejects an empty invoiceIds list (400)", async () => {
    const app = makeApp({ companyId: TENANT_A, customerCompanyId: CUSTOMER_X });
    const res = await request(app)
      .post("/api/portal/invoices/batch-checkout")
      .send({ invoiceIds: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least one invoice/i);
    expect(paymentApplicationService.createMultiCheckout).not.toHaveBeenCalled();
  });

  it("rejects a missing invoiceIds key (400)", async () => {
    const app = makeApp({ companyId: TENANT_A, customerCompanyId: CUSTOMER_X });
    const res = await request(app)
      .post("/api/portal/invoices/batch-checkout")
      .send({});
    expect(res.status).toBe(400);
  });

  it("rejects a non-array invoiceIds payload (400)", async () => {
    const app = makeApp({ companyId: TENANT_A, customerCompanyId: CUSTOMER_X });
    const res = await request(app)
      .post("/api/portal/invoices/batch-checkout")
      .send({ invoiceIds: "i_1" });
    expect(res.status).toBe(400);
  });

  it("rejects non-string entries inside invoiceIds (400)", async () => {
    const app = makeApp({ companyId: TENANT_A, customerCompanyId: CUSTOMER_X });
    const res = await request(app)
      .post("/api/portal/invoices/batch-checkout")
      .send({ invoiceIds: [123, "i_1"] });
    expect(res.status).toBe(400);
  });

  it("rejects duplicate ids in the request (400)", async () => {
    const app = makeApp({ companyId: TENANT_A, customerCompanyId: CUSTOMER_X });
    const res = await request(app)
      .post("/api/portal/invoices/batch-checkout")
      .send({ invoiceIds: ["i_1", "i_1"] });
    expect(res.status).toBe(400);
    expect(paymentApplicationService.createMultiCheckout).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Spec: feature gate
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/portal/invoices/batch-checkout — feature gate", () => {
  it("returns 403 when customer_portal_payments is disabled", async () => {
    (entitlementService.getEntitlement as any).mockResolvedValueOnce({
      enabled: false,
    });
    const app = makeApp({ companyId: TENANT_A, customerCompanyId: CUSTOMER_X });
    const res = await request(app)
      .post("/api/portal/invoices/batch-checkout")
      .send({ invoiceIds: ["i_1"] });
    expect(res.status).toBe(403);
    expect(paymentApplicationService.createMultiCheckout).not.toHaveBeenCalled();
    // The route checks the entitlement before touching the engine OR the
    // invoice repo — verifies the feature flag is the first gate.
    expect(invoiceRepository.getInvoice).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Spec: tenant + customer scope
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/portal/invoices/batch-checkout — scope guards", () => {
  it("rejects an unknown invoice id (404)", async () => {
    (invoiceRepository.getInvoice as any).mockResolvedValueOnce(null);
    const app = makeApp({ companyId: TENANT_A, customerCompanyId: CUSTOMER_X });
    const res = await request(app)
      .post("/api/portal/invoices/batch-checkout")
      .send({ invoiceIds: ["i_missing"] });
    expect(res.status).toBe(404);
    expect(paymentApplicationService.createMultiCheckout).not.toHaveBeenCalled();
  });

  it("rejects an invoice owned by a different customer (404, no info leak)", async () => {
    (invoiceRepository.getInvoice as any).mockResolvedValueOnce({
      id: "i_other",
      companyId: TENANT_A,
      // Different customer-company under the same tenant — must 404.
      customerCompanyId: "cust_other",
      status: "awaiting_payment",
      balance: "100.00",
    });
    const app = makeApp({ companyId: TENANT_A, customerCompanyId: CUSTOMER_X });
    const res = await request(app)
      .post("/api/portal/invoices/batch-checkout")
      .send({ invoiceIds: ["i_other"] });
    expect(res.status).toBe(404);
    expect(paymentApplicationService.createMultiCheckout).not.toHaveBeenCalled();
  });

  it("cross-tenant probe (different companyId) is also 404", async () => {
    // Repo returns null when the (companyId, invoiceId) pair doesn't
    // match — same surface as not-found, by design.
    (invoiceRepository.getInvoice as any).mockResolvedValueOnce(null);
    const app = makeApp({ companyId: TENANT_A, customerCompanyId: CUSTOMER_X });
    const res = await request(app)
      .post("/api/portal/invoices/batch-checkout")
      .send({ invoiceIds: ["i_other_tenant"] });
    expect(res.status).toBe(404);
    expect(paymentApplicationService.createMultiCheckout).not.toHaveBeenCalled();
  });

  it("first failure short-circuits — no engine call when one of N is bad", async () => {
    (invoiceRepository.getInvoice as any).mockImplementation(
      async (_companyId: string, invoiceId: string) => {
        if (invoiceId === "i_a") {
          return {
            id: "i_a",
            companyId: TENANT_A,
            customerCompanyId: CUSTOMER_X,
            status: "awaiting_payment",
            balance: "100.00",
          };
        }
        if (invoiceId === "i_other") {
          return {
            id: "i_other",
            companyId: TENANT_A,
            customerCompanyId: "cust_other",
            status: "awaiting_payment",
            balance: "200.00",
          };
        }
        return null;
      },
    );
    const app = makeApp({ companyId: TENANT_A, customerCompanyId: CUSTOMER_X });
    const res = await request(app)
      .post("/api/portal/invoices/batch-checkout")
      .send({ invoiceIds: ["i_a", "i_other"] });
    expect(res.status).toBe(404);
    expect(paymentApplicationService.createMultiCheckout).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Spec: happy path → engine
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/portal/invoices/batch-checkout — happy path", () => {
  it("forwards to createMultiCheckout and returns checkoutUrl + sessionId", async () => {
    (invoiceRepository.getInvoice as any).mockImplementation(
      async (_companyId: string, invoiceId: string) => ({
        id: invoiceId,
        companyId: TENANT_A,
        customerCompanyId: CUSTOMER_X,
        status: "awaiting_payment",
        balance: "100.00",
      }),
    );
    (paymentApplicationService.createMultiCheckout as any).mockResolvedValueOnce({
      providerId: "stripe",
      sessionId: "cs_test_123",
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_123",
      providerPaymentIntentId: "pi_test_xyz",
      prospectivePaymentId: "pay_test_uuid",
      totalAmount: "200.00",
      invoiceIds: ["i_a", "i_b"],
    });

    const app = makeApp({ companyId: TENANT_A, customerCompanyId: CUSTOMER_X });
    const res = await request(app)
      .post("/api/portal/invoices/batch-checkout")
      .send({ invoiceIds: ["i_a", "i_b"] });

    expect(res.status).toBe(201);
    // Provider-neutral response shape — no Stripe-specific names leak.
    expect(res.body).toEqual({
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_123",
      sessionId: "cs_test_123",
      totalAmount: "200.00",
      invoiceIds: ["i_a", "i_b"],
    });
    // Specifically: providerPaymentIntentId / prospectivePaymentId /
    // providerId are NOT exposed to the customer's browser.
    expect(res.body).not.toHaveProperty("providerPaymentIntentId");
    expect(res.body).not.toHaveProperty("prospectivePaymentId");
    expect(res.body).not.toHaveProperty("providerId");

    expect(paymentApplicationService.createMultiCheckout).toHaveBeenCalledOnce();
    const args = (paymentApplicationService.createMultiCheckout as any).mock.calls[0][0];
    expect(args).toMatchObject({
      companyId: TENANT_A,
      customerCompanyId: CUSTOMER_X,
      invoiceIds: ["i_a", "i_b"],
      source: "portal",
    });
    expect(args.successUrl).toMatch(/portal\/invoices/);
    expect(args.cancelUrl).toMatch(/portal\/invoices/);
  });

  it("propagates a 400 from the engine (e.g. paid invoice slipped through)", async () => {
    (invoiceRepository.getInvoice as any).mockImplementation(
      async (_companyId: string, invoiceId: string) => ({
        id: invoiceId,
        companyId: TENANT_A,
        customerCompanyId: CUSTOMER_X,
        status: "awaiting_payment",
        balance: "100.00",
      }),
    );
    const engineErr: any = new Error("Invoice cannot accept payment");
    engineErr.status = 400;
    (paymentApplicationService.createMultiCheckout as any).mockRejectedValueOnce(
      engineErr,
    );

    const app = makeApp({ companyId: TENANT_A, customerCompanyId: CUSTOMER_X });
    const res = await request(app)
      .post("/api/portal/invoices/batch-checkout")
      .send({ invoiceIds: ["i_a"] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot accept payment/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2026-05-03 PR B — saveForFuture body validation
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/portal/invoices/batch-checkout — saveForFuture validation", () => {
  beforeEach(() => {
    (invoiceRepository.getInvoice as any).mockImplementation(
      async (_companyId: string, invoiceId: string) => ({
        id: invoiceId,
        companyId: TENANT_A,
        customerCompanyId: CUSTOMER_X,
        status: "awaiting_payment",
        balance: "100.00",
      }),
    );
  });

  it("rejects (400) when saveForFuture=true but consentText is missing — no engine call", async () => {
    const app = makeApp({ companyId: TENANT_A, customerCompanyId: CUSTOMER_X });
    const res = await request(app)
      .post("/api/portal/invoices/batch-checkout")
      .send({ invoiceIds: ["i_a"], saveForFuture: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/consentText is required/i);
    expect(paymentApplicationService.createMultiCheckout).not.toHaveBeenCalled();
  });

  it("rejects (400) when consentText is whitespace-only", async () => {
    const app = makeApp({ companyId: TENANT_A, customerCompanyId: CUSTOMER_X });
    const res = await request(app)
      .post("/api/portal/invoices/batch-checkout")
      .send({
        invoiceIds: ["i_a"],
        saveForFuture: true,
        consentText: "   ",
      });
    expect(res.status).toBe(400);
    expect(paymentApplicationService.createMultiCheckout).not.toHaveBeenCalled();
  });

  it("forwards saveForFuture+consent fields when valid", async () => {
    (paymentApplicationService.createMultiCheckout as any).mockResolvedValueOnce({
      providerId: "stripe",
      sessionId: "cs_save_1",
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_save_1",
      providerPaymentIntentId: "pi_save_1",
      prospectivePaymentId: "pay_save_1",
      totalAmount: "100.00",
      invoiceIds: ["i_a"],
    });
    const app = makeApp({ companyId: TENANT_A, customerCompanyId: CUSTOMER_X });
    const res = await request(app)
      .post("/api/portal/invoices/batch-checkout")
      .set("user-agent", "test-agent/1.0")
      .send({
        invoiceIds: ["i_a"],
        saveForFuture: true,
        consentText: "I authorize.",
      });
    expect(res.status).toBe(201);
    const args = (paymentApplicationService.createMultiCheckout as any).mock.calls[0][0];
    expect(args.saveForFuture).toBe(true);
    expect(args.consentText).toBe("I authorize.");
    // contactId comes from the portal session helper.
    expect(args.contactId).toBe("contact_x");
    // user-agent picked up from the request.
    expect(args.consentUserAgent).toMatch(/test-agent/);
  });

  it("saveForFuture omitted: engine called WITHOUT save-card params", async () => {
    (paymentApplicationService.createMultiCheckout as any).mockResolvedValueOnce({
      providerId: "stripe",
      sessionId: "cs_no_save",
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_no_save",
      providerPaymentIntentId: "pi_no_save",
      prospectivePaymentId: "pay_no_save",
      totalAmount: "100.00",
      invoiceIds: ["i_a"],
    });
    const app = makeApp({ companyId: TENANT_A, customerCompanyId: CUSTOMER_X });
    await request(app)
      .post("/api/portal/invoices/batch-checkout")
      .send({ invoiceIds: ["i_a"] });
    const args = (paymentApplicationService.createMultiCheckout as any).mock.calls[0][0];
    expect(args.saveForFuture).toBeUndefined();
    expect(args.consentText).toBeUndefined();
    expect(args.contactId).toBeUndefined();
  });
});
