/**
 * Tests for the Team Performance deep-report page (`/reports/team`)
 * and its backing aggregator (`/api/reports/team`).
 *
 * Layers:
 *   1. Page source guards.
 *   2. No-fake-data guards.
 *   3. Server route + storage source guards — role gating, the
 *      aggregator is a pure orchestrator (no direct DB / schema
 *      imports), KPIs route through `sharedQueries` (including the
 *      new `totalHoursWorked` / `totalBillableHours` /
 *      `totalUnbillableHours`), unbillable excludes null
 *      `costRateSnapshot`, hours/unbillable per-user attribution
 *      keys on the FK-clean `time_entries.technicianId`, jobs-by-
 *      user attribution keys on `job_status_events.changedBy` (NOT
 *      multi-tech `job_visits.assignedTechnicianIds`), excludes
 *      `null` `changedBy` rows, no GROUP BY alias regression.
 *   4. Reuse canonicality — the three new shared helpers + three
 *      new shared scalar lambdas live in reportsCommon; the team
 *      aggregator imports them.
 *   5. App + library wiring — route mounted, library entry replaces
 *      the previous Coming-soon row with an active link to
 *      `/reports/team`.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { REPORTS_LIBRARY } from "../client/src/lib/reportsLibrary";

const repoRoot = path.resolve(__dirname, "..");
const pagePath = path.join(repoRoot, "client", "src", "pages", "ReportsTeam.tsx");
const aggregatorPath = path.join(
  repoRoot,
  "server",
  "storage",
  "reportsTeam.ts",
);
const sharedPath = path.join(repoRoot, "shared", "reports", "team.ts");
const routePath = path.join(repoRoot, "server", "routes", "reports.ts");
const commonPath = path.join(repoRoot, "server", "storage", "reportsCommon.ts");
const appPath = path.join(repoRoot, "client", "src", "App.tsx");

// ---------------------------------------------------------------------------
// Layer 1 — page source guards
// ---------------------------------------------------------------------------

describe("Reports Team page (/reports/team) — source guard", () => {
  const source = fs.readFileSync(pagePath, "utf-8");

  it("exports ReportsTeam with title + range selector + back button", () => {
    expect(source).toMatch(/export default function ReportsTeam\b/);
    expect(source).toMatch(/data-testid="reports-team-page"/);
    expect(source).toMatch(/data-testid="reports-team-title"/);
    expect(source).toMatch(/data-testid="select-team-range"/);
    expect(source).toMatch(/data-testid="team-back-to-reports"/);
    expect(source).toMatch(/setLocation\("\/reports"\)/);
  });

  it("threads the canonical /api/reports/team endpoint into TanStack Query", () => {
    expect(source).toMatch(/\["\/api\/reports\/team",\s*range\]/);
    expect(source).toMatch(/`\/api\/reports\/team\?range=\$\{range\}`/);
  });

  it("renders all five sections with canonical test ids", () => {
    for (const id of [
      "team-section-kpis",
      "team-section-hours-by-user",
      "team-section-unbillable-by-user",
      "team-section-jobs-by-user",
      "team-section-time-distribution",
    ]) {
      const propMatch = new RegExp(`testId="${id}"`).test(source);
      const attrMatch = new RegExp(`data-testid="${id}"`).test(source);
      expect(propMatch || attrMatch, `expected ${id} in source`).toBe(true);
    }
  });

  it("each section card short-circuits to SectionEmpty when hasData is false", () => {
    const chunks = source.split(/\nfunction /);
    const cards = [
      "HoursByUserCard",
      "UnbillableByUserCard",
      "JobsByUserCard",
      "TimeDistributionCard",
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
    expect(source).toContain('data-testid="team-error"');
  });

  it("per-user list cards iterate backend items directly — no client sort/filter/reduce-of-data", () => {
    const chunks = source.split(/\nfunction /);
    const cards = [
      "HoursByUserCard",
      "UnbillableByUserCard",
      "JobsByUserCard",
    ];
    for (const fn of cards) {
      const card = chunks.find(
        (c) => c.startsWith(`${fn}(`) || c.startsWith(`${fn} `),
      );
      expect(card, `${fn} must exist`).toBeDefined();
      expect(card!).toMatch(/section\.items\.map\(/);
      expect(card!).not.toMatch(/section\.items\.sort\(/);
      expect(card!).not.toMatch(/section\.items\.filter\(/);
      // The single allowed `.reduce()` is the visual `Math.max` for
      // the relative-bar scaling. No business-data reduce is permitted.
      const reduces = card!.match(/\.reduce\(/g) ?? [];
      expect(reduces.length).toBeLessThanOrEqual(1);
      if (reduces.length === 1) {
        const idx = card!.indexOf(".reduce(");
        const tail = card!.slice(idx, idx + 200);
        expect(tail).toContain("Math.max");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — no-fake-data guards
// ---------------------------------------------------------------------------

describe("Team deep-report — no fabricated metric values", () => {
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
      "fakeTeam",
      "lorem ipsum",
    ];
    for (const src of sources) {
      for (const phrase of forbidden) {
        expect(src.toLowerCase()).not.toContain(phrase.toLowerCase());
      }
    }
  });

  it("contains no MetricCard / output-shape numeric literals", () => {
    const forbidden = /\b(currentValue|previousMonthValue|previousQuarterValue|previousYearValue|totalHours|billableHours|unbillableHours|cost|completedCount|avgInvoiceTotal|invoicedCount|billablePercent|unbillablePercent):\s*[1-9]\d*(?:\.\d+)?/g;
    for (const src of sources) {
      expect(src.match(forbidden) ?? []).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Layer 3 — server route + aggregator wiring guards
// ---------------------------------------------------------------------------

describe("Team — server route + aggregator wiring", () => {
  const routeSrc = fs.readFileSync(routePath, "utf-8");
  const aggSrc = fs.readFileSync(aggregatorPath, "utf-8");
  const commonSrc = fs.readFileSync(commonPath, "utf-8");

  it("registers GET /team under requireRole(MANAGER_ROLES)", () => {
    expect(routeSrc).toMatch(
      /router\.get\(\s*"\/team",\s*requireRole\(MANAGER_ROLES\)/,
    );
    expect(routeSrc).toMatch(/getCompanyTeam/);
    expect(routeSrc).toMatch(/teamQuerySchema/);
  });

  it("aggregator does NOT directly hit DB tables — pure orchestrator", () => {
    expect(aggSrc).not.toMatch(/from "@shared\/schema"/);
    expect(aggSrc).not.toMatch(/from "\.\.\/db"/);
    expect(aggSrc).not.toMatch(/mockMetrics|fakeData|HARDCODED_/i);
  });

  it("KPIs route through sharedQueries — including the new hour scalars", () => {
    expect(aggSrc).toMatch(/sharedQueries\.totalHoursWorked\(/);
    expect(aggSrc).toMatch(/sharedQueries\.totalBillableHours\(/);
    expect(aggSrc).toMatch(/sharedQueries\.totalUnbillableHours\(/);
    expect(aggSrc).toMatch(/sharedQueries\.unbillableCost\(/);
    expect(aggSrc).toMatch(/sharedQueries\.unbillableEntriesWithCostRate\(/);
    // 4 KPI cards via buildMetric.
    const buildMetric = (aggSrc.match(/buildMetric\(\{/g) ?? []).length;
    expect(buildMetric).toBe(4);
    const polarity = (aggSrc.match(/polarity:\s*"(higher|lower)_is_better"/g) ?? []).length;
    expect(polarity).toBe(buildMetric);
  });

  it("hours-by-user keys on time_entries.technicianId (FK-clean) — no inferred relationships", () => {
    const block = commonSrc.match(
      /export async function getHoursByUserShared[\s\S]+?\n\}/,
    );
    expect(block, "getHoursByUserShared must exist").not.toBeNull();
    const body = block![0];
    expect(body).toMatch(/innerJoin\(users,\s*eq\(timeEntries\.technicianId,\s*users\.id\)\)/);
    expect(body).toMatch(/isNotNull\(timeEntries\.durationMinutes\)/);
    // Anti-regression: must NOT join job_visits or use multi-tech arrays.
    expect(body).not.toMatch(/jobVisits/);
    expect(body).not.toMatch(/assignedTechnicianIds/);
  });

  it("unbillable-by-user excludes entries with NULL costRateSnapshot + non-billable only", () => {
    const block = commonSrc.match(
      /export async function getUnbillableByUserShared[\s\S]+?\n\}/,
    );
    expect(block, "getUnbillableByUserShared must exist").not.toBeNull();
    const body = block![0];
    expect(body).toMatch(/eq\(timeEntries\.billable,\s*false\)/);
    expect(body).toMatch(/isNotNull\(timeEntries\.costRateSnapshot\)/);
    expect(body).toMatch(/isNotNull\(timeEntries\.durationMinutes\)/);
    expect(body).toMatch(/innerJoin\(users,\s*eq\(timeEntries\.technicianId,\s*users\.id\)\)/);
    // Cost calc: minutes/60 * rate.
    expect(body).toMatch(/durationMinutes\}::numeric \/ 60\.0/);
    expect(body).toMatch(/CAST\(\$\{timeEntries\.costRateSnapshot\}/);
  });

  it("jobs-by-user keys on job_status_events.changedBy and excludes null/multi-tech inference", () => {
    const block = commonSrc.match(
      /export async function getJobsCompletedByUserShared[\s\S]+?\n\}/,
    );
    expect(block, "getJobsCompletedByUserShared must exist").not.toBeNull();
    const body = block![0];
    // Attribution via changedBy → users.id (text join).
    expect(body).toMatch(/eq\(sql`\$\{jobStatusEvents\.changedBy\}`,\s*users\.id\)/);
    // Filter to completion events only + exclude null changedBy + soft-deleted jobs.
    expect(body).toMatch(/eq\(jobStatusEvents\.toStatus,\s*"completed"\)/);
    expect(body).toMatch(/isNotNull\(jobStatusEvents\.changedBy\)/);
    expect(body).toMatch(/isNull\(jobs\.deletedAt\)/);
    // Anti-regression: must NOT use job_visits / assigned-tech arrays.
    expect(body).not.toMatch(/jobVisits/);
    expect(body).not.toMatch(/assignedTechnicianIds/);
  });

  it("hour scalars (totalHoursWorked / totalBillableHours / totalUnbillableHours) use time_entries", () => {
    for (const sym of [
      "totalHoursWorked",
      "totalBillableHours",
      "totalUnbillableHours",
    ]) {
      const block = commonSrc.match(
        new RegExp(`${sym}:[\\s\\S]+?return parseFloat[\\s\\S]+?\\}\\s*,`),
      );
      expect(block, `${sym} must exist`).not.toBeNull();
      const body = block![0];
      expect(body).toMatch(/\.from\(timeEntries\)/);
      expect(body).toMatch(/durationMinutes/);
      expect(body).toMatch(/isNotNull\(timeEntries\.durationMinutes\)/);
    }
    // Billable / unbillable scalars filter on `billable` true / false.
    const billableBlock = commonSrc.match(
      /totalBillableHours:[\s\S]+?return parseFloat[\s\S]+?\}\s*,/,
    );
    expect(billableBlock![0]).toMatch(/eq\(timeEntries\.billable,\s*true\)/);
    const unbillableBlock = commonSrc.match(
      /totalUnbillableHours:[\s\S]+?return parseFloat[\s\S]+?\}\s*,/,
    );
    expect(unbillableBlock![0]).toMatch(/eq\(timeEntries\.billable,\s*false\)/);
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

describe("Team — reuse canonicality", () => {
  const commonSrc = fs.readFileSync(commonPath, "utf-8");
  const aggSrc = fs.readFileSync(aggregatorPath, "utf-8");

  it("reportsCommon exports the three new per-user helpers + three hour scalars", () => {
    for (const sym of [
      "getHoursByUserShared",
      "getUnbillableByUserShared",
      "getJobsCompletedByUserShared",
    ]) {
      expect(commonSrc).toMatch(
        new RegExp(`export async function ${sym}\\(`),
      );
    }
    for (const sym of [
      "totalHoursWorked",
      "totalBillableHours",
      "totalUnbillableHours",
    ]) {
      expect(commonSrc).toMatch(new RegExp(`${sym}:\\s*\\(companyId`));
    }
  });

  it("Team aggregator imports the new shared helpers + scalars", () => {
    expect(aggSrc).toMatch(/from "\.\/reportsCommon"/);
    expect(aggSrc).toMatch(/getHoursByUserShared/);
    expect(aggSrc).toMatch(/getUnbillableByUserShared/);
    expect(aggSrc).toMatch(/getJobsCompletedByUserShared/);
  });
});

// ---------------------------------------------------------------------------
// Layer 5 — App + library wiring
// ---------------------------------------------------------------------------

describe("Team — app route + library catalog wiring", () => {
  const appSrc = fs.readFileSync(appPath, "utf-8");

  it("imports ReportsTeam and mounts /reports/team under requireManager", () => {
    expect(appSrc).toMatch(/import ReportsTeam from "@\/pages\/ReportsTeam";/);
    const block = appSrc.match(/<Route path="\/reports\/team">[\s\S]+?<\/Route>/);
    expect(block, "/reports/team route must exist").not.toBeNull();
    expect(block![0]).toMatch(/<ProtectedRoute requireManager>/);
    expect(block![0]).toMatch(/<ReportsTeam \/>/);
  });

  it("the library catalog includes an active Team Performance entry under Team Reports", () => {
    const team = REPORTS_LIBRARY.find((c) => c.id === "team");
    expect(team, "Team category must exist").toBeDefined();
    const entry = team!.reports.find((r) => r.id === "team");
    expect(entry, "Team Performance entry must exist").toBeDefined();
    expect(entry!.status).toBe("active");
    expect(entry!.href).toBe("/reports/team");
    expect(entry!.title.toLowerCase()).toContain("team performance");
    expect(entry!.description.length).toBeGreaterThan(0);
    // The previous coming-soon entry (id: "team-overview") must have
    // been removed — the library no longer carries a coming-soon
    // placeholder for Team.
    expect(team!.reports.find((r) => r.id === "team-overview")).toBeUndefined();
  });
});
