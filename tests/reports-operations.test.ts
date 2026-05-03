/**
 * Tests for the Reports → Operations tab (2026-05-02).
 *
 * Mirrors the Snapshot / Financial test pattern:
 *   1. Source-grep guards on `Reports.tsx` for the new Operations
 *      tab UI (sections, query key, empty states).
 *   2. No-fake-data guards: forbidden phrases + no hardcoded
 *      numeric literals in any Operations-related file.
 *   3. Server route + storage source guards: route under
 *      `requireRole(MANAGER_ROLES)`, aggregator uses canonical real
 *      tables only, every section emits `hasData`, completion trend
 *      reads `job_status_events` (NOT `jobs.actualEnd` / etc.),
 *      avg-job-value uses `invoices.total` (NOT payments), unbillable
 *      excludes rows without `costRateSnapshot`.
 *   4. Shared-helpers guard: KPI strip queries route through
 *      `sharedQueries` in `reportsCommon.ts` so the Snapshot and
 *      Operations tabs cannot disagree.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = path.resolve(__dirname, "..");
const pagePath = path.join(repoRoot, "client", "src", "pages", "Reports.tsx");
const routePath = path.join(repoRoot, "server", "routes", "reports.ts");
const aggregatorPath = path.join(repoRoot, "server", "storage", "reportsOperations.ts");
const sharedPath = path.join(repoRoot, "shared", "reports", "operations.ts");
const commonPath = path.join(repoRoot, "server", "storage", "reportsCommon.ts");
const snapshotPath = path.join(repoRoot, "server", "storage", "reportsSnapshot.ts");

// ---------------------------------------------------------------------------
// Layer 1 — Reports.tsx Operations tab source guards
// ---------------------------------------------------------------------------

describe("Reports page (Operations tab — source guard)", () => {
  const source = fs.readFileSync(pagePath, "utf-8");

  it("renders the Operations tab content via OperationsBody (not the Coming-soon placeholder)", () => {
    expect(source).toMatch(/<TabsContent value="operations">\s*<OperationsBody/);
    // Tabs that still ship as Coming Soon must NOT mount OperationsBody.
    // 2026-05-02 phase 4 update: Sales now mounts SalesBody. Pick a
    // tab that's still in Coming-Soon state for the negative assertion.
    const teamBlock = source.match(/<TabsContent value="team">[\s\S]+?<\/TabsContent>/);
    expect(teamBlock?.[0] ?? "").toContain("ComingSoonTab");
    expect(teamBlock?.[0] ?? "").not.toContain("OperationsBody");
  });

  it("threads the canonical /api/reports/operations endpoint into TanStack Query", () => {
    expect(source).toMatch(/\["\/api\/reports\/operations",\s*range\]/);
    expect(source).toMatch(/`\/api\/reports\/operations\?range=\$\{range\}`/);
  });

  it("renders all five Operations sections with canonical test ids", () => {
    for (const id of [
      "operations-section-kpis",
      "operations-section-completion-trend",
      "operations-section-job-status",
      "operations-section-avg-value-trend",
      "operations-section-unbillable-breakdown",
    ]) {
      const propMatch = new RegExp(`testId="${id}"`).test(source);
      const attrMatch = new RegExp(`data-testid="${id}"`).test(source);
      expect(propMatch || attrMatch, `expected ${id} in source`).toBe(true);
    }
  });

  it("each section card short-circuits to SectionEmpty when hasData is false", () => {
    // Brace-matched bodies are awkward to extract via regex; split on
    // `function ` and inspect the chunk for each card.
    const chunks = source.split(/\nfunction /);
    const cards = [
      "JobCompletionTrendCard",
      "JobStatusBreakdownCard",
      "AvgJobValueTrendCard",
      "UnbillableBreakdownCard",
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

  it("OperationsBody full-page error path triggers ONLY on (isError || !data)", () => {
    // CRLF-tolerant: split on `function ` instead of using a brittle
    // `\n\}\n` regex that fails on CRLF source files.
    const chunks = source.split(/\nfunction /);
    const body = chunks.find(
      (c) => c.startsWith("OperationsBody(") || c.startsWith("OperationsBody "),
    );
    expect(body, "OperationsBody must exist").toBeDefined();
    expect(body!).toMatch(/if\s*\(isError\s*\|\|\s*!data\)/);
    const errorMatch = body!.match(
      /if\s*\(isError\s*\|\|\s*!data\)\s*\{[\s\S]+?return[\s\S]+?\}/,
    );
    expect(errorMatch).not.toBeNull();
    // The error branch must not gate on per-section content — that
    // would re-introduce the "blank page on partial data" regression.
    expect(errorMatch![0]).not.toMatch(/metrics\.length|hasData/);
    expect(body!).toContain('data-testid="operations-error"');
  });

  it("Operations sections render in the spec order (KPI → completion → status → avg → unbillable)", () => {
    const order = [
      'testId="operations-section-kpis"',
      "<JobCompletionTrendCard ",
      "<JobStatusBreakdownCard ",
      "<AvgJobValueTrendCard ",
      "<UnbillableBreakdownCard ",
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
    const trendCards = ["JobCompletionTrendCard", "AvgJobValueTrendCard"];
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
      const reduces = chunk!.match(/\.reduce\(/g) ?? [];
      expect(reduces.length).toBeLessThanOrEqual(1);
      if (reduces.length === 1) {
        const reduceIdx = chunk!.indexOf(".reduce(");
        const tail = chunk!.slice(reduceIdx, reduceIdx + 200);
        expect(tail).toContain("Math.max");
      }
    }
  });

  it("breakdown cards iterate backend items directly — no front-end re-sort", () => {
    const chunks = source.split(/\nfunction /);
    const breakdownCards = ["JobStatusBreakdownCard", "UnbillableBreakdownCard"];
    for (const fn of breakdownCards) {
      const chunk = chunks.find(
        (c) => c.startsWith(`${fn}(`) || c.startsWith(`${fn} `),
      );
      expect(chunk, `${fn} must exist`).toBeDefined();
      expect(chunk!).toMatch(/section\.items\.map\(/);
      expect(chunk!).not.toMatch(/section\.items\.sort\(/);
      expect(chunk!).not.toMatch(/section\.items\.filter\(/);
      expect(chunk!).not.toMatch(/section\.items\.reduce\(/);
    }
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — no-fake-data guards
// ---------------------------------------------------------------------------

describe("Operations tab — no fabricated metric values", () => {
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
      "fakeJobs",
    ];
    for (const src of sources) {
      for (const phrase of forbidden) {
        expect(src.toLowerCase()).not.toContain(phrase.toLowerCase());
      }
    }
  });

  it("does not declare hardcoded metric output literals in sources", () => {
    // Targets MetricCard / output-shape fields specifically. Accumulator
    // initializers (`{ cost: 0, count: 0 }`) are NOT fake data — those
    // are zero-state aggregators that get overwritten with real DB
    // values. The forbidden form is a metric output with a non-zero
    // hardcoded number, e.g. `currentValue: 41` or `avgValue: 1234`.
    const forbidden = /\b(currentValue|previousMonthValue|previousQuarterValue|previousYearValue|avgValue|totalCost|totalAmount|percentOfTotal):\s*[1-9]\d*(?:\.\d+)?/g;
    for (const src of sources) {
      expect(src.match(forbidden) ?? []).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Layer 3 — server route + aggregator wiring guards
// ---------------------------------------------------------------------------

describe("Operations — server route + aggregator wiring", () => {
  const routeSrc = fs.readFileSync(routePath, "utf-8");
  const aggSrc = fs.readFileSync(aggregatorPath, "utf-8");

  it("registers GET /operations under requireRole(MANAGER_ROLES)", () => {
    expect(routeSrc).toMatch(/router\.get\(\s*"\/operations",\s*requireRole\(MANAGER_ROLES\)/);
    expect(routeSrc).toMatch(/getCompanyOperations/);
    expect(routeSrc).toMatch(/operationsQuerySchema/);
  });

  it("aggregator reads canonical real-data tables only — no mocks", () => {
    // 2026-05-03: Operations section helpers were lifted into
    // `reportsCommon` so the Job Performance deep-report can reuse
    // them. The Operations aggregator is now a thin orchestrator;
    // table imports live in reportsCommon. Check the union.
    const commonSrc = fs.readFileSync(
      path.resolve(__dirname, "..", "server", "storage", "reportsCommon.ts"),
      "utf-8",
    );
    const union = aggSrc + "\n" + commonSrc;
    for (const table of [
      "invoices",
      "jobs",
      "jobStatusEvents",
      "timeEntries",
      "timeEntryTypeEnum",
    ]) {
      expect(union).toContain(table);
    }
    expect(aggSrc).not.toMatch(/mockMetrics|fakeData|HARDCODED_/i);
    expect(commonSrc).not.toMatch(/mockMetrics|fakeData|HARDCODED_/i);
  });

  it("every section emits hasData and the KPI strip uses sharedQueries", () => {
    // 3 buildMetric calls in the KPI strip. Section `hasData` flags
    // live in the shared helpers (reportsCommon), not in the
    // Operations orchestrator.
    const buildMetric = (aggSrc.match(/buildMetric\(\{/g) ?? []).length;
    const polarity = (aggSrc.match(/polarity:\s*"(higher|lower)_is_better"/g) ?? []).length;
    expect(buildMetric).toBe(3);
    expect(polarity).toBe(buildMetric);
    // KPIs reuse the canonical sharedQueries — no local re-implementation.
    expect(aggSrc).toMatch(/sharedQueries\.jobsCompleted\(/);
    expect(aggSrc).toMatch(/sharedQueries\.avgJobInvoiceValue\(/);
    expect(aggSrc).toMatch(/sharedQueries\.unbillableCost\(/);
    expect(aggSrc).toMatch(/sharedQueries\.unbillableEntriesWithCostRate\(/);
  });

  it("completion trend reads job_status_events with toStatus='completed' (NOT jobs.actualEnd)", () => {
    // 2026-05-03: lifted into reportsCommon.getCompletionTrendShared.
    const commonSrc = fs.readFileSync(
      path.resolve(__dirname, "..", "server", "storage", "reportsCommon.ts"),
      "utf-8",
    );
    const block = commonSrc.match(
      /export async function getCompletionTrendShared[\s\S]+?\n\}/,
    );
    expect(block, "getCompletionTrendShared must exist").not.toBeNull();
    const body = block![0];
    expect(body).toMatch(/\.from\(jobStatusEvents\)/);
    expect(body).toMatch(/eq\(jobStatusEvents\.toStatus,\s*"completed"\)/);
    expect(body).toMatch(/jobStatusEvents\.changedAt/);
    expect(body).not.toMatch(/jobs\.actualEnd/);
    expect(body).not.toMatch(/jobs\.completedAt/);
    expect(body).not.toMatch(/eq\(jobs\.status/);
  });

  it("avg job value trend uses invoices.total + invoices.issueDate, NOT payments", () => {
    const commonSrc = fs.readFileSync(
      path.resolve(__dirname, "..", "server", "storage", "reportsCommon.ts"),
      "utf-8",
    );
    const block = commonSrc.match(
      /export async function getAvgJobValueTrendShared[\s\S]+?\n\}/,
    );
    expect(block, "getAvgJobValueTrendShared must exist").not.toBeNull();
    const body = block![0];
    expect(body).toMatch(/\.from\(invoices\)/);
    expect(body).toMatch(/CAST\(\$\{invoices\.total\}/);
    expect(body).toMatch(/invoices\.issueDate/);
    expect(body).toMatch(/isNotNull\(invoices\.jobId\)/);
    expect(body).not.toMatch(/\bpayments\b/);
  });

  it("unbillable breakdown excludes entries with NULL costRateSnapshot + non-billable only", () => {
    const commonSrc = fs.readFileSync(
      path.resolve(__dirname, "..", "server", "storage", "reportsCommon.ts"),
      "utf-8",
    );
    const block = commonSrc.match(
      /export async function getUnbillableBreakdownShared[\s\S]+?\n\}/,
    );
    expect(block, "getUnbillableBreakdownShared must exist").not.toBeNull();
    const body = block![0];
    expect(body).toMatch(/eq\(timeEntries\.billable,\s*false\)/);
    expect(body).toMatch(/isNotNull\(timeEntries\.costRateSnapshot\)/);
    expect(body).toMatch(/isNotNull\(timeEntries\.durationMinutes\)/);
    expect(body).toMatch(/durationMinutes\}::numeric \/ 60\.0/);
    expect(body).toMatch(/CAST\(\$\{timeEntries\.costRateSnapshot\}/);
  });

  it("job status breakdown reads jobs.status with isNull(deletedAt) — does not infer scheduled/cancelled", () => {
    const commonSrc = fs.readFileSync(
      path.resolve(__dirname, "..", "server", "storage", "reportsCommon.ts"),
      "utf-8",
    );
    const block = commonSrc.match(
      /export async function getJobStatusBreakdownShared[\s\S]+?\n\}/,
    );
    expect(block, "getJobStatusBreakdownShared must exist").not.toBeNull();
    const body = block![0];
    expect(body).toMatch(/\.from\(jobs\)/);
    expect(body).toMatch(/groupBy\(jobs\.status\)/);
    expect(body).toMatch(/isNull\(jobs\.deletedAt\)/);
    expect(commonSrc).toMatch(/JOB_STATUS_LABELS:\s*Record<JobStatusKey,\s*string>/);
    // "scheduled" / "cancelled" must NOT appear as fabricated buckets.
    expect(commonSrc).not.toMatch(/key:\s*"scheduled"/);
    expect(commonSrc).not.toMatch(/key:\s*"cancelled"/);
  });

  it("job status breakdown does not use the failing `groupBy(sql\\`bucket\\`)` pattern", () => {
    // 2026-05-02 regression: the AR-aging GROUP BY alias bug took
    // down both endpoints. Any future Operations grouping must NOT
    // resurrect that pattern.
    expect(aggSrc).not.toMatch(/\.groupBy\(\s*sql`\s*[a-z_][a-z0-9_]*\s*`\s*\)/);
  });
});

// ---------------------------------------------------------------------------
// Layer 4 — shared-helper canonicality
// ---------------------------------------------------------------------------

describe("Operations / Snapshot — KPI strip math is shared", () => {
  const commonSrc = fs.readFileSync(commonPath, "utf-8");
  const snapshotSrc = fs.readFileSync(snapshotPath, "utf-8");
  const aggSrc = fs.readFileSync(aggregatorPath, "utf-8");

  it("reportsCommon owns the canonical Jobs/Avg/Unbillable lambdas", () => {
    expect(commonSrc).toMatch(/jobsCompleted:\s*\(companyId/);
    expect(commonSrc).toMatch(/avgJobInvoiceValue:\s*\(companyId/);
    expect(commonSrc).toMatch(/unbillableCost:\s*\(companyId/);
    expect(commonSrc).toMatch(/unbillableEntriesWithCostRate:\s*\(companyId/);
  });

  it("Snapshot aggregator imports the same lambdas from sharedQueries", () => {
    expect(snapshotSrc).toMatch(/sharedQueries\.jobsCompleted\(/);
    expect(snapshotSrc).toMatch(/sharedQueries\.avgJobInvoiceValue\(/);
    expect(snapshotSrc).toMatch(/sharedQueries\.unbillableCost\(/);
    expect(snapshotSrc).toMatch(/sharedQueries\.unbillableEntriesWithCostRate\(/);
    // Snapshot must NOT keep a local copy of these lambdas anymore —
    // a re-introduced local copy would let the two tabs drift.
    expect(snapshotSrc).not.toMatch(/^\s*jobsCompleted:\s*\(companyId/m);
    expect(snapshotSrc).not.toMatch(/^\s*avgJobInvoiceValue:\s*\(companyId/m);
    expect(snapshotSrc).not.toMatch(/^\s*unbillableCost:\s*\(companyId/m);
  });

  it("Operations aggregator also routes through sharedQueries", () => {
    expect(aggSrc).toMatch(/from "\.\/reportsCommon"/);
    expect(aggSrc).toMatch(/sharedQueries\.jobsCompleted\(/);
    expect(aggSrc).toMatch(/sharedQueries\.avgJobInvoiceValue\(/);
    expect(aggSrc).toMatch(/sharedQueries\.unbillableCost\(/);
  });
});
