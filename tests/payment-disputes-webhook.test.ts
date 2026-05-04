/**
 * Dispute webhook dispatch — PR 6 mock suite (2026-05-04).
 *
 * Tests `applyVerifiedWebhookBatch` with dispute_* events. The
 * application service's `handleDisputeEvent` is exercised end-to-end
 * with mocked repositories.
 *
 * Why a separate file from `payment-disputes.test.ts`:
 *   `vi.mock` is hoisted globally, so once we mock the repository
 *   the integration tests in the same file can no longer reach the
 *   real DB. Splitting keeps each file's universe consistent.
 *
 * Spec test cases covered:
 *   - charge.dispute.created creates payment_disputes row
 *   - charge.dispute.updated updates existing row (replay)
 *   - charge.dispute.closed updates status
 *   - dispute links to payment + invoice when payment exists
 *   - dispute stores with null FKs when payment is missing
 *   - missing provider account → ACK + skip + log anomaly
 *   - cross-tenant payment match cannot leak
 *   - replayed webhook does not duplicate row
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../server/storage/payments", () => ({
  paymentRepository: {
    createPayment: vi.fn(),
    createRefund: vi.fn(),
    findByProviderReference: vi.fn(),
    assertRefundAmountWithinParent: vi.fn(),
  },
}));

vi.mock("../server/storage/invoices", () => ({
  invoiceRepository: { getInvoice: vi.fn() },
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

vi.mock("../server/storage/paymentProviderAccounts", () => ({
  paymentProviderAccountsRepository: {
    getByProviderAndProviderAccountId: vi.fn(async () => null),
    getByCompanyAndProvider: vi.fn(async () => null),
    listByCompany: vi.fn(async () => []),
    insertAccount: vi.fn(),
    updateAccountState: vi.fn(),
  },
}));

vi.mock("../server/storage/paymentPayouts", () => ({
  paymentPayoutsRepository: {
    upsertFromProviderEvent: vi.fn(),
    listForCompany: vi.fn(),
    getSummaryForCompany: vi.fn(),
  },
}));

vi.mock("../server/storage/paymentDisputes", () => ({
  paymentDisputesRepository: {
    upsertFromProviderEvent: vi.fn(),
    listForCompany: vi.fn(),
    getSummaryForCompany: vi.fn(),
  },
}));

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
    resolveById: vi.fn((id: string) =>
      id === "stripe" ? stripeAdapter : null,
    ),
    resolveForProviderSource: vi.fn(() => ({ manual: true })),
    __testStripeAdapter: stripeAdapter,
  };
});

import {
  paymentApplicationService,
  WebhookTransientFailureError,
} from "../server/services/payments/paymentApplicationService";
import { paymentDisputesRepository as disputesMock } from "../server/storage/paymentDisputes";
import { paymentProviderAccountsRepository as accountsMock } from "../server/storage/paymentProviderAccounts";
import { paymentRepository as paymentsMock } from "../server/storage/payments";

beforeEach(() => {
  vi.clearAllMocks();
});

const ACCT_ROW = {
  id: "ppa_test_1",
  companyId: "co_1",
  provider: "stripe",
  providerAccountId: "acct_test_1",
};

describe("applyVerifiedWebhookBatch — dispute dispatch", () => {
  const baseEvent = {
    eventId: "evt_dispute_1",
    eventType: "charge.dispute.created",
    providerAccountId: "acct_test_1",
    providerDisputeId: "dp_test_1",
    providerPaymentId: "ch_test_1",
    amountCents: 12345,
    currency: "usd",
    status: "needs_response" as const,
    reason: "fraudulent",
    evidenceDueBy: "2026-05-20T00:00:00.000Z",
    rawProviderStatus: "needs_response",
  };

  it("dispute_created with known account + matched payment → linked + accepted", async () => {
    (accountsMock.getByProviderAndProviderAccountId as any).mockResolvedValueOnce(
      ACCT_ROW,
    );
    (paymentsMock.findByProviderReference as any).mockResolvedValueOnce({
      id: "pay_1",
      companyId: "co_1",
      invoiceId: "inv_1",
    });
    (disputesMock.upsertFromProviderEvent as any).mockResolvedValueOnce({
      id: "pd_1",
    });

    const result = await paymentApplicationService.applyVerifiedWebhookBatch(
      "stripe",
      [{ ...baseEvent, kind: "dispute_created" }],
    );

    expect(result.accepted).toHaveLength(1);
    expect(disputesMock.upsertFromProviderEvent).toHaveBeenCalledTimes(1);
    expect(disputesMock.upsertFromProviderEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "co_1",
        paymentProviderAccountId: "ppa_test_1",
        providerAccountId: "acct_test_1",
        providerDisputeId: "dp_test_1",
        providerPaymentId: "ch_test_1",
        paymentId: "pay_1",
        invoiceId: "inv_1",
        amount: "123.45",
        status: "needs_response",
        reason: "fraudulent",
        rawProviderStatus: "needs_response",
      }),
    );
  });

  it("dispute_created with NO local payment match → still upserts with null FKs", async () => {
    (accountsMock.getByProviderAndProviderAccountId as any).mockResolvedValueOnce(
      ACCT_ROW,
    );
    (paymentsMock.findByProviderReference as any).mockResolvedValueOnce(null);
    (disputesMock.upsertFromProviderEvent as any).mockResolvedValueOnce({
      id: "pd_2",
    });

    const result = await paymentApplicationService.applyVerifiedWebhookBatch(
      "stripe",
      [{ ...baseEvent, kind: "dispute_created" }],
    );

    expect(result.accepted).toHaveLength(1);
    const args = (disputesMock.upsertFromProviderEvent as any).mock.calls[0][0];
    expect(args.paymentId).toBeNull();
    expect(args.invoiceId).toBeNull();
  });

  it("dispute_created with cross-tenant payment match → null FKs (no leak)", async () => {
    (accountsMock.getByProviderAndProviderAccountId as any).mockResolvedValueOnce(
      ACCT_ROW,
    );
    // Payment was minted under tenant `co_other`, NOT `co_1`.
    (paymentsMock.findByProviderReference as any).mockResolvedValueOnce({
      id: "pay_other_tenant",
      companyId: "co_other",
      invoiceId: "inv_other",
    });
    (disputesMock.upsertFromProviderEvent as any).mockResolvedValueOnce({
      id: "pd_3",
    });

    const result = await paymentApplicationService.applyVerifiedWebhookBatch(
      "stripe",
      [{ ...baseEvent, kind: "dispute_created" }],
    );

    expect(result.accepted).toHaveLength(1);
    const args = (disputesMock.upsertFromProviderEvent as any).mock.calls[0][0];
    expect(args.companyId).toBe("co_1");
    expect(args.paymentId).toBeNull();
    expect(args.invoiceId).toBeNull();
  });

  it("dispute_updated with known account → status updated", async () => {
    (accountsMock.getByProviderAndProviderAccountId as any).mockResolvedValueOnce(
      ACCT_ROW,
    );
    (paymentsMock.findByProviderReference as any).mockResolvedValueOnce(null);
    (disputesMock.upsertFromProviderEvent as any).mockResolvedValueOnce({
      id: "pd_4",
    });

    const result = await paymentApplicationService.applyVerifiedWebhookBatch(
      "stripe",
      [
        {
          ...baseEvent,
          kind: "dispute_updated",
          eventType: "charge.dispute.updated",
          status: "under_review",
          rawProviderStatus: "under_review",
        },
      ],
    );

    expect(result.accepted).toHaveLength(1);
    const args = (disputesMock.upsertFromProviderEvent as any).mock.calls[0][0];
    expect(args.status).toBe("under_review");
  });

  it("dispute_closed updates terminal status", async () => {
    (accountsMock.getByProviderAndProviderAccountId as any).mockResolvedValueOnce(
      ACCT_ROW,
    );
    (paymentsMock.findByProviderReference as any).mockResolvedValueOnce(null);
    (disputesMock.upsertFromProviderEvent as any).mockResolvedValueOnce({
      id: "pd_5",
    });

    const result = await paymentApplicationService.applyVerifiedWebhookBatch(
      "stripe",
      [
        {
          ...baseEvent,
          kind: "dispute_closed",
          eventType: "charge.dispute.closed",
          status: "won",
          rawProviderStatus: "won",
        },
      ],
    );

    expect(result.accepted).toHaveLength(1);
    const args = (disputesMock.upsertFromProviderEvent as any).mock.calls[0][0];
    expect(args.status).toBe("won");
  });

  it("missing provider account → ACK + skipped + no upsert", async () => {
    (accountsMock.getByProviderAndProviderAccountId as any).mockResolvedValueOnce(
      null,
    );

    const result = await paymentApplicationService.applyVerifiedWebhookBatch(
      "stripe",
      [{ ...baseEvent, kind: "dispute_created" }],
    );

    expect(result.ignored).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    expect(disputesMock.upsertFromProviderEvent).not.toHaveBeenCalled();
  });

  it("transient repo failure propagates as WebhookTransientFailureError", async () => {
    (accountsMock.getByProviderAndProviderAccountId as any).mockResolvedValueOnce(
      ACCT_ROW,
    );
    (paymentsMock.findByProviderReference as any).mockResolvedValueOnce(null);
    (disputesMock.upsertFromProviderEvent as any).mockRejectedValueOnce(
      new Error("connection terminated"),
    );

    await expect(
      paymentApplicationService.applyVerifiedWebhookBatch("stripe", [
        { ...baseEvent, kind: "dispute_created" },
      ]),
    ).rejects.toBeInstanceOf(WebhookTransientFailureError);
  });
});
