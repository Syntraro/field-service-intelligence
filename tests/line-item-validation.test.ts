/**
 * Unit tests for assertValidLineItemValues — line item boundary validation.
 *
 * Policy (confirmed 2026-05-18):
 *   - quantity must be >= 1  (zero-quantity lines are not meaningful work items)
 *   - unitPrice may be 0 or greater (zero-price lines are allowed)
 *   - unitCost may be 0 or greater when present
 *
 * moneyString regex is NOT under test here — see shared/lineItem.ts guardrails.
 * These tests exercise the post-schema semantic guard only.
 */
import { describe, it, expect } from "vitest";
import { assertValidLineItemValues } from "../server/utils/validationHelpers";

function call(data: { quantity?: string; unitPrice?: string; unitCost?: string }) {
  return () => assertValidLineItemValues(data);
}

function errorCode(fn: () => void): string | undefined {
  try {
    fn();
  } catch (e: any) {
    return e.code;
  }
  return undefined;
}

function errorStatus(fn: () => void): number | undefined {
  try {
    fn();
  } catch (e: any) {
    return e.status;
  }
  return undefined;
}

// ── quantity rules ─────────────────────────────────────────────────────────────

describe("quantity", () => {
  it("rejects 0", () => {
    expect(errorCode(call({ quantity: "0" }))).toBe("INVALID_LINE_QUANTITY_MIN");
  });

  it("rejects negative quantity", () => {
    expect(errorCode(call({ quantity: "-1" }))).toBe("INVALID_LINE_QUANTITY_MIN");
  });

  it("rejects fractional < 1 (e.g. 0.5)", () => {
    expect(errorCode(call({ quantity: "0.5" }))).toBe("INVALID_LINE_QUANTITY_MIN");
  });

  it("accepts exactly 1", () => {
    expect(call({ quantity: "1" })).not.toThrow();
  });

  it("accepts quantity > 1", () => {
    expect(call({ quantity: "3" })).not.toThrow();
  });

  it("no-ops when quantity is absent (PATCH partial body)", () => {
    expect(call({})).not.toThrow();
  });

  it("emits HTTP 422 for quantity violation", () => {
    expect(errorStatus(call({ quantity: "0" }))).toBe(422);
  });
});

// ── unitPrice rules ────────────────────────────────────────────────────────────

describe("unitPrice", () => {
  it("rejects negative unitPrice", () => {
    expect(errorCode(call({ unitPrice: "-1" }))).toBe("NEGATIVE_LINE_UNIT_PRICE");
  });

  it("accepts 0 (zero-price lines are valid)", () => {
    expect(call({ unitPrice: "0" })).not.toThrow();
  });

  it("accepts 0.00", () => {
    expect(call({ unitPrice: "0.00" })).not.toThrow();
  });

  it("accepts positive unitPrice", () => {
    expect(call({ unitPrice: "99.99" })).not.toThrow();
  });

  it("no-ops when unitPrice is absent (PATCH partial body)", () => {
    expect(call({})).not.toThrow();
  });

  it("emits HTTP 422 for unitPrice violation", () => {
    expect(errorStatus(call({ unitPrice: "-0.01" }))).toBe(422);
  });
});

// ── unitCost rules ─────────────────────────────────────────────────────────────

describe("unitCost", () => {
  it("rejects negative unitCost", () => {
    expect(errorCode(call({ unitCost: "-5" }))).toBe("NEGATIVE_LINE_UNIT_COST");
  });

  it("accepts 0", () => {
    expect(call({ unitCost: "0" })).not.toThrow();
  });

  it("accepts 0.00", () => {
    expect(call({ unitCost: "0.00" })).not.toThrow();
  });

  it("accepts positive unitCost", () => {
    expect(call({ unitCost: "12.50" })).not.toThrow();
  });

  it("no-ops when unitCost is absent (optional field — not all lines track cost)", () => {
    expect(call({})).not.toThrow();
  });

  it("emits HTTP 422 for unitCost violation", () => {
    expect(errorStatus(call({ unitCost: "-0.01" }))).toBe(422);
  });
});

// ── combined / ordering ────────────────────────────────────────────────────────

describe("combined fields", () => {
  it("valid full set passes", () => {
    expect(call({ quantity: "2", unitPrice: "49.99", unitCost: "20.00" })).not.toThrow();
  });

  it("zero unitPrice with valid quantity passes (zero-price policy)", () => {
    expect(call({ quantity: "1", unitPrice: "0", unitCost: "0" })).not.toThrow();
  });

  it("quantity checked before unitPrice — first violation wins", () => {
    // Both quantity=0 and unitPrice=-1 are invalid; quantity is checked first.
    expect(errorCode(call({ quantity: "0", unitPrice: "-1" }))).toBe("INVALID_LINE_QUANTITY_MIN");
  });

  it("unitPrice checked before unitCost when quantity is valid", () => {
    expect(errorCode(call({ quantity: "1", unitPrice: "-1", unitCost: "-5" }))).toBe(
      "NEGATIVE_LINE_UNIT_PRICE",
    );
  });
});

// ── moneyString regex — unchanged ──────────────────────────────────────────────

describe("moneyString regex contract (shared/lineItem.ts)", () => {
  it("negative regex pattern is unchanged — allows -1 as a valid money format", async () => {
    // Import dynamically to avoid top-level dep issues in some runners.
    const { moneyString } = await import("../shared/lineItem");
    expect(moneyString.safeParse("-1").success).toBe(true);
    expect(moneyString.safeParse("-0.50").success).toBe(true);
    expect(moneyString.safeParse("0").success).toBe(true);
    expect(moneyString.safeParse("100.00").success).toBe(true);
  });
});
