import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { format } from "date-fns";
import { useQuery, useMutation } from "@tanstack/react-query";
import { DndContext, DragOverlay, closestCenter, DragEndEvent, DragStartEvent, useDroppable, pointerWithin, CollisionDetection, PointerSensor, useSensor, useSensors, rectIntersection } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import NewAddClientDialog from "@/components/NewAddClientDialog";
import { JobDetailDialog } from "@/components/JobDetailDialog";
import { PartsDialog } from "@/components/PartsDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, X, ChevronsRight, ChevronsLeft, Users, Info, AlertTriangle, Trash2, Archive, Package } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { UnscheduledJobsSidebar } from "@/components/UnscheduledJobsSidebar";
import {
  MONTH_ABBREV,
  TECHNICIAN_COLORS,
  DRAG_ENABLED,
  DENSITY_STYLES,
  ALLDAY_ROW_HEIGHTS,
  CalendarDensity,
  getAssignmentStartMinutes,
  calculateLanes,
  getMondayOfWeek,
  createTechnicianColorMap,
  getTechnicianColorForAssignment,
} from "@/components/calendar";
import { DraggableClient } from "@/components/calendar/DraggableClient";
import { ResizableJobCard } from "@/components/calendar/ResizableJobCard";

function UnscheduledPanel({ clients, onClientClick, isMinimized, onToggleMinimize, currentMonth, currentYear }: { 
  clients: any[]; 
  onClientClick?: (clientId: string) => void;
  isMinimized: boolean;
  onToggleMinimize: () => void;
  currentMonth: number;
  currentYear: number;
}) {
  const { setNodeRef } = useDroppable({ id: 'unscheduled-panel' });

  if (isMinimized) {
    return (
      <div className="fixed right-0 top-0 h-screen flex items-center z-50">
        <Card className="h-full w-12 shadow-lg rounded-l-xl rounded-r-none flex flex-col items-center justify-center border-r-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleMinimize}
            className="mb-4"
            data-testid="button-expand-unscheduled"
          >
            <ChevronsLeft className="h-5 w-5" />
          </Button>
          <div className="writing-mode-vertical text-sm font-semibold text-muted-foreground whitespace-nowrap" style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}>
            Unscheduled ({clients.length})
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <Card className="h-full shadow-md rounded-lg flex flex-col overflow-hidden">
        <CardHeader className="pb-1.5 pt-2 px-3 flex flex-row items-center justify-between space-y-0 flex-shrink-0 border-b">
          <CardTitle className="text-xs font-semibold">Unscheduled ({clients.length})</CardTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleMinimize}
            className="h-6 w-6"
            data-testid="button-minimize-unscheduled"
          >
            <ChevronsRight className="h-3 w-3" />
          </Button>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 p-2">
          <SortableContext items={clients.map((c: any) => c.id)} strategy={verticalListSortingStrategy}>
            <div 
              ref={setNodeRef}
              className="space-y-1.5 h-full overflow-y-auto pr-1"
              style={{ scrollbarWidth: 'thin' }}
              data-testid="unscheduled-panel"
            >
              {clients.map((item: any) => {
                // Show month badge for ALL items with year suffix
                const now = new Date();
                const todayYear = now.getFullYear();
                const monthLabel = `${MONTH_ABBREV[item.month - 1]} '${String(item.year).slice(-2)}`;
                
                // Determine if this is a PAST month (overdue) vs future/current month
                const todayMonth = now.getMonth() + 1;
                const isPastMonth = item.year < todayYear || (item.year === todayYear && item.month < todayMonth);
                
                return (
                  <DraggableClient
                    key={item.id}
                    id={item.id}
                    client={{ companyName: item.companyName, location: item.location, id: item.clientId }}
                    onClick={() => onClientClick?.(item.clientId)}
                    monthLabel={monthLabel}
                    isOffMonth={true}
                    isPastMonth={isPastMonth}
                  />
                );
              })}
              {clients.length === 0 && (
                <div className="text-sm text-muted-foreground text-center py-8">
                  All clients scheduled
                </div>
              )}
            </div>
          </SortableContext>
        </CardContent>
      </Card>
    </div>
  );
}

function DayPartsCell({ assignments, clients, dayName, date, showOnlyOutstanding }: { assignments: any[]; clients: any[]; dayName: string; date: Date; showOnlyOutstanding: boolean }) {
  const { toast } = useToast();
  
  // Filter assignments based on mode
  const relevantAssignments = showOnlyOutstanding 
    ? assignments.filter((a: any) => !a.completed)
    : assignments;
  
  const clientIds = relevantAssignments.map((a: any) => a.clientId);
  
  const { data: bulkParts = {} } = useQuery<Record<string, any[]>>({
    queryKey: ['/api/client-parts/bulk'],
    staleTime: 60 * 1000,
  });

  const allParts = clientIds.flatMap((clientId: string) => bulkParts[clientId] || []);

  // Aggregate parts by type
  const partCounts: Record<string, number> = allParts.reduce((acc: Record<string, number>, clientPart: any) => {
    const part = clientPart.part;
    if (!part) return acc;
    
    let key: string;
    if (part.type === 'filter') {
      key = `${part.filterType || 'Filter'} ${part.size || ''}`.trim();
    } else if (part.type === 'belt') {
      key = `Belt ${part.beltType || ''} ${part.size || ''}`.trim();
    } else {
      return acc; // Skip non-filter/belt parts
    }
    
    acc[key] = (acc[key] || 0) + clientPart.quantity;
    return acc;
  }, {});

  const sortedParts = Object.entries(partCounts).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="px-1.5 py-1 border bg-card">
      {sortedParts.length > 0 ? (
        <div className="space-y-0">
          {sortedParts.map(([partName, quantity]) => (
            <div key={partName} className="flex items-center justify-between gap-0.5 text-[10px] leading-tight py-0.5">
              <span className="flex-1 truncate" title={partName}>{partName}</span>
              <span className="font-semibold text-primary shrink-0 text-[11px]">×{quantity}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[10px] text-muted-foreground text-center py-2">
          No parts
        </div>
      )}
    </div>
  );
}

function DroppableDay({ day, year, month, assignments, clients, onRemove, onClientClick, onClearDay, showParts = false, getTechnicianColor, densityStyle, gapStyle }: {
  day: number;
  year: number;
  month: number;
  assignments: any[];
  clients: any[];
  onRemove: (assignmentId: string) => void;
  onClientClick: (client: any, assignment: any) => void;
  onClearDay: (day: number, dayAssignments: any[]) => void;
  showParts?: boolean;
  getTechnicianColor?: (assignment: any) => ReturnType<typeof getTechnicianColorForAssignment>;
  densityStyle?: string;
  gapStyle?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${day}` });
  
  // Check if day is overdue
  const today = new Date();
  const dayDate = new Date(year, month - 1, day);
  const isOverdue = dayDate < today;

  return (
    <div
      ref={setNodeRef}
      className={`min-h-20 px-1 py-1 border transition-all flex flex-col ${
        isOver 
          ? 'bg-primary/10 border-primary border-2 ring-2 ring-primary/30 shadow-md' 
          : 'bg-background'
      }`}
      data-testid={`calendar-day-${day}`}
    >
      <div className="text-xs text-muted-foreground mb-0.5 px-0.5">{day}</div>
      <div className={`flex-1 flex flex-col ${gapStyle || 'gap-1'}`}>
        {assignments.map((assignment: any) => {
          const client = clients.find((c: any) => c.id === assignment.clientId);
          return client ? (
            <div key={assignment.id} className="relative group">
              <DraggableClient 
                id={assignment.id} 
                client={client}
                inCalendar={true}
                onClick={() => onClientClick(client, assignment)}
                isCompleted={assignment.completed}
                isOverdue={!assignment.completed && isOverdue}
                assignment={assignment}
                technicianColor={getTechnicianColor?.(assignment)}
                densityStyle={densityStyle}
                onAssignTechnician={(assignmentId: string, technicianId: string | null) => {
                  queryClient.setQueryData(['/api/calendar', year, month], (old: any) => {
                    if (!old) return old;
                    return {
                      ...old,
                      assignments: old.assignments.map((a: any) =>
                        a.id === assignmentId ? { ...a, assignedTechnicianId: technicianId } : a
                      )
                    };
                  });
                  apiRequest(`/api/calendar/assign/${assignmentId}`, { method: 'PATCH', body: JSON.stringify({ assignedTechnicianId: technicianId }) });
                }}
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(assignment.id);
                }}
                className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-10"
                data-testid={`remove-assignment-${assignment.id}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : null;
        })}
      </div>
    </div>
  );
}

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

  // Helper to calculate parts from assignments with optional date tagging
  const calculatePartsWithDates = (assignments: any[]) => {
    const partsList: Array<{ description: string; quantity: number; date?: string }> = [];
    
    assignments.forEach((assignment: any) => {
      const clientPartsList = bulkParts[assignment.clientId] || [];
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
      clientId,
      day,
      scheduledHour,
      scheduledStartMinutes,
      targetYear,
      targetMonth,
    }: {
      clientId: string;
      day: number;
      scheduledHour?: number;
      scheduledStartMinutes?: number;
      targetYear?: number;
      targetMonth?: number;
    }) => {
      const useYear = targetYear ?? year;
      const useMonth = targetMonth ?? month;
      return apiRequest(`/api/calendar/assign`, { method: "POST", body: JSON.stringify({
        clientId,
        year: useYear,
        month: useMonth,
        day,
        scheduledDate: new Date(useYear, useMonth - 1, day).toISOString().split('T')[0],
        scheduledHour: scheduledHour !== undefined ? scheduledHour : undefined,
        scheduledStartMinutes: scheduledStartMinutes !== undefined ? scheduledStartMinutes : undefined,
        autoDueDate: false,
      }) });
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
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to schedule client",
        variant: "destructive",
      });
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
    onSuccess: async () => {
      await refetchCalendar();
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/overdue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({
        title: "Updated",
        description: "The assignment has been moved",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update assignment",
        variant: "destructive",
      });
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
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
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

  // Compute a 15-minute snapped start minute within an hour slot based on the final drag position.
  // This keeps droppable zones hour-based, but stores precise starts via `scheduledStartMinutes`.
  const computeSnappedStartMinutes = useCallback((event: DragEndEvent, hour: number) => {
    const rowHeight = DENSITY_STYLES[density].rowHeight;
    const overRect = event.over?.rect;
    const activeRect = event.active?.rect?.current;

    if (!overRect || !activeRect) return hour * 60;

    const translatedTop = (activeRect.translated?.top ?? activeRect.initial?.top);
    if (typeof translatedTop !== 'number') return hour * 60;

    // How far from the top of the hour cell did the card land?
    const offsetY = translatedTop - overRect.top;
    const pixelsPerMinute = rowHeight / 60;
    const rawMinutes = Math.round(offsetY / pixelsPerMinute);

    // Snap within the hour to 15-minute increments and clamp.
    const snappedWithinHour = Math.max(0, Math.min(59, Math.round(rawMinutes / 15) * 15));
    return hour * 60 + snappedWithinHour;
  }, [density]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!DRAG_ENABLED) return;
    if (!over) return;

    const overId = over.id as string;
    const activeId = active.id as string;

    // If dropping on the same container it started in (or no drop zone specified), it's just a click
    if (active.data?.current?.sortable?.index === over?.data?.current?.sortable?.index && !overId.startsWith('day-') && !overId.startsWith('allday-') && !overId.startsWith('weekly-') && !overId.startsWith('daily-') && overId !== 'unscheduled-panel') {
      return;
    }

    // Check if this is an existing assignment in current month's calendar
    const isExistingCalendarAssignment = assignments.some((a: any) => a.id === activeId);
    
    // Check if this is an unscheduled item from the backlog
    const unscheduledItem = unscheduledClients.find((item: any) => item.id === activeId);
    const hasExistingAssignment = unscheduledItem?.status === 'existing';

    // Check if dropping on a monthly view day
    if (overId.startsWith('day-')) {
      const day = parseInt(overId.replace('day-', ''));
      
      if (isExistingCalendarAssignment) {
        // Only move if the assignment exists and day changed
        const currentAssignment = assignments.find((a: any) => a.id === activeId);
        if (currentAssignment && currentAssignment.day !== day) {
          updateAssignment.mutate({ id: activeId, day });
        }
      } else if (unscheduledItem && hasExistingAssignment) {
        // Update existing unscheduled assignment to current view's month/day
        updateAssignment.mutate({ id: unscheduledItem.assignmentId, day, targetMonth: month, targetYear: year });
      } else if (unscheduledItem) {
        // Create new assignment from unscheduled client (no existing assignment - "missing" status)
        // Use the ITEM's original month/year so it's scheduled for the correct PM month
        createAssignment.mutate({ 
          clientId: unscheduledItem.clientId, 
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
        const currentAssignment = assignments.find((a: any) => a.id === activeId);
        // Update if day changed OR if moving from a time slot to all-day (scheduledHour becomes null)
        if (currentAssignment && (currentAssignment.day !== targetDay || currentAssignment.scheduledHour !== null)) {
          updateAssignment.mutate({ id: activeId, day: targetDay, scheduledHour: null });
        }
      } else if (unscheduledItem && hasExistingAssignment) {
        // Update existing unscheduled assignment to current view's month/day
        updateAssignment.mutate({ id: unscheduledItem.assignmentId, day: targetDay, scheduledHour: null, targetMonth: month, targetYear: year });
      } else if (unscheduledItem) {
        // Create new assignment from unscheduled client - use ITEM's original month/year
        createAssignment.mutate({ 
          clientId: unscheduledItem.clientId, 
          day: targetDay,
          targetMonth: unscheduledItem.month,
          targetYear: unscheduledItem.year
        });
      }
    } else if (overId.startsWith('weekly-')) {
      // Dropped on hourly slot in weekly view (weekly-{dayName}-{hour}-{dayNumber})
      const parts = overId.replace('weekly-', '').split('-');
      // weekly-{dayName}-{hour}-{minute}-{dayNumber}
      const hour = parseInt(parts[1]);
      const scheduledStartMinutes = parseInt(parts[2]); // 0/15/30/45
      const targetDay = parseInt(parts[3]);
      
      if (isExistingCalendarAssignment) {
        const currentAssignment = assignments.find((a: any) => a.id === activeId);
        if (currentAssignment) {
          const currentStart = currentAssignment.scheduledStartMinutes ?? (currentAssignment.scheduledHour != null ? currentAssignment.scheduledHour * 60 : null);
          if (
            currentAssignment.day !== targetDay ||
            currentAssignment.scheduledHour !== hour ||
            currentStart !== scheduledStartMinutes
          ) {
            updateAssignment.mutate({ id: activeId, day: targetDay, scheduledHour: hour, scheduledStartMinutes });
          }
        }
      } else if (unscheduledItem && hasExistingAssignment) {
        // Update existing unscheduled assignment to current view's month/day/hour
        updateAssignment.mutate({ id: unscheduledItem.assignmentId, day: targetDay, scheduledHour: hour, scheduledStartMinutes, targetMonth: month, targetYear: year });
      } else if (unscheduledItem) {
        // Create new assignment from unscheduled client - use ITEM's original month/year
        createAssignment.mutate({ 
          clientId: unscheduledItem.clientId, 
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
        const currentAssignment = assignments.find((a: any) => a.id === activeId);
        if (currentAssignment) {
          updateAssignment.mutate({ 
            id: activeId, 
            day: targetDay, 
            scheduledHour: hour,
            scheduledStartMinutes,
            targetMonth: targetMo,
            targetYear: targetYr
          });
          // Also assign technician if dropping on a technician column (not unassigned)
          if (technicianId !== 'unassigned') {
            assignTechnicians.mutate({ assignmentId: activeId, technicianIds: [technicianId] });
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
          clientId: unscheduledItem.clientId, 
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
        deleteAssignment.mutate(activeId);
      }
    }
  };

  const handleRemove = (assignmentId: string) => {
    deleteAssignment.mutate(assignmentId);
  };

  const handleClearDay = (day: number, dayAssignments: any[]) => {
    clearDay.mutate({ day, dayAssignments });
  };

  const handleClientClick = (client: any, assignment: any) => {
    console.log('handleClientClick called with:', { client, assignment });
    setSelectedClient(client);
    setSelectedAssignment(assignment);
    setClientDetailOpen(true);
    console.log('Dialog state set to true');
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
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/overdue"] });
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
  }, [view, companySettings?.calendarStartHour, isLoadingCalendar, isLoadingUnscheduled]);

  const { assignments = [], clients = [] } = data || {};

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

  // Create a map of assignments by day
  const assignmentsByDay: Record<number, any[]> = {};
  assignments.forEach((assignment: any) => {
    if (assignment.day) {
      if (!assignmentsByDay[assignment.day]) {
        assignmentsByDay[assignment.day] = [];
      }
      assignmentsByDay[assignment.day].push(assignment);
    }
  });

  // Get active dragging item
  const activeClient = activeId ? 
    (unscheduledClients.find((c: any) => c.id === activeId) || 
     assignments.find((a: any) => a.id === activeId)) : null;

  // Render calendar grid
  const renderMonthlyView = () => {
    const days = [];
    const totalCells = Math.ceil((daysInMonth + firstDayOfMonth) / 7) * 7;

    for (let i = 0; i < totalCells; i++) {
      const dayNumber = i - firstDayOfMonth + 1;
      const isValidDay = dayNumber > 0 && dayNumber <= daysInMonth;
      const dayAssignments = isValidDay ? (assignmentsByDay[dayNumber] || []) : [];

      days.push(
        isValidDay ? (
          <DroppableDay
            key={i}
            day={dayNumber}
            year={year}
            month={month}
            assignments={dayAssignments}
            clients={clients}
            onRemove={handleRemove}
            onClientClick={handleClientClick}
            onClearDay={handleClearDay}
            showParts={false}
            getTechnicianColor={getTechnicianColor}
            densityStyle={DENSITY_STYLES[density].card}
            gapStyle={DENSITY_STYLES[density].gap}
          />
        ) : (
          <div key={i} className="min-h-20 p-1 border bg-muted/10" />
        )
      );
    }

    return days;
  };

  // Drop zone component for all-day slots in weekly view
  const AllDayDropZone = ({ dayName, dayNumber, children }: { dayName: string; dayNumber: number; children: React.ReactNode }) => {
    const { setNodeRef, isOver } = useDroppable({ id: `allday-${dayName}-${dayNumber}` });

    // Full-cell hit area: the droppable rect must match the grid cell height, not just content height.
    return (
      <div className="border-r w-full relative" style={{ minHeight: 64, height: "100%" }}>
        <div
          ref={setNodeRef}
          className={`absolute inset-0 ${isOver ? "bg-primary/20 border-2 border-primary" : "bg-background"}`}
        />
        <div className="relative h-full p-2">
          {children}
        </div>
      </div>
    );
  };

  // Quarter-hour drop zone (15-min increments) (15-min increments)
  const QuarterDropZone = ({ id }: { id: string }) => {
    const { setNodeRef, isOver } = useDroppable({ id });
    return (
      <div
        ref={setNodeRef}
        className={`h-1/4 w-full pointer-events-none ${isOver ? 'bg-primary/20 border border-primary' : ''}`}
      />
    );
  };

// Drop zone component for hourly slots in weekly view
  const HourlyDropZone = ({ dayName, hour, dayNumber, dayAssignments = [], laneMap }: { dayName: string; hour: number; dayNumber: number; dayAssignments?: any[]; laneMap?: Map<string, { laneIndex: number; totalLanes: number }> }) => {
    const rowHeight = DENSITY_STYLES[density].rowHeight;
    
    // Filter assignments for this specific hour (explicitly check for number to handle hour 0)
    const hourlyAssignments = (dayAssignments || []).filter((a: any) => a.scheduledHour !== null && a.scheduledHour !== undefined && a.scheduledHour === hour);
    
    return (
      <div className={`border-r ${DENSITY_STYLES[density].row} bg-background relative`} style={{ minHeight: `${rowHeight}px` }}>
        <div className="absolute inset-0 flex flex-col pointer-events-none">
          {[0, 15, 30, 45].map((m) => (
            <QuarterDropZone key={m} id={`weekly-${dayName}-${hour}-${m}-${dayNumber}`} />
          ))}
        </div>

        {hourlyAssignments.map((assignment: any) => {
          const client = clients.find((c: any) => c.id === assignment.clientId);
          const lane = laneMap?.get(assignment.id) || { laneIndex: 0, totalLanes: 1 };
          return client ? (
            <ResizableJobCard
              key={assignment.id}
              assignment={assignment}
              client={client}
              rowHeight={rowHeight}
              onResize={handleResize}
              getTechnicianColor={getTechnicianColor}
              densityStyle={DENSITY_STYLES[density].card}
              onClick={() => handleClientClick(client, assignment)}
              isCompleted={assignment.completed}
              isOverdue={!assignment.completed && new Date(assignment.scheduledDate) < new Date()}
              laneIndex={lane.laneIndex}
              totalLanes={lane.totalLanes}
            />
          ) : null;
        })}
      </div>
    );
  };

  const renderWeeklyView = () => {
    // Get week dates based on currentDate (Monday to Sunday)
    const currentWeekStart = getMondayOfWeek(currentDate);

    const startHour = companySettings?.calendarStartHour || 8;
    const weekDaysData: Array<{date: Date; dayNumber: number; monthNumber: number; yearNumber: number; dayAssignments: any[]; dayName: string; laneMap: Map<string, { laneIndex: number; totalLanes: number }>}> = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(currentWeekStart);
      date.setDate(currentWeekStart.getDate() + i);
      const dayNumber = date.getDate();
      const monthNumber = date.getMonth() + 1;
      const yearNumber = date.getFullYear();
      
      // Get assignments for this specific day from the fetched data
      let dayAssignments = assignments.filter((a: any) => 
        a.year === yearNumber && 
        a.month === monthNumber && 
        a.day === dayNumber
      );
      
      // Filter by selected technician
      if (selectedTechnicianId === "unassigned") {
        dayAssignments = dayAssignments.filter((a: any) => !a.assignedTechnicianIds || a.assignedTechnicianIds.length === 0);
      } else if (selectedTechnicianId && selectedTechnicianId !== "all") {
        dayAssignments = dayAssignments.filter((a: any) => 
          a.assignedTechnicianIds && a.assignedTechnicianIds.includes(selectedTechnicianId)
        );
      }
      
      // Calculate lanes for timed assignments (not all-day)
      const timedAssignments = dayAssignments.filter((a: any) => a.scheduledHour !== null && a.scheduledHour !== undefined);
      const laneMap = calculateLanes(timedAssignments);

      weekDaysData.push({
        date,
        dayNumber,
        monthNumber,
        yearNumber,
        dayAssignments,
        dayName: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i],
        laneMap
      });
    }

    const hours = Array.from({ length: 24 }, (_, i) => {
      const h = i;
      const ampm = h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`;
      return { hour: i, display: ampm };
    });

    const gridCols = "grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]";
    
    return (
      <div ref={weeklyScrollContainerRef} className="overflow-y-auto flex-1 min-h-0 max-h-full">
        {/* Header Row - Sticky at top */}
        <div className={`grid ${gridCols} sticky top-0 bg-background z-30 border-b`}>
          <div className="px-1.5 py-2 border-r flex items-center justify-center"></div>
          {weekDaysData.map((d) => {
            const isToday = d.date.toDateString() === new Date().toDateString();
            return (
              <div key={d.dayName} className="px-1 py-2 text-center border-r">
                <span className={`text-sm font-medium ${isToday ? 'bg-primary text-primary-foreground px-2 py-0.5 rounded-full' : ''}`}>
                  {d.dayName} {d.date.getDate()}
                </span>
              </div>
            );
          })}
        </div>

        {/* All Day Slot - Sticky below header */}
        <div
          className={`grid ${gridCols} sticky top-[41px] bg-background z-20 border-b`}
          style={{ height: ALLDAY_ROW_HEIGHTS[density] ?? 84 }}
        >
          <div className="px-1.5 py-1 text-[10px] font-semibold border-r bg-primary/10 flex items-center h-full">
            All Day
          </div>
          {weekDaysData.map((dayData) => {
            const allDayAssignments = dayData.dayAssignments.filter((a: any) => a.scheduledHour === null || a.scheduledHour === undefined);
            const slotKey = `${dayData.dayName}-${dayData.dayNumber}`;
            const isExpanded = expandedAllDaySlots.has(slotKey);
            const visibleAssignments = isExpanded ? allDayAssignments : allDayAssignments.slice(0, 3);
            const hiddenCount = Math.max(0, allDayAssignments.length - 3);
            
            return (
              <AllDayDropZone key={`${dayData.dayName}-allday`} dayName={dayData.dayName} dayNumber={dayData.dayNumber}>
                <div className="p-1">
                  {visibleAssignments.map((assignment: any) => {
                    const client = clients.find((c: any) => c.id === assignment.clientId);
                    const isCompleted = assignment.completed;
                    return client ? (
                      <DraggableClient
                        key={assignment.id}
                        id={assignment.id}
                        client={client}
                        inCalendar
                        onClick={() => handleClientClick(client, assignment)}
                        isCompleted={isCompleted}
                        isOverdue={!isCompleted && new Date(assignment.scheduledDate) < new Date()}
                        assignment={assignment}
                        technicianColor={getTechnicianColor(assignment)}
                        densityStyle={DENSITY_STYLES[density].card}
                      />
                    ) : null;
                  })}
                  {hiddenCount > 0 && !isExpanded && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1 text-[10px] w-full"
                      onClick={() => {
                        setExpandedAllDaySlots(prev => new Set(prev).add(slotKey));
                      }}
                      data-testid={`button-view-all-${dayData.dayName}`}
                    >
                      +{hiddenCount} more
                    </Button>
                  )}
                  {isExpanded && allDayAssignments.length > 3 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1 text-[10px] w-full"
                      onClick={() => {
                        setExpandedAllDaySlots(prev => {
                          const next = new Set(prev);
                          next.delete(slotKey);
                          return next;
                        });
                      }}
                      data-testid={`button-collapse-${dayData.dayName}`}
                    >
                      Show less
                    </Button>
                  )}
                </div>
              </AllDayDropZone>
            );
          })}
        </div>

        {/* Hourly Slots */}
        {hours.map((h) => (
          <div key={h.hour} className={`grid ${gridCols} border-b`}>
            <div className={`px-1.5 py-1 text-[10px] font-medium border-r flex items-center justify-center ${h.hour === startHour ? 'bg-primary/30 font-bold' : 'bg-muted/20'}`}>
              {h.display}
            </div>
            {weekDaysData.map((dayData) => (
              <HourlyDropZone key={`${dayData.dayName}-${h.hour}`} dayName={dayData.dayName} hour={h.hour} dayNumber={dayData.dayNumber} dayAssignments={dayData.dayAssignments} laneMap={dayData.laneMap} />
            ))}
          </div>
        ))}
      </div>
    );
  };

  // Daily View Drop Zone Component with ResizableJobCard support
  const DailyDropZone = ({ technicianId, hour, assignments, laneMap }: { technicianId: string; hour: number; assignments: any[]; laneMap: Map<string, { laneIndex: number; totalLanes: number }> }) => {
    const rowHeight = DENSITY_STYLES[density].rowHeight;
    
    return (
      <div
        className={`border-b border-r relative bg-background`}
        style={{ minHeight: `${rowHeight}px` }}
      >
        <div className="absolute inset-0 flex flex-col pointer-events-none">
          {[0, 15, 30, 45].map((m) => (
            <QuarterDropZone
              key={m}
              id={`daily-${technicianId}-${hour}-${m}-${currentDate.getDate()}-${currentDate.getMonth()}-${currentDate.getFullYear()}`}
            />
          ))}
        </div>

        {assignments.map((assignment: any) => {
          const client = clients.find((c: any) => c.id === assignment.clientId);
          const lane = laneMap.get(assignment.id) || { laneIndex: 0, totalLanes: 1 };
          return client ? (
            <ResizableJobCard
              key={assignment.id}
              assignment={assignment}
              client={client}
              rowHeight={rowHeight}
              onResize={handleResize}
              getTechnicianColor={getTechnicianColor}
              densityStyle={DENSITY_STYLES[density].card}
              onClick={() => handleClientClick(client, assignment)}
              isCompleted={assignment.completed}
              isOverdue={!assignment.completed && new Date(assignment.scheduledDate) < new Date()}
              laneIndex={lane.laneIndex}
              totalLanes={lane.totalLanes}
            />
          ) : null;
        })}
      </div>
    );
  };

  const renderDailyView = () => {
    // Get technicians to show as columns (filter by visibility)
    const visibleTechnicians = technicians.filter((t: any) => !hiddenTechnicianIds.has(t.id));
    const showUnassigned = !hiddenTechnicianIds.has('unassigned');
    
    // Get assignments for current date
    const currentDateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
    const dayAssignments = assignments.filter((a: any) => a.scheduledDate === currentDateStr && !a.completed);
    
    // Generate hours (6 AM to 6 PM by default, but use startHour from settings)
    const dailyStartHour = companySettings?.calendarStartHour ?? 7;
    const hours = Array.from({ length: 24 }, (_, i) => {
      const h = i;
      const ampm = h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`;
      return { hour: i, display: ampm };
    });

    // Calculate current time position
    const now = new Date();
    const isToday = now.toDateString() === currentDate.toDateString();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTimePosition = currentHour + currentMinute / 60;

    // Build columns: Time + Technicians + Unassigned
    const columnCount = visibleTechnicians.length + (showUnassigned ? 1 : 0) + 1; // +1 for time column
    const gridCols = `grid-cols-[3.5rem_repeat(${columnCount - 1},minmax(0,1fr))]`;

    // Get assignments by technician and hour
    const getAssignmentsForSlot = (techId: string | null, hour: number) => {
      return dayAssignments.filter((a: any) => {
        const matchesTech = techId === null 
          ? (!a.assignedTechnicianIds || a.assignedTechnicianIds.length === 0)
          : (a.assignedTechnicianIds && a.assignedTechnicianIds.includes(techId));
        const matchesHour = a.scheduledHour === hour;
        return matchesTech && matchesHour;
      });
    };

    // Get all-day assignments
    const getAllDayAssignments = (techId: string | null) => {
      return dayAssignments.filter((a: any) => {
        const matchesTech = techId === null 
          ? (!a.assignedTechnicianIds || a.assignedTechnicianIds.length === 0)
          : (a.assignedTechnicianIds && a.assignedTechnicianIds.includes(techId));
        const isAllDay = a.scheduledHour === null || a.scheduledHour === undefined;
        return matchesTech && isAllDay;
      });
    };
    
    // Calculate lane maps per technician for timed assignments
    const getLaneMapForTechnician = (techId: string | null) => {
      const techTimedAssignments = dayAssignments.filter((a: any) => {
        const matchesTech = techId === null 
          ? (!a.assignedTechnicianIds || a.assignedTechnicianIds.length === 0)
          : (a.assignedTechnicianIds && a.assignedTechnicianIds.includes(techId));
        return matchesTech && a.scheduledHour !== null && a.scheduledHour !== undefined;
      });
      return calculateLanes(techTimedAssignments);
    };

    return (
      <div className="overflow-y-auto flex-1 min-h-0 max-h-full relative">
        {/* Current time indicator */}
        {isToday && currentTimePosition >= 0 && currentTimePosition < 24 && (
          <div 
            className="absolute left-0 right-0 z-40 pointer-events-none"
            style={{ top: `calc(41px + 28px + ${currentTimePosition * DENSITY_STYLES[density].rowHeight}px)` }}
          >
            <div className="flex items-center">
              <div className="w-2 h-2 rounded-full bg-red-500 -ml-1" />
              <div className="flex-1 h-[2px] bg-red-500" />
            </div>
          </div>
        )}

        {/* Header Row - Technician names */}
        <div className={`grid ${gridCols} sticky top-0 bg-background z-30 border-b`}>
          <div className="px-1.5 py-2 border-r flex items-center justify-center text-xs font-medium text-muted-foreground">
            {format(currentDate, 'EEE d')}
          </div>
          {visibleTechnicians.map((tech: any, index: number) => {
            const color = TECHNICIAN_COLORS[technicians.findIndex((t: any) => t.id === tech.id) % TECHNICIAN_COLORS.length];
            return (
              <div key={tech.id} className="px-2 py-2 text-center border-r">
                <div className="flex items-center justify-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full ${color.dot}`} />
                  <span className="text-sm font-medium truncate">{tech.firstName} {tech.lastName?.[0]}.</span>
                </div>
              </div>
            );
          })}
          {showUnassigned && (
            <div className="px-2 py-2 text-center border-r">
              <span className="text-sm font-medium text-muted-foreground">Unassigned</span>
            </div>
          )}
        </div>

        {/* All Day Row */}
        <div className={`grid ${gridCols} sticky top-[41px] bg-background z-20 border-b`}>
          <div className="px-1.5 py-1 text-[10px] font-semibold border-r bg-primary/10 flex items-center h-full">
            All Day
          </div>
          {visibleTechnicians.map((tech: any) => {
            const techAllDay = getAllDayAssignments(tech.id);
            return (
              <div key={`allday-${tech.id}`} className="p-1 border-r min-h-[28px]">
                {techAllDay.map((assignment: any) => {
                  const client = clients.find((c: any) => c.id === assignment.clientId);
                  return client ? (
                    <DraggableClient
                      key={assignment.id}
                      id={assignment.id}
                      client={client}
                      inCalendar
                      onClick={() => handleClientClick(client, assignment)}
                      isCompleted={assignment.completed}
                      isOverdue={!assignment.completed && new Date(assignment.scheduledDate) < new Date()}
                      assignment={assignment}
                      technicianColor={getTechnicianColor(assignment)}
                      densityStyle={DENSITY_STYLES[density].card}
                    />
                  ) : null;
                })}
              </div>
            );
          })}
          {showUnassigned && (
            <div className="p-1 border-r min-h-[28px]">
              {getAllDayAssignments(null).map((assignment: any) => {
                const client = clients.find((c: any) => c.id === assignment.clientId);
                return client ? (
                  <DraggableClient
                    key={assignment.id}
                    id={assignment.id}
                    client={client}
                    inCalendar
                    onClick={() => handleClientClick(client, assignment)}
                    isCompleted={assignment.completed}
                    isOverdue={!assignment.completed && new Date(assignment.scheduledDate) < new Date()}
                    assignment={assignment}
                    technicianColor={getTechnicianColor(assignment)}
                    densityStyle={DENSITY_STYLES[density].card}
                  />
                ) : null;
              })}
            </div>
          )}
        </div>

        {/* Hourly Slots */}
        {hours.map((h) => (
          <div key={h.hour} className={`grid ${gridCols}`}>
            <div className={`px-1.5 py-1 text-[10px] font-medium border-r border-b flex items-center justify-center ${h.hour === dailyStartHour ? 'bg-primary/30 font-bold' : 'bg-muted/20'}`}>
              {h.display}
            </div>
            {visibleTechnicians.map((tech: any) => {
              const slotAssignments = getAssignmentsForSlot(tech.id, h.hour);
              const techLaneMap = getLaneMapForTechnician(tech.id);
              return (
                <DailyDropZone 
                  key={`daily-${tech.id}-${h.hour}`} 
                  technicianId={tech.id} 
                  hour={h.hour}
                  assignments={slotAssignments}
                  laneMap={techLaneMap}
                />
              );
            })}
            {showUnassigned && (
              <DailyDropZone 
                technicianId="unassigned" 
                hour={h.hour}
                assignments={getAssignmentsForSlot(null, h.hour)}
                laneMap={getLaneMapForTechnician(null)}
              />
            )}
          </div>
        ))}
      </div>
    );
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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={previousMonth}
                data-testid={view === "weekly" ? "button-previous-week" : "button-previous-month"}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <h2 className="text-2xl font-bold">
                {view === "weekly" ? (
                  (() => {
                    const weekStart = getMondayOfWeek(currentDate);
                    const weekEnd = new Date(weekStart);
                    weekEnd.setDate(weekEnd.getDate() + 6);
                    
                    const startMonth = monthNames[weekStart.getMonth()];
                    const endMonth = monthNames[weekEnd.getMonth()];
                    const startDay = weekStart.getDate();
                    const endDay = weekEnd.getDate();
                    const startYear = weekStart.getFullYear();
                    const endYear = weekEnd.getFullYear();
                    
                    if (startYear !== endYear) {
                      return `${startMonth} ${startDay}, ${startYear} - ${endMonth} ${endDay}, ${endYear}`;
                    } else if (startMonth !== endMonth) {
                      return `${startMonth} ${startDay} - ${endMonth} ${endDay}, ${endYear}`;
                    } else {
                      return `${startMonth} ${startDay}-${endDay}, ${endYear}`;
                    }
                  })()
                ) : (
                  `${monthNames[month - 1]} ${year}`
                )}
              </h2>
              <Button
                variant="outline"
                size="icon"
                onClick={nextMonth}
                data-testid={view === "weekly" ? "button-next-week" : "button-next-month"}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                onClick={goToToday}
                data-testid="button-today"
              >
                Today
              </Button>
            </div>

            <div className="flex items-center gap-2">
              {view === "weekly" && (
                <>
                  <Select value={selectedTechnicianId || "all"} onValueChange={setSelectedTechnicianId}>
                    <SelectTrigger className="w-36 text-xs h-8" data-testid="select-technician-filter">
                      <Users className="h-3.5 w-3.5 mr-1.5" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Technicians</SelectItem>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {technicians.map((tech: any) => (
                        <SelectItem key={tech.id} value={tech.id}>
                          {tech.firstName} {tech.lastName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => {
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
                    }}
                    data-testid="button-parts"
                  >
                    <Package className="h-3.5 w-3.5 mr-1.5" />
                    Parts
                  </Button>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Start:</span>
                    <Select 
                      value={String(companySettings?.calendarStartHour || 8)} 
                      onValueChange={(value) => {
                        const newStartHour = parseInt(value, 10);
                        updateCompanySettings.mutate({ calendarStartHour: newStartHour });
                        scrollDoneRef.current = false; // Reset scroll flag to trigger re-scroll
                      }}
                    >
                      <SelectTrigger className="w-20 text-xs h-8" data-testid="select-start-hour">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 24 }, (_, i) => i).map((hour) => (
                          <SelectItem key={hour} value={String(hour)}>
                            {hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
              <Select value={density} onValueChange={(v) => setDensity(v as CalendarDensity)}>
                <SelectTrigger className="w-28 text-xs h-8" data-testid="select-density">
                  <span className="text-muted-foreground mr-1">Density:</span>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="compact">Compact</SelectItem>
                  <SelectItem value="comfortable">Comfortable</SelectItem>
                  <SelectItem value="expanded">Expanded</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex gap-1 bg-muted/50 p-1 rounded-full">
                <Button
                  variant={view === "monthly" ? "default" : "ghost"}
                  size="sm"
                  className={`rounded-full ${view === "monthly" ? "" : "hover:bg-background/60"}`}
                  onClick={() => setView("monthly")}
                  data-testid="button-monthly-view"
                >
                  Monthly
                </Button>
                <Button
                  variant={view === "weekly" ? "default" : "ghost"}
                  size="sm"
                  className={`rounded-full ${view === "weekly" ? "" : "hover:bg-background/60"}`}
                  onClick={() => setView("weekly")}
                  data-testid="button-weekly-view"
                >
                  Weekly
                </Button>
                <Button
                  variant={view === "daily" ? "default" : "ghost"}
                  size="sm"
                  className={`rounded-full ${view === "daily" ? "" : "hover:bg-background/60"}`}
                  onClick={() => setView("daily")}
                  data-testid="button-daily-view"
                >
                  Day
                </Button>
              </div>
            </div>
          </div>

          {/* Technician Filter Chips */}
          {technicians.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap text-xs mt-1.5">
              <span className="text-muted-foreground font-medium text-[11px]">Show:</span>
              {technicians.map((tech: any, index: number) => {
                const color = TECHNICIAN_COLORS[index % TECHNICIAN_COLORS.length];
                const isHidden = hiddenTechnicianIds.has(tech.id);
                return (
                  <button
                    key={tech.id}
                    onClick={() => {
                      setHiddenTechnicianIds(prev => {
                        const next = new Set(prev);
                        if (next.has(tech.id)) {
                          next.delete(tech.id);
                        } else {
                          next.add(tech.id);
                        }
                        return next;
                      });
                    }}
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full border transition-all text-[10px] ${
                      isHidden 
                        ? 'bg-muted/30 border-muted-foreground/20 opacity-50' 
                        : `${color.bg} ${color.border}`
                    }`}
                    data-testid={`chip-technician-${tech.id}`}
                  >
                    <div className={`w-2 h-2 rounded-full ${color.dot}`} />
                    <span className={isHidden ? 'text-muted-foreground' : ''}>{tech.firstName} {tech.lastName?.[0]}.</span>
                  </button>
                );
              })}
              <button
                onClick={() => {
                  setHiddenTechnicianIds(prev => {
                    const next = new Set(prev);
                    if (next.has('unassigned')) {
                      next.delete('unassigned');
                    } else {
                      next.add('unassigned');
                    }
                    return next;
                  });
                }}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full border transition-all text-[10px] ${
                  hiddenTechnicianIds.has('unassigned')
                    ? 'bg-muted/30 border-muted-foreground/20 opacity-50'
                    : 'bg-muted/50 border-muted-foreground/30'
                }`}
                data-testid="chip-technician-unassigned"
              >
                <div className="w-2 h-2 rounded-full bg-muted-foreground/40" />
                <span className={hiddenTechnicianIds.has('unassigned') ? 'text-muted-foreground' : ''}>Unassigned</span>
              </button>
            </div>
          )}

          <div className={`flex gap-2 flex-1 min-h-0 overflow-hidden`}>
            <div className="flex-1 min-w-0 flex flex-col h-full">
              <Card className="h-full flex flex-col">
                <CardContent className="flex-1 overflow-auto p-0">
                  {view === "monthly" && (
                    <div className="h-full flex flex-col">
                      <div className="grid grid-cols-7">
                        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                          <div key={day} className="text-center font-medium text-sm p-2 border bg-muted/5">
                            {day}
                          </div>
                        ))}
                      </div>
                      <div className="grid grid-cols-7 auto-rows-[minmax(6rem,max-content)] content-start">
                        {renderMonthlyView()}
                      </div>
                    </div>
                  )}
                  {view === "weekly" && (
                    <div className="h-full flex flex-col min-h-0 max-h-full">
                      {renderWeeklyView()}
                    </div>
                  )}
                  {view === "daily" && (
                    <div className="h-full flex flex-col min-h-0 max-h-full">
                      {renderDailyView()}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <aside className="w-auto flex-shrink-0 h-full overflow-hidden">
  <UnscheduledJobsSidebar
    collapsed={isUnscheduledMinimized}
    onToggleCollapsed={() => setIsUnscheduledMinimized((v) => !v)}
    items={unscheduledClients}
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
          client={{ companyName: item.companyName, location: item.location, id: item.clientId }}
          onClick={() => setReportDialogClientId(item.clientId)}
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
                {activeClient.companyName || clients.find((c: any) => c.id === activeClient.clientId)?.companyName}
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
    </DndContext>
  );
}
