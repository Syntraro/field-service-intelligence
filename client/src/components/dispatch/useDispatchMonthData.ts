/**
 * useDispatchMonthData — Month view data adapter.
 * Thin wrapper over useDispatchRangeData with month-grid-scoped range.
 * Same architectural pattern as Day and Week adapters:
 *   raw shared range data → thin view-specific shaping → pure render component.
 *
 * 2026-03-31: Created for data-layer consistency across all three views.
 * Not an independent fetch system — delegates entirely to dispatchDataCore.
 */
import { useMemo } from "react";
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  startOfDay, endOfDay, format,
} from "date-fns";
import type { DispatchVisit, DispatchLeadVisit } from "./dispatchPreviewTypes";
import { getDispatchDayKey } from "./dispatchPreviewUtils";
import { useDispatchRangeData, widenStartForAllDay } from "./dispatchDataCore";

export function useDispatchMonthData(selectedDate: Date, enabled = true) {
  const monthStart = startOfMonth(selectedDate);
  const monthEnd = endOfMonth(selectedDate);
  // Grid extends to full weeks surrounding the month
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const localStartISO = startOfDay(gridStart).toISOString();
  const endISO = endOfDay(gridEnd).toISOString();
  const startISO = widenStartForAllDay(gridStart, localStartISO);

  const rangeData = useDispatchRangeData(
    startISO,
    endISO,
    `dispatch-month-${format(monthStart, "yyyy-MM")}`,
    1000,
    enabled,
  );

  /** Visits grouped by canonical day key for month grid cells */
  const visitsByDay = useMemo(() => {
    const map = new Map<string, DispatchVisit[]>();
    for (const v of rangeData.scheduledVisits) {
      if (!v.scheduledStart) continue;
      const key = getDispatchDayKey(v.scheduledStart, v.isAllDay);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(v);
    }
    return map;
  }, [rangeData.scheduledVisits]);

  /**
   * 2026-05-05 Phase 3: lead visits grouped by canonical day key for
   * the month grid. Parallel map to `visitsByDay` — never merged
   * client-side at the data layer either. The render layer
   * (MonthDispatchGrid) reads both and combines per-cell with a
   * type-safe branch render so lead-visit pills can pick up amber
   * styling and the "Lead" label without ever flowing through
   * job-shaped code.
   */
  const leadVisitsByDay = useMemo(() => {
    const map = new Map<string, DispatchLeadVisit[]>();
    for (const v of rangeData.leadVisits) {
      if (!v.scheduledStart) continue;
      const key = getDispatchDayKey(v.scheduledStart, v.isAllDay);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(v);
    }
    return map;
  }, [rangeData.leadVisits]);

  return {
    ...rangeData,
    gridStart,
    gridEnd,
    visitsByDay,
    leadVisitsByDay,
  };
}
