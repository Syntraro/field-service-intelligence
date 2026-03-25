/**
 * useDispatchWeekData — fetches calendar + task data for an entire week.
 * Groups visits and tasks by technician and by day for the Week view grid.
 * Shares the same mapper layer as the Day view data hook.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { startOfWeek, endOfWeek, eachDayOfInterval, startOfDay, endOfDay, format } from "date-fns";
import type { CalendarRangeResponseDto, UnscheduledJobDto } from "@shared/types/scheduling";
import type { DispatchVisit, DispatchTask, Technician } from "./dispatchPreviewTypes";
import { UNASSIGNED_TECH_ID } from "./dispatchPreviewTypes";
import {
  mapEventToDispatchVisit,
  mapUnscheduledToDispatchVisit,
  mapRawTask,
  buildTechnicianRoster,
} from "./dispatchPreviewMappers";
import { getDispatchDayKey } from "./dispatchPreviewUtils";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

function normalizeTasks(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

export function useDispatchWeekData(selectedDate: Date) {
  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(selectedDate, { weekStartsOn: 1 });
  const localWeekStartISO = startOfDay(weekStart).toISOString();
  const weekEndISO = endOfDay(weekEnd).toISOString();

  // Widen query start to capture allDay visits at UTC midnight (same fix as day view)
  const utcWeekStart = new Date(Date.UTC(
    weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate()
  )).toISOString();
  const weekStartISO = localWeekStartISO < utcWeekStart ? localWeekStartISO : utcWeekStart;

  const scheduledQuery = useQuery<CalendarRangeResponseDto>({
    queryKey: ["/api/calendar", weekStartISO, weekEndISO],
    queryFn: () =>
      fetchJson<CalendarRangeResponseDto>(
        `/api/calendar?start=${encodeURIComponent(weekStartISO)}&end=${encodeURIComponent(weekEndISO)}`
      ),
    staleTime: 30_000,
  });

  const unscheduledQuery = useQuery<UnscheduledJobDto[]>({
    queryKey: ["/api/calendar/unscheduled"],
    queryFn: () => fetchJson<UnscheduledJobDto[]>("/api/calendar/unscheduled"),
    staleTime: 60_000,
  });

  const tasksQuery = useQuery<any>({
    queryKey: ["/api/tasks", "dispatch-week", format(weekStart, "yyyy-MM-dd")],
    queryFn: () =>
      fetchJson<any>(
        `/api/tasks?scheduledFromDate=${encodeURIComponent(weekStartISO)}&scheduledToDate=${encodeURIComponent(weekEndISO)}&limit=500`
      ),
    staleTime: 30_000,
  });

  const { teamMembers, isLoading: techLoading, error: techError } = useTechniciansDirectory();

  const events = scheduledQuery.data?.events ?? [];
  const unscheduledJobs = unscheduledQuery.data ?? [];
  const rawTasks = tasksQuery.data ? normalizeTasks(tasksQuery.data) : [];

  const scheduledVisits = useMemo(() => events.map(mapEventToDispatchVisit), [events]);
  const unscheduledVisits = useMemo(() => unscheduledJobs.map(mapUnscheduledToDispatchVisit), [unscheduledJobs]);
  const scheduledTasks = useMemo(() => rawTasks.map(mapRawTask), [rawTasks]);

  const technicians = useMemo(
    () => buildTechnicianRoster(teamMembers, events),
    [teamMembers, events],
  );

  const weekDays = useMemo(
    () => eachDayOfInterval({ start: weekStart, end: weekEnd }),
    [weekStart.getTime(), weekEnd.getTime()],
  );

  /** Multi-tech: visits grouped by each assigned technicianId -> "yyyy-MM-dd" -> DispatchVisit[]
   *  Fix 2026-03-23: Unassigned visits (no technicianId) are bucketed under UNASSIGNED_TECH_ID
   *  so they remain visible in the week grid instead of silently disappearing. */
  const visitsByTechByDay = useMemo(() => {
    const map = new Map<string, Map<string, DispatchVisit[]>>();
    for (const visit of scheduledVisits) {
      if (!visit.scheduledStart) continue;
      const techIds = visit.technicianIds.length > 0 ? visit.technicianIds : (visit.technicianId ? [visit.technicianId] : []);
      const dayKey = getDispatchDayKey(visit.scheduledStart, visit.isAllDay);
      if (techIds.length === 0) {
        // Scheduled but unassigned — bucket under virtual Unassigned lane
        if (!map.has(UNASSIGNED_TECH_ID)) map.set(UNASSIGNED_TECH_ID, new Map());
        const uMap = map.get(UNASSIGNED_TECH_ID)!;
        if (!uMap.has(dayKey)) uMap.set(dayKey, []);
        uMap.get(dayKey)!.push(visit);
        continue;
      }
      for (const tid of techIds) {
        if (!map.has(tid)) map.set(tid, new Map());
        const techMap = map.get(tid)!;
        if (!techMap.has(dayKey)) techMap.set(dayKey, []);
        techMap.get(dayKey)!.push(visit);
      }
    }
    return map;
  }, [scheduledVisits]);

  /** Tasks grouped by assignedToUserId -> "yyyy-MM-dd" -> DispatchTask[] */
  const tasksByTechByDay = useMemo(() => {
    const map = new Map<string, Map<string, DispatchTask[]>>();
    for (const task of scheduledTasks) {
      if (!task.scheduledStart || !task.assignedToUserId) continue;
      const dayKey = getDispatchDayKey(task.scheduledStart, false);
      if (!map.has(task.assignedToUserId)) map.set(task.assignedToUserId, new Map());
      const techMap = map.get(task.assignedToUserId)!;
      if (!techMap.has(dayKey)) techMap.set(dayKey, []);
      techMap.get(dayKey)!.push(task);
    }
    return map;
  }, [scheduledTasks]);

  return {
    scheduledVisits,
    unscheduledVisits,
    scheduledTasks,
    technicians,
    weekDays,
    visitsByTechByDay,
    tasksByTechByDay,
    isLoading: scheduledQuery.isLoading || unscheduledQuery.isLoading || techLoading,
    error: (scheduledQuery.error ?? unscheduledQuery.error ?? techError) as Error | null,
  };
}
