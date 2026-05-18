/**
 * Unit tests for server/lib/assignmentIntelligence.ts
 *
 * Pure module — no DB required. Tests cover skill scoring, availability,
 * utilization, efficiency, overall formula, warnings/reasons, and ranking.
 */

import { describe, it, expect } from "vitest";
import { rankCandidates } from "../server/lib/assignmentIntelligence";
import type { JobRequirement, CandidateMember } from "../server/lib/assignmentIntelligence";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FUTURE = new Date(Date.now() + 90 * 86_400_000);   // 90 days from now
const SOON   = new Date(Date.now() + 15 * 86_400_000);   // 15 days — within 30-day window
const PAST   = new Date(Date.now() - 5 * 86_400_000);    // 5 days ago — expired

function makeCandidate(overrides: Partial<CandidateMember> = {}): CandidateMember {
  return {
    userId: "user-1",
    name: "Alice",
    role: "technician",
    isActive: true,
    skills: [],
    utilizationPct: 50,
    efficiencyScore: 50,
    timeOffOnDate: null,
    ...overrides,
  };
}

function makeReq(overrides: Partial<JobRequirement> = {}): JobRequirement {
  return {
    skillId: "skill-hvac",
    skillName: "HVAC",
    minimumLevel: null,
    required: true,
    ...overrides,
  };
}

// ── Helper to run one candidate through rankCandidates ─────────────────────

function score(reqs: JobRequirement[], candidate: CandidateMember) {
  const results = rankCandidates(reqs, [candidate]);
  return results[0];
}

// ── Skill scoring ─────────────────────────────────────────────────────────────

describe("skill scoring", () => {
  it("no requirements → skillScore 100, full match", () => {
    const rec = score([], makeCandidate());
    expect(rec.matchScore).toBe(Math.round(100 * 0.40 + 100 * 0.30 + 50 * 0.20 + 50 * 0.10));
    expect(rec.totalRequiredSkills).toBe(0);
    expect(rec.skillMatchCount).toBe(0);
  });

  it("has matching skill at any level when minimumLevel is null → full points", () => {
    const candidate = makeCandidate({
      skills: [{ skillId: "skill-hvac", level: "basic", isActive: true, certificationExpiresAt: null, certificationName: null }],
      utilizationPct: 0,
      efficiencyScore: 100,
    });
    const rec = score([makeReq({ minimumLevel: null })], candidate);
    expect(rec.skillMatchCount).toBe(1);
    expect(rec.skillPartialCount).toBe(0);
    // skillScore=100, avail=100, util=100, eff=100 → matchScore=100
    expect(rec.matchScore).toBe(100);
  });

  it("has skill but level too low → 50 pts (partial)", () => {
    const candidate = makeCandidate({
      skills: [{ skillId: "skill-hvac", level: "basic", isActive: true, certificationExpiresAt: null, certificationName: null }],
      utilizationPct: 0,
      efficiencyScore: 100,
    });
    const rec = score([makeReq({ minimumLevel: "advanced" })], candidate);
    expect(rec.skillMatchCount).toBe(0);
    expect(rec.skillPartialCount).toBe(1);
    // skillScore=50, avail=100, util=100, eff=100
    expect(rec.matchScore).toBe(Math.round(50 * 0.40 + 100 * 0.30 + 100 * 0.20 + 100 * 0.10));
  });

  it("meets minimum level exactly → full points", () => {
    const candidate = makeCandidate({
      skills: [{ skillId: "skill-hvac", level: "advanced", isActive: true, certificationExpiresAt: null, certificationName: null }],
    });
    const rec = score([makeReq({ minimumLevel: "advanced" })], candidate);
    expect(rec.skillMatchCount).toBe(1);
    expect(rec.skillPartialCount).toBe(0);
  });

  it("level exceeds minimum → full points", () => {
    const candidate = makeCandidate({
      skills: [{ skillId: "skill-hvac", level: "certified", isActive: true, certificationExpiresAt: null, certificationName: null }],
    });
    const rec = score([makeReq({ minimumLevel: "basic" })], candidate);
    expect(rec.skillMatchCount).toBe(1);
    expect(rec.skillPartialCount).toBe(0);
  });

  it("missing required skill → 0 pts, warning emitted", () => {
    const candidate = makeCandidate({ skills: [] });
    const rec = score([makeReq({ skillName: "Boiler Repair" })], candidate);
    expect(rec.skillMatchCount).toBe(0);
    expect(rec.skillPartialCount).toBe(0);
    expect(rec.warnings.some((w) => w.includes("Missing required skill: Boiler Repair"))).toBe(true);
  });

  it("expired certification → 25 pts, warning emitted", () => {
    const candidate = makeCandidate({
      skills: [{ skillId: "skill-hvac", level: "certified", isActive: true, certificationExpiresAt: PAST, certificationName: "EPA 608" }],
      utilizationPct: 0,
      efficiencyScore: 100,
    });
    const rec = score([makeReq()], candidate);
    expect(rec.skillMatchCount).toBe(0);
    expect(rec.skillPartialCount).toBe(1);
    expect(rec.warnings.some((w) => w.includes("expired"))).toBe(true);
    // skillScore=25, avail=100, util=100, eff=100
    expect(rec.matchScore).toBe(Math.round(25 * 0.40 + 100 * 0.30 + 100 * 0.20 + 100 * 0.10));
  });

  it("expiring soon cert → still 100 pts (levelMet), but warning for expiry", () => {
    const candidate = makeCandidate({
      skills: [{ skillId: "skill-hvac", level: "certified", isActive: true, certificationExpiresAt: SOON, certificationName: "EPA 608" }],
    });
    const rec = score([makeReq()], candidate);
    expect(rec.skillMatchCount).toBe(1);
    expect(rec.skillPartialCount).toBe(0);
    expect(rec.warnings.some((w) => w.includes("expires in"))).toBe(true);
  });

  it("inactive skill is ignored → treated as missing", () => {
    const candidate = makeCandidate({
      skills: [{ skillId: "skill-hvac", level: "certified", isActive: false, certificationExpiresAt: null, certificationName: null }],
    });
    const rec = score([makeReq()], candidate);
    expect(rec.skillMatchCount).toBe(0);
  });
});

// ── Multi-skill jobs ──────────────────────────────────────────────────────────

describe("multi-skill jobs", () => {
  const reqs: JobRequirement[] = [
    { skillId: "sk-1", skillName: "HVAC", minimumLevel: "intermediate", required: true },
    { skillId: "sk-2", skillName: "Electrical", minimumLevel: null, required: true },
    { skillId: "sk-3", skillName: "Plumbing", minimumLevel: null, required: false },
  ];

  it("all skills met → matchCount=2 (only required count), skillScore=100", () => {
    const candidate = makeCandidate({
      skills: [
        { skillId: "sk-1", level: "advanced", isActive: true, certificationExpiresAt: null, certificationName: null },
        { skillId: "sk-2", level: "basic", isActive: true, certificationExpiresAt: null, certificationName: null },
        { skillId: "sk-3", level: "basic", isActive: true, certificationExpiresAt: null, certificationName: null },
      ],
      utilizationPct: 0,
      efficiencyScore: 100,
    });
    const rec = score(reqs, candidate);
    // All 3 required skills fully met → skillScore avg = (100+100+100)/3 = 100
    expect(rec.skillMatchCount).toBe(3);
    expect(rec.totalRequiredSkills).toBe(3);
    expect(rec.matchScore).toBe(100);
  });

  it("partial skill coverage → weighted average of skill scores", () => {
    const candidate = makeCandidate({
      skills: [
        // sk-1: has but level too low (basic, need intermediate) → 50
        { skillId: "sk-1", level: "basic", isActive: true, certificationExpiresAt: null, certificationName: null },
        // sk-2: missing → 0
        // sk-3: missing (not required) → 0
      ],
      utilizationPct: 0,
      efficiencyScore: 100,
    });
    const rec = score(reqs, candidate);
    // skillScore = avg(50, 0, 0) = 17 (rounded from 16.67)
    const expectedSkillScore = Math.round((50 + 0 + 0) / 3);
    expect(rec.matchScore).toBe(
      Math.round(expectedSkillScore * 0.40 + 100 * 0.30 + 100 * 0.20 + 100 * 0.10),
    );
  });
});

// ── Availability scoring ──────────────────────────────────────────────────────

describe("availability scoring", () => {
  it("on time-off → availabilityScore 0, warning emitted, timeOffConflict set", () => {
    const tof = { reason: "sick_leave", startsAt: new Date(), endsAt: new Date() };
    const candidate = makeCandidate({ timeOffOnDate: tof, utilizationPct: 0, efficiencyScore: 100 });
    const rec = score([], candidate);
    expect(rec.isAvailable).toBe(false);
    expect(rec.timeOffConflict).not.toBeNull();
    expect(rec.warnings.some((w) => w.includes("time-off"))).toBe(true);
    // skillScore=100 (no reqs), avail=0, util=100, eff=100
    expect(rec.matchScore).toBe(Math.round(100 * 0.40 + 0 * 0.30 + 100 * 0.20 + 100 * 0.10));
  });

  it("available → availabilityScore 100, reason emitted", () => {
    const candidate = makeCandidate({ timeOffOnDate: null });
    const rec = score([], candidate);
    expect(rec.isAvailable).toBe(true);
    expect(rec.timeOffConflict).toBeNull();
    expect(rec.reasons.some((r) => r.includes("Available"))).toBe(true);
  });
});

// ── Utilization scoring ───────────────────────────────────────────────────────

describe("utilization scoring", () => {
  it("null utilization → utilizationScore 50", () => {
    const candidate = makeCandidate({ utilizationPct: null, efficiencyScore: 100 });
    const rec = score([], candidate);
    // skillScore=100, avail=100, util=50, eff=100
    expect(rec.matchScore).toBe(Math.round(100 * 0.40 + 100 * 0.30 + 50 * 0.20 + 100 * 0.10));
  });

  it("0% utilization → utilizationScore 100, low-workload reason", () => {
    const candidate = makeCandidate({ utilizationPct: 0, efficiencyScore: 100 });
    const rec = score([], candidate);
    expect(rec.matchScore).toBe(100);
    expect(rec.reasons.some((r) => r.includes("workload"))).toBe(true);
  });

  it("50% utilization → utilizationScore 50", () => {
    const candidate = makeCandidate({ utilizationPct: 50, efficiencyScore: 100 });
    const rec = score([], candidate);
    // skillScore=100, avail=100, util=50, eff=100
    expect(rec.matchScore).toBe(Math.round(100 * 0.40 + 100 * 0.30 + 50 * 0.20 + 100 * 0.10));
  });

  it("85% utilization → utilizationScore 15, high-utilization warning", () => {
    const candidate = makeCandidate({ utilizationPct: 85, efficiencyScore: 100 });
    const rec = score([], candidate);
    expect(rec.warnings.some((w) => w.includes("High utilization"))).toBe(true);
    // skillScore=100, avail=100, util=15, eff=100
    expect(rec.matchScore).toBe(Math.round(100 * 0.40 + 100 * 0.30 + 15 * 0.20 + 100 * 0.10));
  });

  it("100% utilization → utilizationScore 0", () => {
    const candidate = makeCandidate({ utilizationPct: 100, efficiencyScore: 100 });
    const rec = score([], candidate);
    // skillScore=100, avail=100, util=0, eff=100
    expect(rec.matchScore).toBe(Math.round(100 * 0.40 + 100 * 0.30 + 0 * 0.20 + 100 * 0.10));
  });
});

// ── Efficiency score ─────────────────────────────────────────────────────────

describe("efficiency score", () => {
  it("null efficiency → defaults to 50", () => {
    const a = makeCandidate({ efficiencyScore: null, utilizationPct: 0 });
    const b = makeCandidate({ efficiencyScore: 50, utilizationPct: 0 });
    const recA = score([], a);
    const recB = score([], b);
    expect(recA.matchScore).toBe(recB.matchScore);
  });

  it("high efficiency (100) vs low (0) changes matchScore by 10pts", () => {
    const high = makeCandidate({ efficiencyScore: 100, utilizationPct: 0 });
    const low  = makeCandidate({ efficiencyScore: 0,   utilizationPct: 0 });
    const recH = score([], high);
    const recL = score([], low);
    // weight=0.10 → 100pts diff × 0.10 = 10
    expect(recH.matchScore - recL.matchScore).toBe(10);
  });
});

// ── Overall formula ───────────────────────────────────────────────────────────

describe("overall formula", () => {
  it("worst case: missing all skills, on time-off, max utilization, zero efficiency", () => {
    const candidate = makeCandidate({
      skills: [],
      timeOffOnDate: { reason: "vacation", startsAt: new Date(), endsAt: new Date() },
      utilizationPct: 100,
      efficiencyScore: 0,
    });
    const req = makeReq();
    const rec = score([req], candidate);
    // skillScore=0, avail=0, util=0, eff=0
    expect(rec.matchScore).toBe(0);
  });

  it("best case: all skills met, available, 0% utilization, 100 efficiency", () => {
    const candidate = makeCandidate({
      skills: [{ skillId: "skill-hvac", level: "certified", isActive: true, certificationExpiresAt: null, certificationName: null }],
      timeOffOnDate: null,
      utilizationPct: 0,
      efficiencyScore: 100,
    });
    const rec = score([makeReq()], candidate);
    expect(rec.matchScore).toBe(100);
  });
});

// ── Ranking ───────────────────────────────────────────────────────────────────

describe("ranking", () => {
  it("returns candidates sorted descending by matchScore", () => {
    const skillReq = makeReq();
    const best = makeCandidate({ userId: "u-best", name: "Best", utilizationPct: 0, efficiencyScore: 100,
      skills: [{ skillId: "skill-hvac", level: "certified", isActive: true, certificationExpiresAt: null, certificationName: null }] });
    const mid = makeCandidate({ userId: "u-mid", name: "Mid", utilizationPct: 50, efficiencyScore: 50,
      skills: [{ skillId: "skill-hvac", level: "certified", isActive: true, certificationExpiresAt: null, certificationName: null }] });
    const worst = makeCandidate({ userId: "u-worst", name: "Worst", timeOffOnDate: { reason: "vacation", startsAt: new Date(), endsAt: new Date() },
      utilizationPct: 100, efficiencyScore: 0, skills: [] });

    const results = rankCandidates([skillReq], [worst, mid, best]);
    expect(results[0].userId).toBe("u-best");
    expect(results[1].userId).toBe("u-mid");
    expect(results[2].userId).toBe("u-worst");
  });

  it("inactive candidates are excluded", () => {
    const inactive = makeCandidate({ userId: "u-inactive", isActive: false });
    const active   = makeCandidate({ userId: "u-active",   isActive: true  });
    const results  = rankCandidates([], [inactive, active]);
    expect(results).toHaveLength(1);
    expect(results[0].userId).toBe("u-active");
  });

  it("empty candidate list returns empty array", () => {
    expect(rankCandidates([makeReq()], [])).toHaveLength(0);
  });

  it("equal scores preserve stable relative ordering from input", () => {
    const a = makeCandidate({ userId: "a", utilizationPct: 50, efficiencyScore: 50 });
    const b = makeCandidate({ userId: "b", utilizationPct: 50, efficiencyScore: 50 });
    const results = rankCandidates([], [a, b]);
    expect(results[0].userId).toBe("a");
    expect(results[1].userId).toBe("b");
  });
});

// ── Skill match details ───────────────────────────────────────────────────────

describe("skillMatchDetails", () => {
  it("emits one detail per requirement with correct fields", () => {
    const candidate = makeCandidate({
      skills: [{ skillId: "skill-hvac", level: "advanced", isActive: true, certificationExpiresAt: FUTURE, certificationName: "EPA 608" }],
    });
    const req = makeReq({ minimumLevel: "intermediate" });
    const rec = score([req], candidate);
    expect(rec.skillMatchDetails).toHaveLength(1);
    const detail = rec.skillMatchDetails[0];
    expect(detail.levelMet).toBe(true);
    expect(detail.memberLevel).toBe("advanced");
    expect(detail.expiryStatus).toBe("valid");
    expect(detail.certificationName).toBe("EPA 608");
  });

  it("missing skill produces null memberLevel and levelMet=false", () => {
    const candidate = makeCandidate({ skills: [] });
    const rec = score([makeReq()], candidate);
    const detail = rec.skillMatchDetails[0];
    expect(detail.memberLevel).toBeNull();
    expect(detail.levelMet).toBe(false);
    expect(detail.expiryStatus).toBeNull();
  });
});
