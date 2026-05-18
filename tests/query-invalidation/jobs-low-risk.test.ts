/**
 * Phase 2 low-risk canonical key guardrails — jobs.
 *
 * Asserts that the low-risk job query families (requiredSkills, statusEvents,
 * scheduleHistory, assignmentRecs, picker, search, listForLocation) use the
 * canonical jobKeys.* factory and never produce malformed or URL-pattern keys.
 *
 * These tests are structural: they assert the key shapes the factories emit,
 * which is what call sites must match now that they've migrated. They do NOT
 * re-test the invalidation helpers already covered by jobs.test.ts.
 */
import { describe, it, expect } from "vitest";
import { jobKeys } from "../../client/src/lib/queryKeys/jobs";

const JOB_ID = "job-abc";
const LOC_ID = "loc-xyz";

// ── Factory output shapes ─────────────────────────────────────────────────

describe("jobKeys.requiredSkills — canonical key shape", () => {
  it("produces the canonical requiredSkills key under detail", () => {
    expect(jobKeys.requiredSkills(JOB_ID)).toEqual([
      "jobs",
      "detail",
      JOB_ID,
      "requiredSkills",
    ]);
  });

  it("is a descendant of jobKeys.detail (prefix-matched by detail)", () => {
    const detail = jobKeys.detail(JOB_ID);
    const key = jobKeys.requiredSkills(JOB_ID);
    expect(key.slice(0, detail.length)).toEqual([...detail]);
  });

  it("is a descendant of jobKeys.root (prefix-matched by root)", () => {
    const root = jobKeys.root();
    const key = jobKeys.requiredSkills(JOB_ID);
    expect(key.slice(0, root.length)).toEqual([...root]);
  });

  it("does NOT use the URL-pattern prefix", () => {
    expect(jobKeys.requiredSkills(JOB_ID)[0]).not.toBe("/api/jobs");
  });
});

describe("jobKeys.statusEvents — canonical key shape", () => {
  it("produces the canonical statusEvents key under detail", () => {
    expect(jobKeys.statusEvents(JOB_ID)).toEqual([
      "jobs",
      "detail",
      JOB_ID,
      "statusEvents",
    ]);
  });

  it("is a descendant of jobKeys.root", () => {
    const root = jobKeys.root();
    const key = jobKeys.statusEvents(JOB_ID);
    expect(key.slice(0, root.length)).toEqual([...root]);
  });

  it("does NOT use the URL-pattern prefix", () => {
    expect(jobKeys.statusEvents(JOB_ID)[0]).not.toBe("/api/jobs");
  });
});

describe("jobKeys.scheduleHistory — canonical key shape", () => {
  it("produces the canonical scheduleHistory key under detail", () => {
    expect(jobKeys.scheduleHistory(JOB_ID)).toEqual([
      "jobs",
      "detail",
      JOB_ID,
      "scheduleHistory",
    ]);
  });

  it("is a descendant of jobKeys.root", () => {
    const root = jobKeys.root();
    const key = jobKeys.scheduleHistory(JOB_ID);
    expect(key.slice(0, root.length)).toEqual([...root]);
  });

  it("does NOT use the URL-pattern prefix", () => {
    expect(jobKeys.scheduleHistory(JOB_ID)[0]).not.toBe("/api/jobs");
  });
});

describe("jobKeys.assignmentRecs — canonical key shape and date semantics", () => {
  it("produces the canonical assignmentRecs key with explicit date", () => {
    expect(jobKeys.assignmentRecs(JOB_ID, "2026-05-18")).toEqual([
      "jobs",
      "detail",
      JOB_ID,
      "assignmentRecs",
      "2026-05-18",
    ]);
  });

  it("produces null sentinel when date is omitted", () => {
    expect(jobKeys.assignmentRecs(JOB_ID)).toEqual([
      "jobs",
      "detail",
      JOB_ID,
      "assignmentRecs",
      null,
    ]);
  });

  it("produces null sentinel when date is explicitly null", () => {
    expect(jobKeys.assignmentRecs(JOB_ID, null)).toEqual([
      "jobs",
      "detail",
      JOB_ID,
      "assignmentRecs",
      null,
    ]);
  });

  it("preserves 'today' sentinel when passed explicitly", () => {
    // Call sites pass `date ?? "today"` to preserve legacy semantics.
    expect(jobKeys.assignmentRecs(JOB_ID, "today")).toEqual([
      "jobs",
      "detail",
      JOB_ID,
      "assignmentRecs",
      "today",
    ]);
  });

  it("is a descendant of jobKeys.root", () => {
    const root = jobKeys.root();
    const key = jobKeys.assignmentRecs(JOB_ID, "today");
    expect(key.slice(0, root.length)).toEqual([...root]);
  });

  it("does NOT use the URL-pattern prefix", () => {
    expect(jobKeys.assignmentRecs(JOB_ID, "today")[0]).not.toBe("/api/jobs");
  });
});

describe("jobKeys.picker — canonical key shape", () => {
  it("produces the canonical picker key", () => {
    expect(jobKeys.picker()).toEqual(["jobs", "picker"]);
  });

  it("is a descendant of jobKeys.root", () => {
    const root = jobKeys.root();
    const key = jobKeys.picker();
    expect(key.slice(0, root.length)).toEqual([...root]);
  });

  it("does NOT use the URL-pattern prefix", () => {
    expect(jobKeys.picker()[0]).not.toBe("/api/jobs");
  });
});

describe("jobKeys.search — canonical key shape", () => {
  it("produces the canonical search key with params object", () => {
    const params = { search: "hvac", limit: 25 };
    expect(jobKeys.search(params)).toEqual(["jobs", "search", params]);
  });

  it("is a descendant of jobKeys.root", () => {
    const root = jobKeys.root();
    const key = jobKeys.search({ q: "test" });
    expect(key.slice(0, root.length)).toEqual([...root]);
  });
});

describe("jobKeys.listForLocation — canonical key shape and scope semantics", () => {
  it("produces the canonical listForLocation key with explicit scope", () => {
    expect(
      jobKeys.listForLocation(LOC_ID, "open-or-completed-not-invoiced"),
    ).toEqual(["jobs", "list", LOC_ID, "open-or-completed-not-invoiced"]);
  });

  it("uses null when scope is omitted", () => {
    expect(jobKeys.listForLocation(LOC_ID)).toEqual([
      "jobs",
      "list",
      LOC_ID,
      null,
    ]);
  });

  it("uses null when scope is explicitly null", () => {
    expect(jobKeys.listForLocation(LOC_ID, null)).toEqual([
      "jobs",
      "list",
      LOC_ID,
      null,
    ]);
  });

  it("is a descendant of jobKeys.root", () => {
    const root = jobKeys.root();
    const key = jobKeys.listForLocation(LOC_ID, "open");
    expect(key.slice(0, root.length)).toEqual([...root]);
  });
});

// ── Malformed-key guardrails ──────────────────────────────────────────────

describe("malformed semantic key guardrails", () => {
  it("requiredSkills key does NOT have the URL-pattern shape", () => {
    const key = jobKeys.requiredSkills(JOB_ID);
    expect(key).not.toContain("required-skills");
  });

  it("statusEvents key does NOT have the URL-pattern shape", () => {
    const key = jobKeys.statusEvents(JOB_ID);
    expect(key).not.toContain("status-events");
  });

  it("scheduleHistory key does NOT have the URL-pattern shape", () => {
    const key = jobKeys.scheduleHistory(JOB_ID);
    expect(key).not.toContain("schedule-history");
  });

  it("assignmentRecs key does NOT have the URL-pattern shape", () => {
    const key = jobKeys.assignmentRecs(JOB_ID, "today");
    expect(key).not.toContain("assignment-recommendations");
  });
});
