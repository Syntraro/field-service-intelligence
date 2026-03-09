/**
 * Dispatch Board preview types.
 * Standalone — no dependency on legacy calendar types.
 */

export type VisitStatus =
  | "open"
  | "scheduled"
  | "dispatched"
  | "en_route"
  | "on_site"
  | "in_progress"
  | "completed";

export const VISIT_STATUS_OPTIONS: { value: VisitStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "scheduled", label: "Scheduled" },
  { value: "dispatched", label: "Dispatched" },
  { value: "en_route", label: "En Route" },
  { value: "on_site", label: "On Site" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
];

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
  locationName: string;
  customerName: string;
  technicianId: string | null;
  /** All assigned technician IDs — multi-tech visits have length > 1 */
  technicianIds: string[];
  scheduledStart: string | null; // ISO datetime
  scheduledEnd: string | null;
  durationMinutes: number;
  isAllDay: boolean;
  priority: "normal" | "high" | "urgent";
  /** Optimistic locking version from backend */
  version: number;
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
