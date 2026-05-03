/**
 * Tests for the Accounts Receivable deep-report page (`/reports/ar`)
 * and its backing aggregator (`/api/reports/ar`).
 *
 * Layers:
 *   1. AR page source guards (sections, query key, empty states,
 *      no front-end aggregation).
 *   2. No-fake-data guards (forbidden phrases + non-zero metric output
 *      literals).
 *   3. Server route + storage source guards (role gating, real-data
 *      tables only, every section emits hasData, KPIs route through
 *      sharedQueries, overdue-invoice filter is correct, payment-time
 *      trend uses the canonical paid-invoice predicate, no GROUP BY
 *      alias regression).
 *   4. Reuse canonicality (the canonical `getARAgingReport` drives the
 *      aging buckets AND the overdue table — no duplicate aging
 *      math; top-clients lifted into reportsCommon as a shared helper
 *      consumed by both Financial and AR aggregators).
 *   5. App + Library wiring (route mounted, library entry references
 *      `/reports/ar` via the canonical `href` field).
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { REPORTS_LIBRARY } from "../client/src/lib/reportsLibrary";

const repoRoot = path.resolve(__dirname, "..");
const pagePath = path.join(repoRoot, "client", "src", "pages", "ReportsAR.tsx");
const aggregatorPath = path.join(repoRoot, "server", "storage", "reportsAR.ts");
const sharedPath = path.join(repoRoot, "shared", "reports", "ar.ts");
const routePath = path.join(repoRoot, "server", "routes", "reports.ts");
const commonPath = path.join(repoRoot, "server", "storage", "reportsCommon.ts");
const financialAggregatorPath = path.join(
  repoRoot,
  "server",
  "storage",
  "reportsFinancial.ts",
);
const appPath = path.join(repoRoot, "client", "src", "App.tsx");

// ---------------------------------------------------------------------------
// Layer 1 — AR page source guards
// ---------------------------------------------------------------------------

describe("Reports AR page (/reports/ar) — source guard", () => {
  const source = fs.readFileSync(pagePath, "utf-8");

  it("exports ReportsAR with the canonical title + range selector + back button", () => {
    expect(source).toMatch(/export default function ReportsAR\b/);
    expect(source).toMatch(/data-testid="reports-ar-page"/);
    expect(source).toMatch(/data-testid="reports-ar-title"/);
    expect(source).toMatch(/data-testid="select-ar-range"/);
    expect(source).toMatch(/data-testid="ar-back-to-reports"/);
    expect(source).toMatch(/setLocation\("\/reports"\)/);
  });

  it("threads the canonical /api/reports/ar endpoint into TanStack Query", () => {
    expect(source).toMatch(/\["\/api\/reports\/ar",\s*range\]/);
    expect(source).toMatch(/`\/api\/reports\/ar\?range=\$\{range\}`/);
  });

  it("renders all five AR sections with canonical test ids", () => {
    for (const id of [
      "ar-section-kpis",
      "ar-section-aging",
      "ar-section-overdue-invoices",
      "ar-section-top-clients",
      "ar-section-payment-time-trend",
    ]) {
      const propMatch = new RegExp(`testId="${id}"`).test(source);
      const attrMatch = new RegExp(`data-testid="${id}"`).test(source);
      expect(propMatch || attrMatch, `expected ${id} in source`).toBe(true);
    }
  });

  it("each section card short-circuits to SectionEmpty when hasData is false", () => {
    const chunks = source.split(/\nfunction /);
    const cards = [
      "AgingSection",
      "OverdueInvoicesCard",
      "TopOutstandingClientsCard",
      "PaymentTimeTrendCard",
    ];
    for (const fn of cards) {
      const chunk = chunks.find(
        (c) => c.startsWith(`${fn}(`) || c.startsWith(`${fn} `),
      );
      expect(chunk, `${fn} must exist`).toBeDefined();
      expect(chunk!).toMatch(/!section\.hasData/);
      expect(chunk!).toContain("SectionEmpty");
    }
  });

  it("full-page error path triggers ONLY on (isError || !data)", () => {
    expect(source).toMatch(/isError\s*\|\|\s*!data/);
    expect(source).toContain('data-testid="ar-error"');
  });

  it("the overdue table iterates backend items directly — no client sort or filter", () => {
    const chunks = source.split(/\nfunction /);
    const card = chunks.find(
      (c) => c.startsWith("OverdueInvoicesCard(") || c.startsWith("OverdueInvoicesCard "),
    );
    expect(card).toBeDefined();
    expect(card!).toMatch(/section\.items\.map\(/);
    expect(card!).not.toMatch(/section\.items\.sort\(/);
    expect(card!).not.toMatch(/section\.items\.filter\(/);
    expect(card!).not.toMatch(/section\.items\.reduce\(/);
  });

  it("the payment-time trend iterates backend points directly — no front-end aggregation", () => {
    const chunks = source.split(/\nfunction /);
    const card = chunks.find(
      (c) => c.startsWith("PaymentTimeTrendCard(") || c.startsWith("PaymentTimeTrendCard "),
    );
    expect(card).toBeDefined();
    expect(card!).toMatch(/section\.points\.map\(/);
    expect(card!).not.toMatch(/section\.points\.sort\(/);
    expect(card!).not.toMatch(/section\.points\.filter\(/);
    expect(card!).not.toMatch(/groupBy|bucketBy|aggregate/i);
    // Single `.reduce()` allowed — the visual-max for bar height.
    const reduces = card!.match(/\.reduce\(/g) ?? [];
    expect(reduces.length).toBeLessThanOrEqual(1);
    if (reduces.length === 1) {
      const idx = card!.indexOf(".reduce(");
      const tail = card!.slice(idx, idx + 200);
      expect(tail).toContain("Math.max");
    }
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — no-fake-data guards
// ---------------------------------------------------------------------------

describe("AR deep-report — no fabricated metric values", () => {
  const sources = [
    fs.readFileSync(pagePath, "utf-8"),
    fs.readFileSync(aggregatorPath, "utf-8"),
    fs.readFileSync(sharedPath, "utf-8"),
  ];

  it("does not contain hardcoded business-shaped placeholder strings", () => {
    const forbidden = [
      "Mock data",
      "mockMetrics",
      "fakeData",
      "$10,000",
      "$50,000",
      "demoTotal",
      "lorem ipsum",
    ];
    for (const src of sources) {
      for (const phrase of forbidden) {
        expect(src.toLowerCase()).not.toContain(phrase.toLowerCase());
      }
    }
  });

  it("does not declare hardcoded metric-output literals", () => {
    const forbidden = /\b(currentValue|previousMonthValue|previousQuarterValue|previousYearValue|totalAmount|totalOutstanding|totalOverdue|amount|daysOverdue|avgDays):\s*[1-9]\d*(?:\.\d+)?/g;
    for (const src of sources) {
      expect(src.match(forbidden) ?? []).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Layer 3 — server route + aggregator wiring guards
// ---------------------------------------------------------------------------

describe("AR — server route + aggregator wiring", () => {
  const routeSrc = fs.readFileSync(routePath, "utf-8");
  const aggSrc = fs.readFileSync(aggregatorPath, "utf-8");

  it("registers GET /ar under requireRole(MANAGER_ROLES)", () => {
    expect(routeSrc).toMatch(/router\.get\(\s*"\/ar",\s*requireRole\(MANAGER_ROLES\)/);
    expect(routeSrc).toMatch(/getCompanyAR/);
    expect(routeSrc).toMatch(/arQuerySchema/);
  });

  it("aggregator reads canonical real-data tables only — no mocks", () => {
    for (const table of ["invoices", "payments"]) {
      expect(aggSrc).toContain(table);
    }
    expect(aggSrc).not.toMatch(/mockMetrics|fakeData|HARDCODED_/i);
  });

  it("KPI strip uses sharedQueries — no local re-implementation of totals/payment-time", () => {
    expect(aggSrc).toMatch(/sharedQueries\.totalOutstandingAtPoint\(/);
    expect(aggSrc).toMatch(/sharedQueries\.totalOverdueAtPoint\(/);
    expect(aggSrc).toMatch(/sharedQueries\.avgPaymentDays\(/);
    // Every buildMetric carries polarity.
    const buildMetric = (aggSrc.match(/buildMetric\(\{/g) ?? []).length;
    const polarity = (aggSrc.match(/polarity:\s*"(higher|lower)_is_better"/g) ?? []).length;
    expect(buildMetric).toBe(4);
    expect(polarity).toBe(buildMetric);
    // All four KPIs are `lower_is_better` — outstanding / overdue /
    // payment time / overdue share. AR up = bad.
    expect(buildMetric).toBe(
      (aggSrc.match(/polarity:\s*"lower_is_better"/g) ?? []).length,
    );
  });

  it("aging buckets + overdue table come from the canonical getARAgingReport", () => {
    // No duplicate aging math in this aggregator — the aging section
    // and the overdue table both derive from the same call.
    expect(aggSrc).toMatch(/reportsRepository\.getARAgingReport\(companyId\)/);
    // Anti-regression: the aggregator must NOT re-implement the aging
    // CASE expression itself.
    expect(aggSrc).not.toMatch(/CASE\s+WHEN[\s\S]+?dueDate[\s\S]+?THEN/i);
  });

  it("overdue table filters daysOverdue > 0 + balance > 0 — no zero-day rows in the list", () => {
    const block = aggSrc.match(
      /function buildOverdueInvoicesFromCanonicalReport[\s\S]+?return[\s\S]+?\}\s*;\s*\}/,
    );
    expect(block, "buildOverdueInvoicesFromCanonicalReport must exist").not.toBeNull();
    const body = block![0];
    expect(body).toMatch(/inv\.daysOverdue\s*>\s*0/);
    expect(body).toMatch(/parseFloat\(inv\.balance\)\s*>\s*0/);
    // Comment in the source documents that no client-side sort
    // happens — the canonical query already orders by daysOverdue
    // DESC. Anti-regression check: no `.sort(...)` on `report.invoices`.
    expect(body).not.toMatch(/\.sort\(/);
  });

  it("payment-time trend uses status='paid' + paymentType='payment' (canonical)", () => {
    const block = aggSrc.match(/async function getPaymentTimeTrend[\s\S]+?\n\}/);
    expect(block, "getPaymentTimeTrend must exist").not.toBeNull();
    const body = block![0];
    expect(body).toMatch(/status\}\s*=\s*'paid'/);
    expect(body).toMatch(/paymentType\}\s*=\s*'payment'/);
    // Anti-regression: must NOT include partial-paid / awaiting_payment.
    expect(body).not.toMatch(/awaiting_payment|partial_paid/);
    // Buckets by paid date — to_char on `last_paid_at::date`.
    expect(body).toMatch(/last_paid_at::date/);
  });

  it("totalOverdueAtPoint uses dueDate < window.to (strictly past due, NOT >30 days)", () => {
    const commonSrc = fs.readFileSync(commonPath, "utf-8");
    const block = commonSrc.match(
      /totalOverdueAtPoint:[\s\S]+?return parseFloat[\s\S]+?\}\s*,/,
    );
    expect(block, "totalOverdueAtPoint must exist").not.toBeNull();
    const body = block![0];
    expect(body).toMatch(/\$\{invoices\.dueDate\}::date < \$\{w\.to\}::date/);
    // Anti-regression: must NOT use the >30 day predicate (that's the
    // separate `ar30PlusAtPoint` metric).
    expect(body).not.toMatch(/>\s*30/);
  });

  it("does NOT re-introduce the failing GROUP BY alias bug", () => {
    expect(aggSrc).not.toMatch(/\.groupBy\(\s*sql`\s*[a-z_][a-z0-9_]*\s*`\s*\)/);
  });
});

// ---------------------------------------------------------------------------
// Layer 4 — reuse canonicality
// ---------------------------------------------------------------------------

describe("AR — reuse canonicality", () => {
  const commonSrc = fs.readFileSync(commonPath, "utf-8");
  const aggSrc = fs.readFileSync(aggregatorPath, "utf-8");
  const finSrc = fs.readFileSync(financialAggregatorPath, "utf-8");

  it("getTopOutstandingClientsShared lives in reportsCommon", () => {
    expect(commonSrc).toMatch(
      /export async function getTopOutstandingClientsShared\(/,
    );
  });

  it("Financial aggregator imports the shared helper — no local copy", () => {
    expect(finSrc).toMatch(/getTopOutstandingClientsShared/);
    // The local implementation must be gone — only the thin wrapper
    // remains. We assert there's no in-file query that joins
    // clientLocations + customerCompanies (the unique signature of
    // the lifted function).
    expect(finSrc).not.toMatch(
      /\.innerJoin\(clientLocations[\s\S]+?customerCompanies[\s\S]+?desc\(sql/,
    );
  });

  it("AR aggregator imports the shared helper too", () => {
    expect(aggSrc).toMatch(/from "\.\/reportsCommon"/);
    expect(aggSrc).toMatch(/getTopOutstandingClientsShared\(companyId/);
  });
});

// ---------------------------------------------------------------------------
// Layer 5 — App + Library wiring
// ---------------------------------------------------------------------------

describe("AR — app route + library catalog wiring", () => {
  const appSrc = fs.readFileSync(appPath, "utf-8");

  it("imports ReportsAR and mounts /reports/ar under requireManager", () => {
    expect(appSrc).toMatch(/import ReportsAR from "@\/pages\/ReportsAR";/);
    const block = appSrc.match(/<Route path="\/reports\/ar">[\s\S]+?<\/Route>/);
    expect(block, "/reports/ar route must exist").not.toBeNull();
    expect(block![0]).toMatch(/<ProtectedRoute requireManager>/);
    expect(block![0]).toMatch(/<ReportsAR \/>/);
  });

  it("the library catalog includes an active AR deep-report entry under Financial", () => {
    const financial = REPORTS_LIBRARY.find((c) => c.id === "financial");
    expect(financial, "Financial category must exist").toBeDefined();
    const arDeep = financial!.reports.find((r) => r.id === "ar-deep");
    expect(arDeep, "AR deep-report entry must exist").toBeDefined();
    expect(arDeep!.status).toBe("active");
    expect(arDeep!.href).toBe("/reports/ar");
    // Title + description must be plain factual copy — no marketing.
    expect(arDeep!.title.toLowerCase()).toContain("accounts receivable");
    expect(arDeep!.description.length).toBeGreaterThan(0);
  });
});
