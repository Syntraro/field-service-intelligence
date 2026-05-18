/**
 * Pins the exact array shapes of canonical quoteKeys.
 *
 * If any shape changes, this test fails, which blocks accidental renames.
 */
import { describe, it, expect } from "vitest";
import { quoteKeys } from "../../client/src/lib/queryKeys/quotes";

describe("quoteKeys — canonical shapes", () => {
  it("root", () => expect(quoteKeys.root()).toEqual(["quotes"]));
  it("list no filter", () => expect(quoteKeys.list()).toEqual(["quotes", "list", null]));
  it("list with filter", () =>
    expect(quoteKeys.list({ status: "sent" })).toEqual(["quotes", "list", { status: "sent" }]));
  it("detail", () => expect(quoteKeys.detail("abc")).toEqual(["quotes", "detail", "abc"]));
  it("notes", () => expect(quoteKeys.notes("abc")).toEqual(["quotes", "detail", "abc", "notes"]));
  it("stats", () => expect(quoteKeys.stats()).toEqual(["quotes", "stats"]));
  it("viewCounts", () => expect(quoteKeys.viewCounts()).toEqual(["quotes", "views", "counts"]));
});

describe("quoteKeys.legacy — shapes", () => {
  it("all", () => expect(quoteKeys.legacy.all()).toEqual(["/api/quotes"]));
  it("list", () => expect(quoteKeys.legacy.list()).toEqual(["/api/quotes/list"]));
  it("detail", () => expect(quoteKeys.legacy.detail("abc")).toEqual(["quote", "abc", "details"]));
  it("detailBroad", () => expect(quoteKeys.legacy.detailBroad("abc")).toEqual(["quote", "abc"]));
  it("notes", () => expect(quoteKeys.legacy.notes("abc")).toEqual(["quote", "abc", "notes"]));
});
