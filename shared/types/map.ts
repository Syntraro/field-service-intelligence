/**
 * Shared Map API Types
 *
 * Phase 1 Map Convergence: Types for GET /api/map/day response.
 * Extracted from LiveMapPage.tsx inline types to shared location
 * so both server and client reference the same contract.
 *
 * Phase 2 Map Convergence: MapTechnician is a DISPLAY roster model.
 * The map does not filter by scheduling eligibility — that is dispatch's job.
 * The map shows all active, non-deleted company users for route grouping,
 * color assignment, and optional GPS overlay.
 */

/** Technician display roster entry with optional live GPS position. */
export interface MapTechnician {
  technicianId: string;
  name: string;
  lat: string | null;
  lng: string | null;
  online: boolean;
  lastSeenAt: string | null;
}

/** Visit with geospatial data and risk flags for map rendering. */
export interface MapVisit {
  visitId: string;
  technicianId: string | null;
  locationName: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  durationMinutes?: number;
  lat: string | null;
  lng: string | null;
  status: string;
  source?: "visit" | "job_fallback";
  risk: {
    late?: boolean;
    overdue?: boolean;
    runningLong?: boolean;
  };
}

/** Diagnostic metadata returned alongside map day data. */
export interface MapDayMeta {
  techniciansTotal?: number;
  techniciansOnline?: number;
  jobFallbackCount?: number;
  visitsTotal?: number;
  visitsAssigned?: number;
  visitsUnassigned?: number;
  visitsWithCoords?: number;
  visitsMissingCoords?: number;
  visitsMissingScheduledStart?: number;
  /** Diagnostic hints for empty states */
  reasonTechsEmpty?: string;
  reasonVisitsEmpty?: string;
  visitsWithScheduledDateButNoStart?: number;
}

/** Lightweight unscheduled job for the routes panel (fetched separately). */
export interface MapUnscheduledJob {
  id: string;
  jobNumber: number;
  jobType: string;
  summary: string;
  locationName: string;
  customerCompanyName: string | null;
}

/** Response shape from GET /api/map/day. */
export interface MapDayData {
  date: string;
  timezone?: string;
  technicians: MapTechnician[];
  visits: MapVisit[];
  meta?: MapDayMeta;
}
