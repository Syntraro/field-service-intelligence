/**
 * Phase 3D guardrails — job equipment canonical key.
 *
 * Verifies that jobKeys.equipment() produces the canonical shape, and that
 * invalidateJobEquipment emits the correct bust set (urlFamily bridge retired Phase 3J).
 */
import { describe, it, expect } from "vitest";
import { jobKeys } from "../../client/src/lib/queryKeys/jobs";
import { invalidateJobEquipment } from "../../client/src/lib/queryInvalidation/jobs";

function makeQc() {
  const calls: unknown[][] = [];
  return {
    invalidateQueries: (opts: { queryKey: unknown }) => {
      calls.push(opts.queryKey as unknown[]);
    },
    calls,
  };
}

const JOB_ID = "job-equip-test";

// ── Key shapes ────────────────────────────────────────────────────────────

describe("jobKeys.equipment — canonical key shape", () => {
  it("produces the canonical equipment key under detail", () => {
    expect(jobKeys.equipment(JOB_ID)).toEqual([
      "jobs",
      "detail",
      JOB_ID,
      "equipment",
    ]);
  });

  it("is a descendant of jobKeys.detail", () => {
    const detail = jobKeys.detail(JOB_ID);
    const key = jobKeys.equipment(JOB_ID);
    expect(key.slice(0, detail.length)).toEqual([...detail]);
  });

  it("is a descendant of jobKeys.root", () => {
    const root = jobKeys.root();
    expect(jobKeys.equipment(JOB_ID).slice(0, root.length)).toEqual([...root]);
  });

  it("does NOT use the URL-pattern prefix", () => {
    expect(jobKeys.equipment(JOB_ID)[0]).not.toBe("/api/jobs");
  });
});

// ── Invalidation scope ────────────────────────────────────────────────────

describe("invalidateJobEquipment — invalidation scope", () => {
  it("busts the canonical equipment key", () => {
    const qc = makeQc();
    invalidateJobEquipment(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.equipment(JOB_ID));
  });

  it("busts the job detail key", () => {
    const qc = makeQc();
    invalidateJobEquipment(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.detail(JOB_ID));
  });

  it("busts the semantic root", () => {
    const qc = makeQc();
    invalidateJobEquipment(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.root());
  });

  it("does NOT emit the retired URL-pattern family prefix", () => {
    const qc = makeQc();
    invalidateJobEquipment(qc as any, JOB_ID);
    expect(qc.calls).not.toContainEqual(["/api/jobs"]);
  });

  it("does NOT bust unrelated sub-resources", () => {
    const qc = makeQc();
    invalidateJobEquipment(qc as any, JOB_ID);
    expect(qc.calls).not.toContainEqual(jobKeys.parts(JOB_ID));
    expect(qc.calls).not.toContainEqual(jobKeys.expenses(JOB_ID));
    expect(qc.calls).not.toContainEqual(jobKeys.timeEntries(JOB_ID));
    expect(qc.calls).not.toContainEqual(jobKeys.notes(JOB_ID));
  });
});
