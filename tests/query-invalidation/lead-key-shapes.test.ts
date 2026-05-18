/**
 * Pins the exact array shapes of all canonical leadKeys.
 *
 * If any shape changes, this test fails — blocking accidental renames.
 * All keys are Pattern B (semantic arrays); no URL-pattern keys remain.
 */
import { describe, it, expect } from "vitest";
import { leadKeys } from "../../client/src/lib/queryKeys/leads";

describe("leadKeys — canonical shapes", () => {
  it("root", () => expect(leadKeys.root()).toEqual(["leads"]));
  it("list no filter", () => expect(leadKeys.list()).toEqual(["leads", "list", null]));
  it("list with filter", () =>
    expect(leadKeys.list({ status: "open" })).toEqual(["leads", "list", { status: "open" }]));
  it("detail", () => expect(leadKeys.detail("abc")).toEqual(["leads", "detail", "abc"]));
  it("notes", () =>
    expect(leadKeys.notes("abc")).toEqual(["leads", "detail", "abc", "notes"]));
  it("visits", () =>
    expect(leadKeys.visits("abc")).toEqual(["leads", "detail", "abc", "visits"]));
});

describe("leadKeys — no legacy property", () => {
  it("does not expose an 'all' alias", () => {
    expect((leadKeys as any).all).toBeUndefined();
  });
});
