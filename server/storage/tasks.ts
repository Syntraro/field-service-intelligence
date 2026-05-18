import { db } from "../db";
import { and, eq, isNull, isNotNull, gte, lte, desc, or, asc, sql, ne } from "drizzle-orm";
import { tasks, timeEntries, users } from "@shared/schema";
import { BaseRepository, clampLimit, clampOffset } from "./base";
import { sanitizeSchedulingTimestamps } from "../utils/allDaySanitizer";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export interface TaskListFilters {
  companyId: string; // REQUIRED - tenant isolation
  status?: string;
  assignedToUserId?: string;
  unassigned?: boolean;
  type?: string;
  jobId?: string;
  fromDate?: Date;
  toDate?: Date;
  /** Filter by scheduledStartAt >= date (for calendar integration) */
  scheduledFromDate?: Date;
  /** Filter by scheduledStartAt <= date (for calendar integration) */
  scheduledToDate?: Date;
  offset?: number;
  limit?: number;
}

export interface TaskListResult {
  items: any[];
  hasMore: boolean;
}

export interface TaskCreateInput {
  createdByUserId: string;
  type: string;
  title: string;
  status?: string;
  allDay?: boolean;
  assignedToUserId?: string;
  notes?: string;
  scheduledStartAt?: string;
  scheduledEndAt?: string;
  jobId?: string;
  clientId?: string;
  // Phase 2: Quote assessment link — immutable after create
  quoteId?: string;
  estimatedDurationMinutes?: number;
  // 2026-04-10: Billable flag. Default: jobId present → true, no jobId → false.
  isBillable?: boolean;
}

export interface TaskUpdateInput {
  title?: string;
  notes?: string;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
  allDay?: boolean;
  jobId?: string | null;
  clientId?: string | null;
  assignedToUserId?: string | null;
  estimatedDurationMinutes?: number | null;
  type?: string;
  status?: string;
  isBillable?: boolean;
}

export class TaskRepository extends BaseRepository {
  // ========================================
  // TASK CRUD
  // ========================================

  /**
   * Create task (tenant-scoped)
   * DUAL-WRITE: Writes both locationId AND clientId
   * TODO: [MIGRATION] Once locationId is fully adopted, remove clientId write
   */
  async createTask(
    companyId: string,
    input: TaskCreateInput
  ): Promise<typeof tasks.$inferSelect> {
    this.assertCompanyId(companyId);

    if (!input.createdByUserId) {
      throw this.validationError("createdByUserId is required");
    }

    // Build values object, only including defined fields
    const values: any = {
      companyId,
      createdByUserId: input.createdByUserId,
      type: input.type,
      title: input.title,
      status: input.status ?? "pending",
      allDay: input.allDay ?? false,
    };

    // Only add optional fields if they're defined and valid
    if (input.assignedToUserId !== undefined)
      values.assignedToUserId = input.assignedToUserId;
    if (input.notes !== undefined) values.notes = input.notes;

    // For date fields, convert ISO strings to Date objects for Drizzle timestamp columns
    // Drizzle's timestamp type uses mode: 'date' by default, expecting Date objects
    if (input.scheduledStartAt !== undefined && input.scheduledStartAt !== null) {
      if (
        typeof input.scheduledStartAt === "string" &&
        input.scheduledStartAt.trim() !== ""
      ) {
        const parsed = new Date(input.scheduledStartAt);
        if (!isNaN(parsed.getTime())) {
          values.scheduledStartAt = parsed;
        }
      }
    }
    if (input.scheduledEndAt !== undefined && input.scheduledEndAt !== null) {
      if (
        typeof input.scheduledEndAt === "string" &&
        input.scheduledEndAt.trim() !== ""
      ) {
        const parsed = new Date(input.scheduledEndAt);
        if (!isNaN(parsed.getTime())) {
          values.scheduledEndAt = parsed;
        }
      }
    }

    if (input.jobId !== undefined) values.jobId = input.jobId;

    // DUAL-WRITE: Set both clientId and locationId
    if (input.clientId !== undefined) {
      values.clientId = input.clientId;
      values.locationId = input.clientId; // Mirror clientId to locationId
    }

    if (input.estimatedDurationMinutes !== undefined)
      values.estimatedDurationMinutes = input.estimatedDurationMinutes;

    // 2026-04-10: Billable defaults — jobId present → true, no jobId → false. User can override.
    values.isBillable = input.isBillable ?? (input.jobId ? true : false);

    // Phase 2: Quote assessment link
    if (input.quoteId !== undefined) values.quoteId = input.quoteId;

    // UTC-safe scheduling fix: replace Date objects with SQL expressions
    sanitizeSchedulingTimestamps(values, "new-task");

    const [task] = await db.insert(tasks).values(values).returning();

    return task;
  }

  /**
   * List tasks with filtering and pagination (tenant-scoped)
   */
  async listTasks(filters: TaskListFilters): Promise<TaskListResult> {
    this.assertCompanyId(filters.companyId);

    const where: any[] = [eq(tasks.companyId, filters.companyId)];

    if (filters.status) where.push(eq(tasks.status, filters.status));

    if (filters.unassigned) {
      where.push(isNull(tasks.assignedToUserId));
    } else if (filters.assignedToUserId) {
      where.push(eq(tasks.assignedToUserId, filters.assignedToUserId));
    }

    if (filters.type) where.push(eq(tasks.type, filters.type));
    if (filters.jobId) where.push(eq(tasks.jobId, filters.jobId));

    // 2026-04-10: Legacy checkedInAt removed — filter by createdAt for date range
    if (filters.fromDate) where.push(gte(tasks.createdAt, filters.fromDate));
    if (filters.toDate) where.push(lte(tasks.createdAt, filters.toDate));

    // Calendar integration: filter by scheduledStartAt date range
    if (filters.scheduledFromDate) where.push(gte(tasks.scheduledStartAt, filters.scheduledFromDate));
    if (filters.scheduledToDate) where.push(lte(tasks.scheduledStartAt, filters.scheduledToDate));

    // Clamp pagination params
    const offset = clampOffset(filters.offset ?? 0);
    const limit = clampLimit(filters.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    // Fetch limit + 1 to determine hasMore; left-join users to hydrate assignedUser.
    const rows = await db
      .select({
        task: tasks,
        assignedUser: {
          id: users.id,
          fullName: users.fullName,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(tasks)
      .leftJoin(users, eq(tasks.assignedToUserId, users.id))
      .where(and(...where))
      .orderBy(desc(tasks.createdAt), desc(tasks.id))
      .limit(limit + 1)
      .offset(offset);

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map((r) => {
      const au = r.assignedUser;
      return {
        ...r.task,
        assignedUser: au && au.id
          ? { id: au.id, fullName: au.fullName, firstName: au.firstName, lastName: au.lastName }
          : null,
      };
    });

    return { items, hasMore };
  }

  /**
   * 2026-04-10: Tech-visible active tasks for a specific user.
   *
   * Visibility rule (matches the audit specification):
   *   - assigned to the user
   *   - status NOT IN (completed, cancelled)
   *   - scheduledStartAt IS NULL (unscheduled → show always)
   *     OR DATE(scheduledStartAt) <= today (overdue + today → show)
   *
   * Ordering:
   *   1. Overdue (past scheduled, oldest first)
   *   2. Today scheduled
   *   3. Unscheduled (newest first)
   */
  async getActiveTechTasks(
    companyId: string,
    userId: string,
    today: Date,
  ): Promise<(typeof tasks.$inferSelect)[]> {
    this.assertCompanyId(companyId);
    this.validateUUID(userId, "userId");

    // End of today = start of tomorrow (exclusive upper bound for date comparison)
    const endOfToday = new Date(today);
    endOfToday.setDate(endOfToday.getDate() + 1);

    const rows = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.companyId, companyId),
          eq(tasks.assignedToUserId, userId),
          ne(tasks.status, "completed"),
          ne(tasks.status, "cancelled"),
          or(
            isNull(tasks.scheduledStartAt),
            lte(tasks.scheduledStartAt, endOfToday),
          ),
        ),
      )
      // Order: scheduled first (by date asc = overdue first), then unscheduled
      .orderBy(
        sql`CASE WHEN ${tasks.scheduledStartAt} IS NULL THEN 1 ELSE 0 END`,
        asc(tasks.scheduledStartAt),
        desc(tasks.createdAt),
      )
      .limit(100);

    return rows;
  }

  /**
   * Get single task (tenant-scoped)
   */
  async getTask(
    companyId: string,
    taskId: string
  ): Promise<typeof tasks.$inferSelect | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(taskId, "taskId");

    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.companyId, companyId)));

    return task ?? null;
  }

  /**
   * Assign/unassign task (tenant-scoped)
   */
  async assignTask(
    companyId: string,
    taskId: string,
    assignedToUserId: string | null
  ): Promise<typeof tasks.$inferSelect> {
    this.assertCompanyId(companyId);
    this.validateUUID(taskId, "taskId");

    const [updated] = await db
      .update(tasks)
      .set({ assignedToUserId })
      .where(and(eq(tasks.id, taskId), eq(tasks.companyId, companyId)))
      .returning();

    if (!updated) throw this.notFoundError("Task");
    return updated;
  }

  // 2026-04-10: checkInTask and checkOutTask DELETED — task labor is now
  // canonical through time_entries. Task start/stop creates/closes time_entries
  // records via timeTrackingRepository (see techField.ts routes).

  /**
   * Close task (tenant-scoped).
   * Sets status=completed + closure metadata.
   *
   * 2026-04-10 HARDENING: Rejects if there is a running timer for this task.
   * The caller (route/service) must stop the timer before calling closeTask.
   * This prevents orphaned running time_entries on completed tasks.
   */
  async closeTask(
    companyId: string,
    taskId: string,
    userId: string
  ): Promise<typeof tasks.$inferSelect> {
    this.assertCompanyId(companyId);
    this.validateUUID(taskId, "taskId");

    const task = await this.getTask(companyId, taskId);
    if (!task) throw this.notFoundError("Task");

    // Guard: reject if active timer exists for this task
    const [runningEntry] = await db
      .select({ id: timeEntries.id })
      .from(timeEntries)
      .where(and(
        eq(timeEntries.companyId, companyId),
        eq(timeEntries.taskId, taskId),
        isNull(timeEntries.endAt),
      ))
      .limit(1);
    if (runningEntry) {
      throw this.conflictError("Cannot close task with an active timer. Stop the timer first.");
    }

    const closeTime = new Date();

    const [updated] = await db
      .update(tasks)
      .set({
        status: "completed",
        closedAt: closeTime,
        closedByUserId: userId,
      })
      .where(and(eq(tasks.id, taskId), eq(tasks.companyId, companyId)))
      .returning();

    return updated;
  }

  /**
   * Reopen task (tenant-scoped)
   */
  async reopenTask(
    companyId: string,
    taskId: string
  ): Promise<typeof tasks.$inferSelect> {
    this.assertCompanyId(companyId);
    this.validateUUID(taskId, "taskId");

    const task = await this.getTask(companyId, taskId);
    if (!task) throw this.notFoundError("Task");

    const [updated] = await db
      .update(tasks)
      .set({
        status: "pending",
        closedAt: null,
        closedByUserId: null,
      })
      .where(and(eq(tasks.id, taskId), eq(tasks.companyId, companyId)))
      .returning();

    return updated;
  }

  /**
   * Delete task (hard delete, tenant-scoped)
   */
  async deleteTask(companyId: string, taskId: string): Promise<{ success: boolean }> {
    this.assertCompanyId(companyId);
    this.validateUUID(taskId, "taskId");

    const task = await this.getTask(companyId, taskId);
    if (!task) throw this.notFoundError("Task");

    await db
      .delete(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.companyId, companyId)));

    return { success: true };
  }

  /**
   * Update task (tenant-scoped)
   * DUAL-WRITE: Writes both locationId AND clientId
   * TODO: [MIGRATION] Once locationId is fully adopted, remove clientId write
   */
  async updateTask(
    companyId: string,
    taskId: string,
    input: TaskUpdateInput
  ): Promise<typeof tasks.$inferSelect> {
    this.assertCompanyId(companyId);
    this.validateUUID(taskId, "taskId");

    const task = await this.getTask(companyId, taskId);
    if (!task) throw this.notFoundError("Task");

    const updates: any = {};

    if ("title" in input) updates.title = input.title;
    if ("notes" in input) updates.notes = input.notes;

    // Convert ISO strings to Date objects for Drizzle timestamp columns
    if ("scheduledStartAt" in input) {
      if (input.scheduledStartAt === null) {
        updates.scheduledStartAt = null;
      } else if (typeof input.scheduledStartAt === "string" && input.scheduledStartAt.trim() !== "") {
        const parsed = new Date(input.scheduledStartAt);
        if (!isNaN(parsed.getTime())) {
          updates.scheduledStartAt = parsed;
        }
      }
    }
    if ("scheduledEndAt" in input) {
      if (input.scheduledEndAt === null) {
        updates.scheduledEndAt = null;
      } else if (typeof input.scheduledEndAt === "string" && input.scheduledEndAt.trim() !== "") {
        const parsed = new Date(input.scheduledEndAt);
        if (!isNaN(parsed.getTime())) {
          updates.scheduledEndAt = parsed;
        }
      }
    }

    if ("allDay" in input) updates.allDay = input.allDay;

    // 2026-04-10 HARDENING: block jobId change if task has existing time_entries.
    // Changing jobId would cause future timer starts to write a different jobId
    // than historical entries, creating inconsistent labor attribution.
    if ("jobId" in input && input.jobId !== task.jobId) {
      const [existingLabor] = await db
        .select({ id: timeEntries.id })
        .from(timeEntries)
        .where(and(
          eq(timeEntries.companyId, companyId),
          eq(timeEntries.taskId, taskId),
        ))
        .limit(1);
      if (existingLabor) {
        throw this.conflictError(
          "Cannot change job link: this task has existing labor entries. " +
          "Reassigning the job would create inconsistent attribution."
        );
      }
      updates.jobId = input.jobId;
    }

    // DUAL-WRITE: Set both clientId and locationId when clientId changes
    if ("clientId" in input) {
      updates.clientId = input.clientId;
      updates.locationId = input.clientId;
    }

    if ("assignedToUserId" in input)
      updates.assignedToUserId = input.assignedToUserId;
    if ("estimatedDurationMinutes" in input)
      updates.estimatedDurationMinutes = input.estimatedDurationMinutes;
    if ("type" in input) updates.type = input.type;
    if ("isBillable" in input) updates.isBillable = input.isBillable;

    // Handle status changes with automatic timestamp updates
    // 2026-04-10: Legacy timing fields removed. Timer start/stop is via time_entries.
    if ("status" in input && input.status !== task.status) {
      updates.status = input.status;

      if (input.status === "completed") {
        // 2026-04-10 HARDENING: reject if active timer exists for this task
        const [runningEntry] = await db
          .select({ id: timeEntries.id })
          .from(timeEntries)
          .where(and(
            eq(timeEntries.companyId, companyId),
            eq(timeEntries.taskId, taskId),
            isNull(timeEntries.endAt),
          ))
          .limit(1);
        if (runningEntry) {
          throw this.conflictError("Cannot complete task with an active timer. Stop the timer first.");
        }
        updates.closedAt = new Date();
      }
    }

    // UTC-safe scheduling fix: replace Date objects with SQL expressions
    sanitizeSchedulingTimestamps(updates, taskId);

    const [updated] = await db
      .update(tasks)
      .set(updates)
      .where(and(eq(tasks.id, taskId), eq(tasks.companyId, companyId)))
      .returning();

    return updated;
  }

}

export const taskRepository = new TaskRepository();

// ============================================================================
// 2026-04-10: Storage-level tech task wrapper — self-assignment enforced here
// ============================================================================
//
// Defense-in-depth: even if a future route bypasses the route-level guard,
// this wrapper forces `createdByUserId = userId` and `assignedToUserId = userId`.
// The office route continues using `taskRepository.createTask` directly
// (where free assignment is allowed for MANAGER_ROLES).
//
// This wrapper does NOT duplicate storage logic — it delegates to `createTask`
// after enforcing the constraint.

export interface TechTaskInput {
  type: string;
  title: string;
  notes?: string;
  scheduledStartAt?: string;
  scheduledEndAt?: string;
  allDay?: boolean;
  estimatedDurationMinutes?: number;
  isBillable?: boolean;
}

/**
 * Create a task that is always self-assigned to the acting technician.
 *
 * Enforces at the storage boundary:
 *   - `createdByUserId = userId`
 *   - `assignedToUserId = userId`
 *
 * The caller CANNOT override either field. If a future route calls this
 * method, self-assignment holds regardless of what the request payload
 * contained. This is the only correct entry point for tech-side task
 * creation.
 */
export async function createTechTask(
  companyId: string,
  userId: string,
  input: TechTaskInput,
): Promise<typeof tasks.$inferSelect> {
  return taskRepository.createTask(companyId, {
    ...input,
    status: "pending",
    createdByUserId: userId,
    assignedToUserId: userId,
    estimatedDurationMinutes: input.estimatedDurationMinutes ?? 60,
  });
}
