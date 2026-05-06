/**
 * Collect Payment — receipt email wiring (2026-05-06 PR2).
 *
 * Pins the route-level behavior of `POST /api/payments` for the
 * `emailReceipt` field. The storage layer is exercised separately by
 * `tests/collect-payment.test.ts` (real-DB integration); this file
 * mounts the payments router behind a minimal Express app with mocked
 * storage + email service so we can assert:
 *
 *   1. emailReceipt=false (omitted) does NOT call sendMultiInvoicePaymentReceiptEmail.
 *   2. emailReceipt=true on a single-allocation payment → email service
 *      called once with the new payment id; response reports
 *      `receiptEmailQueued: true` + the resend message id.
 *   3. emailReceipt=true on a multi-allocation payment → same call,
 *      same response shape.
 *   4. Email service throw does NOT roll back the payment — response
 *      still 201 with `receiptEmailQueued: false`,
 *      `receiptEmailReason: "send_failed"`, and the error message.
 *   5. Email service returns null (no recipient resolved) → response
 *      `receiptEmailQueued: false`, `receiptEmailReason: "no_recipient"`.
 *   6. emailReceipt=false explicitly → reason: "not_requested" so the
 *      UI distinguishes "user opted out" from "we tried and failed".
 *   7. The Stripe staff checkout route is NOT touched by these
 *      changes — pinned via source-pin (no new wiring on that path).
 *   8. The `sendMultiInvoicePaymentReceiptEmail` method is reused for
 *      BOTH single- and multi-allocation receipts (we never call
 *      `sendPaymentReceiptEmail({invoiceId})` from this route).
 */

import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import request from "supertest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const tenantA = "00000000-0000-0000-0000-000000000aaa";
const ownerA = "00000000-0000-0000-0000-000000000bbb";
const customerA = "00000000-0000-0000-0000-000000000ccc";
const invoiceA1 = "00000000-0000-0000-0000-0000000a0001";
const invoiceA2 = "00000000-0000-0000-0000-0000000a0002";
const newPaymentId = "00000000-0000-0000-0000-0000000a9999";

// ── Mocks ────────────────────────────────────────────────────────────

// Fake out the entire DB layer so the route never tries to open a
// connection in the test process. Every storage method we exercise is
// mocked individually below.
vi.mock("../server/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) }),
    transaction: (fn: any) => fn({}),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

// Storage + adjacent services. We only stub what the route touches.
const createManualMultiInvoicePaymentMock = vi.fn();
vi.mock("../server/storage/payments", () => ({
  paymentRepository: {
    createManualMultiInvoicePayment: createManualMultiInvoicePaymentMock,
    // Other methods only need to exist as fns; the route doesn't call
    // them on this path.
    getPayments: vi.fn().mockResolvedValue([]),
    createPayment: vi.fn(),
    updatePayment: vi.fn(),
    deletePayment: vi.fn(),
  },
}));

vi.mock("../server/storage/invoices", () => ({
  invoiceRepository: {
    getInvoice: vi.fn().mockResolvedValue({
      id: invoiceA1,
      companyId: tenantA,
      customerCompanyId: customerA,
      invoiceNumber: "5001",
      status: "awaiting_payment",
      total: "100.00",
      amountPaid: "0.00",
      balance: "100.00",
    }),
  },
}));

const sendReceiptMock = vi.fn();
vi.mock("../server/services/emailDispatchService", () => ({
  emailDispatchService: {
    sendMultiInvoicePaymentReceiptEmail: sendReceiptMock,
    // Make every other method that might be tree-imported a no-op.
    sendPaymentReceiptEmail: vi.fn(),
    sendInvoiceEmail: vi.fn(),
    sendQuoteEmail: vi.fn(),
    sendJobEmail: vi.fn(),
  },
}));

vi.mock("../server/services/qbo/maybeSyncPayment", () => ({
  maybeSyncPaymentToQbo: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../server/services/payments/paymentApplicationService", () => ({
  paymentApplicationService: {
    createCheckout: vi.fn(),
    refundPayment: vi.fn(),
  },
}));

vi.mock("../server/lib/events", () => ({
  logEventAsync: vi.fn(),
}));

vi.mock("../server/lib/queryCtx", () => ({
  getQueryCtx: vi.fn(() => ({})),
}));

// Route helpers — bypass auth + permission gating. The two-layer model
// is exercised in its own dedicated tests; here we only care about the
// route's own logic.
vi.mock("../server/auth/requireRole", () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../server/permissions", () => ({
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../server/auth/tenantIsolation", () => ({
  // Type-only export the route imports as `AuthedRequest`. Plus the
  // rate-limit helper wired on the Stripe checkout route — return a
  // pass-through middleware so the registration succeeds.
  rateLimitPerTenant: () => (_req: any, _res: any, next: any) => next(),
}));

// ── Harness ──────────────────────────────────────────────────────────

type ActiveUser = { id: string; companyId: string; role: string } | null;
let activeUser: ActiveUser = null;

async function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (!activeUser) return next();
    (req as any).user = {
      id: activeUser.id,
      companyId: activeUser.companyId,
      email: `${activeUser.id}@test.example`,
      role: activeUser.role,
    };
    (req as any).companyId = activeUser.companyId;
    next();
  });
  const mod = await import("../server/routes/payments");
  app.use("/api", mod.default);
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err?.status || err?.statusCode || 500;
    res.status(status).json({ error: err?.message || "Internal server error" });
  });
  return app;
}

// Reset between tests so a previous case's mock doesn't leak.
beforeEach(() => {
  vi.clearAllMocks();
  activeUser = { id: ownerA, companyId: tenantA, role: "owner" };
  // Default storage success — single allocation, $100 paid in full.
  createManualMultiInvoicePaymentMock.mockResolvedValue({
    payment: {
      id: newPaymentId,
      companyId: tenantA,
      invoiceId: null,
      amount: "100.00",
      method: "cheque",
      providerSource: "manual",
    },
    invoices: [
      {
        id: invoiceA1,
        companyId: tenantA,
        invoiceNumber: "5001",
        status: "paid",
        balance: "0.00",
        amountPaid: "100.00",
      },
    ],
  });
});

const baseBody = {
  customerCompanyId: customerA,
  method: "cheque",
  reference: "1042",
  notes: "test cheque",
  allocations: [{ invoiceId: invoiceA1, amount: "100.00" }],
};

// ── Receipt dispatch behavior ────────────────────────────────────────

describe("POST /api/payments — receipt email wiring", () => {
  it("emailReceipt=false does NOT call sendMultiInvoicePaymentReceiptEmail", async () => {
    const app = await makeApp();
    const res = await request(app)
      .post("/api/payments")
      .send({ ...baseBody, emailReceipt: false });
    expect(res.status).toBe(201);
    expect(sendReceiptMock).not.toHaveBeenCalled();
    expect(res.body.receiptEmailRequested).toBe(false);
    expect(res.body.receiptEmailQueued).toBe(false);
    expect(res.body.receiptEmailReason).toBe("not_requested");
    expect(res.body.receiptEmailMessageId).toBeNull();
  });

  it("emailReceipt omitted defaults to NOT requesting (reason='not_requested')", async () => {
    const app = await makeApp();
    const res = await request(app).post("/api/payments").send(baseBody);
    expect(res.status).toBe(201);
    expect(sendReceiptMock).not.toHaveBeenCalled();
    expect(res.body.receiptEmailRequested).toBe(false);
    expect(res.body.receiptEmailQueued).toBe(false);
    expect(res.body.receiptEmailReason).toBe("not_requested");
  });

  it("emailReceipt=true single-allocation: dispatches once with the new paymentId, response reports queued=true", async () => {
    sendReceiptMock.mockResolvedValueOnce({
      emailId: "em_test_1",
      recipients: ["billing@example.com"],
      subject: "Receipt for Invoice #5001",
    });
    const app = await makeApp();
    const res = await request(app)
      .post("/api/payments")
      .send({ ...baseBody, emailReceipt: true });

    expect(res.status).toBe(201);
    expect(sendReceiptMock).toHaveBeenCalledTimes(1);
    expect(sendReceiptMock).toHaveBeenCalledWith({
      tenantId: tenantA,
      paymentId: newPaymentId,
    });
    expect(res.body.receiptEmailRequested).toBe(true);
    expect(res.body.receiptEmailQueued).toBe(true);
    expect(res.body.receiptEmailReason).toBeNull();
    expect(res.body.receiptEmailMessageId).toBe("em_test_1");
  });

  it("emailReceipt=true multi-allocation: still ONE receipt call (the multi method handles both shapes)", async () => {
    // Storage returns a multi-allocation result.
    createManualMultiInvoicePaymentMock.mockResolvedValueOnce({
      payment: {
        id: newPaymentId,
        companyId: tenantA,
        invoiceId: null,
        amount: "300.00",
        method: "cheque",
        providerSource: "manual",
      },
      invoices: [
        { id: invoiceA1, invoiceNumber: "5001", status: "paid", balance: "0.00" },
        { id: invoiceA2, invoiceNumber: "5002", status: "partial_paid", balance: "100.00" },
      ],
    });
    sendReceiptMock.mockResolvedValueOnce({
      emailId: "em_multi_1",
      recipients: ["billing@example.com"],
      subject: "Receipt for 2 invoices",
    });
    const app = await makeApp();
    const res = await request(app)
      .post("/api/payments")
      .send({
        ...baseBody,
        emailReceipt: true,
        allocations: [
          { invoiceId: invoiceA1, amount: "100.00" },
          { invoiceId: invoiceA2, amount: "200.00" },
        ],
      });

    expect(res.status).toBe(201);
    expect(sendReceiptMock).toHaveBeenCalledTimes(1);
    expect(sendReceiptMock).toHaveBeenCalledWith({
      tenantId: tenantA,
      paymentId: newPaymentId,
    });
    expect(res.body.receiptEmailQueued).toBe(true);
    expect(res.body.receiptEmailMessageId).toBe("em_multi_1");
    expect(res.body.invoices).toHaveLength(2);
  });

  it("email failure does NOT roll back the payment — response is still 201 with queued=false + reason='send_failed'", async () => {
    sendReceiptMock.mockRejectedValueOnce(new Error("Resend transport timeout"));
    const app = await makeApp();
    const res = await request(app)
      .post("/api/payments")
      .send({ ...baseBody, emailReceipt: true });

    // Payment row is committed by the storage mock — the route must
    // NOT 5xx because of an email failure.
    expect(res.status).toBe(201);
    expect(res.body.payment.id).toBe(newPaymentId);
    expect(res.body.receiptEmailRequested).toBe(true);
    expect(res.body.receiptEmailQueued).toBe(false);
    expect(res.body.receiptEmailReason).toBe("send_failed");
    expect(res.body.receiptEmailError).toContain("Resend transport timeout");
  });

  it("no recipient resolved → response queued=false + reason='no_recipient'", async () => {
    // The email service returns null when getDefaultRecipients
    // resolves to an empty list (e.g. customer record has no billing
    // email on file). The route must surface this distinctly so the UI
    // can guide the operator to add an email and resend.
    sendReceiptMock.mockResolvedValueOnce(null);
    const app = await makeApp();
    const res = await request(app)
      .post("/api/payments")
      .send({ ...baseBody, emailReceipt: true });
    expect(res.status).toBe(201);
    expect(res.body.receiptEmailQueued).toBe(false);
    expect(res.body.receiptEmailReason).toBe("no_recipient");
    expect(res.body.receiptEmailMessageId).toBeNull();
    expect(res.body.receiptEmailError).toBeNull();
  });
});

// ── Source-pin layer ─────────────────────────────────────────────────

describe("Receipt wiring source pins", () => {
  function read(rel: string): string {
    return readFileSync(resolve(__dirname, "..", rel), "utf-8");
  }
  const paymentsRoute = read("server/routes/payments.ts");
  const dialog = read("client/src/components/invoice/CollectPaymentDialog.tsx");

  it("manual route imports emailDispatchService and calls the multi-invoice send method", () => {
    expect(paymentsRoute).toMatch(
      /from "\.\.\/services\/emailDispatchService"/,
    );
    expect(paymentsRoute).toMatch(
      /emailDispatchService\.sendMultiInvoicePaymentReceiptEmail\(\{[\s\S]*?tenantId:\s*companyId,[\s\S]*?paymentId:\s*result\.payment\.id,/,
    );
  });

  it("manual route does NOT call the legacy single-invoice receipt method (which keys off invoiceId)", () => {
    // sendPaymentReceiptEmail expects payment.invoiceId to be set;
    // manual payments always write invoiceId=NULL, so calling that
    // method here would send the wrong (or no) receipt. Pin the
    // absence of the call so a future regression fails this test.
    expect(paymentsRoute).not.toMatch(
      /emailDispatchService\.sendPaymentReceiptEmail\(/,
    );
  });

  it("manual route catches send failures and surfaces receiptEmailQueued: false instead of 5xx", () => {
    expect(paymentsRoute).toMatch(/receiptEmailReason\s*=\s*"send_failed"/);
    expect(paymentsRoute).toMatch(/manual_payment\.receipt_send_failed/);
    // The 201 is unconditional once the storage call resolves.
    expect(paymentsRoute).toMatch(/res\.status\(201\)\.json\(\{/);
  });

  it("manual route distinguishes 'not_requested' / 'no_recipient' / 'send_failed'", () => {
    expect(paymentsRoute).toMatch(/"not_requested"/);
    expect(paymentsRoute).toMatch(/"no_recipient"/);
    expect(paymentsRoute).toMatch(/"send_failed"/);
  });

  it("Stripe staff checkout route is unchanged — no receipt-mailer wiring on /payments/checkout", () => {
    // The Stripe webhook is the canonical writer + receipt sender for
    // Stripe payments. Routes/payments.ts should NOT call receipt
    // dispatch on the Stripe checkout endpoint. We grep the checkout
    // handler region to be sure.
    const checkoutMatch = paymentsRoute.match(
      /router\.post\(\s*"\/invoices\/:invoiceId\/payments\/checkout"[\s\S]*?\}\),\s*\);/,
    );
    expect(checkoutMatch).toBeTruthy();
    expect(checkoutMatch![0]).not.toMatch(/sendMultiInvoicePaymentReceiptEmail/);
    expect(checkoutMatch![0]).not.toMatch(/sendPaymentReceiptEmail/);
  });

  it("CollectPaymentDialog branches toast text on receiptEmailQueued — never claims unconfirmed sends", () => {
    expect(dialog).toMatch(/receiptEmailQueued:\s*boolean/);
    expect(dialog).toMatch(/Payment recorded · receipt emailed/);
    expect(dialog).toMatch(/Payment saved, but receipt email was not sent/);
    // Reason hints — we surface why the email did not go out.
    expect(dialog).toMatch(/no_recipient/);
    expect(dialog).toMatch(/send_failed/);
  });
});
