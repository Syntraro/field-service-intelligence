/**
 * Phase 3I guardrails — remaining search/list + dispatch bridge consumers.
 *
 * Asserts canonical key shapes for search and listForLocation patterns,
 * and confirms the dispatch bridge no longer emits ["/api/jobs"].
 */
import { describe, it, expect } from "vitest";
import { jobKeys } from "../../client/src/lib/queryKeys/jobs";
import { invalidateJob } from "../../client/src/lib/queryInvalidation/jobs";

function makeQc() {
  const calls: unknown[][] = [];
  return {
    invalidateQueries: (opts: { queryKey: unknown }) => {
      calls.push(opts.queryKey as unknown[]);
    },
    calls,
  };
}

const JOB_ID = "job-3i-test";
const LOCATION_ID = "loc-3i-test";

// ── jobKeys.search canonical shape ───────────────────────────────────────────

describe("jobKeys.search — canonical shape", () => {
  it("first segment is 'jobs'", () => {
    const key = jobKeys.search({ search: "HVAC", limit: 25 });
    expect(key[0]).toBe("jobs");
  });

  it("second segment is 'search'", () => {
    const key = jobKeys.search({ search: "HVAC", limit: 25 });
    expect(key[1]).toBe("search");
  });

  it("third segment is the params object", () => {
    const params = { search: "HVAC", limit: 25 };
    const key = jobKeys.search(params);
    expect(key[2]).toEqual(params);
  });

  it("does NOT start with '/api/jobs'", () => {
    const key = jobKeys.search({ search: "test", limit: 25 });
    expect(key[0]).not.toBe("/api/jobs");
  });

  it("does NOT match legacy URL-pattern shape", () => {
    const key = jobKeys.search({ search: "test", limit: 25 });
    expect(key).not.toContainEqual("/api/jobs");
  });
});

// ── jobKeys.listForLocation canonical shape ───────────────────────────────────

describe("jobKeys.listForLocation — canonical shape", () => {
  it("first segment is 'jobs'", () => {
    const key = jobKeys.listForLocation(LOCATION_ID, "open-or-completed-not-invoiced");
    expect(key[0]).toBe("jobs");
  });

  it("second segment is 'list'", () => {
    const key = jobKeys.listForLocation(LOCATION_ID, "open-or-completed-not-invoiced");
    expect(key[1]).toBe("list");
  });

  it("third segment is the locationId", () => {
    const key = jobKeys.listForLocation(LOCATION_ID, "open-or-completed-not-invoiced");
    expect(key[2]).toBe(LOCATION_ID);
  });

  it("fourth segment is the scope string", () => {
    const key = jobKeys.listForLocation(LOCATION_ID, "open-or-completed-not-invoiced");
    expect(key[3]).toBe("open-or-completed-not-invoiced");
  });

  it("scope defaults to null when omitted", () => {
    const key = jobKeys.listForLocation(LOCATION_ID);
    expect(key[3]).toBeNull();
  });

  it("does NOT start with '/api/jobs'", () => {
    const key = jobKeys.listForLocation(LOCATION_ID, "open-or-completed-not-invoiced");
    expect(key[0]).not.toBe("/api/jobs");
  });
});

// ── invalidateJob does NOT emit ["/api/jobs"] bare family ────────────────────

describe("invalidateJob — dispatch bridge cleanup", () => {
  it("does NOT emit bare ['/api/jobs'] invalidation", () => {
    const qc = makeQc();
    invalidateJob(qc as any, JOB_ID);
    expect(qc.calls).not.toContainEqual(["/api/jobs"]);
  });

  it("emits the semantic root ['jobs']", () => {
    const qc = makeQc();
    invalidateJob(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.root());
  });

  it("emits the job detail key", () => {
    const qc = makeQc();
    invalidateJob(qc as any, JOB_ID);
    expect(qc.calls).toContainEqual(jobKeys.detail(JOB_ID));
  });
});

// ── Legacy shape not present in canonical keys ────────────────────────────────

describe("legacy URL-pattern shapes are absent", () => {
  it("search key differs from legacy ['/api/jobs', { search, limit }]", () => {
    const canonical = jobKeys.search({ search: "test", limit: 25 });
    const legacy = ["/api/jobs", { search: "test", limit: 25 }];
    expect(canonical).not.toEqual(legacy);
  });

  it("listForLocation key differs from legacy ['/api/jobs', { locationId, scope }]", () => {
    const canonical = jobKeys.listForLocation(LOCATION_ID, "open-or-completed-not-invoiced");
    const legacy = ["/api/jobs", { locationId: LOCATION_ID, scope: "open-or-completed-not-invoiced" }];
    expect(canonical).not.toEqual(legacy);
  });
});
