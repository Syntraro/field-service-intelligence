/**
 * Pins the exact array shapes of all canonical jobKeys.
 *
 * If any shape changes, this test fails — blocking accidental renames or
 * shape drift. All sub-resources must be descendants of jobKeys.detail(id)
 * so the ["jobs"] root prefix-matches the full job cache hierarchy.
 */
import { describe, it, expect } from "vitest";
import { jobKeys } from "../../client/src/lib/queryKeys/jobs";

const J = "job-abc";

describe("jobKeys — root and aliases", () => {
  it("root()", () => expect(jobKeys.root()).toEqual(["jobs"]));
  it("all() is a deprecated alias for root()", () =>
    expect(jobKeys.all()).toEqual(["jobs"]));
});

describe("jobKeys — feed / list variants", () => {
  it("feed() with no args", () =>
    expect(jobKeys.feed()).toEqual([
      "jobs", "feed",
      null, null, null, null, null, null, null, null, null, null, null, null,
    ]));

  it("feed() with first arg only", () =>
    expect(jobKeys.feed("open")).toEqual([
      "jobs", "feed",
      "open", null, null, null, null, null, null, null, null, null, null, null,
    ]));

  it("picker()", () => expect(jobKeys.picker()).toEqual(["jobs", "picker"]));

  it("search(params)", () =>
    expect(jobKeys.search({ search: "abc", limit: 20 })).toEqual([
      "jobs", "search", { search: "abc", limit: 20 },
    ]));

  it("listForLocation with scope", () =>
    expect(jobKeys.listForLocation("loc1", "open")).toEqual([
      "jobs", "list", "loc1", "open",
    ]));

  it("listForLocation without scope defaults to null", () =>
    expect(jobKeys.listForLocation("loc1")).toEqual([
      "jobs", "list", "loc1", null,
    ]));
});

describe("jobKeys — detail", () => {
  it("detail(id)", () => expect(jobKeys.detail(J)).toEqual(["jobs", "detail", J]));
});

describe("jobKeys — sub-resources under detail", () => {
  it("parts(id)", () =>
    expect(jobKeys.parts(J)).toEqual(["jobs", "detail", J, "parts"]));
  it("expenses(id)", () =>
    expect(jobKeys.expenses(J)).toEqual(["jobs", "detail", J, "expenses"]));
  it("timeEntries(id)", () =>
    expect(jobKeys.timeEntries(J)).toEqual(["jobs", "detail", J, "timeEntries"]));
  it("timeSummary(id)", () =>
    expect(jobKeys.timeSummary(J)).toEqual(["jobs", "detail", J, "timeSummary"]));
  it("notes(id)", () =>
    expect(jobKeys.notes(J)).toEqual(["jobs", "detail", J, "notes"]));
  it("equipment(id)", () =>
    expect(jobKeys.equipment(J)).toEqual(["jobs", "detail", J, "equipment"]));
  it("billablePreview(id)", () =>
    expect(jobKeys.billablePreview(J)).toEqual(["jobs", "detail", J, "billablePreview"]));
  it("requiredSkills(id)", () =>
    expect(jobKeys.requiredSkills(J)).toEqual(["jobs", "detail", J, "requiredSkills"]));
  it("statusEvents(id)", () =>
    expect(jobKeys.statusEvents(J)).toEqual(["jobs", "detail", J, "statusEvents"]));
  it("scheduleHistory(id)", () =>
    expect(jobKeys.scheduleHistory(J)).toEqual(["jobs", "detail", J, "scheduleHistory"]));
  it("assignmentRecs(id, date)", () =>
    expect(jobKeys.assignmentRecs(J, "2026-05-18")).toEqual([
      "jobs", "detail", J, "assignmentRecs", "2026-05-18",
    ]));
  it("assignmentRecs(id) — no date defaults to null", () =>
    expect(jobKeys.assignmentRecs(J)).toEqual([
      "jobs", "detail", J, "assignmentRecs", null,
    ]));
});

describe("jobKeys — temporary bridge (remove after retirement)", () => {
  it("urlFamily()", () => expect(jobKeys.urlFamily()).toEqual(["/api/jobs"]));
});

describe("jobKeys — canonical prefix hierarchy", () => {
  const root = jobKeys.root();

  it("root prefix-matches detail", () =>
    expect(jobKeys.detail(J).slice(0, root.length)).toEqual([...root]));

  it("root prefix-matches feed", () =>
    expect(jobKeys.feed().slice(0, root.length)).toEqual([...root]));

  it("root prefix-matches picker", () =>
    expect(jobKeys.picker().slice(0, root.length)).toEqual([...root]));

  const subResources = [
    ["parts", jobKeys.parts(J)] as const,
    ["expenses", jobKeys.expenses(J)] as const,
    ["timeEntries", jobKeys.timeEntries(J)] as const,
    ["timeSummary", jobKeys.timeSummary(J)] as const,
    ["notes", jobKeys.notes(J)] as const,
    ["equipment", jobKeys.equipment(J)] as const,
    ["billablePreview", jobKeys.billablePreview(J)] as const,
    ["requiredSkills", jobKeys.requiredSkills(J)] as const,
    ["statusEvents", jobKeys.statusEvents(J)] as const,
    ["scheduleHistory", jobKeys.scheduleHistory(J)] as const,
    ["assignmentRecs", jobKeys.assignmentRecs(J)] as const,
  ] as const;

  for (const [name, key] of subResources) {
    it(`root prefix-matches ${name}`, () =>
      expect([...(key as readonly unknown[])].slice(0, root.length)).toEqual([...root]));
  }

  const detail = jobKeys.detail(J);

  for (const [name, key] of subResources) {
    it(`detail prefix-matches ${name}`, () =>
      expect([...(key as readonly unknown[])].slice(0, detail.length)).toEqual([...detail]));
  }
});
