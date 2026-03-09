/**
 * useDispatchPreviewData — fetches real calendar data for the Dispatch Board.
 * Read-only: no mutations, no scheduling writes.
 *
 * Technician roster: fetched independently from GET /api/team/technicians
 * so the board always shows all schedulable technicians, even on empty days.
 * Colors are enriched from event payload when available.
 *
 * Tasks: fetched from GET /api/tasks for the selected day, rendered alongside visits.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { startOfDay, endOfDay, format } from "date-fns";
import type { CalendarRangeResponseDto, UnscheduledJobDto } from "@shared/types/scheduling";
import type { DispatchVisit, DispatchTask, Technician } from "./dispatchPreviewTypes";
import {
  mapEventToDispatchVisit,
  mapUnscheduledToDispatchVisit,
  mapRawTask,
  buildTechnicianRoster,
} from "./dispatchPreviewMappers";
import { getDispatchDayKey } from "./dispatchPreviewUtils";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";

export interface DispatchPreviewData {
  scheduledVisits: DispatchVisit[];
  unscheduledVisits: DispatchVisit[];
  scheduledTasks: DispatchTask[];
  technicians: Technician[];
  isLoading: boolean;
  error: Error | null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/** Normalize task API response (handles {items:[...]}, [...], {data:[...]}) */
function normalizeTasks(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

export function useDispatchPreviewData(selectedDate: Date): DispatchPreviewData {
  const localDayStart = startOfDay(selectedDate).toISOString();
  const dayEnd = endOfDay(selectedDate).toISOString();
  const dayStr = format(selectedDate, "yyyy-MM-dd");

  // Widen query start to include UTC midnight of the selected date.
  // allDay visits are stored at midnight UTC (e.g., "2026-03-09T00:00:00Z").
  // In timezones behind UTC (e.g., EST), local midnight is AFTER UTC midnight,
  // so the local-timezone range would exclude the current day's allDay visits.
  // Using min(localStart, utcStart) captures both timed and allDay visits.
  const utcDayStart = new Date(Date.UTC(
    selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate()
  )).toISOString();
  const dayStart = localDayStart < utcDayStart ? localDayStart : utcDayStart;

  // Fetch scheduled events for the selected day
  const scheduledQuery = useQuery<CalendarRangeResponseDto>({
    queryKey: ["/api/calendar", dayStart, dayEnd],
    queryFn: () =>
      fetchJson<CalendarRangeResponseDto>(
        `/api/calendar?start=${encodeURIComponent(dayStart)}&end=${encodeURIComponent(dayEnd)}`
      ),
    staleTime: 30_000,
  });

  // Fetch unscheduled backlog (date-independent)
  const unscheduledQuery = useQuery<UnscheduledJobDto[]>({
    queryKey: ["/api/calendar/unscheduled"],
    queryFn: () => fetchJson<UnscheduledJobDto[]>("/api/calendar/unscheduled"),
    staleTime: 60_000,
  });

  // Fetch tasks for the selected day (use full ISO range to include all times)
  const tasksQuery = useQuery<any>({
    queryKey: ["/api/tasks", "dispatch", dayStr],
    queryFn: () =>
      fetchJson<any>(
        `/api/tasks?scheduledFromDate=${encodeURIComponent(dayStart)}&scheduledToDate=${encodeURIComponent(dayEnd)}&limit=200`
      ),
    staleTime: 30_000,
  });

  // Fetch the real technician roster (all schedulable technicians)
  const { teamMembers, isLoading: techLoading, error: techError } = useTechniciansDirectory();

  const events = scheduledQuery.data?.events ?? [];
  const unscheduledJobs = unscheduledQuery.data ?? [];
  const rawTasks = tasksQuery.data ? normalizeTasks(tasksQuery.data) : [];

  // Post-filter all visits by canonical day key.
  // The widened query range (min of local/UTC midnight) may include:
  //   - allDay visits from adjacent days (midnight UTC bleed)
  //   - timed visits from the previous local day (extra range before local midnight)
  // getDispatchDayKey uses UTC extraction for allDay, local for timed — both match dayStr.
  const scheduledVisits = useMemo(() => {
    const mapped = events.map(mapEventToDispatchVisit);
    return mapped.filter(v => {
      if (!v.scheduledStart) return true;
      return getDispatchDayKey(v.scheduledStart, v.isAllDay) === dayStr;
    });
  }, [events, dayStr]);
  const unscheduledVisits = useMemo(() => unscheduledJobs.map(mapUnscheduledToDispatchVisit), [unscheduledJobs]);
  const scheduledTasks = useMemo(() => rawTasks.map(mapRawTask), [rawTasks]);

  // Build technician roster from the real team list, enriched with colors from events
  const technicians = useMemo(
    () => buildTechnicianRoster(teamMembers, events),
    [teamMembers, events],
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
