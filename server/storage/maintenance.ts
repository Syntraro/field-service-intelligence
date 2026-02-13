import { db } from "../db";
import { eq, and, isNotNull, isNull, desc, sql } from "drizzle-orm";
import { jobs, clientLocations } from "@shared/schema";
import { BaseRepository } from "./base";

/**
 * Maintenance Repository
 * MODEL A: All queries use jobs table (calendar_assignments removed)
 */
export class MaintenanceRepository extends BaseRepository {
  /**
   * Get recently completed jobs
   * MODEL A: Uses jobs table with status='completed'
   */
  async getMaintenanceRecentlyCompleted(companyId: string, limit: number = 50) {
    return await db
      .select({
        job: jobs,
        location: clientLocations,
      })
      .from(jobs)
      .innerJoin(clientLocations, eq(jobs.locationId, clientLocations.id))
      .where(
        and(
          eq(jobs.companyId, companyId),
          isNull(jobs.deletedAt),
          eq(jobs.isActive, true),
          eq(jobs.status, 'completed'),
          isNotNull(jobs.billingNotes) // Completion notes stored in billingNotes
        )
      )
      .orderBy(desc(jobs.actualEnd))
      .limit(limit);
  }

  /**
   * Get job status summary
   * MODEL A: Uses jobs table with derived scheduling state
   */
  async getMaintenanceStatuses(companyId: string) {
    // Derive status from job fields
    // Phase 2 Step 5: Overdue = effectiveEnd < NOW
    // effectiveEnd priority: scheduled_end > scheduled_start + duration_minutes > scheduled_start
    const statusExpr = sql<string>`
      CASE
        WHEN ${jobs.status} = 'completed' THEN 'completed'
        WHEN ${jobs.status} = 'invoiced' THEN 'invoiced'
        WHEN ${jobs.status} = 'archived' THEN 'archived'
        WHEN ${jobs.scheduledStart} IS NULL THEN 'unscheduled'
        WHEN CASE
          WHEN ${jobs.scheduledEnd} IS NOT NULL THEN ${jobs.scheduledEnd}
          WHEN ${jobs.durationMinutes} IS NOT NULL THEN ${jobs.scheduledStart} + (${jobs.durationMinutes} || ' minutes')::interval
          ELSE ${jobs.scheduledStart}
        END < CURRENT_TIMESTAMP THEN 'overdue'
        WHEN DATE(${jobs.scheduledStart}) = CURRENT_DATE THEN 'today'
        ELSE 'scheduled'
      END
    `;

    const result = await db
      .select({
        status: statusExpr,
        count: sql<number>`count(*)::int`,
      })
      .from(jobs)
      .where(
        and(
          eq(jobs.companyId, companyId),
          isNull(jobs.deletedAt),
          eq(jobs.isActive, true)
        )
      )
      .groupBy(statusExpr);

    return result;
  }
}

export const maintenanceRepository = new MaintenanceRepository();
