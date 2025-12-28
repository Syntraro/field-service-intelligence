import { db } from "../db";
import { eq, and, isNotNull, desc, sql } from "drizzle-orm";
import { calendarAssignments, clients } from "@shared/schema";
import { BaseRepository } from "./base";

export class MaintenanceRepository extends BaseRepository {
  /**
   * Get recently completed maintenance assignments
   */
  async getMaintenanceRecentlyCompleted(companyId: string, limit: number = 50) {
    return await db
      .select({
        assignment: calendarAssignments,
        client: clients,
      })
      .from(calendarAssignments)
      .innerJoin(clients, eq(calendarAssignments.clientId, clients.id))
      .where(
        and(
          eq(calendarAssignments.companyId, companyId),
          eq(calendarAssignments.completed, true),
          isNotNull(calendarAssignments.completionNotes)
        )
      )
      // scheduledDate is stored as text; cast to date for correct chronological ordering
      .orderBy(desc(sql`${calendarAssignments.scheduledDate}::date`))
      .limit(limit);
  }

  /**
   * Get maintenance status summary
   */
  async getMaintenanceStatuses(companyId: string) {
    // IMPORTANT:
    // status is a computed CASE expression (alias), so we must group by the expression itself,
    // not by the alias name "status" (Postgres treats that as a column reference).
    const statusExpr = sql<string>`
      CASE 
        WHEN ${calendarAssignments.completed} = true THEN 'completed'
        WHEN ${calendarAssignments.scheduledDate}::date < CURRENT_DATE THEN 'overdue'
        WHEN ${calendarAssignments.scheduledDate}::date = CURRENT_DATE THEN 'today'
        ELSE 'scheduled'
      END
    `;

    const result = await db
      .select({
        status: statusExpr,
        count: sql<number>`count(*)`,
      })
      .from(calendarAssignments)
      .where(eq(calendarAssignments.companyId, companyId))
      .groupBy(statusExpr);

    return result;
  }
}

export const maintenanceRepository = new MaintenanceRepository();
