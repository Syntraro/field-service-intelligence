/**
 * Phase 3A guardrails — job expenses canonical key and invalidation.
 *
 * Asserts that jobKeys.expenses() produces the canonical shape and that
 * invalidateJobExpense emits the correct set of busts (including the
 * temporary urlFamily bridge). Mirrors the pattern from jobs.test.ts.
 */
import { describe, it, expect } from "vitest";
import { jobKeys } from "../../client/src/lib/queryKeys/jobs";
import { invalidateJobExpense } from "../../client/src/lib/queryInvalidation/jobs";

function makeQc() {
  const calls: unknown[][] = [];
  return {
    invalidateQueries: (opts: { queryKey: unknown }) => {
      calls.push(opts.queryKey as unknown[]);
    },
    calls,
  };
}

const JOB_ID = "job-expenses-test";

describe("jobKeys.expenses — canonical key shape", () => {
  it("produces the canonical expenses key under detail", () => {
    expect(jobKeys.expenses(JOB_ID)).toEqual([
      "jobs",
      "detail",
      JOB_ID,
      "expenses",
    ]);
  });

  it("is a descendant of jobKeys.detail (prefix-matched by detail)", () => {
    const detail = jobKeys.detail(JOB_ID);
    const key = jobKeys.expenses(JOB_ID);
    expect(key.slice(0, detail.length)).toEqual([...detail]);
  });

  it("is a descendant of jobKeys.root (prefix-matched by root)", () => {
    const root = jobKeys.root();
    const key = jobKeys.expenses(JOB_ID);
    expect(key.slice(0, root.length)).toEqual([...root]);
  });

  it("does NOT use the URL-pattern prefix", () => {
    expect(jobKeys.expenses(JOB_ID)[0]).not.toBe("/api/jobs");
  });

  it("does NOT contain the legacy kebab-case segment", () => {
    expect(jobKeys.expenses(JOB_ID)).not.toContain("expenses-legacy");
  });
});

describe("invalidateJobExpense — invalidation scope", () => {
  it("busts the canonical expenses key", () => {
    const qc = makeQc();
    invalidateJobExpense(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.expenses(JOB_ID));
  });

  it("busts the job detail key", () => {
    const qc = makeQc();
    invalidateJobExpense(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.detail(JOB_ID));
  });

  it("busts the semantic root", () => {
    const qc = makeQc();
    invalidateJobExpense(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.root());
  });

  it("busts the urlFamily bridge prefix (temporary)", () => {
    const qc = makeQc();
    invalidateJobExpense(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.urlFamily());
  });

  it("does NOT bust unrelated sub-resources", () => {
    const qc = makeQc();
    invalidateJobExpense(qc as any, JOB_ID);
    expect(qc.calls).not.toContainEqual(jobKeys.parts(JOB_ID));
    expect(qc.calls).not.toContainEqual(jobKeys.timeEntries(JOB_ID));
    expect(qc.calls).not.toContainEqual(jobKeys.equipment(JOB_ID));
    expect(qc.calls).not.toContainEqual(jobKeys.notes(JOB_ID));
  });
});
