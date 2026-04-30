/**
 * Provider-linked update guard — regression suite (2026-04-29 Stripe completion)
 *
 * Pins the rule that financial fields (amount, method, receivedAt) on a
 * provider-linked payment row (Stripe-synced or QBO-synced) cannot be
 * mutated locally. The Stripe writer treats the provider as the source
 * of truth for those values; allowing a local edit would silently
 * desync the ledger from the provider.
 *
 * Free-text metadata (reference, notes) remains editable so operators
 * can annotate provider-linked rows without breaking reconciliation.
 *
 * Tests mock `db.transaction` so the suite is fast and deterministic
 * without touching a real Postgres instance.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// db.transaction is the only db-level surface paymentRepository.updatePayment
// touches. We give it a controllable fake that delegates to our per-test tx.
vi.mock("../server/db", () => ({
  db: {
    transaction: vi.fn(),
  },
}));

import { paymentRepository } from "../server/storage/payments";
import { db } from "../server/db";

type SelectChain = {
  from: (..._args: unknown[]) => SelectChain;
  where: (..._args: unknown[]) => SelectChain;
  limit: (..._args: unknown[]) => Promise<unknown[]>;
};

type UpdateChain = {
  set: (..._args: unknown[]) => UpdateChain;
  where: (..._args: unknown[]) => UpdateChain;
  returning: (..._args: unknown[]) => Promise<unknown[]>;
};

/**
 * Build a fake tx whose `select` returns `paymentRow` once, then the
 * post-update row from `updateRow`. The payment-balance-recalc step
 * inside `updatePayment` re-selects the invoice row and the payment
 * children — for those, we return empty arrays which leaves the
 * recalc as a no-op (the invoice id is `inv_1`; we don't track its row
 * here because the recalc query short-circuits when no invoice is found).
 */
function makeTxWithPayment(
  paymentRow: Record<string, unknown>,
  updateRow: Record<string, unknown> = {},
) {
  let selectCall = 0;
  const tx = {
    select: vi.fn(() => {
      selectCall += 1;
      const chain: SelectChain = {
        from: () => chain,
        where: () => chain,
        limit: () => {
          // First select inside updatePayment loads the payment row;
          // subsequent selects (during recalculateInvoiceBalance) load
          // the invoice + the SUM(amount). Returning [] for those is
          // the cleanest no-op — the recalc bails when invoice is null.
          if (selectCall === 1) return Promise.resolve([paymentRow]);
          return Promise.resolve([]);
        },
      };
      return chain;
    }),
    update: vi.fn(() => {
      const chain: UpdateChain = {
        set: () => chain,
        where: () => chain,
        returning: () =>
          Promise.resolve([{ ...paymentRow, ...updateRow }]),
      };
      return chain;
    }),
  };
  return tx;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("paymentRepository.updatePayment — provider-linked guard", () => {
  it("blocks amount edits on a Stripe-linked payment row (400)", async () => {
    const stripeRow = {
      id: "00000000-0000-4000-8000-000000000001",
      companyId: "co_1",
      invoiceId: "inv_1",
      amount: "100.00",
      method: "credit",
      providerSource: "stripe",
      providerEventId: "evt_1",
      qboPaymentId: null,
      receivedAt: new Date(),
    };
    (db.transaction as any).mockImplementation((cb: (tx: any) => unknown) =>
      cb(makeTxWithPayment(stripeRow)),
    );

    await expect(
      paymentRepository.updatePayment("co_1", "00000000-0000-4000-8000-000000000001", {
        amount: "200.00",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("blocks method edits on a Stripe-linked payment row", async () => {
    const stripeRow = {
      id: "00000000-0000-4000-8000-000000000001",
      companyId: "co_1",
      invoiceId: "inv_1",
      amount: "100.00",
      method: "credit",
      providerSource: "stripe",
      providerEventId: "evt_1",
      qboPaymentId: null,
      receivedAt: new Date(),
    };
    (db.transaction as any).mockImplementation((cb: (tx: any) => unknown) =>
      cb(makeTxWithPayment(stripeRow)),
    );

    await expect(
      paymentRepository.updatePayment("co_1", "00000000-0000-4000-8000-000000000001", {
        method: "cash",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("blocks receivedAt edits on a Stripe-linked payment row", async () => {
    const stripeRow = {
      id: "00000000-0000-4000-8000-000000000001",
      companyId: "co_1",
      invoiceId: "inv_1",
      amount: "100.00",
      method: "credit",
      providerSource: "stripe",
      providerEventId: "evt_1",
      qboPaymentId: null,
      receivedAt: new Date(),
    };
    (db.transaction as any).mockImplementation((cb: (tx: any) => unknown) =>
      cb(makeTxWithPayment(stripeRow)),
    );

    await expect(
      paymentRepository.updatePayment("co_1", "00000000-0000-4000-8000-000000000001", {
        receivedAt: new Date().toISOString(),
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("blocks the same edits on a QBO-linked payment row", async () => {
    const qboRow = {
      id: "00000000-0000-4000-8000-000000000002",
      companyId: "co_1",
      invoiceId: "inv_1",
      amount: "75.00",
      method: "credit",
      providerSource: "qbo",
      providerEventId: null,
      qboPaymentId: "QBO-123",
      receivedAt: new Date(),
    };
    (db.transaction as any).mockImplementation((cb: (tx: any) => unknown) =>
      cb(makeTxWithPayment(qboRow)),
    );

    await expect(
      paymentRepository.updatePayment("co_1", "00000000-0000-4000-8000-000000000002", {
        amount: "10.00",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("blocks edits on a legacy QBO-linked row (qboPaymentId set, providerSource still 'manual')", async () => {
    // Pre-Phase-3 row: providerSource hasn't been backfilled but
    // qboPaymentId is the legacy provider-linkage signal.
    const legacyQboRow = {
      id: "00000000-0000-4000-8000-000000000003",
      companyId: "co_1",
      invoiceId: "inv_1",
      amount: "60.00",
      method: "credit",
      providerSource: "manual",
      providerEventId: null,
      qboPaymentId: "QBO-LEGACY",
      receivedAt: new Date(),
    };
    (db.transaction as any).mockImplementation((cb: (tx: any) => unknown) =>
      cb(makeTxWithPayment(legacyQboRow)),
    );

    await expect(
      paymentRepository.updatePayment("co_1", "00000000-0000-4000-8000-000000000003", {
        amount: "5.00",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("ALLOWS reference edits on a Stripe-linked payment row (metadata only)", async () => {
    const stripeRow = {
      id: "00000000-0000-4000-8000-000000000001",
      companyId: "co_1",
      invoiceId: "inv_1",
      amount: "100.00",
      method: "credit",
      providerSource: "stripe",
      providerEventId: "evt_1",
      qboPaymentId: null,
      receivedAt: new Date(),
      reference: "ch_test_1",
    };
    (db.transaction as any).mockImplementation((cb: (tx: any) => unknown) =>
      cb(makeTxWithPayment(stripeRow, { reference: "ch_test_1 (annotated)" })),
    );

    await expect(
      paymentRepository.updatePayment("co_1", "00000000-0000-4000-8000-000000000001", {
        reference: "ch_test_1 (annotated)",
      }),
    ).resolves.toBeDefined();
  });

  it("ALLOWS notes edits on a Stripe-linked payment row (metadata only)", async () => {
    const stripeRow = {
      id: "00000000-0000-4000-8000-000000000001",
      companyId: "co_1",
      invoiceId: "inv_1",
      amount: "100.00",
      method: "credit",
      providerSource: "stripe",
      providerEventId: "evt_1",
      qboPaymentId: null,
      receivedAt: new Date(),
      notes: null,
    };
    (db.transaction as any).mockImplementation((cb: (tx: any) => unknown) =>
      cb(makeTxWithPayment(stripeRow, { notes: "ops note: chargeback dispute filed" })),
    );

    await expect(
      paymentRepository.updatePayment("co_1", "00000000-0000-4000-8000-000000000001", {
        notes: "ops note: chargeback dispute filed",
      }),
    ).resolves.toBeDefined();
  });

  it("ALLOWS amount edits on a manual (provider-unlinked) payment row", async () => {
    const manualRow = {
      id: "00000000-0000-4000-8000-000000000004",
      companyId: "co_1",
      invoiceId: "inv_1",
      amount: "50.00",
      method: "cheque",
      providerSource: "manual",
      providerEventId: null,
      qboPaymentId: null,
      receivedAt: new Date(),
    };
    (db.transaction as any).mockImplementation((cb: (tx: any) => unknown) =>
      cb(makeTxWithPayment(manualRow, { amount: "60.00" })),
    );

    await expect(
      paymentRepository.updatePayment("co_1", "00000000-0000-4000-8000-000000000004", {
        amount: "60.00",
      }),
    ).resolves.toBeDefined();
  });

  it("rejects when the payment row does not exist", async () => {
    (db.transaction as any).mockImplementation((cb: (tx: any) => unknown) => {
      const tx = {
        select: vi.fn(() => ({
          from: () => ({
            where: () => ({ limit: () => Promise.resolve([]) }),
          }),
        })),
        update: vi.fn(),
      };
      return cb(tx);
    });

    await expect(
      paymentRepository.updatePayment("co_1", "00000000-0000-4000-8000-000000000099", {
        notes: "anything",
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
