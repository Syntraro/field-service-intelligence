/**
 * useDispatchPreviewData — Day view data hook.
 * Thin wrapper over useDispatchRangeData with day-scoped range and
 * post-filtering by canonical day key.
 *
 * 2026-03-31: Refactored to use shared dispatchDataCore. Fetch/normalize
 * logic deduplicated — only day-specific date computation and day-key
 * filtering remain here.
 */
import { useMemo } from "react";
import { startOfDay, endOfDay, format } from "date-fns";
import type { DispatchVisit, DispatchTask, Technician } from "./dispatchPreviewTypes";
import { getDispatchDayKey } from "./dispatchPreviewUtils";
import { useDispatchRangeData, widenStartForAllDay } from "./dispatchDataCore";

export interface DispatchPreviewData {
  scheduledVisits: DispatchVisit[];
  unscheduledVisits: DispatchVisit[];
  scheduledTasks: DispatchTask[];
  technicians: Technician[];
  isLoading: boolean;
  error: Error | null;
}

export function useDispatchPreviewData(selectedDate: Date, enabled = true): DispatchPreviewData {
  const localDayStart = startOfDay(selectedDate).toISOString();
  const dayEnd = endOfDay(selectedDate).toISOString();
  const dayStr = format(selectedDate, "yyyy-MM-dd");
  const dayStart = widenStartForAllDay(selectedDate, localDayStart);

  const rangeData = useDispatchRangeData(
    dayStart,
    dayEnd,
    `dispatch-${dayStr}`,
    200,
    enabled,
  );

  // Post-filter visits by canonical day key — widened query range may include
  // adjacent-day bleeds from allDay visits or UTC midnight overlap.
  const scheduledVisits = useMemo(() => {
    return rangeData.scheduledVisits.filter(v => {
      if (!v.scheduledStart) return true;
      return getDispatchDayKey(v.scheduledStart, v.isAllDay) === dayStr;
    });
  }, [rangeData.scheduledVisits, dayStr]);

  return {
    ...rangeData,
    scheduledVisits,
  };
}
