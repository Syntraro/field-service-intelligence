/**
 * Tests for the Revenue deep-report page (`/reports/revenue`) and its
 * backing aggregator (`/api/reports/revenue`).
 *
 * Layers:
 *   1. Page source guards — sections, query key, empty states, no
 *      front-end aggregation in the trend, methods, by-client, or
 *      recent-payments cards.
 *   2. No-fake-data guards — forbidden phrases + non-zero metric output
 *      literals across the page, aggregator, and shared contract.
 *   3. Server route + storage source guards — role gating, real-data
 *      tables only, KPIs route through `sharedQueries`, revenue uses
 *      `payments.receivedAt` (cash basis), payment-method section
 *      reuses the canonical helper, top-clients does NOT infer
 *      missing rows, recent payments are sorted DESC by `receivedAt`.
 *   4. Reuse canonicality — `getRevenueTrendShared` and
 *      `getPaymentBreakdownShared` live in reportsCommon; both
 *      Financial AND Revenue aggregators import them; Financial has
 *      no in-file copy.
 *   5. App + library wiring — route mounted under requireManager;
 *      library entry references `/reports/revenue` via `href`.
 *   6. MoM behavior — calendar-month boundaries (NOT 30-day windows);
 *      `changePercent` is null when previous month had zero revenue.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { REPORTS_LIBRARY } from "../client/src/lib/reportsLibrary";

const repoRoot = path.resolve(__dirname, "..");
const pagePath = path.join(repoRoot, "client", "src", "pages", "ReportsRevenue.tsx");
const aggregatorPath = path.join(
  repoRoot,
  "server",
  "storage",
  "reportsRevenue.ts",
);
const sharedPath = path.join(repoRoot, "shared", "reports", "revenue.ts");
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
// Layer 1 — Revenue page source guards
// ---------------------------------------------------------------------------

describe("Reports Revenue page (/reports/revenue) — source guard", () => {
  const source = fs.readFileSync(pagePath, "utf-8");

  it("exports ReportsRevenue with header + range selector + back button", () => {
    expect(source).toMatch(/export default function ReportsRevenue\b/);
    expect(source).toMatch(/data-testid="reports-revenue-page"/);
    expect(source).toMatch(/data-testid="reports-revenue-title"/);
    expect(source).toMatch(/data-testid="select-revenue-range"/);
    expect(source).toMatch(/data-testid="revenue-back-to-reports"/);
    expect(source).toMatch(/setLocation\("\/reports"\)/);
  });

  it("threads the canonical /api/reports/revenue endpoint into TanStack Query", () => {
    expect(source).toMatch(/\["\/api\/reports\/revenue",\s*range\]/);
    expect(source).toMatch(/`\/api\/reports\/revenue\?range=\$\{range\}`/);
  });

  it("renders all six Revenue sections with canonical test ids", () => {
    for (const id of [
      "revenue-section-kpis",
      "revenue-section-trend",
      "revenue-section-methods",
      "revenue-section-by-client",
      "revenue-section-recent",
      "revenue-section-month-comparison",
    ]) {
      const propMatch = new RegExp(`testId="${id}"`).test(source);
      const attrMatch = new RegExp(`data-testid="${id}"`).test(source);
      expect(propMatch || attrMatch, `expected ${id} in source`).toBe(true);
    }
  });

  it("each section card short-circuits to SectionEmpty when hasData is false", () => {
    const chunks = source.split(/\nfunction /);
    const cards = [
      "RevenueTrendCard",
      "PaymentMethodsCard",
      "RevenueByClientCard",
      "RecentPaymentsCard",
      "MonthOverMonthCard",
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
    expect(source).toContain('data-testid="revenue-error"');
  });

  it("trend card iterates backend points directly — no front-end aggregation", () => {
    const chunks = source.split(/\nfunction /);
    const card = chunks.find(
      (c) => c.startsWith("RevenueTrendCard(") || c.startsWith("RevenueTrendCard "),
    );
    expect(card).toBeDefined();
    expect(card!).toMatch(/section\.points\.map\(/);
    expect(card!).not.toMatch(/section\.points\.filter\(/);
    expect(card!).not.toMatch(/section\.points\.sort\(/);
    expect(card!).not.toMatch(/groupBy|bucketBy|aggregate/i);
    const reduces = card!.match(/\.reduce\(/g) ?? [];
    expect(reduces.length).toBeLessThanOrEqual(1);
    if (reduces.length === 1) {
      const idx = card!.indexOf(".reduce(");
      const tail = card!.slice(idx, idx + 200);
      expect(tail).toContain("Math.max");
    }
  });

  it("methods + by-client + recent payments iterate backend items directly — no client sort", () => {
    const chunks = source.split(/\nfunction /);
    const cards = [
      "PaymentMethodsCard",
      "RevenueByClientCard",
      "RecentPaymentsCard",
    ];
    for (const fn of cards) {
      const card = chunks.find(
        (c) => c.startsWith(`${fn}(`) || c.startsWith(`${fn} `),
      );
      expect(card, `${fn} must exist`).toBeDefined();
      expect(card!).toMatch(/section\.items\.map\(/);
      expect(card!).not.toMatch(/section\.items\.sort\(/);
      expect(card!).not.toMatch(/section\.items\.filter\(/);
      expect(card!).not.toMatch(/section\.items\.reduce\(/);
    }
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — no-fake-data guards
// ---------------------------------------------------------------------------

describe("Revenue deep-report — no fabricated metric values", () => {
  const sources = [
    fs.readFileSync(pagePath, "utf-8"),
    fs.readFileSync(aggregatorPath, "utf-8"),
    fs.readFileSync(sharedPath, "utf-8"),
  ];

  it("contains no hardcoded business-shaped placeholder strings", () => {
    const forbidden = [
      "Mock data",
      "mockMetrics",
      "fakeData",
      "$10,000",
      "$50,000",
      "demoTotal",
      "fakeRevenue",
      "lorem ipsum",
    ];
    for (const src of sources) {
      for (const phrase of forbidden) {
        expect(src.toLowerCase()).not.toContain(phrase.toLowerCase());
      }
    }
  });

  it("contains no MetricCard / output-shape numeric literals", () => {
    const forbidden = /\b(currentValue|previousMonthValue|previousQuarterValue|previousYearValue|totalAmount|totalRevenue|currentMonthRevenue|previousMonthRevenue|amount|avgValue|percentOfTotal|conversionPercent):\s*[1-9]\d*(?:\.\d+)?/g;
    for (const src of sources) {
      expect(src.match(forbidden) ?? []).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Layer 3 — server route + aggregator wiring guards
// ---------------------------------------------------------------------------

describe("Revenue — server route + aggregator wiring", () => {
  const routeSrc = fs.readFileSync(routePath, "utf-8");
  const aggSrc = fs.readFileSync(aggregatorPath, "utf-8");
  const commonSrc = fs.readFileSync(commonPath, "utf-8");

  it("registers GET /revenue under requireRole(MANAGER_ROLES)", () => {
    expect(routeSrc).toMatch(/router\.get\(\s*"\/revenue",\s*requireRole\(MANAGER_ROLES\)/);
    expect(routeSrc).toMatch(/getCompanyRevenue/);
    expect(routeSrc).toMatch(/revenueQuerySchema/);
  });

  it("aggregator reads canonical real-data tables only — no mocks", () => {
    for (const table of ["invoices", "payments"]) {
      expect(aggSrc).toContain(table);
    }
    expect(aggSrc).not.toMatch(/mockMetrics|fakeData|HARDCODED_/i);
  });

  it("KPIs route through sharedQueries — no local revenue/payment scalar copies", () => {
    expect(aggSrc).toMatch(/sharedQueries\.revenue\(/);
    expect(aggSrc).toMatch(/sharedQueries\.paymentsCollected\(/);
    expect(aggSrc).toMatch(/sharedQueries\.avgPaymentAmount\(/);
    // 4 KPI cards via buildMetric.
    const buildMetric = (aggSrc.match(/buildMetric\(\{/g) ?? []).length;
    expect(buildMetric).toBe(4);
    // All KPIs are higher-is-better per spec (revenue / payments /
    // avg amount / change-vs-previous).
    const polarity = aggSrc.match(/polarity:\s*"higher_is_better"/g) ?? [];
    expect(polarity.length).toBe(buildMetric);
  });

  it("revenue uses payments.receivedAt (cash basis) — never invoices.issueDate", () => {
    // The shared helpers handle this, but we lock the aggregator's
    // imports + the helpers themselves so a future contributor can't
    // accidentally swap to accrual basis.
    expect(commonSrc).toMatch(/payments\.receivedAt/);
    // Anti-regression: the trend helper must NOT switch to invoice
    // dates (that would silently flip cash → accrual basis).
    const trendBlock = commonSrc.match(
      /export async function getRevenueTrendShared[\s\S]+?\n\}/,
    );
    expect(trendBlock, "getRevenueTrendShared must exist").not.toBeNull();
    const body = trendBlock![0];
    expect(body).toMatch(/payments\.receivedAt/);
    expect(body).not.toMatch(/invoices\.issueDate/);
  });

  it("payment method section reuses the canonical helper — no local METHOD_LABELS map", () => {
    // Lifted into reportsCommon as `PAYMENT_METHOD_LABELS`. The
    // Revenue aggregator must import the helper — NOT define its
    // own normalization table.
    expect(aggSrc).toMatch(/getPaymentBreakdownShared\(companyId,\s*current\)/);
    expect(aggSrc).not.toMatch(/^\s*const\s+METHOD_LABELS\s*[:=]/m);
    expect(commonSrc).toMatch(/export const PAYMENT_METHOD_LABELS/);
  });

  it("revenue-by-client groups by clientLocations.id — no inferred rows", () => {
    const block = commonSrc.match(
      /export async function getRevenueByClientShared[\s\S]+?\n\}/,
    );
    expect(block, "getRevenueByClientShared must exist").not.toBeNull();
    const body = block![0];
    expect(body).toMatch(/innerJoin\(clientLocations/);
    expect(body).toMatch(/groupBy\(\s*\n?\s*clientLocations\.id/);
    expect(body).toMatch(/orderBy\(desc\(/);
    // Anti-regression: must NOT fabricate rows. No `else` branch
    // adding fake unmatched-client buckets.
    expect(body).not.toMatch(/['"]Unmapped['"]/);
    expect(body).not.toMatch(/['"]Unknown client['"]/i);
  });

  it("recent payments are server-sorted DESC by receivedAt — no client re-sort needed", () => {
    const block = commonSrc.match(
      /export async function getRecentPaymentsShared[\s\S]+?\n\}/,
    );
    expect(block, "getRecentPaymentsShared must exist").not.toBeNull();
    const body = block![0];
    expect(body).toMatch(/orderBy\(desc\(payments\.receivedAt\)\)/);
    expect(body).toMatch(/\.limit\(limit\)/);
    // Anti-regression: must NOT switch to ASC ordering.
    expect(body).not.toMatch(/orderBy\(payments\.receivedAt\)/);
  });

  it("month-over-month uses calendar months (UTC), not 30-day windows", () => {
    const block = aggSrc.match(/function monthBounds[\s\S]+?\n\}/);
    expect(block, "monthBounds helper must exist").not.toBeNull();
    const body = block![0];
    // First-of-month UTC math.
    expect(body).toMatch(/Date\.UTC\(y,\s*m,\s*1\)/);
    expect(body).toMatch(/Date\.UTC\(y,\s*m\s*\+\s*1,\s*1\)/);
    // ymd label is `YYYY-MM`.
    expect(body).toMatch(/getUTCFullYear\(\)/);
    expect(body).toMatch(/getUTCMonth\(\)/);
  });

  it("month-over-month percent change is null-safe on zero baseline", () => {
    const block = aggSrc.match(
      /async function getMonthOverMonth[\s\S]+?\n\}/,
    );
    expect(block, "getMonthOverMonth must exist").not.toBeNull();
    const body = block![0];
    expect(body).toMatch(/previousRevenue === 0\s*\?\s*null/);
  });

  it("does NOT reintroduce the failing GROUP BY alias bug", () => {
    expect(aggSrc).not.toMatch(/\.groupBy\(\s*sql`\s*[a-z_][a-z0-9_]*\s*`\s*\)/);
    expect(commonSrc).not.toMatch(/\.groupBy\(\s*sql`\s*[a-z_][a-z0-9_]*\s*`\s*\)/);
  });
});

// ---------------------------------------------------------------------------
// Layer 4 — reuse canonicality
// ---------------------------------------------------------------------------

describe("Revenue / Financial — trend + breakdown helpers are shared", () => {
  const commonSrc = fs.readFileSync(commonPath, "utf-8");
  const aggSrc = fs.readFileSync(aggregatorPath, "utf-8");
  const finSrc = fs.readFileSync(financialAggregatorPath, "utf-8");

  it("reportsCommon owns the canonical trend + breakdown helpers", () => {
    expect(commonSrc).toMatch(/export async function getRevenueTrendShared\(/);
    expect(commonSrc).toMatch(/export async function getPaymentBreakdownShared\(/);
    expect(commonSrc).toMatch(/export async function getRevenueByClientShared\(/);
    expect(commonSrc).toMatch(/export async function getRecentPaymentsShared\(/);
    // The avg-payment-amount lambda lives inside `sharedQueries`.
    expect(commonSrc).toMatch(/avgPaymentAmount:\s*\(companyId/);
  });

  it("Financial aggregator imports the shared helpers — no local copies", () => {
    expect(finSrc).toMatch(/getRevenueTrendShared/);
    expect(finSrc).toMatch(/getPaymentBreakdownShared/);
    // Anti-regression: the local async helpers must be gone.
    expect(finSrc).not.toMatch(/^async function getRevenueTrend\(/m);
    expect(finSrc).not.toMatch(/^async function getPaymentBreakdown\(/m);
    expect(finSrc).not.toMatch(/^const METHOD_LABELS\b/m);
  });

  it("Revenue aggregator imports the same shared helpers", () => {
    expect(aggSrc).toMatch(/from "\.\/reportsCommon"/);
    expect(aggSrc).toMatch(/getRevenueTrendShared/);
    expect(aggSrc).toMatch(/getPaymentBreakdownShared/);
    expect(aggSrc).toMatch(/getRevenueByClientShared/);
    expect(aggSrc).toMatch(/getRecentPaymentsShared/);
  });
});

// ---------------------------------------------------------------------------
// Layer 5 — App + library wiring
// ---------------------------------------------------------------------------

describe("Revenue — app route + library catalog wiring", () => {
  const appSrc = fs.readFileSync(appPath, "utf-8");

  it("imports ReportsRevenue and mounts /reports/revenue under requireManager", () => {
    expect(appSrc).toMatch(
      /import ReportsRevenue from "@\/pages\/ReportsRevenue";/,
    );
    const block = appSrc.match(
      /<Route path="\/reports\/revenue">[\s\S]+?<\/Route>/,
    );
    expect(block, "/reports/revenue route must exist").not.toBeNull();
    expect(block![0]).toMatch(/<ProtectedRoute requireManager>/);
    expect(block![0]).toMatch(/<ReportsRevenue \/>/);
  });

  it("the library catalog includes an active Revenue entry under Financial", () => {
    const financial = REPORTS_LIBRARY.find((c) => c.id === "financial");
    expect(financial, "Financial category must exist").toBeDefined();
    const revenue = financial!.reports.find((r) => r.id === "revenue");
    expect(revenue, "Revenue entry must exist").toBeDefined();
    expect(revenue!.status).toBe("active");
    expect(revenue!.href).toBe("/reports/revenue");
    expect(revenue!.title.toLowerCase()).toContain("revenue");
    expect(revenue!.description.length).toBeGreaterThan(0);
  });
});
