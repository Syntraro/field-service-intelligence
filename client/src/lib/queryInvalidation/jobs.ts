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
 * Bust the URL-pattern financial sub-resource keys for a job.
 * Use in addition to invalidateJob() after any mutation that changes
 * parts, expenses, or time entries — these keys are NOT caught by
 * the semantic ["jobs"] family prefix.
 */
export function invalidateJobSubresources(
  qc: QueryClient,
  jobId: string,
): void {
  qc.invalidateQueries({ queryKey: jobKeys.parts(jobId) });
  qc.invalidateQueries({ queryKey: jobKeys.expenses(jobId) });
  qc.invalidateQueries({ queryKey: jobKeys.timeEntries(jobId) });
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
 */
export function invalidateJobExpense(
  qc: QueryClient,
  jobId: string,
): void {
  qc.invalidateQueries({ queryKey: jobKeys.expenses(jobId) });
  qc.invalidateQueries({ queryKey: jobKeys.detail(jobId) });
  qc.invalidateQueries({ queryKey: jobKeys.all() });
}
