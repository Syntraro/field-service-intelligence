import { db } from "../db.ts";
import { tasks, supplierVisitDetails } from "../../shared/schema.ts";
import { and, eq, isNull, gte, lte, desc } from "drizzle-orm";

/**
 * Notes:
 * - DB tables come from shared/schema.ts (canonical Drizzle schema location)
 * - This file is backend-only service logic
 * - ALL functions require companyId for tenant isolation
 */

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
  offset?: number;
  limit?: number;
}

export interface TaskListResult {
  items: any[];
  hasMore: boolean;
}

/* =========================================================
   CREATE TASK
   ========================================================= */
export async function createTask(companyId: string, input: any) {
  if (!input.createdByUserId) {
    throw new Error("createdByUserId is required");
  }

  // Build values object, only including defined fields
  const values: any = {
    companyId, // Use passed companyId, not from input
    createdByUserId: input.createdByUserId,
    type: input.type, // "GENERAL" | "SUPPLIER_VISIT"
    title: input.title,
    status: input.status ?? "pending",
    allDay: input.allDay ?? false,
  };

  // Only add optional fields if they're defined and valid
  if (input.assignedToUserId !== undefined) values.assignedToUserId = input.assignedToUserId;
  if (input.notes !== undefined) values.notes = input.notes;

  // For date fields, ensure they're valid ISO strings or undefined
  if (input.scheduledStartAt !== undefined && input.scheduledStartAt !== null) {
    if (typeof input.scheduledStartAt === 'string' && input.scheduledStartAt.trim() !== '') {
      values.scheduledStartAt = input.scheduledStartAt;
    }
  }
  if (input.scheduledEndAt !== undefined && input.scheduledEndAt !== null) {
    if (typeof input.scheduledEndAt === 'string' && input.scheduledEndAt.trim() !== '') {
      values.scheduledEndAt = input.scheduledEndAt;
    }
  }

  if (input.jobId !== undefined) values.jobId = input.jobId;
  if (input.clientId !== undefined) values.clientId = input.clientId;
  if (input.estimatedDurationMinutes !== undefined) values.estimatedDurationMinutes = input.estimatedDurationMinutes;

  const [task] = await db
    .insert(tasks)
    .values(values)
    .returning();

  return task;
}

/* =========================================================
   LIST TASKS (FILTERED) - DB-LAYER PAGINATION
   ========================================================= */
export async function listTasks(filters: TaskListFilters): Promise<TaskListResult> {
  // companyId is REQUIRED for tenant isolation
  if (!filters.companyId) {
    throw new Error("companyId is required for tenant isolation");
  }

  const where: any[] = [eq(tasks.companyId, filters.companyId)]; // ALWAYS filter by tenant

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

  // Clamp pagination params
  const offset = Math.max(0, filters.offset ?? 0);
  const limit = Math.min(MAX_LIMIT, Math.max(1, filters.limit ?? DEFAULT_LIMIT));

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

/* =========================================================
   GET SINGLE TASK (with tenant check)
   ========================================================= */
export async function getTask(companyId: string, taskId: string) {
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.companyId, companyId)));

  return task ?? null;
}

/* =========================================================
   ASSIGN / UNASSIGN
   ========================================================= */
export async function assignTask(companyId: string, taskId: string, assignedToUserId: string | null) {
  const [updated] = await db
    .update(tasks)
    .set({ assignedToUserId })
    .where(and(eq(tasks.id, taskId), eq(tasks.companyId, companyId)))
    .returning();

  if (!updated) throw new Error("Task not found or access denied");
  return updated;
}

/* =========================================================
   CHECK-IN / CHECK-OUT
   ========================================================= */
export async function checkInTask(companyId: string, taskId: string) {
  const task = await getTask(companyId, taskId);
  if (!task) throw new Error("Task not found or access denied");
  if (task.checkedInAt) return task;

  const [updated] = await db
    .update(tasks)
    .set({
      checkedInAt: new Date(),
      status: "in_progress", // Auto-set status when checking in
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.companyId, companyId)))
    .returning();

  return updated;
}

export async function checkOutTask(companyId: string, taskId: string) {
  const task = await getTask(companyId, taskId);
  if (!task) throw new Error("Task not found or access denied");
  if (!task.checkedInAt) throw new Error("Cannot check out before check in");
  if (task.checkedOutAt) return task;

  const checkOutTime = new Date();

  // Calculate actual duration in minutes
  const durationMs = checkOutTime.getTime() - new Date(task.checkedInAt).getTime();
  const actualDurationMinutes = Math.round(durationMs / 60000); // Convert ms to minutes

  const [updated] = await db
    .update(tasks)
    .set({
      checkedOutAt: checkOutTime,
      actualDurationMinutes, // Auto-calculated duration
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.companyId, companyId)))
    .returning();

  return updated;
}

/* =========================================================
   CLOSE TASK
   ========================================================= */
export async function closeTask(companyId: string, taskId: string, userId: string) {
  const task = await getTask(companyId, taskId);
  if (!task) throw new Error("Task not found or access denied");

  const closeTime = new Date();
  const updates: any = {
    status: "completed", // Use enum value instead of "CLOSED"
    closedAt: closeTime,
    closedByUserId: userId,
  };

  // If task was checked in but not checked out, auto check-out and calculate duration
  if (task.checkedInAt && !task.checkedOutAt) {
    const durationMs = closeTime.getTime() - new Date(task.checkedInAt).getTime();
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

/* =========================================================
   REOPEN TASK
   ========================================================= */
export async function reopenTask(companyId: string, taskId: string) {
  const task = await getTask(companyId, taskId);
  if (!task) throw new Error("Task not found or access denied");

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

/* =========================================================
   DELETE TASK
   ========================================================= */
export async function deleteTask(companyId: string, taskId: string) {
  const task = await getTask(companyId, taskId);
  if (!task) throw new Error("Task not found or access denied");

  await db
    .delete(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.companyId, companyId)));

  return { success: true };
}

/* =========================================================
   ADMIN UPDATE (title/notes/schedule/job link/status)
   ========================================================= */
export async function updateTask(companyId: string, taskId: string, input: any) {
  const task = await getTask(companyId, taskId);
  if (!task) throw new Error("Task not found or access denied");

  const updates: any = {};

  if ("title" in input) updates.title = input.title;
  if ("notes" in input) updates.notes = input.notes;
  if ("scheduledStartAt" in input) updates.scheduledStartAt = input.scheduledStartAt;
  if ("scheduledEndAt" in input) updates.scheduledEndAt = input.scheduledEndAt;
  if ("allDay" in input) updates.allDay = input.allDay;
  if ("jobId" in input) updates.jobId = input.jobId;
  if ("clientId" in input) updates.clientId = input.clientId;
  if ("assignedToUserId" in input) updates.assignedToUserId = input.assignedToUserId;
  if ("estimatedDurationMinutes" in input) updates.estimatedDurationMinutes = input.estimatedDurationMinutes;
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
        const durationMs = completionTime.getTime() - new Date(task.checkedInAt).getTime();
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

/* =========================================================
   GET SUPPLIER VISIT DETAILS
   ========================================================= */
export async function getSupplierVisitDetails(taskId: string) {
  const [details] = await db
    .select()
    .from(supplierVisitDetails)
    .where(eq(supplierVisitDetails.taskId, taskId));

  return details ?? null;
}

/* =========================================================
   SUPPLIER VISIT UPDATE (OFFICE RECONCILIATION)
   ========================================================= */
export async function updateSupplierVisit(companyId: string, taskId: string, input: any) {
  // Verify task ownership first
  const task = await getTask(companyId, taskId);
  if (!task) throw new Error("Task not found or access denied");

  return db.transaction(async (tx) => {
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
