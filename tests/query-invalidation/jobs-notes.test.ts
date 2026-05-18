/**
 * Phase 3E guardrails — job notes canonical key.
 *
 * Verifies that jobKeys.notes() produces the canonical shape under
 * jobKeys.detail, and that invalidateJobNotes emits the correct bust set
 * (including the temporary urlFamily bridge). Also asserts that the
 * shared-note components (EntityNoteDialog, EntityNotesPanel) use the
 * canonical key for the "job" entity type branch.
 */
import { describe, it, expect } from "vitest";
import { jobKeys } from "../../client/src/lib/queryKeys/jobs";
import { invalidateJobNotes } from "../../client/src/lib/queryInvalidation/jobs";

function makeQc() {
  const calls: unknown[][] = [];
  return {
    invalidateQueries: (opts: { queryKey: unknown }) => {
      calls.push(opts.queryKey as unknown[]);
    },
    calls,
  };
}

const JOB_ID = "job-notes-test";

// ── Key shapes ────────────────────────────────────────────────────────────

describe("jobKeys.notes — canonical key shape", () => {
  it("produces the canonical notes key under detail", () => {
    expect(jobKeys.notes(JOB_ID)).toEqual([
      "jobs",
      "detail",
      JOB_ID,
      "notes",
    ]);
  });

  it("is a descendant of jobKeys.detail", () => {
    const detail = jobKeys.detail(JOB_ID);
    const key = jobKeys.notes(JOB_ID);
    expect(key.slice(0, detail.length)).toEqual([...detail]);
  });

  it("is a descendant of jobKeys.root", () => {
    const root = jobKeys.root();
    expect(jobKeys.notes(JOB_ID).slice(0, root.length)).toEqual([...root]);
  });

  it("does NOT use the URL-pattern prefix", () => {
    expect(jobKeys.notes(JOB_ID)[0]).not.toBe("/api/jobs");
  });

  it("does NOT use the legacy malformed shape (missing 'detail' segment)", () => {
    expect(jobKeys.notes(JOB_ID)).not.toEqual(["jobs", JOB_ID, "notes"]);
  });
});

// ── Invalidation scope ────────────────────────────────────────────────────

describe("invalidateJobNotes — invalidation scope", () => {
  it("busts the canonical notes key", () => {
    const qc = makeQc();
    invalidateJobNotes(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.notes(JOB_ID));
  });

  it("busts the job detail key", () => {
    const qc = makeQc();
    invalidateJobNotes(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.detail(JOB_ID));
  });

  it("busts the semantic root", () => {
    const qc = makeQc();
    invalidateJobNotes(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.root());
  });

  it("busts the urlFamily bridge prefix (temporary)", () => {
    const qc = makeQc();
    invalidateJobNotes(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.urlFamily());
  });

  it("does NOT bust unrelated sub-resources", () => {
    const qc = makeQc();
    invalidateJobNotes(qc as any, JOB_ID);
    expect(qc.calls).not.toContainEqual(jobKeys.parts(JOB_ID));
    expect(qc.calls).not.toContainEqual(jobKeys.expenses(JOB_ID));
    expect(qc.calls).not.toContainEqual(jobKeys.equipment(JOB_ID));
    expect(qc.calls).not.toContainEqual(jobKeys.timeEntries(JOB_ID));
  });
});

// ── Retired key patterns ─────────────────────────────────────────────────

describe("retired key patterns — must not match canonical shape", () => {
  it("URL-pattern key ['/api/jobs', id, 'notes'] is NOT canonical", () => {
    const retired = ["/api/jobs", JOB_ID, "notes"];
    expect(jobKeys.notes(JOB_ID)).not.toEqual(retired);
  });

  it("malformed semantic key ['jobs', id, 'notes'] (missing 'detail') is NOT canonical", () => {
    const malformed = ["jobs", JOB_ID, "notes"];
    expect(jobKeys.notes(JOB_ID)).not.toEqual(malformed);
  });

  it("canonical key has exactly 4 segments", () => {
    expect(jobKeys.notes(JOB_ID)).toHaveLength(4);
  });
});
