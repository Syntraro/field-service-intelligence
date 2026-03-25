/**
 * Invoice Overdue Predicate Alignment Tests
 *
 * Proves that the server-side computeIsPastDue logic now matches the dashboard
 * SQL predicate: only payment-eligible invoices (awaiting_payment, sent, partial_paid)
 * with balance > 0 and past dueDate are considered overdue.
 *
 * 2026-03-18: Created to prove client/server invoice overdue contradiction is eliminated.
 */

import { describe, it, expect } from "vitest";

// Import the server-side canonical helper via the feed module
import { computeIsPastDue } from "../server/storage/invoicesFeed";

const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 1);
yesterday.setHours(0, 0, 0, 0);
const yesterdayStr = yesterday.toISOString().slice(0, 10);

const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
const tomorrowStr = tomorrow.toISOString().slice(0, 10);

describe("computeIsPastDue — canonical overdue predicate", () => {
  // ==========================================================================
  // Core alignment: draft is NOT overdue (was the bug)
  // ==========================================================================

  it("draft invoice with past dueDate is NOT overdue", () => {
    expect(computeIsPastDue("draft", yesterdayStr, "100.00")).toBe(false);
  });

  // ==========================================================================
  // Payment-eligible statuses ARE overdue when conditions met
  // ==========================================================================

  it("awaiting_payment invoice with past dueDate and balance > 0 IS overdue", () => {
    expect(computeIsPastDue("awaiting_payment", yesterdayStr, "100.00")).toBe(true);
  });

  it("sent (legacy) invoice with past dueDate and balance > 0 IS overdue", () => {
    expect(computeIsPastDue("sent", yesterdayStr, "100.00")).toBe(true);
  });

  it("partial_paid invoice with past dueDate and balance > 0 IS overdue", () => {
    expect(computeIsPastDue("partial_paid", yesterdayStr, "50.00")).toBe(true);
  });

  // ==========================================================================
  // Terminal / non-payment statuses NOT overdue
  // ==========================================================================

  it("paid invoice is NOT overdue", () => {
    expect(computeIsPastDue("paid", yesterdayStr, "0.00")).toBe(false);
  });

  it("voided invoice is NOT overdue", () => {
    expect(computeIsPastDue("voided", yesterdayStr, "100.00")).toBe(false);
  });

  // ==========================================================================
  // Edge cases
  // ==========================================================================

  it("zero-balance invoice is NOT overdue even if past dueDate", () => {
    expect(computeIsPastDue("awaiting_payment", yesterdayStr, "0.00")).toBe(false);
  });

  it("future dueDate is NOT overdue", () => {
    expect(computeIsPastDue("awaiting_payment", tomorrowStr, "100.00")).toBe(false);
  });

  it("null dueDate is NOT overdue", () => {
    expect(computeIsPastDue("awaiting_payment", null, "100.00")).toBe(false);
  });

  it("null status is NOT overdue", () => {
    expect(computeIsPastDue(null, yesterdayStr, "100.00")).toBe(false);
  });
});

describe("Dashboard/list consistency — predicate matches dashboard SQL", () => {
  /**
   * The canonical dashboard SQL pastDueCount predicate:
   *   dueDate < today AND balance > 0 AND status IN ('awaiting_payment', 'sent', 'partial_paid')
   *
   * computeIsPastDue must agree with this for every status.
   */
  const DASHBOARD_OVERDUE_STATUSES = ["awaiting_payment", "sent", "partial_paid"];
  const ALL_STATUSES = ["draft", "awaiting_payment", "sent", "partial_paid", "paid", "voided"];

  it("overdue-eligible statuses match dashboard SQL exactly", () => {
    for (const status of ALL_STATUSES) {
      const result = computeIsPastDue(status, yesterdayStr, "100.00");
      const expected = DASHBOARD_OVERDUE_STATUSES.includes(status);
      expect(result).toBe(expected);
    }
  });
});
