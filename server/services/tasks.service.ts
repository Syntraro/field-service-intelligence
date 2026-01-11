/**
 * Task Service
 *
 * Thin wrapper around taskRepository for backward compatibility.
 * All database operations are delegated to the storage layer.
 *
 * Notes:
 * - ALL functions require companyId for tenant isolation
 * - DUAL-WRITE: Both locationId AND clientId are written for migration
 * - TODO: [MIGRATION] Once locationId is fully adopted, remove clientId references
 */

import { taskRepository } from "../storage/tasks";
import type { TaskListFilters, TaskListResult, TaskCreateInput, TaskUpdateInput } from "../storage/tasks";

// Re-export types for consumers
export type { TaskListFilters, TaskListResult, TaskCreateInput, TaskUpdateInput };

/* =========================================================
   CREATE TASK
   ========================================================= */
export async function createTask(companyId: string, input: TaskCreateInput) {
  return taskRepository.createTask(companyId, input);
}

/* =========================================================
   LIST TASKS (FILTERED)
   ========================================================= */
export async function listTasks(filters: TaskListFilters): Promise<TaskListResult> {
  return taskRepository.listTasks(filters);
}

/* =========================================================
   GET SINGLE TASK
   ========================================================= */
export async function getTask(companyId: string, taskId: string) {
  return taskRepository.getTask(companyId, taskId);
}

/* =========================================================
   ASSIGN / UNASSIGN
   ========================================================= */
export async function assignTask(companyId: string, taskId: string, assignedToUserId: string | null) {
  return taskRepository.assignTask(companyId, taskId, assignedToUserId);
}

/* =========================================================
   CHECK-IN / CHECK-OUT
   ========================================================= */
export async function checkInTask(companyId: string, taskId: string) {
  return taskRepository.checkInTask(companyId, taskId);
}

export async function checkOutTask(companyId: string, taskId: string) {
  return taskRepository.checkOutTask(companyId, taskId);
}

/* =========================================================
   CLOSE TASK
   ========================================================= */
export async function closeTask(companyId: string, taskId: string, userId: string) {
  return taskRepository.closeTask(companyId, taskId, userId);
}

/* =========================================================
   REOPEN TASK
   ========================================================= */
export async function reopenTask(companyId: string, taskId: string) {
  return taskRepository.reopenTask(companyId, taskId);
}

/* =========================================================
   DELETE TASK
   ========================================================= */
export async function deleteTask(companyId: string, taskId: string) {
  return taskRepository.deleteTask(companyId, taskId);
}

/* =========================================================
   UPDATE TASK
   ========================================================= */
export async function updateTask(companyId: string, taskId: string, input: TaskUpdateInput) {
  return taskRepository.updateTask(companyId, taskId, input);
}

/* =========================================================
   GET SUPPLIER VISIT DETAILS
   ========================================================= */
export async function getSupplierVisitDetails(companyId: string, taskId: string) {
  return taskRepository.getSupplierVisitDetails(companyId, taskId);
}

/* =========================================================
   SUPPLIER VISIT UPDATE (OFFICE RECONCILIATION)
   ========================================================= */
export async function updateSupplierVisit(
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
) {
  return taskRepository.updateSupplierVisit(companyId, taskId, input);
}
