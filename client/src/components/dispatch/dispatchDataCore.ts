/**
 * dispatchDataCore — shared range-based data fetching for all dispatch views.
 * Deduplicates fetch + normalize logic previously repeated in day/week hooks.
 * 2026-03-31: Extracted from useDispatchPreviewData + useDispatchWeekData.
 *
 * Queries the same canonical endpoints:
 *   - GET /api/calendar?start=X&end=Y
 *   - GET /api/calendar/unscheduled
 *   - GET /api/tasks?scheduledFromDate=X&scheduledToDate=Y
 * Uses shared mappers from dispatchPreviewMappers.ts.
 */
import { useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { CalendarRangeResponseDto, UnscheduledJobDto } from "@shared/types/scheduling";
import type {
  DispatchVisit,
  DispatchTask,
  DispatchLeadVisit,
  Technician,
} from "./dispatchPreviewTypes";
import {
  mapEventToDispatchVisit,
  mapUnscheduledToDispatchVisits,
  mapRawTask,
  buildTechnicianRoster,
} from "./dispatchPreviewMappers";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";

// 2026-05-05 Phase 3: lead-visit dispatch envelope. Fetched in parallel
// with the canonical job calendar feed; merged client-side ONLY (no
// SQL UNION). Pinned by the source-pin test.
interface LeadVisitDispatchResponse {
  visits: Array<{
    type: "lead_visit";
    id: string;
    leadId: string;
    leadTitle: string;
    scheduledStart: string | null;
    scheduledEnd: string | null;
    isAllDay: boolean;
    durationMinutes: number | null;
    status: "scheduled" | "in_progress" | "completed" | "cancelled";
    assignedTechnicianIds: string[];
    technicianNames: string[];
    location: {
      id: string;
      companyName: string | null;
      address: string | null;
      city: string | null;
      province: string | null;
      postalCode: string | null;
    } | null;
    customerCompanyName: string | null;
  }>;
}

function mapLeadVisitDispatch(
  raw: LeadVisitDispatchResponse["visits"][number],
): DispatchLeadVisit {
  return {
    type: "lead_visit",
    id: raw.id,
    leadId: raw.leadId,
    leadTitle: raw.leadTitle,
    technicianIds: raw.assignedTechnicianIds ?? [],
    technicianNames: raw.technicianNames ?? [],
    scheduledStart: raw.scheduledStart,
    scheduledEnd: raw.scheduledEnd,
    durationMinutes: raw.durationMinutes ?? null,
    isAllDay: raw.isAllDay,
    status: raw.status,
    locationName: raw.location?.companyName ?? null,
    locationAddress: raw.location?.address ?? null,
    locationCity: raw.location?.city ?? null,
    locationProvinceState: raw.location?.province ?? null,
    customerName: raw.customerCompanyName ?? null,
  };
}

/** Shared JSON fetcher with credentials */
export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/** Normalize task API response (handles {items:[...]}, [...], {data:[...]}) */
export function normalizeTasks(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

/** 2026-05-07 RALPH (technician time off): one row of time off per
 *  tech, surfaced to the dispatch board for visual rendering +
 *  pre-flight conflict warning when dragging visits onto an off
 *  technician. Mirrors the API response shape from
 *  `GET /api/technician-time-off?start&end`. */
export interface DispatchTimeOffEntry {
  id: string;
  technicianUserId: string;
  reason: string;
  startsAt: string; // ISO
  endsAt: string;   // ISO
  allDay: boolean;
  note: string | null;
}

interface TechnicianTimeOffListResponse {
  entries: Array<{
    id: string;
    technicianUserId: string;
    reason: string;
    startsAt: string;
    endsAt: string;
    allDay: boolean;
    note: string | null;
  }>;
}

export interface DispatchRangeData {
  scheduledVisits: DispatchVisit[];
  unscheduledVisits: DispatchVisit[];
  scheduledTasks: DispatchTask[];
  /** 2026-05-05 Phase 3: pre-sales onsite appointments. Parallel
   *  array — never mixed into `scheduledVisits` because the type
   *  shapes differ (no jobNumber, no job lifecycle). */
  leadVisits: DispatchLeadVisit[];
  /** 2026-05-07 RALPH (technician time off): time-off rows whose
   *  interval overlaps the requested range. Empty array when the
   *  endpoint fails (defensive — a missing migration must not
   *  break dispatch). */
  timeOff: DispatchTimeOffEntry[];
  technicians: Technician[];
  isLoading: boolean;
  error: Error | null;
}

/**
 * Widen a local date start to also capture UTC midnight (for allDay visits).
 * In timezones behind UTC, local midnight is AFTER UTC midnight, so we use
 * min(localStart, utcStart) to capture both timed and allDay visits.
 */
export function widenStartForAllDay(date: Date, localStartISO: string): string {
  const utcStart = new Date(Date.UTC(
    date.getFullYear(), date.getMonth(), date.getDate()
  )).toISOString();
  return localStartISO < utcStart ? localStartISO : utcStart;
}

/**
 * Core range-based data hook used by Day, Week, and Month views.
 * Fetches calendar events, unscheduled backlog, tasks, and technician roster
 * for the given date range. All views share the same endpoints and mappers.
 */
export function useDispatchRangeData(
  startISO: string,
  endISO: string,
  taskQueryKey: string,
  taskLimit: number,
  enabled: boolean,
): DispatchRangeData {
  const scheduledQuery = useQuery<CalendarRangeResponseDto>({
    queryKey: ["/api/calendar", startISO, endISO],
    queryFn: () =>
      fetchJson<CalendarRangeResponseDto>(
        `/api/calendar?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`
      ),
    staleTime: 30_000,
    enabled,
    // Keep previous date range visible while navigating to a new date — prevents empty flash
    placeholderData: keepPreviousData,
  });

  const unscheduledQuery = useQuery<UnscheduledJobDto[]>({
    queryKey: ["/api/calendar/unscheduled"],
    queryFn: () => fetchJson<UnscheduledJobDto[]>("/api/calendar/unscheduled"),
    staleTime: 60_000,
    enabled,
  });

  const tasksQuery = useQuery<any>({
    queryKey: ["/api/tasks", taskQueryKey],
    queryFn: () =>
      fetchJson<any>(
        `/api/tasks?scheduledFromDate=${encodeURIComponent(startISO)}&scheduledToDate=${encodeURIComponent(endISO)}&limit=${taskLimit}`
      ),
    staleTime: 30_000,
    enabled,
    // Keep previous range tasks visible while navigating dates — prevents empty flash
    placeholderData: keepPreviousData,
  });

  // 2026-05-05 Phase 3: parallel lead-visit fetch. Never merged into
  // the job calendar feed at the SQL level — UI merge ONLY (consumers
  // render lead visits with their own LEAD badge + amber tint).
  const leadVisitsQuery = useQuery<LeadVisitDispatchResponse>({
    queryKey: ["/api/calendar/lead-visits", startISO, endISO],
    queryFn: () =>
      fetchJson<LeadVisitDispatchResponse>(
        `/api/calendar/lead-visits?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`,
      ),
    staleTime: 30_000,
    enabled,
    placeholderData: keepPreviousData,
  });

  // 2026-05-07 RALPH (technician time off): fetch overlapping
  // time-off rows for the visible range. Defensive: failures here
  // (e.g., the migration hasn't been applied yet) must NOT break
  // dispatch — the query is gated independently and the response
  // is treated as empty on error. `retry: 1` so a backend failure
  // surfaces fast instead of through React Query's default
  // exponential backoff.
  const timeOffQuery = useQuery<TechnicianTimeOffListResponse>({
    queryKey: ["/api/technician-time-off", startISO, endISO],
    queryFn: () =>
      fetchJson<TechnicianTimeOffListResponse>(
        `/api/technician-time-off?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`,
      ),
    staleTime: 30_000,
    enabled,
    retry: 1,
    placeholderData: keepPreviousData,
  });

  const { teamMembers, isLoading: techLoading, error: techError } = useTechniciansDirectory();

  const events = scheduledQuery.data?.events ?? [];
  const unscheduledJobs = unscheduledQuery.data ?? [];
  const rawTasks = tasksQuery.data ? normalizeTasks(tasksQuery.data) : [];
  const rawLeadVisits = leadVisitsQuery.data?.visits ?? [];

  const scheduledVisits = useMemo(() => events.map(mapEventToDispatchVisit), [events]);
  const leadVisits = useMemo(
    () => rawLeadVisits.map(mapLeadVisitDispatch),
    [rawLeadVisits],
  );
  // 2026-04-18 Phase 3: flatMap — one backlog card per unscheduled visit
  // (not per job). Multi-visit jobs intentionally surface multiple cards.
  const unscheduledVisits = useMemo(
    () => unscheduledJobs.flatMap(mapUnscheduledToDispatchVisits),
    [unscheduledJobs],
  );
  const scheduledTasks = useMemo(() => rawTasks.map(mapRawTask), [rawTasks]);

  const technicians = useMemo(
    () => buildTechnicianRoster(teamMembers),
    [teamMembers],
  );

  // 2026-05-07 RALPH: time-off normalization. A failure here
  // returns an empty array — dispatch keeps working, the visual
  // shading + drag warning silently no-op.
  const timeOff: DispatchTimeOffEntry[] = useMemo(
    () =>
      (timeOffQuery.data?.entries ?? []).map((row) => ({
        id: row.id,
        technicianUserId: row.technicianUserId,
        reason: row.reason,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        allDay: row.allDay,
        note: row.note,
      })),
    [timeOffQuery.data],
  );

  return {
    scheduledVisits,
    unscheduledVisits,
    scheduledTasks,
    leadVisits,
    timeOff,
    technicians,
    // Time-off + lead-visit loading do NOT block the overall
    // isLoading — they're additive layers; a missing time-off table
    // must not surface as a dispatch-wide spinner.
    isLoading:
      scheduledQuery.isLoading || unscheduledQuery.isLoading || techLoading,
    error: (scheduledQuery.error ?? unscheduledQuery.error ?? techError) as Error | null,
  };
}
