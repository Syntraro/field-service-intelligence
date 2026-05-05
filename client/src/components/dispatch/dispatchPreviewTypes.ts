/**
 * Dispatch Board preview types.
 * Standalone — no dependency on legacy calendar types.
 */

/**
 * 2026-03-17: Normalized visit status union.
 * - Removed "open" (not a real visit status; visits start as "scheduled")
 * - Added "on_hold" and "cancelled"
 * - "on_site" retained for backward compat with DB data but normalized to "in_progress" in UI
 * 2026-04-10: Added "paused" — tech-side pause state, distinct from "on_hold"
 *             (office-side dispatch hold). Mirrors shared/schema.ts jobVisitStatusEnum.
 */
export type VisitStatus =
  | "scheduled"
  | "dispatched"
  | "en_route"
  | "on_site"      // legacy DB value — display as "In Progress"
  | "in_progress"
  | "paused"
  | "on_hold"
  | "completed"
  | "cancelled";

// 2026-03-20: VISIT_STATUS_OPTIONS removed — canonical owner is lib/visitStatusDisplay.ts.
// Import from there instead of defining a duplicate here.

export type Technician = {
  id: string;
  name: string;
  initials: string;
  color: string;
  status: "available" | "on_job" | "off";
  /** Whether the technician is working (on-shift) for the current board context */
  isWorking?: boolean;
};

/** Sentinel ID for the virtual "Unassigned" lane */
export const UNASSIGNED_TECH_ID = "__unassigned__";

export type DispatchVisit = {
  id: string;
  visitNumber: number;
  jobNumber: number;
  jobId: string;
  summary: string;
  status: VisitStatus;
  /** Parent job status (open, completed, invoiced, archived) */
  jobStatus: string;
  /** Job workflow sub-status (null, in_progress, on_hold, on_route) */
  jobOpenSubStatus: string | null;
  locationName: string;
  customerName: string;
  /** Canonical assigned crew (visit-level). Multi-tech visits have length > 1.
   *  2026-04-19: the legacy scalar `technicianId` was removed — derive a
   *  primary tech for color/DnD/single-select via `technicianIds[0] ?? null`. */
  technicianIds: string[];
  scheduledStart: string | null; // ISO datetime
  scheduledEnd: string | null;
  durationMinutes: number;
  isAllDay: boolean;
  priority: "normal" | "high" | "urgent";
  /** Optimistic locking version from backend */
  version: number;
  /** Discriminant: "visit" = real scheduled visit, "backlog" = unscheduled backlog item.
   * Both may carry a real visitId — use visitId for modal opening, not id. */
  kind: "visit" | "backlog";
  /** 2026-03-22: Real visit ID from job_visits table. For scheduled visits, equals `id`.
   *  For backlog items, may be present if the job has an active visit placeholder.
   *  Null if no active visit exists. Use this for EditVisitModal, not `id`. */
  visitId: string | null;
  // Extended fields for detail panel (mapped from CalendarEventDto when available)
  jobType?: string;
  locationId?: string;
  customerCompanyId?: string | null;
  description?: string | null;
  accessInstructions?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  locationNotes?: string | null;
  visitNotes?: string | null;
  /** Display names of all assigned technicians */
  technicianNames?: string[];
  /** Location address fields for dispatch detail panel */
  locationAddress?: string | null;
  locationCity?: string | null;
  locationProvinceState?: string | null;
  locationPostalCode?: string | null;
  /** Client location latitude (from client_locations) */
  lat?: string | null;
  /** Client location longitude (from client_locations) */
  lng?: string | null;
  /** Equipment IDs from job_visits.equipment_ids — propagated from job-level equipment */
  equipmentIds?: string[] | null;
};

/**
 * Lead visit rendered on the dispatch board — sibling to DispatchVisit.
 * 2026-05-05 Phase 3: pre-sales onsite appointments. Distinct shape
 * because lead visits have NO jobNumber, NO job lifecycle, NO drag /
 * resize / status workflow. Click-through goes to /leads/:leadId, not
 * to a job detail page. Always carries `type: "lead_visit"` so
 * consumers can branch render rules unambiguously.
 */
export type DispatchLeadVisit = {
  type: "lead_visit";
  id: string;
  leadId: string;
  leadTitle: string;
  technicianIds: string[];
  technicianNames: string[];
  scheduledStart: string | null;
  scheduledEnd: string | null;
  durationMinutes: number | null;
  isAllDay: boolean;
  status: "scheduled" | "in_progress" | "completed" | "cancelled";
  locationName: string | null;
  locationAddress: string | null;
  locationCity: string | null;
  locationProvinceState: string | null;
  customerName: string | null;
};

/** Task item rendered on the dispatch timeline */
export type DispatchTask = {
  id: string;
  title: string;
  type: string;
  status: string;
  assignedToUserId: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  durationMinutes: number;
  isAllDay: boolean;
  notes: string | null;
  jobId: string | null;
  locationId: string | null;
};
