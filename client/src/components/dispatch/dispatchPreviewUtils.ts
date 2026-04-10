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
export const HOUR_WIDTH_PX = 104;
export const LANE_HEIGHT_PX = 64;
/** Shared height for off-shift divider row across sidebar, any-time column, and timeline grid */
export const DIVIDER_HEIGHT_PX = 26;
export const TECH_SIDEBAR_WIDTH_PX = 200;
export const SNAP_MINUTES = 15;
/** Default hour for scheduling via Month view drops (no time grid available) */
export const DEFAULT_SCHEDULE_HOUR = 9;
export const MIN_DURATION_MINUTES = 15;
export const PX_PER_MINUTE = HOUR_WIDTH_PX / 60;

export function formatHour(hour: number): string {
  if (hour === 0 || hour === 12) return hour === 0 ? "12 AM" : "12 PM";
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

/**
 * Job visit status colors — green accent family for scheduled/dispatched states.
 * 2026-03-17: Removed "open", added "on_hold"/"cancelled", normalized "on_site" → same as "in_progress"
 */
export function visitStatusColor(status: VisitStatus): string {
  switch (status) {
    case "scheduled":   return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "dispatched":  return "bg-green-50 text-green-800 border-green-300";
    case "en_route":    return "bg-amber-50 text-amber-700 border-amber-200";
    case "on_site":     return "bg-lime-50 text-lime-800 border-lime-300"; // legacy — same as in_progress
    case "in_progress": return "bg-lime-50 text-lime-800 border-lime-300";
    // 2026-04-10: tech-side pause state, distinct from on_hold (office-side dispatch hold).
    case "paused":      return "bg-yellow-50 text-yellow-800 border-yellow-200";
    case "on_hold":     return "bg-orange-50 text-orange-700 border-orange-200";
    case "completed":   return "bg-slate-50 text-slate-400 border-slate-200";
    case "cancelled":   return "bg-gray-50 text-gray-400 border-gray-200";
    default:            return "bg-slate-100 text-slate-700 border-slate-300";
  }
}

/**
 * Job-state card color for dispatch cards — solid fill model.
 * 4-state model based on PARENT JOB status (not visit status):
 *   - Dispatched/Scheduled (open, no sub-status) → Solid green
 *   - In Progress (open + in_progress sub-status) → Solid blue
 *   - Needs Action (open + on_hold) → Solid orange
 *   - Completed/Closed (completed, invoiced, archived) → Gray
 *
 * Returns bg + text + border classes applied directly to the card container.
 */
export function jobStateColor(
  jobStatus: string,
  openSubStatus: string | null,
): string {
  // Terminal job states → gray
  if (jobStatus === "completed" || jobStatus === "invoiced" || jobStatus === "archived") {
    return "bg-slate-100 text-slate-500 border-slate-300";
  }
  // Open + on_hold → solid orange (needs action / follow-up)
  if (openSubStatus === "on_hold") {
    return "bg-orange-100 text-orange-900 border-orange-400";
  }
  // Open + in_progress / on_route → solid blue
  if (openSubStatus === "in_progress" || openSubStatus === "on_route") {
    return "bg-blue-100 text-blue-900 border-blue-400";
  }
  // Default open/scheduled → solid green with strong border
  return "bg-green-50 text-slate-900 border-green-500";
}

/**
 * Job-state label for dispatch surfaces — companion to jobStateColor().
 * Returns a human-readable label derived from the parent job status.
 */
export function jobStateLabel(
  jobStatus: string,
  openSubStatus: string | null,
): string {
  if (jobStatus === "completed" || jobStatus === "invoiced" || jobStatus === "archived") {
    return jobStatus === "invoiced" ? "Invoiced" : jobStatus === "archived" ? "Archived" : "Completed";
  }
  if (openSubStatus === "on_hold") return "On Hold";
  if (openSubStatus === "in_progress" || openSubStatus === "on_route") return "In Progress";
  return "Active";
}

/** Returns true if the visit status indicates a completed/done visit */
export function isCompletedStatus(status: VisitStatus): boolean {
  return status === "completed";
}

/**
 * Normalize visit status for display.
 * 2026-03-17: Maps legacy "on_site" → "in_progress" for consistent UI display.
 */
export function normalizeVisitStatusForDisplay(status: string): VisitStatus {
  if (status === "on_site") return "in_progress";
  if (status === "open") return "scheduled"; // legacy fallback
  return status as VisitStatus;
}

/** Get human-readable label for a visit status */
export function visitStatusLabel(status: VisitStatus | string): string {
  const normalized = normalizeVisitStatusForDisplay(status);
  switch (normalized) {
    case "scheduled":   return "Scheduled";
    case "dispatched":  return "Dispatched";
    case "en_route":    return "En Route";
    case "in_progress": return "In Progress";
    // 2026-04-10: tech-side pause label, distinct from "On Hold" (office-side).
    case "paused":      return "Paused";
    case "on_hold":     return "On Hold";
    case "completed":   return "Completed";
    case "cancelled":   return "Cancelled";
    default:            return status;
  }
}

/** Job visit status dots — green family for scheduled/dispatched */
export function visitStatusDot(status: VisitStatus): string {
  switch (status) {
    case "scheduled":   return "bg-emerald-500";
    case "dispatched":  return "bg-green-500";
    case "en_route":    return "bg-amber-500";
    case "on_site":     return "bg-lime-500"; // legacy — same as in_progress
    case "in_progress": return "bg-lime-500";
    // 2026-04-10: tech-side pause dot, distinct from on_hold.
    case "paused":      return "bg-yellow-500";
    case "on_hold":     return "bg-orange-500";
    case "completed":   return "bg-slate-300";
    case "cancelled":   return "bg-gray-300";
    default:            return "bg-slate-400";
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
