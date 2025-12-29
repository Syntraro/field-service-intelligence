import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import StatsCard from "@/components/StatsCard";
import MaintenanceSection from "@/components/MaintenanceSection";
import ClientListTable from "@/components/ClientListTable";
import ClientReportDialog from "@/components/ClientReportDialog";
import { JobDetailDialog } from "@/components/JobDetailDialog";
import NewAddClientDialog from "@/components/NewAddClientDialog";
import { AlertCircle, Calendar, CalendarX, CheckCircle, Clock, Package, Settings, Search, Building2, FileText, Download, Users, ChevronDown, AlertTriangle, ArrowRight } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import MaintenanceCard, { MaintenanceItem } from "@/components/MaintenanceCard";
import { Client } from "@/components/ClientListTable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Helper function to parse date string as local date (not UTC)
// This prevents timezone issues where "2025-12-05" becomes December 4th in local time
function parseLocalDate(dateStr: string): Date {
  if (!dateStr) return new Date();
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

// Helper function to calculate next due date based on selected months
function calculateNextDueDate(selectedMonths: number[], inactive: boolean): Date | null {
  if (inactive || selectedMonths.length === 0) {
    return null;
  }
  
  const today = new Date();
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();
  
  if (selectedMonths.includes(currentMonth)) {
    return new Date(currentYear, currentMonth, 15);
  }
  
  let nextMonth = selectedMonths.find(m => m > currentMonth);
  
  if (nextMonth === undefined) {
    nextMonth = selectedMonths[0];
    return new Date(currentYear + 1, nextMonth, 15);
  }
  
  return new Date(currentYear, nextMonth, 15);
}

interface DBClient {
  id: string;
  companyName: string;
  location?: string | null;
  address?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  roofLadderCode?: string | null;
  notes?: string | null;
  selectedMonths: number[];
  inactive: boolean;
  nextDue: string;
}

interface ClientPart {
  id: string;
  partId: string;
  quantity: number;
  part: {
    id: string;
    name: string;
    type: string;
    size: string;
  };
}

export default function Dashboard() {
  const { toast } = useToast();
  const [location, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [addClientDialogOpen, setAddClientDialogOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<{
    overdue: boolean;
    upcoming: boolean;
    thisMonth: boolean;
    unscheduled: boolean;
    completed: boolean;
  }>({
    overdue: false,
    upcoming: false,
    thisMonth: true,
    unscheduled: false,
    completed: true,
  });
  
  const [minimizedSections, setMinimizedSections] = useState<{
    scheduled: boolean;
    thisMonthAll: boolean;
    completed: boolean;
  }>({
    scheduled: false,
    thisMonthAll: true,
    completed: true,
  });
  const [reportDialogClientId, setReportDialogClientId] = useState<string | null>(null);
  const [jobDialogOpen, setJobDialogOpen] = useState(false);
  const [selectedJobClient, setSelectedJobClient] = useState<any>(null);
  const [selectedJobAssignment, setSelectedJobAssignment] = useState<any>(null);
  
  const overdueRef = useRef<HTMLDivElement>(null);
  const thisMonthRef = useRef<HTMLDivElement>(null);
  const completedRef = useRef<HTMLDivElement>(null);

  // Derive activeTab directly from URL search params - no separate state
  const searchString = useSearch();
  const activeTab = useMemo(() => {
    const params = new URLSearchParams(searchString);
    return params.get('tab') === 'clients' ? 'clients' : 'schedule';
  }, [searchString]);

  const handleTabChange = (value: string) => {
    if (value === 'clients') {
      setLocation('/?tab=clients');
    } else {
      setLocation('/');
    }
  };

  const { data: clientsResponse, isLoading } = useQuery<{ data: DBClient[], pagination: any }>({
    queryKey: ["/api/clients"],
  });

  const dbClients = clientsResponse?.data || [];

  const { data: recentlyCompleted = [] } = useQuery<MaintenanceItem[]>({
    queryKey: ["/api/maintenance/recently-completed"],
  });

  // Fetch current month's calendar assignments to check who's scheduled
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1; // 1-indexed for API
  
  const { data: calendarData, isLoading: isCalendarLoading } = useQuery<{ assignments: any[]; clients: any[] }>({
    queryKey: ["/api/calendar", currentYear, currentMonth],
    queryFn: async () => {
      const res = await fetch(`/api/calendar?year=${currentYear}&month=${currentMonth}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error("Failed to fetch calendar data");
      return res.json();
    },
  });

  // Fetch overdue PMs from past months (persistent overdue)
  const { data: overdueFromPast = [] } = useQuery<{ assignment: any; client: any }[]>({
    queryKey: ["/api/calendar/overdue"],
    queryFn: async () => {
      const res = await fetch('/api/calendar/overdue', {
        credentials: 'include',
      });
      if (!res.ok) throw new Error("Failed to fetch overdue assignments");
      return res.json();
    },
  });

  // Fetch previous month's calendar to check for missing assignments
  const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
  const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;
  
  const { data: prevMonthCalendarData } = useQuery<{ assignments: any[]; clients: any[] }>({
    queryKey: ["/api/calendar", prevYear, prevMonth],
    queryFn: async () => {
      const res = await fetch(`/api/calendar?year=${prevYear}&month=${prevMonth}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error("Failed to fetch previous month calendar");
      return res.json();
    },
  });


  const { data: clientParts = {} } = useQuery<Record<string, ClientPart[]>>({
    queryKey: ["/api/client-parts/bulk"],
    staleTime: 60 * 1000, // Cache for 60 seconds
  });

  const { data: completionStatuses = {} } = useQuery<Record<string, { completed: boolean; completedDueDate?: string }>>({
    queryKey: ["/api/maintenance/statuses"],
    staleTime: 60 * 1000, // Cache for 60 seconds
  });

  // Listen for sidebar events
  useEffect(() => {
    const handleAddClient = () => setAddClientDialogOpen(true);
    const handleOpenClient = (e: Event) => {
      const customEvent = e as CustomEvent;
      handleSelectClient(customEvent.detail.clientId);
    };

    window.addEventListener('openAddClientDialog', handleAddClient);
    window.addEventListener('openClientDialog', handleOpenClient);

    return () => {
      window.removeEventListener('openAddClientDialog', handleAddClient);
      window.removeEventListener('openClientDialog', handleOpenClient);
    };
  }, []);

  const deleteClientMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/clients/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/parts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/schedule"] });
      toast({
        title: "Client deleted",
        description: "The client has been deleted successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete client.",
        variant: "destructive",
      });
    },
  });

  const clients: Client[] = dbClients
    .map(c => ({
      id: c.id,
      companyName: c.companyName,
      location: c.location,
      address: c.address,
      city: c.city,
      province: c.province,
      postalCode: c.postalCode,
      contactName: c.contactName,
      email: c.email,
      phone: c.phone,
      roofLadderCode: c.roofLadderCode,
      notes: c.notes,
      selectedMonths: c.selectedMonths,
      inactive: c.inactive,
      nextDue: new Date(c.nextDue),
    }))
    .sort((a, b) => a.companyName.localeCompare(b.companyName));
  
  // Filter clients for autocomplete (only when 3+ characters)
  const searchMatches = searchQuery.trim().length >= 3
    ? clients.filter(client => {
        const query = searchQuery.toLowerCase();
        return (
          (client.companyName || "").toLowerCase().includes(query) ||
          (client.location || "").toLowerCase().includes(query) ||
          (client.contactName || "").toLowerCase().includes(query) ||
          (client.address || "").toLowerCase().includes(query) ||
          (client.city || "").toLowerCase().includes(query) ||
          (client.province || "").toLowerCase().includes(query)
        );
      })
    : [];
  
  const handleSelectClient = (clientId: string) => {
    setSearchQuery("");
    setSearchOpen(false);
    // Navigate to client detail page
    setLocation(`/clients/${clientId}`);
  };

  // Handle clicking on a PM to open job dialog
  const handleOpenJobDialog = (clientId: string) => {
    // Extract actual client ID if it's a composite ID (format: clientId|date or clientId|year-month-day)
    const actualClientId = clientId.includes('|') ? clientId.split('|')[0] : clientId;
    
    // Find the client
    const client = clients.find(c => c.id === actualClientId);
    if (!client) return;
    
    // Find the assignment for this client - check current month first
    let assignment = calendarData?.assignments.find((a: any) => a.clientId === actualClientId);
    
    // If not found in current month, check overdue assignments from past months
    if (!assignment) {
      const overdueItem = overdueFromPast.find(item => item.client.id === actualClientId);
      if (overdueItem) {
        assignment = overdueItem.assignment;
      }
    }
    
    setSelectedJobClient(client);
    setSelectedJobAssignment(assignment || null);
    setJobDialogOpen(true);
  };

  // Mutation for assigning technicians
  const assignTechniciansMutation = useMutation({
    mutationFn: async ({ assignmentId, technicianIds }: { assignmentId: string; technicianIds: string[] }) => {
      return apiRequest("PATCH", `/api/calendar/assign/${assignmentId}`, {
        assignedTechnicianIds: technicianIds
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      toast({
        title: "Updated",
        description: "Technicians assigned successfully",
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

  // Helper to check if client has PM scheduled for current month
  const hasCurrentMonthPM = (selectedMonths: number[]): boolean => {
    const today = new Date();
    const currentMonth = today.getMonth(); // 0-11
    return selectedMonths.includes(currentMonth);
  };

  // Helper to determine if an item is overdue
  const isOverdue = (nextDue: Date, selectedMonths: number[]): boolean => {
    const today = new Date();
    const currentMonth = today.getMonth();
    
    // Only consider overdue if current month is in their scheduled months
    if (!selectedMonths.includes(currentMonth)) {
      return false;
    }
    
    // Already past due date
    if (nextDue < today) {
      return true;
    }
    
    // Check if due this month and we're within 7 days of month end
    if (nextDue.getMonth() === currentMonth && nextDue.getFullYear() === today.getFullYear()) {
      const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      const daysUntilMonthEnd = Math.ceil((lastDayOfMonth.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      return daysUntilMonthEnd <= 7;
    }
    
    return false;
  };

  // Wait for calendar data to load
  if (isLoading || isCalendarLoading || !calendarData) {
    return (
      <div className="min-h-screen bg-background">
        <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
          <div className="text-center py-8">Loading dashboard...</div>
        </main>
      </div>
    );
  }

  // Get scheduled client IDs and their scheduled dates for current month
  // Only include assignments that have a day set (not unscheduled)
  const scheduledAssignments = calendarData.assignments.filter((a: any) => a.day != null);
  
  const scheduledClientIds = new Set(
    scheduledAssignments.map((a: any) => a.clientId)
  );
  
  // Map of clientId -> scheduledDate from calendar assignments (only scheduled ones)
  // Use parseLocalDate to avoid timezone issues where UTC dates shift to previous day
  const clientScheduledDates = new Map(
    scheduledAssignments.map((a: any) => [a.clientId, parseLocalDate(a.scheduledDate)])
  );

  // Clients with PM this month
  const clientsWithCurrentMonthPM = clients.filter(c => !c.inactive && hasCurrentMonthPM(c.selectedMonths));

  // SCHEDULED clients only (for overdue/upcoming calculations)
  // Use calendar scheduled date for overdue determination, not nextDue
  const scheduledMaintenanceItems: MaintenanceItem[] = clientsWithCurrentMonthPM
    .filter(c => scheduledClientIds.has(c.id))
    .map(c => {
      const scheduledDate = clientScheduledDates.get(c.id) || c.nextDue;
      const today = new Date();
      const isOverdueNow = scheduledDate < today;
      
      return {
        id: c.id,
        companyName: c.companyName,
        location: c.location,
        selectedMonths: c.selectedMonths,
        nextDue: scheduledDate, // Use calendar scheduled date instead of client nextDue
        status: (isOverdueNow ? "overdue" : "upcoming") as "overdue" | "upcoming",
      };
    })
    .sort((a, b) => a.companyName.localeCompare(b.companyName));

  // ALL maintenance items for this month (excluding completed)
  const allMaintenanceItems: MaintenanceItem[] = clientsWithCurrentMonthPM
    .filter(c => !completionStatuses[c.id]?.completed)
    .map(c => ({
      id: c.id,
      companyName: c.companyName,
      location: c.location,
      selectedMonths: c.selectedMonths,
      nextDue: c.nextDue,
      status: (isOverdue(c.nextDue, c.selectedMonths) ? "overdue" : "upcoming") as "overdue" | "upcoming",
    }))
    .sort((a, b) => a.companyName.localeCompare(b.companyName));

  // Unscheduled: have PM this month but not on calendar - exclude completed items
  const unscheduledItems: MaintenanceItem[] = clientsWithCurrentMonthPM
    .filter(c => !scheduledClientIds.has(c.id) && !completionStatuses[c.id]?.completed)
    .map(c => ({
      id: c.id,
      companyName: c.companyName,
      location: c.location,
      selectedMonths: c.selectedMonths,
      nextDue: c.nextDue,
      status: (isOverdue(c.nextDue, c.selectedMonths) ? "overdue" : "upcoming") as "overdue" | "upcoming",
    }))
    .sort((a, b) => a.companyName.localeCompare(b.companyName));

  // Convert past months' overdue assignments to MaintenanceItem format
  // Filter out any with missing client data, completed assignments, unscheduled items, or rescheduled to future dates
  const pastMonthOverdueItems: MaintenanceItem[] = overdueFromPast
    .filter(({ assignment, client }) => {
      if (!client || !client.id || assignment.completed || client.inactive) {
        return false;
      }
      // Exclude unscheduled items (day is null)
      if (assignment.day == null) {
        return false;
      }
      // Check if the assignment has been rescheduled to a future date
      // Use parseLocalDate to avoid timezone issues
      const scheduledDate = parseLocalDate(assignment.scheduledDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      // Only include if still actually overdue (scheduled date is in the past)
      return scheduledDate < today;
    })
    .map(({ assignment, client }) => ({
      id: `${client.id}|${assignment.year}-${String(assignment.month).padStart(2, '0')}-15`,
      companyName: client.companyName || 'Unknown',
      location: client.location,
      selectedMonths: client.selectedMonths || [],
      nextDue: parseLocalDate(assignment.scheduledDate),
      status: "overdue" as const,
      assignmentId: assignment.id,
      originalMonth: assignment.month,
      originalYear: assignment.year,
    }));

  // Past months' UNSCHEDULED items - these need attention
  // 1. Items with calendar entry but day is null (from overdueFromPast)
  const existingUnscheduledFromPast = overdueFromPast
    .filter(({ assignment, client }) => {
      if (!client || !client.id || assignment.completed || client.inactive) {
        return false;
      }
      return assignment.day == null;
    })
    .map(({ assignment, client }) => ({
      assignmentId: assignment.id,
      clientId: client.id,
      companyName: client.companyName || 'Unknown',
      location: client.location,
      originalMonth: assignment.month,
      originalYear: assignment.year,
      hasAssignment: true,
    }));

  // 2. Clients with previous month in selectedMonths but NO calendar entry at all
  // AND not already scheduled for the current month
  const prevMonthAssignedClientIds = new Set(
    (prevMonthCalendarData?.assignments || []).map((a: any) => a.clientId)
  );
  
  const currentMonthAssignedClientIds = new Set(
    (calendarData?.assignments || []).map((a: any) => a.clientId)
  );
  
  const missingPrevMonthPMs = clients
    .filter(c => {
      if (c.inactive) return false;
      if (!c.selectedMonths.includes(prevMonth)) return false;
      if (prevMonthAssignedClientIds.has(c.id)) return false; // Already has Nov entry
      if (currentMonthAssignedClientIds.has(c.id)) return false; // Already scheduled for Dec
      if (completionStatuses[c.id]?.completed) return false;
      return true;
    })
    .map(c => ({
      assignmentId: null,
      clientId: c.id,
      companyName: c.companyName || 'Unknown',
      location: c.location,
      originalMonth: prevMonth,
      originalYear: prevYear,
      hasAssignment: false,
    }));

  // Combine both sources
  const pastUnscheduledItems = [...existingUnscheduledFromPast, ...missingPrevMonthPMs];

  // Overdue/upcoming only from SCHEDULED clients - exclude completed items
  // Combine current month overdue with persistent overdue from past months
  const currentMonthOverdueItems = scheduledMaintenanceItems
    .filter(item => item.status === "overdue" && !completionStatuses[item.id]?.completed);
  
  const overdueItems = [...pastMonthOverdueItems, ...currentMonthOverdueItems];
  
  const thisMonthItems = scheduledMaintenanceItems
    .filter(item => {
      const monthFromNow = new Date();
      monthFromNow.setMonth(monthFromNow.getMonth() + 1);
      return item.nextDue <= monthFromNow && item.status !== "overdue" && !completionStatuses[item.id]?.completed;
    });
  

  const completedCount = recentlyCompleted.length;
  
  const activeClientsCount = clients.filter(c => !c.inactive).length;
  
  // Count completed PMs for this month
  const completedThisMonth = clientsWithCurrentMonthPM.filter(c => completionStatuses[c.id]?.completed).length;
  
  // Total PMs this month (completed + not completed)
  const totalPMsThisMonth = clientsWithCurrentMonthPM.length;
  
  const totalActiveScheduled = allMaintenanceItems.length; // Count ALL with PM this month (excluding completed)
  
  const topOverdueClients = overdueItems
    .sort((a, b) => a.nextDue.getTime() - b.nextDue.getTime());
  
  const upcomingNextWeek = scheduledMaintenanceItems
    .filter(item => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const weekFromNow = new Date();
      weekFromNow.setDate(weekFromNow.getDate() + 7);
      weekFromNow.setHours(23, 59, 59, 999);
      return item.nextDue >= today && item.nextDue <= weekFromNow && item.status !== "overdue" && !completionStatuses[item.id]?.completed;
    })
    .sort((a, b) => a.nextDue.getTime() - b.nextDue.getTime());
  
  const scrollToSection = (ref: React.RefObject<HTMLDivElement>) => {
    if (activeTab !== 'schedule') {
      setLocation('/');
      setTimeout(() => {
        ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } else {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleEditClient = async (id: string) => {
    // Extract clientId from composite ID if needed (for recently completed items)
    const clientId = id.includes('|') ? id.split('|')[0] : id;
    // Navigate to new client detail page
    setLocation(`/clients/${clientId}`);
  };

  const handleDeleteClient = async (id: string) => {
    await deleteClientMutation.mutateAsync(id);
  };

  const handleMarkComplete = async (id: string) => {
    try {
      // Check if this is a recently completed item (composite ID format: clientId|dueDate)
      let clientId: string;
      let dueDateToSend: string;
      
      if (id.includes('|')) {
        // Recently completed item - extract clientId and dueDate
        const [cId, dueDate] = id.split('|');
        clientId = cId;
        dueDateToSend = dueDate;
      } else {
        // Regular item - find the client
        const client = clients.find(c => c.id === id);
        if (!client) {
          toast({
            title: "Error",
            description: "Client not found.",
            variant: "destructive",
          });
          return;
        }
        clientId = id;
        
        // Determine which dueDate to send
        const status = completionStatuses[id];
        dueDateToSend = status?.completed && status.completedDueDate
          ? status.completedDueDate  // Reopening: use the completed dueDate
          : client.nextDue.toISOString();  // Completing: use current nextDue
      }
      
      const res = await apiRequest("POST", `/api/maintenance/${clientId}/toggle`, {
        dueDate: dueDateToSend
      });
      const data = await res.json();
      
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance/recently-completed"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/schedule"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance/statuses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/overdue"] });
      
      if (data.completed) {
        toast({
          title: "Maintenance completed",
          description: "The maintenance has been marked as complete.",
        });
      } else {
        toast({
          title: "Maintenance reopened",
          description: "The maintenance has been marked as uncompleted.",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update maintenance status.",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4">

        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
          <TabsContent value="schedule" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <StatsCard 
                title="Overdue" 
                value={overdueItems.length} 
                icon={AlertCircle} 
                variant="danger"
                subtitle="needs attention"
                onClick={() => scrollToSection(overdueRef)}
              />
              <StatsCard 
                title="Upcoming This Week" 
                value={upcomingNextWeek.length} 
                icon={Clock} 
                variant="warning"
                subtitle="next 7 days"
                onClick={() => scrollToSection(thisMonthRef)}
              />
              <StatsCard 
                title="Due This Month" 
                value={totalPMsThisMonth} 
                completedValue={completedThisMonth}
                icon={Calendar} 
                variant="default"
                subtitle="completed"
                onClick={() => scrollToSection(thisMonthRef)}
              />
              <StatsCard 
                title="Unscheduled" 
                value={unscheduledItems.length} 
                icon={CalendarX} 
                variant="neutral"
                subtitle="not on calendar"
                onClick={() => setLocation('/calendar')}
              />
            </div>

            <div className="space-y-4">
              {/* Scheduled Maintenance */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-medium">Scheduled Maintenance</CardTitle>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      data-testid="button-minimize-scheduled"
                      onClick={() => setMinimizedSections(prev => ({ ...prev, scheduled: !prev.scheduled }))}
                    >
                      <ChevronDown className={`h-4 w-4 transition-transform ${minimizedSections.scheduled ? 'rotate-180' : ''}`} />
                    </Button>
                  </div>
                </CardHeader>
                {!minimizedSections.scheduled && (
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Overdue */}
                      <div ref={overdueRef}>
                        <div className="flex items-center gap-2 mb-3">
                          <AlertCircle className="h-4 w-4 text-destructive" />
                          <h3 className="text-sm font-medium">Overdue</h3>
                        </div>
                        {overdueItems.length > 0 ? (
                          <>
                            <div className="space-y-2">
                              {(expandedSections.overdue ? overdueItems : overdueItems.slice(0, 7)).map((item) => (
                                <MaintenanceCard
                                  key={item.id}
                                  item={item}
                                  onMarkComplete={handleMarkComplete}
                                  onEdit={handleEditClient}
                                  onViewReport={handleOpenJobDialog}
                                  parts={clientParts[item.id] || []}
                                  isCompleted={completionStatuses[item.id]?.completed || false}
                                  isScheduled={true}
                                  isThisMonthPM={true}
                                />
                              ))}
                            </div>
                            {overdueItems.length > 7 && (
                              <Button 
                                variant="ghost" 
                                className="w-full mt-2" 
                                size="sm"
                                data-testid="button-view-all-overdue"
                                onClick={() => setExpandedSections(prev => ({ ...prev, overdue: !prev.overdue }))}
                              >
                                {expandedSections.overdue ? 'Show Less' : `View All (${overdueItems.length})`}
                              </Button>
                            )}
                          </>
                        ) : (
                          <div className="text-center py-8 text-muted-foreground text-sm">
                            No overdue maintenance
                          </div>
                        )}
                      </div>

                      {/* Upcoming */}
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <Clock className="h-4 w-4 text-status-upcoming" />
                          <h3 className="text-sm font-medium">Upcoming</h3>
                        </div>
                        {upcomingNextWeek.length > 0 ? (
                          <>
                            <div className="space-y-2">
                              {(expandedSections.upcoming ? upcomingNextWeek : upcomingNextWeek.slice(0, 7)).map((item) => (
                                <MaintenanceCard
                                  key={item.id}
                                  item={item}
                                  onMarkComplete={handleMarkComplete}
                                  onEdit={handleEditClient}
                                  onViewReport={handleOpenJobDialog}
                                  parts={clientParts[item.id] || []}
                                  isCompleted={completionStatuses[item.id]?.completed || false}
                                  isScheduled={true}
                                  isThisMonthPM={true}
                                />
                              ))}
                            </div>
                            {upcomingNextWeek.length > 7 && (
                              <Button 
                                variant="ghost" 
                                className="w-full mt-2" 
                                size="sm"
                                data-testid="button-view-all-upcoming"
                                onClick={() => setExpandedSections(prev => ({ ...prev, upcoming: !prev.upcoming }))}
                              >
                                {expandedSections.upcoming ? 'Show Less' : `View All (${upcomingNextWeek.length})`}
                              </Button>
                            )}
                          </>
                        ) : (
                          <div className="text-center py-8 text-muted-foreground text-sm">
                            No upcoming maintenance
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                )}
              </Card>

              {/* This Month's Maintenance */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-medium">
                      This Month's Maintenance <span className="text-sm text-muted-foreground">(Pending)</span>
                    </CardTitle>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      data-testid="button-minimize-thismonthall"
                      onClick={() => setMinimizedSections(prev => ({ ...prev, thisMonthAll: !prev.thisMonthAll }))}
                    >
                      <ChevronDown className={`h-4 w-4 transition-transform ${minimizedSections.thisMonthAll ? 'rotate-180' : ''}`} />
                    </Button>
                  </div>
                </CardHeader>
                {!minimizedSections.thisMonthAll && (
                  <CardContent>
                    <div ref={thisMonthRef}>
                      {allMaintenanceItems.length > 0 ? (
                        <>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {(expandedSections.thisMonth ? allMaintenanceItems : allMaintenanceItems.slice(0, 6)).map((item) => (
                              <MaintenanceCard
                                key={item.id}
                                item={item}
                                onMarkComplete={handleMarkComplete}
                                onEdit={handleEditClient}
                                onViewReport={handleOpenJobDialog}
                                parts={clientParts[item.id] || []}
                                isCompleted={completionStatuses[item.id]?.completed || false}
                                isScheduled={scheduledClientIds.has(item.id)}
                                isThisMonthPM={true}
                              />
                            ))}
                          </div>
                          {allMaintenanceItems.length > 6 && (
                            <Button 
                              variant="ghost" 
                              className="w-full mt-3" 
                              size="sm"
                              data-testid="button-view-all-thismonth"
                              onClick={() => setExpandedSections(prev => ({ ...prev, thisMonth: !prev.thisMonth }))}
                            >
                              {expandedSections.thisMonth ? 'Show Less' : `View All (${allMaintenanceItems.length})`}
                            </Button>
                          )}
                        </>
                      ) : (
                        <div className="text-center py-8 text-muted-foreground text-sm">
                          No maintenance due this month
                        </div>
                      )}
                    </div>
                  </CardContent>
                )}
              </Card>

              {/* Completed */}
              {recentlyCompleted.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base font-medium">
                        This Month's Maintenance <span className="text-sm text-muted-foreground">(Completed)</span>
                      </CardTitle>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        data-testid="button-minimize-completed"
                        onClick={() => setMinimizedSections(prev => ({ ...prev, completed: !prev.completed }))}
                      >
                        <ChevronDown className={`h-4 w-4 transition-transform ${minimizedSections.completed ? 'rotate-180' : ''}`} />
                      </Button>
                    </div>
                  </CardHeader>
                  {!minimizedSections.completed && (
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {(expandedSections.completed ? recentlyCompleted : recentlyCompleted.slice(0, 6)).map((item) => (
                          <MaintenanceCard
                            key={item.id}
                            item={item}
                            onMarkComplete={handleMarkComplete}
                            onEdit={handleEditClient}
                            onViewReport={handleOpenJobDialog}
                            parts={clientParts[item.id] || []}
                            isCompleted={true}
                            isScheduled={true}
                            isThisMonthPM={true}
                          />
                        ))}
                      </div>
                      {recentlyCompleted.length > 6 && (
                        <Button 
                          variant="ghost" 
                          className="w-full mt-2" 
                          size="sm"
                          data-testid="button-view-all-completed"
                          onClick={() => setExpandedSections(prev => ({ ...prev, completed: !prev.completed }))}
                        >
                          {expandedSections.completed ? 'Show Less' : `View All (${recentlyCompleted.length})`}
                        </Button>
                      )}
                    </CardContent>
                  )}
                </Card>
              )}
            </div>
          </TabsContent>

          <TabsContent value="clients">
            <ClientListTable 
              clients={clients} 
              onEdit={handleEditClient} 
              onDelete={handleDeleteClient}
              onRefresh={() => queryClient.invalidateQueries({ queryKey: ["/api/clients"] })}
            />
          </TabsContent>
        </Tabs>
      </main>

      <ClientReportDialog 
        clientId={reportDialogClientId}
        open={!!reportDialogClientId}
        onOpenChange={(open) => !open && setReportDialogClientId(null)}
      />

      <JobDetailDialog
        open={jobDialogOpen}
        onOpenChange={(open) => {
          setJobDialogOpen(open);
          if (!open) {
            setSelectedJobClient(null);
            setSelectedJobAssignment(null);
          }
        }}
        client={selectedJobClient}
        assignment={selectedJobAssignment}
        onAssignTechnicians={(assignmentId: string, technicianIds: string[]) => {
          assignTechniciansMutation.mutate({ assignmentId, technicianIds });
        }}
        bulkParts={clientParts}
      />

      <NewAddClientDialog 
        open={addClientDialogOpen}
        onOpenChange={setAddClientDialogOpen}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['/api/clients'] });
        }}
      />
    </div>
  );
}