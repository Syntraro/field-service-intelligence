/**
 * Query invalidation tests — leads.
 *
 * Verifies that:
 *   - invalidateLead busts both the family prefix and the explicit detail key
 *   - invalidateLeadVisits busts the URL-pattern visits key
 *   - the two helpers are independent (visits key NOT in invalidateLead)
 */
import { describe, it, expect } from "vitest";
import { leadKeys } from "../../client/src/lib/queryKeys/leads";
import {
  invalidateLead,
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

const LEAD_ID = "lead-001";

describe("invalidateLead", () => {
  it("busts the family prefix and explicit detail key", () => {
    const qc = makeQc();
    invalidateLead(qc as any, LEAD_ID);
    expect(qc.calls).toContainEqual(leadKeys.all());
    expect(qc.calls).toContainEqual(leadKeys.detail(LEAD_ID));
  });

  it("does NOT bust the URL-pattern visits key", () => {
    const qc = makeQc();
    invalidateLead(qc as any, LEAD_ID);
    expect(qc.calls).not.toContainEqual(leadKeys.visits(LEAD_ID));
  });
});

describe("invalidateLeadVisits", () => {
  it("busts the URL-pattern visits key", () => {
    const qc = makeQc();
    invalidateLeadVisits(qc as any, LEAD_ID);
    expect(qc.calls).toContainEqual(leadKeys.visits(LEAD_ID));
  });

  it("does not redundantly bust the lead family or detail", () => {
    const qc = makeQc();
    invalidateLeadVisits(qc as any, LEAD_ID);
    expect(qc.calls).not.toContainEqual(leadKeys.all());
    expect(qc.calls).not.toContainEqual(leadKeys.detail(LEAD_ID));
  });
});
