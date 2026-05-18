/**
 * Phase 3J guardrails — urlFamily bridge retired.
 *
 * Asserts that:
 *   1. jobKeys no longer exports urlFamily().
 *   2. No job invalidation helper emits ["/api/jobs"].
 *   3. Every helper still emits its canonical Pattern B keys.
 */
import { describe, it, expect } from "vitest";
import { jobKeys } from "../../client/src/lib/queryKeys/jobs";
import {
  invalidateJob,
  invalidateJobSubresources,
  invalidateJobLifecycle,
  invalidateJobExpense,
  invalidateJobParts,
  invalidateJobTimeEntries,
  invalidateJobEquipment,
  invalidateJobNotes,
  invalidateJobRequiredSkills,
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

const JOB_ID = "job-3j-retire";

// ── urlFamily removed from factory ───────────────────────────────────────────

describe("jobKeys — urlFamily retired", () => {
  it("jobKeys does not expose urlFamily", () => {
    expect((jobKeys as any).urlFamily).toBeUndefined();
  });

  it("no key factory returns ['/api/jobs'] prefix", () => {
    const allKeys = [
      jobKeys.root(),
      jobKeys.all(),
      jobKeys.detail(JOB_ID),
      jobKeys.parts(JOB_ID),
      jobKeys.expenses(JOB_ID),
      jobKeys.timeEntries(JOB_ID),
      jobKeys.timeSummary(JOB_ID),
      jobKeys.notes(JOB_ID),
      jobKeys.equipment(JOB_ID),
      jobKeys.requiredSkills(JOB_ID),
      jobKeys.statusEvents(JOB_ID),
      jobKeys.scheduleHistory(JOB_ID),
      jobKeys.assignmentRecs(JOB_ID),
      jobKeys.picker(),
      jobKeys.search({ q: "test" }),
      jobKeys.listForLocation("loc-1"),
    ];
    for (const key of allKeys) {
      expect(key[0]).not.toBe("/api/jobs");
    }
  });
});

// ── No helper emits ["/api/jobs"] ────────────────────────────────────────────

const helpers: Array<{ name: string; fn: (qc: any) => void }> = [
  { name: "invalidateJob",             fn: (qc) => invalidateJob(qc, JOB_ID) },
  { name: "invalidateJobSubresources", fn: (qc) => invalidateJobSubresources(qc, JOB_ID) },
  { name: "invalidateJobLifecycle",    fn: (qc) => invalidateJobLifecycle(qc, JOB_ID) },
  { name: "invalidateJobExpense",      fn: (qc) => invalidateJobExpense(qc, JOB_ID) },
  { name: "invalidateJobParts",        fn: (qc) => invalidateJobParts(qc, JOB_ID) },
  { name: "invalidateJobTimeEntries",  fn: (qc) => invalidateJobTimeEntries(qc, JOB_ID) },
  { name: "invalidateJobEquipment",    fn: (qc) => invalidateJobEquipment(qc, JOB_ID) },
  { name: "invalidateJobNotes",        fn: (qc) => invalidateJobNotes(qc, JOB_ID) },
  { name: "invalidateJobRequiredSkills", fn: (qc) => invalidateJobRequiredSkills(qc, JOB_ID) },
];

describe("no job helper emits ['/api/jobs'] (urlFamily retired)", () => {
  for (const { name, fn } of helpers) {
    it(`${name} does not emit ['/api/jobs']`, () => {
      const qc = makeQc();
      fn(qc);
      expect(qc.calls).not.toContainEqual(["/api/jobs"]);
    });
  }
});

// ── Helpers still emit semantic root ─────────────────────────────────────────

describe("all helpers still emit canonical ['jobs'] root", () => {
  // invalidateJobSubresources busts only the specific sub-resource keys;
  // root() is covered by invalidateJob() when called through invalidateJobLifecycle().
  const helpersWithRoot = helpers.filter(
    (h) => h.name !== "invalidateJob" && h.name !== "invalidateJobSubresources",
  );

  for (const { name, fn } of helpersWithRoot) {
    it(`${name} emits jobKeys.root()`, () => {
      const qc = makeQc();
      fn(qc);
      expect(qc.calls).toContainEqual(jobKeys.root());
    });
  }

  it("invalidateJob emits jobKeys.all() (alias for root)", () => {
    const qc = makeQc();
    invalidateJob(qc, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.all());
  });

  it("invalidateJobSubresources emits canonical sub-resource keys under ['jobs'] hierarchy", () => {
    const qc = makeQc();
    invalidateJobSubresources(qc, JOB_ID);
    // All emitted keys must start with "jobs" (Pattern B), not "/api/jobs"
    for (const key of qc.calls) {
      expect((key as string[])[0]).toBe("jobs");
    }
  });
});
