/**
 * Phase 3G guardrails — ghost invalidation cleanup.
 *
 * Asserts that the canonical helpers emit the correct keys and that no
 * helper emits the legacy URL-pattern strings that were removed from
 * TimeEntryModal, EditVisitModal, and QuickAddJobDialog in Phase 3G.
 */
import { describe, it, expect } from "vitest";
import { jobKeys } from "../../client/src/lib/queryKeys/jobs";
import {
  invalidateJobParts,
  invalidateJobTimeEntries,
} from "../../client/src/lib/queryInvalidation/jobs";

function makeQc() {
  const calls: unknown[][] = [];
  return {
    invalidateQueries: (opts: { queryKey: unknown }) => {
      calls.push(opts.queryKey as unknown[]);
    },
    calls,
  };
}

const JOB_ID = "job-ghost-test";

// ── invalidateJobParts — no legacy strings ────────────────────────────────

describe("invalidateJobParts — emits canonical keys only", () => {
  it("emits the canonical parts key", () => {
    const qc = makeQc();
    invalidateJobParts(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.parts(JOB_ID));
  });

  it("emits the job detail key", () => {
    const qc = makeQc();
    invalidateJobParts(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.detail(JOB_ID));
  });

  it("emits the semantic root", () => {
    const qc = makeQc();
    invalidateJobParts(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.root());
  });

  it("does NOT emit the retired URL-pattern family prefix", () => {
    const qc = makeQc();
    invalidateJobParts(qc as any, JOB_ID);
    expect(qc.calls).not.toContainEqual(["/api/jobs"]);
  });

  it("does NOT emit the legacy URL-pattern parts string", () => {
    const qc = makeQc();
    invalidateJobParts(qc as any, JOB_ID);
    expect(qc.calls).not.toContainEqual(["/api/jobs", JOB_ID, "parts"]);
  });
});

// ── invalidateJobTimeEntries — no legacy strings ──────────────────────────

describe("invalidateJobTimeEntries — emits canonical keys only", () => {
  it("emits the canonical timeEntries key", () => {
    const qc = makeQc();
    invalidateJobTimeEntries(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.timeEntries(JOB_ID));
  });

  it("emits the canonical timeSummary key", () => {
    const qc = makeQc();
    invalidateJobTimeEntries(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.timeSummary(JOB_ID));
  });

  it("emits the job detail key", () => {
    const qc = makeQc();
    invalidateJobTimeEntries(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.detail(JOB_ID));
  });

  it("emits the semantic root", () => {
    const qc = makeQc();
    invalidateJobTimeEntries(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.root());
  });

  it("does NOT emit the retired URL-pattern family prefix", () => {
    const qc = makeQc();
    invalidateJobTimeEntries(qc as any, JOB_ID);
    expect(qc.calls).not.toContainEqual(["/api/jobs"]);
  });

  it("does NOT emit the legacy URL-pattern time-entries string", () => {
    const qc = makeQc();
    invalidateJobTimeEntries(qc as any, JOB_ID);
    expect(qc.calls).not.toContainEqual(["/api/jobs", JOB_ID, "time-entries"]);
  });

  it("does NOT emit the legacy URL-pattern time-summary string", () => {
    const qc = makeQc();
    invalidateJobTimeEntries(qc as any, JOB_ID);
    expect(qc.calls).not.toContainEqual(["/api/jobs", JOB_ID, "time-summary"]);
  });
});

// ── Canonical key shape cross-checks ─────────────────────────────────────

describe("ghost-cleanup canonical shapes — not URL-pattern", () => {
  it("parts key first segment is 'jobs' not '/api/jobs'", () => {
    expect(jobKeys.parts(JOB_ID)[0]).toBe("jobs");
  });

  it("timeEntries key first segment is 'jobs' not '/api/jobs'", () => {
    expect(jobKeys.timeEntries(JOB_ID)[0]).toBe("jobs");
  });

  it("timeSummary key first segment is 'jobs' not '/api/jobs'", () => {
    expect(jobKeys.timeSummary(JOB_ID)[0]).toBe("jobs");
  });

  it("timeEntries key does NOT contain the kebab-case segment", () => {
    expect(jobKeys.timeEntries(JOB_ID)).not.toContain("time-entries");
  });

  it("timeSummary key does NOT contain the kebab-case segment", () => {
    expect(jobKeys.timeSummary(JOB_ID)).not.toContain("time-summary");
  });
});
