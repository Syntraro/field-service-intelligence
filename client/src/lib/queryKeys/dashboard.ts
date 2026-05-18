/**
 * Canonical query key definitions for dashboard and KPI queries.
 *
 * Dashboard keys use BOTH patterns:
 *   - Pattern B (semantic) for the main operational widgets: ["dashboard", ...]
 *   - Pattern A (URL) for the capacity rail: ["/api/dashboard/capacity", ...]
 *
 * invalidateQueries({ queryKey: ["dashboard"] }) catches the semantic keys
 * via prefix-matching but does NOT catch the URL-pattern capacity key.
 * Use invalidateDashboard() to bust the full set.
 *
 * "dashboard-action" is a standalone key used by the dashboard action modal.
 * It is intentionally a separate prefix so mutations can target it narrowly.
 */

export const dashboardKeys = {
  // ── Semantic keys (Pattern B) ──

  /** ["dashboard"] — family prefix for all semantic dashboard keys */
  all: () => ["dashboard"] as const,

  /** ["dashboard", "financial"] — financial KPI summary widget */
  financial: () => ["dashboard", "financial"] as const,

  /** ["dashboard", "workflow"] — workflow summary widget (jobs/invoices/quotes/PM) */
  workflow: () => ["dashboard", "workflow"] as const,

  /** ["dashboard", "today-summary"] — today's operations live counts */
  todaySummary: () => ["dashboard", "today-summary"] as const,

  /** ["dashboard-action"] — action modal item lists (overdue/on_hold/unscheduled/ready_to_invoice) */
  actionModal: () => ["dashboard-action"] as const,

  // ── URL-pattern keys (Pattern A) ──

  /**
   * ["/api/dashboard/capacity"] or ["/api/dashboard/capacity", date] —
   * technician workload rail schedule rows.
   * NOT caught by dashboardKeys.all() prefix. Must be invalidated explicitly.
   */
  capacity: (date?: string) =>
    date
      ? (["/api/dashboard/capacity", date] as const)
      : (["/api/dashboard/capacity"] as const),
};
