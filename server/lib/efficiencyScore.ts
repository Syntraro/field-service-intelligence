/**
 * Efficiency score engine — pure module, no DB access.
 *
 * Computes a 0-100 efficiency score for a team member relative to their
 * peers in the same company/period. When fewer than 3 peers have data for
 * a component, absolute benchmarks are used instead so a sole technician
 * still gets a meaningful score.
 *
 * Formula (Phase 2):
 *   Score = U×0.30 + R×0.35 + J×0.20 + L×0.15
 *
 *   U = utilization component   (% of scheduled hours actually worked)
 *   R = rev/hr component        (allocated revenue ÷ hours worked)
 *   J = throughput component    (jobs completed ÷ period weeks)
 *   L = lead contribution       (leads generated in period)
 *
 * Deliberately excluded:
 *   - Callback rate: no reliable callback designation exists in the
 *     schema. `job_visits.outcome = "needs_followup"` / `isFollowUpNeeded`
 *     are follow-up *intent* flags, not defective-work callbacks. Including
 *     them would penalise technicians for legitimate scheduled follow-ups
 *     (parts arrivals, multi-visit jobs). See CLAUDE.md §Callback gate.
 *   - Average job time: HVAC job complexity varies 20 min → 8 hrs. Scoring
 *     shorter-is-better without job-type stratification creates perverse
 *     incentives (rush through complex jobs). Will add in Phase 4 when
 *     job-type context is available.
 *   - Customer satisfaction: no rating field in current schema.
 *
 * Scoring method:
 *   1. Percentile rank when ≥ 3 peers have non-zero data (natural benchmark).
 *   2. Absolute thresholds when < 3 peers (solo technician or new company).
 *
 * Grade mapping: A ≥ 90 | B ≥ 75 | C ≥ 60 | D ≥ 45 | F < 45
 */

import type { TeamMemberMetrics } from "../storage/teamMetrics";

export interface ScoreComponent {
  key: "utilization" | "revPerHour" | "throughput" | "leadContribution";
  label: string;
  score: number;      // 0-100
  hasData: boolean;
  raw: number | null; // actual metric value (for display)
  unit: string;       // display suffix e.g. "%" "$" "jobs/wk" "leads"
}

export type Grade = "A" | "B" | "C" | "D" | "F";

export interface EfficiencyScore {
  overall: number;
  grade: Grade;
  components: ScoreComponent[];
  strengths: string[];
  opportunities: string[];
  hasData: boolean;
  methodNote: string; // "percentile (N peers)" | "absolute"
}

const WEIGHTS = {
  utilization: 0.30,
  revPerHour: 0.35,
  throughput: 0.20,
  leadContribution: 0.15,
} as const;

function gradeFrom(score: number): Grade {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 45) return "D";
  return "F";
}

/** Percentile rank of `value` within `population` (higher is better).
 *  Returns 0-100. Ties are counted as equal rank. */
function percentileRank(value: number, population: number[]): number {
  const valid = population.filter((v) => v > 0);
  if (valid.length === 0) return 0;
  const below = valid.filter((v) => v < value).length;
  const equal = valid.filter((v) => v === value).length;
  // Mid-point of the equal band so ties share the same percentile
  return Math.round(((below + equal * 0.5) / valid.length) * 100);
}

/** Absolute utilization score: linear 0-100% maps to 0-100. */
function absoluteUtilScore(pct: number): number {
  return Math.min(100, Math.max(0, Math.round(pct)));
}

/** Absolute rev/hr score using HVAC-anchored breakpoints.
 *  <$30 → 10, $30-60 → 30, $60-90 → 55, $90-130 → 75, $130-170 → 90, ≥$170 → 100 */
function absoluteRevHrScore(rph: number): number {
  if (rph >= 170) return 100;
  if (rph >= 130) return 90;
  if (rph >= 90) return 75;
  if (rph >= 60) return 55;
  if (rph >= 30) return 30;
  return 10;
}

/** Absolute throughput score: jobs/week.
 *  0 → 0, 0.5 → 20, 1 → 40, 2 → 65, 3 → 85, ≥4 → 100 */
function absoluteThroughputScore(jobsPerWeek: number): number {
  if (jobsPerWeek >= 4) return 100;
  if (jobsPerWeek >= 3) return 85;
  if (jobsPerWeek >= 2) return 65;
  if (jobsPerWeek >= 1) return 40;
  if (jobsPerWeek >= 0.5) return 20;
  return 0;
}

/** Absolute lead contribution score: flat points per lead, capped at 100. */
function absoluteLeadScore(leads: number): number {
  if (leads === 0) return 0;
  if (leads >= 5) return 100;
  return Math.round((leads / 5) * 100);
}

export function computeEfficiencyScore(
  member: TeamMemberMetrics,
  allMembers: TeamMemberMetrics[],
  periodWeeks: number,
): EfficiencyScore {
  // Only non-zero peers count toward percentile ranking
  const activeMembers = allMembers.filter(
    (m) => m.hoursWorked > 0 || m.jobsCompleted > 0,
  );
  const usePercentile = activeMembers.length >= 3;
  const methodNote = usePercentile
    ? `percentile (${activeMembers.length} peers)`
    : "absolute";

  // ── Component 1: Utilization ────────────────────────────────────────────
  const utilHasData = member.utilizationPct !== null;
  let utilScore = 0;
  if (utilHasData && member.utilizationPct !== null) {
    if (usePercentile) {
      const pop = activeMembers
        .filter((m) => m.utilizationPct !== null)
        .map((m) => m.utilizationPct as number);
      utilScore = pop.length >= 3
        ? percentileRank(member.utilizationPct, pop)
        : absoluteUtilScore(member.utilizationPct);
    } else {
      utilScore = absoluteUtilScore(member.utilizationPct);
    }
  }

  // ── Component 2: Revenue per hour ───────────────────────────────────────
  const revHasData = member.avgRevPerHour !== null && member.avgRevPerHour > 0;
  let revScore = 0;
  if (revHasData && member.avgRevPerHour !== null) {
    if (usePercentile) {
      const pop = activeMembers
        .filter((m) => m.avgRevPerHour !== null && m.avgRevPerHour > 0)
        .map((m) => m.avgRevPerHour as number);
      revScore = pop.length >= 3
        ? percentileRank(member.avgRevPerHour, pop)
        : absoluteRevHrScore(member.avgRevPerHour);
    } else {
      revScore = absoluteRevHrScore(member.avgRevPerHour);
    }
  }

  // ── Component 3: Job throughput ─────────────────────────────────────────
  const jobsPerWeek = periodWeeks > 0 ? member.jobsCompleted / periodWeeks : 0;
  const throughputHasData = member.jobsCompleted > 0;
  let throughputScore = 0;
  if (throughputHasData) {
    if (usePercentile) {
      const pop = activeMembers
        .filter((m) => m.jobsCompleted > 0)
        .map((m) => (periodWeeks > 0 ? m.jobsCompleted / periodWeeks : 0));
      throughputScore = pop.length >= 3
        ? percentileRank(jobsPerWeek, pop)
        : absoluteThroughputScore(jobsPerWeek);
    } else {
      throughputScore = absoluteThroughputScore(jobsPerWeek);
    }
  }

  // ── Component 4: Lead contribution ──────────────────────────────────────
  // Leads are always "has data" (0 leads = has data, just not contributing)
  const leadHasData = true;
  let leadScore = 0;
  if (usePercentile) {
    const pop = allMembers.map((m) => m.leadsGenerated);
    leadScore = percentileRank(member.leadsGenerated, pop);
  } else {
    leadScore = absoluteLeadScore(member.leadsGenerated);
  }

  // ── Weighted overall score ──────────────────────────────────────────────
  // Only include components that have data in the weighted sum, and
  // re-normalise the remaining weights so they sum to 1.
  const componentDefs: {
    key: ScoreComponent["key"];
    label: string;
    score: number;
    hasData: boolean;
    raw: number | null;
    unit: string;
    weight: number;
  }[] = [
    {
      key: "utilization",
      label: "Time utilization",
      score: utilScore,
      hasData: utilHasData,
      raw: member.utilizationPct,
      unit: "%",
      weight: WEIGHTS.utilization,
    },
    {
      key: "revPerHour",
      label: "Revenue efficiency",
      score: revScore,
      hasData: revHasData,
      raw: member.avgRevPerHour,
      unit: "$/hr",
      weight: WEIGHTS.revPerHour,
    },
    {
      key: "throughput",
      label: "Job throughput",
      score: throughputScore,
      hasData: throughputHasData,
      raw: Math.round(jobsPerWeek * 100) / 100,
      unit: "jobs/wk",
      weight: WEIGHTS.throughput,
    },
    {
      key: "leadContribution",
      label: "Lead generation",
      score: leadScore,
      hasData: leadHasData,
      raw: member.leadsGenerated,
      unit: "leads",
      weight: WEIGHTS.leadContribution,
    },
  ];

  const activeComponents = componentDefs.filter((c) => c.hasData);
  const totalWeight = activeComponents.reduce((s, c) => s + c.weight, 0);

  let overall = 0;
  if (totalWeight > 0) {
    overall = Math.round(
      activeComponents.reduce((s, c) => s + c.score * (c.weight / totalWeight), 0),
    );
  }

  const hasData = activeComponents.length > 0;

  // Strengths: score ≥ 70 AND hasData
  const strengths = componentDefs
    .filter((c) => c.hasData && c.score >= 70)
    .map((c) => c.label);

  // Opportunities: score < 40 AND hasData
  const opportunities = componentDefs
    .filter((c) => c.hasData && c.score < 40)
    .map((c) => c.label);

  return {
    overall,
    grade: gradeFrom(overall),
    components: componentDefs.map(({ key, label, score, hasData, raw, unit }) => ({
      key,
      label,
      score,
      hasData,
      raw,
      unit,
    })),
    strengths,
    opportunities,
    hasData,
    methodNote,
  };
}
