import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";
import { DndContext, DragOverlay, closestCenter, DragEndEvent, DragStartEvent, pointerWithin, CollisionDetection, PointerSensor, useSensor, useSensors, rectIntersection } from "@dnd-kit/core";
import NewAddClientDialog from "@/components/NewAddClientDialog";
import { JobDetailDialog } from "@/components/JobDetailDialog";
import { PartsDialog } from "@/components/PartsDialog";
import { DiagnosticsPanel } from "@/components/calendar/DiagnosticsPanel";
import { logDrag, isDiagnosticsEnabled } from "@/lib/calendarDiagnostics";
import { IS_DEV } from "@/lib/devFlags";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { X, AlertTriangle, Trash2, Archive, Clock } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { getMemberDisplayName } from "@/lib/displayName";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useCalendarState } from "@/hooks/useCalendarState";
import { useCalendarDnD } from "@/hooks/useCalendarDnD";
import { useCalendarTasks, useUnscheduledTasks } from "@/hooks/useCalendarTasks";
import { taskToCalendarItem } from "@/lib/calendarItems";
import { CalendarSidebar } from "@/components/calendar/CalendarSidebar";
import { TaskDialog } from "@/components/TaskDialog";
import {
  MONTH_ABBREV,
  DENSITY_STYLES,
  CalendarEvent,
  getWeekStart,
  createTechnicianColorMap,
  getTechnicianColorForAssignment,
  normalizeAssignments,
  buildEventIndexes,
  getLocationKey,
  DRAG_ENABLED,
  CalendarHeader,
  CalendarGridMonth,
  CalendarGridWeek,
  CalendarGridWeekTechnicians,
  CalendarGridDay,
  CalendarGridDayJobber, // Jobber-style day grid (2026-01-28)
  CalendarGridDayRows, // Horizontal rows day layout (Polish Pass 2026-03-04)
  ScheduleJobModal,
} from "@/components/calendar";
import { useCompanyRegionalSettings } from "@/hooks/useCompanyRegionalSettings";
import { useCalendarDaySummary, type TechDaySummary } from "@/hooks/useCalendarDaySummary";
import { JobCard } from "@/components/calendar/JobCard";
import { SuggestSlotDialog } from "@/components/calendar/SuggestSlotDialog";
import { toClientsArray, resolveClientForCalendarEvent } from "@/components/calendar/calendarClientLookup";

// ============================================================================
// Safe Array Normalization Utility
// Converts any API response into a safe array - prevents "find is not a function" errors
// ============================================================================

/**
 * Safely normalize any value into an array.
 * Handles: arrays, objects with nested arrays (items/data/clients/jobs/technicians), nullish values.
 * This MUST never throw - it is the first line of defense against malformed API responses.
 */
function normalizeArray<T = any>(value: unknown): T[] {
  // Already an array - return as-is
  if (Array.isArray(value)) return value as T[];

  // Nullish - return empty array
  if (value == null) return [];

  // Object with nested array properties (common API response shapes)
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v.items)) return v.items as T[];
    if (Array.isArray(v.data)) return v.data as T[];
    if (Array.isArray(v.clients)) return v.clients as T[];
    if (Array.isArray(v.jobs)) return v.jobs as T[];
    if (Array.isArray(v.technicians)) return v.technicians as T[];
    if (Array.isArray(v.events)) return v.events as T[];
    if (Array.isArray(v.assignments)) return v.assignments as T[]; // legacy fallback
    // Last resort: try Object.values (for object maps)
    try {
      const values = Object.values(v);
      if (values.length > 0 && typeof values[0] === "object") {
        return values as T[];
      }
    } catch {
      // Ignore - return empty array
    }
  }

  return [];
}

// ============================================================================
// LocationId Adapter Layer (burn-in safe)
// Uses getLocationKey from calendarUtils for consistency
// ============================================================================

/** Alias for getLocationKey - used throughout this file */
const getLocationId = getLocationKey;

/**
 * Find a client by location ID (checks client.id which maps to locationId)
 * SAFE: Normalizes clients to array first - never throws
 */
function findClientByLocationId(clients: unknown, locationId: string): any | undefined {
  const list = normalizeArray<any>(clients);
  return list.find((c) => c?.id === locationId);
}

// ============================================================================
// Unscheduled Sidebar Display Helpers
// ============================================================================

/** Get company name from unscheduled item with fallbacks */
function getUnscheduledCompanyName(item: any): string {
  return (
    item.customerCompanyName ||
    item.companyName ||
    item.clientName ||
    item.client?.companyName ||
    item.client?.name ||
    item.locationName ||
    `Job #${item.jobNumber || item.id?.slice(0, 8) || "Unknown"}`
  );
}

/** Get location label from unscheduled item with fallbacks */
function getUnscheduledLocationLabel(item: any): string {
  return (
    item.location ||
    item.locationName ||
    item.siteAddress ||
    item.address ||
    item.client?.location ||
    item.client?.address ||
    ""
  );
}

// ============================================================================
// Main Calendar Component
// ============================================================================

export default function Calendar() {
  // ========================================
  // State Management Hook (with localStorage persistence)
  // ========================================
  const {
    view,
    setView,
    weeklyViewMode,
    setWeeklyViewMode,
    density,
    sidebarCollapsed: isUnscheduledMinimized,
    toggleSidebarCollapsed,
    showFullDay,
    toggleShowFullDay,
    visibleHours,
    hiddenTechnicianIds,
    toggleTechnicianVisibility,
    currentDate,
    setCurrentDate,
    year,
    month,
    unscheduledSearch,
    setUnscheduledSearch,
    selectedTechnicianId,
    setSelectedTechnicianId,
    expandedAllDaySlots,
    setExpandedAllDaySlots,
    dayLayout,
    toggleDayLayout,
    riskFirstSort,
    toggleRiskFirstSort,
    alertsOnly,
    toggleAlertsOnly,
  } = useCalendarState();

  // Regional settings (timezone, date/time format, week start) from company settings
  const regional = useCompanyRegionalSettings();

  // Calendar Improvement (2026-03-05): Technician day summary for lane headers
  const daySummaryDate = useMemo(() => {
    // For daily view: use currentDate. For weekly: fetch for each day as needed by grids.
    // We fetch the single-day summary for daily view or the week's Monday for weekly view.
    const d = view === "daily" ? currentDate : currentDate;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, [currentDate, view]);
  const { data: techDaySummary } = useCalendarDaySummary(daySummaryDate, view === "daily" || view === "weekly");

  // Build techDaySummary lookup map
  const techSummaryMap = useMemo(() => {
    const map = new Map<string, TechDaySummary>();
    if (techDaySummary) {
      for (const s of techDaySummary) map.set(s.technicianId, s);
    }
    return map;
  }, [techDaySummary]);

  // Local UI state (not persisted)
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedClient, setSelectedClient] = useState<any | null>(null);
  const [selectedAssignment, setSelectedAssignment] = useState<any | null>(null);
  const [reportDialogClientId, setReportDialogClientId] = useState<string | null>(null);
  const [clientDetailOpen, setClientDetailOpen] = useState(false);
  const [focusScheduleSection, setFocusScheduleSection] = useState(false);
  const [partsDialogOpen, setPartsDialogOpen] = useState(false);
  const [partsDialogTitle, setPartsDialogTitle] = useState("");
  const [partsDialogParts, setPartsDialogParts] = useState<Array<{ description: string; quantity: number; date?: string }>>([]);
  const [partsDialogWeekDays, setPartsDialogWeekDays] = useState<Array<{ dayName: string; dateLabel: string; date: Date }>>([]);
  // Schedule Job Modal state (Slice 3)
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleModalDate, setScheduleModalDate] = useState<Date | undefined>();
  const [scheduleModalTechnicianId, setScheduleModalTechnicianId] = useState<string | undefined>();
  const [scheduleModalEdit, setScheduleModalEdit] = useState<any>(null);

  // Task dialog state (Phase 8 of calendar rewrite)
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>();

  // Phase 6: Suggest-slot dialog state
  const [suggestSlotOpen, setSuggestSlotOpen] = useState(false);
  const [suggestSlotItem, setSuggestSlotItem] = useState<any>(null);

  const { toast } = useToast();
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const [addClientDialogOpen, setAddClientDialogOpen] = useState(false);
  const weeklyScrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollDoneRef = useRef(false);

  // Calculate which months to fetch based on view
  const getMonthsToFetch = () => {
    if (view === "weekly") {
      // Get the week range (Monday to Sunday)
      const weekStart = getWeekStart(currentDate, regional.weekStartsOn);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);

      // Collect unique year-month combinations
      const months = new Set<string>();
      const current = new Date(weekStart);
      while (current <= weekEnd) {
        months.add(`${current.getFullYear()}-${current.getMonth() + 1}`);
        current.setDate(current.getDate() + 1);
      }
      return Array.from(months).map(m => {
        const [y, mo] = m.split('-').map(Number);
        return { year: y, month: mo };
      });
    }
    return [{ year, month }];
  };

  const { data, isLoading: isLoadingCalendar, isError: calendarError, refetch: refetchCalendar } = useQuery({
    queryKey: ["/api/calendar", view, year, month, currentDate.getTime()],
    queryFn: async () => {
      const monthsToFetch = getMonthsToFetch();

      // Fetch all needed months in parallel
      const results = await Promise.all(
        monthsToFetch.map(async ({ year: y, month: m }) => {
          const res = await fetch(`/api/calendar?year=${y}&month=${m}`, { credentials: "include" });
          if (!res.ok) throw new Error("Failed to fetch calendar data");
          return res.json();
        })
      );

      // Merge results
      if (results.length === 1) {
        return results[0];
      }

      // Combine events from all months (clients come from /api/clients, not calendar)
      const allEvents = results.flatMap(r => r.events ?? r.assignments ?? []);
      // Sum outsideVisibleHoursCount from all fetched months
      const totalOutsideVisibleHoursCount = results.reduce(
        (sum, r) => sum + (r.outsideVisibleHoursCount || 0),
        0
      );

      return {
        events: allEvents,
        outsideVisibleHoursCount: totalOutsideVisibleHoursCount,
      };
    }
  });

  // Note: No GET endpoint exists for /api/client-parts/bulk - parts feature disabled
  // The bulkParts lookup is used for the parts dialog which shows parts needed per assignment
  // For now, we return an empty object. To enable, a GET endpoint would need to be created.
  const bulkParts: Record<string, any[]> = {};
  const isLoadingParts = false;

  // Prefetch next/prev week data for smoother navigation
  useEffect(() => {
    if (view === "weekly") {
      const currentWeekStart = getWeekStart(currentDate, regional.weekStartsOn);

      // Prefetch previous week
      const prevWeekStart = new Date(currentWeekStart);
      prevWeekStart.setDate(prevWeekStart.getDate() - 7);
      const prevMonth = prevWeekStart.getMonth() + 1;
      const prevYear = prevWeekStart.getFullYear();
      queryClient.prefetchQuery({
        queryKey: ["/api/calendar", "weekly", prevYear, prevMonth, prevWeekStart.getTime()],
        queryFn: async () => {
          const res = await fetch(`/api/calendar?year=${prevYear}&month=${prevMonth}`, { credentials: "include" });
          if (!res.ok) throw new Error("Failed to prefetch");
          return res.json();
        },
        staleTime: 60000,
      });

      // Prefetch next week
      const nextWeekStart = new Date(currentWeekStart);
      nextWeekStart.setDate(nextWeekStart.getDate() + 7);
      const nextMonth = nextWeekStart.getMonth() + 1;
      const nextYear = nextWeekStart.getFullYear();
      queryClient.prefetchQuery({
        queryKey: ["/api/calendar", "weekly", nextYear, nextMonth, nextWeekStart.getTime()],
        queryFn: async () => {
          const res = await fetch(`/api/calendar?year=${nextYear}&month=${nextMonth}`, { credentials: "include" });
          if (!res.ok) throw new Error("Failed to prefetch");
          return res.json();
        },
        staleTime: 60000,
      });
    }
  }, [view, currentDate]);

  // Helper to calculate parts from assignments with optional date tagging
  // Uses canonical scheduledDate field (YYYY-MM-DD string)
  const calculatePartsWithDates = (assignments: any[]) => {
    const partsList: Array<{ description: string; quantity: number; date?: string }> = [];

    assignments.forEach((assignment: any) => {
      const clientPartsList = bulkParts[getLocationId(assignment)] || [];
      // Use scheduledDate directly (canonical field), or parse from startAt/date
      const dateKey = assignment.scheduledDate || assignment.date ||
        (assignment.startAt ? assignment.startAt.split('T')[0] : null);

      clientPartsList.forEach((cp: any) => {
        const part = cp.part;
        let partLabel = '';

        if (part?.type === 'filter') {
          partLabel = `${part.filterType || 'Filter'} ${part.size || ''}`.trim();
        } else if (part?.type === 'belt') {
          partLabel = `Belt ${part.beltType || ''} ${part.size || ''}`.trim();
        } else {
          partLabel = part?.name || 'Other Part';
        }

        partsList.push({
          description: partLabel,
          quantity: cp.quantity || 1,
          date: dateKey
        });
      });
    });

    return partsList;
  };

  // Use shared technicians hook
  const { teamMembers: techniciansQueryData, isError: techniciansError } = useTechniciansDirectory();

  // SAFE: Normalize technicians to array first, then ensure displayName/fullName/name are always populated
  const technicians = useMemo(() => {
    const techniciansRaw = normalizeArray<any>(techniciansQueryData);
    return techniciansRaw.map((t) => {
      const displayName = getMemberDisplayName(t) || t.email || "(Unnamed)";
      return {
        ...t,
        displayName,
        fullName: t.fullName ?? displayName,
        name: t.name ?? displayName,
      };
    });
  }, [techniciansQueryData]);

  // Create technician color map for consistent coloring
  const technicianColorMap = useMemo(() => createTechnicianColorMap(technicians), [technicians]);

  // Helper to get technician color for an assignment
  const getTechnicianColor = useCallback(
    (assignment: any) => getTechnicianColorForAssignment(assignment, technicianColorMap),
    [technicianColorMap]
  );

  const { data: companySettings } = useQuery<any>({
    queryKey: ['/api/company-settings'],
  });

  // Business hours for Day View grey-out and auto-scroll
  const { data: businessHoursData } = useQuery<{ hours: Array<{
    dayOfWeek: number;
    isOpen: boolean;
    startMinutes: number | null;
    endMinutes: number | null;
  }> }>({
    queryKey: ['/api/company/business-hours'],
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // ========================================
  // Drag/Drop Mutations Hook (with optimistic UI)
  // ========================================
  const dndMutations = useCalendarDnD(year, month, currentDate, view, refetchCalendar);
  const {
    createAssignment: createAssignmentMutation,
    updateAssignment: updateAssignmentMutation,
    updateDuration,
    deleteAssignment: deleteAssignmentMutation,
    assignTechnicians,
    clearSchedule,
    clearDay,
    toggleComplete,
    isSavingDrag,
    isSavingUnscheduled, // 2026-01-30: Only for schedule/unschedule ops (sidebar loading)
    savingJobIds,
    invalidateCalendarQueries,
    canSchedule,
    showViewOnlyToast,
  } = dndMutations;

  const updateCompanySettings = useMutation({
    mutationFn: async (settings: any) => {
      return apiRequest("/api/company-settings", { method: "POST", body: JSON.stringify(settings) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/company-settings'] });
      toast({
        title: "Settings updated",
        description: "Calendar start time has been updated",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update settings",
        variant: "destructive",
      });
    },
  });

  // Helper for resize handler (uses hook's mutation)
  const handleResize = useCallback((assignmentId: string, newDurationMinutes: number, assignment?: any) => {
    // RBAC: Block resize for view-only users
    if (!canSchedule) {
      showViewOnlyToast();
      return;
    }
    // Pass raw assignment so mutation can compute newEndTime for POST /api/calendar/resize
    updateDuration.mutate({ id: assignmentId, durationMinutes: newDurationMinutes, assignment });
  }, [updateDuration, canSchedule, showViewOnlyToast]);

  // Quick action: unschedule (remove from calendar)
  const handleUnschedule = useCallback((assignmentId: string, version: number) => {
    if (!canSchedule) {
      showViewOnlyToast();
      return;
    }
    deleteAssignmentMutation.mutate({ id: assignmentId, version });
  }, [deleteAssignmentMutation, canSchedule, showViewOnlyToast]);

  const daysInMonth = new Date(year, month, 0).getDate();
  // Adjust first day offset so the month grid aligns with the chosen week start
  const rawFirstDay = new Date(year, month - 1, 1).getDay(); // 0=Sun
  const firstDayOfMonth = regional.weekStartsOn === "monday"
    ? (rawFirstDay === 0 ? 6 : rawFirstDay - 1) // shift so Mon=0
    : rawFirstDay;

  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  const previousMonth = () => {
    if (view === "daily") {
      // Navigate to previous day
      const newDate = new Date(currentDate);
      newDate.setDate(newDate.getDate() - 1);
      setCurrentDate(newDate);
      scrollDoneRef.current = false;
    } else if (view === "weekly") {
      // Navigate to previous week
      const newDate = new Date(currentDate);
      newDate.setDate(newDate.getDate() - 7);
      setCurrentDate(newDate);
      scrollDoneRef.current = false; // Reset scroll to trigger re-scroll to start hour
    } else {
      // Navigate to previous month
      setCurrentDate(new Date(year, month - 2, 1));
    }
  };

  const nextMonth = () => {
    if (view === "daily") {
      // Navigate to next day
      const newDate = new Date(currentDate);
      newDate.setDate(newDate.getDate() + 1);
      setCurrentDate(newDate);
      scrollDoneRef.current = false;
    } else if (view === "weekly") {
      // Navigate to next week
      const newDate = new Date(currentDate);
      newDate.setDate(newDate.getDate() + 7);
      setCurrentDate(newDate);
      scrollDoneRef.current = false; // Reset scroll to trigger re-scroll to start hour
    } else {
      // Navigate to next month
      setCurrentDate(new Date(year, month, 1));
    }
  };

  const goToToday = () => {
    setCurrentDate(new Date());
    scrollDoneRef.current = false; // Reset scroll to trigger re-scroll to start hour
  };

  // DEV diagnostic: detect missed drag starts (pointerdown without drag-start within 250ms)
  const missedDragTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    const handler = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Check if pointer landed inside a draggable card / chip
      const draggable = target.closest(
        '[data-testid^="assigned-client-"], [data-testid^="unscheduled-client-"], [data-testid^="event-chip-"]'
      );
      if (!draggable) return;
      // Start a 250ms timer; if handleDragStart doesn't clear it, warn (dev only)
      if (IS_DEV) {
        if (missedDragTimerRef.current) clearTimeout(missedDragTimerRef.current);
        missedDragTimerRef.current = setTimeout(() => {
          console.warn('[DRAG-WARN] pointerdown without drag-start within 250ms', {
            targetTag: target.tagName,
            targetTestId: target.getAttribute('data-testid'),
            draggableTestId: (draggable as HTMLElement).getAttribute('data-testid'),
            clientX: e.clientX,
            clientY: e.clientY,
          });
          missedDragTimerRef.current = null;
        }, 250);
      }
    };
    document.addEventListener('pointerdown', handler, { capture: true });
    return () => document.removeEventListener('pointerdown', handler, { capture: true });
  }, []);

  const handleDragStart = (event: DragStartEvent) => {
    if (!DRAG_ENABLED) return;
    const activeIdValue = event.active.id as string;
    setActiveId(activeIdValue);

    // Clear missed-drag timer — drag started successfully
    if (missedDragTimerRef.current) {
      clearTimeout(missedDragTimerRef.current);
      missedDragTimerRef.current = null;
    }

    // DEV-only: comprehensive drag start logging (2026-01-29)
    if (IS_DEV) {
      console.log('[DnD] onDragStart:', {
        activeId: activeIdValue,
        activeData: event.active.data?.current,
        activeRect: event.active.rect?.current,
      });
    }

    // Diagnostics: log drag start
    if (isDiagnosticsEnabled()) {
      const isExistingCalendarAssignment = events.some((a: any) => a.id === activeIdValue);
      logDrag({
        phase: 'start',
        sourceId: activeIdValue,
        sourceType: isExistingCalendarAssignment ? 'calendar-assignment' : 'unscheduled-job',
      });
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    // DEV-only: comprehensive drag end logging (2026-01-29)
    if (IS_DEV) {
      console.log('[DnD] onDragEnd:', {
        activeId: active.id,
        activeData: active.data?.current,
        overId: over?.id ?? 'NULL',
        overData: over?.data?.current ?? 'N/A',
        overRect: over?.rect ?? 'N/A',
        collision: event.collisions?.map(c => ({ id: c.id, data: c.data })) ?? [],
      });
    }

    if (!DRAG_ENABLED) return;

    const activeIdValue = active.id as string;
    const isExistingCalendarAssignment = events.some((a: any) => a.id === activeIdValue);

    if (!over) {
      // Diagnostics: log cancelled drag
      if (isDiagnosticsEnabled()) {
        logDrag({
          phase: 'end',
          sourceId: activeIdValue,
          sourceType: isExistingCalendarAssignment ? 'calendar-assignment' : 'unscheduled-job',
          result: 'cancelled',
        });
      }
      return;
    }

    // RBAC: Block drag/drop for view-only users
    if (!canSchedule) {
      showViewOnlyToast();
      if (isDiagnosticsEnabled()) {
        logDrag({
          phase: 'end',
          sourceId: activeIdValue,
          sourceType: isExistingCalendarAssignment ? 'calendar-assignment' : 'unscheduled-job',
          targetId: over.id as string,
          result: 'cancelled',
        });
      }
      return;
    }

    const overId = over.id as string;

    // If dropping on the same container it started in (or no drop zone specified), it's just a click
    // Note: Uses | delimiter for calendar drop zones to avoid splitting UUIDs
    // 2026-01-29: Added techweek| to fix tech week view drops being incorrectly filtered
    if (active.data?.current?.sortable?.index === over?.data?.current?.sortable?.index && !overId.startsWith('day-') && !overId.startsWith('allday|') && !overId.startsWith('weekly|') && !overId.startsWith('daily|') && !overId.startsWith('techweek|') && overId !== 'unscheduled-panel') {
      return;
    }

    // Helper to determine target type from overId
    // Note: Uses | delimiter for calendar drop zones to avoid splitting UUIDs
    // 2026-01-28: Added 'day-allday' for Jobber-style day view all-day lane
    // 2026-01-29: Added 'techweek' for weekly technician view
    const getTargetType = (id: string): 'month-day' | 'week-allday' | 'day-allday' | 'week-timed' | 'day-timed' | 'techweek' | 'unscheduled-panel' | undefined => {
      if (id.startsWith('day-')) return 'month-day';
      // Distinguish between weekly all-day (allday|{dayName}|{dayNumber}) and
      // daily all-day (allday|{techId}|{YYYY-MM-DD}) by checking if third segment contains '-'
      if (id.startsWith('allday|')) {
        const parts = id.split('|');
        if (parts.length === 3 && parts[2].includes('-')) {
          return 'day-allday'; // Daily view: YYYY-MM-DD format
        }
        return 'week-allday'; // Weekly view: numeric dayNumber
      }
      if (id.startsWith('weekly|')) return 'week-timed';
      if (id.startsWith('daily|')) return 'day-timed';
      // Weekly technician view: techweek|{techId}|{YYYY-MM-DD} or techweek|unassigned|{YYYY-MM-DD}
      if (id.startsWith('techweek|')) return 'techweek';
      if (id === 'unscheduled-panel') return 'unscheduled-panel';
      return undefined;
    };

    // Check if this is an unscheduled item from the backlog
    const unscheduledItem = unscheduledClients.find((item: any) => item.id === activeIdValue);
    const hasExistingAssignment = unscheduledItem?.status === 'existing';

    // =========================================================================
    // TASK DRAG HANDLING — reschedule tasks via PATCH /api/tasks/:id
    // =========================================================================
    // Tasks use assignmentId format "task-{uuid}". When dragged to a new slot,
    // we compute the new scheduledStartAt and optionally assignedToUserId, then
    // PATCH the task directly (no job assignment versioning needed).
    // =========================================================================
    if (typeof activeIdValue === "string" && activeIdValue.startsWith("task-")) {
      const taskId = activeIdValue.replace("task-", "");
      const targetType = getTargetType(overId);
      if (!targetType || targetType === "unscheduled-panel") return;

      let scheduledStartAt: string | undefined;
      let assignedToUserId: string | null | undefined;
      let allDay: boolean | undefined;

      const parts = overId.split("|");

      if (targetType === "month-day") {
        // day-{dayNumber} → all-day on that day of the current month
        const dayNum = parseInt(overId.replace("day-", ""));
        scheduledStartAt = new Date(year, month - 1, dayNum).toISOString();
        allDay = true;
      } else if (targetType === "week-allday") {
        // allday|week|YYYY-MM-DD
        const dateStr = parts[2];
        scheduledStartAt = new Date(dateStr + "T00:00:00").toISOString();
        allDay = true;
      } else if (targetType === "day-allday") {
        // allday|{techId}|YYYY-MM-DD
        const techId = parts[1];
        const dateStr = parts[2];
        scheduledStartAt = new Date(dateStr + "T00:00:00").toISOString();
        allDay = true;
        if (techId && techId !== "unassigned") assignedToUserId = techId;
      } else if (targetType === "week-timed") {
        // weekly|YYYY-MM-DD|{hour}|{minute}
        const dateStr = parts[1];
        const h = parseInt(parts[2]);
        const m = parseInt(parts[3]);
        scheduledStartAt = new Date(dateStr + `T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`).toISOString();
        allDay = false;
      } else if (targetType === "day-timed") {
        // daily|{techId}|{hour}|{minute}|{day}|{month0}|{year}
        const techId = parts[1];
        const h = parseInt(parts[2]);
        const m = parseInt(parts[3]);
        const d = parseInt(parts[4]);
        const mo = parseInt(parts[5]); // 0-based
        const yr = parseInt(parts[6]);
        scheduledStartAt = new Date(yr, mo, d, h, m).toISOString();
        allDay = false;
        if (techId && techId !== "unassigned") assignedToUserId = techId;
      } else if (targetType === "techweek") {
        // techweek|{techId}|{YYYY-MM-DD}
        const techId = parts[1];
        const dateStr = parts[2];
        scheduledStartAt = new Date(dateStr + "T00:00:00").toISOString();
        allDay = true;
        if (techId && techId !== "unassigned") assignedToUserId = techId;
      }

      if (!scheduledStartAt) return;

      // Build PATCH payload
      const payload: any = { scheduledStartAt, allDay };
      if (assignedToUserId !== undefined) payload.assignedToUserId = assignedToUserId;

      apiRequest(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then(() => {
        queryClient.invalidateQueries({ predicate: (q) =>
          typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/tasks")
        });
        invalidateCalendarQueries();
      }).catch((err: any) => {
        toast({ title: "Failed to reschedule task", description: err?.message, variant: "destructive" });
      });
      return;
    }

    // =========================================================================
    // VERSION GUARDS - Eliminate unsafe ?? 0 fallbacks
    // =========================================================================
    // Using version 0 as a fallback is UNSAFE for optimistic locking. The server
    // will reject with 409 if actual version differs. These guards validate
    // version is present and refetch if missing.
    //
    // IMPORTANT: Use jobVersion for creating assignments (POST)
    //            Use version for updating existing assignments (PATCH)
    // =========================================================================

    /**
     * Require jobVersion for scheduling an unscheduled job (POST /api/calendar/schedule).
     * Model A: version is required for optimistic locking on job schedule operations.
     * Returns the version number if valid, or null if invalid (triggers refetch).
     */
    const requireJobVersion = (item: any): number | null => {
      // Prefer explicit jobVersion field, fall back to version for compatibility
      const v = item?.jobVersion ?? item?.version;
      if (typeof v === 'number' && Number.isFinite(v)) {
        return v;
      }
      // Version missing or invalid - refetch and abort this mutation
      if (IS_DEV) {
        console.warn('[Calendar] requireJobVersion: Missing or invalid jobVersion', {
          id: item?.id,
          jobId: item?.jobId,
          jobVersion: item?.jobVersion,
          version: item?.version,
        });
      }
      toast({
        title: "Refreshing data...",
        description: "Job data was stale. Please try again.",
        duration: 3000,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      invalidateCalendarQueries();
      return null;
    };

    /**
     * Require version for updating an existing calendar assignment (PATCH).
     * Returns the version number if valid, or null if invalid (triggers refetch).
     */
    const requireAssignmentVersion = (item: any): number | null => {
      const v = item?.version;
      if (typeof v === 'number' && Number.isFinite(v)) {
        return v;
      }
      // Version missing or invalid - refetch and abort this mutation
      if (IS_DEV) {
        console.warn('[Calendar] requireAssignmentVersion: Missing or invalid version', {
          id: item?.id,
          assignmentId: item?.assignmentId,
          version: item?.version,
        });
      }
      toast({
        title: "Refreshing data...",
        description: "Calendar data was stale. Please try again.",
        duration: 3000,
      });
      invalidateCalendarQueries();
      return null;
    };

    // =========================================================================
    // WEEKLY VIEW DATE HELPER - Compute target date from dayName
    // =========================================================================
    // Weekly view droppable IDs encode dayName (Mon/Tue/...) but NOT month/year.
    // When a week spans two months (e.g., Jan 27 - Feb 2), we must compute the
    // correct target date from the weekStart + day index, not use the view's month.
    // =========================================================================
    /**
     * Compute the target date for a weekly view drop.
     * @param dayName - Day abbreviation from droppable ID (e.g., "Sun", "Mon")
     * @returns { targetDay, targetMonth, targetYear } for the correct date
     */
    const getWeeklyTargetDate = (dayName: string): { targetDay: number; targetMonth: number; targetYear: number } | null => {
      // Map dayName to week index based on weekStartsOn setting
      const dayNames = regional.weekStartsOn === "sunday"
        ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
        : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

      const dayIndex = dayNames.indexOf(dayName);
      if (dayIndex === -1) {
        console.error('[Calendar] Invalid dayName in weekly droppable ID:', dayName);
        return null;
      }

      // Compute target date from weekStart + day index
      const weekStartDate = getWeekStart(currentDate, regional.weekStartsOn);
      const targetDate = new Date(weekStartDate);
      targetDate.setDate(weekStartDate.getDate() + dayIndex);

      return {
        targetDay: targetDate.getDate(),
        targetMonth: targetDate.getMonth() + 1, // 1-based for API
        targetYear: targetDate.getFullYear(),
      };
    };

    // Check if dropping on a monthly view day
    if (overId.startsWith('day-')) {
      const day = parseInt(overId.replace('day-', ''));

      if (isExistingCalendarAssignment) {
        // Only move if the assignment exists and day changed
        const currentAssignment = events.find((a: any) => a.id === activeIdValue);
        if (currentAssignment && currentAssignment.day !== day) {
          const version = requireAssignmentVersion(currentAssignment);
          if (version === null) return; // Refetch triggered, abort mutation
          updateAssignmentMutation.mutate({
            id: activeIdValue,
            day,
            version,
            durationMinutes: currentAssignment.durationMinutes ?? 60,
          });
        }
      } else if (unscheduledItem && hasExistingAssignment) {
        // Update existing unscheduled assignment to current view's month/day
        const version = requireAssignmentVersion(unscheduledItem);
        if (version === null) return; // Refetch triggered, abort mutation
        updateAssignmentMutation.mutate({
          id: unscheduledItem.assignmentId,
          day,
          targetMonth: month,
          targetYear: year,
          version,
          durationMinutes: unscheduledItem.durationMinutes ?? 60,
        });
      } else if (unscheduledItem) {
        // Create new assignment from unscheduled job (no existing schedule)
        const jobVersion = requireJobVersion(unscheduledItem);
        if (jobVersion === null) return; // Refetch triggered, abort mutation
        createAssignmentMutation.mutate({
          jobId: unscheduledItem.id || unscheduledItem.jobId,
          day,
          targetMonth: unscheduledItem.month ?? month,
          targetYear: unscheduledItem.year ?? year,
          version: jobVersion,
          allDay: true, // Month view drops are all-day events
        });
      }
    } else if (overId.startsWith('allday|')) {
      // All-day drop zone - weekly or daily view
      // 2026-01-30: Updated formats for unambiguous date handling:
      // - Weekly format: allday|week|YYYY-MM-DD (new) or allday|{dayName}|{dayNumber} (legacy)
      // - Daily format: allday|{techId}|YYYY-MM-DD (techId is UUID or "unassigned")
      const parts = overId.split('|');

      // Detect format: "week" = new weekly, UUID/unassigned = daily, dayName = legacy weekly
      const isNewWeeklyAllDay = parts.length === 3 && parts[1] === 'week' && parts[2].includes('-');
      const isDailyAllDay = parts.length === 3 && parts[1] !== 'week' && parts[2].includes('-');

      if (isNewWeeklyAllDay) {
        // NEW weekly view all-day: allday|week|YYYY-MM-DD
        const dateStr = parts[2]; // YYYY-MM-DD
        const [targetYr, targetMo, targetDay] = dateStr.split('-').map(Number);

        // Validate parsed date
        if (isNaN(targetYr) || isNaN(targetMo) || isNaN(targetDay)) {
          console.error('[Calendar] Invalid weekly all-day target id (bad date):', overId, { parts });
          toast({ title: "Invalid drop target. Please refresh.", variant: "destructive" });
          return;
        }

        // DEV diagnostic
        if (IS_DEV) {
          console.log('[DROP] weekly all-day target (new format):', {
            overId,
            targetDate: dateStr,
            sourceId: activeIdValue,
            isExisting: isExistingCalendarAssignment,
          });
        }

        if (isExistingCalendarAssignment) {
          const currentAssignment = events.find((a: any) => a.id === activeIdValue);
          if (currentAssignment && (currentAssignment.day !== targetDay || currentAssignment.scheduledHour !== null)) {
            const version = requireAssignmentVersion(currentAssignment);
            if (version === null) return;
            updateAssignmentMutation.mutate({
              id: activeIdValue,
              day: targetDay,
              targetMonth: targetMo,
              targetYear: targetYr,
              scheduledHour: null,
              allDay: true,
              version,
            });
          }
        } else if (unscheduledItem && hasExistingAssignment) {
          const version = requireAssignmentVersion(unscheduledItem);
          if (version === null) return;
          updateAssignmentMutation.mutate({
            id: unscheduledItem.assignmentId,
            day: targetDay,
            targetMonth: targetMo,
            targetYear: targetYr,
            scheduledHour: null,
            allDay: true,
            version,
          });
        } else if (unscheduledItem) {
          const jobVersion = requireJobVersion(unscheduledItem);
          if (jobVersion === null) return;
          createAssignmentMutation.mutate({
            jobId: unscheduledItem.id || unscheduledItem.jobId,
            day: targetDay,
            targetMonth: targetMo,
            targetYear: targetYr,
            version: jobVersion,
            allDay: true,
          });
        }
      } else if (isDailyAllDay) {
        // Daily view all-day lane: allday|{techIdOrUnassigned}|{YYYY-MM-DD}
        const technicianId = parts[1]; // UUID or "unassigned"
        const dateStr = parts[2]; // YYYY-MM-DD
        const [targetYr, targetMo, targetDay] = dateStr.split('-').map(Number);

        // Validate parsed date
        if (isNaN(targetYr) || isNaN(targetMo) || isNaN(targetDay)) {
          console.error('[Calendar] Invalid daily all-day target id (bad date):', overId, { parts });
          toast({ title: "Invalid drop target. Please refresh.", variant: "destructive" });
          return;
        }

        // DEV diagnostic
        if (IS_DEV) {
          console.log('[DROP] daily all-day target:', {
            overId,
            technicianId,
            targetDate: dateStr,
            sourceId: activeIdValue,
            isExisting: isExistingCalendarAssignment,
          });
        }

        if (isExistingCalendarAssignment) {
          const currentAssignment = events.find((a: any) => a.id === activeIdValue);
          if (currentAssignment) {
            const version = requireAssignmentVersion(currentAssignment);
            if (version === null) return;
            updateAssignmentMutation.mutate({
              id: activeIdValue,
              day: targetDay,
              targetMonth: targetMo,
              targetYear: targetYr,
              scheduledHour: null,
              allDay: true,
              version,
              technicianUserId: technicianId !== 'unassigned' ? technicianId : null,
            });
          }
        } else if (unscheduledItem && hasExistingAssignment) {
          const version = requireAssignmentVersion(unscheduledItem);
          if (version === null) return;
          updateAssignmentMutation.mutate({
            id: unscheduledItem.assignmentId,
            day: targetDay,
            targetMonth: targetMo,
            targetYear: targetYr,
            scheduledHour: null,
            allDay: true,
            version,
            technicianUserId: technicianId !== 'unassigned' ? technicianId : null,
          });
        } else if (unscheduledItem) {
          const jobVersion = requireJobVersion(unscheduledItem);
          if (jobVersion === null) return;
          createAssignmentMutation.mutate({
            jobId: unscheduledItem.id || unscheduledItem.jobId,
            day: targetDay,
            targetMonth: targetMo,
            targetYear: targetYr,
            version: jobVersion,
            allDay: true,
            technicianUserId: technicianId !== 'unassigned' ? technicianId : null,
          });
        }
      } else {
        // LEGACY weekly view all-day lane: allday|{dayName}|{dayNumber}
        // Backward compatibility - use getWeeklyTargetDate to compute correct date
        const dayName = parts[1]; // e.g., "Sun", "Mon"
        const weeklyTarget = getWeeklyTargetDate(dayName);
        if (!weeklyTarget) {
          toast({ title: "Invalid drop target. Please refresh.", variant: "destructive" });
          return;
        }
        const { targetDay, targetMonth: correctMonth, targetYear: correctYear } = weeklyTarget;

        if (isExistingCalendarAssignment) {
          const currentAssignment = events.find((a: any) => a.id === activeIdValue);
          if (currentAssignment && (currentAssignment.day !== targetDay || currentAssignment.scheduledHour !== null)) {
            const version = requireAssignmentVersion(currentAssignment);
            if (version === null) return;
            updateAssignmentMutation.mutate({
              id: activeIdValue,
              day: targetDay,
              targetMonth: correctMonth,
              targetYear: correctYear,
              scheduledHour: null,
              allDay: true,
              version,
            });
          }
        } else if (unscheduledItem && hasExistingAssignment) {
          const version = requireAssignmentVersion(unscheduledItem);
          if (version === null) return;
          updateAssignmentMutation.mutate({
            id: unscheduledItem.assignmentId,
            day: targetDay,
            scheduledHour: null,
            allDay: true,
            targetMonth: correctMonth,
            targetYear: correctYear,
            version,
          });
        } else if (unscheduledItem) {
          const jobVersion = requireJobVersion(unscheduledItem);
          if (jobVersion === null) return;
          createAssignmentMutation.mutate({
            jobId: unscheduledItem.id || unscheduledItem.jobId,
            day: targetDay,
            targetMonth: correctMonth,
            targetYear: correctYear,
            version: jobVersion,
            allDay: true,
          });
        }
      }
    } else if (overId.startsWith('weekly|')) {
      // Dropped on timed slot in weekly view
      // 2026-01-30: New format: weekly|YYYY-MM-DD|{hour}|{minute} (4 segments)
      // Legacy format: weekly|{dayName}|{hour}|{minute}|{dayNumber} (5 segments)
      const parts = overId.split('|');

      let targetDay: number;
      let correctMonth: number;
      let correctYear: number;
      let hour: number;
      let scheduledStartMinutes: number;

      // Detect new format (4 segments with YYYY-MM-DD) vs legacy (5 segments with dayName)
      const isNewFormat = parts.length === 4 && parts[1].includes('-');

      if (isNewFormat) {
        // New format: weekly|YYYY-MM-DD|{hour}|{minute}
        const dateStr = parts[1]; // YYYY-MM-DD
        hour = parseInt(parts[2]);
        scheduledStartMinutes = parseInt(parts[3]); // 0/15/30/45

        const [yr, mo, day] = dateStr.split('-').map(Number);
        if (isNaN(yr) || isNaN(mo) || isNaN(day) || isNaN(hour) || isNaN(scheduledStartMinutes)) {
          console.error('[Calendar] Invalid weekly timed target id (bad date):', overId, { parts });
          toast({ title: "Invalid drop target time. Please refresh.", variant: "destructive" });
          return;
        }
        targetDay = day;
        correctMonth = mo;
        correctYear = yr;
      } else {
        // Legacy format: weekly|{dayName}|{hour}|{minute}|{dayNumber}
        if (parts.length !== 5) {
          console.error('[Calendar] Invalid weekly timed target id (wrong segment count):', overId, { parts });
          toast({ title: "Invalid drop target time. Please refresh.", variant: "destructive" });
          return;
        }

        const dayName = parts[1]; // e.g., "Sun", "Mon"
        hour = parseInt(parts[2]);
        scheduledStartMinutes = parseInt(parts[3]); // 0/15/30/45

        if (isNaN(hour) || isNaN(scheduledStartMinutes)) {
          console.error('[Calendar] Invalid weekly timed target id (missing segment):', overId, { parts });
          toast({ title: "Invalid drop target time. Please refresh.", variant: "destructive" });
          return;
        }

        // Use legacy helper to compute correct date from dayName
        const weeklyTarget = getWeeklyTargetDate(dayName);
        if (!weeklyTarget) {
          toast({ title: "Invalid drop target. Please refresh.", variant: "destructive" });
          return;
        }
        targetDay = weeklyTarget.targetDay;
        correctMonth = weeklyTarget.targetMonth;
        correctYear = weeklyTarget.targetYear;
      }

      // DEV diagnostic: log intended drop time for minute-precision tracing
      if (IS_DEV) {
        console.log('[DROP] weekly timed target:', {
          overId,
          format: isNewFormat ? 'new' : 'legacy',
          intendedHour: hour,
          intendedMinute: scheduledStartMinutes,
          targetDay,
          correctMonth,
          correctYear,
          sourceId: activeIdValue,
          isExisting: isExistingCalendarAssignment,
        });
      }

      if (isExistingCalendarAssignment) {
        const currentAssignment = events.find((a: any) => a.id === activeIdValue);
        if (currentAssignment) {
          const currentStart = currentAssignment.scheduledStartMinutes ?? (currentAssignment.scheduledHour != null ? currentAssignment.scheduledHour * 60 : null);
          if (
            currentAssignment.day !== targetDay ||
            currentAssignment.scheduledHour !== hour ||
            currentStart !== scheduledStartMinutes
          ) {
            const version = requireAssignmentVersion(currentAssignment);
            if (version === null) return; // Refetch triggered, abort mutation
            // FIX: When transitioning from all-day to timed, use 60min default
            // (not 1440 which would cause cross-day error)
            const wasAllDay = currentAssignment.isAllDay || currentAssignment.allDay;
            const duration = wasAllDay ? 60 : (currentAssignment.durationMinutes ?? 60);
            updateAssignmentMutation.mutate({
              id: activeIdValue,
              day: targetDay,
              targetMonth: correctMonth,
              targetYear: correctYear,
              scheduledHour: hour,
              scheduledStartMinutes,
              version,
              durationMinutes: duration,
              allDay: false, // Explicitly mark as timed event
            });
          }
        }
      } else if (unscheduledItem && hasExistingAssignment) {
        // Update existing unscheduled assignment
        const version = requireAssignmentVersion(unscheduledItem);
        if (version === null) return; // Refetch triggered, abort mutation
        // FIX: Don't use 1440 for timed events
        const wasAllDay = unscheduledItem.isAllDay || unscheduledItem.allDay;
        const duration = wasAllDay ? 60 : (unscheduledItem.durationMinutes ?? 60);
        updateAssignmentMutation.mutate({
          id: unscheduledItem.assignmentId,
          day: targetDay,
          scheduledHour: hour,
          scheduledStartMinutes,
          targetMonth: correctMonth,
          targetYear: correctYear,
          version,
          durationMinutes: duration,
          allDay: false,
        });
      } else if (unscheduledItem) {
        // Create new assignment from unscheduled job
        const jobVersion = requireJobVersion(unscheduledItem);
        if (jobVersion === null) return; // Refetch triggered, abort mutation
        createAssignmentMutation.mutate({
          jobId: unscheduledItem.id || unscheduledItem.jobId,
          day: targetDay,
          scheduledHour: hour,
          scheduledStartMinutes,
          targetMonth: correctMonth,
          targetYear: correctYear,
          version: jobVersion,
        });
      }
    } else if (overId.startsWith('daily|')) {
      // Dropped on timed slot in daily view (daily|{technicianId}|{hour}|{minute}|{day}|{month}|{year})
      // Uses | delimiter to avoid splitting UUIDs which contain dashes
      // Contract: exactly 7 segments after split → [prefix, techId, hour, minute, day, month, year]
      const parts = overId.split('|');
      const technicianId = parts[1];
      const hour = parseInt(parts[2]);
      const scheduledStartMinutes = parseInt(parts[3]); // 0/15/30/45
      const targetDay = parseInt(parts[4]);
      const targetMonthIdx = parseInt(parts[5]); // 0-based month from Date.getMonth()
      const targetYr = parseInt(parts[6]);

      // Strict: reject timed target if minute or any required segment is missing/NaN
      if (parts.length !== 7 || isNaN(hour) || isNaN(scheduledStartMinutes) || isNaN(targetDay) || isNaN(targetMonthIdx) || isNaN(targetYr)) {
        console.error('[Calendar] Invalid daily timed target id (missing segment):', overId, { parts });
        toast({ title: "Invalid drop target time. Please refresh.", variant: "destructive" });
        return;
      }

      // DEV diagnostic: log intended drop time for minute-precision tracing
      if (IS_DEV) {
        console.log('[DROP] daily timed target:', {
          overId,
          intendedHour: hour,
          intendedMinute: scheduledStartMinutes,
          targetDay,
          targetMonth: targetMonthIdx + 1,
          targetYear: targetYr,
          technicianId,
          sourceId: activeIdValue,
          isExisting: isExistingCalendarAssignment,
        });
      }

      // Convert 0-based month to 1-based for API
      const targetMo = targetMonthIdx + 1;

      if (isExistingCalendarAssignment) {
        const currentAssignment = events.find((a: any) => a.id === activeIdValue);
        if (currentAssignment) {
          const version = requireAssignmentVersion(currentAssignment);
          if (version === null) return; // Refetch triggered, abort mutation
          // FIX: When transitioning from all-day to timed, use 60min default
          const wasAllDay = currentAssignment.isAllDay || currentAssignment.allDay;
          const duration = wasAllDay ? 60 : (currentAssignment.durationMinutes ?? 60);
          updateAssignmentMutation.mutate({
            id: activeIdValue,
            day: targetDay,
            scheduledHour: hour,
            scheduledStartMinutes,
            targetMonth: targetMo,
            targetYear: targetYr,
            version,
            durationMinutes: duration,
            allDay: false, // Explicitly mark as timed event
            // Assign or unassign technician based on drop target column
            // null = unassign, UUID = assign to that technician
            technicianUserId: technicianId !== 'unassigned' ? technicianId : null,
          });
        }
      } else if (unscheduledItem && hasExistingAssignment) {
        const version = requireAssignmentVersion(unscheduledItem);
        if (version === null) return; // Refetch triggered, abort mutation
        // FIX: Don't use 1440 for timed events
        const wasAllDay = unscheduledItem.isAllDay || unscheduledItem.allDay;
        const duration = wasAllDay ? 60 : (unscheduledItem.durationMinutes ?? 60);
        updateAssignmentMutation.mutate({
          id: unscheduledItem.assignmentId,
          day: targetDay,
          scheduledHour: hour,
          scheduledStartMinutes,
          targetMonth: targetMo,
          targetYear: targetYr,
          version,
          durationMinutes: duration,
          allDay: false,
          // 2026-01-29: Include technician assignment from drop target
          technicianUserId: technicianId !== 'unassigned' ? technicianId : null,
        });
      } else if (unscheduledItem) {
        // Create new assignment from unscheduled job
        // 2026-01-30: Use target date from drop zone, NOT unscheduled item's original date
        const jobVersion = requireJobVersion(unscheduledItem);
        if (jobVersion === null) return; // Refetch triggered, abort mutation
        createAssignmentMutation.mutate({
          jobId: unscheduledItem.id || unscheduledItem.jobId,
          day: targetDay,
          scheduledHour: hour,
          scheduledStartMinutes,
          targetMonth: targetMo,  // Fixed: use target from drop zone, not item's stored month
          targetYear: targetYr,   // Fixed: use target from drop zone, not item's stored year
          version: jobVersion,
          // 2026-01-29: Include technician assignment from drop target
          technicianUserId: technicianId !== 'unassigned' ? technicianId : null,
        });
      }
    } else if (overId.startsWith('techweek|')) {
      // Dropped on weekly technician view cell (techweek|{techId}|{dateKey})
      // Format: techweek|{technicianId or 'unassigned'}|{YYYY-MM-DD}
      const parts = overId.split('|');
      if (parts.length !== 3) {
        console.error('[Calendar] Invalid techweek target id:', overId, { parts });
        toast({ title: "Invalid drop target. Please refresh.", variant: "destructive" });
        return;
      }

      const techIdOrUnassigned = parts[1];
      const dateKey = parts[2]; // YYYY-MM-DD
      const [yearStr, monthStr, dayStr] = dateKey.split('-');
      const targetYear = parseInt(yearStr);
      const targetMonth = parseInt(monthStr);
      const targetDay = parseInt(dayStr);

      if (isNaN(targetYear) || isNaN(targetMonth) || isNaN(targetDay)) {
        console.error('[Calendar] Invalid techweek date:', dateKey);
        toast({ title: "Invalid drop target date. Please refresh.", variant: "destructive" });
        return;
      }

      const technicianUserId = techIdOrUnassigned === 'unassigned' ? null : techIdOrUnassigned;

      if (IS_DEV) {
        console.log('[DROP] techweek target:', {
          overId,
          technicianUserId,
          targetYear,
          targetMonth,
          targetDay,
          sourceId: activeIdValue,
          isExisting: isExistingCalendarAssignment,
        });
      }

      if (isExistingCalendarAssignment) {
        const currentAssignment = events.find((a: any) => a.id === activeIdValue);
        if (currentAssignment) {
          const version = requireAssignmentVersion(currentAssignment);
          if (version === null) return; // Refetch triggered, abort mutation
          updateAssignmentMutation.mutate({
            id: activeIdValue,
            day: targetDay,
            targetMonth,
            targetYear,
            technicianUserId,
            version,
          });
        }
      } else if (unscheduledItem && hasExistingAssignment) {
        // Update existing unscheduled assignment
        const version = requireAssignmentVersion(unscheduledItem);
        if (version === null) return; // Refetch triggered, abort mutation
        updateAssignmentMutation.mutate({
          id: unscheduledItem.assignmentId,
          day: targetDay,
          targetMonth,
          targetYear,
          technicianUserId,
          version,
        });
      } else if (unscheduledItem) {
        // Create new assignment from unscheduled job
        const jobVersion = requireJobVersion(unscheduledItem);
        if (jobVersion === null) return; // Refetch triggered, abort mutation
        createAssignmentMutation.mutate({
          jobId: unscheduledItem.id || unscheduledItem.jobId,
          day: targetDay,
          targetMonth,
          targetYear,
          technicianUserId,
          version: jobVersion,
        });
      }
    } else if (overId === 'unscheduled-panel') {
      // Dropped on unscheduled panel - remove from calendar
      if (isExistingCalendarAssignment) {
        const currentAssignment = events.find((a: any) => a.id === activeIdValue);
        const version = requireAssignmentVersion(currentAssignment);
        if (version === null) return; // Refetch triggered, abort mutation
        deleteAssignmentMutation.mutate({
          id: activeIdValue,
          version,
        });
      }
    }

    // Diagnostics: log drag end (mutation result will be logged separately)
    if (isDiagnosticsEnabled()) {
      logDrag({
        phase: 'end',
        sourceId: activeIdValue,
        sourceType: isExistingCalendarAssignment ? 'calendar-assignment' : 'unscheduled-job',
        targetId: overId,
        targetType: getTargetType(overId),
        result: 'success', // Mutation initiated - actual result logged via apiRequest
      });
    }
  };

  const { data: clientsQueryData, isLoading: isLoadingClients } = useQuery<any>({
    queryKey: ["/api/clients"],
  });

  // SAFE: Normalize clients to array immediately
  const allClients = useMemo(() => normalizeArray<any>(clientsQueryData), [clientsQueryData]);

  const { data: unscheduledQueryData, isLoading: isLoadingUnscheduled } = useQuery<any>({
    queryKey: ["/api/calendar/unscheduled"],
    queryFn: async () => {
      const res = await fetch(`/api/calendar/unscheduled`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch unscheduled clients");
      const data = await res.json();
      // SAFE: Normalize to array in query function
      const normalized = normalizeArray<any>(data);
      // DEV LOGGING: Log unscheduled jobs received (include version for debugging VERSION_MISMATCH)
      if (IS_DEV) {
        console.log(`[Calendar] Received ${normalized.length} unscheduled jobs from API`);
        if (normalized.length > 0) {
          console.log('[Calendar] First 5 unscheduled jobs:', normalized.slice(0, 5).map((j: any) => ({
            id: j.id,
            jobNumber: j.jobNumber,
            version: j.version,
            primaryTechnicianId: j.primaryTechnicianId,
            assignedTechnicianIds: j.assignedTechnicianIds,
            isAssigned: !!j.primaryTechnicianId || (j.assignedTechnicianIds?.length ?? 0) > 0,
          })));
        }
      }
      return normalized;
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // SAFE: Normalize unscheduled clients to array (double-safe in case query returns unexpected shape)
  // Also deduplicate by jobId/id - prioritize non-optimistic (real) items over optimistic placeholders
  const unscheduledClients = useMemo(() => {
    const raw = normalizeArray<any>(unscheduledQueryData);
    // Deduplicate: when both optimistic and real item exist, keep only the real one
    const seen = new Map<string, any>();
    for (const item of raw) {
      const key = item.jobId || item.id;
      const existing = seen.get(key);
      // If no existing item, or existing is optimistic and current is real, use current
      if (!existing || (existing._optimistic && !item._optimistic)) {
        seen.set(key, item);
      }
    }
    return Array.from(seen.values());
  }, [unscheduledQueryData]);

  // Phase 8: Compute date range for task calendar fetch
  const calendarDateRange = useMemo(() => {
    if (view === "weekly") {
      const weekStart = getWeekStart(currentDate, regional.weekStartsOn);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      return { start: weekStart.toISOString(), end: weekEnd.toISOString() };
    }
    if (view === "daily") {
      const dayStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      return { start: dayStart.toISOString(), end: dayEnd.toISOString() };
    }
    // monthly
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0);
    return { start: monthStart.toISOString(), end: monthEnd.toISOString() };
  }, [view, currentDate, year, month, regional.weekStartsOn]);

  // Tasks always shown on calendar (Polish Pass 2026-03-04)
  const { data: scheduledTasks = [] } = useCalendarTasks(
    calendarDateRange.start,
    calendarDateRange.end,
    true
  );

  // Phase 8: Fetch unscheduled tasks for sidebar Tasks tab
  const { data: unscheduledTasks = [], isLoading: isLoadingUnscheduledTasks } = useUnscheduledTasks(true);

  // Query for old unscheduled items that need user action (older than previous month)
  const { data: oldUnscheduledQueryData } = useQuery<any>({
    queryKey: ["/api/calendar/old-unscheduled"],
    queryFn: async () => {
      const res = await fetch(`/api/calendar/old-unscheduled`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch old unscheduled items");
      return res.json();
    },
  });

  // SAFE: Normalize old unscheduled items to array
  const oldUnscheduledItems = useMemo(() => normalizeArray<any>(oldUnscheduledQueryData), [oldUnscheduledQueryData]);

  const [showOldItemsDialog, setShowOldItemsDialog] = useState(false);

  // Delete old unscheduled job (soft delete)
  const deleteOldAssignment = useMutation({
    mutationFn: async (jobId: string) => {
      // Model A: Delete the job directly
      return apiRequest(`/api/jobs/${jobId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/old-unscheduled"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      // Phase 4 Step C5: canonical family key
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      // Phase 5 Step B3: canonical dashboard family key
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance"] });
      // Prefix-matches ["/api/clients", id, "overview"] so Client Detail page updates
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({
        title: "Job deleted",
        description: "The old job has been removed",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete job",
        variant: "destructive",
      });
    },
  });

  // Mark old job as completed (archive it)
  const archiveOldAssignment = useMutation({
    mutationFn: async (jobId: string) => {
      // Model A: Use job complete endpoint
      return apiRequest(`/api/jobs/${jobId}/complete`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/old-unscheduled"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      // Phase 4 Step C5: canonical family key
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      // Phase 5.2: dashboard counts stale after archiving old job
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast({
        title: "Job archived",
        description: "The old job has been marked as complete",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to archive job",
        variant: "destructive",
      });
    },
  });

  // Listen for sidebar events
  useEffect(() => {
    const handleAddClient = () => setAddClientDialogOpen(true);
    const handleOpenClient = (e: Event) => {
      const customEvent = e as CustomEvent;
      // Navigate to client detail page instead of opening dialog
      setLocation(`/clients/${customEvent.detail.clientId}`);
    };

    window.addEventListener('openAddClientDialog', handleAddClient);
    window.addEventListener('openClientDialog', handleOpenClient);

    return () => {
      window.removeEventListener('openAddClientDialog', handleAddClient);
      window.removeEventListener('openClientDialog', handleOpenClient);
    };
  }, [setLocation]);

  // Reset scroll flag when switching away from weekly view
  useEffect(() => {
    if (view !== "weekly") {
      scrollDoneRef.current = false;
    }
  }, [view]);

  // Scroll to start hour when entering weekly view - wait for ALL data to load
  useEffect(() => {
    if (view === "weekly" &&
        weeklyScrollContainerRef.current &&
        companySettings?.calendarStartHour !== undefined &&
        !scrollDoneRef.current &&
        !isLoadingCalendar &&
        !isLoadingUnscheduled) {

      const startHour = companySettings.calendarStartHour;
      // Hourly slot height matches density setting
      const slotHeight = DENSITY_STYLES[density].rowHeight;
      const scrollPosition = startHour * slotHeight;

      // Use setTimeout to ensure DOM is fully rendered after all data loads
      const timeoutId = setTimeout(() => {
        if (weeklyScrollContainerRef.current) {
          weeklyScrollContainerRef.current.scrollTop = scrollPosition;
          scrollDoneRef.current = true;
        }
      }, 150);

      return () => clearTimeout(timeoutId);
    }
  }, [view, companySettings?.calendarStartHour, isLoadingCalendar, isLoadingUnscheduled, density]);

  // Note: Backend /api/calendar returns { events, outsideVisibleHoursCount } - clients come from /api/clients
  // DEFENSIVE PARSE: Prefer `events` (current contract), fall back to `assignments` (legacy)
  const rawEvents = data?.events ?? data?.assignments;
  const events = Array.isArray(rawEvents) ? rawEvents : [];
  const outsideVisibleHoursCount = typeof data?.outsideVisibleHoursCount === 'number'
    ? data.outsideVisibleHoursCount
    : 0;

  // DEV ASSERTION: events must be an array - catch contract regressions early
  if (IS_DEV && data && !Array.isArray(rawEvents)) {
    console.error(
      '[Calendar] API CONTRACT VIOLATION: /api/calendar response.events is not an array:',
      typeof rawEvents,
      rawEvents
    );
    throw new Error('Calendar API contract violation: events must be an array');
  }
  // Use allClients (from /api/clients) as the client lookup source
  const clients = allClients;

  // ========================================
  // Stabilized event handlers — useCallback prevents grid re-renders on unrelated state changes
  // ========================================

  // Ref for events allows handleRemove to read latest data without re-creating
  const eventsRef = useRef(events);
  eventsRef.current = events;

  // Stabilized — passed to CalendarGridMonth (28-31 DroppableDay cells).
  const handleRemove = useCallback((assignmentId: string, version?: number) => {
    const assignment = eventsRef.current.find((a: any) => a.id === assignmentId);
    const resolvedVersion = version ?? assignment?.version;

    if (typeof resolvedVersion !== 'number' || !Number.isFinite(resolvedVersion)) {
      if (IS_DEV) {
        console.warn('[Calendar] handleRemove: Missing or invalid version', { assignmentId, version, assignment });
      }
      toast({
        title: "Refreshing data...",
        description: "Calendar data was stale. Please try again.",
        duration: 3000,
      });
      invalidateCalendarQueries();
      return;
    }

    deleteAssignmentMutation.mutate({
      id: assignmentId,
      version: resolvedVersion,
    });
  }, [deleteAssignmentMutation, invalidateCalendarQueries, toast]);

  const handleClearDay = useCallback((day: number, dayAssignments: any[]) => {
    clearDay.mutate({ day, dayAssignments });
  }, [clearDay]);

  // Stabilized — passed to every grid component (Month/Week/Day).
  // Deps: clients (stable useMemo), state setters (stable per React).
  const handleClientClick = useCallback((client: any, eventOrAssignment: CalendarEvent | any, focusSchedule: boolean = false) => {
    const rawAssignment = eventOrAssignment.raw ?? eventOrAssignment;
    const assignmentId = rawAssignment.assignmentId ?? rawAssignment.id ?? "";

    // Task 3D: If this is a task (not a job visit), open TaskDialog instead
    if (typeof assignmentId === "string" && assignmentId.startsWith("task-")) {
      const taskId = assignmentId.replace("task-", "");
      setSelectedTaskId(taskId);
      setTaskDialogOpen(true);
      return;
    }

    const enrichedAssignment = {
      ...rawAssignment,
      assignmentId,
      jobId: rawAssignment.jobId ?? rawAssignment.job_id ?? rawAssignment.job?.id ?? rawAssignment.jobIdFromJoin ?? rawAssignment.id,
      locationId: rawAssignment.locationId ?? getLocationId(rawAssignment),
    };

    let selectedClientValue = client;
    if (!client || client.companyName === "Unknown Client" || !client.companyName) {
      const fallbackClient = findClientByLocationId(clients, enrichedAssignment.locationId);
      if (fallbackClient) {
        selectedClientValue = fallbackClient;
      }
    }

    setSelectedClient(selectedClientValue);
    setSelectedAssignment(enrichedAssignment);
    setFocusScheduleSection(focusSchedule);
    setClientDetailOpen(true);
  }, [clients]);

  // DEV LOGGING: Log scheduled jobs received from API
  if (IS_DEV) {
    console.log(`[Calendar] Received ${events.length} scheduled jobs from API`);
    if (events.length > 0) {
      console.log('[Calendar] First 5 scheduled jobs:', events.slice(0, 5).map((a: any) => ({
        id: a.id,
        jobNumber: a.jobNumber,
        scheduledStart: a.scheduledStart,
        year: a.year,
        month: a.month,
        day: a.day,
      })));
    }
  }

  // Normalize events into canonical CalendarEvent shape
  const normalizedEvents = useMemo(
    () => {
      const normalized = normalizeAssignments(events);

      // MODEL A DEV ASSERTION: Calendar must receive events with assignmentId
      // If we see scheduledStart without assignmentId, something is wrong
      if (IS_DEV) {
        for (const evt of normalized) {
          if ('scheduledStart' in evt && !('assignmentId' in evt)) {
            console.error('[Calendar] MODEL A VIOLATION: received job instead of calendar event', evt);
          }
        }
      }

      // DEV LOGGING: Log normalized events
      if (IS_DEV) {
        console.log(`[Calendar] Normalized ${normalized.length} events from ${events.length} API items`);
        if (normalized.length > 0) {
          console.log('[Calendar] First 5 events:', normalized.slice(0, 5).map(e => ({
            assignmentId: e.assignmentId,
            jobNumber: e.jobNumber,
            dateKey: e.dateKey,
            scheduledHour: e.scheduledHour,
            isAllDay: e.isAllDay,
          })));
        }
      }
      return normalized;
    },
    [events]
  );

  // Tasks always merged into calendar events (Polish Pass 2026-03-04)
  const mergedEvents = useMemo(() => {
    if (scheduledTasks.length === 0) return normalizedEvents;
    const taskItems = scheduledTasks
      .map(taskToCalendarItem)
      .filter((item): item is NonNullable<typeof item> => item !== null) as CalendarEvent[];
    return [...normalizedEvents, ...taskItems];
  }, [normalizedEvents, scheduledTasks]);

  // Build memoized indexes for efficient lookup (uses merged events when tasks enabled)
  const eventIndexes = useMemo(
    () => buildEventIndexes(mergedEvents),
    [mergedEvents]
  );

  // Map of events by day number (for monthly view) - uses normalized events
  // Must be called unconditionally (before early returns) to satisfy React hooks rules
  const eventsByDayNumber = useMemo(() => {
    if (view !== "monthly") return {};
    const map: Record<number, CalendarEvent[]> = {};
    for (const event of normalizedEvents) {
      if (event.year === year && event.month === month) {
        if (!map[event.day]) map[event.day] = [];
        map[event.day].push(event);
      }
    }
    return map;
  }, [normalizedEvents, year, month, view]);

  // ========================================
  // State Snapshot Diagnostics (dev or ?diag=1)
  // ========================================
  // Fetch state snapshot once on mount to verify invariant:
  // Jobs = Scheduled + Unscheduled (open_equals_scheduled_plus_backlog)
  useEffect(() => {
    // Only run in dev or when diagnostics enabled
    if (!IS_DEV && !isDiagnosticsEnabled()) {
      return;
    }

    // Fetch state snapshot for invariant verification
    const fetchSnapshot = async () => {
      try {
        const res = await fetch('/api/calendar/state-snapshot', { credentials: 'include' });
        if (!res.ok) {
          console.warn('[Calendar] State snapshot fetch failed:', res.status);
          return;
        }
        const snapshot = await res.json();

        // Log snapshot for verification
        console.log('[Calendar] State Snapshot:', snapshot);

        // Warn if invariant violated
        if (snapshot._invariants && !snapshot._invariants.open_equals_scheduled_plus_backlog) {
          console.error(
            '[Calendar] INVARIANT VIOLATION: open !== scheduled.open + backlog',
            {
              open: snapshot.jobs?.open,
              scheduledOpen: snapshot.scheduled?.open,
              backlog: snapshot.backlog?.total,
            }
          );
        } else {
          console.log(
            '[Calendar] Invariant OK: open (%d) === scheduled.open (%d) + backlog (%d)',
            snapshot.jobs?.open,
            snapshot.scheduled?.open,
            snapshot.backlog?.total
          );
        }
      } catch (err) {
        console.warn('[Calendar] State snapshot fetch error:', err);
      }
    };

    fetchSnapshot();
  }, []); // Only run once on mount

  // Note: Search functionality removed per requirements - display all unscheduled jobs directly

  // Configure sensors for drag-and-drop
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 3, // Low threshold for first-attempt drag reliability
      },
    })
  );

  // Custom collision detection that only checks drop zones (days, all-day, weekly), not individual items
  // Note: Uses | delimiter for calendar drop zones to avoid splitting UUIDs
  const customCollisionDetection: CollisionDetection = useCallback((args) => {
    // Filter to only check day drop zones, all-day slots, weekly slots, and the unscheduled panel
    const dropZoneContainers = args.droppableContainers.filter(
      (container) => {
        const id = container.id as string;
        // 2026-01-29: Added techweek| for weekly technician view drop zones
        return id.startsWith('day-') || id.startsWith('allday|') || id.startsWith('weekly|') || id.startsWith('daily|') || id.startsWith('techweek|') || id === 'unscheduled-panel';
      }
    );

    // DEV-only: Log droppable containers summary during drag (throttled to avoid spam) (2026-01-29)
    if (IS_DEV && activeId) {
      // Count containers by prefix for debug summary
      const counts: Record<string, number> = {};
      dropZoneContainers.forEach((c) => {
        const id = c.id as string;
        const prefix = id.split('|')[0] || id.split('-')[0] || 'other';
        counts[prefix] = (counts[prefix] || 0) + 1;
      });
      // Only log if counts changed (simple dedup)
      const countsKey = JSON.stringify(counts);
      if ((window as any).__lastDroppableCountsKey !== countsKey) {
        (window as any).__lastDroppableCountsKey = countsKey;
        console.log('[DnD] Droppable containers:', counts, 'total:', dropZoneContainers.length);
      }
    }

    // Task F: debug collision detection — gated behind ?debugLayout=1
    const debugDnD = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get("debugLayout") === "1";

    // Prefer pointerWithin for small (15-min) drop zones
    const pointerCollisions = pointerWithin({
      ...args,
      droppableContainers: dropZoneContainers,
    });

    if (pointerCollisions.length > 0) {
      // 2026-03-05: Sticky all-day lane overlap disambiguation removed.
      // All-day strip is now inside column headers (Columns view) or a side cell
      // (Rows view), so allday| and daily| droppables no longer overlap.
      if (debugDnD) {
        const top5 = pointerCollisions.slice(0, 5).map(c => {
          const container = dropZoneContainers.find(dc => dc.id === c.id);
          const rect = container?.rect?.current;
          return { id: c.id, rect: rect ? { top: Math.round(rect.top), bottom: Math.round(rect.bottom), left: Math.round(rect.left), right: Math.round(rect.right) } : null };
        });
        console.log('[debugLayout:DnD] pointerWithin hit:', { activeId: args.active?.id, pointerCoords: args.pointerCoordinates, scrollTop: document.querySelector('.overflow-auto')?.scrollTop, top5 });
      }
      return pointerCollisions;
    }

    // Fallback to rectIntersection for grid layout support
    const rectCollisions = rectIntersection({
      ...args,
      droppableContainers: dropZoneContainers,
    });

    if (rectCollisions.length > 0) {
      if (debugDnD) {
        console.log('[debugLayout:DnD] rectIntersection fallback:', { count: rectCollisions.length, first: rectCollisions[0]?.id });
      }
      return rectCollisions;
    }

    // Final fallback to closestCenter
    const centerCollisions = closestCenter({
      ...args,
      droppableContainers: dropZoneContainers,
    });
    if (debugDnD && centerCollisions.length > 0) {
      const top5 = centerCollisions.slice(0, 5).map(c => {
        const container = dropZoneContainers.find(dc => dc.id === c.id);
        const rect = container?.rect?.current;
        return { id: c.id, rect: rect ? { top: Math.round(rect.top), bottom: Math.round(rect.bottom) } : null };
      });
      console.log('[debugLayout:DnD] closestCenter FALLBACK:', { activeId: args.active?.id, pointerCoords: args.pointerCoordinates, top5 });
    }
    return centerCollisions;
  }, []);

  // OPTIMIZED: 2026-01-30 - Memoized renderItem to prevent sidebar rerenders during drag
  // FIX: Moved before early returns to satisfy React hooks rules (same number of hooks every render)
  const renderUnscheduledItem = useCallback((item: any) => {
    // Parse date from canonical fields (scheduledDate/date/startAt)
    const dateStr = item.scheduledDate || item.date || (item.startAt ? item.startAt.split('T')[0] : null);
    const itemDate = dateStr ? new Date(dateStr + 'T00:00:00') : null;
    const itemYear = itemDate?.getFullYear() ?? new Date().getFullYear();
    const itemMonth = itemDate ? itemDate.getMonth() + 1 : new Date().getMonth() + 1;
    const monthLabel = `${MONTH_ABBREV[itemMonth - 1]} '${String(itemYear).slice(-2)}`;

    const now = new Date();
    const todayYear = now.getFullYear();
    const todayMonth = now.getMonth() + 1;
    const isPastMonth =
      itemYear < todayYear || (itemYear === todayYear && itemMonth < todayMonth);

    // Use helper functions for resilient display
    const companyName = getUnscheduledCompanyName(item);
    const locationLabel = getUnscheduledLocationLabel(item);

    // Build client object for click handler and preview
    const clientData = { companyName, location: locationLabel, id: getLocationId(item) };

    return (
      <JobCard
        key={item.id}
        id={item.id}
        client={clientData}
        assignment={item}
        inCalendar={false}
        onClick={() => handleClientClick(clientData, item, true)}
        isSaving={item._optimistic}
        technicians={technicians}
        timeFormat={regional?.timeFormat || "12h"}
        summary={item.summary}
        monthLabel={monthLabel}
        isOffMonth={true}
        isPastMonth={isPastMonth}
        rawItem={item}
      />
    );
  }, [handleClientClick, technicians, regional?.timeFormat]);

  // Show error state if any critical query fails
  if (calendarError || techniciansError) {
    return (
      <div className="h-screen bg-background flex flex-col">
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center py-8 space-y-4">
            <AlertTriangle className="h-12 w-12 text-destructive mx-auto" />
            <div className="text-destructive font-medium">Failed to load calendar data</div>
            <p className="text-sm text-muted-foreground">
              {calendarError && "Calendar data could not be loaded. "}
              {techniciansError && "Technician list could not be loaded. "}
              Please refresh the page or try again later.
            </p>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Refresh Page
            </Button>
          </div>
        </main>
      </div>
    );
  }

  if (isLoadingCalendar || isLoadingClients || isLoadingUnscheduled) {
    return (
      <div className="h-screen bg-background flex flex-col">
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center py-8">Loading calendar...</div>
        </main>
      </div>
    );
  }

  // Get active dragging item
  const activeClient = activeId ?
    (unscheduledClients.find((c: any) => c.id === activeId) ||
     events.find((a: any) => a.id === activeId)) : null;

  // Handler for parts button click
  const handlePartsClick = () => {
    if (isLoadingParts) {
      toast({
        title: "Loading parts data",
        description: "Please wait while parts are being loaded",
      });
      return;
    }
    // Calculate parts for entire visible week with dates
    const weekStart = getWeekStart(currentDate, regional.weekStartsOn);
    const dayNames = regional.weekStartsOn === "sunday"
      ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
      : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const weekDays: Array<{ dayName: string; dateLabel: string; date: Date }> = [];

    for (let i = 0; i < 7; i++) {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + i);
      weekDays.push({
        dayName: dayNames[i],
        dateLabel: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        date: new Date(date)
      });
    }

    const allWeekEvents = events.filter((a: any) => {
      // Use canonical date field (scheduledDate/date/startAt)
      const dateStr = a.scheduledDate || a.date || (a.startAt ? a.startAt.split('T')[0] : null);
      if (!dateStr) return false;
      for (let i = 0; i < 7; i++) {
        const dayKey = weekDays[i].date.toISOString().split('T')[0];
        if (dateStr === dayKey) {
          return true;
        }
      }
      return false;
    });

    const parts = calculatePartsWithDates(allWeekEvents);
    const weekEnd = weekDays[6].date;
    setPartsDialogTitle(`Parts for ${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`);
    setPartsDialogParts(parts);
    setPartsDialogWeekDays(weekDays);
    setPartsDialogOpen(true);
  };

  // Handler for start hour change
  const handleStartHourChange = (newStartHour: number) => {
    updateCompanySettings.mutate({ calendarStartHour: newStartHour });
    scrollDoneRef.current = false; // Reset scroll flag to trigger re-scroll
  };

  // Handler for opening schedule modal (Slice 3)
  const handleOpenScheduleModal = (date?: Date, technicianId?: string, editAssignment?: any) => {
    setScheduleModalDate(date);
    setScheduleModalTechnicianId(technicianId);
    setScheduleModalEdit(editAssignment);
    setScheduleModalOpen(true);
  };

  // Handler for technician week view job click
  const handleTechWeekJobClick = (event: CalendarEvent, technician: any) => {
    try {
      const rawAssignment = event.raw ?? event;

      // Build enriched assignment with correct IDs
      const enrichedAssignment = {
        ...rawAssignment,
        assignmentId: rawAssignment.assignmentId ?? event.assignmentId ?? rawAssignment.id,
        jobId: rawAssignment.jobId ?? rawAssignment.job_id ?? rawAssignment.job?.id ?? rawAssignment.id,
        locationId: rawAssignment.locationId ?? getLocationId(rawAssignment),
      };

      // SAFE client lookup using shared helper - never blocks primary action
      const clientsArray = toClientsArray(clients);
      let client = resolveClientForCalendarEvent(clientsArray, event);

      // Use fallback if client is falsy or looks like placeholder
      if (!client || client.companyName === "Unknown Client" || !client.companyName) {
        const fallbackClient = findClientByLocationId(clients, enrichedAssignment.locationId);
        if (fallbackClient) {
          client = fallbackClient;
        }
      }

      // PRIMARY ACTION: Always open the job dialog with assignment data
      setSelectedClient(client);
      setSelectedAssignment(enrichedAssignment);
      setClientDetailOpen(true);
    } catch (err) {
      console.error("handleTechWeekJobClick failed", err);
      // Fallback: still try to open dialog with assignment
      const rawAssignment = event.raw ?? event;
      setSelectedAssignment({
        ...rawAssignment,
        assignmentId: rawAssignment.assignmentId ?? rawAssignment.id,
        jobId: rawAssignment.jobId ?? rawAssignment.id,
      });
      setClientDetailOpen(true);
    }
  };

  // Handler for technician week view slot click
  const handleTechWeekSlotClick = (date: Date, technician: any) => {
    // RBAC: Block scheduling for view-only users
    if (!canSchedule) {
      showViewOnlyToast();
      return;
    }
    handleOpenScheduleModal(date, technician?.id);
  };

  // Handler for "Schedule New" button
  const handleScheduleNew = (date: Date, technicianId?: string) => {
    // RBAC: Block scheduling for view-only users
    if (!canSchedule) {
      showViewOnlyToast();
      return;
    }
    handleOpenScheduleModal(date, technicianId);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={customCollisionDetection}
      onDragStart={handleDragStart}
      onDragOver={(event) => {
        // DEV-only: log drag over events to track what targets are being detected (2026-01-29)
        if (IS_DEV) {
          const overId = event.over?.id ?? 'NULL';
          // Only log when over something (avoid console spam)
          if (event.over) {
            console.log('[DnD] onDragOver:', { overId, overData: event.over.data?.current });
          }
        }
      }}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        // 2026-01-29: Ensure activeId is always reset on drag cancel (e.g., Escape key)
        setActiveId(null);
        if (IS_DEV) {
          console.log('[DnD] onDragCancel - activeId reset');
        }
      }}
      autoScroll={false}
    >
      <div className="h-screen bg-background flex flex-col">
        {/* Alert banner for old unscheduled items */}
        {oldUnscheduledItems.length > 0 && (
          <div className="bg-amber-100 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800 px-4 py-2 flex items-center justify-center gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <span className="text-sm text-amber-800 dark:text-amber-200">
              {oldUnscheduledItems.length} old unscheduled job{oldUnscheduledItems.length !== 1 ? 's' : ''} need{oldUnscheduledItems.length === 1 ? 's' : ''} attention
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs bg-white dark:bg-amber-900/50 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 hover:bg-amber-50 dark:hover:bg-amber-900/70"
              onClick={() => setShowOldItemsDialog(true)}
              data-testid="button-view-old-items"
            >
              Review
            </Button>
            <button
              className="ml-2 text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200"
              onClick={() => setShowOldItemsDialog(true)}
              data-testid="button-dismiss-old-items-banner"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Info banner for jobs scheduled outside visible hours */}
        {outsideVisibleHoursCount > 0 && (
          <div className="bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800 px-4 py-1.5 flex items-center justify-center gap-2">
            <Clock className="h-3.5 w-3.5 text-blue-500 dark:text-blue-400" />
            <span className="text-xs text-blue-700 dark:text-blue-300">
              {outsideVisibleHoursCount} job{outsideVisibleHoursCount !== 1 ? 's' : ''} scheduled outside visible hours
            </span>
          </div>
        )}

        {/* Dialog for managing old unscheduled items */}
        <Dialog open={showOldItemsDialog} onOpenChange={setShowOldItemsDialog}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Old Unscheduled Jobs
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground mb-4">
              These jobs are from months older than last month and need your attention. You can either archive them (mark as complete) or delete them.
            </p>
            <div className="overflow-y-auto flex-1 space-y-2">
              {oldUnscheduledItems.map((item: any) => (
                <div key={item.assignment.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <div className="font-medium">{item.client?.companyName || 'Unknown Client'}</div>
                    <div className="text-sm text-muted-foreground">
                      {item.client?.location && <span>{item.client.location} • </span>}
                      {(() => {
                        // Parse date from canonical fields (scheduledDate/date/startAt)
                        const dateStr = item.assignment.scheduledDate || item.assignment.date ||
                          (item.assignment.startAt ? item.assignment.startAt.split('T')[0] : null);
                        if (dateStr) {
                          const d = new Date(dateStr + 'T00:00:00');
                          return `${MONTH_ABBREV[d.getMonth()]} '${String(d.getFullYear()).slice(-2)}`;
                        }
                        return '';
                      })()}
                      {item.assignment.jobNumber && <span> • Job #{item.assignment.jobNumber}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => archiveOldAssignment.mutate(item.assignment.id)}
                      disabled={archiveOldAssignment.isPending || deleteOldAssignment.isPending}
                      data-testid={`button-archive-${item.assignment.id}`}
                    >
                      <Archive className="h-4 w-4 mr-1" />
                      Archive
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => deleteOldAssignment.mutate(item.assignment.id)}
                      disabled={archiveOldAssignment.isPending || deleteOldAssignment.isPending}
                      data-testid={`button-delete-${item.assignment.id}`}
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
              {oldUnscheduledItems.length === 0 && (
                <div className="text-center text-muted-foreground py-8">
                  All old items have been handled
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        <main className={`flex flex-col flex-1 min-h-0 w-full py-2 transition-all ${isUnscheduledMinimized ? 'pr-16' : ''}`}>
          <CalendarHeader
            view={view}
            onViewChange={setView}
            currentDate={currentDate}
            month={month}
            year={year}
            monthNames={monthNames}
            onPreviousMonth={previousMonth}
            onNextMonth={nextMonth}
            onGoToToday={goToToday}
            technicians={technicians}
            hiddenTechnicianIds={hiddenTechnicianIds}
            onToggleTechnicianVisibility={toggleTechnicianVisibility}
            onPartsClick={handlePartsClick}
            calendarStartHour={companySettings?.calendarStartHour || 8}
            onStartHourChange={handleStartHourChange}
            dayLayout={dayLayout}
            onToggleDayLayout={toggleDayLayout}
            regional={regional}
            riskFirstSort={riskFirstSort}
            onToggleRiskFirstSort={toggleRiskFirstSort}
            alertsOnly={alertsOnly}
            onToggleAlertsOnly={toggleAlertsOnly}
          />

          <div className={`flex gap-2 flex-1 min-h-0 overflow-hidden mt-2`}>
            <div className="flex-1 min-w-0 min-h-0 flex flex-col h-full">
              <Card className="h-full flex flex-col overflow-hidden">
                <CardContent className="flex-1 flex flex-col overflow-hidden p-0 h-full min-h-0">
                  {view === "monthly" && (
                    <CalendarGridMonth
                      year={year}
                      month={month}
                      daysInMonth={daysInMonth}
                      firstDayOfMonth={firstDayOfMonth}
                      eventsByDayNumber={eventsByDayNumber}
                      clients={clients}
                      onRemove={handleRemove}
                      onClientClick={handleClientClick}
                      onClearDay={handleClearDay}
                      getTechnicianColor={getTechnicianColor}
                      densityStyle={DENSITY_STYLES[density].card}
                      gapStyle={DENSITY_STYLES[density].gap}
                      savingJobIds={savingJobIds}
                      technicians={technicians}
                      regional={regional}
                    />
                  )}
                  {/* Phase 8a: Weekly view always shows tech-first layout (toggle removed) */}
                  {view === "weekly" && (
                    <div className="flex-1 flex flex-col min-h-0">
                      <CalendarGridWeekTechnicians
                        currentDate={currentDate}
                        density={density}
                        technicians={technicians}
                        eventIndexes={eventIndexes}
                        hiddenTechnicianIds={hiddenTechnicianIds}
                        onJobClick={handleTechWeekJobClick}
                        onSlotClick={handleTechWeekSlotClick}
                        onScheduleNew={handleScheduleNew}
                        regional={regional}
                        techSummaryMap={techSummaryMap}
                        riskFirstSort={riskFirstSort}
                        alertsOnly={alertsOnly}
                      />
                    </div>
                  )}
                  {view === "daily" && (
                    <div className="flex-1 flex flex-col min-h-0">
                      {dayLayout === "columns" ? (
                        /* Vertical tech columns (default) */
                        <CalendarGridDayJobber
                          currentDate={currentDate}
                          density={density}
                          companySettings={companySettings}
                          clients={clients}
                          technicians={technicians}
                          eventIndexes={eventIndexes}
                          hiddenTechnicianIds={hiddenTechnicianIds}
                          getTechnicianColor={getTechnicianColor}
                          handleClientClick={handleClientClick}
                          handleResize={handleResize}
                          savingJobIds={savingJobIds}
                          onUnschedule={handleUnschedule}
                          regional={regional}
                          businessHours={businessHoursData?.hours}
                          techSummaryMap={techSummaryMap}
                          riskFirstSort={riskFirstSort}
                          alertsOnly={alertsOnly}
                        />
                      ) : (
                        /* Horizontal tech rows (Polish Pass 2026-03-04) */
                        <CalendarGridDayRows
                          currentDate={currentDate}
                          density={density}
                          companySettings={companySettings}
                          clients={clients}
                          technicians={technicians}
                          eventIndexes={eventIndexes}
                          hiddenTechnicianIds={hiddenTechnicianIds}
                          getTechnicianColor={getTechnicianColor}
                          handleClientClick={handleClientClick}
                          handleResize={handleResize}
                          savingJobIds={savingJobIds}
                          onUnschedule={handleUnschedule}
                          regional={regional}
                          businessHours={businessHoursData?.hours}
                          techSummaryMap={techSummaryMap}
                          riskFirstSort={riskFirstSort}
                          alertsOnly={alertsOnly}
                        />
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Phase 8d: CalendarSidebar with Visits + Tasks tabs */}
            <aside className="w-auto flex-shrink-0 h-full overflow-hidden">
              <CalendarSidebar
                collapsed={isUnscheduledMinimized}
                onToggleCollapsed={toggleSidebarCollapsed}
                visitItems={unscheduledClients}
                renderVisitItem={renderUnscheduledItem}
                isSavingVisit={isSavingUnscheduled}
                clients={clients}
                unscheduledTasks={unscheduledTasks}
                isLoadingTasks={isLoadingUnscheduledTasks}
                onTaskClick={(taskId) => {
                  setSelectedTaskId(taskId);
                  setTaskDialogOpen(true);
                }}
                onTaskToggle={(taskId, completed) => {
                  const endpoint = completed
                    ? `/api/tasks/${taskId}/close`
                    : `/api/tasks/${taskId}/reopen`;
                  const body = completed && user?.id
                    ? JSON.stringify({ userId: user.id })
                    : undefined;
                  apiRequest(endpoint, {
                    method: "POST",
                    body,
                    headers: body ? { "Content-Type": "application/json" } : undefined,
                  }).then(() => {
                    queryClient.invalidateQueries({ predicate: (q) =>
                      typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/tasks")
                    });
                  });
                }}
                onNewTask={() => {
                  setSelectedTaskId(undefined);
                  setTaskDialogOpen(true);
                }}
                onSuggestSlot={(item) => {
                  setSuggestSlotItem(item);
                  setSuggestSlotOpen(true);
                }}
              />
            </aside>

          </div>


        </main>

        <DragOverlay>
          {activeId && activeClient ? (
            <div className="text-xs p-2 border rounded bg-background shadow-lg">
              <div className="font-medium">
                {activeClient.companyName || findClientByLocationId(clients, getLocationId(activeClient))?.companyName}
              </div>
            </div>
          ) : null}
        </DragOverlay>

        <JobDetailDialog
          open={clientDetailOpen}
          onOpenChange={(open) => {
            setClientDetailOpen(open);
            if (!open) {
              setSelectedClient(null);
              setSelectedAssignment(null);
              setFocusScheduleSection(false);
            }
          }}
          client={selectedClient}
          assignment={selectedAssignment}
          onAssignTechnicians={(assignmentId: string, technicianIds: string[]) => {
            // Get version from selectedAssignment for optimistic locking
            const version = selectedAssignment?.version;
            if (IS_DEV && version === undefined) {
              console.warn('[Calendar] onAssignTechnicians: Missing version on selectedAssignment');
            }
            assignTechnicians.mutate({ assignmentId, technicianIds, version });
          }}
          bulkParts={bulkParts}
          focusSchedule={focusScheduleSection}
        />
      </div>

      <NewAddClientDialog
        open={addClientDialogOpen}
        onOpenChange={setAddClientDialogOpen}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['/api/clients'] });
          queryClient.invalidateQueries({ queryKey: ['/api/calendar'] });
          queryClient.invalidateQueries({ queryKey: ['/api/calendar/unscheduled'] });
        }}
      />



      <PartsDialog
        open={partsDialogOpen}
        onOpenChange={setPartsDialogOpen}
        title={partsDialogTitle}
        parts={partsDialogParts}
        weekDays={partsDialogWeekDays}
      />

      {/* Schedule Job Modal (Slice 3) */}
      <ScheduleJobModal
        open={scheduleModalOpen}
        onOpenChange={setScheduleModalOpen}
        initialDate={scheduleModalDate}
        initialTechnicianId={scheduleModalTechnicianId}
        editAssignment={scheduleModalEdit}
        onSuccess={() => {
          refetchCalendar();
          // Phase 4 Step C5: canonical family key
          queryClient.invalidateQueries({ queryKey: ["jobs"] });
        }}
      />

      {/* Phase 8e: TaskDialog for creating/editing tasks from calendar sidebar */}
      <TaskDialog
        open={taskDialogOpen}
        onOpenChange={setTaskDialogOpen}
        taskId={selectedTaskId}
        onChanged={() => invalidateCalendarQueries()}
      />

      {/* Phase 6: Suggest-slot dialog for auto-gap scheduling */}
      <SuggestSlotDialog
        open={suggestSlotOpen}
        onOpenChange={setSuggestSlotOpen}
        item={suggestSlotItem}
      />

      {/* Diagnostics Panel - dev mode or ?diag=1 */}
      <DiagnosticsPanel />
    </DndContext>
  );
}
