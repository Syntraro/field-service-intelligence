/**
 * Pins the exact array shapes of all canonical visitKeys.
 *
 * visitKeys are intentionally separate from jobKeys — visit invalidation is
 * cross-cutting across dispatch, calendar, and KPI workflows that bust
 * ["visits"] globally without knowing the jobId. See queryKeys/visits.ts.
 */
import { describe, it, expect } from "vitest";
import { visitKeys } from "../../client/src/lib/queryKeys/visits";

describe("visitKeys — root", () => {
  it("root()", () => expect(visitKeys.root()).toEqual(["visits"]));
});

describe("visitKeys — job visits", () => {
  it("jobVisits(jobId)", () =>
    expect(visitKeys.jobVisits("job-abc")).toEqual(["visits", "job-abc", "all"]));
});

describe("visitKeys — KPI summaries", () => {
  it("summaryWeek(weekStart, weekEnd)", () =>
    expect(visitKeys.summaryWeek("2026-05-11", "2026-05-17")).toEqual([
      "visits", "summary-week", "2026-05-11", "2026-05-17",
    ]));

  it("summaryMonth(monthStart, monthEnd)", () =>
    expect(visitKeys.summaryMonth("2026-05-01", "2026-05-31")).toEqual([
      "visits", "summary-month", "2026-05-01", "2026-05-31",
    ]));

  it("summaryScheduled(from)", () =>
    expect(visitKeys.summaryScheduled("2026-05-18")).toEqual([
      "visits", "summary-scheduled", "2026-05-18",
    ]));
});

describe("visitKeys — canonical prefix hierarchy", () => {
  const root = visitKeys.root();

  it("root prefix-matches jobVisits", () =>
    expect(visitKeys.jobVisits("job-abc").slice(0, root.length)).toEqual([...root]));

  it("root prefix-matches summaryWeek", () =>
    expect(visitKeys.summaryWeek("2026-05-11", "2026-05-17").slice(0, root.length)).toEqual([...root]));

  it("root prefix-matches summaryMonth", () =>
    expect(visitKeys.summaryMonth("2026-05-01", "2026-05-31").slice(0, root.length)).toEqual([...root]));

  it("root prefix-matches summaryScheduled", () =>
    expect(visitKeys.summaryScheduled("2026-05-18").slice(0, root.length)).toEqual([...root]));
});
