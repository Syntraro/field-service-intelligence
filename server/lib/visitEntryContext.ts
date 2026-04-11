/**
 * visitEntryContext — Isolates visit attribution logic for time entries.
 *
 * 2026-04-10 LOCKDOWN: Preparation for future visitId column on time_entries.
 * Currently, visit entries are identified by type + jobId. This helper
 * centralizes that logic so adding visitId later requires changes in ONE place.
 *
 * Usage:
 *   const ctx = getVisitContextFromEntry(entry);
 *   if (ctx.isVisitEntry) { ... ctx.jobId ... }
 */

import type { TimeEntryType } from "@shared/schema";

/** Time entry types that represent visit labor (not task, not admin). */
const VISIT_ENTRY_TYPES: ReadonlySet<string> = new Set([
  "travel_to_job",
  "on_site",
  "travel_to_supplier",
  "supplier_run",
  "travel_between_jobs",
]);

interface VisitContext {
  /** True if this entry represents visit labor (not task_work, admin, break, other). */
  isVisitEntry: boolean;
  /** True if this entry represents task labor. */
  isTaskEntry: boolean;
  /** The job this entry is attributed to (from time_entries.jobId snapshot). */
  jobId: string | null;
  /** The task this entry is attributed to (from time_entries.taskId snapshot). */
  taskId: string | null;
}

/**
 * Derive visit/task context from a time entry row.
 *
 * This function does NOT query the database — it operates on the
 * already-snapshotted fields of the time_entry record.
 */
export function getVisitContextFromEntry(entry: {
  type: string;
  jobId: string | null;
  taskId: string | null;
}): VisitContext {
  return {
    isVisitEntry: VISIT_ENTRY_TYPES.has(entry.type),
    isTaskEntry: entry.type === "task_work",
    jobId: entry.jobId,
    taskId: entry.taskId,
  };
}

/**
 * Check if a time entry type is a visit-related type.
 */
export function isVisitEntryType(type: string): boolean {
  return VISIT_ENTRY_TYPES.has(type);
}
