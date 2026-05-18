/**
 * Canonical invalidation helpers for job-related mutations.
 *
 * Always call these helpers from mutation onSuccess/onSettled — do not
 * inline manual queryKey arrays. If a new sub-resource query is added,
 * add its key to jobKeys and update the relevant helper here.
 */
import type { QueryClient } from "@tanstack/react-query";
import { jobKeys } from "@/lib/queryKeys/jobs";

/**
 * Bust the semantic job detail + family.
 * Use after any mutation that changes job header fields, status, or
 * assignments that don't affect financial sub-resources.
 */
export function invalidateJob(qc: QueryClient, jobId: string): void {
  qc.invalidateQueries({ queryKey: jobKeys.all() });
  qc.invalidateQueries({ queryKey: jobKeys.detail(jobId) });
}

/**
 * Bust the canonical sub-resource keys for parts, expenses, and time entries.
 * Use in addition to invalidateJob() after mutations that affect these resources.
 * urlFamily() bridge covers legacy URL-pattern consumers until full migration.
 */
export function invalidateJobSubresources(
  qc: QueryClient,
  jobId: string,
): void {
  qc.invalidateQueries({ queryKey: jobKeys.parts(jobId) });
  qc.invalidateQueries({ queryKey: jobKeys.expenses(jobId) });
  qc.invalidateQueries({ queryKey: jobKeys.timeEntries(jobId) });
  qc.invalidateQueries({ queryKey: jobKeys.timeSummary(jobId) });
  // Bridge: covers legacy URL-pattern consumers still using ["/api/jobs", id, sub].
  qc.invalidateQueries({ queryKey: jobKeys.urlFamily() });
}

/**
 * Full invalidation for a job lifecycle mutation (close, reopen, undo-close).
 * Busts semantic keys, URL-pattern sub-resource keys, and the legacy
 * ["/api/jobs"] URL family prefix used by dispatch and SSE consumers.
 */
export function invalidateJobLifecycle(
  qc: QueryClient,
  jobId: string,
): void {
  invalidateJob(qc, jobId);
  invalidateJobSubresources(qc, jobId);
  // Legacy URL-pattern family prefix — covers sub-resources for any
  // other jobId that might be affected (e.g. a related job in same series)
  qc.invalidateQueries({ queryKey: jobKeys.urlFamily() });
}

/**
 * Bust only the expense sub-resource plus job detail.
 * Use in addExpenseMutation and any other expense-only mutation.
 * urlFamily() bridge covers legacy URL-pattern consumers until full migration.
 */
export function invalidateJobExpense(
  qc: QueryClient,
  jobId: string,
): void {
  qc.invalidateQueries({ queryKey: jobKeys.expenses(jobId) });
  qc.invalidateQueries({ queryKey: jobKeys.detail(jobId) });
  qc.invalidateQueries({ queryKey: jobKeys.all() });
  // Bridge: covers legacy ["/api/jobs", id, "expenses"] consumers.
  qc.invalidateQueries({ queryKey: jobKeys.urlFamily() });
}

/**
 * Bust only the parts sub-resource plus job detail and root.
 * Use in parts add/edit/delete mutations.
 * urlFamily() bridge covers legacy URL-pattern consumers until full migration.
 */
export function invalidateJobParts(
  qc: QueryClient,
  jobId: string,
): void {
  qc.invalidateQueries({ queryKey: jobKeys.parts(jobId) });
  qc.invalidateQueries({ queryKey: jobKeys.detail(jobId) });
  qc.invalidateQueries({ queryKey: jobKeys.root() });
  // Bridge: covers legacy ["/api/jobs", id, "parts"] consumers.
  qc.invalidateQueries({ queryKey: jobKeys.urlFamily() });
}

/**
 * Bust the time entries and time summary sub-resources plus job detail and root.
 * Use in time entry add/edit/delete mutations.
 * urlFamily() bridge covers legacy URL-pattern consumers until full migration.
 */
export function invalidateJobTimeEntries(
  qc: QueryClient,
  jobId: string,
): void {
  qc.invalidateQueries({ queryKey: jobKeys.timeEntries(jobId) });
  qc.invalidateQueries({ queryKey: jobKeys.timeSummary(jobId) });
  qc.invalidateQueries({ queryKey: jobKeys.detail(jobId) });
  qc.invalidateQueries({ queryKey: jobKeys.root() });
  // Bridge: covers legacy ["/api/jobs", id, "time-entries"] and "time-summary" consumers.
  qc.invalidateQueries({ queryKey: jobKeys.urlFamily() });
}

/**
 * Bust the equipment sub-resource plus job detail and root.
 * Use in equipment add/remove mutations for job-owned equipment.
 * urlFamily() bridge covers legacy URL-pattern consumers until full migration.
 */
export function invalidateJobEquipment(
  qc: QueryClient,
  jobId: string,
): void {
  qc.invalidateQueries({ queryKey: jobKeys.equipment(jobId) });
  qc.invalidateQueries({ queryKey: jobKeys.detail(jobId) });
  qc.invalidateQueries({ queryKey: jobKeys.root() });
  // Bridge: covers legacy ["/api/jobs", id, "equipment"] consumers.
  qc.invalidateQueries({ queryKey: jobKeys.urlFamily() });
}

/**
 * Bust the notes sub-resource plus job detail and root.
 * Use in note add/edit/delete mutations for job-owned notes.
 * urlFamily() bridge covers legacy URL-pattern consumers until full migration.
 */
export function invalidateJobNotes(
  qc: QueryClient,
  jobId: string,
): void {
  qc.invalidateQueries({ queryKey: jobKeys.notes(jobId) });
  qc.invalidateQueries({ queryKey: jobKeys.detail(jobId) });
  qc.invalidateQueries({ queryKey: jobKeys.root() });
  // Bridge: covers legacy ["/api/jobs", id, "notes"] consumers.
  qc.invalidateQueries({ queryKey: jobKeys.urlFamily() });
}
