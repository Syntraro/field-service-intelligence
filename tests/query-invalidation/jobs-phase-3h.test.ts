/**
 * Phase 3H guardrails — remaining low-traffic job sub-resource consumers.
 *
 * Asserts that invalidateJobRequiredSkills emits the correct keys and that
 * the migrated query key factories produce canonical Pattern B shapes.
 */
import { describe, it, expect } from "vitest";
import { jobKeys } from "../../client/src/lib/queryKeys/jobs";
import { invalidateJobRequiredSkills } from "../../client/src/lib/queryInvalidation/jobs";

function makeQc() {
  const calls: unknown[][] = [];
  return {
    invalidateQueries: (opts: { queryKey: unknown }) => {
      calls.push(opts.queryKey as unknown[]);
    },
    calls,
  };
}

const JOB_ID = "job-3h-test";

// ── invalidateJobRequiredSkills ───────────────────────────────────────────────

describe("invalidateJobRequiredSkills — emits canonical keys", () => {
  it("emits the canonical requiredSkills key", () => {
    const qc = makeQc();
    invalidateJobRequiredSkills(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.requiredSkills(JOB_ID));
  });

  it("emits the job detail key", () => {
    const qc = makeQc();
    invalidateJobRequiredSkills(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.detail(JOB_ID));
  });

  it("emits the semantic root", () => {
    const qc = makeQc();
    invalidateJobRequiredSkills(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.root());
  });

  it("does NOT emit the retired URL-pattern family prefix", () => {
    const qc = makeQc();
    invalidateJobRequiredSkills(qc as any, JOB_ID);
    expect(qc.calls).not.toContainEqual(["/api/jobs"]);
  });

  it("does NOT emit the legacy URL-pattern required-skills string", () => {
    const qc = makeQc();
    invalidateJobRequiredSkills(qc as any, JOB_ID);
    expect(qc.calls).not.toContainEqual(["/api/jobs", JOB_ID, "required-skills"]);
  });
});

// ── Canonical key shapes for Phase 3H sub-resources ──────────────────────────

describe("Phase 3H canonical key shapes", () => {
  it("requiredSkills key first segment is 'jobs'", () => {
    expect(jobKeys.requiredSkills(JOB_ID)[0]).toBe("jobs");
  });

  it("statusEvents key first segment is 'jobs'", () => {
    expect(jobKeys.statusEvents(JOB_ID)[0]).toBe("jobs");
  });

  it("scheduleHistory key first segment is 'jobs'", () => {
    expect(jobKeys.scheduleHistory(JOB_ID)[0]).toBe("jobs");
  });

  it("assignmentRecs key first segment is 'jobs'", () => {
    expect(jobKeys.assignmentRecs(JOB_ID, "today")[0]).toBe("jobs");
  });

  it("requiredSkills key does NOT contain kebab-case segment", () => {
    expect(jobKeys.requiredSkills(JOB_ID)).not.toContain("required-skills");
  });

  it("statusEvents key does NOT contain kebab-case segment", () => {
    expect(jobKeys.statusEvents(JOB_ID)).not.toContain("status-events");
  });

  it("scheduleHistory key does NOT contain kebab-case segment", () => {
    expect(jobKeys.scheduleHistory(JOB_ID)).not.toContain("schedule-history");
  });

  it("assignmentRecs key preserves 'today' sentinel", () => {
    const key = jobKeys.assignmentRecs(JOB_ID, "today");
    expect(key).toContain("today");
  });

  it("assignmentRecs key falls back to null when no date given", () => {
    const key = jobKeys.assignmentRecs(JOB_ID);
    expect(key[key.length - 1]).toBeNull();
  });
});
