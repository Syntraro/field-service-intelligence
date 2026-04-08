/**
 * Time Alert Queries — data access for time alert detection.
 *
 * Owns all detection queries used by the timeAlertsWorker.
 * Orchestration/notification logic stays in the worker service.
 *
 * 2026-04-08: Extracted from timeAlertsWorker.ts to enforce Route→Service→Storage.
 */

import { db } from "../db";
import { eq, and, sql, isNull, lt, gte, isNotNull, desc } from "drizzle-orm";
import {
  timeEntries,
  workSessions,
  users,
  companies,
  notifications,
  type NotificationType,
} from "@shared/schema";

export const timeAlertQueryRepository = {
  /**
   * Get all companies (for batch worker iteration).
   */
  async getAllCompanies() {
    return db.select({ id: companies.id, name: companies.name }).from(companies);
  },

  /**
   * Get all company IDs (for digest worker).
   */
  async getAllCompanyIds() {
    return db.select({ id: companies.id }).from(companies);
  },

  /**
   * Check escalation: count prior notifications matching type+technician in recent days.
   */
  async countRecentAlerts(
    companyId: string,
    type: NotificationType,
    technicianId: string,
    daysBack: number
  ): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);
    const pattern = `${type}:${technicianId}:%`;

    const rows = await db
      .select({ dedupeKey: notifications.dedupeKey })
      .from(notifications)
      .where(
        and(
          eq(notifications.companyId, companyId),
          eq(notifications.type, type),
          gte(notifications.createdAt, cutoffDate),
          sql`${notifications.dedupeKey} LIKE ${pattern}`
        )
      )
      .orderBy(desc(notifications.createdAt));

    return rows.length;
  },

  /**
   * Aggregate unassigned time entries by technician for a date range.
   */
  async getUnassignedTimeByTechnician(companyId: string, dateStr: string) {
    const startOfDay = new Date(dateStr + "T00:00:00Z");
    const endOfDay = new Date(dateStr + "T23:59:59.999Z");

    return db
      .select({
        technicianId: timeEntries.technicianId,
        technicianName: users.fullName,
        totalMinutes: sql<number>`COALESCE(SUM(${timeEntries.durationMinutes}), 0)`.as("total_minutes"),
      })
      .from(timeEntries)
      .leftJoin(users, eq(timeEntries.technicianId, users.id))
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          isNull(timeEntries.jobId),
          isNotNull(timeEntries.endAt),
          gte(timeEntries.startAt, startOfDay),
          lt(timeEntries.startAt, endOfDay)
        )
      )
      .groupBy(timeEntries.technicianId, users.fullName);
  },

  /**
   * Get closed work sessions for a date (for worked-time calculation).
   */
  async getClosedSessionsByDate(companyId: string, dateStr: string) {
    return db
      .select({
        technicianId: workSessions.technicianId,
        technicianName: users.fullName,
        clockInAt: workSessions.clockInAt,
        clockOutAt: workSessions.clockOutAt,
        breakMinutes: workSessions.breakMinutes,
      })
      .from(workSessions)
      .leftJoin(users, eq(workSessions.technicianId, users.id))
      .where(
        and(
          eq(workSessions.companyId, companyId),
          eq(workSessions.workDate, dateStr),
          isNotNull(workSessions.clockOutAt)
        )
      );
  },

  /**
   * Get tracked time entries grouped by technician for a date.
   */
  async getTrackedTimeByTechnician(companyId: string, dateStr: string) {
    const startOfDay = new Date(dateStr + "T00:00:00Z");
    const endOfDay = new Date(dateStr + "T23:59:59.999Z");

    return db
      .select({
        technicianId: timeEntries.technicianId,
        totalMinutes: sql<number>`COALESCE(SUM(${timeEntries.durationMinutes}), 0)`.as("total_minutes"),
      })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          isNotNull(timeEntries.endAt),
          gte(timeEntries.startAt, startOfDay),
          lt(timeEntries.startAt, endOfDay)
        )
      )
      .groupBy(timeEntries.technicianId);
  },

  /**
   * Get long-running time entries (open entries started before cutoff).
   */
  async getLongRunningEntries(companyId: string, cutoff: Date) {
    return db
      .select({
        id: timeEntries.id,
        technicianId: timeEntries.technicianId,
        technicianName: users.fullName,
        type: timeEntries.type,
        startAt: timeEntries.startAt,
      })
      .from(timeEntries)
      .leftJoin(users, eq(timeEntries.technicianId, users.id))
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          isNull(timeEntries.endAt),
          lt(timeEntries.startAt, cutoff)
        )
      );
  },

  /**
   * Get open work sessions (missing clock-out, started before cutoff).
   */
  async getOpenSessions(companyId: string, cutoff: Date) {
    return db
      .select({
        id: workSessions.id,
        technicianId: workSessions.technicianId,
        technicianName: users.fullName,
        workDate: workSessions.workDate,
        clockInAt: workSessions.clockInAt,
      })
      .from(workSessions)
      .leftJoin(users, eq(workSessions.technicianId, users.id))
      .where(
        and(
          eq(workSessions.companyId, companyId),
          isNull(workSessions.clockOutAt),
          lt(workSessions.clockInAt, cutoff)
        )
      );
  },

  /**
   * Get closed work sessions for a week range (for digest).
   */
  async getWeekSessions(companyId: string, weekStart: string, weekEndStr: string) {
    return db
      .select({
        technicianId: workSessions.technicianId,
        technicianName: users.fullName,
        clockInAt: workSessions.clockInAt,
        clockOutAt: workSessions.clockOutAt,
        breakMinutes: workSessions.breakMinutes,
      })
      .from(workSessions)
      .leftJoin(users, eq(workSessions.technicianId, users.id))
      .where(
        and(
          eq(workSessions.companyId, companyId),
          gte(workSessions.workDate, weekStart),
          lt(workSessions.workDate, weekEndStr),
          isNotNull(workSessions.clockOutAt)
        )
      );
  },

  /**
   * Get time entries for a week range with tech names (for digest).
   */
  async getWeekTimeEntries(companyId: string, weekStart: Date, weekEnd: Date) {
    return db
      .select({
        technicianId: timeEntries.technicianId,
        technicianName: users.fullName,
        durationMinutes: timeEntries.durationMinutes,
        billable: timeEntries.billable,
        jobId: timeEntries.jobId,
      })
      .from(timeEntries)
      .leftJoin(users, eq(timeEntries.technicianId, users.id))
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          gte(timeEntries.startAt, weekStart),
          lt(timeEntries.startAt, weekEnd),
          isNotNull(timeEntries.endAt)
        )
      );
  },

  /**
   * Get time entries for a date range (no joins, for billable comparison).
   */
  async getTimeEntriesForRange(companyId: string, rangeStart: Date, rangeEnd: Date) {
    return db
      .select({
        durationMinutes: timeEntries.durationMinutes,
        billable: timeEntries.billable,
      })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          gte(timeEntries.startAt, rangeStart),
          lt(timeEntries.startAt, rangeEnd),
          isNotNull(timeEntries.endAt)
        )
      );
  },
};
