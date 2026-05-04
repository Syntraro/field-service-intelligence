/**
 * Payout webhook dispatch — PR 5 mock suite (2026-05-04).
 *
 * Tests `applyVerifiedWebhookBatch` with payout_* events. The
 * application service's `handlePayoutEvent` is exercised end-to-end
 * with mocked repositories.
 *
 * Why a separate file from `payment-payouts.test.ts`:
 *   `vi.mock` is hoisted globally, so once we mock the repository
 *   the integration tests in the same file can no longer reach the
 *   real DB. Splitting keeps each file's universe consistent.
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
import { paymentPayoutsRepository as payoutsMock } from "../server/storage/paymentPayouts";
import { paymentProviderAccountsRepository as accountsMock } from "../server/storage/paymentProviderAccounts";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("applyVerifiedWebhookBatch — payout dispatch", () => {
  const baseEvent = {
    eventId: "evt_payout_1",
    eventType: "payout.created",
    providerAccountId: "acct_test_1",
    providerPayoutId: "po_test_1",
    amountCents: 12345,
    currency: "usd",
    status: "pending" as const,
    arrivalDate: "2026-05-10T00:00:00.000Z",
    destinationLast4: "4242",
    failureCode: null,
    failureMessage: null,
    rawProviderStatus: "pending",
  };

  it("payout_created with known account → upsert + accepted", async () => {
    (accountsMock.getByProviderAndProviderAccountId as any).mockResolvedValueOnce({
      id: "ppa_test_1",
      companyId: "co_1",
      provider: "stripe",
      providerAccountId: "acct_test_1",
    });
    (payoutsMock.upsertFromProviderEvent as any).mockResolvedValueOnce({
      id: "ppo_1",
    });

    const result = await paymentApplicationService.applyVerifiedWebhookBatch(
      "stripe",
      [{ ...baseEvent, kind: "payout_created" }],
    );

    expect(result.accepted).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    expect(payoutsMock.upsertFromProviderEvent).toHaveBeenCalledTimes(1);
    expect(payoutsMock.upsertFromProviderEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "co_1",
        paymentProviderAccountId: "ppa_test_1",
        providerAccountId: "acct_test_1",
        providerPayoutId: "po_test_1",
        amount: "123.45",
        currency: "usd",
        status: "pending",
        destinationLast4: "4242",
        rawProviderStatus: "pending",
      }),
    );
  });

  it("payout_paid with known account → status updated", async () => {
    (accountsMock.getByProviderAndProviderAccountId as any).mockResolvedValueOnce({
      id: "ppa_test_1",
      companyId: "co_1",
      provider: "stripe",
      providerAccountId: "acct_test_1",
    });
    (payoutsMock.upsertFromProviderEvent as any).mockResolvedValueOnce({
      id: "ppo_1",
    });

    const result = await paymentApplicationService.applyVerifiedWebhookBatch(
      "stripe",
      [
        {
          ...baseEvent,
          kind: "payout_paid",
          eventType: "payout.paid",
          status: "paid",
          rawProviderStatus: "paid",
        },
      ],
    );

    expect(result.accepted).toHaveLength(1);
    const args = (payoutsMock.upsertFromProviderEvent as any).mock.calls[0][0];
    expect(args.status).toBe("paid");
  });

  it("payout_failed records failure code + message", async () => {
    (accountsMock.getByProviderAndProviderAccountId as any).mockResolvedValueOnce({
      id: "ppa_test_1",
      companyId: "co_1",
      provider: "stripe",
      providerAccountId: "acct_test_1",
    });
    (payoutsMock.upsertFromProviderEvent as any).mockResolvedValueOnce({
      id: "ppo_1",
    });

    const result = await paymentApplicationService.applyVerifiedWebhookBatch(
      "stripe",
      [
        {
          ...baseEvent,
          kind: "payout_failed",
          eventType: "payout.failed",
          status: "failed",
          failureCode: "account_closed",
          failureMessage: "The bank account has been closed.",
          rawProviderStatus: "failed",
        },
      ],
    );

    expect(result.accepted).toHaveLength(1);
    const args = (payoutsMock.upsertFromProviderEvent as any).mock.calls[0][0];
    expect(args.status).toBe("failed");
    expect(args.failureCode).toBe("account_closed");
    expect(args.failureMessage).toBe("The bank account has been closed.");
  });

  it("missing provider account → ACK + skipped + no upsert", async () => {
    (accountsMock.getByProviderAndProviderAccountId as any).mockResolvedValueOnce(
      null,
    );

    const result = await paymentApplicationService.applyVerifiedWebhookBatch(
      "stripe",
      [{ ...baseEvent, kind: "payout_created" }],
    );

    expect(result.ignored).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    expect(payoutsMock.upsertFromProviderEvent).not.toHaveBeenCalled();
  });

  it("transient repo failure propagates as WebhookTransientFailureError", async () => {
    (accountsMock.getByProviderAndProviderAccountId as any).mockResolvedValueOnce({
      id: "ppa_test_1",
      companyId: "co_1",
      provider: "stripe",
      providerAccountId: "acct_test_1",
    });
    (payoutsMock.upsertFromProviderEvent as any).mockRejectedValueOnce(
      new Error("connection terminated"),
    );

    await expect(
      paymentApplicationService.applyVerifiedWebhookBatch("stripe", [
        { ...baseEvent, kind: "payout_created" },
      ]),
    ).rejects.toBeInstanceOf(WebhookTransientFailureError);
  });
});
