/**
 * DispatchOutsideWindowIndicators — shows indicators when a technician has
 * visits or tasks scheduled before 6 AM or after 8 PM (outside the visible timeline window).
 *
 * Exported utilities:
 * - countItemsBefore / countItemsAfter: compute counts for each lane
 * - EarlyIndicator / LateIndicator: styled indicator buttons
 */
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { DispatchVisit, DispatchTask } from "./dispatchPreviewTypes";
import { TIMELINE_START_HOUR, TIMELINE_END_HOUR } from "./dispatchPreviewUtils";

/** Count items that start before the visible timeline window. */
export function countItemsBefore(visits: DispatchVisit[], tasks: DispatchTask[]): number {
  let count = 0;
  for (const v of visits) {
    if (!v.scheduledStart) continue;
    const h = new Date(v.scheduledStart).getHours();
    if (h < TIMELINE_START_HOUR) count++;
  }
  for (const t of tasks) {
    if (!t.scheduledStart) continue;
    const h = new Date(t.scheduledStart).getHours();
    if (h < TIMELINE_START_HOUR) count++;
  }
  return count;
}

/** Count items that end after the visible timeline window. */
export function countItemsAfter(visits: DispatchVisit[], tasks: DispatchTask[]): number {
  let count = 0;
  for (const v of visits) {
    if (!v.scheduledEnd && !v.scheduledStart) continue;
    const endTime = v.scheduledEnd ?? v.scheduledStart!;
    const d = new Date(endTime);
    const h = d.getHours();
    const m = d.getMinutes();
    if (h > TIMELINE_END_HOUR || (h === TIMELINE_END_HOUR && m > 0)) count++;
  }
  for (const t of tasks) {
    if (!t.scheduledEnd && !t.scheduledStart) continue;
    const endTime = t.scheduledEnd ?? t.scheduledStart!;
    const d = new Date(endTime);
    const h = d.getHours();
    const m = d.getMinutes();
    if (h > TIMELINE_END_HOUR || (h === TIMELINE_END_HOUR && m > 0)) count++;
  }
  return count;
}

/** Early indicator pill — used with sticky left positioning at timeline level */
export function EarlyIndicator({ count, onClick }: { count: number; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-0.5 rounded-r bg-amber-100 border border-l-0 border-amber-300 px-1.5 py-1 text-[10px] font-semibold text-amber-700 hover:bg-amber-200 transition-colors shadow-md"
      title={`${count} item(s) before ${TIMELINE_START_HOUR}:00 AM`}
    >
      <ChevronLeft className="h-3 w-3" />
      {count}
    </button>
  );
}

/** Late indicator pill — used with sticky right positioning at timeline level */
export function LateIndicator({ count, onClick }: { count: number; onClick?: () => void }) {
  const lateHourLabel =
    TIMELINE_END_HOUR > 12
      ? `${TIMELINE_END_HOUR - 12}:00 PM`
      : `${TIMELINE_END_HOUR}:00 AM`;
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-0.5 rounded-l bg-amber-100 border border-r-0 border-amber-300 px-1.5 py-1 text-[10px] font-semibold text-amber-700 hover:bg-amber-200 transition-colors shadow-md"
      title={`${count} item(s) after ${lateHourLabel}`}
    >
      {count}
      <ChevronRight className="h-3 w-3" />
    </button>
  );
}
