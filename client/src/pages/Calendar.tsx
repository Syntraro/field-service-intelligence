import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { DndContext, DragOverlay, closestCenter, DragEndEvent, DragStartEvent, pointerWithin, CollisionDetection, PointerSensor, useSensor, useSensors, rectIntersection } from "@dnd-kit/core";
import NewAddClientDialog from "@/components/NewAddClientDialog";
import { JobDetailDialog } from "@/components/JobDetailDialog";
import { PartsDialog } from "@/components/PartsDialog";
import { DiagnosticsPanel } from "@/components/calendar/DiagnosticsPanel";
import { logDrag, isDiagnosticsEnabled } from "@/lib/calendarDiagnostics";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { X, AlertTriangle, Trash2, Archive, Clock } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { getMemberDisplayName } from "@/lib/displayName";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { UnscheduledJobsSidebar } from "@/components/UnscheduledJobsSidebar";
import { useCalendarState } from "@/hooks/useCalendarState";
import { useCalendarDnD } from "@/hooks/useCalendarDnD";
import {
  MONTH_ABBREV,
  DENSITY_STYLES,
  CalendarEvent,
  getMondayOfWeek,
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
  ScheduleJobModal,
} from "@/components/calendar";
import { DraggableClient } from "@/components/calendar/DraggableClient";
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
  } = useCalendarState();

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

  const { toast } = useToast();
  const [location, setLocation] = useLocation();
  const [addClientDialogOpen, setAddClientDialogOpen] = useState(false);
  const weeklyScrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollDoneRef = useRef(false);

  // Calculate which months to fetch based on view
  const getMonthsToFetch = () => {
    if (view === "weekly") {
      // Get the week range (Monday to Sunday)
      const weekStart = getMondayOfWeek(currentDate);
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
          const res = await fetch(`/api/calendar?year=${y}&month=${m}`);
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
      const currentWeekStart = getMondayOfWeek(currentDate);

      // Prefetch previous week
      const prevWeekStart = new Date(currentWeekStart);
      prevWeekStart.setDate(prevWeekStart.getDate() - 7);
      const prevMonth = prevWeekStart.getMonth() + 1;
      const prevYear = prevWeekStart.getFullYear();
      queryClient.prefetchQuery({
        queryKey: ["/api/calendar", "weekly", prevYear, prevMonth, prevWeekStart.getTime()],
        queryFn: async () => {
          const res = await fetch(`/api/calendar?year=${prevYear}&month=${prevMonth}`);
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
          const res = await fetch(`/api/calendar?year=${nextYear}&month=${nextMonth}`);
          if (!res.ok) throw new Error("Failed to prefetch");
          return res.json();
        },
        staleTime: 60000,
      });
    }
  }, [view, currentDate]);

  // Helper to calculate parts from assignments with optional date tagging
  const calculatePartsWithDates = (assignments: any[]) => {
    const partsList: Array<{ description: string; quantity: number; date?: string }> = [];

    assignments.forEach((assignment: any) => {
      const clientPartsList = bulkParts[getLocationId(assignment)] || [];
      const assignmentDate = new Date(assignment.year, assignment.month - 1, assignment.day);
      const dateKey = assignmentDate.toISOString().split('T')[0];

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

  // Use /api/team/technicians which returns active team members with { id, fullName, email, role }
  const { data: techniciansQueryData, isError: techniciansError } = useQuery<any>({
    queryKey: ['/api/team/technicians'],
  });

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
  const handleResize = useCallback((assignmentId: string, newDurationMinutes: number) => {
    // RBAC: Block resize for view-only users
    if (!canSchedule) {
      showViewOnlyToast();
      return;
    }
    updateDuration.mutate({ id: assignmentId, durationMinutes: newDurationMinutes });
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
  const firstDayOfMonth = new Date(year, month - 1, 1).getDay();

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
      // Start a 250ms timer; if handleDragStart doesn't clear it, warn
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
    if (active.data?.current?.sortable?.index === over?.data?.current?.sortable?.index && !overId.startsWith('day-') && !overId.startsWith('allday-') && !overId.startsWith('weekly-') && !overId.startsWith('daily-') && overId !== 'unscheduled-panel') {
      return;
    }

    // Helper to determine target type from overId
    const getTargetType = (id: string): 'month-day' | 'week-allday' | 'week-timed' | 'day-timed' | 'unscheduled-panel' | undefined => {
      if (id.startsWith('day-')) return 'month-day';
      if (id.startsWith('allday-')) return 'week-allday';
      if (id.startsWith('weekly-')) return 'week-timed';
      if (id.startsWith('daily-')) return 'day-timed';
      if (id === 'unscheduled-panel') return 'unscheduled-panel';
      return undefined;
    };

    // Check if this is an unscheduled item from the backlog
    const unscheduledItem = unscheduledClients.find((item: any) => item.id === activeIdValue);
    const hasExistingAssignment = unscheduledItem?.status === 'existing';

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
      if (process.env.NODE_ENV === 'development') {
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
      if (process.env.NODE_ENV === 'development') {
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
    } else if (overId.startsWith('allday-')) {
      // Dropped on all-day slot in weekly view (allday-{dayName}-{dayNumber})
      const parts = overId.replace('allday-', '').split('-');
      const targetDay = parseInt(parts[1]);

      if (isExistingCalendarAssignment) {
        const currentAssignment = events.find((a: any) => a.id === activeIdValue);
        // Update if day changed OR if moving from a time slot to all-day (scheduledHour becomes null)
        if (currentAssignment && (currentAssignment.day !== targetDay || currentAssignment.scheduledHour !== null)) {
          const version = requireAssignmentVersion(currentAssignment);
          if (version === null) return; // Refetch triggered, abort mutation
          updateAssignmentMutation.mutate({
            id: activeIdValue,
            day: targetDay,
            scheduledHour: null,
            allDay: true,
            version,
          });
        }
      } else if (unscheduledItem && hasExistingAssignment) {
        // Update existing unscheduled assignment to current view's month/day
        const version = requireAssignmentVersion(unscheduledItem);
        if (version === null) return; // Refetch triggered, abort mutation
        updateAssignmentMutation.mutate({
          id: unscheduledItem.assignmentId,
          day: targetDay,
          scheduledHour: null,
          allDay: true,
          targetMonth: month,
          targetYear: year,
          version,
        });
      } else if (unscheduledItem) {
        // Create new assignment from unscheduled job - use ITEM's original month/year
        const jobVersion = requireJobVersion(unscheduledItem);
        if (jobVersion === null) return; // Refetch triggered, abort mutation
        createAssignmentMutation.mutate({
          jobId: unscheduledItem.id || unscheduledItem.jobId,
          day: targetDay,
          targetMonth: unscheduledItem.month ?? month,
          targetYear: unscheduledItem.year ?? year,
          version: jobVersion,
          allDay: true,
        });
      }
    } else if (overId.startsWith('weekly-')) {
      // Dropped on timed slot in weekly view (weekly-{dayName}-{hour}-{minute}-{dayNumber})
      // Contract: exactly 5 segments after split → [prefix, dayName, hour, minute, dayNumber]
      const parts = overId.replace('weekly-', '').split('-');
      const hour = parseInt(parts[1]);
      const scheduledStartMinutes = parseInt(parts[2]); // 0/15/30/45
      const targetDay = parseInt(parts[3]);

      // Strict: reject timed target if minute is missing or NaN
      if (parts.length < 4 || isNaN(hour) || isNaN(scheduledStartMinutes) || isNaN(targetDay)) {
        console.error('[Calendar] Invalid weekly timed target id (missing minute):', overId, { parts });
        toast({ title: "Invalid drop target time. Please refresh.", variant: "destructive" });
        return;
      }

      // DEV diagnostic: log intended drop time for minute-precision tracing
      if (process.env.NODE_ENV === 'development') {
        console.log('[DROP] weekly timed target:', {
          overId,
          intendedHour: hour,
          intendedMinute: scheduledStartMinutes,
          targetDay,
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
              scheduledHour: hour,
              scheduledStartMinutes,
              version,
              durationMinutes: duration,
              allDay: false, // Explicitly mark as timed event
            });
          }
        }
      } else if (unscheduledItem && hasExistingAssignment) {
        // Update existing unscheduled assignment to current view's month/day/hour
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
          targetMonth: month,
          targetYear: year,
          version,
          durationMinutes: duration,
          allDay: false,
        });
      } else if (unscheduledItem) {
        // Create new assignment from unscheduled job - use ITEM's original month/year
        const jobVersion = requireJobVersion(unscheduledItem);
        if (jobVersion === null) return; // Refetch triggered, abort mutation
        createAssignmentMutation.mutate({
          jobId: unscheduledItem.id || unscheduledItem.jobId,
          day: targetDay,
          scheduledHour: hour,
          scheduledStartMinutes,
          targetMonth: unscheduledItem.month ?? month,
          targetYear: unscheduledItem.year ?? year,
          version: jobVersion,
        });
      }
    } else if (overId.startsWith('daily-')) {
      // Dropped on timed slot in daily view (daily-{technicianId}-{hour}-{minute}-{day}-{month}-{year})
      // Contract: exactly 6 segments after prefix strip → [techId, hour, minute, day, month, year]
      const parts = overId.replace('daily-', '').split('-');
      const technicianId = parts[0];
      const hour = parseInt(parts[1]);
      const scheduledStartMinutes = parseInt(parts[2]); // 0/15/30/45
      const targetDay = parseInt(parts[3]);
      const targetMonthIdx = parseInt(parts[4]); // 0-based month from Date.getMonth()
      const targetYr = parseInt(parts[5]);

      // Strict: reject timed target if minute or any required segment is missing/NaN
      if (parts.length < 6 || isNaN(hour) || isNaN(scheduledStartMinutes) || isNaN(targetDay) || isNaN(targetMonthIdx) || isNaN(targetYr)) {
        console.error('[Calendar] Invalid daily timed target id (missing minute or segment):', overId, { parts });
        toast({ title: "Invalid drop target time. Please refresh.", variant: "destructive" });
        return;
      }

      // DEV diagnostic: log intended drop time for minute-precision tracing
      if (process.env.NODE_ENV === 'development') {
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
          });
          // Also assign technician if dropping on a technician column (not unassigned)
          if (technicianId !== 'unassigned') {
            assignTechnicians.mutate({ assignmentId: activeIdValue, technicianIds: [technicianId] });
          }
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
        });
      } else if (unscheduledItem) {
        // Create new assignment from unscheduled job - use ITEM's original month/year
        const jobVersion = requireJobVersion(unscheduledItem);
        if (jobVersion === null) return; // Refetch triggered, abort mutation
        createAssignmentMutation.mutate({
          jobId: unscheduledItem.id || unscheduledItem.jobId,
          day: targetDay,
          scheduledHour: hour,
          scheduledStartMinutes,
          targetMonth: unscheduledItem.month ?? month,
          targetYear: unscheduledItem.year ?? year,
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

  const handleRemove = (assignmentId: string, version?: number) => {
    // Find the assignment to get its version if not provided
    const assignment = events.find((a: any) => a.id === assignmentId);
    const resolvedVersion = version ?? assignment?.version;

    // Validate version before mutation - no silent 0 fallback
    if (typeof resolvedVersion !== 'number' || !Number.isFinite(resolvedVersion)) {
      if (process.env.NODE_ENV === 'development') {
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
  };

  const handleClearDay = (day: number, dayAssignments: any[]) => {
    // Each assignment in dayAssignments should have version for optimistic locking
    clearDay.mutate({ day, dayAssignments });
  };

  const handleClientClick = (client: any, eventOrAssignment: CalendarEvent | any, focusSchedule: boolean = false) => {
    // Handle both CalendarEvent (normalized) and raw assignment shapes
    const rawAssignment = eventOrAssignment.raw ?? eventOrAssignment;

    // Build enriched assignment with correct IDs to prevent modal from using wrong ID
    const enrichedAssignment = {
      ...rawAssignment,
      // Ensure assignmentId is properly set (this is the calendar assignment ID)
      assignmentId: rawAssignment.assignmentId ?? rawAssignment.id,
      // Ensure jobId is properly set (this is the actual job ID for API calls)
      jobId: rawAssignment.jobId ?? rawAssignment.job_id ?? rawAssignment.job?.id ?? rawAssignment.jobIdFromJoin ?? rawAssignment.id,
      // Ensure locationId is properly set for client lookup
      locationId: rawAssignment.locationId ?? getLocationId(rawAssignment),
    };

    // Harden selected client - use fallback if client is falsy or looks like placeholder
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
  };

  const { data: clientsQueryData, isLoading: isLoadingClients } = useQuery<any>({
    queryKey: ["/api/clients"],
  });

  // SAFE: Normalize clients to array immediately
  const allClients = useMemo(() => normalizeArray<any>(clientsQueryData), [clientsQueryData]);

  const { data: unscheduledQueryData, isLoading: isLoadingUnscheduled } = useQuery<any>({
    queryKey: ["/api/calendar/unscheduled"],
    queryFn: async () => {
      const res = await fetch(`/api/calendar/unscheduled`);
      if (!res.ok) throw new Error("Failed to fetch unscheduled clients");
      const data = await res.json();
      // SAFE: Normalize to array in query function
      const normalized = normalizeArray<any>(data);
      // DEV LOGGING: Log unscheduled jobs received (include version for debugging VERSION_MISMATCH)
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

  // Query for old unscheduled items that need user action (older than previous month)
  const { data: oldUnscheduledQueryData } = useQuery<any>({
    queryKey: ["/api/calendar/old-unscheduled"],
    queryFn: async () => {
      const res = await fetch(`/api/calendar/old-unscheduled`);
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
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
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
  if (process.env.NODE_ENV === 'development' && data && !Array.isArray(rawEvents)) {
    console.error(
      '[Calendar] API CONTRACT VIOLATION: /api/calendar response.events is not an array:',
      typeof rawEvents,
      rawEvents
    );
    throw new Error('Calendar API contract violation: events must be an array');
  }
  // Use allClients (from /api/clients) as the client lookup source
  const clients = allClients;

  // DEV LOGGING: Log scheduled jobs received from API
  if (events.length > 0 || process.env.NODE_ENV === 'development') {
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
      if (process.env.NODE_ENV === 'development') {
        for (const evt of normalized) {
          if ('scheduledStart' in evt && !('assignmentId' in evt)) {
            console.error('[Calendar] MODEL A VIOLATION: received job instead of calendar event', evt);
          }
        }
      }

      // DEV LOGGING: Log normalized events
      if (normalized.length > 0 || process.env.NODE_ENV === 'development') {
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

  // Build memoized indexes for efficient lookup
  const eventIndexes = useMemo(
    () => buildEventIndexes(normalizedEvents),
    [normalizedEvents]
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
    if (process.env.NODE_ENV !== 'development' && !isDiagnosticsEnabled()) {
      return;
    }

    // Fetch state snapshot for invariant verification
    const fetchSnapshot = async () => {
      try {
        const res = await fetch('/api/calendar/state-snapshot');
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
  const customCollisionDetection: CollisionDetection = useCallback((args) => {
    // Filter to only check day drop zones, all-day slots, weekly slots, and the unscheduled panel
    const dropZoneContainers = args.droppableContainers.filter(
      (container) => {
        const id = container.id as string;
        return id.startsWith('day-') || id.startsWith('allday-') || id.startsWith('weekly-') || id.startsWith('daily-') || id === 'unscheduled-panel';
      }
    );

    // Prefer pointerWithin for small (15-min) drop zones
    const pointerCollisions = pointerWithin({
      ...args,
      droppableContainers: dropZoneContainers,
    });

    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }

    // Fallback to rectIntersection for grid layout support
    const rectCollisions = rectIntersection({
      ...args,
      droppableContainers: dropZoneContainers,
    });

    if (rectCollisions.length > 0) {
      return rectCollisions;
    }

    // Final fallback to closestCenter
    return closestCenter({
      ...args,
      droppableContainers: dropZoneContainers,
    });
  }, []);

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
    const weekStart = getMondayOfWeek(currentDate);
    const weekDays: Array<{ dayName: string; dateLabel: string; date: Date }> = [];

    for (let i = 0; i < 7; i++) {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + i);
      weekDays.push({
        dayName: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i],
        dateLabel: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        date: new Date(date)
      });
    }

    const allWeekEvents = events.filter((a: any) => {
      for (let i = 0; i < 7; i++) {
        const date = weekDays[i].date;
        if (a.year === date.getFullYear() && a.month === date.getMonth() + 1 && a.day === date.getDate()) {
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
      onDragEnd={handleDragEnd}
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
                      {MONTH_ABBREV[item.assignment.month - 1]} '{String(item.assignment.year).slice(-2)}
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
            selectedTechnicianId={selectedTechnicianId}
            onSelectedTechnicianChange={setSelectedTechnicianId}
            technicians={technicians}
            onPartsClick={handlePartsClick}
            calendarStartHour={companySettings?.calendarStartHour || 8}
            onStartHourChange={handleStartHourChange}
            hiddenTechnicianIds={hiddenTechnicianIds}
            onToggleTechnicianVisibility={toggleTechnicianVisibility}
          />

          <div className={`flex gap-2 flex-1 min-h-0 overflow-hidden`}>
            <div className="flex-1 min-w-0 flex flex-col h-full">
              <Card className="h-full flex flex-col">
                <CardContent className="flex-1 overflow-auto p-0">
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
                    />
                  )}
                  {view === "weekly" && (
                    <div className="h-full flex flex-col min-h-0 max-h-full">
                      {/* Weekly view mode toggle */}
                      <div className="flex items-center gap-2 p-2 border-b bg-muted/30">
                        <span className="text-xs font-medium text-muted-foreground">View:</span>
                        <div className="flex rounded-md border bg-background">
                          <Button
                            variant={weeklyViewMode === "time" ? "secondary" : "ghost"}
                            size="sm"
                            className="h-7 px-3 text-xs rounded-r-none"
                            onClick={() => setWeeklyViewMode("time")}
                          >
                            Hourly
                          </Button>
                          <Button
                            variant={weeklyViewMode === "technician" ? "secondary" : "ghost"}
                            size="sm"
                            className="h-7 px-3 text-xs rounded-l-none border-l"
                            onClick={() => setWeeklyViewMode("technician")}
                          >
                            By Technician
                          </Button>
                        </div>
                      </div>

                      {weeklyViewMode === "time" ? (
                        <CalendarGridWeek
                          currentDate={currentDate}
                          density={density}
                          companySettings={companySettings}
                          clients={clients}
                          technicians={technicians}
                          eventIndexes={eventIndexes}
                          selectedTechnicianId={selectedTechnicianId}
                          expandedAllDaySlots={expandedAllDaySlots}
                          setExpandedAllDaySlots={setExpandedAllDaySlots}
                          getTechnicianColor={getTechnicianColor}
                          handleClientClick={handleClientClick}
                          handleResize={handleResize}
                          weeklyScrollContainerRef={weeklyScrollContainerRef}
                          visibleHours={visibleHours}
                          showFullDay={showFullDay}
                          onToggleFullDay={toggleShowFullDay}
                          savingJobIds={savingJobIds}
                          onUnschedule={handleUnschedule}
                        />
                      ) : (
                        <CalendarGridWeekTechnicians
                          currentDate={currentDate}
                          density={density}
                          technicians={technicians}
                          eventIndexes={eventIndexes}
                          hiddenTechnicianIds={hiddenTechnicianIds}
                          onJobClick={handleTechWeekJobClick}
                          onSlotClick={handleTechWeekSlotClick}
                          onScheduleNew={handleScheduleNew}
                        />
                      )}
                    </div>
                  )}
                  {view === "daily" && (
                    <div className="h-full flex flex-col min-h-0 max-h-full">
                      <CalendarGridDay
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
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <aside className="w-auto flex-shrink-0 h-full overflow-hidden">
              <UnscheduledJobsSidebar
                collapsed={isUnscheduledMinimized}
                onToggleCollapsed={toggleSidebarCollapsed}
                items={unscheduledClients}
                isSaving={isSavingDrag}
                renderItem={(item: any) => {
                  const monthLabel = `${MONTH_ABBREV[item.month - 1]} '${String(item.year).slice(-2)}`;

                  const now = new Date();
                  const todayYear = now.getFullYear();
                  const todayMonth = now.getMonth() + 1;
                  const isPastMonth =
                    item.year < todayYear || (item.year === todayYear && item.month < todayMonth);

                  // Use helper functions for resilient display
                  const companyName = getUnscheduledCompanyName(item);
                  const locationLabel = getUnscheduledLocationLabel(item);

                  return (
                    <DraggableClient
                      key={item.id}
                      id={item.id}
                      client={{ companyName, location: locationLabel, id: getLocationId(item) }}
                      onClick={() => setReportDialogClientId(getLocationId(item))}
                      monthLabel={monthLabel}
                      isOffMonth={true}
                      isPastMonth={isPastMonth}
                      isSaving={item._optimistic}
                      summary={item.summary}
                      rawItem={item}
                    />
                  );
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
            assignTechnicians.mutate({ assignmentId, technicianIds });
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
          queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
        }}
      />

      {/* Diagnostics Panel - dev mode or ?diag=1 */}
      <DiagnosticsPanel />
    </DndContext>
  );
}
