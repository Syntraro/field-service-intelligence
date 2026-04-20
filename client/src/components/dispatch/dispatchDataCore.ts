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
import type { DispatchVisit, DispatchTask, Technician } from "./dispatchPreviewTypes";
import {
  mapEventToDispatchVisit,
  mapUnscheduledToDispatchVisits,
  mapRawTask,
  buildTechnicianRoster,
} from "./dispatchPreviewMappers";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";

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

export interface DispatchRangeData {
  scheduledVisits: DispatchVisit[];
  unscheduledVisits: DispatchVisit[];
  scheduledTasks: DispatchTask[];
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

  const { teamMembers, isLoading: techLoading, error: techError } = useTechniciansDirectory();

  const events = scheduledQuery.data?.events ?? [];
  const unscheduledJobs = unscheduledQuery.data ?? [];
  const rawTasks = tasksQuery.data ? normalizeTasks(tasksQuery.data) : [];

  const scheduledVisits = useMemo(() => events.map(mapEventToDispatchVisit), [events]);
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

  return {
    scheduledVisits,
    unscheduledVisits,
    scheduledTasks,
    technicians,
    isLoading: scheduledQuery.isLoading || unscheduledQuery.isLoading || techLoading,
    error: (scheduledQuery.error ?? unscheduledQuery.error ?? techError) as Error | null,
  };
}
