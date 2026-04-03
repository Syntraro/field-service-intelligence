/**
 * Dispatch Board DnD types.
 * Structured drag/drop identity — no brittle string parsing.
 * Supports both visits and tasks as draggable items.
 * Supports both day-view (pixel-based) and week-view (cell-based) drop zones.
 */

/** Draggable item types */
export type DispatchDragType = "scheduled-visit" | "unscheduled-visit" | "scheduled-task";

/** Data attached to a draggable dispatch item */
export interface DispatchDragData {
  type: DispatchDragType;
  /** For scheduled visits: real persisted visitId. For tasks: taskId.
   *  For unscheduled-visit: real visitId if a visit row exists, undefined otherwise.
   *  Never contains a job UUID — absence is represented as undefined. */
  visitId?: string;
  jobId: string;
  jobNumber: number;
  /** Current technician (null for unscheduled) */
  technicianId: string | null;
  durationMinutes: number;
  version: number;
  /** True if visit has multiple assigned technicians — drag does not change roster */
  isMultiTech?: boolean;
  /** Original scheduled start ISO (for preserving time-of-day in week view moves) */
  originalStart?: string | null;
}

/** Data attached to a lane drop zone (day view) or cell/column drop zone (week/month view).
 *  Day view lanes always provide technicianId.
 *  Week calendar columns and Month day cells provide dayKey; technicianId is optional
 *  (calendar/month drops preserve the drag source's tech assignment). */
export interface DispatchDropData {
  technicianId?: string;
  /** Present for week/month view cells — "yyyy-MM-dd" format */
  dayKey?: string;
}
