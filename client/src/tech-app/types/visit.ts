/** Technician PWA — Visit types (UI prototype only, no backend dependency)
 *  2026-03-27: Structured notes with timestamps and equipment linking.
 *  2026-04-03: Added JobType, MockPart, MockTechnician for enhanced UI. */

export type VisitStatus = "scheduled" | "en_route" | "in_progress" | "completed" | "on_hold";

export type Outcome = "completed" | "needs_parts" | "needs_followup" | "on_hold";

/** Job classification for schedule card tags */
export type JobType = "pm" | "service" | "urgent" | "install";

export interface MockEquipment {
  id: string;
  name: string;
  model?: string;
  serial?: string;
}

export interface MockNote {
  id: string;
  text: string;
  timestamp: string; // ISO
  technician: string;
  /** If set, this note is attached to a specific equipment */
  equipmentId?: string;
}

/** Parts logged against equipment (UI state only) */
export interface MockPart {
  id: string;
  equipmentId: string;
  name: string;
  qty: number;
  price?: number;
}

/** Technician for team schedule view */
export interface MockTechnician {
  id: string;
  name: string;
  color: string;
}

export interface MockVisit {
  id: string;
  company: string;
  jobTitle: string;
  address: string;
  status: VisitStatus;
  scheduledTime: string;
  scheduledEnd: string;
  visitNumber: number;
  timerRunning: boolean;
  notes: MockNote[];
  outcome?: Outcome;
  description?: string;
  instructions?: string;
  equipment: MockEquipment[];
  parts: MockPart[];
  workStartedAt?: string;
  jobType: JobType;
  /** Assigned technician (for team view) */
  technicianId?: string;
}
