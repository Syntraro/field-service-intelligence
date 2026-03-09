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
  /** For visits: visitId. For tasks: taskId. */
  visitId: string;
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

/** Data attached to a lane drop zone (day view) or cell drop zone (week view) */
export interface DispatchDropData {
  technicianId: string;
  /** Present for week view cells — "yyyy-MM-dd" format */
  dayKey?: string;
}
