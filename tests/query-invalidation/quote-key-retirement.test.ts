/**
 * Guardrail: ensures no call site uses inline legacy quote key literals.
 *
 * After full migration (when legacy.* keys are removed from the factory),
 * this test should be updated to assert the legacy keys are absent from
 * the factory entirely.
 *
 * During bridge period it just verifies the helpers bust the canonical root,
 * so removing the legacy calls would still keep the cache consistent.
 */
import { describe, it, expect } from "vitest";
import { quoteKeys } from "../../client/src/lib/queryKeys/quotes";
import { invalidateQuote, invalidateQuoteList } from "../../client/src/lib/queryInvalidation/quotes";

function makeQc() {
  const calls: unknown[][] = [];
  return {
    invalidateQueries: (opts: { queryKey: unknown }) => {
      calls.push(opts.queryKey as unknown[]);
    },
    calls,
  };
}

describe("canonical root is always busted (retirement guardrail)", () => {
  it("invalidateQuote includes canonical root", () => {
    const qc = makeQc();
    invalidateQuote(qc as any, "any-id");
    const calledKeys = qc.calls;
    const hasRoot = calledKeys.some(
      (k) => Array.isArray(k) && k.length === 1 && k[0] === "quotes",
    );
    expect(hasRoot).toBe(true);
  });

  it("invalidateQuoteList includes canonical root", () => {
    const qc = makeQc();
    invalidateQuoteList(qc as any);
    const calledKeys = qc.calls;
    const hasRoot = calledKeys.some(
      (k) => Array.isArray(k) && k.length === 1 && k[0] === "quotes",
    );
    expect(hasRoot).toBe(true);
  });

  it("canonical root prefix-matches stats", () => {
    // Verify the canonical root key is a proper prefix of stats.
    // React Query uses array prefix matching.
    const root = quoteKeys.root();
    const stats = quoteKeys.stats();
    expect(stats.slice(0, root.length)).toEqual([...root]);
  });

  it("canonical root prefix-matches viewCounts", () => {
    const root = quoteKeys.root();
    const viewCounts = quoteKeys.viewCounts();
    expect(viewCounts.slice(0, root.length)).toEqual([...root]);
  });

  it("canonical root prefix-matches list", () => {
    const root = quoteKeys.root();
    const list = quoteKeys.list();
    expect(list.slice(0, root.length)).toEqual([...root]);
  });

  it("canonical root prefix-matches detail", () => {
    const root = quoteKeys.root();
    const detail = quoteKeys.detail("id");
    expect(detail.slice(0, root.length)).toEqual([...root]);
  });
});
