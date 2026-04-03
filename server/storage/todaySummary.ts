/**
 * Today's Operations Summary — Visit counts by status for today
 *
 * Provides real-time visit metrics for the dashboard "Today's Operations" section.
 * Uses single-pass SQL with FILTER clauses for efficiency.
 *
 * Dashboard Hardening (2026-03-26): Metrics form a true pipeline decomposition.
 *   Scheduled Today = total non-cancelled visits for today (full workload)
 *   On Route + In Progress + Remaining + Completed = Scheduled Today
 *   Remaining = Scheduled Today - On Route - In Progress - Completed
 *   No metric overlaps with another.
 */

import { db } from "../db";
import { sql, and, eq } from "drizzle-orm";
import { jobVisits } from "@shared/schema";

export interface TodayVisitSummary {
  /** Total non-cancelled visits scheduled for today (full workload) */
  scheduled: number;
  /** Visits where technician is traveling (status = en_route) */
  onRoute: number;
  /** Visits actively being worked (status = in_progress or on_site) */
  inProgress: number;
  /** Pipeline remainder: scheduled - onRoute - inProgress - completed.
   *  Represents work not yet consumed by a downstream pipeline state.
   *  Includes statuses: scheduled, dispatched, on_hold. */
  remaining: number;
  /** Visits completed today (status = completed) */
  completed: number;
  /** Total visits scheduled for today (same as scheduled — retained for backward compat) */
  total: number;
}

/**
 * Get visit counts by status for today.
 *
 * Uses scheduledStart date to determine "today" visits.
 * Single SQL query with FILTER clauses — no N+1.
 * WHERE clause pre-excludes cancelled, so COUNT(*) = total workload.
 */
export async function getTodayVisitSummary(companyId: string): Promise<TodayVisitSummary> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const result = await db
    .select({
      onRoute: sql<number>`
        COUNT(*) FILTER (WHERE ${jobVisits.status} = 'en_route')
      `.as("on_route"),
      inProgress: sql<number>`
        COUNT(*) FILTER (WHERE ${jobVisits.status} IN ('in_progress', 'on_site'))
      `.as("in_progress"),
      completed: sql<number>`
        COUNT(*) FILTER (WHERE ${jobVisits.status} = 'completed')
      `.as("completed"),
      total: sql<number>`COUNT(*)`.as("total"),
    })
    .from(jobVisits)
    .where(and(
      eq(jobVisits.companyId, companyId),
      eq(jobVisits.isActive, true),
      sql`${jobVisits.archivedAt} IS NULL`,
      sql`${jobVisits.scheduledStart} IS NOT NULL`,
      sql`${jobVisits.scheduledStart} >= ${today}::date`,
      sql`${jobVisits.scheduledStart} < ${today}::date + INTERVAL '1 day'`,
      sql`${jobVisits.status} != 'cancelled'`,
    ));

  const row = result[0];
  const totalWorkload = Number(row?.total) || 0;
  const onRoute = Number(row?.onRoute) || 0;
  const inProgress = Number(row?.inProgress) || 0;
  const completed = Number(row?.completed) || 0;

  return {
    scheduled: totalWorkload,
    onRoute,
    inProgress,
    // Pipeline remainder: total workload minus all downstream states.
    // Captures visits in scheduled, dispatched, and on_hold statuses.
    remaining: Math.max(0, totalWorkload - onRoute - inProgress - completed),
    completed,
    total: totalWorkload,
  };
}
