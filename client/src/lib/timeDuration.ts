/**
 * Shared time/duration formatting utilities for the timesheet system.
 *
 * Centralizes the two functions that were duplicated across
 * TimeEntryRowCompact.tsx and JobTimeGroupCard.tsx.
 *
 * NOT a replacement for formatHm() (buildWeekStackViewModel) which produces
 * the colon-format "1:30" used in week-view totals. This file produces the
 * prose-format "1h 30m" / "30m" used in individual entry duration spans.
 */

import { format, parseISO } from "date-fns";

/**
 * Compact prose duration — "Live" for running entries, "0m", "30m",
 * "1h", "1h 30m". Used in per-entry duration spans inside group cards.
 */
export function formatDurationCompact(minutes: number | null): string {
  if (minutes == null) return "Live";
  if (minutes === 0) return "0m";
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs === 0) return `${mins}m`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

/** 12-hour clock display for a startAt / endAt ISO string. */
export function formatTimeOfDay(iso: string | null): string {
  if (!iso) return "—";
  return format(parseISO(iso), "h:mm a");
}

/**
 * Prose H+M duration — "0h 0m", "0h 30m", "1h 0m", "1h 30m".
 * Used for group-level totals (JobTimeGroupCard header, DaySummaryCard total).
 * Distinct from formatDurationCompact which omits the zero component ("30m", "1h").
 */
export function formatDurationHm(minutes: number): string {
  if (minutes === 0) return "0h 0m";
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hrs}h ${mins}m`;
}
