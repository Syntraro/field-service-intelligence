/**
 * Canonical invalidation helpers for dashboard / KPI mutations.
 *
 * The semantic ["dashboard"] prefix catches:
 *   ["dashboard", "financial"], ["dashboard", "workflow"], ["dashboard", "today-summary"]
 *
 * The URL-pattern capacity key (["/api/dashboard/capacity"]) is NOT caught
 * by prefix-matching against ["dashboard"] — it must be invalidated separately.
 *
 * The SSE dispatch stream (useDispatchStream.ts) already handles its own
 * invalidation set for realtime signals. Call invalidateDashboard() from
 * mutations (close job, create invoice, etc.) to cover the non-SSE path.
 */
import type { QueryClient } from "@tanstack/react-query";
import { dashboardKeys } from "@/lib/queryKeys/dashboard";

/**
 * Full dashboard invalidation: semantic family + capacity URL key + action modal.
 * Use after any mutation that affects job counts, financial totals, or
 * technician workload (close job, create invoice, create payment, etc.).
 */
export function invalidateDashboard(qc: QueryClient): void {
  // Busts ["dashboard", "financial"], ["dashboard", "workflow"],
  // ["dashboard", "today-summary"] via prefix-matching
  qc.invalidateQueries({ queryKey: dashboardKeys.all() });
  // Action modal item lists (separate prefix)
  qc.invalidateQueries({ queryKey: dashboardKeys.actionModal() });
  // URL-pattern capacity key — NOT caught by the semantic prefix above
  qc.invalidateQueries({ queryKey: dashboardKeys.capacity() });
}
