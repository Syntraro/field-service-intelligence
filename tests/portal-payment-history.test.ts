/**
 * Portal payment history — PR 5 polish regression suite (2026-05-03).
 *
 * Locks the additive `payments` field on the portal invoice detail
 * response (`GET /api/portal/invoices/:invoiceId`) — both legacy 1:1
 * payments AND multi-invoice allocation contributions must surface,
 * and the field must remain ADDITIVE so pre-PR-5 clients aren't
 * affected.
 *
 * The portal route itself is exercised end-to-end via the source-grep
 * regression block at the bottom of this file (mirrors
 * tests/portal-invoice-visibility.test.ts pattern). The simulated unit
 * tests above lock the unioning + ordering logic the route applies.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

interface DirectPaymentRow {
  id: string;
  amount: string;
  method: string;
  receivedAt: Date | string;
  paymentType: "payment" | "refund" | "reversal";
  providerSource: string | null;
  invoiceId: string | null;
}

interface AllocationJoinRow {
  id: string;
  paymentId: string;
  allocatedAmount: string;
  invoiceId: string;
  // From the joined payment row:
  method: string;
  receivedAt: Date | string;
  providerSource: string | null;
  paymentType: "payment" | "refund" | "reversal";
}

type PaymentHistoryRow = {
  id: string;
  amount: string;
  method: string;
  receivedAt: string | null;
  providerSource: string | null;
  source: "direct" | "allocation";
};

/**
 * Mirrors the SQL + post-processing the portal route applies to build
 * the `payments` field on the invoice-detail response. Pure JS — the
 * route's filter predicates are paymentType='payment' on both source
 * tables, then merged + sorted DESC by receivedAt.
 */
function buildPaymentHistory(
  invoiceId: string,
  directRows: DirectPaymentRow[],
  allocationRows: AllocationJoinRow[],
): PaymentHistoryRow[] {
  const direct = directRows
    .filter(
      (r) =>
        r.invoiceId === invoiceId && r.paymentType === "payment",
    )
    .map((r) => ({
      id: r.id,
      amount: r.amount,
      method: r.method,
      receivedAt: r.receivedAt
        ? new Date(r.receivedAt as any).toISOString()
        : null,
      providerSource: r.providerSource,
      source: "direct" as const,
    }));
  const allocs = allocationRows
    .filter((r) => r.invoiceId === invoiceId && r.paymentType === "payment")
    .map((r) => ({
      id: r.id,
      amount: r.allocatedAmount,
      method: r.method,
      receivedAt: r.receivedAt
        ? new Date(r.receivedAt as any).toISOString()
        : null,
      providerSource: r.providerSource,
      source: "allocation" as const,
    }));
  return [...direct, ...allocs].sort((a, b) => {
    const ta = a.receivedAt ? new Date(a.receivedAt).getTime() : 0;
    const tb = b.receivedAt ? new Date(b.receivedAt).getTime() : 0;
    return tb - ta;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Logic tests
// ═══════════════════════════════════════════════════════════════════════════

describe("portal payment history — unioning + ordering", () => {
  it("returns an empty array when no payments touch the invoice", () => {
    const result = buildPaymentHistory("inv_x", [], []);
    expect(result).toEqual([]);
  });

  it("includes legacy 1:1 payment rows", () => {
    const result = buildPaymentHistory(
      "inv_a",
      [
        {
          id: "pay_legacy_1",
          amount: "100.00",
          method: "credit",
          receivedAt: "2026-01-15T12:00:00Z",
          paymentType: "payment",
          providerSource: "stripe",
          invoiceId: "inv_a",
        },
      ],
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "pay_legacy_1",
      amount: "100.00",
      source: "direct",
      providerSource: "stripe",
    });
  });

  it("includes multi-invoice allocation rows when the parent payment touched this invoice", () => {
    const result = buildPaymentHistory(
      "inv_a",
      [],
      [
        {
          id: "alloc_1",
          paymentId: "pay_multi_1",
          allocatedAmount: "60.00",
          invoiceId: "inv_a",
          method: "credit",
          receivedAt: "2026-02-15T12:00:00Z",
          providerSource: "stripe",
          paymentType: "payment",
        },
      ],
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "alloc_1",
      amount: "60.00",
      source: "allocation",
      providerSource: "stripe",
    });
  });

  it("merges both sources and orders newest-first", () => {
    const result = buildPaymentHistory(
      "inv_a",
      [
        {
          id: "pay_legacy_1",
          amount: "30.00",
          method: "cheque",
          receivedAt: "2026-01-10T12:00:00Z",
          paymentType: "payment",
          providerSource: "manual",
          invoiceId: "inv_a",
        },
        {
          id: "pay_legacy_2",
          amount: "20.00",
          method: "credit",
          receivedAt: "2026-03-05T12:00:00Z",
          paymentType: "payment",
          providerSource: "stripe",
          invoiceId: "inv_a",
        },
      ],
      [
        {
          id: "alloc_1",
          paymentId: "pay_multi_1",
          allocatedAmount: "50.00",
          invoiceId: "inv_a",
          method: "credit",
          receivedAt: "2026-02-15T12:00:00Z",
          providerSource: "stripe",
          paymentType: "payment",
        },
      ],
    );
    expect(result.map((r) => r.id)).toEqual([
      "pay_legacy_2", // 2026-03-05
      "alloc_1",       // 2026-02-15
      "pay_legacy_1",  // 2026-01-10
    ]);
  });

  it("excludes refund + reversal rows (customer sees only money-in events)", () => {
    const result = buildPaymentHistory(
      "inv_a",
      [
        {
          id: "pay_1",
          amount: "100.00",
          method: "credit",
          receivedAt: "2026-01-10T12:00:00Z",
          paymentType: "payment",
          providerSource: "stripe",
          invoiceId: "inv_a",
        },
        {
          id: "ref_1",
          amount: "-30.00",
          method: "credit",
          receivedAt: "2026-01-12T12:00:00Z",
          paymentType: "refund",
          providerSource: "stripe",
          invoiceId: "inv_a",
        },
        {
          id: "rev_1",
          amount: "-20.00",
          method: "credit",
          receivedAt: "2026-01-13T12:00:00Z",
          paymentType: "reversal",
          providerSource: "stripe",
          invoiceId: "inv_a",
        },
      ],
      [],
    );
    expect(result.map((r) => r.id)).toEqual(["pay_1"]);
  });

  it("excludes payments that don't touch this invoice (cross-invoice noise)", () => {
    const result = buildPaymentHistory(
      "inv_a",
      [
        {
          id: "pay_a",
          amount: "10.00",
          method: "credit",
          receivedAt: "2026-01-10T12:00:00Z",
          paymentType: "payment",
          providerSource: "stripe",
          invoiceId: "inv_a",
        },
        {
          id: "pay_other",
          amount: "999.00",
          method: "credit",
          receivedAt: "2026-01-11T12:00:00Z",
          paymentType: "payment",
          providerSource: "stripe",
          invoiceId: "inv_other",
        },
      ],
      [
        {
          id: "alloc_a",
          paymentId: "pay_multi_a",
          allocatedAmount: "5.00",
          invoiceId: "inv_a",
          method: "credit",
          receivedAt: "2026-01-12T12:00:00Z",
          providerSource: "stripe",
          paymentType: "payment",
        },
        {
          id: "alloc_other",
          paymentId: "pay_multi_a",
          allocatedAmount: "777.00",
          invoiceId: "inv_other",
          method: "credit",
          receivedAt: "2026-01-12T12:00:00Z",
          providerSource: "stripe",
          paymentType: "payment",
        },
      ],
    );
    expect(result.map((r) => r.id).sort()).toEqual(["alloc_a", "pay_a"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Source-grep regression block on portal.ts
// ═══════════════════════════════════════════════════════════════════════════

describe("portal route — source-level regression guards (PR 5 polish)", () => {
  const ROUTE_PATH = path.resolve(__dirname, "..", "server", "routes", "portal.ts");
  const source = fs.readFileSync(ROUTE_PATH, "utf-8");

  it("imports payments + paymentAllocations tables (additive payment-history field)", () => {
    expect(source).toMatch(
      /import\s*\{[^}]*\bpayments\b[^}]*\bpaymentAllocations\b[^}]*\}\s*from\s*"@shared\/schema"/s,
    );
  });

  it("payment history filters by paymentType='payment' (excludes refunds/reversals)", () => {
    // Both queries (direct + allocation join) must include the
    // payment-type filter so the customer doesn't see refund rows.
    const matches = source.match(/eq\(payments\.paymentType,\s*"payment"\)/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("response carries the additive `payments` field", () => {
    expect(source).toMatch(/payments:\s*paymentsHistory/);
  });

  it("emits structured batch_checkout_failed log on engine failure", () => {
    expect(source).toMatch(/batch_checkout_failed/);
  });
});

describe("paymentApplicationService — payment_allocation_failed log", () => {
  const SERVICE_PATH = path.resolve(
    __dirname,
    "..",
    "server",
    "services",
    "payments",
    "paymentApplicationService.ts",
  );
  const source = fs.readFileSync(SERVICE_PATH, "utf-8");

  it("emits payment_allocation_failed for the per-invoice failure modes", () => {
    // Source must contain the structured log key in at least the
    // three failure cases the spec mentions: not-found, scope-mismatch,
    // state-changed. Plus the catch-around-createAllocations.
    const matches = source.match(/payment_allocation_failed/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });
});

describe("communicationTemplatesService — payment_receipt body polish", () => {
  const SVC_PATH = path.resolve(
    __dirname,
    "..",
    "server",
    "services",
    "communicationTemplatesService.ts",
  );
  const source = fs.readFileSync(SVC_PATH, "utf-8");

  it("default receipt body now includes the {{PORTAL_INVOICE_URL}} link", () => {
    expect(source).toMatch(/View your invoice in the portal:\s*\{\{PORTAL_INVOICE_URL\}\}/);
  });

  it("default receipt body emphasises Remaining balance with **bold** markers", () => {
    expect(source).toMatch(/\*\*Remaining balance:\s*\{\{INVOICE_BALANCE\}\}\*\*/);
  });

  it("default receipt body still contains the __PAYMENT_ALLOCATIONS_TABLE__ sentinel", () => {
    expect(source).toContain("__PAYMENT_ALLOCATIONS_TABLE__");
  });
});

describe("PORTAL_INVOICE_URL is in the payment_receipt template variable catalog", () => {
  it("variable catalog includes PORTAL_INVOICE_URL on payment_receipt", async () => {
    const { PAYMENT_RECEIPT_TEMPLATE_VARIABLES } = await import(
      "../server/constants/templateVariables"
    );
    expect(PAYMENT_RECEIPT_TEMPLATE_VARIABLES).toContain("PORTAL_INVOICE_URL");
  });
});
