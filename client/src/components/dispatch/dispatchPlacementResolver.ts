/**
 * Dispatch Board Placement Resolver — canonical shared placement engine.
 *
 * ONE source of truth for all board placement calculations:
 * - Drag preview position
 * - Click-to-schedule preview position
 * - Drag drop commit position
 * - Click commit position
 *
 * All scheduling interactions resolve placement through this module.
 */
import { startOfDay, addMinutes, format } from "date-fns";
import { HOUR_WIDTH_PX, SNAP_MINUTES, PX_PER_MINUTE } from "./dispatchPreviewUtils";
import { checkOverlap, findNearestValidSlot } from "./dispatchOverlapUtils";
import type { DispatchVisit, DispatchTask } from "./dispatchPreviewTypes";

// ============================================================================
// Types
// ============================================================================

/** Normalized result from the placement resolver — used for both preview and commit */
export interface PlacementResult {
  /** Target technician ID */
  technicianId: string;
  /** Scheduled date (Date object, start of day) */
  date: Date;
  /** Start time in minutes from midnight (snapped to grid) */
  startMinutes: number;
  /** End time in minutes from midnight */
  endMinutes: number;
  /** Duration in minutes */
  durationMinutes: number;
  /** ISO string for start time */
  startAt: string;
  /** ISO string for end time */
  endAt: string;
  /** Whether this placement overlaps existing items */
  hasOverlap: boolean;
  /** Whether the placement is valid (within bounds, has a valid slot) */
  isValid: boolean;
  /** Display-friendly start time string */
  startTimeLabel: string;
  /** Display-friendly end time string */
  endTimeLabel: string;
  /** Pixel left offset for preview rendering */
  previewLeft: number;
  /** Pixel width for preview rendering */
  previewWidth: number;
}

/** Board state needed by the resolver */
export interface BoardState {
  /** Selected date on the board */
  selectedDate: Date;
  /** Timeline start hour (e.g. 5 for default, 0 for 24h mode) */
  startHour: number;
  /** Timeline end hour (e.g. 22 for default, 24 for 24h mode) */
  endHour: number;
  /** Visits in the target technician's lane */
  laneVisits: DispatchVisit[];
  /** Tasks in the target technician's lane */
  laneTasks: DispatchTask[];
  /** ID to exclude from overlap checks (the item being moved) */
  excludeId?: string;
}

/** Options for placement resolution */
export interface PlacementOptions {
  /** If true, auto-find nearest valid slot when overlap detected */
  autoResolveOverlap?: boolean;
  /** Snap increment in minutes (default: SNAP_MINUTES = 15) */
  snapMinutes?: number;
}

// ============================================================================
// Core resolver
// ============================================================================

/**
 * Convert a pixel X position (relative to timeline content origin) to a
 * snapped minute-of-day value.
 *
 * This is the CANONICAL pixel-to-time conversion used by all paths.
 */
export function pxToSnappedMinutes(
  relativeX: number,
  startHour: number,
  endHour: number,
  snapMinutes = SNAP_MINUTES,
): number {
  const totalMinutesFromStart = (relativeX / HOUR_WIDTH_PX) * 60;
  const snapped = Math.round(totalMinutesFromStart / snapMinutes) * snapMinutes;
  const timelineMax = (endHour - startHour) * 60;
  return startHour * 60 + Math.max(0, Math.min(snapped, timelineMax - snapMinutes));
}

/**
 * Convert a client X coordinate to a timeline-relative pixel position.
 * Accounts for scroll offset and optional grab offset.
 *
 * This is the CANONICAL coordinate transform used by all paths.
 */
export function clientXToRelativePx(
  clientX: number,
  timelineRect: DOMRect,
  scrollLeft: number,
  grabOffsetX = 0,
): number {
  return clientX - timelineRect.left + scrollLeft - grabOffsetX;
}

/**
 * Resolve a board placement from a timeline-relative pixel position.
 *
 * Used by:
 * - Drag preview (real-time during drag)
 * - Click preview (real-time during hover in click mode)
 * - Drag commit (on drop)
 * - Click commit (on click)
 */
export function resolvePlacement(
  relativeX: number,
  technicianId: string,
  durationMinutes: number,
  boardState: BoardState,
  options: PlacementOptions = {},
): PlacementResult {
  const { selectedDate, startHour, endHour, laneVisits, laneTasks, excludeId } = boardState;
  const { autoResolveOverlap = false, snapMinutes = SNAP_MINUTES } = options;

  const timelineMaxMinutes = (endHour - startHour) * 60;

  // Step 1: Convert pixel position to snapped minutes from midnight
  let startMinutes = pxToSnappedMinutes(relativeX, startHour, endHour, snapMinutes);
  let endMinutes = startMinutes + durationMinutes;

  // Step 2: Check overlap
  let hasOverlap = checkOverlap(startMinutes, endMinutes, laneVisits, excludeId, laneTasks);

  // Step 3: Auto-resolve overlap if requested (used during commit, not preview)
  if (hasOverlap && autoResolveOverlap) {
    const validStart = findNearestValidSlot(
      startMinutes,
      durationMinutes,
      laneVisits,
      excludeId,
      snapMinutes,
      startHour,
      endHour,
      laneTasks,
    );
    if (validStart !== null) {
      startMinutes = validStart;
      endMinutes = startMinutes + durationMinutes;
      hasOverlap = false;
    }
  }

  // Step 4: Compute ISO datetime strings
  const day = startOfDay(selectedDate);
  const startDt = addMinutes(day, startMinutes);
  const endDt = addMinutes(day, endMinutes);
  const startAt = startDt.toISOString();
  const endAt = endDt.toISOString();

  // Step 5: Compute preview pixel position (relative to timeline start)
  const minutesFromTimelineStart = startMinutes - startHour * 60;
  const clampedMinutesFromStart = Math.max(0, Math.min(minutesFromTimelineStart, timelineMaxMinutes - snapMinutes));
  const previewLeft = clampedMinutesFromStart * PX_PER_MINUTE;
  const previewWidth = Math.min(
    durationMinutes * PX_PER_MINUTE,
    (timelineMaxMinutes - clampedMinutesFromStart) * PX_PER_MINUTE,
  );

  // Step 6: Validity check
  const isWithinBounds = startMinutes >= startHour * 60 && endMinutes <= endHour * 60;
  const isValid = isWithinBounds && !hasOverlap;

  return {
    technicianId,
    date: day,
    startMinutes,
    endMinutes,
    durationMinutes,
    startAt,
    endAt,
    hasOverlap,
    isValid,
    startTimeLabel: format(startDt, "h:mm a"),
    endTimeLabel: format(endDt, "h:mm a"),
    previewLeft,
    previewWidth: Math.max(previewWidth, 40), // Minimum 40px for visibility
  };
}
