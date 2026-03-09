/**
 * Dispatch Board preview utilities.
 * Pure helpers — no side effects, no external dependencies.
 */
import type { DispatchVisit, Technician, VisitStatus } from "./dispatchPreviewTypes";

// Hours displayed on the timeline (5 AM – 10 PM default, 0–24 in expanded mode)
// Item 3: Extended from 6–20 to 5–22 for early/late scheduling support
export const TIMELINE_START_HOUR = 5;
export const TIMELINE_END_HOUR = 22;
/** Default business hours for auto-scroll-to-view on mount */
export const BUSINESS_START_HOUR = 7;
export const BUSINESS_END_HOUR = 18;
export const TIMELINE_HOURS = Array.from(
  { length: TIMELINE_END_HOUR - TIMELINE_START_HOUR },
  (_, i) => TIMELINE_START_HOUR + i,
);

/** Item 7: 24-hour expanded timeline constants */
export const TIMELINE_START_HOUR_24 = 0;
export const TIMELINE_END_HOUR_24 = 24;
export const TIMELINE_HOURS_24 = Array.from({ length: 24 }, (_, i) => i);

/** Item 7: Build timeline config from show24Hour flag */
export function getTimelineConfig(show24Hour: boolean) {
  const startHour = show24Hour ? TIMELINE_START_HOUR_24 : TIMELINE_START_HOUR;
  const endHour = show24Hour ? TIMELINE_END_HOUR_24 : TIMELINE_END_HOUR;
  const hours = show24Hour ? TIMELINE_HOURS_24 : TIMELINE_HOURS;
  return { startHour, endHour, hours };
}
export const HOUR_WIDTH_PX = 120;
export const LANE_HEIGHT_PX = 64;
/** Shared height for off-shift divider row across sidebar, any-time column, and timeline grid */
export const DIVIDER_HEIGHT_PX = 26;
export const TECH_SIDEBAR_WIDTH_PX = 200;
export const SNAP_MINUTES = 15;
export const MIN_DURATION_MINUTES = 15;
export const PX_PER_MINUTE = HOUR_WIDTH_PX / 60;

export function formatHour(hour: number): string {
  if (hour === 0 || hour === 12) return hour === 0 ? "12 AM" : "12 PM";
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

/** Job visit status colors — green accent family for scheduled/dispatched states */
export function visitStatusColor(status: VisitStatus): string {
  switch (status) {
    case "open":        return "bg-slate-100 text-slate-700 border-slate-300";
    case "scheduled":   return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "dispatched":  return "bg-green-50 text-green-800 border-green-300";
    case "en_route":    return "bg-amber-50 text-amber-700 border-amber-200";
    case "on_site":     return "bg-orange-50 text-orange-700 border-orange-200";
    case "in_progress": return "bg-lime-50 text-lime-800 border-lime-300";
    case "completed":   return "bg-slate-50 text-slate-400 border-slate-200";
  }
}

/** Returns true if the visit status indicates a completed/done visit */
export function isCompletedStatus(status: VisitStatus): boolean {
  return status === "completed";
}

/** Job visit status dots — green family for scheduled/dispatched */
export function visitStatusDot(status: VisitStatus): string {
  switch (status) {
    case "open":        return "bg-slate-400";
    case "scheduled":   return "bg-emerald-500";
    case "dispatched":  return "bg-green-500";
    case "en_route":    return "bg-amber-500";
    case "on_site":     return "bg-orange-500";
    case "in_progress": return "bg-lime-500";
    case "completed":   return "bg-slate-300";
  }
}

export function techStatusDot(status: Technician["status"]): string {
  switch (status) {
    case "available": return "bg-emerald-400";
    case "on_job":    return "bg-blue-400";
    case "off":       return "bg-slate-300";
  }
}

/** Get pixel left offset and width for a visit block on the timeline.
 *  Item 3: Clamps visits that start before TIMELINE_START_HOUR to left=0
 *  (partial rendering) rather than hiding them entirely. */
/** Get pixel position for a visit block. Accepts optional dynamic startHour for 24h mode. */
export function getVisitPosition(visit: DispatchVisit, timelineStartHour = TIMELINE_START_HOUR): { left: number; width: number } | null {
  if (!visit.scheduledStart) return null;
  const start = new Date(visit.scheduledStart);
  const startHour = start.getHours() + start.getMinutes() / 60;
  const offsetHours = startHour - timelineStartHour;
  const totalWidth = (visit.durationMinutes / 60) * HOUR_WIDTH_PX;
  // If the entire visit ends before the timeline, skip it
  if (offsetHours + visit.durationMinutes / 60 <= 0) return null;
  // Clamp left to 0 if visit starts before timeline
  const left = Math.max(0, offsetHours * HOUR_WIDTH_PX);
  const clippedStart = Math.max(0, -offsetHours * HOUR_WIDTH_PX);
  const width = Math.max(totalWidth - clippedStart, 40);
  return { left, width };
}

export function priorityIndicator(priority: DispatchVisit["priority"]): string | null {
  switch (priority) {
    case "urgent": return "border-l-red-500";
    case "high":   return "border-l-amber-500";
    default:       return null;
  }
}

export function formatDuration(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Canonical day-key for dispatch bucketing.
 * allDay visits: extract date from UTC (avoids local-timezone off-by-one at midnight UTC).
 * Timed visits: extract date from local timezone (matches what the user sees on the clock).
 */
export function getDispatchDayKey(scheduledStart: string, isAllDay: boolean): string {
  const d = new Date(scheduledStart);
  if (isAllDay) {
    // UTC extraction — "2026-03-08T00:00:00.000Z" → "2026-03-08"
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  // Local extraction for timed visits
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
