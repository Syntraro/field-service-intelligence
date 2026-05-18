/**
 * Guardrail: lead keys are fully canonical — no legacy URL-pattern keys.
 *
 * Asserts structural invariants that would fail if legacy keys were re-introduced.
 */
import { describe, it, expect } from "vitest";
import { leadKeys } from "../../client/src/lib/queryKeys/leads";
import {
  invalidateLead,
  invalidateLeadList,
  invalidateLeadVisits,
} from "../../client/src/lib/queryInvalidation/leads";

function makeQc() {
  const calls: unknown[][] = [];
  return {
    invalidateQueries: (opts: { queryKey: unknown }) => {
      calls.push(opts.queryKey as unknown[]);
    },
    calls,
  };
}

describe("canonical root is always busted", () => {
  it("invalidateLead busts root", () => {
    const qc = makeQc();
    invalidateLead(qc as any, "any-id");
    const hasRoot = qc.calls.some(
      (k) => Array.isArray(k) && k.length === 1 && k[0] === "leads",
    );
    expect(hasRoot).toBe(true);
  });

  it("invalidateLeadList busts root", () => {
    const qc = makeQc();
    invalidateLeadList(qc as any);
    const hasRoot = qc.calls.some(
      (k) => Array.isArray(k) && k.length === 1 && k[0] === "leads",
    );
    expect(hasRoot).toBe(true);
  });
});

describe("no legacy keys emitted by helpers", () => {
  it("invalidateLead emits no /api/leads key", () => {
    const qc = makeQc();
    invalidateLead(qc as any, "id");
    const hasLegacy = qc.calls.some(
      (k) => Array.isArray(k) && typeof k[0] === "string" && k[0].startsWith("/api/leads"),
    );
    expect(hasLegacy).toBe(false);
  });

  it("invalidateLeadVisits emits no /api/leads key", () => {
    const qc = makeQc();
    invalidateLeadVisits(qc as any, "id");
    const hasLegacy = qc.calls.some(
      (k) => Array.isArray(k) && typeof k[0] === "string" && k[0].startsWith("/api/leads"),
    );
    expect(hasLegacy).toBe(false);
  });

  it("invalidateLeadList emits no /api/leads key", () => {
    const qc = makeQc();
    invalidateLeadList(qc as any);
    const hasLegacy = qc.calls.some(
      (k) => Array.isArray(k) && typeof k[0] === "string" && k[0].startsWith("/api/leads"),
    );
    expect(hasLegacy).toBe(false);
  });
});

describe("canonical prefix-matching coverage", () => {
  it("root prefix-matches list", () => {
    const root = leadKeys.root();
    expect(leadKeys.list().slice(0, root.length)).toEqual([...root]);
  });

  it("root prefix-matches detail", () => {
    const root = leadKeys.root();
    expect(leadKeys.detail("id").slice(0, root.length)).toEqual([...root]);
  });

  it("root prefix-matches notes", () => {
    const root = leadKeys.root();
    expect(leadKeys.notes("id").slice(0, root.length)).toEqual([...root]);
  });

  it("root prefix-matches visits", () => {
    const root = leadKeys.root();
    expect(leadKeys.visits("id").slice(0, root.length)).toEqual([...root]);
  });

  it("detail prefix-matches notes (notes is a detail sub-resource)", () => {
    const detail = leadKeys.detail("id");
    expect(leadKeys.notes("id").slice(0, detail.length)).toEqual([...detail]);
  });

  it("detail prefix-matches visits (visits is a detail sub-resource)", () => {
    const detail = leadKeys.detail("id");
    expect(leadKeys.visits("id").slice(0, detail.length)).toEqual([...detail]);
  });
});
