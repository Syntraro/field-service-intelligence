/**
 * useTimesheetState — real backend-backed state hook for the Timesheet page.
 *
 * Phase 3 (2026-04-04): Wired to real backend read endpoints.
 *   Today: GET /api/tech/time/summary (reuses canonical endpoint)
 *   Past day: GET /api/tech/time/day?date=YYYY-MM-DD
 *
 * No edit mutations wired yet (Phase 4).
 */
import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { TimesheetEntry, TimesheetWorkSession } from "../types/timesheet";
import {
  useTimesheetPermissions,
  getEntryAccess,
  type EntryAccess,
} from "./timesheetAccess";

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

function isToday(dateStr: string): boolean {
  return dateStr === toDateStr(new Date());
}

// ── Backend response shapes ──

interface TodaySummaryResponse {
  today: {
    openSession: BackendWorkSession | null;
    runningEntry: BackendTimeEntry | null;
    todayEntries: BackendTimeEntry[];
    summary: { totalMinutes: number; billableMinutes: number; entriesCount: number };
  };
  week: { totalMinutes: number; weekStart: string; weekEnd: string; totalHours: number };
}

interface DayResponse {
  date: string;
  session: BackendWorkSession | null;
  entries: BackendTimeEntry[];
  summary: { totalMinutes: number; entriesCount: number };
}

interface BackendWorkSession {
  id: string;
  workDate: string;
  clockInAt: string;
  clockOutAt: string | null;
  breakMinutes: number | null;
  [key: string]: unknown;
}

interface BackendTimeEntry {
  id: string;
  type: string;
  jobId: string | null;
  startAt: string;
  endAt: string | null;
  durationMinutes: number | null;
  notes: string | null;
  billable: boolean;
  lockedAt: string | null;
  lockedByInvoiceId: string | null;
  lockReason: string | null;
  // Job context from server join
  jobNumber: number | null;
  jobSummary: string | null;
  locationName: string | null;
  [key: string]: unknown;
}

/** Payload for saving an edited entry */
export interface EntryEditPayload {
  startAt: string;
  endAt: string | null;
  notes: string | null;
}

// ── Adapters ──

function toTimesheetEntry(e: BackendTimeEntry): TimesheetEntry {
  return {
    id: e.id,
    type: e.type,
    jobId: e.jobId,
    startAt: e.startAt,
    endAt: e.endAt,
    durationMinutes: e.durationMinutes,
    notes: e.notes,
    billable: e.billable,
    lockedAt: e.lockedAt,
    lockedByInvoiceId: e.lockedByInvoiceId,
    lockReason: e.lockReason,
    jobNumber: e.jobNumber ?? null,
    jobSummary: e.jobSummary ?? null,
    locationName: e.locationName ?? null,
  };
}

function toTimesheetSession(s: BackendWorkSession): TimesheetWorkSession {
  return {
    id: s.id,
    workDate: s.workDate,
    clockInAt: s.clockInAt,
    clockOutAt: s.clockOutAt,
    breakMinutes: s.breakMinutes,
  };
}

// ── Hook ──

export function useTimesheetState() {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const selectedDateStr = toDateStr(selectedDate);
  const todaySelected = isToday(selectedDateStr);

  // Edit-sheet state
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [editSheetOpen, setEditSheetOpen] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const permissions = useTimesheetPermissions();

  // ── Data fetching ──

  // Today: use the summary endpoint (includes session, entries, totals, running entry)
  const todayQuery = useQuery<TodaySummaryResponse>({
    queryKey: ["/api/tech/time/summary"],
    enabled: todaySelected,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  // Past day: use the day endpoint (apiRequest handles session-expired + error typing)
  const dayQuery = useQuery<DayResponse>({
    queryKey: ["/api/tech/time/day", selectedDateStr],
    queryFn: () => apiRequest(`/api/tech/time/day?date=${selectedDateStr}`),
    enabled: !todaySelected,
  });

  // ── Derive UI state from whichever query is active ──

  // Backend guarantees orderBy(asc(startAt)) — no frontend re-sort needed
  const dayEntries: TimesheetEntry[] = useMemo(() => {
    if (todaySelected) {
      return (todayQuery.data?.today.todayEntries ?? []).map(toTimesheetEntry);
    }
    return (dayQuery.data?.entries ?? []).map(toTimesheetEntry);
  }, [todaySelected, todayQuery.data, dayQuery.data]);

  const daySession: TimesheetWorkSession | null = useMemo(() => {
    if (todaySelected) {
      const s = todayQuery.data?.today.openSession;
      return s ? toTimesheetSession(s) : null;
    }
    const s = dayQuery.data?.session;
    return s ? toTimesheetSession(s) : null;
  }, [todaySelected, todayQuery.data, dayQuery.data]);

  const dayTotalMinutes: number = useMemo(() => {
    if (todaySelected) return todayQuery.data?.today.summary.totalMinutes ?? 0;
    return dayQuery.data?.summary.totalMinutes ?? 0;
  }, [todaySelected, todayQuery.data, dayQuery.data]);

  const isShiftActive = daySession !== null && daySession.clockOutAt === null;

  const isLoading = todaySelected ? todayQuery.isLoading : dayQuery.isLoading;
  const isError = todaySelected ? todayQuery.isError : dayQuery.isError;

  // ── Selected entry + access ──

  const selectedEntry: TimesheetEntry | null = useMemo(() => {
    if (!selectedEntryId) return null;
    return dayEntries.find((e) => e.id === selectedEntryId) ?? null;
  }, [dayEntries, selectedEntryId]);

  const selectedEntryAccess: EntryAccess | null = useMemo(() => {
    if (!selectedEntry) return null;
    return getEntryAccess(selectedEntry, permissions);
  }, [selectedEntry, permissions]);

  // Open the edit sheet for any entry (access layer decides mode)
  const openEntry = useCallback((entryId: string) => {
    const entry = dayEntries.find((e) => e.id === entryId);
    if (!entry) return;
    const access = getEntryAccess(entry, permissions);
    if (!access.canOpen) return;
    setSelectedEntryId(entryId);
    setEditSheetOpen(true);
  }, [dayEntries, permissions]);

  const closeEditSheet = useCallback(() => {
    setEditSheetOpen(false);
    setSelectedEntryId(null);
  }, []);

  // ── Edit mutation (Phase 4) ──

  const queryClient = useQueryClient();

  const updateEntryMutation = useMutation({
    mutationFn: async ({ entryId, payload }: { entryId: string; payload: EntryEditPayload }) => {
      return apiRequest(`/api/time/entries/${entryId}`, {
        method: "PUT",
        body: JSON.stringify({
          startAt: payload.startAt,
          endAt: payload.endAt,
          notes: payload.notes,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tech/time/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tech/time/day", selectedDateStr] });
      closeEditSheet();
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    },
  });

  const updateEntry = useCallback((entryId: string, payload: EntryEditPayload) => {
    const entry = dayEntries.find((e) => e.id === entryId);
    if (!entry) return;
    const access = getEntryAccess(entry, permissions);
    if (access.mode !== "edit") return;
    updateEntryMutation.mutate({ entryId, payload });
  }, [dayEntries, permissions, updateEntryMutation]);

  // Navigation helpers
  const goToDay = (d: Date) => setSelectedDate(d);
  const goToToday = () => setSelectedDate(new Date());

  const goToPrevDay = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 1);
    setSelectedDate(d);
  };

  const goToNextDay = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + 1);
    setSelectedDate(d);
  };

  return {
    selectedDate,
    selectedDateStr,
    dayEntries,
    daySession,
    dayTotalMinutes,
    isShiftActive,
    isLoading,
    isError,
    goToDay,
    goToToday,
    goToPrevDay,
    goToNextDay,
    // Edit sheet state + access
    selectedEntry,
    selectedEntryId,
    selectedEntryAccess,
    editSheetOpen,
    openEntry,
    closeEditSheet,
    updateEntry,
    isSaving: updateEntryMutation.isPending,
    saveError: updateEntryMutation.error as Error | null,
    saveSuccess,
  };
}
