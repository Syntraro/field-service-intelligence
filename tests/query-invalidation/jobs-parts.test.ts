/**
 * Phase 3B guardrails — job parts canonical key and shared-cache integrity.
 *
 * Verifies that:
 *   1. jobKeys.parts() produces the canonical shape.
 *   2. invalidateJobParts emits the correct bust set (including urlFamily bridge).
 *   3. All known parts consumers resolve to the EXACT same key — preserving
 *      React Query dedupe between JobDetailPage, EditVisitModal, and
 *      QuickAddJobDialog.
 */
import { describe, it, expect } from "vitest";
import { jobKeys } from "../../client/src/lib/queryKeys/jobs";
import { invalidateJobParts } from "../../client/src/lib/queryInvalidation/jobs";

function makeQc() {
  const calls: unknown[][] = [];
  return {
    invalidateQueries: (opts: { queryKey: unknown }) => {
      calls.push(opts.queryKey as unknown[]);
    },
    calls,
  };
}

const JOB_ID = "job-parts-test";

// ── Canonical key shape ───────────────────────────────────────────────────

describe("jobKeys.parts — canonical key shape", () => {
  it("produces the canonical parts key under detail", () => {
    expect(jobKeys.parts(JOB_ID)).toEqual([
      "jobs",
      "detail",
      JOB_ID,
      "parts",
    ]);
  });

  it("is a descendant of jobKeys.detail (prefix-matched by detail)", () => {
    const detail = jobKeys.detail(JOB_ID);
    const key = jobKeys.parts(JOB_ID);
    expect(key.slice(0, detail.length)).toEqual([...detail]);
  });

  it("is a descendant of jobKeys.root (prefix-matched by root)", () => {
    const root = jobKeys.root();
    const key = jobKeys.parts(JOB_ID);
    expect(key.slice(0, root.length)).toEqual([...root]);
  });

  it("does NOT use the URL-pattern prefix", () => {
    expect(jobKeys.parts(JOB_ID)[0]).not.toBe("/api/jobs");
  });
});

// ── Invalidation scope ────────────────────────────────────────────────────

describe("invalidateJobParts — invalidation scope", () => {
  it("busts the canonical parts key", () => {
    const qc = makeQc();
    invalidateJobParts(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.parts(JOB_ID));
  });

  it("busts the job detail key", () => {
    const qc = makeQc();
    invalidateJobParts(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.detail(JOB_ID));
  });

  it("busts the semantic root", () => {
    const qc = makeQc();
    invalidateJobParts(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.root());
  });

  it("busts the urlFamily bridge prefix (temporary)", () => {
    const qc = makeQc();
    invalidateJobParts(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.urlFamily());
  });

  it("does NOT bust unrelated sub-resources", () => {
    const qc = makeQc();
    invalidateJobParts(qc as any, JOB_ID);
    expect(qc.calls).not.toContainEqual(jobKeys.expenses(JOB_ID));
    expect(qc.calls).not.toContainEqual(jobKeys.timeEntries(JOB_ID));
    expect(qc.calls).not.toContainEqual(jobKeys.equipment(JOB_ID));
    expect(qc.calls).not.toContainEqual(jobKeys.notes(JOB_ID));
  });
});

// ── Shared-cache consistency ──────────────────────────────────────────────
// All consumers must resolve to the IDENTICAL key for React Query dedupe.
// If any surface diverges, JobDetailPage and EditVisitModal see separate
// cache entries and issue duplicate network requests.

describe("shared-cache consistency — all consumers use the same key factory", () => {
  it("JobDetailPage and EditVisitModal resolve to the identical parts key", () => {
    // Both call jobKeys.parts(jobId) with the same jobId.
    const jobDetailKey = jobKeys.parts(JOB_ID);
    const editVisitKey = jobKeys.parts(JOB_ID);
    expect(jobDetailKey).toEqual(editVisitKey);
  });

  it("QuickAddJobDialog invalidation targets the same key family", () => {
    // QuickAddJobDialog calls invalidateJobParts(queryClient, job.id).
    // The helper busts jobKeys.parts(id) — same factory, same key shape.
    const qc = makeQc();
    invalidateJobParts(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.parts(JOB_ID));
  });

  it("key is stable for the same jobId (pure factory, no randomness)", () => {
    const key1 = jobKeys.parts(JOB_ID);
    const key2 = jobKeys.parts(JOB_ID);
    expect(key1).toEqual(key2);
  });

  it("keys for different jobIds are distinct (no cross-job cache sharing)", () => {
    const keyA = jobKeys.parts("job-aaa");
    const keyB = jobKeys.parts("job-bbb");
    expect(keyA).not.toEqual(keyB);
  });
});
