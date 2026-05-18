/**
 * Query invalidation tests — quotes.
 *
 * Bridge period: invalidateQuote busts BOTH canonical and legacy key shapes.
 *
 * Canonical keys:
 *   ["quotes"]                     — root prefix (busts all canonical quote keys)
 *
 * Legacy keys (still live in query call sites):
 *   ["quote", id]                  — old detailBroad prefix
 *   ["/api/quotes"]                — URL-pattern list
 *   ["/api/quotes/list"]           — alternate URL-pattern list
 */
import { describe, it, expect } from "vitest";
import { quoteKeys } from "../../client/src/lib/queryKeys/quotes";
import {
  invalidateQuote,
  invalidateQuoteList,
} from "../../client/src/lib/queryInvalidation/quotes";

function makeQc() {
  const calls: unknown[][] = [];
  return {
    invalidateQueries: (opts: { queryKey: unknown }) => {
      calls.push(opts.queryKey as unknown[]);
    },
    calls,
  };
}

const QUOTE_ID = "quote-xyz";

describe("invalidateQuote", () => {
  it("busts canonical root prefix", () => {
    const qc = makeQc();
    invalidateQuote(qc as any, QUOTE_ID);
    expect(qc.calls).toContainEqual(quoteKeys.root());
  });

  it("busts legacy detailBroad prefix (bridge)", () => {
    const qc = makeQc();
    invalidateQuote(qc as any, QUOTE_ID);
    expect(qc.calls).toContainEqual(quoteKeys.legacy.detailBroad(QUOTE_ID));
  });

  it("busts both legacy list keys (bridge)", () => {
    const qc = makeQc();
    invalidateQuote(qc as any, QUOTE_ID);
    expect(qc.calls).toContainEqual(quoteKeys.legacy.all());
    expect(qc.calls).toContainEqual(quoteKeys.legacy.list());
  });

  it("no-ops on undefined quoteId", () => {
    const qc = makeQc();
    invalidateQuote(qc as any, undefined);
    expect(qc.calls).toHaveLength(0);
  });
});

describe("invalidateQuoteList", () => {
  it("busts canonical root prefix", () => {
    const qc = makeQc();
    invalidateQuoteList(qc as any);
    expect(qc.calls).toContainEqual(quoteKeys.root());
  });

  it("busts both legacy list keys (bridge)", () => {
    const qc = makeQc();
    invalidateQuoteList(qc as any);
    expect(qc.calls).toContainEqual(quoteKeys.legacy.all());
    expect(qc.calls).toContainEqual(quoteKeys.legacy.list());
  });

  it("does not target a specific legacy detail key", () => {
    const qc = makeQc();
    invalidateQuoteList(qc as any);
    expect(qc.calls).not.toContainEqual(quoteKeys.legacy.detailBroad(QUOTE_ID));
    expect(qc.calls).not.toContainEqual(quoteKeys.legacy.detail(QUOTE_ID));
  });
});
