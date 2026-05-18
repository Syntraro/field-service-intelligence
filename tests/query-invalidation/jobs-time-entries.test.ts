/**
 * Phase 3C guardrails — job time entries and time summary canonical keys.
 *
 * Verifies that jobKeys.timeEntries() and jobKeys.timeSummary() produce
 * the canonical shapes, and that invalidateJobTimeEntries emits the correct
 * bust set (including the temporary urlFamily bridge for both sub-resources).
 */
import { describe, it, expect } from "vitest";
import { jobKeys } from "../../client/src/lib/queryKeys/jobs";
import { invalidateJobTimeEntries } from "../../client/src/lib/queryInvalidation/jobs";

function makeQc() {
  const calls: unknown[][] = [];
  return {
    invalidateQueries: (opts: { queryKey: unknown }) => {
      calls.push(opts.queryKey as unknown[]);
    },
    calls,
  };
}

const JOB_ID = "job-time-test";

// ── Key shapes ────────────────────────────────────────────────────────────

describe("jobKeys.timeEntries — canonical key shape", () => {
  it("produces the canonical timeEntries key under detail", () => {
    expect(jobKeys.timeEntries(JOB_ID)).toEqual([
      "jobs",
      "detail",
      JOB_ID,
      "timeEntries",
    ]);
  });

  it("is a descendant of jobKeys.detail", () => {
    const detail = jobKeys.detail(JOB_ID);
    const key = jobKeys.timeEntries(JOB_ID);
    expect(key.slice(0, detail.length)).toEqual([...detail]);
  });

  it("is a descendant of jobKeys.root", () => {
    const root = jobKeys.root();
    expect(jobKeys.timeEntries(JOB_ID).slice(0, root.length)).toEqual([...root]);
  });

  it("does NOT use the URL-pattern prefix", () => {
    expect(jobKeys.timeEntries(JOB_ID)[0]).not.toBe("/api/jobs");
  });

  it("does NOT contain the legacy kebab-case segment", () => {
    expect(jobKeys.timeEntries(JOB_ID)).not.toContain("time-entries");
  });
});

describe("jobKeys.timeSummary — canonical key shape", () => {
  it("produces the canonical timeSummary key under detail", () => {
    expect(jobKeys.timeSummary(JOB_ID)).toEqual([
      "jobs",
      "detail",
      JOB_ID,
      "timeSummary",
    ]);
  });

  it("is a descendant of jobKeys.detail", () => {
    const detail = jobKeys.detail(JOB_ID);
    const key = jobKeys.timeSummary(JOB_ID);
    expect(key.slice(0, detail.length)).toEqual([...detail]);
  });

  it("is a descendant of jobKeys.root", () => {
    const root = jobKeys.root();
    expect(jobKeys.timeSummary(JOB_ID).slice(0, root.length)).toEqual([...root]);
  });

  it("does NOT use the URL-pattern prefix", () => {
    expect(jobKeys.timeSummary(JOB_ID)[0]).not.toBe("/api/jobs");
  });

  it("does NOT contain the legacy kebab-case segment", () => {
    expect(jobKeys.timeSummary(JOB_ID)).not.toContain("time-summary");
  });
});

// ── Invalidation scope ────────────────────────────────────────────────────

describe("invalidateJobTimeEntries — invalidation scope", () => {
  it("busts the canonical timeEntries key", () => {
    const qc = makeQc();
    invalidateJobTimeEntries(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.timeEntries(JOB_ID));
  });

  it("busts the canonical timeSummary key", () => {
    const qc = makeQc();
    invalidateJobTimeEntries(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.timeSummary(JOB_ID));
  });

  it("busts the job detail key", () => {
    const qc = makeQc();
    invalidateJobTimeEntries(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.detail(JOB_ID));
  });

  it("busts the semantic root", () => {
    const qc = makeQc();
    invalidateJobTimeEntries(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.root());
  });

  it("busts the urlFamily bridge prefix (temporary)", () => {
    const qc = makeQc();
    invalidateJobTimeEntries(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.urlFamily());
  });

  it("does NOT bust unrelated sub-resources", () => {
    const qc = makeQc();
    invalidateJobTimeEntries(qc as any, JOB_ID);
    expect(qc.calls).not.toContainEqual(jobKeys.parts(JOB_ID));
    expect(qc.calls).not.toContainEqual(jobKeys.expenses(JOB_ID));
    expect(qc.calls).not.toContainEqual(jobKeys.equipment(JOB_ID));
    expect(qc.calls).not.toContainEqual(jobKeys.notes(JOB_ID));
  });
});
