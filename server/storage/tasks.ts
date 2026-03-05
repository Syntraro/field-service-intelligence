import { db } from "../db";
import { and, eq, isNull, gte, lte, desc } from "drizzle-orm";
import { tasks, supplierVisitDetails, suppliers, supplierLocations } from "@shared/schema";
import { BaseRepository, clampLimit, clampOffset } from "./base";

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
  estimatedDurationMinutes?: number;
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

    if (filters.fromDate) where.push(gte(tasks.checkedInAt, filters.fromDate));
    if (filters.toDate) where.push(lte(tasks.checkedInAt, filters.toDate));

    // Calendar integration: filter by scheduledStartAt date range
    if (filters.scheduledFromDate) where.push(gte(tasks.scheduledStartAt, filters.scheduledFromDate));
    if (filters.scheduledToDate) where.push(lte(tasks.scheduledStartAt, filters.scheduledToDate));

    // Clamp pagination params
    const offset = clampOffset(filters.offset ?? 0);
    const limit = clampLimit(filters.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    // Fetch limit + 1 to determine hasMore
    const rows = await db
      .select()
      .from(tasks)
      .where(and(...where))
      .orderBy(desc(tasks.createdAt), desc(tasks.id)) // Stable ordering
      .limit(limit + 1)
      .offset(offset);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    return { items, hasMore };
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

  /**
   * Check in to task (tenant-scoped)
   */
  async checkInTask(
    companyId: string,
    taskId: string
  ): Promise<typeof tasks.$inferSelect> {
    this.assertCompanyId(companyId);
    this.validateUUID(taskId, "taskId");

    const task = await this.getTask(companyId, taskId);
    if (!task) throw this.notFoundError("Task");
    if (task.checkedInAt) return task;

    const [updated] = await db
      .update(tasks)
      .set({
        checkedInAt: new Date(),
        status: "in_progress",
      })
      .where(and(eq(tasks.id, taskId), eq(tasks.companyId, companyId)))
      .returning();

    return updated;
  }

  /**
   * Check out of task (tenant-scoped)
   */
  async checkOutTask(
    companyId: string,
    taskId: string
  ): Promise<typeof tasks.$inferSelect> {
    this.assertCompanyId(companyId);
    this.validateUUID(taskId, "taskId");

    const task = await this.getTask(companyId, taskId);
    if (!task) throw this.notFoundError("Task");
    if (!task.checkedInAt) throw this.validationError("Cannot check out before check in");
    if (task.checkedOutAt) return task;

    const checkOutTime = new Date();
    const durationMs =
      checkOutTime.getTime() - new Date(task.checkedInAt).getTime();
    const actualDurationMinutes = Math.round(durationMs / 60000);

    const [updated] = await db
      .update(tasks)
      .set({
        checkedOutAt: checkOutTime,
        actualDurationMinutes,
      })
      .where(and(eq(tasks.id, taskId), eq(tasks.companyId, companyId)))
      .returning();

    return updated;
  }

  /**
   * Close task (tenant-scoped)
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

    const closeTime = new Date();
    const updates: any = {
      status: "completed",
      closedAt: closeTime,
      closedByUserId: userId,
    };

    // If task was checked in but not checked out, auto check-out
    if (task.checkedInAt && !task.checkedOutAt) {
      const durationMs =
        closeTime.getTime() - new Date(task.checkedInAt).getTime();
      updates.checkedOutAt = closeTime;
      updates.actualDurationMinutes = Math.round(durationMs / 60000);
    }

    const [updated] = await db
      .update(tasks)
      .set(updates)
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
    if ("jobId" in input) updates.jobId = input.jobId;

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

    // Handle status changes with automatic timestamp updates
    if ("status" in input && input.status !== task.status) {
      updates.status = input.status;

      // Auto-set checkedInAt when transitioning to in_progress
      if (input.status === "in_progress" && !task.checkedInAt) {
        updates.checkedInAt = new Date();
      }

      // Auto-set checkedOutAt and calculate duration when transitioning to completed
      if (input.status === "completed") {
        const completionTime = new Date();
        updates.closedAt = completionTime;

        if (task.checkedInAt && !task.checkedOutAt) {
          const durationMs =
            completionTime.getTime() - new Date(task.checkedInAt).getTime();
          updates.checkedOutAt = completionTime;
          updates.actualDurationMinutes = Math.round(durationMs / 60000);
        }
      }
    }

    const [updated] = await db
      .update(tasks)
      .set(updates)
      .where(and(eq(tasks.id, taskId), eq(tasks.companyId, companyId)))
      .returning();

    return updated;
  }

  // ========================================
  // SUPPLIER VISIT DETAILS
  // ========================================

  /**
   * Get supplier visit details for a task
   * NOTE: Task ownership must be verified before calling this
   */
  async getSupplierVisitDetails(
    companyId: string,
    taskId: string
  ): Promise<typeof supplierVisitDetails.$inferSelect | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(taskId, "taskId");

    // Verify task ownership first (tenant isolation)
    const task = await this.getTask(companyId, taskId);
    if (!task) throw this.notFoundError("Task");

    const [details] = await db
      .select()
      .from(supplierVisitDetails)
      .where(eq(supplierVisitDetails.taskId, taskId));

    return details ?? null;
  }

  /**
   * Validate supplier and supplier location references before writing.
   * Ensures tenant isolation and that location belongs to supplier.
   */
  private async validateSupplierRefs(
    companyId: string,
    supplierId: string | null | undefined,
    supplierLocationId: string | null | undefined,
  ): Promise<void> {
    // If clearing both, nothing to validate
    if (!supplierId && !supplierLocationId) return;

    // If locationId provided without supplierId, reject
    if (supplierLocationId && !supplierId) {
      throw this.validationError("Supplier location requires a supplier to be selected.");
    }

    // Validate supplierId exists and belongs to company
    if (supplierId) {
      const [supplier] = await db
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(and(eq(suppliers.id, supplierId), eq(suppliers.companyId, companyId)));
      if (!supplier) {
        throw this.validationError("Selected supplier not found or does not belong to your company.");
      }
    }

    // Validate supplierLocationId belongs to supplierId and company
    if (supplierLocationId && supplierId) {
      const [location] = await db
        .select({ id: supplierLocations.id })
        .from(supplierLocations)
        .where(and(
          eq(supplierLocations.id, supplierLocationId),
          eq(supplierLocations.supplierId, supplierId),
          eq(supplierLocations.companyId, companyId),
        ));
      if (!location) {
        throw this.validationError("Selected supplier location does not belong to the selected supplier.");
      }
    }
  }

  /**
   * Update/create supplier visit details (tenant-scoped via task ownership).
   * Validates supplier/location references before writing.
   */
  async updateSupplierVisit(
    companyId: string,
    taskId: string,
    input: {
      supplierId?: string | null;
      supplierLocationId?: string | null;
      supplierNameOther?: string | null;
      poNumber?: string | null;
      reconcile?: boolean;
      reconciledByUserId?: string;
    }
  ): Promise<typeof supplierVisitDetails.$inferSelect> {
    this.assertCompanyId(companyId);
    this.validateUUID(taskId, "taskId");

    // Verify task ownership first (tenant isolation)
    const task = await this.getTask(companyId, taskId);
    if (!task) throw this.notFoundError("Task");

    // Validate supplier/location references (tenant-scoped, relationship check)
    await this.validateSupplierRefs(companyId, input.supplierId, input.supplierLocationId);

    return await db.transaction(async (tx) => {
      // Check if supplier visit details exist
      const [existing] = await tx
        .select()
        .from(supplierVisitDetails)
        .where(eq(supplierVisitDetails.taskId, taskId));

      const updates: any = {
        supplierId: input.supplierId ?? null,
        supplierLocationId: input.supplierLocationId ?? null,
        supplierNameOther: input.supplierNameOther ?? null,
        poNumber: input.poNumber ?? null,
        updatedAt: new Date(),
      };

      if (input.reconcile) {
        updates.reconciledAt = new Date();
        updates.reconciledByUserId = input.reconciledByUserId;
      }

      // Insert or update
      if (existing) {
        const [updated] = await tx
          .update(supplierVisitDetails)
          .set(updates)
          .where(eq(supplierVisitDetails.taskId, taskId))
          .returning();
        return updated;
      } else {
        const [created] = await tx
          .insert(supplierVisitDetails)
          .values({
            taskId,
            ...updates,
          })
          .returning();
        return created;
      }
    });
  }
}

export const taskRepository = new TaskRepository();
