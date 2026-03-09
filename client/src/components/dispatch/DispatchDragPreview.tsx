/**
 * DispatchDragPreview — visual drag preview indicator for the dispatch board.
 * Renders inside each lane row, positioned based on the current drag pointer position.
 * Shows a semi-transparent block at the exact snap position with proposed start/end times.
 */
import { useMemo } from "react";
import { format, addMinutes, startOfDay } from "date-fns";
import {
  HOUR_WIDTH_PX,
  TIMELINE_START_HOUR,
  TIMELINE_END_HOUR,
  SNAP_MINUTES,
  PX_PER_MINUTE,
} from "./dispatchPreviewUtils";

type Props = {
  /** Current pointer X relative to the timeline scroll container */
  pointerX: number;
  /** Duration of the dragged item in minutes */
  durationMinutes: number;
  /** The date being viewed */
  selectedDate: Date;
  /** Whether there's an overlap conflict */
  hasOverlap: boolean;
  /** Dynamic timeline start/end hours for 24h mode */
  timelineStartHour?: number;
  timelineEndHour?: number;
};

export default function DispatchDragPreview({
  pointerX,
  durationMinutes,
  selectedDate,
  hasOverlap,
  timelineStartHour: tsHour = TIMELINE_START_HOUR,
  timelineEndHour: teHour = TIMELINE_END_HOUR,
}: Props) {
  const { left, width, startTime, endTime } = useMemo(() => {
    const totalMinutesFromStart = (pointerX / HOUR_WIDTH_PX) * 60;
    const snappedMinutes =
      Math.round(totalMinutesFromStart / SNAP_MINUTES) * SNAP_MINUTES;
    const timelineMaxMinutes = (teHour - tsHour) * 60;
    const clampedMinutes = Math.max(
      0,
      Math.min(snappedMinutes, timelineMaxMinutes - SNAP_MINUTES),
    );

    const computedLeft = clampedMinutes * PX_PER_MINUTE;
    const computedWidth = Math.min(
      durationMinutes * PX_PER_MINUTE,
      (timelineMaxMinutes - clampedMinutes) * PX_PER_MINUTE,
    );

    const absoluteMinutes = tsHour * 60 + clampedMinutes;
    const day = startOfDay(selectedDate);
    const startDt = addMinutes(day, absoluteMinutes);
    const endDt = addMinutes(startDt, durationMinutes);

    return {
      left: computedLeft,
      width: computedWidth,
      startTime: format(startDt, "h:mm a"),
      endTime: format(endDt, "h:mm a"),
    };
  }, [pointerX, durationMinutes, selectedDate, hasOverlap, tsHour, teHour]);

  const bgColor = hasOverlap
    ? "bg-red-200/60 border-red-500"
    : "bg-emerald-200/50 border-emerald-400";

  return (
    <div
      className={`pointer-events-none absolute top-0 bottom-0 rounded border-2 border-dashed ${bgColor} z-30`}
      style={{ left, width: Math.max(width, 40) }}
    >
      {/* Time chip — positioned ABOVE the block so DragOverlay ghost doesn't cover it */}
      <div
        className={`absolute -top-6 left-0 rounded px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap shadow ${
          hasOverlap
            ? "bg-red-600 text-white"
            : "bg-emerald-700 text-white"
        }`}
      >
        {startTime} – {endTime}
      </div>
      {/* Overlap banner — large, centered, unmissable */}
      {hasOverlap && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="rounded bg-red-600 px-2.5 py-1 text-[11px] font-bold text-white shadow-md uppercase tracking-wide">
            Overlap
          </div>
        </div>
      )}
    </div>
  );
}
