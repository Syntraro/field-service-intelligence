/**
 * Tests for the Job Performance deep-report page (`/reports/jobs`)
 * and its backing aggregator (`/api/reports/jobs`).
 *
 * Layers:
 *   1. Page source guards — sections, query key, empty states, no
 *      front-end aggregation in the trend / status / avg-value /
 *      unbillable / completed-jobs cards.
 *   2. No-fake-data guards.
 *   3. Server route + storage source guards — role gating, real-data
 *      tables only, KPIs route through `sharedQueries`, completion
 *      uses `job_status_events.toStatus='completed'`, avg job value
 *      uses `invoices.total` (NOT payments), unbillable excludes
 *      rows with NULL `costRateSnapshot`, completed jobs are
 *      DESC-sorted by `changedAt`, soft-deleted jobs are excluded.
 *   4. Reuse canonicality — `getCompletionTrendShared` /
 *      `getJobStatusBreakdownShared` / `getAvgJobValueTrendShared` /
 *      `getUnbillableBreakdownShared` live in reportsCommon; both
 *      Operations AND Jobs aggregators import them; Operations has
 *      no in-file copy. New `getCompletedJobsListShared` lives in
 *      reportsCommon too.
 *   5. App + library wiring — route mounted, library entry references
 *      `/reports/jobs` via `href` under Operations.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { REPORTS_LIBRARY } from "../client/src/lib/reportsLibrary";

const repoRoot = path.resolve(__dirname, "..");
const pagePath = path.join(repoRoot, "client", "src", "pages", "ReportsJobs.tsx");
const aggregatorPath = path.join(
  repoRoot,
  "server",
  "storage",
  "reportsJobs.ts",
);
const sharedPath = path.join(repoRoot, "shared", "reports", "jobs.ts");
const routePath = path.join(repoRoot, "server", "routes", "reports.ts");
const commonPath = path.join(repoRoot, "server", "storage", "reportsCommon.ts");
const operationsAggregatorPath = path.join(
  repoRoot,
  "server",
  "storage",
  "reportsOperations.ts",
);
const appPath = path.join(repoRoot, "client", "src", "App.tsx");

// ---------------------------------------------------------------------------
// Layer 1 — Jobs page source guards
// ---------------------------------------------------------------------------

describe("Reports Jobs page (/reports/jobs) — source guard", () => {
  const source = fs.readFileSync(pagePath, "utf-8");

  it("exports ReportsJobs with title + range selector + back button", () => {
    expect(source).toMatch(/export default function ReportsJobs\b/);
    expect(source).toMatch(/data-testid="reports-jobs-page"/);
    expect(source).toMatch(/data-testid="reports-jobs-title"/);
    expect(source).toMatch(/data-testid="select-jobs-range"/);
    expect(source).toMatch(/data-testid="jobs-back-to-reports"/);
    expect(source).toMatch(/setLocation\("\/reports"\)/);
  });

  it("threads the canonical /api/reports/jobs endpoint into TanStack Query", () => {
    expect(source).toMatch(/\["\/api\/reports\/jobs",\s*range\]/);
    expect(source).toMatch(/`\/api\/reports\/jobs\?range=\$\{range\}`/);
  });

  it("renders all six Jobs sections with canonical test ids", () => {
    for (const id of [
      "jobs-section-kpis",
      "jobs-section-completion-trend",
      "jobs-section-job-status",
      "jobs-section-avg-value-trend",
      "jobs-section-unbillable-breakdown",
      "jobs-section-completed",
    ]) {
      const propMatch = new RegExp(`testId="${id}"`).test(source);
      const attrMatch = new RegExp(`data-testid="${id}"`).test(source);
      expect(propMatch || attrMatch, `expected ${id} in source`).toBe(true);
    }
  });

  it("each section card short-circuits to SectionEmpty when hasData is false", () => {
    const chunks = source.split(/\nfunction /);
    const cards = [
      "CompletionTrendCard",
      "JobStatusBreakdownCard",
      "AvgJobValueTrendCard",
      "UnbillableBreakdownCard",
      "CompletedJobsCard",
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
    expect(source).toContain('data-testid="jobs-error"');
  });

  it("trend cards iterate backend points directly — no front-end aggregation", () => {
    const chunks = source.split(/\nfunction /);
    const trends = ["CompletionTrendCard", "AvgJobValueTrendCard"];
    for (const fn of trends) {
      const card = chunks.find(
        (c) => c.startsWith(`${fn}(`) || c.startsWith(`${fn} `),
      );
      expect(card, `${fn} must exist`).toBeDefined();
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
    }
  });

  it("breakdown + completed cards iterate backend items directly — no client sort", () => {
    const chunks = source.split(/\nfunction /);
    const cards = [
      "JobStatusBreakdownCard",
      "UnbillableBreakdownCard",
      "CompletedJobsCard",
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

describe("Jobs deep-report — no fabricated metric values", () => {
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
      "fakeJobs",
      "lorem ipsum",
    ];
    for (const src of sources) {
      for (const phrase of forbidden) {
        expect(src.toLowerCase()).not.toContain(phrase.toLowerCase());
      }
    }
  });

  it("contains no MetricCard / output-shape numeric literals", () => {
    const forbidden = /\b(currentValue|previousMonthValue|previousQuarterValue|previousYearValue|invoiceTotal|avgValue|cost|count|percentOfTotal):\s*[1-9]\d*(?:\.\d+)?/g;
    for (const src of sources) {
      expect(src.match(forbidden) ?? []).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Layer 3 — server route + aggregator wiring guards
// ---------------------------------------------------------------------------

describe("Jobs — server route + aggregator wiring", () => {
  const routeSrc = fs.readFileSync(routePath, "utf-8");
  const aggSrc = fs.readFileSync(aggregatorPath, "utf-8");
  const commonSrc = fs.readFileSync(commonPath, "utf-8");

  it("registers GET /jobs under requireRole(MANAGER_ROLES)", () => {
    expect(routeSrc).toMatch(/router\.get\(\s*"\/jobs",\s*requireRole\(MANAGER_ROLES\)/);
    expect(routeSrc).toMatch(/getCompanyJobs/);
    expect(routeSrc).toMatch(/jobsQuerySchema/);
  });

  it("aggregator does NOT directly hit DB tables — every section routes through reportsCommon", () => {
    // The Jobs aggregator is a thin orchestrator. It should NEVER
    // import `db` or schema tables directly — all SQL lives in
    // reportsCommon. This locks the "no duplicated Operations
    // logic" rule structurally.
    expect(aggSrc).not.toMatch(/from "@shared\/schema"/);
    expect(aggSrc).not.toMatch(/from "\.\.\/db"/);
    expect(aggSrc).not.toMatch(/mockMetrics|fakeData|HARDCODED_/i);
  });

  it("KPIs route through sharedQueries — including the new activeJobsAtPoint", () => {
    expect(aggSrc).toMatch(/sharedQueries\.jobsCompleted\(/);
    expect(aggSrc).toMatch(/sharedQueries\.avgJobInvoiceValue\(/);
    expect(aggSrc).toMatch(/sharedQueries\.unbillableCost\(/);
    expect(aggSrc).toMatch(/sharedQueries\.unbillableEntriesWithCostRate\(/);
    expect(aggSrc).toMatch(/sharedQueries\.activeJobsAtPoint\(/);
    // 4 KPI cards via buildMetric.
    const buildMetric = (aggSrc.match(/buildMetric\(\{/g) ?? []).length;
    expect(buildMetric).toBe(4);
    const polarity = (aggSrc.match(/polarity:\s*"(higher|lower)_is_better"/g) ?? []).length;
    expect(polarity).toBe(buildMetric);
  });

  it("activeJobsAtPoint uses status='open' + isNull(deletedAt) + createdAt <= w.to", () => {
    const block = commonSrc.match(
      /activeJobsAtPoint:[\s\S]+?return Number[\s\S]+?\}\s*,/,
    );
    expect(block, "activeJobsAtPoint must exist").not.toBeNull();
    const body = block![0];
    expect(body).toMatch(/eq\(jobs\.status,\s*"open"\)/);
    expect(body).toMatch(/isNull\(jobs\.deletedAt\)/);
    expect(body).toMatch(/\$\{jobs\.createdAt\}\s*<=\s*\$\{w\.to\}/);
  });

  it("completion trend uses job_status_events.toStatus='completed' (NOT jobs.actualEnd)", () => {
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
  });

  it("avg job value trend uses invoices.total + invoices.issueDate, NOT payments", () => {
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

  it("completed jobs list is server-sorted DESC by changedAt and excludes soft-deleted jobs", () => {
    const block = commonSrc.match(
      /export async function getCompletedJobsListShared[\s\S]+?\n\}/,
    );
    expect(block, "getCompletedJobsListShared must exist").not.toBeNull();
    const body = block![0];
    expect(body).toMatch(/orderBy\(desc\(jobStatusEvents\.changedAt\)\)/);
    expect(body).toMatch(/\.limit\(limit\)/);
    expect(body).toMatch(/eq\(jobStatusEvents\.toStatus,\s*"completed"\)/);
    expect(body).toMatch(/isNull\(jobs\.deletedAt\)/);
    // Anti-regression: must NOT switch to ASC ordering.
    expect(body).not.toMatch(/orderBy\(jobStatusEvents\.changedAt\)/);
    // Anti-regression: tech assignment must NOT be inferred via job_visits
    // (multi-row, ambiguous). Per spec: "Do not infer tech/client if
    // relationship is unclear."
    expect(body).not.toMatch(/jobVisits/);
    expect(body).not.toMatch(/assignedTechnicianIds/);
  });

  it("does NOT reintroduce the failing GROUP BY alias bug", () => {
    expect(aggSrc).not.toMatch(/\.groupBy\(\s*sql`\s*[a-z_][a-z0-9_]*\s*`\s*\)/);
    expect(commonSrc).not.toMatch(/\.groupBy\(\s*sql`\s*[a-z_][a-z0-9_]*\s*`\s*\)/);
  });
});

// ---------------------------------------------------------------------------
// Layer 4 — reuse canonicality
// ---------------------------------------------------------------------------

describe("Jobs / Operations — section helpers are shared", () => {
  const commonSrc = fs.readFileSync(commonPath, "utf-8");
  const aggSrc = fs.readFileSync(aggregatorPath, "utf-8");
  const opsSrc = fs.readFileSync(operationsAggregatorPath, "utf-8");

  it("reportsCommon owns the canonical Operations + completed-jobs helpers", () => {
    for (const sym of [
      "getCompletionTrendShared",
      "getJobStatusBreakdownShared",
      "getAvgJobValueTrendShared",
      "getUnbillableBreakdownShared",
      "getCompletedJobsListShared",
    ]) {
      expect(commonSrc).toMatch(
        new RegExp(`export async function ${sym}\\(`),
      );
    }
  });

  it("Operations aggregator imports the shared helpers — no local copies remain", () => {
    expect(opsSrc).toMatch(/getCompletionTrendShared/);
    expect(opsSrc).toMatch(/getJobStatusBreakdownShared/);
    expect(opsSrc).toMatch(/getAvgJobValueTrendShared/);
    expect(opsSrc).toMatch(/getUnbillableBreakdownShared/);
    // Anti-regression: the local async helpers must be gone.
    expect(opsSrc).not.toMatch(/^async function getCompletionTrend\(/m);
    expect(opsSrc).not.toMatch(/^async function getJobStatusBreakdown\(/m);
    expect(opsSrc).not.toMatch(/^async function getAvgJobValueTrend\(/m);
    expect(opsSrc).not.toMatch(/^async function getUnbillableBreakdown\(/m);
    expect(opsSrc).not.toMatch(/^const JOB_STATUS_LABELS\b/m);
    expect(opsSrc).not.toMatch(/^const UNBILLABLE_TYPE_LABELS\b/m);
  });

  it("Jobs aggregator imports the same helpers", () => {
    expect(aggSrc).toMatch(/from "\.\/reportsCommon"/);
    expect(aggSrc).toMatch(/getCompletionTrendShared/);
    expect(aggSrc).toMatch(/getJobStatusBreakdownShared/);
    expect(aggSrc).toMatch(/getAvgJobValueTrendShared/);
    expect(aggSrc).toMatch(/getUnbillableBreakdownShared/);
    expect(aggSrc).toMatch(/getCompletedJobsListShared/);
  });
});

// ---------------------------------------------------------------------------
// Layer 5 — App + library wiring
// ---------------------------------------------------------------------------

describe("Jobs — app route + library catalog wiring", () => {
  const appSrc = fs.readFileSync(appPath, "utf-8");

  it("imports ReportsJobs and mounts /reports/jobs under requireManager", () => {
    expect(appSrc).toMatch(/import ReportsJobs from "@\/pages\/ReportsJobs";/);
    const block = appSrc.match(/<Route path="\/reports\/jobs">[\s\S]+?<\/Route>/);
    expect(block, "/reports/jobs route must exist").not.toBeNull();
    expect(block![0]).toMatch(/<ProtectedRoute requireManager>/);
    expect(block![0]).toMatch(/<ReportsJobs \/>/);
  });

  it("the library catalog includes an active Job Performance entry under Operations", () => {
    const operations = REPORTS_LIBRARY.find((c) => c.id === "operations");
    expect(operations, "Operations category must exist").toBeDefined();
    const jobs = operations!.reports.find((r) => r.id === "jobs");
    expect(jobs, "Job Performance entry must exist").toBeDefined();
    expect(jobs!.status).toBe("active");
    expect(jobs!.href).toBe("/reports/jobs");
    expect(jobs!.title.toLowerCase()).toContain("job");
    expect(jobs!.description.length).toBeGreaterThan(0);
  });
});
