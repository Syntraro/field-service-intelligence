/**
 * Refund visibility predicates — pure logic regression suite.
 *
 * Locks the rules behind the per-row Refund affordance on the Invoice
 * Detail Payment History card. The same helper is the seed for the
 * RefundPaymentDialog's "remaining refundable" default.
 *
 * These predicates are UX hints; the canonical authority on refund caps
 * is `paymentRepository.assertRefundAmountWithinParent` server-side.
 * The tests below pin the visibility contract so the button never
 * encourages the user toward a request the server will reject.
 */

import { describe, it, expect } from "vitest";
import {
  computeAlreadyOffset,
  isPaymentRefundable,
  remainingRefundable,
  type RefundabilityRow,
} from "@shared/paymentRefundability";

const parent = (id: string, amount: string): RefundabilityRow => ({
  id,
  amount,
  paymentType: "payment",
  parentPaymentId: null,
});

const refund = (
  parentId: string,
  amount: string,
  id = `r_${parentId}`,
): RefundabilityRow => ({
  id,
  amount,
  paymentType: "refund",
  parentPaymentId: parentId,
});

const reversal = (
  parentId: string,
  amount: string,
  id = `v_${parentId}`,
): RefundabilityRow => ({
  id,
  amount,
  paymentType: "reversal",
  parentPaymentId: parentId,
});

describe("computeAlreadyOffset", () => {
  it("returns 0 when no children are attached", () => {
    const rows = [parent("p1", "100.00")];
    expect(computeAlreadyOffset("p1", rows)).toBe(0);
  });

  it("sums absolute values of refunds and reversals", () => {
    const rows = [
      parent("p1", "100.00"),
      refund("p1", "-30.00"),
      reversal("p1", "-20.00"),
    ];
    expect(computeAlreadyOffset("p1", rows)).toBeCloseTo(50, 9);
  });

  it("ignores children of unrelated parents", () => {
    const rows = [
      parent("p1", "100.00"),
      parent("p2", "50.00"),
      refund("p2", "-25.00"),
    ];
    expect(computeAlreadyOffset("p1", rows)).toBe(0);
    expect(computeAlreadyOffset("p2", rows)).toBeCloseTo(25, 9);
  });

  it("treats malformed amounts as zero (defensive)", () => {
    const rows = [
      parent("p1", "100.00"),
      { id: "junk", amount: "not-a-number", paymentType: "refund", parentPaymentId: "p1" },
    ];
    expect(computeAlreadyOffset("p1", rows)).toBe(0);
  });
});

describe("isPaymentRefundable", () => {
  it("is true for a parent payment with no refunds", () => {
    const p = parent("p1", "100.00");
    expect(isPaymentRefundable(p, [p])).toBe(true);
  });

  it("is true for a parent partially refunded", () => {
    const p = parent("p1", "100.00");
    const rows = [p, refund("p1", "-40.00")];
    expect(isPaymentRefundable(p, rows)).toBe(true);
  });

  it("is false when refunds equal parent amount (fully offset)", () => {
    const p = parent("p1", "100.00");
    const rows = [p, refund("p1", "-100.00")];
    expect(isPaymentRefundable(p, rows)).toBe(false);
  });

  it("is false when reversal+refund jointly cover parent", () => {
    const p = parent("p1", "100.00");
    const rows = [
      p,
      refund("p1", "-60.00"),
      reversal("p1", "-40.00"),
    ];
    expect(isPaymentRefundable(p, rows)).toBe(false);
  });

  it("is false for refund/reversal child rows themselves", () => {
    const p = parent("p1", "100.00");
    const r = refund("p1", "-30.00");
    const v = reversal("p1", "-20.00");
    const rows = [p, r, v];
    expect(isPaymentRefundable(r, rows)).toBe(false);
    expect(isPaymentRefundable(v, rows)).toBe(false);
  });

  it("is false for zero or negative parent amounts (defensive)", () => {
    const zero: RefundabilityRow = {
      id: "p1",
      amount: "0.00",
      paymentType: "payment",
      parentPaymentId: null,
    };
    const negative: RefundabilityRow = {
      id: "p2",
      amount: "-5.00",
      paymentType: "payment",
      parentPaymentId: null,
    };
    expect(isPaymentRefundable(zero, [zero])).toBe(false);
    expect(isPaymentRefundable(negative, [negative])).toBe(false);
  });

  it("treats sub-1e-9 float jitter as fully offset (no flicker after final refund)", () => {
    // When the cumulative offset lands within 1e-9 of the parent due to
    // float arithmetic from penny-precise refunds, the helper must not
    // declare the row refundable. Otherwise the UI would render a
    // refund button immediately after a "refund the rest" call,
    // tempting the user into a request the server's
    // assertRefundAmountWithinParent would reject.
    const p = parent("p1", "100.00");
    const r = refund("p1", "-99.9999999995"); // offset = parent - 5e-10
    expect(isPaymentRefundable(p, [p, r])).toBe(false);
  });
});

describe("remainingRefundable", () => {
  it("returns full parent amount when no children exist", () => {
    const p = parent("p1", "100.00");
    expect(remainingRefundable(p, [p])).toBeCloseTo(100, 9);
  });

  it("subtracts |sum of children| from parent amount", () => {
    const p = parent("p1", "100.00");
    const rows = [p, refund("p1", "-30.00")];
    expect(remainingRefundable(p, rows)).toBeCloseTo(70, 9);
  });

  it("clamps to zero when children fully cover parent", () => {
    const p = parent("p1", "100.00");
    const rows = [p, refund("p1", "-100.00")];
    expect(remainingRefundable(p, rows)).toBe(0);
  });

  it("returns zero for non-positive parent amounts", () => {
    const negative: RefundabilityRow = {
      id: "p1",
      amount: "-5.00",
      paymentType: "payment",
      parentPaymentId: null,
    };
    expect(remainingRefundable(negative, [negative])).toBe(0);
  });
});
