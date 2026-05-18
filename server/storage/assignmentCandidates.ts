/**
 * Fetches the full candidate dataset needed by the assignment intelligence engine.
 *
 * Separating data retrieval from scoring keeps the engine pure and testable.
 *
 * Queries:
 *   1. All active, schedulable team members (users + their skills)
 *   2. Current period utilization from time_entries
 *   3. Time-off records overlapping the target date
 *   4. Efficiency scores computed from Phase 2 engine
 */

import { and, eq, gte, inArray, isNull, lt, lte, ne, sql } from "drizzle-orm";
import { db } from "../db";
import {
  users,
  teamMemberSkills,
  teamSkills,
  technicianTimeOff,
  timeEntries,
  workingHours,
  jobVisits,
  leadVisits,
} from "@shared/schema";
import type { CandidateMember } from "../lib/assignmentIntelligence";
import { getTeamMetrics } from "./teamMetrics";
import { computeEfficiencyScore } from "../lib/efficiencyScore";

const DEFAULT_WEEKLY_HOURS = 40;
const PERIOD_DAYS = 30; // Use last-30-days window for utilization context

function startOfWeekFor(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  const dow = r.getDay();
  r.setDate(r.getDate() - (dow === 0 ? 6 : dow - 1));
  return r;
}

function endOfWeekFor(d: Date): Date {
  const monday = startOfWeekFor(d);
  const r = new Date(monday);
  r.setDate(monday.getDate() + 6);
  r.setHours(23, 59, 59, 999);
  return r;
}

function parseHHMMLocal(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function computeTargetWeeklyHoursLocal(
  whRows: Array<{ isWorking: boolean; startTime: string | null; endTime: string | null }>,
): number {
  if (whRows.length === 0) return DEFAULT_WEEKLY_HOURS;
  let total = 0;
  for (const r of whRows) {
    if (!r.isWorking || !r.startTime || !r.endTime) continue;
    const s = parseHHMMLocal(r.startTime);
    const e = parseHHMMLocal(r.endTime);
    if (s != null && e != null && e > s) total += (e - s) / 60;
  }
  return total > 0 ? Math.round(total * 10) / 10 : DEFAULT_WEEKLY_HOURS;
}

export async function loadCandidates(
  companyId: string,
  targetDate: Date,
): Promise<CandidateMember[]> {
  // ── Active schedulable members ─────────────────────────────────────────
  const members = await db
    .select({
      userId: users.id,
      name: sql<string>`COALESCE(${users.fullName}, ${users.firstName}, ${users.email})`,
      role: users.role,
      isActive: sql<boolean>`${users.status} = 'active' AND NOT ${users.disabled}`,
    })
    .from(users)
    .where(
      and(
        eq(users.companyId, companyId),
        eq(users.isSchedulable, true),
        isNull(users.deletedAt),
      ),
    );

  if (members.length === 0) return [];

  const memberIds = members.map((m) => m.userId);

  // ── Member skills ──────────────────────────────────────────────────────
  const skillRows = await db
    .select({
      userId: teamMemberSkills.userId,
      skillId: teamMemberSkills.skillId,
      isActive: teamMemberSkills.isActive,
      certificationExpiresAt: teamMemberSkills.certificationExpiresAt,
      certificationName: teamMemberSkills.certificationName,
    })
    .from(teamMemberSkills)
    .where(eq(teamMemberSkills.companyId, companyId));

  // Group skills by userId
  const skillsByUser: Record<string, typeof skillRows> = {};
  for (const row of skillRows) {
    if (!skillsByUser[row.userId]) skillsByUser[row.userId] = [];
    skillsByUser[row.userId]!.push(row);
  }

  // ── Utilization + efficiency (last 30 days) ───────────────────────────
  const teamMetrics = await getTeamMetrics(companyId, "last_30_days");
  const metricsMap: Record<string, (typeof teamMetrics)[number]> = {};
  for (const m of teamMetrics) {
    metricsMap[m.userId] = m;
  }

  // Efficiency scores require all-member context
  const efficiencyByUser: Record<string, number> = {};
  for (const m of teamMetrics) {
    const eff = computeEfficiencyScore(m, teamMetrics, PERIOD_DAYS / 7);
    efficiencyByUser[m.userId] = eff.overall;
  }

  // ── Time-off overlapping target date ──────────────────────────────────
  const dayStart = new Date(targetDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(targetDate);
  dayEnd.setHours(23, 59, 59, 999);

  const now = new Date();
  const weekStart = startOfWeekFor(now);
  const weekEnd = endOfWeekFor(now);

  const [timeOffRows, workedRows, remainingJobVisitRows, remainingLeadVisitRows, whRows] = await Promise.all([
    db.select({
      technicianUserId: technicianTimeOff.technicianUserId,
      reason: technicianTimeOff.reason,
      startsAt: technicianTimeOff.startsAt,
      endsAt: technicianTimeOff.endsAt,
    }).from(technicianTimeOff)
      .where(
        and(
          eq(technicianTimeOff.companyId, companyId),
          isNull(technicianTimeOff.archivedAt),
          lte(technicianTimeOff.startsAt, dayEnd),
          gte(technicianTimeOff.endsAt, dayStart),
        ),
      ),

    // Worked minutes this week per member
    db.select({
      technicianId: timeEntries.technicianId,
      durationMinutes: timeEntries.durationMinutes,
    }).from(timeEntries)
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          inArray(timeEntries.technicianId, memberIds),
          gte(timeEntries.startAt, weekStart),
          lt(timeEntries.startAt, now),
          sql`${timeEntries.durationMinutes} IS NOT NULL`,
          sql`${timeEntries.endAt} IS NOT NULL`,
        ),
      ),

    // Job visits remaining this week
    db.select({
      assignedTechnicianIds: jobVisits.assignedTechnicianIds,
      scheduledStart: jobVisits.scheduledStart,
      scheduledEnd: jobVisits.scheduledEnd,
      estimatedDurationMinutes: jobVisits.estimatedDurationMinutes,
      isAllDay: jobVisits.isAllDay,
    }).from(jobVisits)
      .where(
        and(
          eq(jobVisits.companyId, companyId),
          eq(jobVisits.isActive, true),
          ne(jobVisits.status, "cancelled"),
          ne(jobVisits.status, "completed"),
          gte(jobVisits.scheduledStart, now),
          lte(jobVisits.scheduledStart, weekEnd),
        ),
      ),

    // Lead visits remaining this week
    db.select({
      assignedTechnicianIds: leadVisits.assignedTechnicianIds,
      scheduledStart: leadVisits.scheduledStart,
      scheduledEnd: leadVisits.scheduledEnd,
      estimatedDurationMinutes: leadVisits.estimatedDurationMinutes,
      isAllDay: leadVisits.isAllDay,
    }).from(leadVisits)
      .where(
        and(
          eq(leadVisits.companyId, companyId),
          ne(leadVisits.status, "cancelled"),
          ne(leadVisits.status, "completed"),
          gte(leadVisits.scheduledStart, now),
          lte(leadVisits.scheduledStart, weekEnd),
        ),
      ),

    // Working hours rows for targetWeeklyHours
    db.select({
      userId: workingHours.userId,
      isWorking: workingHours.isWorking,
      startTime: workingHours.startTime,
      endTime: workingHours.endTime,
    }).from(workingHours)
      .where(inArray(workingHours.userId, memberIds)),
  ]);

  const timeOffByUser: Record<string, (typeof timeOffRows)[number]> = {};
  for (const tof of timeOffRows) {
    timeOffByUser[tof.technicianUserId] = tof;
  }

  const workedMinsByUser: Record<string, number> = {};
  for (const r of workedRows) {
    if (!r.technicianId || r.durationMinutes == null) continue;
    workedMinsByUser[r.technicianId] = (workedMinsByUser[r.technicianId] ?? 0) + r.durationMinutes;
  }

  function visitRemainingMins(v: { scheduledStart: Date | null; scheduledEnd: Date | null; estimatedDurationMinutes: number | null; isAllDay: boolean }): number {
    if (v.isAllDay) return v.estimatedDurationMinutes ?? 0;
    if (v.scheduledEnd && v.scheduledStart) return Math.max(0, Math.round((new Date(v.scheduledEnd).getTime() - new Date(v.scheduledStart).getTime()) / 60_000));
    if (v.scheduledStart) return v.estimatedDurationMinutes ?? 60;
    return 0;
  }

  const remainingMinsByUser: Record<string, number> = {};
  for (const v of [...remainingJobVisitRows, ...remainingLeadVisitRows]) {
    const mins = visitRemainingMins(v);
    if (mins <= 0) continue;
    const assigned = (v.assignedTechnicianIds ?? []) as string[];
    for (const uid of assigned) {
      if (!memberIds.includes(uid)) continue;
      remainingMinsByUser[uid] = (remainingMinsByUser[uid] ?? 0) + mins;
    }
  }

  const whByUser: Record<string, typeof whRows> = {};
  for (const r of whRows) {
    if (!whByUser[r.userId]) whByUser[r.userId] = [];
    whByUser[r.userId]!.push(r);
  }

  // ── Assemble candidates ────────────────────────────────────────────────
  return members.map((m) => {
    const rawSkills = skillsByUser[m.userId] ?? [];
    const metrics = metricsMap[m.userId];
    const tof = timeOffByUser[m.userId] ?? null;
    const workedHoursThisWeek = Math.round(((workedMinsByUser[m.userId] ?? 0) / 60) * 10) / 10;
    const remainingHoursThisWeek = Math.round(((remainingMinsByUser[m.userId] ?? 0) / 60) * 10) / 10;
    const targetWeeklyHours = computeTargetWeeklyHoursLocal(whByUser[m.userId] ?? []);

    return {
      userId: m.userId,
      name: m.name,
      role: m.role,
      isActive: m.isActive,
      skills: rawSkills.map((s) => ({
        skillId: s.skillId,
        isActive: s.isActive,
        certificationExpiresAt: s.certificationExpiresAt,
        certificationName: s.certificationName,
      })),
      utilizationPct: metrics?.utilizationPct ?? null,
      efficiencyScore: efficiencyByUser[m.userId] ?? null,
      timeOffOnDate: tof
        ? { reason: tof.reason, startsAt: tof.startsAt, endsAt: tof.endsAt }
        : null,
      workedHoursThisWeek,
      forecastedWeekHours: Math.round((workedHoursThisWeek + remainingHoursThisWeek) * 10) / 10,
      targetWeeklyHours,
    };
  });
}

// ── Skill-filtered technician list (Phase 5) ──────────────────────────────

export interface SkillFilteredTechnician {
  userId: string;
  name: string;
  role: string;
  certificationName: string | null;
  certificationExpiresAt: Date | null;
  expiryStatus: "valid" | "expiring_soon" | "expired" | null;
}

/**
 * Returns schedulable, active members who have the requested skill assigned.
 */
export async function getTechniciansBySkill(
  companyId: string,
  skillId: string,
): Promise<SkillFilteredTechnician[]> {
  const rows = await db
    .select({
      userId: users.id,
      name: sql<string>`COALESCE(${users.fullName}, ${users.firstName}, ${users.email})`,
      role: users.role,
      certificationName: teamMemberSkills.certificationName,
      certificationExpiresAt: teamMemberSkills.certificationExpiresAt,
    })
    .from(teamMemberSkills)
    .innerJoin(users, eq(teamMemberSkills.userId, users.id))
    .where(
      and(
        eq(teamMemberSkills.companyId, companyId),
        eq(teamMemberSkills.skillId, skillId),
        eq(teamMemberSkills.isActive, true),
        eq(users.status, "active"),
        eq(users.isSchedulable, true),
        isNull(users.deletedAt),
      ),
    )
    .orderBy(sql`COALESCE(${users.fullName}, ${users.firstName}, ${users.email})`);

  const now = new Date();
  const soonThreshold = new Date(now.getTime() + 30 * 86_400_000);

  return rows.map((r) => {
    const exp = r.certificationExpiresAt;
    const expiryStatus = !exp ? null : exp < now ? "expired" : exp <= soonThreshold ? "expiring_soon" : "valid";
    return { ...r, expiryStatus };
  });
}

// ── Team skill analytics (Phase 6) ─────────────────────────────────────────

export interface SkillAnalytics {
  totalSkillsInLibrary: number;
  activeSkillsInLibrary: number;
  membersWithSkills: number;
  totalSchedulableMembers: number;
  expiringCertifications: {
    userId: string;
    memberName: string;
    skillName: string;
    certificationName: string;
    certificationExpiresAt: string;
    daysUntilExpiry: number;
    isExpired: boolean;
  }[];
  skillCoverage: {
    skillId: string;
    skillName: string;
    category: string | null;
    memberCount: number;
    certifiedCount: number;
  }[];
}

export async function getSkillAnalytics(companyId: string): Promise<SkillAnalytics> {
  // Library counts
  const libraryRows = await db
    .select({
      id: teamSkills.id,
      isActive: teamSkills.isActive,
    })
    .from(teamSkills)
    .where(eq(teamSkills.companyId, companyId));

  const totalSkillsInLibrary = libraryRows.length;
  const activeSkillsInLibrary = libraryRows.filter((s) => s.isActive).length;

  // Schedulable member count
  const memberRows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.companyId, companyId),
        eq(users.isSchedulable, true),
        eq(users.status, "active"),
        isNull(users.deletedAt),
      ),
    );
  const totalSchedulableMembers = memberRows.length;

  // Active assignments with expiry and skill info
  const assignmentRows = await db
    .select({
      userId: teamMemberSkills.userId,
      memberName: sql<string>`COALESCE(${users.fullName}, ${users.firstName}, ${users.email})`,
      skillId: teamMemberSkills.skillId,
      skillName: teamSkills.name,
      skillCategory: teamSkills.category,
      certificationName: teamMemberSkills.certificationName,
      certificationExpiresAt: teamMemberSkills.certificationExpiresAt,
    })
    .from(teamMemberSkills)
    .innerJoin(users, eq(teamMemberSkills.userId, users.id))
    .innerJoin(teamSkills, eq(teamMemberSkills.skillId, teamSkills.id))
    .where(
      and(
        eq(teamMemberSkills.companyId, companyId),
        eq(teamMemberSkills.isActive, true),
        eq(users.status, "active"),
        isNull(users.deletedAt),
      ),
    );

  // Members with at least one skill
  const membersWithSkillsSet = new Set(assignmentRows.map((r) => r.userId));
  const membersWithSkills = membersWithSkillsSet.size;

  // Expiring / expired certifications
  const now = new Date();
  const soonThreshold = new Date(now.getTime() + 30 * 86_400_000);

  const expiringCertifications = assignmentRows
    .filter((r) => r.certificationName && r.certificationExpiresAt)
    .filter((r) => r.certificationExpiresAt! <= soonThreshold)
    .map((r) => {
      const exp = r.certificationExpiresAt!;
      const daysUntilExpiry = Math.ceil((exp.getTime() - now.getTime()) / 86_400_000);
      return {
        userId: r.userId,
        memberName: r.memberName,
        skillName: r.skillName,
        certificationName: r.certificationName!,
        certificationExpiresAt: exp.toISOString(),
        daysUntilExpiry,
        isExpired: exp < now,
      };
    })
    .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);

  // Skill coverage: count members per skill; certifiedCount = members with certification docs
  const coverageMap: Record<string, { skillName: string; category: string | null; members: Set<string>; withCert: Set<string> }> = {};
  for (const row of assignmentRows) {
    if (!coverageMap[row.skillId]) {
      coverageMap[row.skillId] = { skillName: row.skillName, category: row.skillCategory, members: new Set(), withCert: new Set() };
    }
    coverageMap[row.skillId]!.members.add(row.userId);
    if (row.certificationName) coverageMap[row.skillId]!.withCert.add(row.userId);
  }

  const skillCoverage = Object.entries(coverageMap).map(([skillId, c]) => ({
    skillId,
    skillName: c.skillName,
    category: c.category,
    memberCount: c.members.size,
    certifiedCount: c.withCert.size,
  })).sort((a, b) => b.memberCount - a.memberCount);

  return {
    totalSkillsInLibrary,
    activeSkillsInLibrary,
    membersWithSkills,
    totalSchedulableMembers,
    expiringCertifications,
    skillCoverage,
  };
}
