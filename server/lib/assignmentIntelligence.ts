/**
 * Assignment Intelligence Engine — pure module, no DB access.
 *
 * Ranks team members for a job based on skill match, availability,
 * utilization, and efficiency. Returns an explainable recommendation list.
 *
 * Core principle: Recommendations are transparent. Every score
 * component has a human-readable reason/warning. No opaque AI scoring.
 *
 * Formula:
 *   matchScore = skillScore×0.40 + availabilityScore×0.30 + utilizationScore×0.20 + effScore×0.10
 *
 * Skill score per member:
 *   Each required skill contributes proportionally:
 *     - Full match (has skill, active, meets minimum level):  100 pts
 *     - Partial match (has skill but level insufficient):      50 pts
 *     - Expired certification on a required skill:            25 pts (still has skill)
 *     - Missing skill:                                          0 pts
 *   Average across all required skills (= 100 if no requirements).
 *
 * Availability score:
 *   100 if not on time-off on the target date, else 0.
 *
 * Utilization score:
 *   0-100 → lower utilization yields higher score: (100 - utilizationPct).
 *   Unknown utilization → 50 (neutral).
 *   >80% utilization triggers a "High utilization" warning.
 *
 * Efficiency score:
 *   The member's Phase 2 overall efficiency score (0-100). Unknown → 50.
 */

import type { SkillLevel } from "@shared/schema";
import { SKILL_LEVELS } from "@shared/schema";

// ── Level ranking ───────────────────────────────────────────────────────────

const LEVEL_RANK: Record<SkillLevel, number> = {
  basic: 0,
  intermediate: 1,
  advanced: 2,
  certified: 3,
};

function meetsLevel(memberLevel: SkillLevel, minimumLevel: SkillLevel | null): boolean {
  if (!minimumLevel) return true;
  return LEVEL_RANK[memberLevel] >= LEVEL_RANK[minimumLevel];
}

// ── Input types ─────────────────────────────────────────────────────────────

export interface JobRequirement {
  skillId: string;
  skillName: string;
  minimumLevel: SkillLevel | null;
  required: boolean;
}

export interface CandidateMemberSkill {
  skillId: string;
  level: SkillLevel;
  isActive: boolean;
  certificationExpiresAt: Date | null;
  certificationName: string | null;
}

export interface CandidateTimeOff {
  reason: string;
  startsAt: Date;
  endsAt: Date;
}

export interface CandidateMember {
  userId: string;
  name: string;
  role: string;
  isActive: boolean;
  skills: CandidateMemberSkill[];
  utilizationPct: number | null;
  efficiencyScore: number | null;
  timeOffOnDate: CandidateTimeOff | null;
  workedHoursThisWeek: number;
  forecastedWeekHours: number;
  targetWeeklyHours: number;
}

// ── Output types ─────────────────────────────────────────────────────────────

export type ExpiryStatus = "valid" | "expiring_soon" | "expired";

export interface SkillMatchDetail {
  skillId: string;
  skillName: string;
  minimumLevel: SkillLevel | null;
  memberLevel: SkillLevel | null;
  levelMet: boolean;
  isRequired: boolean;
  expiryStatus: ExpiryStatus | null;
  certificationName: string | null;
}

export interface AssignmentRecommendation {
  userId: string;
  name: string;
  role: string;
  matchScore: number;             // 0-100, rounded
  skillMatchCount: number;        // skills that fully meet requirements
  skillPartialCount: number;      // skills present but level insufficient or expired
  totalRequiredSkills: number;
  skillMatchDetails: SkillMatchDetail[];
  isAvailable: boolean;
  timeOffConflict: { reason: string; startsAt: string; endsAt: string } | null;
  utilizationPct: number | null;
  reasons: string[];
  warnings: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const EXPIRY_SOON_DAYS = 30;

function getExpiryStatus(expiresAt: Date | null): ExpiryStatus | null {
  if (!expiresAt) return null;
  const now = new Date();
  if (expiresAt < now) return "expired";
  const soon = new Date(now.getTime() + EXPIRY_SOON_DAYS * 86_400_000);
  if (expiresAt <= soon) return "expiring_soon";
  return "valid";
}

function levelLabel(level: SkillLevel): string {
  return level.charAt(0).toUpperCase() + level.slice(1);
}

function formatDateCompact(d: Date): string {
  return d.toLocaleDateString("en-CA"); // YYYY-MM-DD
}

function daysBetween(a: Date, b: Date): number {
  return Math.round(Math.abs(b.getTime() - a.getTime()) / 86_400_000);
}

// ── Core engine ──────────────────────────────────────────────────────────────

/**
 * Ranks all candidates for a job.
 *
 * Inactive members are excluded entirely. The output list is sorted
 * descending by matchScore (best first). Ties preserve input order.
 */
export function rankCandidates(
  requirements: JobRequirement[],
  candidates: CandidateMember[],
): AssignmentRecommendation[] {
  const results: AssignmentRecommendation[] = [];

  for (const candidate of candidates) {
    if (!candidate.isActive) continue;

    const rec = scoreMember(requirements, candidate);
    results.push(rec);
  }

  // Sort descending by matchScore, stable on equal scores
  results.sort((a, b) => b.matchScore - a.matchScore);
  return results;
}

function scoreMember(
  requirements: JobRequirement[],
  candidate: CandidateMember,
): AssignmentRecommendation {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const skillMatchDetails: SkillMatchDetail[] = [];

  // Build a skill map for O(1) lookup
  const skillMap: Record<string, CandidateMemberSkill> = {};
  for (const s of candidate.skills) {
    if (s.isActive) skillMap[s.skillId] = s;
  }

  // ── Skill scoring ──────────────────────────────────────────────────────
  let skillScoreSum = 0;
  let skillMatchCount = 0;
  let skillPartialCount = 0;
  const totalRequired = requirements.length;

  for (const req of requirements) {
    const memberSkill = skillMap[req.skillId] ?? null;
    let pointsForSkill = 0;
    let levelMet = false;
    let expiryStatus: ExpiryStatus | null = null;
    let certificationName: string | null = null;
    const memberLevel: SkillLevel | null = memberSkill?.level ?? null;

    if (memberSkill) {
      expiryStatus = getExpiryStatus(memberSkill.certificationExpiresAt);
      certificationName = memberSkill.certificationName;

      const levelOk = meetsLevel(memberSkill.level, req.minimumLevel);

      if (expiryStatus === "expired") {
        // Has skill but cert is expired — partial credit
        pointsForSkill = 25;
        levelMet = false;
        skillPartialCount++;
        if (req.required) {
          warnings.push(
            `${req.skillName}: certification has expired${certificationName ? ` (${certificationName})` : ""}`,
          );
        }
      } else if (!levelOk) {
        // Has skill but level too low
        pointsForSkill = 50;
        levelMet = false;
        skillPartialCount++;
        if (req.required) {
          warnings.push(
            `${req.skillName}: has ${levelLabel(memberSkill.level)} level` +
              (req.minimumLevel ? ` — ${levelLabel(req.minimumLevel)} required` : ""),
          );
        }
      } else {
        // Full match
        pointsForSkill = 100;
        levelMet = true;
        skillMatchCount++;

        if (expiryStatus === "expiring_soon" && certificationName) {
          const daysLeft = daysBetween(new Date(), memberSkill.certificationExpiresAt!);
          warnings.push(`${certificationName} expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`);
        }
      }
    } else {
      // Missing skill
      pointsForSkill = 0;
      levelMet = false;
      if (req.required) {
        warnings.push(`Missing required skill: ${req.skillName}`);
      }
    }

    skillScoreSum += pointsForSkill;
    skillMatchDetails.push({
      skillId: req.skillId,
      skillName: req.skillName,
      minimumLevel: req.minimumLevel,
      memberLevel,
      levelMet,
      isRequired: req.required,
      expiryStatus,
      certificationName,
    });
  }

  const skillScore =
    totalRequired > 0 ? Math.round(skillScoreSum / totalRequired) : 100;

  if (totalRequired > 0 && skillMatchCount === totalRequired) {
    reasons.push(`Has all ${totalRequired} required skill${totalRequired === 1 ? "" : "s"}`);
  } else if (totalRequired > 0 && skillMatchCount > 0) {
    reasons.push(`Has ${skillMatchCount} of ${totalRequired} required skill${totalRequired === 1 ? "" : "s"}`);
  }

  // ── Availability scoring ───────────────────────────────────────────────
  const isAvailable = candidate.timeOffOnDate === null;
  const availabilityScore = isAvailable ? 100 : 0;
  let timeOffConflict: AssignmentRecommendation["timeOffConflict"] = null;

  if (!isAvailable && candidate.timeOffOnDate) {
    const tof = candidate.timeOffOnDate;
    const label = tof.reason.replace(/_/g, " ");
    timeOffConflict = {
      reason: tof.reason,
      startsAt: tof.startsAt.toISOString(),
      endsAt: tof.endsAt.toISOString(),
    };
    warnings.push(
      `On time-off: ${label} (${formatDateCompact(tof.startsAt)} – ${formatDateCompact(tof.endsAt)})`,
    );
  } else {
    reasons.push("Available on requested date");
  }

  // ── Utilization scoring ────────────────────────────────────────────────
  const utilizationPct = candidate.utilizationPct;
  let utilizationScore: number;

  if (utilizationPct === null) {
    utilizationScore = 50;
  } else {
    utilizationScore = Math.max(0, Math.min(100, Math.round(100 - utilizationPct)));
    if (utilizationPct > 80) {
      warnings.push(`High utilization (${Math.round(utilizationPct)}%)`);
    } else if (utilizationPct < 40) {
      reasons.push("Low current workload");
    }
  }

  // ── Efficiency score ───────────────────────────────────────────────────
  const effScore = candidate.efficiencyScore ?? 50;

  // ── Overall score ─────────────────────────────────────────────────────
  const matchScore = Math.round(
    skillScore * 0.40 +
    availabilityScore * 0.30 +
    utilizationScore * 0.20 +
    effScore * 0.10,
  );

  return {
    userId: candidate.userId,
    name: candidate.name,
    role: candidate.role,
    matchScore,
    skillMatchCount,
    skillPartialCount,
    totalRequiredSkills: totalRequired,
    skillMatchDetails,
    isAvailable,
    timeOffConflict,
    utilizationPct,
    reasons,
    warnings,
  };
}

// ── Re-export level utilities (used by routes) ─────────────────────────────

export { SKILL_LEVELS, LEVEL_RANK, meetsLevel };
