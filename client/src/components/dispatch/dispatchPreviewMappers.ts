/**
 * Dispatch Board Mappers
 * Maps CalendarEventDto / UnscheduledJobDto → DispatchVisit / Technician
 * Read-only mapper layer — no mutations.
 *
 * buildTechnicianRoster() creates the authoritative tech roster from
 * GET /api/team/technicians with canonical team colors.
 */
import type { CalendarEventDto, UnscheduledJobDto, CalendarTechnicianDto } from "@shared/types/scheduling";
import type { TeamMember } from "@/hooks/useTechnicians";
import type { DispatchVisit, DispatchTask, Technician, VisitStatus } from "./dispatchPreviewTypes";
// Phase 1 Map Convergence: shared color palette
import { TECHNICIAN_COLORS } from "@shared/colors";

// 2026-03-18: Removed "open" (not a real visit status), added "on_hold" and "cancelled"
const VALID_VISIT_STATUSES = new Set<VisitStatus>([
  "scheduled", "dispatched", "en_route", "on_site", "in_progress", "on_hold", "completed", "cancelled",
]);

function toVisitStatus(raw: string | undefined): VisitStatus {
  if (raw && VALID_VISIT_STATUSES.has(raw as VisitStatus)) return raw as VisitStatus;
  return "scheduled";
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? "")
    .join("");
}

// Phase 1 Map Convergence: Use shared palette (was local DEFAULT_COLORS with 8 entries)
const DEFAULT_COLORS = TECHNICIAN_COLORS;

/** Map CalendarEventDto → DispatchVisit */
export function mapEventToDispatchVisit(event: CalendarEventDto): DispatchVisit {
  const resolvedVisitId = event.visitId ?? event.id;
  return {
    // Use visitId for visit-level mutations; event.id may equal jobId in current API
    id: resolvedVisitId,
    visitNumber: event.visitNumber ?? 1,
    jobNumber: event.jobNumber,
    jobId: event.jobId,
    summary: event.summary,
    status: toVisitStatus(event.visitStatus),
    jobStatus: event.status,
    jobOpenSubStatus: event.openSubStatus ?? null,
    locationName: event.locationName,
    customerName: event.customerCompanyName ?? event.locationName,
    // 2026-04-12 (Option A): assignedTechnicianIds on the event DTO is the
    // visit-derived crew (server-computed). No fallback to primaryTechnicianId.
    technicianId: event.assignedTechnicianIds?.[0] ?? null,
    technicianIds: Array.isArray(event.assignedTechnicianIds) ? event.assignedTechnicianIds : [],
    scheduledStart: event.startAt,
    scheduledEnd: event.endAt,
    durationMinutes: event.durationMinutes,
    isAllDay: event.allDay,
    priority: "normal",
    version: event.version,
    kind: "visit",
    // 2026-03-22: Explicit visit identity — always use this for EditVisitModal
    visitId: resolvedVisitId,
    jobType: event.jobType ?? undefined,
    locationId: event.locationId,
    customerCompanyId: event.customerCompanyId,
    description: event.description,
    accessInstructions: event.accessInstructions,
    contactName: event.contactName,
    contactPhone: event.contactPhone,
    locationNotes: event.locationNotes,
    visitNotes: event.visitNotes,
    technicianNames: event.technicians.map(t => t.name),
    locationAddress: event.locationAddress,
    locationCity: event.locationCity,
    locationProvinceState: event.locationProvinceState,
    locationPostalCode: event.locationPostalCode,
    lat: event.lat ?? null,
    lng: event.lng ?? null,
    equipmentIds: (event as any).equipmentIds ?? null,
  };
}

/** Map UnscheduledJobDto → DispatchVisit (null scheduling fields) */
export function mapUnscheduledToDispatchVisit(job: UnscheduledJobDto): DispatchVisit {
  return {
    id: job.id,
    visitNumber: 0,
    jobNumber: job.jobNumber,
    jobId: job.jobId,
    summary: job.summary,
    status: "scheduled",  // 2026-03-18: unscheduled backlog items display as "scheduled"
    jobStatus: job.status,
    jobOpenSubStatus: job.openSubStatus ?? null,
    locationName: job.locationName,
    customerName: job.customerCompanyName ?? job.locationName,
    // 2026-04-12 (Option A): visit-derived crew from server.
    technicianId: job.assignedTechnicianIds?.[0] ?? null,
    technicianIds: Array.isArray(job.assignedTechnicianIds) ? job.assignedTechnicianIds : [],
    scheduledStart: null,
    scheduledEnd: null,
    // PM dispatch fix: use actual job duration from backend (falls back to 60 for legacy jobs)
    durationMinutes: job.durationMinutes ?? 60,
    isAllDay: false,
    priority: "normal",
    version: job.version,
    kind: "backlog",
    // 2026-03-22: Real visit ID from server — enables canonical EditVisitModal opening.
    // Null if no active visit exists (scheduleJob will create one on first schedule).
    visitId: job.activeVisitId ?? null,
    jobType: job.jobType ?? undefined,
    locationId: job.locationId,
    customerCompanyId: job.customerCompanyId,
    technicianNames: job.technicians.map(t => t.name),
    locationAddress: job.locationAddress,
    locationCity: job.locationCity,
    locationProvinceState: job.locationProvinceState,
    locationPostalCode: job.locationPostalCode,
    // Map coordinates for dispatch map markers (same as scheduled mapper)
    lat: job.lat ?? null,
    lng: job.lng ?? null,
  };
}

/** Map raw task API response to DispatchTask */
export function mapRawTask(task: any): DispatchTask {
  const start = task.scheduledStartAt ? new Date(task.scheduledStartAt) : null;
  const end = task.scheduledEndAt ? new Date(task.scheduledEndAt) : null;
  let durationMinutes = task.estimatedDurationMinutes ?? 60;
  if (start && end) {
    durationMinutes = Math.max(15, Math.round((end.getTime() - start.getTime()) / 60000));
  }
  return {
    id: task.id,
    title: task.title,
    type: task.type ?? "GENERAL",
    status: task.status ?? "pending",
    assignedToUserId: task.assignedToUserId ?? null,
    scheduledStart: task.scheduledStartAt ?? null,
    scheduledEnd: task.scheduledEndAt ?? null,
    durationMinutes,
    isAllDay: task.allDay ?? false,
    notes: task.notes ?? null,
    jobId: task.jobId ?? null,
    locationId: task.locationId ?? null,
  };
}

/**
 * Build the authoritative technician roster from the team directory.
 * Color comes exclusively from canonical TeamMember.color (technicianProfiles
 * via /api/team/technicians), with a deterministic palette fallback.
 * 2026-03-31: Removed event-mined color fallback — canonical team color is now
 * the single source of truth.
 */
export function buildTechnicianRoster(
  teamMembers: TeamMember[],
): Technician[] {
  return teamMembers.map((m, i) => ({
    id: m.id,
    name: m.fullName,
    initials: getInitials(m.fullName),
    color: m.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length],
    status: "available" as const,
  }));
}
