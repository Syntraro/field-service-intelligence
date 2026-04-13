/**
 * Schedule overlap detection for non-board create/edit flows.
 * Reuses the same pure checkOverlap helper trusted by the dispatch board.
 *
 * Does NOT auto-adjust times — only detects conflicts so callers can notify the user.
 */
import { apiRequest } from "@/lib/queryClient";
import { checkOverlap } from "@/components/dispatch/dispatchOverlapUtils";
import type { CalendarRangeResponseDto } from "@shared/types/scheduling";

/**
 * Check whether a proposed scheduled time conflicts with existing items
 * on the target technician's schedule for that day.
 *
 * Returns true if overlap is detected, false otherwise.
 * Does NOT modify the proposed times.
 */
export async function detectScheduleConflict(
  technicianId: string | null,
  date: string,
  startAt: string,
  endAt: string,
  durationMinutes: number,
  excludeId?: string,
): Promise<boolean> {
  if (!technicianId) return false;

  try {
    const dayStart = `${date}T00:00:00.000Z`;
    const dayEnd = `${date}T23:59:59.999Z`;
    const data = await apiRequest<CalendarRangeResponseDto>(
      `/api/calendar?start=${encodeURIComponent(dayStart)}&end=${encodeURIComponent(dayEnd)}`
    );

    // 2026-04-12 (Option A): calendar event crew is visit-derived server-side.
    // No fallback to primaryTechnicianId.
    const techEvents = (data?.events ?? [])
      .filter(e => Array.isArray(e.assignedTechnicianIds) && e.assignedTechnicianIds.includes(technicianId))
      .map(e => ({
        id: e.visitId ?? e.id,
        scheduledStart: e.startAt,
        scheduledEnd: e.endAt,
        durationMinutes: e.durationMinutes,
      }));

    const start = new Date(startAt);
    const proposedStartMin = start.getHours() * 60 + start.getMinutes();
    const proposedEndMin = proposedStartMin + durationMinutes;

    return checkOverlap(proposedStartMin, proposedEndMin, techEvents as any, excludeId);
  } catch {
    // If fetch fails, don't block the save
    return false;
  }
}
