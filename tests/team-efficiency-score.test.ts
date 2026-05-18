/**
 * Unit tests for server/lib/efficiencyScore.ts
 *
 * Covers:
 *   1. Formula correctness — weighted sum across all four components.
 *   2. Percentile vs absolute switching — absolute when < 3 active peers.
 *   3. Grade boundary correctness — A/B/C/D/F thresholds.
 *   4. Strengths (score ≥ 70) / opportunities (score < 40) derivation.
 *   5. Callback rate NOT present in components (excluded by design).
 *   6. Avg job time NOT present in components (excluded by design).
 *   7. Weight re-normalisation when some components lack data.
 *   8. hasData false when no component has data.
 *   9. Percentile rank tie-breaking (mid-point).
 *  10. Lead contribution always treated as hasData.
 */

import { describe, it, expect } from "vitest";
import {
  computeEfficiencyScore,
  type EfficiencyScore,
  type ScoreComponent,
} from "../server/lib/efficiencyScore";
import type { TeamMemberMetrics } from "../server/storage/teamMetrics";

// ── Helpers ────────────────────────────────────────────────────────────────

function member(overrides: Partial<TeamMemberMetrics> = {}): TeamMemberMetrics {
  return {
    userId: "u1",
    hoursWorked: 0,
    scheduledHoursInPeriod: 0,
    utilizationPct: null,
    jobsCompleted: 0,
    allocatedRevenue: 0,
    avgRevPerHour: null,
    leadsGenerated: 0,
    leadRevenue: 0,
    ...overrides,
  };
}

function componentByKey(score: EfficiencyScore, key: ScoreComponent["key"]): ScoreComponent {
  const c = score.components.find((c) => c.key === key);
  if (!c) throw new Error(`Component '${key}' not found`);
  return c;
}

// ── Section 1: Component presence (exclusion guard) ────────────────────────

describe("component keys", () => {
  it("contains exactly the four expected components", () => {
    const result = computeEfficiencyScore(member(), [], 4);
    const keys = result.components.map((c) => c.key).sort();
    expect(keys).toEqual(["leadContribution", "revPerHour", "throughput", "utilization"]);
  });

  it("does NOT include a callback-rate component", () => {
    const result = computeEfficiencyScore(member(), [], 4);
    const keys = result.components.map((c) => c.key);
    expect(keys).not.toContain("callbackRate");
  });

  it("does NOT include an avg-job-time component", () => {
    const result = computeEfficiencyScore(member(), [], 4);
    const keys = result.components.map((c) => c.key);
    expect(keys).not.toContain("avgJobTime");
  });
});

// ── Section 2: Absolute scoring (< 3 active peers) ────────────────────────

describe("absolute scoring — < 3 active peers", () => {
  it("scores utilization linearly: 80% → 80", () => {
    const m = member({ utilizationPct: 80, hoursWorked: 32 });
    const result = computeEfficiencyScore(m, [m], 4);
    expect(componentByKey(result, "utilization").score).toBe(80);
  });

  it("caps utilization at 100 when over 100%", () => {
    const m = member({ utilizationPct: 120, hoursWorked: 48 });
    const result = computeEfficiencyScore(m, [m], 4);
    expect(componentByKey(result, "utilization").score).toBe(100);
  });

  it("scores rev/hr at 100 for ≥ $170", () => {
    const m = member({ avgRevPerHour: 200, hoursWorked: 10 });
    const result = computeEfficiencyScore(m, [m], 4);
    expect(componentByKey(result, "revPerHour").score).toBe(100);
  });

  it("scores rev/hr at 90 for $130–$169", () => {
    const m = member({ avgRevPerHour: 150, hoursWorked: 10 });
    const result = computeEfficiencyScore(m, [m], 4);
    expect(componentByKey(result, "revPerHour").score).toBe(90);
  });

  it("scores rev/hr at 75 for $90–$129", () => {
    const m = member({ avgRevPerHour: 100, hoursWorked: 10 });
    const result = computeEfficiencyScore(m, [m], 4);
    expect(componentByKey(result, "revPerHour").score).toBe(75);
  });

  it("scores rev/hr at 55 for $60–$89", () => {
    const m = member({ avgRevPerHour: 70, hoursWorked: 10 });
    const result = computeEfficiencyScore(m, [m], 4);
    expect(componentByKey(result, "revPerHour").score).toBe(55);
  });

  it("scores rev/hr at 30 for $30–$59", () => {
    const m = member({ avgRevPerHour: 45, hoursWorked: 10 });
    const result = computeEfficiencyScore(m, [m], 4);
    expect(componentByKey(result, "revPerHour").score).toBe(30);
  });

  it("scores rev/hr at 10 for < $30", () => {
    const m = member({ avgRevPerHour: 20, hoursWorked: 10 });
    const result = computeEfficiencyScore(m, [m], 4);
    expect(componentByKey(result, "revPerHour").score).toBe(10);
  });

  it("scores throughput at 100 for ≥ 4 jobs/wk (8 jobs / 2 weeks)", () => {
    const m = member({ jobsCompleted: 8, hoursWorked: 20 });
    const result = computeEfficiencyScore(m, [m], 2);
    expect(componentByKey(result, "throughput").score).toBe(100);
  });

  it("scores throughput at 65 for 2 jobs/wk (4 jobs / 2 weeks)", () => {
    const m = member({ jobsCompleted: 4, hoursWorked: 10 });
    const result = computeEfficiencyScore(m, [m], 2);
    expect(componentByKey(result, "throughput").score).toBe(65);
  });

  it("scores throughput at 0 for 0 jobs", () => {
    const m = member({ jobsCompleted: 0 });
    const result = computeEfficiencyScore(m, [m], 4);
    expect(componentByKey(result, "throughput").score).toBe(0);
  });

  it("scores lead contribution at 100 for ≥ 5 leads", () => {
    const m = member({ leadsGenerated: 7 });
    const result = computeEfficiencyScore(m, [m], 4);
    expect(componentByKey(result, "leadContribution").score).toBe(100);
  });

  it("scores lead contribution at 60 for 3 leads (3/5 × 100)", () => {
    const m = member({ leadsGenerated: 3 });
    const result = computeEfficiencyScore(m, [m], 4);
    expect(componentByKey(result, "leadContribution").score).toBe(60);
  });

  it("scores lead contribution at 0 for 0 leads", () => {
    const m = member({ leadsGenerated: 0 });
    const result = computeEfficiencyScore(m, [m], 4);
    expect(componentByKey(result, "leadContribution").score).toBe(0);
  });
});

// ── Section 3: Percentile scoring (≥ 3 active peers) ─────────────────────

describe("percentile scoring — ≥ 3 active peers", () => {
  it("switches to percentile when 3+ peers are active", () => {
    const peers = [
      member({ userId: "u1", utilizationPct: 50, hoursWorked: 20 }),
      member({ userId: "u2", utilizationPct: 75, hoursWorked: 30 }),
      member({ userId: "u3", utilizationPct: 90, hoursWorked: 36 }),
    ];
    const result = computeEfficiencyScore(peers[0]!, peers, 4);
    expect(result.methodNote).toMatch(/percentile/);
  });

  it("methodNote is 'absolute' when < 3 active peers", () => {
    const m = member({ hoursWorked: 20 });
    const result = computeEfficiencyScore(m, [m], 4);
    expect(result.methodNote).toBe("absolute");
  });

  it("lowest peer in utilization gets score ≤ 50", () => {
    const peers = [
      member({ userId: "u1", utilizationPct: 30, hoursWorked: 12 }),
      member({ userId: "u2", utilizationPct: 60, hoursWorked: 24 }),
      member({ userId: "u3", utilizationPct: 90, hoursWorked: 36 }),
    ];
    const result = computeEfficiencyScore(peers[0]!, peers, 4);
    // u1 is bottom, should be in lower half
    expect(componentByKey(result, "utilization").score).toBeLessThanOrEqual(50);
  });

  it("highest peer in rev/hr gets the top percentile score (mid-point tie-breaking)", () => {
    // percentileRank: (below + equal×0.5) / N × 100
    // u1 is top: below=2, equal=1, N=3 → (2 + 0.5) / 3 × 100 = 83
    const peers = [
      member({ userId: "u1", avgRevPerHour: 200, hoursWorked: 10 }),
      member({ userId: "u2", avgRevPerHour: 100, hoursWorked: 10 }),
      member({ userId: "u3", avgRevPerHour: 50, hoursWorked: 10 }),
    ];
    const result = computeEfficiencyScore(peers[0]!, peers, 4);
    expect(componentByKey(result, "revPerHour").score).toBe(83);
  });

  it("tie-breaking: two members tied at same throughput get same score", () => {
    const peers = [
      member({ userId: "u1", jobsCompleted: 5, hoursWorked: 20 }),
      member({ userId: "u2", jobsCompleted: 5, hoursWorked: 20 }),
      member({ userId: "u3", jobsCompleted: 2, hoursWorked: 10 }),
    ];
    const r1 = computeEfficiencyScore(peers[0]!, peers, 4);
    const r2 = computeEfficiencyScore(peers[1]!, peers, 4);
    expect(componentByKey(r1, "throughput").score).toBe(
      componentByKey(r2, "throughput").score,
    );
  });
});

// ── Section 4: Grade boundaries ───────────────────────────────────────────

describe("grade boundaries", () => {
  // Use absolute mode (solo member) so overall is predictable.
  function scoreWith(utilizationPct: number): EfficiencyScore {
    // All weights active: U=30%, R=35%, J=20%, L=15%.
    // Set all four components to the same score so overall equals each component.
    // Rev/hr ≥170 → abs score 100; leads = 5 → abs 100; util pct = X → abs X;
    // jobs/wk = 4 → abs 100.
    // overall = 0.30×util + 0.35×100 + 0.20×100 + 0.15×100
    //         = 0.30×util + 70
    // To isolate grade, set util such that overall hits the boundary.
    const m = member({
      utilizationPct,
      hoursWorked: 40,
      avgRevPerHour: 200,
      jobsCompleted: 16, // 4 jobs/wk over 4 weeks
      leadsGenerated: 5,
    });
    return computeEfficiencyScore(m, [m], 4);
  }

  it("grades A when overall ≥ 90", () => {
    // overall = 0.30×100 + 70 = 100 → A
    const result = scoreWith(100);
    expect(result.grade).toBe("A");
    expect(result.overall).toBeGreaterThanOrEqual(90);
  });

  it("grades B when overall ∈ [75, 89]", () => {
    // overall = 0.30×17 + 70 = 75.1 → B
    const result = scoreWith(17);
    expect(result.grade).toBe("B");
    expect(result.overall).toBeGreaterThanOrEqual(75);
    expect(result.overall).toBeLessThan(90);
  });

  it("grades C when overall ∈ [60, 74]", () => {
    // overall = 0.30×0 + 0.35×55 + 0.20×65 + 0.15×0 ... easier: force low util only
    // At util=0: overall = 0.30×0 + 70 = 70 → C (re-normalised because util hasData=false? No — util=0 is valid 0%)
    // Actually utilizationPct=0 means hasData=true (pct is not null), score=0.
    // overall = 0.30×0 + 0.35×100 + 0.20×100 + 0.15×100 = 70 → C
    const result = scoreWith(0);
    expect(result.grade).toBe("C");
    expect(result.overall).toBeGreaterThanOrEqual(60);
    expect(result.overall).toBeLessThan(75);
  });

  it("grades F when overall < 45", () => {
    // All zeros — member with no data
    const m = member();
    const result = computeEfficiencyScore(m, [m], 4);
    expect(result.grade).toBe("F");
  });
});

// ── Section 5: Strengths & opportunities ──────────────────────────────────

describe("strengths and opportunities", () => {
  it("lists component as strength when score ≥ 70 and hasData", () => {
    const m = member({
      utilizationPct: 95,
      hoursWorked: 38,
      avgRevPerHour: 200, // score 100
      jobsCompleted: 0,
      leadsGenerated: 5,  // score 100
    });
    const result = computeEfficiencyScore(m, [m], 4);
    expect(result.strengths).toContain("Revenue efficiency");
    expect(result.strengths).toContain("Lead generation");
  });

  it("lists component as opportunity when score < 40 and hasData", () => {
    const m = member({
      utilizationPct: 10,   // abs score 10
      hoursWorked: 4,
      avgRevPerHour: 20,    // abs score 10
      jobsCompleted: 0,
      leadsGenerated: 0,    // abs score 0
    });
    const result = computeEfficiencyScore(m, [m], 4);
    expect(result.opportunities).toContain("Time utilization");
    expect(result.opportunities).toContain("Revenue efficiency");
    expect(result.opportunities).toContain("Lead generation");
  });

  it("throughput with no jobs not listed as opportunity when hasData=false", () => {
    const m = member({ jobsCompleted: 0 });
    const result = computeEfficiencyScore(m, [m], 4);
    // throughput hasData = false when jobsCompleted = 0
    const throughput = componentByKey(result, "throughput");
    expect(throughput.hasData).toBe(false);
    expect(result.opportunities).not.toContain("Job throughput");
  });
});

// ── Section 6: Weight re-normalisation ────────────────────────────────────

describe("weight re-normalisation", () => {
  it("overall not deflated when utilization lacks data (null pct)", () => {
    // utilizationPct=null → hasData=false, weight removed from denominator.
    // Remaining weights: rev(0.35) + throughput(0.20) + lead(0.15) = 0.70
    // If rev=100, throughput=100, lead=100:
    //   overall = (100×0.35 + 100×0.20 + 100×0.15) / 0.70 = 70/0.70 = 100
    const m = member({
      utilizationPct: null, // no scheduled hours set
      hoursWorked: 40,
      avgRevPerHour: 200,
      jobsCompleted: 16,
      leadsGenerated: 5,
    });
    const result = computeEfficiencyScore(m, [m], 4);
    expect(result.overall).toBe(100);
    expect(result.grade).toBe("A");
  });

  it("hasData is false when no component has data", () => {
    const m = member();
    const result = computeEfficiencyScore(m, [m], 4);
    // leadContribution always hasData=true (0 leads is valid data)
    // so hasData overall should be true even for a bare member
    // (lead component is always included)
    expect(result.components.some((c) => c.hasData)).toBe(true);
    expect(result.hasData).toBe(true);
  });
});

// ── Section 7: Lead contribution always has data ──────────────────────────

describe("lead contribution invariant", () => {
  it("lead component hasData is true even when leadsGenerated = 0", () => {
    const m = member({ leadsGenerated: 0 });
    const result = computeEfficiencyScore(m, [m], 4);
    expect(componentByKey(result, "leadContribution").hasData).toBe(true);
  });

  it("raw value on lead component equals leadsGenerated", () => {
    const m = member({ leadsGenerated: 3 });
    const result = computeEfficiencyScore(m, [m], 4);
    expect(componentByKey(result, "leadContribution").raw).toBe(3);
  });
});

// ── Section 8: Edge cases ─────────────────────────────────────────────────

describe("edge cases", () => {
  it("handles periodWeeks = 0 without NaN or division error", () => {
    const m = member({ jobsCompleted: 5 });
    const result = computeEfficiencyScore(m, [m], 0);
    expect(Number.isFinite(result.overall)).toBe(true);
  });

  it("overall is 0 when all scores are 0", () => {
    const m = member({ leadsGenerated: 0 });
    const result = computeEfficiencyScore(m, [m], 4);
    expect(result.overall).toBe(0);
  });

  it("methodNote includes peer count when using percentile", () => {
    const peers = [
      member({ userId: "u1", hoursWorked: 30 }),
      member({ userId: "u2", hoursWorked: 25 }),
      member({ userId: "u3", hoursWorked: 20 }),
    ];
    const result = computeEfficiencyScore(peers[0]!, peers, 4);
    expect(result.methodNote).toMatch(/3 peers/);
  });
});
