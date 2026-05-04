/**
 * Payment Application Service — regression suite (2026-04-29 Stripe completion)
 *
 * Locks the canonical orchestrator's behavior on the failure paths that
 * are most expensive to get wrong:
 *   - webhook idempotency / replay
 *   - webhook config drift (missing tenant metadata, missing invoice)
 *   - webhook transient failures (DB blip → 500 → Stripe retries)
 *   - refund H1: cap check before any provider call
 *   - refund H2: provider succeeds, ledger fails non-uniquely → 202 path
 *   - refund replay safety: provider succeeds, ledger collides on UNIQUE
 *     → existing row returned, no second provider call possible
 *
 * Uses vi.mock to stub every storage / adapter / mailer dependency so
 * this suite is fast, deterministic, and does not require Stripe or the
 * real ledger. The setup file's `ensureTestDbInvariants` still runs
 * (vitest enforces setupFiles globally) but no test here writes to the DB.
 *
 * IMPORTANT: vi.mock calls are hoisted by the vitest transformer above
 * the imports below. The mock factories must not reference module-scope
 * symbols defined later in this file — they have to be self-contained.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ─────────────────────────────────────────────────────────────────
// `db` is referenced by paymentApplicationService when looking up the
// parent payment in `refundPayment`. We mock the `select().from().where().limit()`
// chain on a per-test basis via `setParentRow` below.
vi.mock("../server/db", () => {
  const db = {
    select: vi.fn(),
    transaction: vi.fn(),
  };
  return { db };
});

// invoiceRepository.getInvoice is only consulted from createCheckout, which
// these tests do not exercise. Stub minimally so module init does not throw.
vi.mock("../server/storage/invoices", () => ({
  invoiceRepository: {
    getInvoice: vi.fn(),
  },
}));

// paymentRepository — the canonical ledger writer. Every refund / webhook
// path is supposed to go through this; we replace it with vi.fn()s so
// individual test cases can decide whether the call succeeds, throws a
// unique violation, or throws a generic error.
vi.mock("../server/storage/payments", () => ({
  paymentRepository: {
    createPayment: vi.fn(),
    createRefund: vi.fn(),
    findByProviderReference: vi.fn(),
    assertRefundAmountWithinParent: vi.fn(),
  },
}));

// invoicePredicates — `canAcceptInvoicePayment` is referenced inside
// createCheckout; not exercised by these tests but must not trip module init.
vi.mock("../server/lib/invoicePredicates", () => ({
  canAcceptInvoicePayment: vi.fn(() => true),
  isInvoicePaid: vi.fn(() => false),
  isInvoiceVoided: vi.fn(() => false),
}));

vi.mock("../server/services/emailDispatchService", () => ({
  emailDispatchService: {
    sendPaymentReceiptEmail: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../server/storage/paymentWebhookEvents", () => ({
  buildDedupeKey: vi.fn(() => "test-dedupe-key"),
  safeRecordPaymentWebhookEvent: vi.fn().mockResolvedValue(undefined),
}));

// 2026-05-03 PR4 — webhook handlers look up provider account row.
// Mocks return null so the handler short-circuits to "skip" / "missing
// account on event" and writes the ledger row with null attribution.
vi.mock("../server/storage/paymentProviderAccounts", () => ({
  paymentProviderAccountsRepository: {
    getByProviderAndProviderAccountId: vi.fn(async () => null),
    getByCompanyAndProvider: vi.fn(async () => null),
    listByCompany: vi.fn(async () => []),
    insertAccount: vi.fn(),
    updateAccountState: vi.fn(),
  },
}));

// 2026-05-03 PR4 — the createCheckout test branch in this file would
// require an active account, but the existing tests in this file ONLY
// exercise applyVerifiedWebhookBatch + refundPayment — neither calls
// getActiveAccount today. The mock is here as a safety net.
vi.mock("../server/services/payments/paymentProviderAccountService", () => ({
  paymentProviderAccountService: {
    getActiveAccount: vi.fn(async () => null),
    applyAccountUpdate: vi.fn(),
    normalizeAccountStatus: vi.fn(),
    getAccountSnapshot: vi.fn(),
    getOrCreateAccount: vi.fn(),
    createOnboardingLink: vi.fn(),
    retrieveAndSyncAccount: vi.fn(),
    markAccountStatus: vi.fn(),
  },
}));

// resolver — give us full control over provider routing per test.
vi.mock("../server/services/payments/providers/resolver", () => {
  const stripeAdapter = {
    id: "stripe" as const,
    createCheckout: vi.fn(),
    refundPayment: vi.fn(),
    verifyWebhook: vi.fn(),
  };
  return {
    resolveForCompany: vi.fn(() => stripeAdapter),
    resolveForCompanyAsync: vi.fn(async () => stripeAdapter),
    resolveById: vi.fn((id: string) => (id === "stripe" ? stripeAdapter : null)),
    resolveForProviderSource: vi.fn((providerSource: string | null | undefined) => {
      if (!providerSource || providerSource === "manual") return { manual: true };
      if (providerSource === "stripe") return { provider: stripeAdapter };
      return { unsupported: true, providerSource };
    }),
    __testStripeAdapter: stripeAdapter, // exposed for assertions
  };
});

// ─── Imports under test (after mocks are declared) ─────────────────────────
import {
  paymentApplicationService,
  WebhookTransientFailureError,
} from "../server/services/payments/paymentApplicationService";
import { paymentRepository } from "../server/storage/payments";
import { db } from "../server/db";
// `resolver` — pull the test-exposed adapter so we can assert on its calls.
// Cast through unknown because the production module type does not declare
// the test-only escape hatch.
import * as resolverModule from "../server/services/payments/providers/resolver";
const stripeAdapter = (resolverModule as unknown as { __testStripeAdapter: any })
  .__testStripeAdapter;

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Stub the `db.select().from().where().limit()` chain used by `refundPayment`
 * to load the parent payment row. Pass `null` to simulate "not found".
 */
function setParentRow(row: Record<string, unknown> | null): void {
  const result = row ? [row] : [];
  const limit = vi.fn().mockResolvedValue(result);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  (db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ from });
}

function uniqueViolation(message = "duplicate key"): Error {
  return Object.assign(new Error(message), { code: "23505" });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("applyVerifiedWebhookBatch — payment_succeeded", () => {
  const validEvent = {
    kind: "payment_succeeded" as const,
    eventId: "evt_test_1",
    eventType: "payment_intent.succeeded",
    providerPaymentId: "pi_test_1",
    amountCents: 12345,
    chargeId: "ch_test_1",
    metadata: {
      companyId: "co_1",
      invoiceId: "inv_1",
      prospectivePaymentId: "pay_1",
    },
  };

  it("a successful first delivery records the canonical ledger row", async () => {
    (paymentRepository.createPayment as any).mockResolvedValueOnce({
      id: "pay_1",
      amount: "123.45",
    });

    const result = await paymentApplicationService.applyVerifiedWebhookBatch(
      "stripe",
      [validEvent],
    );

    expect(result.accepted).toHaveLength(1);
    expect(result.replayed).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
    expect(paymentRepository.createPayment).toHaveBeenCalledTimes(1);
    expect(paymentRepository.createPayment).toHaveBeenCalledWith(
      "co_1",
      "inv_1",
      expect.objectContaining({
        id: "pay_1",
        providerSource: "stripe",
        providerEventId: "evt_test_1",
        reference: "ch_test_1",
        amount: "123.45",
        method: "credit",
      }),
    );
  });

  it("a duplicate delivery (UNIQUE violation) is treated as a replay, not re-inserted", async () => {
    (paymentRepository.createPayment as any).mockRejectedValueOnce(
      uniqueViolation(),
    );

    const result = await paymentApplicationService.applyVerifiedWebhookBatch(
      "stripe",
      [validEvent],
    );

    expect(result.replayed).toHaveLength(1);
    expect(result.accepted).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
    // Only ONE call — the second-tier `findByProviderReference` is the
    // refund-replay path, not the payment-replay path.
    expect(paymentRepository.createPayment).toHaveBeenCalledTimes(1);
  });

  it("missing tenant metadata is classified as accepted (config-drift, 200 ACK)", async () => {
    const malformed = {
      ...validEvent,
      eventId: "evt_test_2",
      metadata: {}, // missing companyId / invoiceId / prospectivePaymentId
    };

    const result = await paymentApplicationService.applyVerifiedWebhookBatch(
      "stripe",
      [malformed],
    );

    expect(result.accepted).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    expect(paymentRepository.createPayment).not.toHaveBeenCalled();
  });

  it("a 4xx config-style error from createPayment is acked (200), not retried", async () => {
    const notFound = Object.assign(new Error("Invoice not found"), {
      statusCode: 404,
    });
    (paymentRepository.createPayment as any).mockRejectedValueOnce(notFound);

    const result = await paymentApplicationService.applyVerifiedWebhookBatch(
      "stripe",
      [{ ...validEvent, eventId: "evt_test_3" }],
    );

    expect(result.accepted).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
  });

  it("a transient (non-unique, non-4xx) error throws WebhookTransientFailureError", async () => {
    (paymentRepository.createPayment as any).mockRejectedValueOnce(
      new Error("connection terminated"),
    );

    await expect(
      paymentApplicationService.applyVerifiedWebhookBatch("stripe", [
        { ...validEvent, eventId: "evt_test_4" },
      ]),
    ).rejects.toBeInstanceOf(WebhookTransientFailureError);
  });
});

describe("applyVerifiedWebhookBatch — refund_created", () => {
  const refundEvent = {
    kind: "refund_created" as const,
    eventId: "evt_refund_1",
    eventType: "charge.refunded",
    providerRefundId: "re_test_1",
    providerChargeId: "ch_test_1",
    amountCents: 5000,
    reason: null,
  };

  it("records the canonical refund row after locating the parent by provider reference", async () => {
    (paymentRepository.findByProviderReference as any).mockResolvedValueOnce({
      id: "pay_parent",
      companyId: "co_1",
      invoiceId: "inv_1",
    });
    (paymentRepository.createRefund as any).mockResolvedValueOnce({
      id: "ref_1",
      amount: "-50.00",
    });

    const result = await paymentApplicationService.applyVerifiedWebhookBatch(
      "stripe",
      [refundEvent],
    );

    expect(result.accepted).toHaveLength(1);
    expect(paymentRepository.createRefund).toHaveBeenCalledWith(
      "co_1",
      "pay_parent",
      expect.objectContaining({
        amount: "50.00",
        method: "credit",
        reference: "re_test_1",
        providerSource: "stripe",
        providerEventId: "re_test_1",
      }),
    );
  });

  it("replay (UNIQUE violation on createRefund) is acked and not re-applied", async () => {
    (paymentRepository.findByProviderReference as any).mockResolvedValueOnce({
      id: "pay_parent",
      companyId: "co_1",
      invoiceId: "inv_1",
    });
    (paymentRepository.createRefund as any).mockRejectedValueOnce(
      uniqueViolation(),
    );

    const result = await paymentApplicationService.applyVerifiedWebhookBatch(
      "stripe",
      [refundEvent],
    );

    expect(result.replayed).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
  });

  it("refund for an unknown charge is skipped (no parent found)", async () => {
    (paymentRepository.findByProviderReference as any).mockResolvedValueOnce(null);

    const result = await paymentApplicationService.applyVerifiedWebhookBatch(
      "stripe",
      [refundEvent],
    );

    expect(result.ignored).toHaveLength(1);
    expect(paymentRepository.createRefund).not.toHaveBeenCalled();
  });
});

describe("refundPayment — provider routing & invariants", () => {
  // Note on error-shape assertions: errors thrown from the application
  // service via `createError()` carry `status` (no `statusCode`), while
  // errors from `paymentRepository`'s base class carry `statusCode`. Per-
  // test assertions match the producing layer.
  it("rejects when the parent payment is not found (404)", async () => {
    setParentRow(null);

    await expect(
      paymentApplicationService.refundPayment({
        companyId: "co_1",
        parentPaymentId: "pay_missing",
        amount: "10.00",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("rejects cross-tenant access as 404 (no information leak)", async () => {
    setParentRow({
      id: "pay_1",
      companyId: "co_other",
      invoiceId: "inv_other",
      amount: "100.00",
      method: "credit",
      paymentType: "payment",
      providerSource: "manual",
      reference: null,
    });

    await expect(
      paymentApplicationService.refundPayment({
        companyId: "co_1", // different tenant
        parentPaymentId: "pay_1",
        amount: "10.00",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("manual parent → ledger-only path, no provider call", async () => {
    setParentRow({
      id: "pay_1",
      companyId: "co_1",
      invoiceId: "inv_1",
      amount: "100.00",
      method: "cheque",
      paymentType: "payment",
      providerSource: "manual",
      reference: "CHK-001",
    });
    (paymentRepository.createRefund as any).mockResolvedValueOnce({
      id: "ref_1",
      amount: "-30.00",
      paymentType: "refund",
    });

    const result = await paymentApplicationService.refundPayment({
      companyId: "co_1",
      parentPaymentId: "pay_1",
      amount: "30.00",
    });

    expect(result.kind).toBe("settled");
    expect(stripeAdapter.refundPayment).not.toHaveBeenCalled();
    // Application service must not pre-call the cap helper for manual
    // parents — the storage layer enforces it inside the same tx.
    expect(paymentRepository.assertRefundAmountWithinParent).not.toHaveBeenCalled();
  });

  it("rejects when the parent's providerSource is unsupported (e.g. qbo)", async () => {
    setParentRow({
      id: "pay_1",
      companyId: "co_1",
      invoiceId: "inv_1",
      amount: "100.00",
      method: "credit",
      paymentType: "payment",
      providerSource: "qbo",
      reference: null,
      qboPaymentId: "QBO-1",
    });

    await expect(
      paymentApplicationService.refundPayment({
        companyId: "co_1",
        parentPaymentId: "pay_1",
        amount: "10.00",
      }),
    ).rejects.toMatchObject({ status: 409 });

    expect(stripeAdapter.refundPayment).not.toHaveBeenCalled();
  });

  it("rejects Stripe parent missing its provider reference (cannot resolve charge id)", async () => {
    setParentRow({
      id: "pay_1",
      companyId: "co_1",
      invoiceId: "inv_1",
      amount: "100.00",
      method: "credit",
      paymentType: "payment",
      providerSource: "stripe",
      reference: null,
    });

    await expect(
      paymentApplicationService.refundPayment({
        companyId: "co_1",
        parentPaymentId: "pay_1",
        amount: "10.00",
      }),
    ).rejects.toMatchObject({ status: 500 });

    expect(stripeAdapter.refundPayment).not.toHaveBeenCalled();
  });
});

describe("refundPayment — H1: overshoot rejected before any provider call", () => {
  beforeEach(() => {
    setParentRow({
      id: "pay_1",
      companyId: "co_1",
      invoiceId: "inv_1",
      amount: "100.00",
      method: "credit",
      paymentType: "payment",
      providerSource: "stripe",
      reference: "ch_test_1",
      // 2026-05-03 PR4 — refund flow now requires the parent's
      // connected-account attribution to route the refund call.
      providerAccountId: "acct_test_1",
      paymentProviderAccountId: "ppa_test_1",
    });
  });

  it("propagates the 400 from assertRefundAmountWithinParent without hitting Stripe", async () => {
    const overshoot = Object.assign(
      new Error(
        "Refund/reversal total would exceed parent payment.",
      ),
      { statusCode: 400 },
    );
    (paymentRepository.assertRefundAmountWithinParent as any).mockRejectedValueOnce(
      overshoot,
    );

    await expect(
      paymentApplicationService.refundPayment({
        companyId: "co_1",
        parentPaymentId: "pay_1",
        amount: "999.00",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(paymentRepository.assertRefundAmountWithinParent).toHaveBeenCalledOnce();
    expect(stripeAdapter.refundPayment).not.toHaveBeenCalled();
    expect(paymentRepository.createRefund).not.toHaveBeenCalled();
  });
});

describe("refundPayment — H2: provider success + ledger failure → reconciliation_pending", () => {
  beforeEach(() => {
    setParentRow({
      id: "pay_1",
      companyId: "co_1",
      invoiceId: "inv_1",
      amount: "100.00",
      method: "credit",
      paymentType: "payment",
      providerSource: "stripe",
      reference: "ch_test_1",
      // 2026-05-03 PR4 — refund flow now requires the parent's
      // connected-account attribution to route the refund call.
      providerAccountId: "acct_test_1",
      paymentProviderAccountId: "ppa_test_1",
    });
    (paymentRepository.assertRefundAmountWithinParent as any).mockResolvedValueOnce(
      undefined,
    );
  });

  it("happy path: Stripe succeeds, ledger writes, returns settled with row", async () => {
    (stripeAdapter.refundPayment as any).mockResolvedValueOnce({
      providerRefundId: "re_test_1",
      status: "succeeded",
    });
    (paymentRepository.createRefund as any).mockResolvedValueOnce({
      id: "ledger_1",
      amount: "-50.00",
      paymentType: "refund",
    });

    const result = await paymentApplicationService.refundPayment({
      companyId: "co_1",
      parentPaymentId: "pay_1",
      amount: "50.00",
    });

    expect(result.kind).toBe("settled");
    expect(stripeAdapter.refundPayment).toHaveBeenCalledOnce();
    expect(paymentRepository.createRefund).toHaveBeenCalledOnce();
  });

  it("Stripe succeeds, ledger throws UNIQUE → falls back to existing row (settled)", async () => {
    (stripeAdapter.refundPayment as any).mockResolvedValueOnce({
      providerRefundId: "re_test_1",
      status: "succeeded",
    });
    (paymentRepository.createRefund as any).mockRejectedValueOnce(
      uniqueViolation(),
    );
    (paymentRepository.findByProviderReference as any).mockResolvedValueOnce({
      id: "ledger_existing",
      amount: "-50.00",
      paymentType: "refund",
    });

    const result = await paymentApplicationService.refundPayment({
      companyId: "co_1",
      parentPaymentId: "pay_1",
      amount: "50.00",
    });

    expect(result.kind).toBe("settled");
    if (result.kind === "settled") {
      expect((result.row as { id: string }).id).toBe("ledger_existing");
    }
  });

  it("Stripe succeeds, ledger throws non-UNIQUE → reconciliation_pending (the H2 contract)", async () => {
    (stripeAdapter.refundPayment as any).mockResolvedValueOnce({
      providerRefundId: "re_test_1",
      status: "succeeded",
    });
    (paymentRepository.createRefund as any).mockRejectedValueOnce(
      new Error("connection lost mid-tx"),
    );

    const result = await paymentApplicationService.refundPayment({
      companyId: "co_1",
      parentPaymentId: "pay_1",
      amount: "50.00",
    });

    expect(result.kind).toBe("reconciliation_pending");
    if (result.kind === "reconciliation_pending") {
      expect(result.providerRefundId).toBe("re_test_1");
      expect(result.providerSource).toBe("stripe");
      // refundLedgerId is the random UUID we minted before the call —
      // it is informational only; the canonical id will be the
      // webhook-written row's id when it lands.
      expect(typeof result.refundLedgerId).toBe("string");
      expect(result.refundLedgerId.length).toBeGreaterThan(0);
    }
  });

  it("Stripe returns status='failed' → 502, no ledger row written", async () => {
    (stripeAdapter.refundPayment as any).mockResolvedValueOnce({
      providerRefundId: "re_test_1",
      status: "failed",
    });

    await expect(
      paymentApplicationService.refundPayment({
        companyId: "co_1",
        parentPaymentId: "pay_1",
        amount: "50.00",
      }),
    ).rejects.toMatchObject({ status: 502 });

    expect(paymentRepository.createRefund).not.toHaveBeenCalled();
  });

  it("the same input twice produces the same Stripe idempotency key (deterministic)", async () => {
    (stripeAdapter.refundPayment as any).mockResolvedValue({
      providerRefundId: "re_test_1",
      status: "succeeded",
    });
    (paymentRepository.createRefund as any).mockResolvedValue({
      id: "ledger_1",
      amount: "-50.00",
      paymentType: "refund",
    });

    // Same parent, same companyId, same amount, same reason → same key.
    setParentRow({
      id: "pay_1",
      companyId: "co_1",
      invoiceId: "inv_1",
      amount: "100.00",
      method: "credit",
      paymentType: "payment",
      providerSource: "stripe",
      reference: "ch_test_1",
      // 2026-05-03 PR4 — refund flow now requires the parent's
      // connected-account attribution to route the refund call.
      providerAccountId: "acct_test_1",
      paymentProviderAccountId: "ppa_test_1",
    });
    (paymentRepository.assertRefundAmountWithinParent as any).mockResolvedValueOnce(
      undefined,
    );

    await paymentApplicationService.refundPayment({
      companyId: "co_1",
      parentPaymentId: "pay_1",
      amount: "50.00",
      reason: "duplicate",
    });

    setParentRow({
      id: "pay_1",
      companyId: "co_1",
      invoiceId: "inv_1",
      amount: "100.00",
      method: "credit",
      paymentType: "payment",
      providerSource: "stripe",
      reference: "ch_test_1",
      // 2026-05-03 PR4 — refund flow now requires the parent's
      // connected-account attribution to route the refund call.
      providerAccountId: "acct_test_1",
      paymentProviderAccountId: "ppa_test_1",
    });
    (paymentRepository.assertRefundAmountWithinParent as any).mockResolvedValueOnce(
      undefined,
    );

    await paymentApplicationService.refundPayment({
      companyId: "co_1",
      parentPaymentId: "pay_1",
      amount: "50.00",
      reason: "duplicate",
    });

    expect(stripeAdapter.refundPayment).toHaveBeenCalledTimes(2);
    const key1 = (stripeAdapter.refundPayment as any).mock.calls[0][0]
      .idempotencyKey;
    const key2 = (stripeAdapter.refundPayment as any).mock.calls[1][0]
      .idempotencyKey;
    expect(key1).toBe(key2);
    expect(key1).toMatch(/^syntraro_refund_/);
  });
});
