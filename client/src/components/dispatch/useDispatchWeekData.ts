/**
 * useDispatchWeekData — Week view data hook.
 * Thin wrapper over useDispatchRangeData with week-scoped range and
 * tech-by-day grouping for the week grid.
 *
 * 2026-03-31: Refactored to use shared dispatchDataCore. Fetch/normalize
 * logic deduplicated — only week-specific date computation and grouping
 * remain here.
 */
import { useMemo } from "react";
import { startOfWeek, endOfWeek, eachDayOfInterval, startOfDay, endOfDay, format } from "date-fns";
import type { DispatchVisit, DispatchTask } from "./dispatchPreviewTypes";
import { UNASSIGNED_TECH_ID } from "./dispatchPreviewTypes";
import { getDispatchDayKey } from "./dispatchPreviewUtils";
import { useDispatchRangeData, widenStartForAllDay } from "./dispatchDataCore";

export function useDispatchWeekData(selectedDate: Date, enabled = true) {
  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(selectedDate, { weekStartsOn: 1 });
  const localWeekStartISO = startOfDay(weekStart).toISOString();
  const weekEndISO = endOfDay(weekEnd).toISOString();
  const weekStartISO = widenStartForAllDay(weekStart, localWeekStartISO);

  const rangeData = useDispatchRangeData(
    weekStartISO,
    weekEndISO,
    `dispatch-week-${format(weekStart, "yyyy-MM-dd")}`,
    500,
    enabled,
  );

  const weekDays = useMemo(
    () => eachDayOfInterval({ start: weekStart, end: weekEnd }),
    [weekStart.getTime(), weekEnd.getTime()],
  );

  /** Multi-tech: visits grouped by each assigned technicianId -> "yyyy-MM-dd" -> DispatchVisit[]
   *  Unassigned visits bucketed under UNASSIGNED_TECH_ID.
   *
   *  2026-04-19 dispatch-drift fix: group STRICTLY by `visit.technicianIds`
   *  (the canonical visit-level crew array). The previous fallback to the
   *  scalar `visit.technicianId` (= `assignedTechnicianIds[0]`) was a stale-
   *  state hazard: if any optimistic update ever sets the scalar without
   *  clearing the array, an unassigned visit lingers under the prior
   *  technician's lane. The scalar field stays on `DispatchVisit` for
   *  color/DnD callers but is no longer authoritative for placement. */
  const visitsByTechByDay = useMemo(() => {
    const map = new Map<string, Map<string, DispatchVisit[]>>();
    for (const visit of rangeData.scheduledVisits) {
      if (!visit.scheduledStart) continue;
      const techIds = visit.technicianIds;
      const dayKey = getDispatchDayKey(visit.scheduledStart, visit.isAllDay);
      if (techIds.length === 0) {
        if (!map.has(UNASSIGNED_TECH_ID)) map.set(UNASSIGNED_TECH_ID, new Map());
        const uMap = map.get(UNASSIGNED_TECH_ID)!;
        if (!uMap.has(dayKey)) uMap.set(dayKey, []);
        uMap.get(dayKey)!.push(visit);
        continue;
      }
      for (const tid of techIds) {
        if (!map.has(tid)) map.set(tid, new Map());
        const techMap = map.get(tid)!;
        if (!techMap.has(dayKey)) techMap.set(dayKey, []);
        techMap.get(dayKey)!.push(visit);
      }
    }
    return map;
  }, [rangeData.scheduledVisits]);

  /** Tasks grouped by assignedToUserId -> "yyyy-MM-dd" -> DispatchTask[] */
  const tasksByTechByDay = useMemo(() => {
    const map = new Map<string, Map<string, DispatchTask[]>>();
    for (const task of rangeData.scheduledTasks) {
      if (!task.scheduledStart || !task.assignedToUserId) continue;
      const dayKey = getDispatchDayKey(task.scheduledStart, false);
      if (!map.has(task.assignedToUserId)) map.set(task.assignedToUserId, new Map());
      const techMap = map.get(task.assignedToUserId)!;
      if (!techMap.has(dayKey)) techMap.set(dayKey, []);
      techMap.get(dayKey)!.push(task);
    }
    return map;
  }, [rangeData.scheduledTasks]);

  return {
    ...rangeData,
    weekDays,
    visitsByTechByDay,
    tasksByTechByDay,
  };
}
