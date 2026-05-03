/**
 * Tests for the Reports → Financial tab (2026-05-02).
 *
 * Mirrors the structure of `reports-snapshot.test.ts`:
 *
 *   1. Source-grep regression guards on `Reports.tsx` for the new
 *      Financial tab UI (sections present, query key wired, empty
 *      states use the same canonical "Not enough data yet" copy).
 *   2. No-fake-data guards: forbidden phrases + no hardcoded
 *      `currentValue: <number>` literals in any Financial-related file.
 *   3. Server route + storage source guards: route mounted under
 *      `requireRole(MANAGER_ROLES)`, aggregator reads canonical real
 *      tables only, every section sets `hasData`, AR uses 4 buckets,
 *      payment-time excludes unpaid invoices, payment grouping
 *      normalizes unknown methods to "other".
 *   4. Shared-helpers guard: `reportsCommon.ts` is the single source
 *      of truth for the windowed scalars + percent-change rule, and
 *      both the Snapshot and Financial aggregators import from it.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = path.resolve(__dirname, "..");
const pagePath = path.join(repoRoot, "client", "src", "pages", "Reports.tsx");
const routePath = path.join(repoRoot, "server", "routes", "reports.ts");
const aggregatorPath = path.join(repoRoot, "server", "storage", "reportsFinancial.ts");
const sharedPath = path.join(repoRoot, "shared", "reports", "financial.ts");
const commonPath = path.join(repoRoot, "server", "storage", "reportsCommon.ts");
const snapshotPath = path.join(repoRoot, "server", "storage", "reportsSnapshot.ts");

// ---------------------------------------------------------------------------
// Layer 1 — Reports.tsx source-level guards (Financial tab)
// ---------------------------------------------------------------------------

describe("Reports page (Financial tab — source guard)", () => {
  const source = fs.readFileSync(pagePath, "utf-8");

  it("renders the Financial tab content via FinancialBody (not the Coming-soon placeholder)", () => {
    // The Financial TabsContent must mount FinancialBody — confirms
    // the tab actually renders the new drill-down rather than the
    // legacy ComingSoonTab.
    expect(source).toMatch(/<TabsContent value="financial">\s*<FinancialBody/);
    // Tabs that still ship as Coming Soon must NOT reuse FinancialBody.
    // 2026-05-02 phase 4 update: Sales now mounts SalesBody; Team /
    // Equipment remain on ComingSoonTab. Pick one that's still in
    // Coming-Soon state for the negative assertion.
    const teamBlock = source.match(/<TabsContent value="team">[\s\S]+?<\/TabsContent>/);
    expect(teamBlock?.[0] ?? "").toContain("ComingSoonTab");
    expect(teamBlock?.[0] ?? "").not.toContain("FinancialBody");
  });

  it("threads the canonical /api/reports/financial endpoint into TanStack Query", () => {
    expect(source).toMatch(/\["\/api\/reports\/financial",\s*range\]/);
    expect(source).toMatch(/`\/api\/reports\/financial\?range=\$\{range\}`/);
  });

  it("renders all six Financial sections with canonical test ids", () => {
    for (const id of [
      "financial-section-kpis",
      "financial-section-revenue-trend",
      "financial-section-payment-breakdown",
      "financial-section-payment-time",
      "financial-section-ar",
      "financial-section-invoice-status",
      "financial-section-top-clients",
    ]) {
      // testId / data-testid both appear depending on whether the
      // section uses MetricsSection (testId prop) or a custom card
      // (literal data-testid). The grep covers both.
      const propMatch = new RegExp(`testId="${id}"`).test(source);
      const attrMatch = new RegExp(`data-testid="${id}"`).test(source);
      expect(propMatch || attrMatch, `expected ${id} in source`).toBe(true);
    }
  });

  it("each section renders SectionEmpty when its hasData flag is false", () => {
    // Every Financial card (RevenueTrendCard / PaymentBreakdownCard / etc.)
    // routes through the same SectionEmpty primitive used by the Snapshot
    // tab, gated on `!section.hasData` / `!metric.hasData`. Brace-matched
    // bodies are awkward to extract via regex; split on `function ` and
    // check the chunk for each named card up to the NEXT `function `.
    const sectionFunctions = [
      "RevenueTrendCard",
      "PaymentBreakdownCard",
      "FinancialARSection",
      "InvoiceStatusCard",
      "PaymentTimeCard",
      "TopOutstandingClientsCard",
    ];
    const chunks = source.split(/\nfunction /);
    for (const fn of sectionFunctions) {
      const chunk = chunks.find((c) => c.startsWith(`${fn}(`) || c.startsWith(`${fn} `));
      expect(chunk, `${fn} must exist`).toBeDefined();
      expect(chunk!, `${fn} must short-circuit on !hasData`).toMatch(
        /!(section|metric)\.hasData/,
      );
      expect(chunk!).toContain("SectionEmpty");
    }
  });

  it("full-page error path triggers ONLY on (isError || !data) — not on partial data", () => {
    // CRLF-tolerant: split on `function ` instead of using a brittle
    // `\n\}\n` regex that fails on CRLF source files.
    const chunks = source.split(/\nfunction /);
    const body = chunks.find(
      (c) => c.startsWith("FinancialBody(") || c.startsWith("FinancialBody "),
    );
    expect(body, "FinancialBody must exist").toBeDefined();
    expect(body!).toMatch(/if\s*\(isError\s*\|\|\s*!data\)/);
    // The error branch's body must not gate on metric content / section
    // emptiness — that would re-introduce the "blank page on partial
    // data" regression the spec calls out.
    const errorMatch = body!.match(
      /if\s*\(isError\s*\|\|\s*!data\)\s*\{[\s\S]+?return[\s\S]+?\}/,
    );
    expect(errorMatch).not.toBeNull();
    expect(errorMatch![0]).not.toMatch(/metrics\.length|hasData/);
    expect(body!).toContain('data-testid="financial-error"');
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — no-fake-data guards
// ---------------------------------------------------------------------------

describe("Financial tab — no fabricated metric values", () => {
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
      "fakeRevenue",
      "demoTotal",
    ];
    for (const src of sources) {
      for (const phrase of forbidden) {
        expect(src.toLowerCase()).not.toContain(phrase.toLowerCase());
      }
    }
  });

  it("does not declare a hardcoded currentValue / totalAmount literal", () => {
    // Any literal number assigned to currentValue / totalAmount in a
    // *.ts(x) source file would mean a fabricated metric. Type signatures
    // (interface members) declare `currentValue: number | null` without
    // an assignment — those are excluded by the regex.
    for (const src of sources) {
      expect(src.match(/currentValue:\s*\d+(?:\.\d+)?/g) ?? []).toEqual([]);
      expect(src.match(/totalAmount:\s*\d+(?:\.\d+)?/g) ?? []).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Layer 3 — server route + aggregator wiring guards
// ---------------------------------------------------------------------------

describe("Financial — server route + aggregator wiring", () => {
  const routeSrc = fs.readFileSync(routePath, "utf-8");
  const aggSrc = fs.readFileSync(aggregatorPath, "utf-8");

  it("registers GET /financial under requireRole(MANAGER_ROLES)", () => {
    expect(routeSrc).toMatch(/router\.get\(\s*"\/financial",\s*requireRole\(MANAGER_ROLES\)/);
    expect(routeSrc).toMatch(/getCompanyFinancial/);
    expect(routeSrc).toMatch(/financialQuerySchema/);
  });

  it("aggregator reads canonical real-data tables only — no mocks", () => {
    // 2026-05-03: clientLocations/customerCompanies joins moved into
    // `reportsCommon.getTopOutstandingClientsShared` so the AR
    // deep-report can reuse them. Check the union of the financial
    // aggregator and reportsCommon for the full real-data inventory.
    const commonSrc = fs.readFileSync(
      path.resolve(__dirname, "..", "server", "storage", "reportsCommon.ts"),
      "utf-8",
    );
    const union = aggSrc + "\n" + commonSrc;
    for (const table of ["invoices", "payments", "clientLocations", "customerCompanies"]) {
      expect(union).toContain(table);
    }
    expect(aggSrc).not.toMatch(/mockMetrics|fakeData|HARDCODED_/i);
    expect(commonSrc).not.toMatch(/mockMetrics|fakeData|HARDCODED_/i);
  });

  it("every section emits hasData and a structured payload", () => {
    // Each of the section helpers (revenueTrend, paymentBreakdown,
    // arAging, invoiceStatus, topOutstandingClients) returns an object
    // that includes `hasData`. The KPI metrics + paymentTime use
    // buildMetric (from reportsCommon) which sets hasData on each
    // MetricCard. We count BOTH `hasData:` and `hasData,` (shorthand
    // object property) so the assertion isn't sensitive to which
    // syntactic form the returned object uses.
    const explicit = (aggSrc.match(/hasData:/g) ?? []).length;
    const shorthand = (aggSrc.match(/[\s{,]hasData[\s,}]/g) ?? []).length;
    expect(explicit + shorthand).toBeGreaterThanOrEqual(11);
    // Every buildMetric call must carry polarity.
    const buildMetric = (aggSrc.match(/buildMetric\(\{/g) ?? []).length;
    const polarity = (aggSrc.match(/polarity:\s*"(higher|lower)_is_better"/g) ?? []).length;
    expect(buildMetric).toBe(6);
    expect(polarity).toBe(buildMetric);
  });

  it("AR section is 4-bucketed (current / 1–30 / 31–60 / 61+) with the canonical keys", () => {
    for (const key of [`"current"`, `"d30"`, `"d60"`, `"d90"`]) {
      expect(aggSrc).toContain(key);
    }
    // The bucket boundary uses dueDate vs CURRENT_DATE, not a JS Date.
    const arBlock = aggSrc.match(/async function getARAging[\s\S]+?return\s*\{[\s\S]+?\};\s*\}/);
    expect(arBlock, "getARAging must exist").not.toBeNull();
    expect(arBlock![0]).toMatch(/CURRENT_DATE - \$\{invoices\.dueDate\}/);
    expect(arBlock![0]).toMatch(/CAST\(\$\{invoices\.balance\} AS numeric\) > 0/);
  });

  it("payment-time metric excludes unpaid / partially paid invoices", () => {
    // Avg payment days lives in `sharedQueries.avgPaymentDays`. The
    // Financial aggregator references it but the SQL itself is in
    // reportsCommon. Lock both.
    const commonSrc = fs.readFileSync(commonPath, "utf-8");
    expect(commonSrc).toMatch(/avgPaymentDays:\s*\(companyId/);
    const block = commonSrc.match(/avgPaymentDays:[\s\S]+?return parseFloat[\s\S]+?\}\s*,/);
    expect(block, "avgPaymentDays lambda must exist").not.toBeNull();
    expect(block![0]).toMatch(/\$\{invoices\.status\} = 'paid'/);
    expect(block![0]).toMatch(/\$\{payments\.paymentType\} = 'payment'/);
    // Anti-regression: must not switch to "any unpaid"
    expect(block![0]).not.toMatch(/awaiting_payment|partial_paid/);
  });

  it("payment grouping normalizes unknown methods to 'other'", () => {
    // 2026-05-03: helper lifted into
    // `reportsCommon.getPaymentBreakdownShared` so the Revenue
    // deep-report consumes the same SQL. Inspect the canonical home.
    const commonSrc = fs.readFileSync(
      path.resolve(__dirname, "..", "server", "storage", "reportsCommon.ts"),
      "utf-8",
    );
    const block = commonSrc.match(
      /export async function getPaymentBreakdownShared[\s\S]+?\n\}/,
    );
    expect(block, "getPaymentBreakdownShared must exist").not.toBeNull();
    const body = block![0];
    // Canonical method set comes from KNOWN_PAYMENT_METHODS /
    // PAYMENT_METHOD_LABELS — the lookup table covers the schema's
    // paymentMethodEnum verbatim.
    expect(commonSrc).toMatch(
      /KNOWN_PAYMENT_METHODS\.has\(raw\)\s*\?\s*raw\s*:\s*"other"/,
    );
    expect(body).toMatch(/eq\(payments\.paymentType,\s*"payment"\)/);
  });

  it("top outstanding clients groups by client + sums balance, capped at 10", () => {
    // 2026-05-03: the join + sort lives in
    // `reportsCommon.getTopOutstandingClientsShared` so the AR
    // deep-report reuses the same query. The Financial aggregator
    // keeps a thin wrapper that adopts the section-shape contract.
    const commonSrc = fs.readFileSync(
      path.resolve(__dirname, "..", "server", "storage", "reportsCommon.ts"),
      "utf-8",
    );
    const block = commonSrc.match(
      /export async function getTopOutstandingClientsShared[\s\S]+?\n\}/,
    );
    expect(block, "getTopOutstandingClientsShared must exist").not.toBeNull();
    const body = block![0];
    expect(body).toMatch(/innerJoin\(clientLocations/);
    expect(body).toMatch(/groupBy\(\s*\n?\s*clientLocations\.id/);
    expect(body).toMatch(/orderBy\(desc\(/);
    // The Financial wrapper still hard-codes the cap at 10.
    expect(aggSrc).toMatch(/TOP_CLIENTS_LIMIT\s*=\s*10/);
    expect(aggSrc).toMatch(/getTopOutstandingClientsShared\(companyId,\s*TOP_CLIENTS_LIMIT\)/);
  });

  it("revenue trend uses payments.receivedAt (cash basis), not invoice issueDate", () => {
    // 2026-05-03: helper lifted into
    // `reportsCommon.getRevenueTrendShared`.
    const commonSrc = fs.readFileSync(
      path.resolve(__dirname, "..", "server", "storage", "reportsCommon.ts"),
      "utf-8",
    );
    const block = commonSrc.match(
      /export async function getRevenueTrendShared[\s\S]+?\n\}/,
    );
    expect(block, "getRevenueTrendShared must exist").not.toBeNull();
    const body = block![0];
    expect(body).toMatch(/payments\.receivedAt/);
    expect(body).toMatch(/eq\(payments\.paymentType,\s*"payment"\)/);
    // Anti-regression: must not switch to invoice issueDate (would be
    // accrual-basis and conflict with the spec's cash-basis rule).
    expect(body).not.toMatch(/invoices\.issueDate/);
  });
});

// ---------------------------------------------------------------------------
// Layer 4 — shared helpers in reportsCommon are the single source of truth
// ---------------------------------------------------------------------------

describe("Financial / Snapshot — shared helpers must live in reportsCommon", () => {
  const commonSrc = fs.readFileSync(commonPath, "utf-8");
  const snapshotSrc = fs.readFileSync(snapshotPath, "utf-8");
  const aggSrc = fs.readFileSync(aggregatorPath, "utf-8");

  it("reportsCommon exports the canonical primitives", () => {
    for (const sym of [
      "buildComparisonWindows",
      "evaluateScalar",
      "buildMetric",
      "percentChange",
      "round2",
      "allZero",
      "sharedQueries",
    ]) {
      expect(commonSrc).toMatch(new RegExp(`export (?:const|function|async function|type|interface) ${sym}\\b`));
    }
  });

  it("Snapshot aggregator imports its scalar helpers from reportsCommon", () => {
    expect(snapshotSrc).toMatch(/from "\.\/reportsCommon"/);
    expect(snapshotSrc).toMatch(/sharedQueries\.revenue\(/);
    expect(snapshotSrc).toMatch(/sharedQueries\.avgPaymentDays\(/);
    expect(snapshotSrc).toMatch(/sharedQueries\.ar30PlusAtPoint\(/);
    // Old local copies must be gone — no in-file `const queries = {` block
    // can re-define `revenue` / `avgPaymentDays` / `ar30PlusAtPoint`.
    expect(snapshotSrc).not.toMatch(/^\s*revenue:\s*\(companyId/m);
    expect(snapshotSrc).not.toMatch(/^\s*avgPaymentDays:\s*\(companyId/m);
    expect(snapshotSrc).not.toMatch(/^\s*ar30PlusAtPoint:\s*\(companyId/m);
  });

  it("Financial aggregator imports the same primitives", () => {
    expect(aggSrc).toMatch(/from "\.\/reportsCommon"/);
    expect(aggSrc).toMatch(/sharedQueries\.revenue\(/);
    expect(aggSrc).toMatch(/sharedQueries\.avgPaymentDays\(/);
  });

  it("percent change short-circuits on zero baselines (no fabricated 'Infinity%')", () => {
    expect(commonSrc).toMatch(/if\s*\(\s*prev\s*===\s*0\s*\)\s*return\s*null/);
  });
});

// ---------------------------------------------------------------------------
// Layer 5 — RevenueTrendCard + PaymentBreakdownCard (2026-05-02 phase 2).
//
// Locks the two highest-value Financial sections to the rules the spec
// calls out:
//   - real backend data only, no front-end re-aggregation,
//   - SectionEmpty wired on `!section.hasData`,
//   - PaymentBreakdownCard renders BOTH a dollar amount and a percent
//     per row, and preserves the backend-emitted descending order
//     (the aggregator already sorts `items` by `totalAmount` desc),
//   - no literal numeric KPI values anywhere in either component body.
// ---------------------------------------------------------------------------

describe("Reports Financial — RevenueTrendCard + PaymentBreakdownCard", () => {
  const pageSrc = fs.readFileSync(
    path.resolve(__dirname, "..", "client", "src", "pages", "Reports.tsx"),
    "utf-8",
  );
  // Source chunks for each component, split on the `function ` keyword so
  // brace-matched bodies are easy to grep without coupling the test to
  // the file's exact line numbering.
  const chunks = pageSrc.split(/\nfunction /);
  const revenueTrendBody =
    chunks.find((c) => c.startsWith("RevenueTrendCard(") || c.startsWith("RevenueTrendCard ")) ??
    "";
  const paymentBreakdownBody =
    chunks.find(
      (c) => c.startsWith("PaymentBreakdownCard(") || c.startsWith("PaymentBreakdownCard "),
    ) ?? "";
  const trendBarBody =
    chunks.find((c) => c.startsWith("TrendBar(") || c.startsWith("TrendBar ")) ?? "";

  // ── RevenueTrendCard ──────────────────────────────────────────────────

  it("RevenueTrendCard renders the backend revenue-trend section verbatim", () => {
    expect(revenueTrendBody, "RevenueTrendCard must exist").not.toBe("");
    // Reads from the canonical FinancialResponse shape.
    expect(revenueTrendBody).toMatch(/section:\s*FinancialResponse\["revenueTrend"\]/);
    // Iterates `section.points` directly — no re-aggregation, no
    // group-by, no daily/weekly bucket math on the client.
    expect(revenueTrendBody).toMatch(/section\.points\.map\(/);
    // Forbidden client-side aggregation patterns.
    expect(revenueTrendBody).not.toMatch(/section\.points\.filter\(/);
    expect(revenueTrendBody).not.toMatch(/groupBy|bucketBy|aggregate/i);
    // The only `.reduce(...)` allowed is the visual max for relative
    // bar height — that's presentation, not data aggregation.
    const reduces = revenueTrendBody.match(/\.reduce\(/g) ?? [];
    expect(reduces.length).toBeLessThanOrEqual(1);
    if (reduces.length === 1) {
      // The lone reduce must compute `Math.max` (visual scale) —
      // anything else (sum, group, etc.) would re-aggregate backend
      // data and fail the spec rule.
      const reduceIdx = revenueTrendBody.indexOf(".reduce(");
      const reduceTail = revenueTrendBody.slice(reduceIdx, reduceIdx + 200);
      expect(reduceTail).toContain("Math.max");
    }
  });

  it("RevenueTrendCard short-circuits to SectionEmpty when hasData is false", () => {
    expect(revenueTrendBody).toMatch(/!section\.hasData/);
    expect(revenueTrendBody).toMatch(/<SectionEmpty\s+testId="financial-section-revenue-trend"/);
  });

  it("RevenueTrendCard mounts the bars container with the canonical test id", () => {
    // The container test id lets DOM-level assertions / future
    // integration tests find the chart wrapper.
    expect(revenueTrendBody).toMatch(/data-testid="financial-revenue-trend-chart"/);
    // Each bar uses the date as its test id key — derived from
    // backend-emitted `p.date`, NOT from a synthetic index.
    expect(trendBarBody).toMatch(/data-testid=\{`trend-bar-\$\{date\}`\}/);
  });

  it("RevenueTrendCard contains no hardcoded numeric values for amounts/dates", () => {
    // Forbid any literal `amount: <n>` / `value: <n>` / `count: <n>`
    // assignments in the component body — they'd indicate mock data.
    expect(revenueTrendBody.match(/\b(amount|value|count):\s*\d+(?:\.\d+)?/g) ?? []).toEqual([]);
    // The same check on the per-bar component.
    expect(trendBarBody.match(/\b(amount|value|count):\s*\d+(?:\.\d+)?/g) ?? []).toEqual([]);
  });

  // ── PaymentBreakdownCard ──────────────────────────────────────────────

  it("PaymentBreakdownCard renders the backend paymentBreakdown section verbatim", () => {
    expect(paymentBreakdownBody, "PaymentBreakdownCard must exist").not.toBe("");
    expect(paymentBreakdownBody).toMatch(
      /section:\s*FinancialResponse\["paymentBreakdown"\]/,
    );
    expect(paymentBreakdownBody).toMatch(/section\.items\.map\(/);
  });

  it("PaymentBreakdownCard preserves the backend's descending sort by totalAmount", () => {
    // The aggregator already does `.sort((a, b) => b.totalAmount - a.totalAmount)`
    // on the server side. The card must NOT re-sort or filter — that
    // would either duplicate logic or hide rows the backend emitted.
    expect(paymentBreakdownBody).not.toMatch(/section\.items\.sort\(/);
    expect(paymentBreakdownBody).not.toMatch(/section\.items\.filter\(/);
    expect(paymentBreakdownBody).not.toMatch(/section\.items\.reduce\(/);
    // 2026-05-03: the sort lives in
    // `reportsCommon.getPaymentBreakdownShared` now (lifted so the
    // Revenue deep-report reuses it). Inspect the canonical home.
    const commonSrc = fs.readFileSync(
      path.resolve(__dirname, "..", "server", "storage", "reportsCommon.ts"),
      "utf-8",
    );
    expect(commonSrc).toMatch(
      /\.sort\(\(a,\s*b\)\s*=>\s*b\.totalAmount\s*-\s*a\.totalAmount\)/,
    );
  });

  it("PaymentBreakdownCard renders BOTH a currency amount and a percent per row", () => {
    // Currency amount via the canonical formatter — guarantees the
    // dollar render rules (no decimals, locale separators) match
    // every other Reports surface.
    expect(paymentBreakdownBody).toMatch(
      /formatMetricValue\(\s*item\.totalAmount,\s*"currency"\s*\)/,
    );
    // Percent appears inline as `<n>.<n>%`. The toFixed(1) form is the
    // only acceptable percent renderer — locks against silent rounding
    // drift if a future contributor drops the decimal.
    expect(paymentBreakdownBody).toMatch(/item\.percentOfTotal\.toFixed\(1\)/);
    expect(paymentBreakdownBody).toMatch(/%/);
  });

  it("PaymentBreakdownCard short-circuits to SectionEmpty when hasData is false", () => {
    expect(paymentBreakdownBody).toMatch(/!section\.hasData/);
    expect(paymentBreakdownBody).toMatch(
      /<SectionEmpty\s+testId="financial-section-payment-breakdown"/,
    );
  });

  it("PaymentBreakdownCard contains no hardcoded payment amounts or percentages", () => {
    expect(
      paymentBreakdownBody.match(/\btotalAmount:\s*\d+(?:\.\d+)?/g) ?? [],
    ).toEqual([]);
    expect(
      paymentBreakdownBody.match(/\bpercentOfTotal:\s*\d+(?:\.\d+)?/g) ?? [],
    ).toEqual([]);
    expect(paymentBreakdownBody.match(/\bcount:\s*\d+(?:\.\d+)?/g) ?? []).toEqual([]);
    // And no literal dollar strings either.
    expect(paymentBreakdownBody).not.toMatch(/\$[\d,]+(?:\.\d+)?/);
  });

  // ── Section ordering inside FinancialBody ─────────────────────────────

  it("FinancialBody mounts Revenue Trend BEFORE Payments Breakdown, after the KPI strip", () => {
    const kpiIdx = pageSrc.indexOf('testId="financial-section-kpis"');
    const trendIdx = pageSrc.indexOf("<RevenueTrendCard ");
    const breakdownIdx = pageSrc.indexOf("<PaymentBreakdownCard ");
    expect(kpiIdx).toBeGreaterThan(-1);
    expect(trendIdx).toBeGreaterThan(kpiIdx);
    expect(breakdownIdx).toBeGreaterThan(trendIdx);
    // AR + invoice status follow afterwards — verify ordering is stable.
    const arIdx = pageSrc.indexOf("<FinancialARSection ");
    expect(arIdx).toBeGreaterThan(breakdownIdx);
  });
});
