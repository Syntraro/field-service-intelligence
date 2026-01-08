import { db } from "../db";
import { jobVisits, jobs } from "../../shared/schema";
import { and, eq, desc, gte, lte } from "drizzle-orm";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export interface JobVisitListFilters {
  companyId: string;
  jobId?: string;
  status?: string;
  assignedTechnicianId?: string;
  fromDate?: Date;
  toDate?: Date;
  offset?: number;
  limit?: number;
}

export interface JobVisitListResult {
  items: any[];
  hasMore: boolean;
}

/**
 * LIST JOB VISITS
 */
export async function listJobVisits(filters: JobVisitListFilters): Promise<JobVisitListResult> {
  if (!filters.companyId) {
    throw new Error("companyId is required for tenant isolation");
  }

  const where: any[] = [
    eq(jobVisits.companyId, filters.companyId),
    eq(jobVisits.isActive, true)
  ];

  if (filters.jobId) where.push(eq(jobVisits.jobId, filters.jobId));
  if (filters.status) where.push(eq(jobVisits.status, filters.status));
  if (filters.assignedTechnicianId) where.push(eq(jobVisits.assignedTechnicianId, filters.assignedTechnicianId));
  if (filters.fromDate) where.push(gte(jobVisits.scheduledDate, filters.fromDate));
  if (filters.toDate) where.push(lte(jobVisits.scheduledDate, filters.toDate));

  const offset = Math.max(0, filters.offset ?? 0);
  const limit = Math.min(MAX_LIMIT, Math.max(1, filters.limit ?? DEFAULT_LIMIT));

  const rows = await db
    .select()
    .from(jobVisits)
    .where(and(...where))
    .orderBy(desc(jobVisits.scheduledDate), desc(jobVisits.id))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  return { items, hasMore };
}

/**
 * GET SINGLE JOB VISIT
 */
export async function getJobVisit(companyId: string, visitId: string) {
  const [visit] = await db
    .select()
    .from(jobVisits)
    .where(and(
      eq(jobVisits.id, visitId),
      eq(jobVisits.companyId, companyId),
      eq(jobVisits.isActive, true)
    ));

  return visit ?? null;
}

/**
 * CREATE JOB VISIT
 */
export async function createJobVisit(companyId: string, jobId: string, input: any) {
  // Verify job exists and belongs to company
  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)));

  if (!job) {
    throw new Error("Job not found or access denied");
  }

  const [visit] = await db
    .insert(jobVisits)
    .values({
      companyId,
      jobId,
      scheduledDate: input.scheduledDate,
      estimatedDurationMinutes: input.estimatedDurationMinutes ?? 60,
      assignedTechnicianId: input.assignedTechnicianId ?? null,
      status: input.status ?? "scheduled",
      visitNotes: input.visitNotes ?? null,
    })
    .returning();

  return visit;
}

/**
 * UPDATE JOB VISIT (with optimistic locking)
 */
export async function updateJobVisit(
  companyId: string,
  visitId: string,
  version: number | undefined,
  input: any
) {
  const existing = await getJobVisit(companyId, visitId);
  if (!existing) {
    throw new Error("Visit not found or access denied");
  }

  // Optimistic locking check
  if (version !== undefined && existing.version !== version) {
    throw new Error(
      `Visit was modified by another user. Expected version ${version}, but current version is ${existing.version}. Please refresh and try again.`
    );
  }

  const updates: any = { updatedAt: new Date(), version: existing.version + 1 };

  if ("scheduledDate" in input) updates.scheduledDate = input.scheduledDate;
  if ("estimatedDurationMinutes" in input) updates.estimatedDurationMinutes = input.estimatedDurationMinutes;
  if ("assignedTechnicianId" in input) updates.assignedTechnicianId = input.assignedTechnicianId;
  if ("status" in input) updates.status = input.status;
  if ("visitNotes" in input) updates.visitNotes = input.visitNotes;
  if ("isActive" in input) updates.isActive = input.isActive;

  const [updated] = await db
    .update(jobVisits)
    .set(updates)
    .where(and(eq(jobVisits.id, visitId), eq(jobVisits.companyId, companyId)))
    .returning();

  return updated;
}

/**
 * DELETE JOB VISIT (soft delete)
 */
export async function deleteJobVisit(companyId: string, visitId: string) {
  const [deleted] = await db
    .update(jobVisits)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(jobVisits.id, visitId), eq(jobVisits.companyId, companyId)))
    .returning();

  if (!deleted) {
    throw new Error("Visit not found or access denied");
  }

  return { success: true };
}

/**
 * UPDATE VISIT STATUS
 */
export async function updateJobVisitStatus(companyId: string, visitId: string, status: string) {
  const existing = await getJobVisit(companyId, visitId);
  if (!existing) {
    throw new Error("Visit not found or access denied");
  }

  const updates: any = {
    status,
    updatedAt: new Date(),
    version: existing.version + 1,
  };

  // Auto-set timestamps based on status transitions
  if (status === "on_site" && !existing.checkedInAt) {
    updates.checkedInAt = new Date();
  }

  if (status === "completed" && existing.checkedInAt && !existing.checkedOutAt) {
    const checkOutTime = new Date();
    updates.checkedOutAt = checkOutTime;
    const durationMs = checkOutTime.getTime() - new Date(existing.checkedInAt).getTime();
    updates.actualDurationMinutes = Math.round(durationMs / 60000);
  }

  const [updated] = await db
    .update(jobVisits)
    .set(updates)
    .where(and(eq(jobVisits.id, visitId), eq(jobVisits.companyId, companyId)))
    .returning();

  return updated;
}

/**
 * CHECK IN
 */
export async function checkInJobVisit(companyId: string, visitId: string) {
  const existing = await getJobVisit(companyId, visitId);
  if (!existing) {
    throw new Error("Visit not found or access denied");
  }

  if (existing.checkedInAt) {
    return existing; // Already checked in
  }

  const [updated] = await db
    .update(jobVisits)
    .set({
      checkedInAt: new Date(),
      status: "on_site",
      updatedAt: new Date(),
      version: existing.version + 1,
    })
    .where(and(eq(jobVisits.id, visitId), eq(jobVisits.companyId, companyId)))
    .returning();

  return updated;
}

/**
 * CHECK OUT
 */
export async function checkOutJobVisit(companyId: string, visitId: string) {
  const existing = await getJobVisit(companyId, visitId);
  if (!existing) {
    throw new Error("Visit not found or access denied");
  }

  if (!existing.checkedInAt) {
    throw new Error("Cannot check out before checking in");
  }

  if (existing.checkedOutAt) {
    return existing; // Already checked out
  }

  const checkOutTime = new Date();
  const durationMs = checkOutTime.getTime() - new Date(existing.checkedInAt).getTime();
  const actualDurationMinutes = Math.round(durationMs / 60000);

  const [updated] = await db
    .update(jobVisits)
    .set({
      checkedOutAt: checkOutTime,
      actualDurationMinutes,
      status: "completed",
      updatedAt: new Date(),
      version: existing.version + 1,
    })
    .where(and(eq(jobVisits.id, visitId), eq(jobVisits.companyId, companyId)))
    .returning();

  return updated;
}
