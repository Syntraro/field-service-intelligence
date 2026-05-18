/**
 * Canonical query key definitions for visit-related queries.
 *
 * Job visits intentionally remain in the visitKeys family rather than under
 * jobKeys.detail(id, "visits"). Reason: visit invalidation is cross-cutting —
 * dispatch, calendar, and KPI workflows bust the ["visits"] root prefix
 * globally without needing to know the jobId. Moving visits under the jobs
 * hierarchy would require every dispatch/calendar mutation to know which
 * jobId is affected, which is not always possible (e.g. bulk reschedule,
 * drag-drop from unscheduled rail).
 *
 * Do not move ["visits", jobId, "all"] under jobKeys.
 *
 * Job-owned sub-resources (parts, expenses, notes, etc.) must live under:
 *   ["jobs", "detail", jobId, <sub>]
 *
 * Visit-scoped resources remain under:
 *   ["visits", ...]
 */

export const visitKeys = {
  /** ["visits"] — semantic family root; prefix-matches all visit cache entries */
  root: () => ["visits"] as const,

  /** ["visits", jobId, "all"] — all visits for a job (used by useJobVisits hook) */
  jobVisits: (jobId: string) => ["visits", jobId, "all"] as const,

  /**
   * ["visits", "summary-week", weekStart, weekEnd] — weekly visit count KPI.
   * Used by JobKpiStrip for the "This Week" tile.
   */
  summaryWeek: (weekStart: string, weekEnd: string) =>
    ["visits", "summary-week", weekStart, weekEnd] as const,

  /**
   * ["visits", "summary-month", monthStart, monthEnd] — monthly visit count KPI.
   * Used by JobKpiStrip for the "This Month" tile.
   */
  summaryMonth: (monthStart: string, monthEnd: string) =>
    ["visits", "summary-month", monthStart, monthEnd] as const,

  /**
   * ["visits", "summary-scheduled", from] — upcoming scheduled visits count.
   * Used by JobKpiStrip for the "Scheduled" tile.
   */
  summaryScheduled: (from: string) =>
    ["visits", "summary-scheduled", from] as const,
};
