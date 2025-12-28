import { db } from "../db.ts";
import { tasks, supplierVisitDetails } from "../../shared/schema.ts";
import { and, eq, isNull, gte, lte } from "drizzle-orm";

/**
 * Notes:
 * - DB tables come from shared/schema.ts (canonical Drizzle schema location)
 * - This file is backend-only service logic
 */

/* =========================================================
   CREATE TASK
   ========================================================= */
export async function createTask(input: any) {
  return db.transaction(async (tx) => {
    const [task] = await tx
      .insert(tasks)
      .values({
        companyId: input.companyId,
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
   LIST TASKS (FILTERED)
   ========================================================= */
export async function listTasks(filters: any) {
  const where: any[] = [];

  if (filters.companyId) where.push(eq(tasks.companyId, filters.companyId));
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

  return db
    .select()
    .from(tasks)
    .where(where.length ? and(...where) : undefined)
    .orderBy(tasks.createdAt);
}

/* =========================================================
   ASSIGN / UNASSIGN
   ========================================================= */
export async function assignTask(taskId: string, assignedToUserId: string | null) {
  const [updated] = await db
    .update(tasks)
    .set({ assignedToUserId })
    .where(eq(tasks.id, taskId))
    .returning();

  return updated;
}

/* =========================================================
   CHECK-IN / CHECK-OUT
   ========================================================= */
export async function checkInTask(taskId: string) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw new Error("Task not found");
  if (task.checkedInAt) return task;

  const [updated] = await db
    .update(tasks)
    .set({ checkedInAt: new Date() })
    .where(eq(tasks.id, taskId))
    .returning();

  return updated;
}

export async function checkOutTask(taskId: string) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw new Error("Task not found");
  if (!task.checkedInAt) throw new Error("Cannot check out before check in");
  if (task.checkedOutAt) return task;

  const [updated] = await db
    .update(tasks)
    .set({ checkedOutAt: new Date() })
    .where(eq(tasks.id, taskId))
    .returning();

  return updated;
}

/* =========================================================
   CLOSE TASK
   ========================================================= */
export async function closeTask(taskId: string, userId: string) {
  const [updated] = await db
    .update(tasks)
    .set({
      status: "CLOSED",
      closedAt: new Date(),
      closedByUserId: userId,
    })
    .where(eq(tasks.id, taskId))
    .returning();

  return updated;
}

/* =========================================================
   ADMIN UPDATE (title/notes/schedule/job link)
   ========================================================= */
export async function updateTask(taskId: string, input: any) {
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
    .where(eq(tasks.id, taskId))
    .returning();

  return updated;
}

/* =========================================================
   SUPPLIER VISIT UPDATE (OFFICE RECONCILIATION)
   ========================================================= */
export async function updateSupplierVisit(taskId: string, input: any) {
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
