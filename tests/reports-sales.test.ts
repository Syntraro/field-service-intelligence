/**
 * Tests for the Reports → Sales tab (2026-05-02).
 *
 * Mirrors the Snapshot / Financial / Operations test pattern:
 *   1. Source-grep guards on `Reports.tsx` for the new Sales tab UI
 *      (sections, query key, empty states, no front-end aggregation).
 *   2. No-fake-data guards: forbidden phrases + non-zero metric output
 *      literals in any Sales-related file.
 *   3. Server route + storage source guards: route under
 *      `requireRole(MANAGER_ROLES)`, aggregator uses canonical real
 *      tables only, every section emits `hasData`, KPIs route through
 *      `sharedQueries`, conversion predicates match the canonical
 *      definitions exactly (no inferred conversions), status
 *      breakdowns use only the real enum values.
 *   4. Shared-helper canonicality: the four lead/quote KPI lambdas
 *      now live in `reportsCommon.sharedQueries` and BOTH Snapshot
 *      and Sales import them — the Snapshot tab no longer has local
 *      copies.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = path.resolve(__dirname, "..");
const pagePath = path.join(repoRoot, "client", "src", "pages", "Reports.tsx");
const routePath = path.join(repoRoot, "server", "routes", "reports.ts");
const aggregatorPath = path.join(repoRoot, "server", "storage", "reportsSales.ts");
const sharedPath = path.join(repoRoot, "shared", "reports", "sales.ts");
const commonPath = path.join(repoRoot, "server", "storage", "reportsCommon.ts");
const snapshotStoragePath = path.join(
  repoRoot,
  "server",
  "storage",
  "reportsSnapshot.ts",
);

// ---------------------------------------------------------------------------
// Layer 1 — Reports.tsx Sales tab source guards
// ---------------------------------------------------------------------------

describe("Reports page (Sales tab — source guard)", () => {
  const source = fs.readFileSync(pagePath, "utf-8");

  it("renders the Sales tab content via SalesBody (not the Coming-soon placeholder)", () => {
    expect(source).toMatch(/<TabsContent value="sales">\s*<SalesBody/);
    // Tabs that still ship as Coming Soon (team / equipment) must NOT
    // mount SalesBody — only the Sales tab does.
    const teamBlock = source.match(/<TabsContent value="team">[\s\S]+?<\/TabsContent>/);
    expect(teamBlock?.[0] ?? "").toContain("ComingSoonTab");
    expect(teamBlock?.[0] ?? "").not.toContain("SalesBody");
  });

  it("threads the canonical /api/reports/sales endpoint into TanStack Query", () => {
    expect(source).toMatch(/\["\/api\/reports\/sales",\s*range\]/);
    expect(source).toMatch(/`\/api\/reports\/sales\?range=\$\{range\}`/);
  });

  it("renders all seven Sales sections with canonical test ids", () => {
    for (const id of [
      "sales-section-kpis",
      "sales-section-lead-creation",
      "sales-section-lead-conversion",
      "sales-section-quote-creation",
      "sales-section-quote-conversion",
      "sales-section-lead-status",
      "sales-section-quote-status",
    ]) {
      const propMatch = new RegExp(`testId="${id}"`).test(source);
      const attrMatch = new RegExp(`data-testid="${id}"`).test(source);
      expect(propMatch || attrMatch, `expected ${id} in source`).toBe(true);
    }
  });

  it("each section card short-circuits to SectionEmpty when hasData is false", () => {
    const chunks = source.split(/\nfunction /);
    const cards = [
      "LeadCreationTrendCard",
      "LeadConversionTrendCard",
      "QuoteCreationTrendCard",
      "QuoteConversionTrendCard",
      "LeadStatusBreakdownCard",
      "QuoteStatusBreakdownCard",
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

  it("SalesBody full-page error path triggers ONLY on (isError || !data)", () => {
    // Brace-matched bodies are awkward to extract via regex on CRLF
    // sources; split on `function ` and inspect the chunk for SalesBody.
    const chunks = source.split(/\nfunction /);
    const body = chunks.find(
      (c) => c.startsWith("SalesBody(") || c.startsWith("SalesBody "),
    );
    expect(body, "SalesBody must exist").toBeDefined();
    expect(body!).toMatch(/if\s*\(isError\s*\|\|\s*!data\)/);
    // The error branch must not gate on per-section content.
    const errorMatch = body!.match(
      /if\s*\(isError\s*\|\|\s*!data\)\s*\{[\s\S]+?return[\s\S]+?\}/,
    );
    expect(errorMatch).not.toBeNull();
    expect(errorMatch![0]).not.toMatch(/metrics\.length|hasData/);
    expect(body!).toContain('data-testid="sales-error"');
  });

  it("Sales sections render in the spec order", () => {
    const order = [
      'testId="sales-section-kpis"',
      "<LeadCreationTrendCard ",
      "<LeadConversionTrendCard ",
      "<QuoteCreationTrendCard ",
      "<QuoteConversionTrendCard ",
      "<LeadStatusBreakdownCard ",
      "<QuoteStatusBreakdownCard ",
    ];
    let lastIdx = -1;
    for (const marker of order) {
      const idx = source.indexOf(marker);
      expect(idx, `expected ${marker} in source`).toBeGreaterThan(-1);
      expect(idx, `expected ${marker} after the previous marker`).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }
  });

  it("trend cards iterate backend points directly — no front-end aggregation", () => {
    const chunks = source.split(/\nfunction /);
    const trendCards = [
      "LeadCreationTrendCard",
      "LeadConversionTrendCard",
      "QuoteCreationTrendCard",
      "QuoteConversionTrendCard",
    ];
    for (const fn of trendCards) {
      const chunk = chunks.find(
        (c) => c.startsWith(`${fn}(`) || c.startsWith(`${fn} `),
      );
      expect(chunk, `${fn} must exist`).toBeDefined();
      expect(chunk!).toMatch(/section\.points\.map\(/);
      expect(chunk!).not.toMatch(/section\.points\.filter\(/);
      expect(chunk!).not.toMatch(/section\.points\.sort\(/);
      expect(chunk!).not.toMatch(/groupBy|bucketBy|aggregate/i);
      // The only `.reduce(...)` allowed is the visual-max for bar height.
      // Conversion cards don't need any reduce because they're scaled to
      // the fixed 0–100 ceiling — only the count cards may use one.
      const reduces = chunk!.match(/\.reduce\(/g) ?? [];
      expect(reduces.length).toBeLessThanOrEqual(1);
      if (reduces.length === 1) {
        const idx = chunk!.indexOf(".reduce(");
        const tail = chunk!.slice(idx, idx + 200);
        expect(tail).toContain("Math.max");
      }
    }
  });

  it("status breakdown cards iterate backend items directly — no client-side re-sort", () => {
    const chunks = source.split(/\nfunction /);
    const breakdownCards = ["LeadStatusBreakdownCard", "QuoteStatusBreakdownCard"];
    for (const fn of breakdownCards) {
      const chunk = chunks.find(
        (c) => c.startsWith(`${fn}(`) || c.startsWith(`${fn} `),
      );
      expect(chunk, `${fn} must exist`).toBeDefined();
      // The cards delegate rendering to the shared StatusBreakdownList
      // which iterates `items` directly. Neither the card nor the list
      // wrapper is allowed to re-sort / filter / reduce items.
      expect(chunk!).not.toMatch(/section\.items\.sort\(/);
      expect(chunk!).not.toMatch(/section\.items\.filter\(/);
      expect(chunk!).not.toMatch(/section\.items\.reduce\(/);
    }
    // Same negative checks on the shared list helper.
    const listChunk = chunks.find(
      (c) => c.startsWith("StatusBreakdownList(") || c.startsWith("StatusBreakdownList "),
    );
    expect(listChunk, "StatusBreakdownList must exist").toBeDefined();
    expect(listChunk!).toMatch(/items\.map\(/);
    expect(listChunk!).not.toMatch(/items\.sort\(/);
    expect(listChunk!).not.toMatch(/items\.filter\(/);
    expect(listChunk!).not.toMatch(/items\.reduce\(/);
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — no-fake-data guards
// ---------------------------------------------------------------------------

describe("Sales tab — no fabricated metric values", () => {
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
      "fakeLeads",
      "fakeQuotes",
      "demoTotal",
    ];
    for (const src of sources) {
      for (const phrase of forbidden) {
        expect(src.toLowerCase()).not.toContain(phrase.toLowerCase());
      }
    }
  });

  it("does not declare hardcoded metric-output literals", () => {
    // Targets MetricCard / output-shape fields. Accumulator zero-inits
    // (`{ count: 0 }`) are NOT fake data — those get overwritten with
    // real DB values.
    const forbidden = /\b(currentValue|previousMonthValue|previousQuarterValue|previousYearValue|conversionPercent|percentOfTotal):\s*[1-9]\d*(?:\.\d+)?/g;
    for (const src of sources) {
      expect(src.match(forbidden) ?? []).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Layer 3 — server route + aggregator wiring guards
// ---------------------------------------------------------------------------

describe("Sales — server route + aggregator wiring", () => {
  const routeSrc = fs.readFileSync(routePath, "utf-8");
  const aggSrc = fs.readFileSync(aggregatorPath, "utf-8");

  it("registers GET /sales under requireRole(MANAGER_ROLES)", () => {
    expect(routeSrc).toMatch(/router\.get\(\s*"\/sales",\s*requireRole\(MANAGER_ROLES\)/);
    expect(routeSrc).toMatch(/getCompanySales/);
    expect(routeSrc).toMatch(/salesQuerySchema/);
  });

  it("aggregator reads canonical real-data tables only — no mocks", () => {
    // 2026-05-03: Sales section helpers were lifted into reportsCommon
    // so the Sales Funnel deep-report can reuse them. The Sales
    // aggregator is now a thin orchestrator; table imports live in
    // reportsCommon. Check the union.
    const commonSrc = fs.readFileSync(commonPath, "utf-8");
    const union = aggSrc + "\n" + commonSrc;
    for (const table of ["leads", "quotes", "leadStatusEnum", "quoteStatusEnum"]) {
      expect(union).toContain(table);
    }
    expect(aggSrc).not.toMatch(/mockMetrics|fakeData|HARDCODED_/i);
    expect(commonSrc).not.toMatch(/mockMetrics|fakeData|HARDCODED_/i);
  });

  it("every section emits hasData and the KPI strip uses sharedQueries", () => {
    // 4 buildMetric calls in the KPI strip. Section `hasData` flags
    // live in the shared helpers (reportsCommon), not in the Sales
    // orchestrator.
    const buildMetric = (aggSrc.match(/buildMetric\(\{/g) ?? []).length;
    const polarity = (aggSrc.match(/polarity:\s*"(higher|lower)_is_better"/g) ?? []).length;
    expect(buildMetric).toBe(4);
    expect(polarity).toBe(buildMetric);
    // KPIs reuse the canonical sharedQueries — no local re-implementation.
    expect(aggSrc).toMatch(/sharedQueries\.leadsCreated\(/);
    expect(aggSrc).toMatch(/sharedQueries\.leadConversionPercent\(/);
    expect(aggSrc).toMatch(/sharedQueries\.quotesCreated\(/);
    expect(aggSrc).toMatch(/sharedQueries\.quoteConversionPercent\(/);
  });

  it("lead conversion uses the canonical signal — convertedAt OR status='won'", () => {
    // 2026-05-03: trend lives in reportsCommon now, alongside the KPI.
    const commonSrc = fs.readFileSync(commonPath, "utf-8");
    const block = commonSrc.match(
      /export async function getLeadConversionTrendShared[\s\S]+?\n\}/,
    );
    expect(block, "getLeadConversionTrendShared must exist").not.toBeNull();
    const body = block![0];
    expect(body).toMatch(
      /WHERE \$\{leads\.convertedAt\} IS NOT NULL OR \$\{leads\.status\} = 'won'/,
    );
    expect(body).not.toMatch(/leads\.status\}\s*=\s*'quoted'/);
    expect(body).not.toMatch(/leads\.status\}\s*=\s*'contacted'/);
    expect(body).not.toMatch(/leads\.status\}\s*=\s*'new'/);
  });

  it("quote conversion uses the canonical signal — convertedAt OR status IN (converted, approved)", () => {
    const commonSrc = fs.readFileSync(commonPath, "utf-8");
    const block = commonSrc.match(
      /export async function getQuoteConversionTrendShared[\s\S]+?\n\}/,
    );
    expect(block, "getQuoteConversionTrendShared must exist").not.toBeNull();
    const body = block![0];
    expect(body).toMatch(/quotes\.convertedAt\} IS NOT NULL/);
    expect(body).toMatch(/quotes\.status\} = 'converted'/);
    expect(body).toMatch(/quotes\.status\} = 'approved'/);
    expect(body).not.toMatch(/quotes\.status\}\s*=\s*'sent'/);
    expect(body).not.toMatch(/quotes\.status\}\s*=\s*'draft'/);
    expect(body).not.toMatch(/quotes\.status\}\s*=\s*'expired'/);
    expect(body).not.toMatch(/quotes\.status\}\s*=\s*'declined'/);
  });

  it("status breakdowns use ONLY the real enum values (no fabricated buckets)", () => {
    // Lifted into reportsCommon — the canonical labels live there.
    const commonSrc = fs.readFileSync(commonPath, "utf-8");
    const leadKeys = ["new", "contacted", "quoted", "won", "lost"];
    for (const k of leadKeys) {
      expect(commonSrc).toMatch(new RegExp(`${k}:\\s*\\d+`));
    }
    const quoteKeys = ["draft", "sent", "approved", "declined", "expired", "converted"];
    for (const k of quoteKeys) {
      expect(commonSrc).toMatch(new RegExp(`${k}:\\s*\\d+`));
    }
    expect(commonSrc).not.toMatch(/key:\s*"in_progress"/);
    expect(commonSrc).not.toMatch(/key:\s*"hot"/);
    expect(commonSrc).not.toMatch(/key:\s*"cold"/);
  });

  it("trend SQL queries do not re-introduce the failing GROUP BY alias bug", () => {
    expect(aggSrc).not.toMatch(/\.groupBy\(\s*sql`\s*[a-z_][a-z0-9_]*\s*`\s*\)/);
    const commonSrc = fs.readFileSync(commonPath, "utf-8");
    expect(commonSrc).not.toMatch(
      /\.groupBy\(\s*sql`\s*[a-z_][a-z0-9_]*\s*`\s*\)/,
    );
  });

  it("trend queries group by createdAt::date — not by inferred bucket aliases", () => {
    const commonSrc = fs.readFileSync(commonPath, "utf-8");
    const fns = [
      "getLeadCreationTrendShared",
      "getLeadConversionTrendShared",
      "getQuoteCreationTrendShared",
      "getQuoteConversionTrendShared",
    ];
    for (const fn of fns) {
      const chunk = commonSrc.split(/\nexport async function /).find(
        (c) => c.startsWith(`${fn}(`) || c.startsWith(`${fn} `),
      );
      expect(chunk, `${fn} must exist`).toBeDefined();
      expect(chunk!).toMatch(
        /\.groupBy\(sql`\$\{(leads|quotes)\.createdAt\}::date`\)/,
      );
      expect(chunk!).toMatch(
        /\.orderBy\(sql`\$\{(leads|quotes)\.createdAt\}::date`\)/,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Layer 4 — shared-helper canonicality
// ---------------------------------------------------------------------------

describe("Sales / Snapshot — KPI strip math is shared", () => {
  const commonSrc = fs.readFileSync(commonPath, "utf-8");
  const snapshotSrc = fs.readFileSync(snapshotStoragePath, "utf-8");
  const aggSrc = fs.readFileSync(aggregatorPath, "utf-8");

  it("reportsCommon owns the canonical lead/quote KPI lambdas", () => {
    for (const sym of [
      "leadsCreated",
      "leadConversionPercent",
      "quotesCreated",
      "quoteConversionPercent",
    ]) {
      expect(commonSrc).toMatch(new RegExp(`${sym}:\\s*\\(companyId`));
    }
  });

  it("Snapshot aggregator imports the same lambdas — no local copies", () => {
    expect(snapshotSrc).toMatch(/sharedQueries\.leadsCreated\(/);
    expect(snapshotSrc).toMatch(/sharedQueries\.leadConversionPercent\(/);
    expect(snapshotSrc).toMatch(/sharedQueries\.quotesCreated\(/);
    expect(snapshotSrc).toMatch(/sharedQueries\.quoteConversionPercent\(/);
    // Local copies must be gone — the lift was the whole point.
    expect(snapshotSrc).not.toMatch(/^\s*leadsCreated:\s*\(companyId/m);
    expect(snapshotSrc).not.toMatch(/^\s*leadConversionPercent:\s*\(companyId/m);
    expect(snapshotSrc).not.toMatch(/^\s*quotesCreated:\s*\(companyId/m);
    expect(snapshotSrc).not.toMatch(/^\s*quoteConversionPercent:\s*\(companyId/m);
  });

  it("Sales aggregator routes through sharedQueries", () => {
    expect(aggSrc).toMatch(/from "\.\/reportsCommon"/);
    expect(aggSrc).toMatch(/sharedQueries\.leadsCreated\(/);
    expect(aggSrc).toMatch(/sharedQueries\.quotesCreated\(/);
  });
});
