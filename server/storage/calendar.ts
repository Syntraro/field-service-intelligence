import { db } from "../db";
import { eq, and, or, gte, lte, isNull, sql, inArray } from "drizzle-orm";
import {
  jobs,
  users,
  technicianProfiles,
  clientLocations,
  customerCompanies,
} from "@shared/schema";
import { BaseRepository } from "./base";

/**
 * Calendar Assignment with joined technician and job info
 */
export interface CalendarAssignmentWithDetails {
  id: string;
  companyId: string;
  jobId: string;
  jobNumber: number;
  jobType: string;
  summary: string;
  status: string;
  locationId: string;
  locationName: string;
  customerCompanyId: string | null;
  customerCompanyName: string | null;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  assignedTechnicianIds: string[] | null;
  primaryTechnicianId: string | null;
  technicians: Array<{
    id: string;
    name: string;
    color: string | null;
  }>;
}

export class CalendarRepository extends BaseRepository {
  /**
   * Get calendar assignments (jobs) for a date range
   * Efficient query that fetches jobs with start/end times overlapping the range
   */
  async getAssignmentsInRange(
    companyId: string,
    startDate: Date,
    endDate: Date
  ): Promise<CalendarAssignmentWithDetails[]> {
    // Find jobs that overlap with the date range:
    // Job overlaps if: job.scheduledStart <= endDate AND job.scheduledEnd >= startDate
    // Also include jobs where scheduledStart is in range even if scheduledEnd is null
    const jobRows = await db
      .select({
        id: jobs.id,
        companyId: jobs.companyId,
        jobNumber: jobs.jobNumber,
        jobType: jobs.jobType,
        summary: jobs.summary,
        status: jobs.status,
        locationId: jobs.locationId,
        scheduledStart: jobs.scheduledStart,
        scheduledEnd: jobs.scheduledEnd,
        assignedTechnicianIds: jobs.assignedTechnicianIds,
        primaryTechnicianId: jobs.primaryTechnicianId,
        locationName: clientLocations.companyName,
        customerCompanyId: clientLocations.parentCompanyId,
      })
      .from(jobs)
      .leftJoin(clientLocations, eq(jobs.locationId, clientLocations.id))
      .where(
        and(
          eq(jobs.companyId, companyId),
          // Job has a scheduled start time
          sql`${jobs.scheduledStart} IS NOT NULL`,
          // Job overlaps with range (start <= endDate)
          lte(jobs.scheduledStart, endDate),
          // Either scheduledEnd is null or scheduledEnd >= startDate
          or(
            isNull(jobs.scheduledEnd),
            gte(jobs.scheduledEnd, startDate)
          )
        )
      )
      .orderBy(jobs.scheduledStart);

    if (jobRows.length === 0) {
      return [];
    }

    // Collect all technician IDs to fetch in bulk
    const technicianIdSet = new Set<string>();
    const customerCompanyIds = new Set<string>();

    for (const job of jobRows) {
      if (job.primaryTechnicianId) {
        technicianIdSet.add(job.primaryTechnicianId);
      }
      if (job.assignedTechnicianIds) {
        for (const techId of job.assignedTechnicianIds) {
          technicianIdSet.add(techId);
        }
      }
      if (job.customerCompanyId) {
        customerCompanyIds.add(job.customerCompanyId);
      }
    }

    // Fetch technicians with their profiles for color
    const technicianIds = Array.from(technicianIdSet);
    const technicianMap = new Map<string, { id: string; name: string; color: string | null }>();

    if (technicianIds.length > 0) {
      const techRows = await db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          fullName: users.fullName,
          color: technicianProfiles.color,
        })
        .from(users)
        .leftJoin(technicianProfiles, eq(users.id, technicianProfiles.userId))
        .where(inArray(users.id, technicianIds));

      for (const tech of techRows) {
        const name = tech.fullName ||
          (tech.firstName && tech.lastName ? `${tech.firstName} ${tech.lastName}` : tech.firstName || "Unknown");
        technicianMap.set(tech.id, {
          id: tech.id,
          name,
          color: tech.color,
        });
      }
    }

    // Fetch customer company names
    const customerCompanyMap = new Map<string, string>();
    if (customerCompanyIds.size > 0) {
      const companyRows = await db
        .select({
          id: customerCompanies.id,
          name: customerCompanies.name,
        })
        .from(customerCompanies)
        .where(inArray(customerCompanies.id, Array.from(customerCompanyIds)));

      for (const cc of companyRows) {
        customerCompanyMap.set(cc.id, cc.name);
      }
    }

    // Build result with technician details
    return jobRows.map((job) => {
      const techIds = job.assignedTechnicianIds || [];
      const technicians = techIds
        .map((id) => technicianMap.get(id))
        .filter((t): t is { id: string; name: string; color: string | null } => t !== undefined);

      return {
        id: job.id,
        companyId: job.companyId,
        jobId: job.id,
        jobNumber: job.jobNumber,
        jobType: job.jobType,
        summary: job.summary,
        status: job.status,
        locationId: job.locationId,
        locationName: job.locationName || "Unknown Location",
        customerCompanyId: job.customerCompanyId,
        customerCompanyName: job.customerCompanyId
          ? customerCompanyMap.get(job.customerCompanyId) || null
          : null,
        scheduledStart: job.scheduledStart,
        scheduledEnd: job.scheduledEnd,
        assignedTechnicianIds: job.assignedTechnicianIds,
        primaryTechnicianId: job.primaryTechnicianId,
        technicians,
      };
    });
  }

  /**
   * Get a single job/assignment by ID (for update/delete validation)
   */
  async getAssignmentById(companyId: string, jobId: string) {
    const rows = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Create a calendar assignment (update job with scheduling info)
   * For Slice 1, we update the job's schedule fields
   */
  async createAssignment(
    companyId: string,
    data: {
      jobId: string;
      technicianUserId?: string;
      startAt: Date;
      endAt: Date;
      notes?: string;
    }
  ) {
    const updateData: any = {
      scheduledStart: data.startAt,
      scheduledEnd: data.endAt,
      updatedAt: new Date(),
    };

    if (data.technicianUserId) {
      updateData.primaryTechnicianId = data.technicianUserId;
      updateData.assignedTechnicianIds = [data.technicianUserId];
    }

    // Notes go to description if provided
    if (data.notes) {
      updateData.description = data.notes;
    }

    const rows = await db
      .update(jobs)
      .set(updateData)
      .where(and(eq(jobs.id, data.jobId), eq(jobs.companyId, companyId)))
      .returning();

    return rows[0] ?? null;
  }

  /**
   * Update a calendar assignment (job scheduling)
   */
  async updateAssignment(
    companyId: string,
    jobId: string,
    data: {
      technicianUserId?: string;
      startAt?: Date;
      endAt?: Date;
      notes?: string;
    }
  ) {
    const updateData: any = {
      updatedAt: new Date(),
    };

    if (data.startAt !== undefined) {
      updateData.scheduledStart = data.startAt;
    }
    if (data.endAt !== undefined) {
      updateData.scheduledEnd = data.endAt;
    }
    if (data.technicianUserId !== undefined) {
      updateData.primaryTechnicianId = data.technicianUserId;
      updateData.assignedTechnicianIds = data.technicianUserId ? [data.technicianUserId] : [];
    }
    if (data.notes !== undefined) {
      updateData.description = data.notes;
    }

    const rows = await db
      .update(jobs)
      .set(updateData)
      .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)))
      .returning();

    return rows[0] ?? null;
  }

  /**
   * Delete/unschedule an assignment (clears scheduling fields)
   * For Slice 1, we clear the schedule rather than deleting the job
   */
  async deleteAssignment(companyId: string, jobId: string) {
    const rows = await db
      .update(jobs)
      .set({
        scheduledStart: null,
        scheduledEnd: null,
        updatedAt: new Date(),
      })
      .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)))
      .returning();

    return rows[0] ?? null;
  }

  /**
   * Complete an assignment
   */
  async completeAssignment(
    companyId: string,
    jobId: string,
    completionNotes?: string
  ) {
    const rows = await db
      .update(jobs)
      .set({
        status: "completed",
        actualEnd: new Date(),
        billingNotes: completionNotes || undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)))
      .returning();

    return rows[0] ?? null;
  }

  /**
   * Validate that a technician belongs to the tenant
   */
  async validateTechnicianBelongsToTenant(
    companyId: string,
    technicianUserId: string
  ): Promise<boolean> {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, technicianUserId), eq(users.companyId, companyId)))
      .limit(1);

    return rows.length > 0;
  }

  /**
   * Validate that a job belongs to the tenant
   */
  async validateJobBelongsToTenant(
    companyId: string,
    jobId: string
  ): Promise<boolean> {
    const rows = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)))
      .limit(1);

    return rows.length > 0;
  }
}

export const calendarRepository = new CalendarRepository();
