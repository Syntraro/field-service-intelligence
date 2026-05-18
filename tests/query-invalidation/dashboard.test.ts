/**
 * Query invalidation tests — dashboard.
 *
 * Verifies that invalidateDashboard busts ALL three families:
 *   1. ["dashboard"] — semantic prefix (catches workflow, financial, today-summary)
 *   2. ["dashboard-action"] — action modal (separate prefix)
 *   3. ["/api/dashboard/capacity"] — URL-pattern key (NOT matched by semantic prefix)
 *
 * This test exists specifically because the capacity key was identified
 * in Audit #4 (F-14) as NOT being caught by the broad ["dashboard"] prefix
 * used in lifecycle mutations before this refactor.
 */
import { describe, it, expect } from "vitest";
import { dashboardKeys } from "../../client/src/lib/queryKeys/dashboard";
import { invalidateDashboard } from "../../client/src/lib/queryInvalidation/dashboard";

function makeQc() {
  const calls: unknown[][] = [];
  return {
    invalidateQueries: (opts: { queryKey: unknown }) => {
      calls.push(opts.queryKey as unknown[]);
    },
    calls,
  };
}

describe("invalidateDashboard", () => {
  it("busts the semantic family prefix", () => {
    const qc = makeQc();
    invalidateDashboard(qc as any);
    expect(qc.calls).toContainEqual(dashboardKeys.all());
  });

  it("busts the action modal key (separate prefix from dashboard family)", () => {
    const qc = makeQc();
    invalidateDashboard(qc as any);
    expect(qc.calls).toContainEqual(dashboardKeys.actionModal());
  });

  it("busts the URL-pattern capacity key (not caught by semantic prefix)", () => {
    const qc = makeQc();
    invalidateDashboard(qc as any);
    expect(qc.calls).toContainEqual(dashboardKeys.capacity());
  });

  it("covers the exact keys the FinancialDashboard and dispatch stream use", () => {
    const qc = makeQc();
    invalidateDashboard(qc as any);
    // semantic prefix catches these via prefix-matching:
    //   ["dashboard", "financial"]    — FinancialDashboard.tsx:337
    //   ["dashboard", "workflow"]     — FinancialDashboard.tsx:375
    //   ["dashboard", "today-summary"] — dispatched by SSE stream
    expect(qc.calls).toContainEqual(["dashboard"]);
    // URL-pattern key for capacity rail:
    //   ["/api/dashboard/capacity"]   — FinancialDashboard.tsx:401, QuickAddJobDialog.tsx:1568
    expect(qc.calls).toContainEqual(["/api/dashboard/capacity"]);
    // action modal:
    //   ["dashboard-action"]          — useDispatchStream.ts:73
    expect(qc.calls).toContainEqual(["dashboard-action"]);
  });
});
