import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { DndContext, DragOverlay, closestCenter, DragEndEvent, DragStartEvent, pointerWithin, CollisionDetection, PointerSensor, useSensor, useSensors, rectIntersection } from "@dnd-kit/core";
import NewAddClientDialog from "@/components/NewAddClientDialog";
import { JobDetailDialog } from "@/components/JobDetailDialog";
import { PartsDialog } from "@/components/PartsDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { X, AlertTriangle, Trash2, Archive, Loader2, Search } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { UnscheduledJobsSidebar } from "@/components/UnscheduledJobsSidebar";
import {
  MONTH_ABBREV,
  DENSITY_STYLES,
  CalendarDensity,
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
  handleCalendarMutationError,
} from "@/components/calendar";
import { DraggableClient } from "@/components/calendar/DraggableClient";

// ============================================================================
// LocationId Adapter Layer (burn-in safe)
// Uses getLocationKey from calendarUtils for consistency
// ============================================================================

/** Alias for getLocationKey - used throughout this file */
const getLocationId = getLocationKey;

/** Find a client by location ID (checks client.id which maps to locationId) */
function findClientByLocationId(clients: any[], locationId: string): any | undefined {
  return clients.find((c: any) => c.id === locationId);
}

// ============================================================================
// Main Calendar Component
// ============================================================================

export default function Calendar() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<"monthly" | "weekly" | "daily">("weekly");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedClient, setSelectedClient] = useState<any | null>(null);
  const [selectedAssignment, setSelectedAssignment] = useState<any | null>(null);
  const [reportDialogClientId, setReportDialogClientId] = useState<string | null>(null);
  const [isUnscheduledMinimized, setIsUnscheduledMinimized] = useState(false);
  const [density, setDensity] = useState<CalendarDensity>('comfortable');
  const [showOnlyOutstanding, setShowOnlyOutstanding] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clientDetailOpen, setClientDetailOpen] = useState(false);
  const [selectedTechnicianId, setSelectedTechnicianId] = useState<string | null>(null);
  const [hiddenTechnicianIds, setHiddenTechnicianIds] = useState<Set<string>>(new Set());
  const [expandedAllDaySlots, setExpandedAllDaySlots] = useState<Set<string>>(new Set());
  const [partsDialogOpen, setPartsDialogOpen] = useState(false);
  const [partsDialogTitle, setPartsDialogTitle] = useState("");
  const [partsDialogParts, setPartsDialogParts] = useState<Array<{ description: string; quantity: number; date?: string }>>([]);
  const [partsDialogWeekDays, setPartsDialogWeekDays] = useState<Array<{ dayName: string; dateLabel: string; date: Date }>>([]);
  // Schedule Job Modal state (Slice 3)
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleModalDate, setScheduleModalDate] = useState<Date | undefined>();
  const [scheduleModalTechnicianId, setScheduleModalTechnicianId] = useState<string | undefined>();
  const [scheduleModalEdit, setScheduleModalEdit] = useState<any>(null);
  // Weekly view mode: "time" (hourly rows) or "technician" (technician rows)
  const [weeklyViewMode, setWeeklyViewMode] = useState<"time" | "technician">("time");
  // Drag/drop saving state for UI feedback
  const [isSavingDrag, setIsSavingDrag] = useState(false);
  // Unscheduled jobs search filter
  const [unscheduledSearch, setUnscheduledSearch] = useState("");
  const { toast } = useToast();
  const [location, setLocation] = useLocation();
  const [addClientDialogOpen, setAddClientDialogOpen] = useState(false);
  const weeklyScrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollDoneRef = useRef(false);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;

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

  const { data, isLoading: isLoadingCalendar, refetch: refetchCalendar } = useQuery({
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

      // Combine assignments and clients from all months
      const allAssignments = results.flatMap(r => r.assignments || []);
      const allClients = results.flatMap(r => r.clients || []);

      // Deduplicate clients by ID
      const uniqueClients = Array.from(
        new Map(allClients.map(c => [c.id, c])).values()
      );

      return {
        assignments: allAssignments,
        clients: uniqueClients
      };
    }
  });

  const { data: bulkParts = {}, isLoading: isLoadingParts } = useQuery<Record<string, any[]>>({
    queryKey: ['/api/client-parts/bulk'],
    staleTime: 60 * 1000,
  });

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

  const { data: technicians = [] } = useQuery<any[]>({
    queryKey: ['/api/technicians'],
  });

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

  const createAssignment = useMutation({
    mutationFn: async ({
      locationId,
      day,
      scheduledHour,
      scheduledStartMinutes,
      targetYear,
      targetMonth,
    }: {
      locationId: string;
      day: number;
      scheduledHour?: number;
      scheduledStartMinutes?: number;
      targetYear?: number;
      targetMonth?: number;
    }) => {
      const useYear = targetYear ?? year;
      const useMonth = targetMonth ?? month;
      return apiRequest(`/api/calendar/assign`, { method: "POST", body: JSON.stringify({
        // DUAL-SEND: locationId is canonical, clientId is legacy fallback.
        // Both are sent during migration period. Remove clientId after schema migration completes.
        // See: calendarUtils.ts getLocationKey() for canonical identity resolution.
        locationId,
        clientId: locationId,
        year: useYear,
        month: useMonth,
        day,
        scheduledDate: new Date(useYear, useMonth - 1, day).toISOString().split('T')[0],
        scheduledHour: scheduledHour !== undefined ? scheduledHour : undefined,
        scheduledStartMinutes: scheduledStartMinutes !== undefined ? scheduledStartMinutes : undefined,
        autoDueDate: false,
      }) });
    },
    onMutate: async () => {
      setIsSavingDrag(true);
    },
    onSuccess: async () => {
      await refetchCalendar();
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({
        title: "Client scheduled",
        description: "The client has been added to the calendar",
      });
    },
    onError: async (error: any) => {
      const handled = await handleCalendarMutationError(error);
      if (!handled) {
        toast({
          title: "Error",
          description: error.message || "Failed to schedule client",
          variant: "destructive",
        });
      }
    },
    onSettled: () => {
      setIsSavingDrag(false);
    },
  });

  const updateAssignment = useMutation({
    mutationFn: async ({
      id,
      day,
      scheduledHour,
      scheduledStartMinutes,
      targetYear,
      targetMonth,
    }: {
      id: string;
      day: number;
      scheduledHour?: number | null;
      scheduledStartMinutes?: number | null;
      targetYear?: number;
      targetMonth?: number;
    }) => {
      const updateYear = targetYear ?? year;
      const updateMonth = targetMonth ?? month;
      return apiRequest(`/api/calendar/assign/${id}`, { method: "PATCH", body: JSON.stringify({
        year: updateYear,
        month: updateMonth,
        day,
        scheduledDate: new Date(updateYear, updateMonth - 1, day).toISOString().split('T')[0],
        scheduledHour: scheduledHour !== undefined ? scheduledHour : undefined,
        // When scheduling into timed slots, allow sub-hour starts (15-min snapping).
        scheduledStartMinutes: scheduledStartMinutes !== undefined ? scheduledStartMinutes : undefined,
      }) });
    },
    onMutate: async () => {
      setIsSavingDrag(true);
    },
    onSuccess: async () => {
      await refetchCalendar();
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/overdue"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({
        title: "Updated",
        description: "The assignment has been moved",
      });
    },
    onError: async (error: any) => {
      // Refetch to rollback optimistic UI changes
      await refetchCalendar();
      // Try to show detailed validation error toast
      const handled = await handleCalendarMutationError(error);
      if (!handled) {
        toast({
          title: "Error",
          description: error.message || "Failed to update assignment",
          variant: "destructive",
        });
      }
    },
    onSettled: () => {
      setIsSavingDrag(false);
    },
  });

  const updateDuration = useMutation({
    mutationFn: async ({ id, durationMinutes }: { id: string; durationMinutes: number }) => {
      return apiRequest(`/api/calendar/assign/${id}`, { method: "PATCH", body: JSON.stringify({ durationMinutes }) });
    },
    onSuccess: async () => {
      await refetchCalendar();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update duration",
        variant: "destructive",
      });
    },
  });

  const handleResize = useCallback((assignmentId: string, newDurationMinutes: number) => {
    updateDuration.mutate({ id: assignmentId, durationMinutes: newDurationMinutes });
  }, [updateDuration]);

  const deleteAssignment = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest(`/api/calendar/assign/${id}`, { method: "DELETE" });
    },
    onSuccess: async () => {
      await refetchCalendar();
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({
        title: "Removed",
        description: "The client has been unscheduled",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to remove assignment",
        variant: "destructive",
      });
    },
  });

  const clearSchedule = useMutation({
    mutationFn: async (assignmentsToDelete: any[]) => {
      // Delete all assignments for this month
      const deletePromises = assignmentsToDelete.map((assignment: any) =>
        apiRequest(`/api/calendar/assign/${assignment.id}`, { method: "DELETE" })
      );
      return Promise.all(deletePromises);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar", year, month] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({
        title: "Schedule cleared",
        description: "All clients have been moved to unscheduled",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to clear schedule",
        variant: "destructive",
      });
    },
  });

  const clearDay = useMutation({
    mutationFn: async ({ day, dayAssignments }: { day: number; dayAssignments: any[] }) => {
      // Delete all assignments for this specific day
      const deletePromises = dayAssignments.map((assignment: any) =>
        apiRequest(`/api/calendar/assign/${assignment.id}`, { method: "DELETE" })
      );
      return Promise.all(deletePromises);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar", year, month] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({
        title: "Day cleared",
        description: "All clients for this day have been unscheduled",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to clear day",
        variant: "destructive",
      });
    },
  });

  const assignTechnicians = useMutation({
    mutationFn: async ({ assignmentId, technicianIds }: { assignmentId: string; technicianIds: string[] }) => {
      return apiRequest(`/api/calendar/assign/${assignmentId}`, { method: 'PATCH', body: JSON.stringify({ assignedTechnicianIds: technicianIds }) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"], exact: false });

      toast({
        title: "Updated",
        description: "Technician assignments updated",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to assign technicians",
        variant: "destructive",
      });
    },
  });

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

  const handleDragStart = (event: DragStartEvent) => {
    if (!DRAG_ENABLED) return;
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!DRAG_ENABLED) return;
    if (!over) return;

    const overId = over.id as string;
    const activeIdValue = active.id as string;

    // If dropping on the same container it started in (or no drop zone specified), it's just a click
    if (active.data?.current?.sortable?.index === over?.data?.current?.sortable?.index && !overId.startsWith('day-') && !overId.startsWith('allday-') && !overId.startsWith('weekly-') && !overId.startsWith('daily-') && overId !== 'unscheduled-panel') {
      return;
    }

    // Check if this is an existing assignment in current month's calendar
    const isExistingCalendarAssignment = assignments.some((a: any) => a.id === activeIdValue);

    // Check if this is an unscheduled item from the backlog
    const unscheduledItem = unscheduledClients.find((item: any) => item.id === activeIdValue);
    const hasExistingAssignment = unscheduledItem?.status === 'existing';

    // Check if dropping on a monthly view day
    if (overId.startsWith('day-')) {
      const day = parseInt(overId.replace('day-', ''));

      if (isExistingCalendarAssignment) {
        // Only move if the assignment exists and day changed
        const currentAssignment = assignments.find((a: any) => a.id === activeIdValue);
        if (currentAssignment && currentAssignment.day !== day) {
          updateAssignment.mutate({ id: activeIdValue, day });
        }
      } else if (unscheduledItem && hasExistingAssignment) {
        // Update existing unscheduled assignment to current view's month/day
        updateAssignment.mutate({ id: unscheduledItem.assignmentId, day, targetMonth: month, targetYear: year });
      } else if (unscheduledItem) {
        // Create new assignment from unscheduled client (no existing assignment - "missing" status)
        // Use the ITEM's original month/year so it's scheduled for the correct PM month
        createAssignment.mutate({
          locationId: getLocationId(unscheduledItem),
          day,
          targetMonth: unscheduledItem.month,
          targetYear: unscheduledItem.year
        });
      }
    } else if (overId.startsWith('allday-')) {
      // Dropped on all-day slot in weekly view (allday-{dayName}-{dayNumber})
      const parts = overId.replace('allday-', '').split('-');
      const targetDay = parseInt(parts[1]);

      if (isExistingCalendarAssignment) {
        const currentAssignment = assignments.find((a: any) => a.id === activeIdValue);
        // Update if day changed OR if moving from a time slot to all-day (scheduledHour becomes null)
        if (currentAssignment && (currentAssignment.day !== targetDay || currentAssignment.scheduledHour !== null)) {
          updateAssignment.mutate({ id: activeIdValue, day: targetDay, scheduledHour: null });
        }
      } else if (unscheduledItem && hasExistingAssignment) {
        // Update existing unscheduled assignment to current view's month/day
        updateAssignment.mutate({ id: unscheduledItem.assignmentId, day: targetDay, scheduledHour: null, targetMonth: month, targetYear: year });
      } else if (unscheduledItem) {
        // Create new assignment from unscheduled client - use ITEM's original month/year
        createAssignment.mutate({
          locationId: getLocationId(unscheduledItem),
          day: targetDay,
          targetMonth: unscheduledItem.month,
          targetYear: unscheduledItem.year
        });
      }
    } else if (overId.startsWith('weekly-')) {
      // Dropped on hourly slot in weekly view (weekly-{dayName}-{hour}-{minute}-{dayNumber})
      const parts = overId.replace('weekly-', '').split('-');
      const hour = parseInt(parts[1]);
      const scheduledStartMinutes = parseInt(parts[2]); // 0/15/30/45
      const targetDay = parseInt(parts[3]);

      if (isExistingCalendarAssignment) {
        const currentAssignment = assignments.find((a: any) => a.id === activeIdValue);
        if (currentAssignment) {
          const currentStart = currentAssignment.scheduledStartMinutes ?? (currentAssignment.scheduledHour != null ? currentAssignment.scheduledHour * 60 : null);
          if (
            currentAssignment.day !== targetDay ||
            currentAssignment.scheduledHour !== hour ||
            currentStart !== scheduledStartMinutes
          ) {
            updateAssignment.mutate({ id: activeIdValue, day: targetDay, scheduledHour: hour, scheduledStartMinutes });
          }
        }
      } else if (unscheduledItem && hasExistingAssignment) {
        // Update existing unscheduled assignment to current view's month/day/hour
        updateAssignment.mutate({ id: unscheduledItem.assignmentId, day: targetDay, scheduledHour: hour, scheduledStartMinutes, targetMonth: month, targetYear: year });
      } else if (unscheduledItem) {
        // Create new assignment from unscheduled client - use ITEM's original month/year
        createAssignment.mutate({
          locationId: getLocationId(unscheduledItem),
          day: targetDay,
          scheduledHour: hour,
          // New assignments will snap to quarter-hour based on where you drop.
          scheduledStartMinutes,
          targetMonth: unscheduledItem.month,
          targetYear: unscheduledItem.year
        });
      }
    } else if (overId.startsWith('daily-')) {
      // Dropped on 15-min slot in daily view (daily-{technicianId}-{hour}-{minute}-{day}-{month}-{year})
      const parts = overId.replace('daily-', '').split('-');
      const technicianId = parts[0];
      const hour = parseInt(parts[1]);
      const scheduledStartMinutes = parseInt(parts[2]); // 0/15/30/45
      const targetDay = parseInt(parts[3]);
      const targetMonthIdx = parseInt(parts[4]); // 0-based month from Date.getMonth()
      const targetYr = parseInt(parts[5]);
      // Convert 0-based month to 1-based for API
      const targetMo = targetMonthIdx + 1;

      if (isExistingCalendarAssignment) {
        const currentAssignment = assignments.find((a: any) => a.id === activeIdValue);
        if (currentAssignment) {
          updateAssignment.mutate({
            id: activeIdValue,
            day: targetDay,
            scheduledHour: hour,
            scheduledStartMinutes,
            targetMonth: targetMo,
            targetYear: targetYr
          });
          // Also assign technician if dropping on a technician column (not unassigned)
          if (technicianId !== 'unassigned') {
            assignTechnicians.mutate({ assignmentId: activeIdValue, technicianIds: [technicianId] });
          }
        }
      } else if (unscheduledItem && hasExistingAssignment) {
        updateAssignment.mutate({
          id: unscheduledItem.assignmentId,
          day: targetDay,
          scheduledHour: hour,
          scheduledStartMinutes,
          targetMonth: targetMo,
          targetYear: targetYr
        });
      } else if (unscheduledItem) {
        // Create new assignment from unscheduled client - use ITEM's original month/year
        createAssignment.mutate({
          locationId: getLocationId(unscheduledItem),
          day: targetDay,
          scheduledHour: hour,
          scheduledStartMinutes,
          targetMonth: unscheduledItem.month,
          targetYear: unscheduledItem.year
        });
      }
    } else if (overId === 'unscheduled-panel') {
      // Dropped on unscheduled panel - remove from calendar
      if (isExistingCalendarAssignment) {
        deleteAssignment.mutate(activeIdValue);
      }
    }
  };

  const handleRemove = (assignmentId: string) => {
    deleteAssignment.mutate(assignmentId);
  };

  const handleClearDay = (day: number, dayAssignments: any[]) => {
    clearDay.mutate({ day, dayAssignments });
  };

  const handleClientClick = (client: any, eventOrAssignment: CalendarEvent | any) => {
    // Handle both CalendarEvent (normalized) and raw assignment shapes
    const rawAssignment = eventOrAssignment.raw ?? eventOrAssignment;
    setSelectedClient(client);
    setSelectedAssignment(rawAssignment);
    setClientDetailOpen(true);
  };

  const toggleComplete = useMutation({
    mutationFn: async () => {
      if (!selectedAssignment) return;
      return apiRequest(`/api/calendar/assign/${selectedAssignment.id}`, { method: "PATCH", body: JSON.stringify({
        completed: !selectedAssignment.completed
      }) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar", year, month] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/overdue"], exact: false });

      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance/recently-completed"] });
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance/statuses"] });
      setSelectedClient(null);
      setSelectedAssignment(null);
      toast({
        title: "Updated",
        description: selectedAssignment?.completed ? "Marked as incomplete" : "Marked as complete",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update completion status",
        variant: "destructive",
      });
    },
  });

  const { data: allClients = [], isLoading: isLoadingClients } = useQuery<any[]>({
    queryKey: ["/api/clients"],
  });

  const { data: unscheduledClients = [], isLoading: isLoadingUnscheduled } = useQuery<any[]>({
    queryKey: ["/api/calendar/unscheduled"],
    queryFn: async () => {
      const res = await fetch(`/api/calendar/unscheduled`);
      if (!res.ok) throw new Error("Failed to fetch unscheduled clients");
      return res.json();
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Query for old unscheduled items that need user action (older than previous month)
  const { data: oldUnscheduledItems = [] } = useQuery<any[]>({
    queryKey: ["/api/calendar/old-unscheduled"],
    queryFn: async () => {
      const res = await fetch(`/api/calendar/old-unscheduled`);
      if (!res.ok) throw new Error("Failed to fetch old unscheduled items");
      return res.json();
    },
  });

  const [showOldItemsDialog, setShowOldItemsDialog] = useState(false);

  // Delete old unscheduled assignment
  const deleteOldAssignment = useMutation({
    mutationFn: async (assignmentId: string) => {
      return apiRequest(`/api/calendar/assign/${assignmentId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/old-unscheduled"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      toast({
        title: "Assignment deleted",
        description: "The old assignment has been removed",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete assignment",
        variant: "destructive",
      });
    },
  });

  // Mark old assignment as completed (archive it)
  const archiveOldAssignment = useMutation({
    mutationFn: async (assignmentId: string) => {
      return apiRequest(`/api/calendar/assign/${assignmentId}`, { method: "PATCH", body: JSON.stringify({
        completed: true
      }) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/old-unscheduled"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      toast({
        title: "Assignment archived",
        description: "The old assignment has been marked as complete",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to archive assignment",
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

  const { assignments = [], clients = [] } = data || {};

  // Normalize assignments into canonical CalendarEvent shape
  const normalizedEvents = useMemo(
    () => normalizeAssignments(assignments),
    [assignments]
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

  // Filter unscheduled clients by search query
  const filteredUnscheduledClients = useMemo(() => {
    if (!unscheduledSearch.trim()) {
      return unscheduledClients;
    }
    const query = unscheduledSearch.toLowerCase().trim();
    return unscheduledClients.filter((item: any) => {
      // Search by company name
      if (item.companyName?.toLowerCase().includes(query)) return true;
      // Search by location
      if (item.location?.toLowerCase().includes(query)) return true;
      // Search by job number (if available)
      if (item.jobNumber && String(item.jobNumber).includes(query)) return true;
      // Search by assignmentId
      if (item.assignmentId?.toLowerCase().includes(query)) return true;
      return false;
    });
  }, [unscheduledClients, unscheduledSearch]);

  // Configure sensors for drag-and-drop
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px of movement before activating drag
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
     assignments.find((a: any) => a.id === activeId)) : null;

  // Handler for toggling technician visibility
  const handleToggleTechnicianVisibility = (techId: string) => {
    setHiddenTechnicianIds(prev => {
      const next = new Set(prev);
      if (next.has(techId)) {
        next.delete(techId);
      } else {
        next.add(techId);
      }
      return next;
    });
  };

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

    const allWeekAssignments = assignments.filter((a: any) => {
      for (let i = 0; i < 7; i++) {
        const date = weekDays[i].date;
        if (a.year === date.getFullYear() && a.month === date.getMonth() + 1 && a.day === date.getDate()) {
          return true;
        }
      }
      return false;
    });

    const parts = calculatePartsWithDates(allWeekAssignments);
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
    const client = clients.find((c: any) => c.id === event.locationKey);
    if (client) {
      setSelectedClient(client);
      setSelectedAssignment(event.raw);
      setClientDetailOpen(true);
    }
  };

  // Handler for technician week view slot click
  const handleTechWeekSlotClick = (date: Date, technician: any) => {
    handleOpenScheduleModal(date, technician?.id);
  };

  // Handler for "Schedule New" button
  const handleScheduleNew = (date: Date, technicianId?: string) => {
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
            density={density}
            onDensityChange={setDensity}
            hiddenTechnicianIds={hiddenTechnicianIds}
            onToggleTechnicianVisibility={handleToggleTechnicianVisibility}
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
                          eventIndexes={eventIndexes}
                          selectedTechnicianId={selectedTechnicianId}
                          expandedAllDaySlots={expandedAllDaySlots}
                          setExpandedAllDaySlots={setExpandedAllDaySlots}
                          getTechnicianColor={getTechnicianColor}
                          handleClientClick={handleClientClick}
                          handleResize={handleResize}
                          weeklyScrollContainerRef={weeklyScrollContainerRef}
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
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <aside className="w-auto flex-shrink-0 h-full overflow-hidden">
              <UnscheduledJobsSidebar
                collapsed={isUnscheduledMinimized}
                onToggleCollapsed={() => setIsUnscheduledMinimized((v) => !v)}
                items={filteredUnscheduledClients}
                searchQuery={unscheduledSearch}
                onSearchChange={setUnscheduledSearch}
                isSaving={isSavingDrag}
                renderItem={(item: any) => {
                  const monthLabel = `${MONTH_ABBREV[item.month - 1]} '${String(item.year).slice(-2)}`;

                  const now = new Date();
                  const todayYear = now.getFullYear();
                  const todayMonth = now.getMonth() + 1;
                  const isPastMonth =
                    item.year < todayYear || (item.year === todayYear && item.month < todayMonth);

                  return (
                    <DraggableClient
                      key={item.id}
                      id={item.id}
                      client={{ companyName: item.companyName, location: item.location, id: getLocationId(item) }}
                      onClick={() => setReportDialogClientId(getLocationId(item))}
                      monthLabel={monthLabel}
                      isOffMonth={true}
                      isPastMonth={isPastMonth}
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
            }
          }}
          client={selectedClient}
          assignment={selectedAssignment}
          onAssignTechnicians={(assignmentId: string, technicianIds: string[]) => {
            assignTechnicians.mutate({ assignmentId, technicianIds });
          }}
          bulkParts={bulkParts}
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
    </DndContext>
  );
}
