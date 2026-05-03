/**
 * Tests for the Sales Funnel deep-report page (`/reports/sales-funnel`)
 * and its backing aggregator (`/api/reports/sales-funnel`).
 *
 * Layers:
 *   1. Page source guards.
 *   2. No-fake-data guards.
 *   3. Server route + storage source guards — role gating, the
 *      aggregator is a thin orchestrator (zero direct DB / schema
 *      imports), KPIs route through `sharedQueries`, funnel uses
 *      real stage counts in fixed order, conversion predicates
 *      match the canonical signals exactly, conversion lag uses
 *      `convertedAt - createdAt` and respects null-timestamp
 *      fallback (`hasData=false` when missing), no GROUP BY alias
 *      regression.
 *   4. Reuse canonicality — the six Sales section helpers + the new
 *      `getConversionLagShared` live in reportsCommon; both the
 *      Sales tab AND the Funnel page consume them; Sales tab has no
 *      in-file copy.
 *   5. App + library wiring — route mounted, library entry references
 *      `/reports/sales-funnel` via `href` under Sales.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { REPORTS_LIBRARY } from "../client/src/lib/reportsLibrary";

const repoRoot = path.resolve(__dirname, "..");
const pagePath = path.join(
  repoRoot,
  "client",
  "src",
  "pages",
  "ReportsSalesFunnel.tsx",
);
const aggregatorPath = path.join(
  repoRoot,
  "server",
  "storage",
  "reportsSalesFunnel.ts",
);
const sharedPath = path.join(repoRoot, "shared", "reports", "salesFunnel.ts");
const routePath = path.join(repoRoot, "server", "routes", "reports.ts");
const commonPath = path.join(repoRoot, "server", "storage", "reportsCommon.ts");
const salesAggregatorPath = path.join(
  repoRoot,
  "server",
  "storage",
  "reportsSales.ts",
);
const appPath = path.join(repoRoot, "client", "src", "App.tsx");

// ---------------------------------------------------------------------------
// Layer 1 — page source guards
// ---------------------------------------------------------------------------

describe("Reports Sales Funnel page (/reports/sales-funnel) — source guard", () => {
  const source = fs.readFileSync(pagePath, "utf-8");

  it("exports ReportsSalesFunnel with title + range selector + back button", () => {
    expect(source).toMatch(/export default function ReportsSalesFunnel\b/);
    expect(source).toMatch(/data-testid="reports-sales-funnel-page"/);
    expect(source).toMatch(/data-testid="reports-sales-funnel-title"/);
    expect(source).toMatch(/data-testid="select-sales-funnel-range"/);
    expect(source).toMatch(/data-testid="sales-funnel-back-to-reports"/);
    expect(source).toMatch(/setLocation\("\/reports"\)/);
  });

  it("threads the canonical /api/reports/sales-funnel endpoint into TanStack Query", () => {
    expect(source).toMatch(/\["\/api\/reports\/sales-funnel",\s*range\]/);
    expect(source).toMatch(/`\/api\/reports\/sales-funnel\?range=\$\{range\}`/);
  });

  it("renders all nine sections with canonical test ids", () => {
    for (const id of [
      "sales-funnel-section-kpis",
      "sales-funnel-section-funnel",
      "sales-funnel-section-lead-creation",
      "sales-funnel-section-lead-conversion",
      "sales-funnel-section-quote-creation",
      "sales-funnel-section-quote-conversion",
      "sales-funnel-section-lead-status",
      "sales-funnel-section-quote-status",
      "sales-funnel-section-conversion-lag",
    ]) {
      const propMatch = new RegExp(`testId="${id}"`).test(source);
      const attrMatch = new RegExp(`data-testid="${id}"`).test(source);
      expect(propMatch || attrMatch, `expected ${id} in source`).toBe(true);
    }
  });

  it("each section card short-circuits to SectionEmpty when hasData is false", () => {
    const chunks = source.split(/\nfunction /);
    const cards = [
      "FunnelCard",
      "LeadCreationTrendCard",
      "LeadConversionTrendCard",
      "QuoteCreationTrendCard",
      "QuoteConversionTrendCard",
      "LeadStatusBreakdownCard",
      "QuoteStatusBreakdownCard",
      "ConversionLagCard",
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
    expect(source).toContain('data-testid="sales-funnel-error"');
  });

  it("FunnelCard iterates backend stages in order — no client reorder", () => {
    const chunks = source.split(/\nfunction /);
    const card = chunks.find(
      (c) => c.startsWith("FunnelCard(") || c.startsWith("FunnelCard "),
    );
    expect(card).toBeDefined();
    expect(card!).toMatch(/section\.stages\.map\(/);
    expect(card!).not.toMatch(/section\.stages\.sort\(/);
    expect(card!).not.toMatch(/section\.stages\.filter\(/);
    // The single permitted `.reduce()` is the visual `Math.max` for
    // bar scaling — anything else (sum, group, etc.) would
    // re-aggregate the backend's stage counts.
    const reduces = card!.match(/\.reduce\(/g) ?? [];
    expect(reduces.length).toBeLessThanOrEqual(1);
    if (reduces.length === 1) {
      const idx = card!.indexOf(".reduce(");
      const tail = card!.slice(idx, idx + 200);
      expect(tail).toContain("Math.max");
    }
  });

  it("trend + status cards iterate backend items directly — no client sort", () => {
    const chunks = source.split(/\nfunction /);
    const cards = [
      "LeadCreationTrendCard",
      "LeadConversionTrendCard",
      "QuoteCreationTrendCard",
      "QuoteConversionTrendCard",
    ];
    for (const fn of cards) {
      const card = chunks.find(
        (c) => c.startsWith(`${fn}(`) || c.startsWith(`${fn} `),
      );
      expect(card, `${fn} must exist`).toBeDefined();
      expect(card!).toMatch(/section\.points\.map\(/);
      expect(card!).not.toMatch(/section\.points\.sort\(/);
      expect(card!).not.toMatch(/section\.points\.filter\(/);
      // The only `.reduce()` allowed is the visual-max for bar height
      // on count-trend cards. Conversion-trend cards scale to a fixed
      // 0–100 ceiling and never reduce.
      const reduces = card!.match(/\.reduce\(/g) ?? [];
      expect(reduces.length).toBeLessThanOrEqual(1);
      if (reduces.length === 1) {
        const idx = card!.indexOf(".reduce(");
        const tail = card!.slice(idx, idx + 200);
        expect(tail).toContain("Math.max");
      }
    }
    // Status breakdown card delegates to StatusBreakdownList — neither
    // the card nor the helper is allowed to re-sort/filter.
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

describe("Sales Funnel deep-report — no fabricated metric values", () => {
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
      "fakeFunnel",
      "lorem ipsum",
    ];
    for (const src of sources) {
      for (const phrase of forbidden) {
        expect(src.toLowerCase()).not.toContain(phrase.toLowerCase());
      }
    }
  });

  it("contains no MetricCard / output-shape numeric literals", () => {
    const forbidden = /\b(currentValue|previousMonthValue|previousQuarterValue|previousYearValue|count|percentOfPrevious|percentOfTotal|conversionPercent|avgDays):\s*[1-9]\d*(?:\.\d+)?/g;
    for (const src of sources) {
      expect(src.match(forbidden) ?? []).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Layer 3 — server route + aggregator wiring guards
// ---------------------------------------------------------------------------

describe("Sales Funnel — server route + aggregator wiring", () => {
  const routeSrc = fs.readFileSync(routePath, "utf-8");
  const aggSrc = fs.readFileSync(aggregatorPath, "utf-8");
  const commonSrc = fs.readFileSync(commonPath, "utf-8");

  it("registers GET /sales-funnel under requireRole(MANAGER_ROLES)", () => {
    expect(routeSrc).toMatch(
      /router\.get\(\s*"\/sales-funnel",\s*requireRole\(MANAGER_ROLES\)/,
    );
    expect(routeSrc).toMatch(/getCompanySalesFunnel/);
    expect(routeSrc).toMatch(/salesFunnelQuerySchema/);
  });

  it("aggregator does NOT directly hit DB tables — pure orchestrator", () => {
    // Same rule the Jobs aggregator follows: no `db` / schema imports
    // in the deep-report. All SQL lives in reportsCommon.
    expect(aggSrc).not.toMatch(/from "@shared\/schema"/);
    expect(aggSrc).not.toMatch(/from "\.\.\/db"/);
    expect(aggSrc).not.toMatch(/mockMetrics|fakeData|HARDCODED_/i);
  });

  it("KPIs route through sharedQueries — including new leadsConverted/quotesConverted", () => {
    expect(aggSrc).toMatch(/sharedQueries\.leadsCreated\(/);
    expect(aggSrc).toMatch(/sharedQueries\.leadsConverted\(/);
    expect(aggSrc).toMatch(/sharedQueries\.leadConversionPercent\(/);
    expect(aggSrc).toMatch(/sharedQueries\.quotesCreated\(/);
    expect(aggSrc).toMatch(/sharedQueries\.quotesConverted\(/);
    expect(aggSrc).toMatch(/sharedQueries\.quoteConversionPercent\(/);
    // 5 KPIs.
    const buildMetric = (aggSrc.match(/buildMetric\(\{/g) ?? []).length;
    expect(buildMetric).toBe(5);
    const polarity = (aggSrc.match(/polarity:\s*"(higher|lower)_is_better"/g) ?? []).length;
    expect(polarity).toBe(buildMetric);
    // Drop-off is the only `lower_is_better` KPI.
    expect(aggSrc.match(/polarity:\s*"lower_is_better"/g)?.length ?? 0).toBe(1);
  });

  it("funnel stages are emitted in the fixed spec order", () => {
    // CRLF-tolerant: split on `function ` and inspect the buildFunnel
    // chunk for the canonical key order.
    const chunks = aggSrc.split(/\nfunction /);
    const body = chunks.find(
      (c) => c.startsWith("buildFunnel(") || c.startsWith("buildFunnel "),
    );
    expect(body, "buildFunnel must exist").toBeDefined();
    const order = body!.match(
      /key:\s*"leads_created"[\s\S]+?key:\s*"leads_converted"[\s\S]+?key:\s*"quotes_created"[\s\S]+?key:\s*"quotes_converted"/,
    );
    expect(order, "stages must be declared in spec order").not.toBeNull();
    // Anti-regression: no client-side `.sort()` on the stages.
    expect(body!).not.toMatch(/\.sort\(/);
  });

  it("funnel `percentOfPrevious` is null-safe when previous stage is 0", () => {
    const block = aggSrc.match(/function percentOfPrev\([\s\S]+?\n\}/);
    expect(block, "percentOfPrev must exist").not.toBeNull();
    const body = block![0];
    expect(body).toMatch(/if\s*\(previous\s*<=\s*0\)\s*return\s*null/);
  });

  it("lead conversion uses the canonical signal — convertedAt OR status='won'", () => {
    const block = commonSrc.match(
      /leadsConverted:[\s\S]+?return Number[\s\S]+?\}\s*,/,
    );
    expect(block, "leadsConverted must exist").not.toBeNull();
    const body = block![0];
    expect(body).toMatch(
      /WHERE \$\{leads\.convertedAt\} IS NOT NULL OR \$\{leads\.status\} = 'won'/,
    );
    // Anti-regression: no inferred lead conversion signals.
    expect(body).not.toMatch(/leads\.status\}\s*=\s*'quoted'/);
    expect(body).not.toMatch(/leads\.status\}\s*=\s*'contacted'/);
    expect(body).not.toMatch(/leads\.status\}\s*=\s*'new'/);
  });

  it("quote conversion uses the canonical signal — convertedAt OR status IN (converted, approved)", () => {
    const block = commonSrc.match(
      /quotesConverted:[\s\S]+?return Number[\s\S]+?\}\s*,/,
    );
    expect(block, "quotesConverted must exist").not.toBeNull();
    const body = block![0];
    expect(body).toMatch(/quotes\.convertedAt\} IS NOT NULL/);
    expect(body).toMatch(/quotes\.status\} = 'converted'/);
    expect(body).toMatch(/quotes\.status\} = 'approved'/);
    // Anti-regression: must NOT count draft/sent/declined as converted.
    expect(body).not.toMatch(/quotes\.status\}\s*=\s*'sent'/);
    expect(body).not.toMatch(/quotes\.status\}\s*=\s*'draft'/);
    expect(body).not.toMatch(/quotes\.status\}\s*=\s*'declined'/);
    expect(body).not.toMatch(/quotes\.status\}\s*=\s*'expired'/);
  });

  it("conversion lag uses convertedAt - createdAt and falls back to hasData=false", () => {
    const block = commonSrc.match(
      /export async function getConversionLagShared[\s\S]+?\n\}/,
    );
    expect(block, "getConversionLagShared must exist").not.toBeNull();
    const body = block![0];
    // Lead lag: leads.convertedAt - leads.createdAt
    expect(body).toMatch(
      /AVG\(EXTRACT\(EPOCH FROM \(\$\{leads\.convertedAt\} - \$\{leads\.createdAt\}\)\)/,
    );
    // Quote lag: quotes.convertedAt - quotes.createdAt
    expect(body).toMatch(
      /AVG\(EXTRACT\(EPOCH FROM \(\$\{quotes\.convertedAt\} - \$\{quotes\.createdAt\}\)\)/,
    );
    // Both filter by `convertedAt IS NOT NULL` so null timestamps drop
    // out — the section's `hasData` rule then reflects the absence.
    // 2026-05-03 audit fix: the null-timestamp exclusion moved from a
    // top-level WHERE clause into the `FILTER (WHERE ...)` predicate
    // alongside the new `coveragePercent` denominator, but the rule
    // itself is unchanged: lag avg only includes rows with a real
    // `convertedAt` in window.
    expect(body).toMatch(/\$\{leads\.convertedAt\} IS NOT NULL/);
    expect(body).toMatch(/\$\{quotes\.convertedAt\} IS NOT NULL/);
    // 2026-05-03 audit fix: coveragePercent surfaces as a contract
    // field — locked here so future helpers can't quietly drop it.
    expect(body).toMatch(/coveragePercent/);
    expect(body).toMatch(/totalConvertedCount/);
    expect(body).toMatch(/timestampedCount/);
    // The non-timestamped denominator predicate cites the canonical
    // conversion signals (lead: status='won'; quote: 'converted' or
    // 'approved') and uses `updatedAt` as the window-attribution date
    // for status-only conversions.
    expect(body).toMatch(/\$\{leads\.status\} = 'won'/);
    expect(body).toMatch(/\$\{quotes\.status\} IN \('converted', 'approved'\)/);
    expect(body).toMatch(/\$\{leads\.updatedAt\}/);
    expect(body).toMatch(/\$\{quotes\.updatedAt\}/);
    // Aggregator wires the section's hasData to count > 0 in either
    // bucket. Spec: "If timestamps missing: hasData=false."
    expect(aggSrc).toMatch(
      /hasData:\s*lag\.leads\.count\s*>\s*0\s*\|\|\s*lag\.quotes\.count\s*>\s*0/,
    );
  });

  it("status breakdowns are emitted with canonical enum keys only", () => {
    // Lead status: new / contacted / quoted / won / lost.
    for (const k of ["new", "contacted", "quoted", "won", "lost"]) {
      expect(commonSrc).toMatch(new RegExp(`${k}:\\s*\\d+`));
    }
    // Quote status: draft / sent / approved / declined / expired / converted.
    for (const k of [
      "draft",
      "sent",
      "approved",
      "declined",
      "expired",
      "converted",
    ]) {
      expect(commonSrc).toMatch(new RegExp(`${k}:\\s*\\d+`));
    }
    // Anti-regression: no fabricated statuses.
    expect(commonSrc).not.toMatch(/key:\s*"hot"/);
    expect(commonSrc).not.toMatch(/key:\s*"cold"/);
    expect(commonSrc).not.toMatch(/key:\s*"unknown"/);
  });

  it("does NOT reintroduce the failing GROUP BY alias bug", () => {
    expect(aggSrc).not.toMatch(/\.groupBy\(\s*sql`\s*[a-z_][a-z0-9_]*\s*`\s*\)/);
    expect(commonSrc).not.toMatch(
      /\.groupBy\(\s*sql`\s*[a-z_][a-z0-9_]*\s*`\s*\)/,
    );
  });
});

// ---------------------------------------------------------------------------
// Layer 4 — reuse canonicality
// ---------------------------------------------------------------------------

describe("Sales Funnel / Sales — section helpers + lag are shared", () => {
  const commonSrc = fs.readFileSync(commonPath, "utf-8");
  const aggSrc = fs.readFileSync(aggregatorPath, "utf-8");
  const salesSrc = fs.readFileSync(salesAggregatorPath, "utf-8");

  it("reportsCommon owns the canonical Sales section helpers + lag helper", () => {
    for (const sym of [
      "getLeadCreationTrendShared",
      "getLeadConversionTrendShared",
      "getQuoteCreationTrendShared",
      "getQuoteConversionTrendShared",
      "getLeadStatusBreakdownShared",
      "getQuoteStatusBreakdownShared",
      "getConversionLagShared",
    ]) {
      expect(commonSrc).toMatch(
        new RegExp(`export async function ${sym}\\(`),
      );
    }
  });

  it("Sales tab aggregator imports the shared helpers — no local copies remain", () => {
    expect(salesSrc).toMatch(/getLeadCreationTrendShared/);
    expect(salesSrc).toMatch(/getLeadConversionTrendShared/);
    expect(salesSrc).toMatch(/getQuoteCreationTrendShared/);
    expect(salesSrc).toMatch(/getQuoteConversionTrendShared/);
    expect(salesSrc).toMatch(/getLeadStatusBreakdownShared/);
    expect(salesSrc).toMatch(/getQuoteStatusBreakdownShared/);
    // Local async helpers must be gone.
    expect(salesSrc).not.toMatch(/^async function getLeadCreationTrend\(/m);
    expect(salesSrc).not.toMatch(/^async function getLeadConversionTrend\(/m);
    expect(salesSrc).not.toMatch(/^async function getQuoteCreationTrend\(/m);
    expect(salesSrc).not.toMatch(/^async function getQuoteConversionTrend\(/m);
    expect(salesSrc).not.toMatch(/^async function getLeadStatusBreakdown\(/m);
    expect(salesSrc).not.toMatch(/^async function getQuoteStatusBreakdown\(/m);
    expect(salesSrc).not.toMatch(/^const LEAD_STATUS_LABELS\b/m);
    expect(salesSrc).not.toMatch(/^const QUOTE_STATUS_LABELS\b/m);
  });

  it("Funnel aggregator imports the same helpers", () => {
    expect(aggSrc).toMatch(/from "\.\/reportsCommon"/);
    expect(aggSrc).toMatch(/getLeadCreationTrendShared/);
    expect(aggSrc).toMatch(/getLeadConversionTrendShared/);
    expect(aggSrc).toMatch(/getQuoteCreationTrendShared/);
    expect(aggSrc).toMatch(/getQuoteConversionTrendShared/);
    expect(aggSrc).toMatch(/getLeadStatusBreakdownShared/);
    expect(aggSrc).toMatch(/getQuoteStatusBreakdownShared/);
    expect(aggSrc).toMatch(/getConversionLagShared/);
  });
});

// ---------------------------------------------------------------------------
// Layer 5 — App + library wiring
// ---------------------------------------------------------------------------

describe("Sales Funnel — app route + library catalog wiring", () => {
  const appSrc = fs.readFileSync(appPath, "utf-8");

  it("imports ReportsSalesFunnel and mounts /reports/sales-funnel under requireManager", () => {
    expect(appSrc).toMatch(
      /import ReportsSalesFunnel from "@\/pages\/ReportsSalesFunnel";/,
    );
    const block = appSrc.match(
      /<Route path="\/reports\/sales-funnel">[\s\S]+?<\/Route>/,
    );
    expect(block, "/reports/sales-funnel route must exist").not.toBeNull();
    expect(block![0]).toMatch(/<ProtectedRoute requireManager>/);
    expect(block![0]).toMatch(/<ReportsSalesFunnel \/>/);
  });

  it("the library catalog includes an active Sales Funnel entry under Sales", () => {
    const sales = REPORTS_LIBRARY.find((c) => c.id === "sales");
    expect(sales, "Sales category must exist").toBeDefined();
    const funnel = sales!.reports.find((r) => r.id === "sales-funnel");
    expect(funnel, "Sales Funnel entry must exist").toBeDefined();
    expect(funnel!.status).toBe("active");
    expect(funnel!.href).toBe("/reports/sales-funnel");
    expect(funnel!.title.toLowerCase()).toContain("sales funnel");
    expect(funnel!.description.length).toBeGreaterThan(0);
  });
});
