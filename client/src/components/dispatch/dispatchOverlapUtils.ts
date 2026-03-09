/**
 * Overlap detection utilities for the dispatch board.
 * Checks whether a proposed time range overlaps with existing visits AND tasks for a technician.
 * Pure functions — no side effects.
 */
import type { DispatchVisit, DispatchTask } from "./dispatchPreviewTypes";

interface TimeRange {
  start: number; // minutes from midnight
  end: number;
}

/** Minimal shape for any schedulable block (visit or task). */
interface SchedulableBlock {
  id: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  durationMinutes: number;
}

/** Convert a schedulable block's times to a TimeRange (minutes from midnight).
 *  Defensive: if computed end wraps past midnight, clamp to 24:00 (1440) to avoid
 *  negative-width ranges that would break overlap math. The board only supports same-day. */
function blockToTimeRange(block: SchedulableBlock): TimeRange | null {
  if (!block.scheduledStart) return null;
  const s = new Date(block.scheduledStart);
  const end = block.scheduledEnd
    ? new Date(block.scheduledEnd)
    : new Date(s.getTime() + block.durationMinutes * 60000);
  const startMin = s.getHours() * 60 + s.getMinutes();
  let endMin = end.getHours() * 60 + end.getMinutes();
  // Cross-midnight guard: if end wrapped to next day, clamp to 24:00
  if (endMin <= startMin && block.durationMinutes > 0) {
    endMin = 24 * 60;
  }
  return { start: startMin, end: endMin };
}

/** @deprecated Use blockToTimeRange — kept for backwards compat within this file */
function visitToTimeRange(visit: DispatchVisit): TimeRange | null {
  return blockToTimeRange(visit);
}

/** Check if two time ranges overlap (exclusive boundaries). */
function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Check if a proposed time range overlaps with any existing visits or tasks
 * for the same technician. Excludes the item being moved (by id).
 *
 * @param proposedStartMinutes - Start time in minutes from midnight
 * @param proposedEndMinutes   - End time in minutes from midnight
 * @param existingVisits       - All visits in the technician's lane
 * @param excludeVisitId       - Item ID to exclude (the one being dragged)
 * @param existingTasks        - All tasks in the technician's lane (Fix 2: overlap between tasks and visits)
 * @returns true if there is at least one overlap
 */
export function checkOverlap(
  proposedStartMinutes: number,
  proposedEndMinutes: number,
  existingVisits: DispatchVisit[],
  excludeVisitId?: string,
  existingTasks: DispatchTask[] = [],
): boolean {
  const proposed: TimeRange = {
    start: proposedStartMinutes,
    end: proposedEndMinutes,
  };

  // Fix 2: Combine visits and tasks into a single list for overlap checking
  const allBlocks: SchedulableBlock[] = [...existingVisits, ...existingTasks];

  for (const block of allBlocks) {
    if (excludeVisitId && block.id === excludeVisitId) continue;
    const range = blockToTimeRange(block);
    if (!range) continue;
    if (rangesOverlap(proposed, range)) return true;
  }
  return false;
}

/**
 * Get overlapping item IDs for highlighting purposes.
 * Fix 2: Checks both visits and tasks.
 *
 * @param proposedStartMinutes - Start time in minutes from midnight
 * @param proposedEndMinutes   - End time in minutes from midnight
 * @param existingVisits       - All visits in the technician's lane
 * @param excludeVisitId       - Item ID to exclude (the one being dragged)
 * @param existingTasks        - All tasks in the technician's lane
 * @returns Array of item IDs that overlap with the proposed range
 */
export function getOverlappingVisitIds(
  proposedStartMinutes: number,
  proposedEndMinutes: number,
  existingVisits: DispatchVisit[],
  excludeVisitId?: string,
  existingTasks: DispatchTask[] = [],
): string[] {
  const proposed: TimeRange = {
    start: proposedStartMinutes,
    end: proposedEndMinutes,
  };
  const ids: string[] = [];

  const allBlocks: SchedulableBlock[] = [...existingVisits, ...existingTasks];
  for (const block of allBlocks) {
    if (excludeVisitId && block.id === excludeVisitId) continue;
    const range = blockToTimeRange(block);
    if (!range) continue;
    if (rangesOverlap(proposed, range)) ids.push(block.id);
  }
  return ids;
}

/**
 * Clamp a resize-end time so it does not overlap any other block in the lane.
 * Used by both DispatchVisitBlock and DispatchTaskBlock during resize.
 * Returns the maximum valid end time (in minutes from midnight), clamped to
 * the nearest block's start time or the timeline end, whichever is smaller.
 *
 * @param startMinutes      - Fixed start of the block being resized (minutes from midnight)
 * @param proposedEndMinutes - Desired new end (minutes from midnight)
 * @param existingVisits     - All visits in this technician's lane
 * @param existingTasks      - All tasks in this technician's lane
 * @param excludeId          - ID of the block being resized (to skip self)
 * @param timelineEndHour    - Timeline window end hour (default 20)
 * @returns Clamped end time in minutes from midnight
 */
export function clampResizeEnd(
  startMinutes: number,
  proposedEndMinutes: number,
  existingVisits: DispatchVisit[],
  existingTasks: DispatchTask[],
  excludeId: string,
  timelineEndHour = 20,
): number {
  const maxEnd = timelineEndHour * 60;
  // Defensive guard: clamp to same-day timeline regardless
  let clamped = Math.min(proposedEndMinutes, maxEnd);

  // Find all occupied ranges in this lane (excluding the block being resized)
  const allBlocks: SchedulableBlock[] = [...existingVisits, ...existingTasks];
  for (const block of allBlocks) {
    if (block.id === excludeId) continue;
    const range = blockToTimeRange(block);
    if (!range) continue;
    // Only consider blocks that start after our fixed start (i.e. blocks to the right)
    // If our proposed end would push into this block, clamp to its start (edge-touching allowed)
    if (range.start >= startMinutes && clamped > range.start) {
      clamped = range.start;
    }
  }

  return clamped;
}

/**
 * Find the nearest valid (non-overlapping) slot for a proposed time range.
 * Tries the original position first, then searches before and after in SNAP increments.
 * Returns null if no valid slot exists within the timeline window.
 *
 * @param proposedStartMinutes - Desired start in minutes from midnight
 * @param durationMinutes      - Duration of the item
 * @param existingVisits       - Visits in the lane
 * @param excludeVisitId       - ID to skip (the item being moved)
 * @param snapMinutes          - Snap increment (default 15)
 * @param timelineStartHour    - Timeline window start hour (default 6)
 * @param timelineEndHour      - Timeline window end hour (default 20)
 * @param existingTasks        - Tasks in the lane (Fix 2: overlap between tasks and visits)
 */
export function findNearestValidSlot(
  proposedStartMinutes: number,
  durationMinutes: number,
  existingVisits: DispatchVisit[],
  excludeVisitId?: string,
  snapMinutes = 15,
  timelineStartHour = 6,
  timelineEndHour = 20,
  existingTasks: DispatchTask[] = [],
): number | null {
  const minStart = timelineStartHour * 60;
  const maxEnd = timelineEndHour * 60;

  // Fix 2: Get sorted occupied ranges from both visits AND tasks (excluding the dragged item)
  const occupied: TimeRange[] = [];
  const allBlocks: SchedulableBlock[] = [...existingVisits, ...existingTasks];
  for (const block of allBlocks) {
    if (excludeVisitId && block.id === excludeVisitId) continue;
    const r = blockToTimeRange(block);
    if (r) occupied.push(r);
  }
  occupied.sort((a, b) => a.start - b.start);

  const fits = (start: number): boolean => {
    const end = start + durationMinutes;
    if (start < minStart || end > maxEnd) return false;
    const proposed: TimeRange = { start, end };
    return !occupied.some(r => rangesOverlap(proposed, r));
  };

  // Try original position first
  if (fits(proposedStartMinutes)) return proposedStartMinutes;

  // Search outward in snap increments (before and after)
  for (let offset = snapMinutes; offset <= maxEnd - minStart; offset += snapMinutes) {
    const before = proposedStartMinutes - offset;
    const after = proposedStartMinutes + offset;
    // Snap both candidates to grid
    const snappedBefore = Math.round(before / snapMinutes) * snapMinutes;
    const snappedAfter = Math.round(after / snapMinutes) * snapMinutes;
    if (fits(snappedBefore)) return snappedBefore;
    if (fits(snappedAfter)) return snappedAfter;
  }

  return null; // No valid slot found
}
