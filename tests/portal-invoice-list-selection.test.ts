/**
 * PortalInvoicesList selection logic — PR 3 frontend regression suite
 * (2026-05-03).
 *
 * Tests the pure helpers in `client/src/pages/portal/portalSelection.ts`
 * that drive the page's:
 *   - per-row "Pay Now" visibility (gated on `isInvoicePayable`)
 *   - per-row checkbox visibility (same predicate)
 *   - header select-all-payable checkbox state
 *   - sticky "Pay Selected — $X.XX" total
 *   - Pay Selected button enabled/disabled state
 *
 * No React Testing Library is wired up in this repo (vitest runs in
 * `environment: "node"` per `vitest.config.ts`), so this file exercises
 * the same logic the page consumes — same import, same predicates.
 *
 * Plus a source-grep regression block on the page itself, locking the
 * spec rules in place against future drift (matching the pattern of
 * `tests/portal-invoice-visibility.test.ts`).
 *
 * Spec coverage (PR 3 task 6, frontend):
 *   1. Pay Now visible only on payable rows
 *   2. Paid invoices not selectable
 *   3. Multi-select works
 *   4. Total updates correctly
 *   5. Pay Selected disabled when empty
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  PAYABLE_PORTAL_STATUSES,
  isInvoicePayable,
  payableIds,
  selectAllState,
  effectiveSelection,
  selectedTotalCents,
  isPaySelectedEnabled,
  type PortalListInvoice,
} from "../client/src/pages/portal/portalSelection";

function inv(p: Partial<PortalListInvoice> & { id: string }): PortalListInvoice {
  return { status: "awaiting_payment", balance: "100.00", ...p };
}

// ═══════════════════════════════════════════════════════════════════════════
// (1) Pay Now visibility / payable predicate
// ═══════════════════════════════════════════════════════════════════════════

describe("isInvoicePayable — Pay Now & checkbox gate", () => {
  it("awaiting_payment with positive balance is payable", () => {
    expect(isInvoicePayable(inv({ id: "1", status: "awaiting_payment", balance: "10.00" }))).toBe(true);
  });

  it("legacy 'sent' alias with positive balance is payable", () => {
    expect(isInvoicePayable(inv({ id: "1", status: "sent", balance: "1.00" }))).toBe(true);
  });

  it("partial_paid with positive balance is payable", () => {
    expect(isInvoicePayable(inv({ id: "1", status: "partial_paid", balance: "0.01" }))).toBe(true);
  });

  it("(2) PAID invoices are NOT payable (no Pay Now, no checkbox)", () => {
    expect(isInvoicePayable(inv({ id: "1", status: "paid", balance: "0.00" }))).toBe(false);
    // Even with a stale balance, status='paid' wins.
    expect(isInvoicePayable(inv({ id: "1", status: "paid", balance: "100.00" }))).toBe(false);
  });

  it("DRAFT / VOIDED are NOT payable (defense-in-depth — server already filters)", () => {
    expect(isInvoicePayable(inv({ id: "1", status: "draft", balance: "100.00" }))).toBe(false);
    expect(isInvoicePayable(inv({ id: "1", status: "voided", balance: "100.00" }))).toBe(false);
  });

  it("zero / negative balance is NOT payable, regardless of status", () => {
    expect(isInvoicePayable(inv({ id: "1", status: "awaiting_payment", balance: "0.00" }))).toBe(false);
    expect(isInvoicePayable(inv({ id: "1", status: "awaiting_payment", balance: "-1.00" }))).toBe(false);
  });

  it("malformed balance is NOT payable (Number.isFinite guards parseFloat NaN)", () => {
    expect(isInvoicePayable(inv({ id: "1", status: "awaiting_payment", balance: "" }))).toBe(false);
    expect(isInvoicePayable(inv({ id: "1", status: "awaiting_payment", balance: "abc" }))).toBe(false);
  });

  it("PAYABLE_PORTAL_STATUSES is exactly the canonical UNPAID set", () => {
    expect(Array.from(PAYABLE_PORTAL_STATUSES).sort()).toEqual(
      ["awaiting_payment", "partial_paid", "sent"],
    );
  });

  it("payableIds preserves input order and filters non-payable", () => {
    const list: PortalListInvoice[] = [
      inv({ id: "a", status: "awaiting_payment", balance: "100.00" }),
      inv({ id: "b", status: "paid", balance: "0.00" }),
      inv({ id: "c", status: "partial_paid", balance: "5.00" }),
      inv({ id: "d", status: "voided", balance: "999.00" }),
      inv({ id: "e", status: "sent", balance: "1.00" }),
    ];
    expect(payableIds(list)).toEqual(["a", "c", "e"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (3) Multi-select + select-all header state
// ═══════════════════════════════════════════════════════════════════════════

describe("selectAllState — header checkbox state", () => {
  it("returns false when there are no payable rows visible", () => {
    expect(selectAllState(new Set(), [])).toBe(false);
    expect(selectAllState(new Set(["x"]), [])).toBe(false);
  });

  it("returns false when nothing is selected", () => {
    expect(selectAllState(new Set(), ["a", "b", "c"])).toBe(false);
  });

  it('returns "indeterminate" when some-but-not-all are selected', () => {
    expect(selectAllState(new Set(["a"]), ["a", "b", "c"])).toBe("indeterminate");
    expect(selectAllState(new Set(["a", "b"]), ["a", "b", "c"])).toBe("indeterminate");
  });

  it("returns true when every visible payable row is selected", () => {
    expect(selectAllState(new Set(["a", "b", "c"]), ["a", "b", "c"])).toBe(true);
  });

  it("ignores selected ids that aren't in the visible payable set (don't 'ghost')", () => {
    // If a stale id ('x') is in the selection but not visible, the
    // header still computes against the visible set only.
    expect(selectAllState(new Set(["a", "x"]), ["a", "b"])).toBe("indeterminate");
    expect(selectAllState(new Set(["a", "b", "x"]), ["a", "b"])).toBe(true);
  });
});

describe("effectiveSelection — drops stale ids", () => {
  it("returns the intersection in the order of selectedIds", () => {
    const selected = new Set(["a", "b", "stale"]);
    expect(effectiveSelection(selected, ["a", "b"]).sort()).toEqual(["a", "b"]);
  });

  it("empty visible payable list → empty effective selection", () => {
    expect(effectiveSelection(new Set(["a", "b"]), [])).toEqual([]);
  });

  it("empty selection → empty effective selection", () => {
    expect(effectiveSelection(new Set(), ["a", "b"])).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (4) Total updates
// ═══════════════════════════════════════════════════════════════════════════

describe("selectedTotalCents — display total", () => {
  const list: PortalListInvoice[] = [
    inv({ id: "a", balance: "100.00" }),
    inv({ id: "b", balance: "75.50" }),
    inv({ id: "c", balance: "12.34" }),
  ];

  it("zero when nothing is selected", () => {
    expect(selectedTotalCents(list, [])).toBe(0);
  });

  it("sums one row correctly", () => {
    expect(selectedTotalCents(list, ["a"])).toBe(10000);
    expect(selectedTotalCents(list, ["b"])).toBe(7550);
  });

  it("sums multiple rows correctly (cents-precise; no floating drift)", () => {
    expect(selectedTotalCents(list, ["a", "b"])).toBe(17550);
    expect(selectedTotalCents(list, ["a", "b", "c"])).toBe(18784);
  });

  it("selection ids that don't match any visible row contribute 0", () => {
    expect(selectedTotalCents(list, ["nonexistent"])).toBe(0);
    expect(selectedTotalCents(list, ["a", "nonexistent"])).toBe(10000);
  });

  it("malformed balance contributes 0 to the total", () => {
    const oddList = [
      ...list,
      inv({ id: "d", balance: "" }),
      inv({ id: "e", balance: "not-a-number" }),
    ];
    expect(selectedTotalCents(oddList, ["a", "d", "e"])).toBe(10000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (5) Pay Selected button enabled/disabled
// ═══════════════════════════════════════════════════════════════════════════

describe("isPaySelectedEnabled — Pay Selected button state", () => {
  it("DISABLED when nothing is selected", () => {
    expect(isPaySelectedEnabled([])).toBe(false);
  });

  it("ENABLED when at least one row is selected", () => {
    expect(isPaySelectedEnabled(["a"])).toBe(true);
    expect(isPaySelectedEnabled(["a", "b"])).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Source-grep regression guards on PortalInvoicesList.tsx
//
// Locks in PR 3's spec-mandated UI behaviors so a future refactor that
// silently drops them (e.g. exposes Pay Now on paid invoices, or trusts
// a frontend-supplied total) fails this test instead of slipping through.
// ═══════════════════════════════════════════════════════════════════════════

describe("PortalInvoicesList — source-level regression guards", () => {
  const PAGE_PATH = path.resolve(
    __dirname,
    "..",
    "client",
    "src",
    "pages",
    "portal",
    "PortalInvoicesList.tsx",
  );
  const source = fs.readFileSync(PAGE_PATH, "utf-8");

  it("imports the canonical isInvoicePayable predicate (not a local copy)", () => {
    expect(source).toMatch(
      /import\s*\{[^}]*\bisInvoicePayable\b[^}]*\}\s*from\s*"\.\/portalSelection"/,
    );
  });

  it("posts the batch-checkout body with the route's exact URL", () => {
    expect(source).toMatch(/\/api\/portal\/invoices\/batch-checkout/);
  });

  it("redirects to checkoutUrl from the response (no Stripe API call client-side)", () => {
    expect(source).toMatch(/window\.location\.assign\(\s*result\.checkoutUrl\s*\)/);
    // Negative: no direct stripe-js usage on the list (we don't mount
    // Elements here — that lives only on the invoice detail page).
    expect(source).not.toMatch(/@stripe\/stripe-js/);
    expect(source).not.toMatch(/loadStripe/);
  });

  it("Pay Now button is gated on payable && paymentsEnabled", () => {
    // The render path is `paymentsEnabled && payable && (<Button …>)`.
    expect(source).toMatch(
      /paymentsEnabled\s*&&\s*payable\s*&&\s*\(\s*<Button[\s\S]*?Pay Now/,
    );
  });

  it("checkbox column is also gated on payable && paymentsEnabled", () => {
    expect(source).toMatch(
      /paymentsEnabled\s*&&\s*payable\s*\?\s*\(\s*<div[\s\S]*?<Checkbox/,
    );
  });

  it("Pay Selected button is gated on isPaySelectedEnabled", () => {
    expect(source).toMatch(/isPaySelectedEnabled\(\s*effectiveSelected\s*\)/);
  });

  it("derives display total from the canonical selectedTotalCents helper", () => {
    expect(source).toMatch(/selectedTotalCents\(\s*filtered\s*,\s*effectiveSelected\s*\)/);
  });

  it("does NOT trust a frontend total — never sends amount in batch body", () => {
    // The body is { invoiceIds: ids } only; explicit negative grep for
    // amount / total fields in the batch-checkout fetch.
    const batchPostMatch = source.match(/\/api\/portal\/invoices\/batch-checkout[\s\S]*?\}\s*\)\s*;\s*\}\s*if/);
    if (batchPostMatch) {
      expect(batchPostMatch[0]).not.toMatch(/JSON\.stringify\([^)]*\bamount\b/);
      expect(batchPostMatch[0]).not.toMatch(/JSON\.stringify\([^)]*\btotal\b/);
    }
  });

  it("preserves row-click navigation (Link wrap on the row body)", () => {
    expect(source).toMatch(
      /<Link[\s\S]*?href=\{\s*`\/portal\/invoices\/\$\{inv\.id\}`\s*\}/,
    );
  });

  // 2026-05-03 PR 5 polish guards.

  it("payable rows show balance as the primary amount (PR 5 hierarchy)", () => {
    // The "of {total}" sub-line is rendered ONLY when showBalance is
    // true — verifies the hierarchy switch from PR 5.
    expect(source).toMatch(/showBalance \? \([\s\S]*?formatCurrency\(inv\.balance/);
    expect(source).toMatch(/of \{formatCurrency\(inv\.total/);
  });

  it("renders an explicit due-label color tier per portal-status badge kind (PR 5)", () => {
    // past_due → red-700, due_soon → orange-700.
    expect(source).toMatch(/badge\.kind === "past_due"[\s\S]*?text-red-700/);
    expect(source).toMatch(/badge\.kind === "due_soon"[\s\S]*?text-orange-700/);
  });

  it("Pay Selected handles network errors AND status-coded API errors (PR 5)", () => {
    expect(source).toMatch(/Couldn't reach the server/);
    expect(source).toMatch(/Your session has expired/);
    expect(source).toMatch(/no longer available/);
  });
});
