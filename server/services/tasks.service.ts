import { db } from "../db";
import { tasks, supplierVisitDetails } from "../db/schema/tasks";
import { eq, and } from "drizzle-orm";

export async function createTask(input: {
  companyId: string;
  createdByUserId: string;
  assignedToUserId?: string | null;
  type: "GENERAL" | "SUPPLIER_VISIT";
  title: string;
  notes?: string | null;
  scheduledStartAt?: Date | null;
  scheduledEndAt?: Date | null;
  allDay?: boolean;
  jobId?: string | null;

  // supplier visit only
  supplierId?: string | null;
  supplierNameOther?: string | null;
  poNumber?: string | null;
}) {
  return db.transaction(async (tx) => {
    const [task] = await tx
      .insert(tasks)
      .values({
        companyId: input.companyId,
        createdByUserId: input.createdByUserId,
        assignedToUserId: input.assignedToUserId ?? null,
        type: input.type,
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
export async function checkInTask(taskId: string) {
  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, taskId));

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
  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, taskId));

  if (!task) throw new Error("Task not found");
  if (!task.checkedInAt)
    throw new Error("Cannot check out before check in");

  if (task.checkedOutAt) return task;

  const [updated] = await db
    .update(tasks)
    .set({ checkedOutAt: new Date() })
    .where(eq(tasks.id, taskId))
    .returning();

  return updated;
}
export async function closeTask(taskId: string, userId: string) {
  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, taskId));

  if (!task) throw new Error("Task not found");

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
export async function updateSupplierVisit(
  taskId: string,
  input: {
    supplierId?: string | null;
    supplierNameOther?: string | null;
    poNumber?: string | null;
    reconcile?: boolean;
    reconciledByUserId?: string;
  }
) {
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
