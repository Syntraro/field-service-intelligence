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

  return db.transaction(async (tx) => {
    const [task] = await tx
      .insert(tasks)
      .values({
        companyId, // Use passed companyId, not from input
        createdByUserId: input.createdByUserId,
        assignedToUserId: input.assignedToUserId ?? null,
        type: input.type, // "GENERAL" | "SUPPLIER_VISIT"
        title: input.title,
        notes: input.notes ?? null,
        scheduledStartAt: input.scheduledStartAt ?? null,
        scheduledEndAt: input.scheduledEndAt ?? null,
        allDay: input.allDay ?? false,
        jobId: input.jobId ?? null,
      })
      .returning();

    if (input.type === "SUPPLIER_VISIT") {
      await tx.insert(supplierVisitDetails).values({
        taskId: task.id,
        supplierId: input.supplierId ?? null,
        supplierNameOther: input.supplierNameOther ?? null,
        poNumber: input.poNumber ?? null,
      });
    }

    return task;
  });
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
    .set({ checkedInAt: new Date() })
    .where(and(eq(tasks.id, taskId), eq(tasks.companyId, companyId)))
    .returning();

  return updated;
}

export async function checkOutTask(companyId: string, taskId: string) {
  const task = await getTask(companyId, taskId);
  if (!task) throw new Error("Task not found or access denied");
  if (!task.checkedInAt) throw new Error("Cannot check out before check in");
  if (task.checkedOutAt) return task;

  const [updated] = await db
    .update(tasks)
    .set({ checkedOutAt: new Date() })
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

  const [updated] = await db
    .update(tasks)
    .set({
      status: "CLOSED",
      closedAt: new Date(),
      closedByUserId: userId,
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.companyId, companyId)))
    .returning();

  return updated;
}

/* =========================================================
   ADMIN UPDATE (title/notes/schedule/job link)
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

  const [updated] = await db
    .update(tasks)
    .set(updates)
    .where(and(eq(tasks.id, taskId), eq(tasks.companyId, companyId)))
    .returning();

  return updated;
}

/* =========================================================
   SUPPLIER VISIT UPDATE (OFFICE RECONCILIATION)
   ========================================================= */
export async function updateSupplierVisit(companyId: string, taskId: string, input: any) {
  // Verify task ownership first
  const task = await getTask(companyId, taskId);
  if (!task) throw new Error("Task not found or access denied");

  const updates: any = {
    supplierId: input.supplierId ?? null,
    supplierNameOther: input.supplierNameOther ?? null,
    poNumber: input.poNumber ?? null,
  };

  if (input.reconcile) {
    updates.reconciledAt = new Date();
    updates.reconciledByUserId = input.reconciledByUserId;
  }

  const [updated] = await db
    .update(supplierVisitDetails)
    .set(updates)
    .where(eq(supplierVisitDetails.taskId, taskId))
    .returning();

  return updated;
}
