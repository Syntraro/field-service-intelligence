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
import type {
  DispatchVisit,
  DispatchTask,
  DispatchLeadVisit,
  Technician,
} from "./dispatchPreviewTypes";
import { getDispatchDayKey } from "./dispatchPreviewUtils";
import {
  useDispatchRangeData,
  widenStartForAllDay,
  type DispatchTimeOffEntry,
} from "./dispatchDataCore";

export interface DispatchPreviewData {
  scheduledVisits: DispatchVisit[];
  unscheduledVisits: DispatchVisit[];
  scheduledTasks: DispatchTask[];
  leadVisits: DispatchLeadVisit[];
  /** 2026-05-07 RALPH (technician time off): time-off entries
   *  overlapping THIS day. Empty array when the endpoint fails or
   *  no entries exist for any tech today. */
  timeOff: DispatchTimeOffEntry[];
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

  // 2026-05-05 Phase 3: same day-key filter for lead visits so the
  // day view doesn't render adjacent-day bleeds.
  const leadVisits = useMemo(() => {
    return rangeData.leadVisits.filter((v) => {
      if (!v.scheduledStart) return true;
      return getDispatchDayKey(v.scheduledStart, v.isAllDay) === dayStr;
    });
  }, [rangeData.leadVisits, dayStr]);

  return {
    ...rangeData,
    scheduledVisits,
    leadVisits,
  };
}
