/**
 * Technician PWA — Shared time/duration formatting helpers.
 *
 * Single source of truth for clock-time and duration display
 * used across Today, Visit Detail, and Timesheet surfaces.
 */

/** Format ISO timestamp to locale time string, e.g. "8:00 AM". Returns "—" for null/undefined. */
export function formatClockTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Format a duration in minutes to compact display, e.g. "1h 30m" or "45m". */
export function formatDurationMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m`;
}
