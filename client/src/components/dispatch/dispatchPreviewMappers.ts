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
import type { DispatchVisit, DispatchTask, Technician, VisitStatus, DispatchQueueBucket } from "./dispatchPreviewTypes";
import { DISPATCH_QUEUE_BUCKET_VALUES } from "./dispatchPreviewTypes";
// Phase 1 Map Convergence: shared color palette.
// 2026-04-20 Phase 3: use resolveTechnicianColor so dispatch, team hub, profile
// page and selectors agree without depending on roster order.
import { resolveTechnicianColor } from "@shared/colors";

function normalizeQueueBucket(raw: string | null | undefined): DispatchQueueBucket {
  if (raw && (DISPATCH_QUEUE_BUCKET_VALUES as readonly string[]).includes(raw)) {
    return raw as DispatchQueueBucket;
  }
  return "today";
}

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
    // 2026-04-19: scalar `technicianId` removed from DispatchVisit — color
    // and DnD callers derive a primary via `technicianIds[0] ?? null`. The
    // visit-derived crew is server-computed; no fallback to job-level fields.
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
    dispatchQueueBucket: "today",
    dispatchOrder: event.dispatchOrder ?? null,
  };
}

/**
 * 2026-04-18 Phase 3 (multi-visit UI): produce ONE DispatchVisit per
 * unscheduled visit on the job (not one card per job).
 *
 * Shape rules:
 *   - N>=1 active non-terminal visit ids → N cards. Each card carries
 *     its own `visitId`, a unique `id` (= visitId), and a sequential
 *     `visitNumber` derived from the server-ordered `visitIds` position.
 *   - Zero visit ids (edge case: backlog job with no placeholder visit
 *     yet) → one "job placeholder" card with `visitId: null` and
 *     `id: job.id`. Clicking or dragging it creates a brand-new visit
 *     (no targetVisitId).
 *
 * Siblings on the same job render as siblings — no deduplication. This
 * is the locked product rule that multi-visit jobs appearing multiple
 * times in the backlog is valid, not a bug.
 */
function buildBacklogCard(
  job: UnscheduledJobDto,
  visitId: string | null,
  visitNumber: number,
  bucket: DispatchQueueBucket,
): DispatchVisit {
  return {
    // Card identity must be unique per card — the visit id when we have
    // one, the job id otherwise (fallback for the zero-visit placeholder).
    id: visitId ?? job.id,
    visitNumber,
    jobNumber: job.jobNumber,
    jobId: job.jobId,
    summary: job.summary,
    status: "scheduled",
    jobStatus: job.status,
    jobOpenSubStatus: job.openSubStatus ?? null,
    locationName: job.locationName,
    customerName: job.customerCompanyName ?? job.locationName,
    technicianIds: Array.isArray(job.assignedTechnicianIds) ? job.assignedTechnicianIds : [],
    scheduledStart: null,
    scheduledEnd: null,
    durationMinutes: job.durationMinutes ?? 60,
    isAllDay: false,
    priority: "normal",
    version: job.version,
    kind: "backlog",
    visitId,
    jobType: job.jobType ?? undefined,
    locationId: job.locationId,
    customerCompanyId: job.customerCompanyId,
    technicianNames: job.technicians.map(t => t.name),
    locationAddress: job.locationAddress,
    locationCity: job.locationCity,
    locationProvinceState: job.locationProvinceState,
    locationPostalCode: job.locationPostalCode,
    lat: job.lat ?? null,
    lng: job.lng ?? null,
    dispatchQueueBucket: bucket,
  };
}

/** Map one UnscheduledJobDto → zero-or-more DispatchVisit cards (one per visit). */
export function mapUnscheduledToDispatchVisits(job: UnscheduledJobDto): DispatchVisit[] {
  const ids = Array.isArray(job.visitIds) ? job.visitIds : [];
  const buckets = Array.isArray(job.visitBuckets) ? job.visitBuckets : [];
  if (ids.length === 0) {
    return [buildBacklogCard(job, null, 0, normalizeQueueBucket(buckets[0]))];
  }
  return ids.map((visitId, idx) =>
    buildBacklogCard(job, visitId, idx + 1, normalizeQueueBucket(buckets[idx]))
  );
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
  return teamMembers.map((m) => ({
    id: m.id,
    name: m.fullName,
    initials: getInitials(m.fullName),
    color: resolveTechnicianColor(m.id, m.color),
    status: "available" as const,
  }));
}
