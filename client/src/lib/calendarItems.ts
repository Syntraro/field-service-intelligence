/**
 * CalendarItem Normalization Layer
 *
 * Unified type and normalizer functions so calendar grids can render
 * both visits (jobs) and tasks as calendar items.
 *
 * Phase 1 of Calendar Page UI Rewrite (2026-03-04)
 */

import type { CalendarEvent } from "@/components/calendar/calendarUtils";

// ============================================================================
// CalendarItem: Superset of CalendarEvent with kind discriminator
// ============================================================================

export interface CalendarItem extends CalendarEvent {
  /** Discriminator: "visit" for job visits, "task" for tasks */
  kind: "visit" | "task";
  /** Display title */
  title: string;
  /** Display subtitle (location, summary, etc.) */
  subtitle: string;
}

// ============================================================================
// Normalizer: Visit → CalendarItem
// ============================================================================

/**
 * Thin wrapper that tags a normalized CalendarEvent as a visit CalendarItem.
 * Carries all existing fields, adds kind/title/subtitle for unified rendering.
 */
export function visitToCalendarItem(event: CalendarEvent): CalendarItem {
  const raw = event.raw ?? {};
  return {
    ...event,
    kind: "visit",
    title: raw.companyName || raw.customerCompanyName || raw.summary || "Visit",
    subtitle: raw.locationName || raw.summary || "",
  };
}

// ============================================================================
// Normalizer: Task → CalendarItem
// ============================================================================

/**
 * Maps a task (from /api/tasks) with scheduledStartAt to a CalendarItem shape.
 * Returns null if the task has no scheduled date (unscheduled tasks aren't calendar items).
 *
 * @param task - Raw task object from API
 * @returns CalendarItem or null if task has no scheduledStartAt
 */
export function taskToCalendarItem(task: any): CalendarItem | null {
  if (!task?.scheduledStartAt) return null;

  const start = new Date(task.scheduledStartAt);
  if (isNaN(start.getTime())) return null;

  const year = start.getFullYear();
  const month = start.getMonth() + 1;
  const day = start.getDate();
  const hour = start.getHours();
  const minutes = start.getMinutes();
  const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const isAllDay = task.allDay === true;
  const durationMinutes = task.estimatedDurationMinutes || 60;
  const startMinutes = isAllDay ? null : hour * 60 + minutes;

  const techId = task.assignedToUserId || null;

  return {
    // CalendarEvent fields
    assignmentId: `task-${task.id}`,
    locationKey: task.clientId || task.locationId || "",
    technicianId: techId,
    technicianIds: techId ? [techId] : [],
    year,
    month,
    day,
    dateKey,
    scheduledHour: isAllDay ? null : hour,
    scheduledStartMinutes: isAllDay ? null : minutes,
    isAllDay,
    startMinutes,
    durationMinutes,
    completed: task.status === "completed" || task.status === "cancelled",
    jobNumber: null,
    scheduledDate: dateKey,
    raw: task,
    // CalendarItem extensions
    kind: "task",
    title: task.title || "Untitled task",
    subtitle: task.notes || "",
  };
}
