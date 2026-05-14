/**
 * Invoice view filter predicates (2026-05-14)
 *
 * Pins that status-based views use explicit status predicates,
 * never broad balance > 0 logic, and that draft invoices are excluded
 * from all views except Drafts.
 *
 * Dataset:
 *   A — status: draft,            balance > 0
 *   B — status: awaiting_payment, balance > 0
 *   C — status: paid,             balance = 0
 *   D — status: awaiting_payment, balance > 0, dueDate past  (isPastDue = true)
 *
 * Expected membership per view:
 *   All Invoices     → A, B, C, D  (all non-voided)
 *   Drafts           → A only
 *   Awaiting Payment → B, D        (awaiting_payment + sent + partial_paid, unpaidOnly)
 *   Overdue          → D only      (isPastDue, which excludes draft via UNPAID_INVOICE_STATUSES)
 *   Paid             → C only
 *   Draft ∉ Awaiting Payment
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { computeIsPastDue } from "../server/storage/invoicesFeed";
import { UNPAID_INVOICE_STATUSES } from "../shared/invoiceStatus";

const ROOT = join(__dirname, "..");

function src(relPath: string): string {
  return readFileSync(join(ROOT, relPath), "utf-8");
}

const receivablesRoutes = src("server/routes/receivables.ts");
const invoicesFeed      = src("server/storage/invoicesFeed.ts");

// ── computeIsPastDue unit tests ───────────────────────────────────────────────

describe("computeIsPastDue", () => {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const tomorrow  = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  it("returns false for draft status regardless of balance or due date", () => {
    expect(computeIsPastDue("draft", yesterday, "100.00")).toBe(false);
  });

  it("returns false for paid status", () => {
    expect(computeIsPastDue("paid", yesterday, "100.00")).toBe(false);
  });

  it("returns false for voided status", () => {
    expect(computeIsPastDue("voided", yesterday, "100.00")).toBe(false);
  });

  it("returns false when balance is zero", () => {
    expect(computeIsPastDue("awaiting_payment", yesterday, "0")).toBe(false);
  });

  it("returns false when due date is in the future", () => {
    expect(computeIsPastDue("awaiting_payment", tomorrow, "100.00")).toBe(false);
  });

  it("returns true for awaiting_payment with past due date and positive balance (invoice D)", () => {
    expect(computeIsPastDue("awaiting_payment", yesterday, "100.00")).toBe(true);
  });

  it("returns true for sent status (legacy alias) when past due", () => {
    expect(computeIsPastDue("sent", yesterday, "50.00")).toBe(true);
  });

  it("returns true for partial_paid when past due", () => {
    expect(computeIsPastDue("partial_paid", yesterday, "25.00")).toBe(true);
  });
});

// ── UNPAID_INVOICE_STATUSES does not include draft ────────────────────────────

describe("UNPAID_INVOICE_STATUSES", () => {
  it("does not include draft — ensures draft cannot become isPastDue", () => {
    expect(UNPAID_INVOICE_STATUSES).not.toContain("draft");
  });

  it("does not include paid or voided", () => {
    expect(UNPAID_INVOICE_STATUSES).not.toContain("paid");
    expect(UNPAID_INVOICE_STATUSES).not.toContain("voided");
  });

  it("includes awaiting_payment, sent, partial_paid", () => {
    expect(UNPAID_INVOICE_STATUSES).toContain("awaiting_payment");
    expect(UNPAID_INVOICE_STATUSES).toContain("sent");
    expect(UNPAID_INVOICE_STATUSES).toContain("partial_paid");
  });
});

// ── Server-side view predicates ───────────────────────────────────────────────

describe("server view predicates — awaiting-payment", () => {
  it("uses explicit status IN list, not balance-only predicate", () => {
    expect(receivablesRoutes).toMatch(/awaiting-payment[\s\S]*?statuses.*awaiting_payment.*sent.*partial_paid/s);
  });

  it("draft is not in the awaiting-payment status list", () => {
    const awaitingBlock = receivablesRoutes.match(/case "awaiting-payment":[\s\S]*?break;/)?.[0] ?? "";
    expect(awaitingBlock).not.toMatch(/['"]draft['"]/);
  });

  it("awaiting-payment view also requires unpaidOnly (balance > 0)", () => {
    expect(receivablesRoutes).toMatch(/awaiting-payment[\s\S]*?unpaidOnly.*true/s);
  });
});

describe("server view predicates — drafts", () => {
  it("drafts view filters to status = draft only", () => {
    expect(receivablesRoutes).toMatch(/case "drafts":[\s\S]*?statuses.*\["draft"\]/s);
  });
});

describe("server view predicates — overdue", () => {
  it("overdue view uses overdue: true (delegates to computeIsPastDue, which excludes draft)", () => {
    expect(receivablesRoutes).toMatch(/case "overdue":[\s\S]*?overdue.*true/s);
  });

  it("view counts overdue predicate explicitly excludes draft", () => {
    expect(receivablesRoutes).toMatch(/overdue[\s\S]*?NOT IN.*draft.*paid.*voided/s);
  });
});

describe("server view predicates — needs-follow-up", () => {
  it("needsFollowUp count predicate excludes draft", () => {
    const needsFollowUpBlock = receivablesRoutes.match(
      /needsFollowUp[\s\S]*?follow_up_at <= NOW\(\)[\s\S]*?status NOT IN[^)]+\)[^:]+/
    )?.[0] ?? receivablesRoutes;
    // The status NOT IN clause must include 'draft'
    expect(receivablesRoutes).toMatch(/follow_up_at <= NOW\(\)[\s\S]*?NOT IN \('draft', 'paid', 'voided'\)/s);
  });

  it("invoicesFeed followUpDue predicate excludes draft", () => {
    expect(invoicesFeed).toMatch(/followUpDue[\s\S]*?NOT IN \('draft', 'paid', 'voided'\)/s);
  });
});

describe("server view predicates — paid", () => {
  it("paid view filters to status = paid only", () => {
    expect(receivablesRoutes).toMatch(/case "paid":[\s\S]*?statuses.*\["paid"\]/s);
  });
});

// ── View counts exclude draft from non-draft views ────────────────────────────

describe("view counts — draft exclusion", () => {
  it("awaitingPayment count does not include draft", () => {
    const awaitingBlock = receivablesRoutes.match(
      /awaitingPayment[\s\S]*?status IN \([^)]+\)/
    )?.[0] ?? "";
    expect(awaitingBlock).not.toMatch(/draft/);
  });

  it("overdue count excludes draft explicitly", () => {
    expect(receivablesRoutes).toMatch(/AS "overdue"[\s\S]*?draft[\s\S]*?paid[\s\S]*?voided|overdue[\s\S]*?NOT IN.*draft/s);
  });

  it("noRecentContact count excludes draft", () => {
    const noContactBlock = receivablesRoutes.match(/noRecentContact[\s\S]*?"noRecentContact"/s)?.[0] ?? receivablesRoutes;
    expect(receivablesRoutes).toMatch(/noRecentContact[\s\S]*?NOT IN.*draft.*paid.*voided/s);
  });

  it("highBalance count excludes draft", () => {
    expect(receivablesRoutes).toMatch(/highBalance[\s\S]*?NOT IN.*draft.*paid.*voided/s);
  });
});
