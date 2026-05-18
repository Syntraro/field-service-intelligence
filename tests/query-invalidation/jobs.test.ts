/**
 * Query invalidation tests — jobs.
 *
 * Verifies that each helper calls invalidateQueries with the exact key
 * shapes documented in client/src/lib/queryKeys/jobs.ts. Uses a spy on
 * a minimal QueryClient mock so we assert intent, not TanStack internals.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { jobKeys } from "../../client/src/lib/queryKeys/jobs";
import {
  invalidateJob,
  invalidateJobSubresources,
  invalidateJobLifecycle,
  invalidateJobExpense,
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

const JOB_ID = "job-abc";

describe("invalidateJob", () => {
  it("busts the semantic family prefix and the detail key", () => {
    const qc = makeQc();
    invalidateJob(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.all());
    expect(qc.calls).toContainEqual(jobKeys.detail(JOB_ID));
  });

  it("does not bust URL-pattern sub-resource keys", () => {
    const qc = makeQc();
    invalidateJob(qc as any, JOB_ID);
    expect(qc.calls).not.toContainEqual(jobKeys.parts(JOB_ID));
    expect(qc.calls).not.toContainEqual(jobKeys.expenses(JOB_ID));
    expect(qc.calls).not.toContainEqual(jobKeys.timeEntries(JOB_ID));
  });
});

describe("invalidateJobSubresources", () => {
  it("busts parts, expenses, and time-entries URL-pattern keys", () => {
    const qc = makeQc();
    invalidateJobSubresources(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.parts(JOB_ID));
    expect(qc.calls).toContainEqual(jobKeys.expenses(JOB_ID));
    expect(qc.calls).toContainEqual(jobKeys.timeEntries(JOB_ID));
  });
});

describe("invalidateJobLifecycle", () => {
  it("busts semantic family, detail, all sub-resources, and URL family prefix", () => {
    const qc = makeQc();
    invalidateJobLifecycle(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.all());
    expect(qc.calls).toContainEqual(jobKeys.detail(JOB_ID));
    expect(qc.calls).toContainEqual(jobKeys.parts(JOB_ID));
    expect(qc.calls).toContainEqual(jobKeys.expenses(JOB_ID));
    expect(qc.calls).toContainEqual(jobKeys.timeEntries(JOB_ID));
    expect(qc.calls).toContainEqual(jobKeys.urlFamily());
  });
});

describe("invalidateJobExpense", () => {
  it("busts expense key, job detail, and semantic family", () => {
    const qc = makeQc();
    invalidateJobExpense(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.expenses(JOB_ID));
    expect(qc.calls).toContainEqual(jobKeys.detail(JOB_ID));
    expect(qc.calls).toContainEqual(jobKeys.all());
  });

  it("does not bust unrelated sub-resources", () => {
    const qc = makeQc();
    invalidateJobExpense(qc as any, JOB_ID);
    expect(qc.calls).not.toContainEqual(jobKeys.parts(JOB_ID));
    expect(qc.calls).not.toContainEqual(jobKeys.timeEntries(JOB_ID));
  });
});
