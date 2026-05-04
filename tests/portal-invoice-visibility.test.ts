/**
 * Portal invoice visibility — regression tests (2026-05-03).
 *
 * Covers the fix at `server/routes/portal.ts` lines 457 (visibleStatuses)
 * and 486 (openInvoices derivation), where a hardcoded
 * `["sent", "partial_paid", "paid"]` list excluded the modern canonical
 * `awaiting_payment` status — the status every staff-sent invoice has
 * carried since the lifecycle redesign. The fix routes both call sites
 * through the canonical `UNPAID_INVOICE_STATUSES` constant in
 * `shared/invoiceStatus.ts`.
 *
 * The portal route is a SQL handler — direct integration testing would
 * require a live DB. This file unit-tests the derivation logic with the
 * canonical constant, and adds a source-grep regression assertion that
 * guards against future drift back to a hardcoded list.
 *
 * Acceptance scenarios from the task spec:
 *   1. awaiting_payment invoice appears in portal invoice list
 *   2. awaiting_payment counts toward open count + balance due
 *   3. sent (legacy alias) appears + counts as open
 *   4. partial_paid appears + counts as open
 *   5. paid is visible but does NOT count as open
 *   6. draft is hidden
 *   7. voided is hidden
 *   8. tenant scoping (companyId + customerCompanyId) preserved
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { UNPAID_INVOICE_STATUSES } from "@shared/invoiceStatus";

// ── Replicate the canonical visible-status list the portal route now
// uses. Pulled from `UNPAID_INVOICE_STATUSES + "paid"` so this test
// fails at module-load time if the canonical constant ever drifts.
const PORTAL_VISIBLE_STATUSES = [...UNPAID_INVOICE_STATUSES, "paid"];

interface InvoiceRow {
  id: string;
  invoiceNumber: number;
  status: string;
  balance: string;
  companyId: string;
  customerCompanyId: string;
}

/**
 * Replays the dashboard SQL filter logic in JS against an in-memory
 * fixture. Asserts both the WHERE-style filter (visibleStatuses) and
 * the post-fetch derivation (openInvoices + balance sum) match the
 * canonical constant — the same way the live SQL + reduce do at
 * portal.ts:475-499.
 */
function simulatePortalDashboardQuery(
  rows: InvoiceRow[],
  session: { companyId: string; customerCompanyId: string },
  statusOverride?: string,
): {
  invoices: InvoiceRow[];
  summary: { totalBalance: string; openCount: number; totalCount: number };
} {
  const statusFilter = statusOverride && PORTAL_VISIBLE_STATUSES.includes(statusOverride)
    ? [statusOverride]
    : PORTAL_VISIBLE_STATUSES;

  const visible = rows.filter(r =>
    r.companyId === session.companyId
    && r.customerCompanyId === session.customerCompanyId
    && statusFilter.includes(r.status),
  );

  const open = visible.filter(r => UNPAID_INVOICE_STATUSES.includes(r.status));
  const totalBalance = open.reduce((sum, r) => sum + parseFloat(r.balance || "0"), 0);

  return {
    invoices: visible,
    summary: {
      totalBalance: totalBalance.toFixed(2),
      openCount: open.length,
      totalCount: visible.length,
    },
  };
}

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const CUSTOMER_X = "customer-x";
const CUSTOMER_Y = "customer-y";
const SESSION_A_X = { companyId: TENANT_A, customerCompanyId: CUSTOMER_X };

function row(p: Partial<InvoiceRow> & Pick<InvoiceRow, "id" | "status" | "balance">): InvoiceRow {
  return {
    invoiceNumber: 1000,
    companyId: TENANT_A,
    customerCompanyId: CUSTOMER_X,
    ...p,
  };
}

describe("portal dashboard visibility — status filter", () => {
  it("(1) awaiting_payment invoice appears in the list", () => {
    const rows = [row({ id: "i1", status: "awaiting_payment", balance: "100.00" })];
    const out = simulatePortalDashboardQuery(rows, SESSION_A_X);
    expect(out.invoices.map(i => i.id)).toEqual(["i1"]);
  });

  it("(2) awaiting_payment contributes to open count + balance due", () => {
    const rows = [
      row({ id: "i1", status: "awaiting_payment", balance: "226.00" }),
      row({ id: "i2", status: "awaiting_payment", balance: "75.50" }),
    ];
    const out = simulatePortalDashboardQuery(rows, SESSION_A_X);
    expect(out.summary.openCount).toBe(2);
    expect(out.summary.totalBalance).toBe("301.50");
  });

  it("(3) sent (legacy alias) still appears + counts as open", () => {
    const rows = [row({ id: "i1", status: "sent", balance: "50.00" })];
    const out = simulatePortalDashboardQuery(rows, SESSION_A_X);
    expect(out.invoices.map(i => i.id)).toEqual(["i1"]);
    expect(out.summary.openCount).toBe(1);
    expect(out.summary.totalBalance).toBe("50.00");
  });

  it("(4) partial_paid still appears + counts as open", () => {
    const rows = [row({ id: "i1", status: "partial_paid", balance: "30.00" })];
    const out = simulatePortalDashboardQuery(rows, SESSION_A_X);
    expect(out.invoices.map(i => i.id)).toEqual(["i1"]);
    expect(out.summary.openCount).toBe(1);
    expect(out.summary.totalBalance).toBe("30.00");
  });

  it("(5) paid invoice appears but does NOT count as open / balance", () => {
    const rows = [
      row({ id: "i1", status: "paid", balance: "0.00" }),
      row({ id: "i2", status: "awaiting_payment", balance: "100.00" }),
    ];
    const out = simulatePortalDashboardQuery(rows, SESSION_A_X);
    // Both visible
    expect(out.invoices.map(i => i.id).sort()).toEqual(["i1", "i2"]);
    expect(out.summary.totalCount).toBe(2);
    // Only the unpaid one counts
    expect(out.summary.openCount).toBe(1);
    expect(out.summary.totalBalance).toBe("100.00");
  });

  it("(6) draft invoice is hidden", () => {
    const rows = [
      row({ id: "i1", status: "draft", balance: "999.00" }),
      row({ id: "i2", status: "awaiting_payment", balance: "100.00" }),
    ];
    const out = simulatePortalDashboardQuery(rows, SESSION_A_X);
    expect(out.invoices.map(i => i.id)).toEqual(["i2"]);
    expect(out.summary.totalCount).toBe(1);
  });

  it("(7) voided invoice is hidden", () => {
    const rows = [
      row({ id: "i1", status: "voided", balance: "999.00" }),
      row({ id: "i2", status: "awaiting_payment", balance: "100.00" }),
    ];
    const out = simulatePortalDashboardQuery(rows, SESSION_A_X);
    expect(out.invoices.map(i => i.id)).toEqual(["i2"]);
  });

  it("(8a) tenant scoping — invoices on a DIFFERENT tenant are excluded", () => {
    const rows = [
      row({ id: "mine", status: "awaiting_payment", balance: "100.00", companyId: TENANT_A }),
      row({ id: "theirs", status: "awaiting_payment", balance: "999.00", companyId: TENANT_B }),
    ];
    const out = simulatePortalDashboardQuery(rows, { companyId: TENANT_A, customerCompanyId: CUSTOMER_X });
    expect(out.invoices.map(i => i.id)).toEqual(["mine"]);
    expect(out.summary.totalBalance).toBe("100.00");
  });

  it("(8b) customer scoping — invoices for a DIFFERENT customer-company are excluded", () => {
    const rows = [
      row({ id: "mine", status: "awaiting_payment", balance: "100.00", customerCompanyId: CUSTOMER_X }),
      row({ id: "neighbour", status: "awaiting_payment", balance: "999.00", customerCompanyId: CUSTOMER_Y }),
    ];
    const out = simulatePortalDashboardQuery(rows, SESSION_A_X);
    expect(out.invoices.map(i => i.id)).toEqual(["mine"]);
    expect(out.summary.totalBalance).toBe("100.00");
  });

  it("explicit ?status=awaiting_payment narrows to that status only", () => {
    const rows = [
      row({ id: "i1", status: "awaiting_payment", balance: "100.00" }),
      row({ id: "i2", status: "paid", balance: "0.00" }),
    ];
    const out = simulatePortalDashboardQuery(rows, SESSION_A_X, "awaiting_payment");
    expect(out.invoices.map(i => i.id)).toEqual(["i1"]);
  });

  it("explicit ?status=draft is silently ignored (falls back to full visible set)", () => {
    // Mirrors portal.ts behaviour — unknown / disallowed status query
    // params don't open up a hidden status.
    const rows = [
      row({ id: "i1", status: "awaiting_payment", balance: "100.00" }),
      row({ id: "i2", status: "draft", balance: "200.00" }),
    ];
    const out = simulatePortalDashboardQuery(rows, SESSION_A_X, "draft");
    expect(out.invoices.map(i => i.id)).toEqual(["i1"]);
  });

  it("realistic mixed-status scenario reflects correct totals", () => {
    const rows = [
      row({ id: "draft1", status: "draft", balance: "0.00" }),
      row({ id: "voided1", status: "voided", balance: "0.00" }),
      row({ id: "open1", status: "awaiting_payment", balance: "226.00" }),
      row({ id: "open2", status: "partial_paid", balance: "75.00" }),
      row({ id: "paid1", status: "paid", balance: "0.00" }),
      row({ id: "legacy_sent", status: "sent", balance: "50.00" }),
      // Cross-tenant noise — must be filtered out
      row({ id: "other_tenant", status: "awaiting_payment", balance: "9999.00", companyId: TENANT_B }),
      row({ id: "other_customer", status: "awaiting_payment", balance: "9999.00", customerCompanyId: CUSTOMER_Y }),
    ];
    const out = simulatePortalDashboardQuery(rows, SESSION_A_X);
    expect(out.invoices.map(i => i.id).sort())
      .toEqual(["legacy_sent", "open1", "open2", "paid1"]);
    expect(out.summary.totalCount).toBe(4);
    expect(out.summary.openCount).toBe(3);
    // 226 + 75 + 50 = 351
    expect(out.summary.totalBalance).toBe("351.00");
  });
});

describe("portal route — source-level regression guards", () => {
  const ROUTE_PATH = path.resolve(__dirname, "..", "server", "routes", "portal.ts");
  const source = fs.readFileSync(ROUTE_PATH, "utf-8");

  it("imports the canonical UNPAID_INVOICE_STATUSES constant", () => {
    // Guard: the fix routes both filter sites through the shared
    // constant. If anyone deletes the import and reverts to a
    // hardcoded list, this fails.
    expect(source).toMatch(
      /import\s*\{[^}]*\bUNPAID_INVOICE_STATUSES\b[^}]*\}\s*from\s*"@shared\/invoiceStatus"/,
    );
  });

  it("does NOT contain the legacy hardcoded ['sent','partial_paid','paid'] visible-list", () => {
    // The exact regression string the audit found at line 457. Any
    // future re-introduction of a hardcoded customer-visible list
    // (with or without quotes-around-each) should fail this test.
    expect(source).not.toMatch(
      /=\s*\[\s*"sent"\s*,\s*"partial_paid"\s*,\s*"paid"\s*\]/,
    );
  });

  it("does NOT use the legacy `r.status === 'sent' || r.status === 'partial_paid'` derivation", () => {
    expect(source).not.toMatch(
      /r\.status\s*===\s*"sent"\s*\|\|\s*r\.status\s*===\s*"partial_paid"/,
    );
  });

  it("uses UNPAID_INVOICE_STATUSES.includes for the openInvoices derivation", () => {
    // Positive guard — the fix uses the canonical constant inline at
    // the open-invoice filter site.
    expect(source).toMatch(/UNPAID_INVOICE_STATUSES\.includes\(\s*r\.status\s*\)/);
  });
});
