import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";
import { useJobVisits } from "@/hooks/useJobVisits";
import { useUnscheduleVisit } from "@/hooks/useSchedulingApi";
import { useRoute, useLocation, Link, useSearch } from "wouter";
import { format } from "date-fns";
import { queryClient, apiRequest, isApiError } from "@/lib/queryClient";
import { getMemberDisplayName } from "@/lib/displayName";
import { useToast } from "@/hooks/use-toast";
import { useActivityStore } from "@/lib/activityStore";
import {
  ArrowLeft,
  Pencil,
  Trash2,
  Loader2,
  Calendar,
  Clock,
  AlertTriangle,
  AlertCircle,
  DollarSign,
  Repeat,
  ChevronRight,
  ChevronDown,
  Plus,
  Lock,
  CalendarPlus,
  CalendarMinus,
  FileText,
  PauseCircle,
  Play,
  Briefcase,
  Receipt,
  Pause,
  Copy,
  PenTool,
  Download,
  Printer,
  MoreHorizontal,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import JobEquipmentSection from "@/components/JobEquipmentSection";
import { AddVisitDialog } from "@/components/AddVisitDialog";
import { EditVisitModal } from "@/components/visits/EditVisitModal";
import JobNotesSection from "@/components/JobNotesSection";
import { PartsBillingCard } from "@/components/PartsBillingCard";
import { QuickAddJobDialog } from "@/components/QuickAddJobDialog";
import { JobHeaderCard } from "@/components/JobHeaderCard";
// JobAssignmentsCard + JobMetaCard replaced by unified top-section layout
import { ActionRequiredModal, getHoldReasonLabel } from "@/components/ActionRequiredModal";
import { JobStatusTimeline } from "@/components/job/JobStatusTimeline";
import { StatusProgressBar, getJobStatusDisplay, getPriorityDisplay, SchedulingHistory } from "@/components/job";
import { AddTimeEntryModal, EditTimeEntryModal, type TimeEntryForEdit } from "@/components/time";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { isVisitActioned, isVisitEmpty } from "@/lib/visitUtils";
import { useAuth } from "@/lib/auth";
import type { Job, Client, CustomerCompany, User as UserType, RecurringJobSeries, Invoice, JobTimeSummary, TimeEntryType } from "@shared/schema";
import { useJobHeader } from "@/hooks/useJobsFeed";
import type { JobHeaderDetail } from "@/hooks/useJobsFeed";

// ============================================================================
// PERMISSION HELPERS - Role-based action availability
// ============================================================================
// Manager roles can perform all office actions
// Technicians have limited permissions (view only for most office actions)
const MANAGER_ROLES = ["owner", "admin", "manager", "dispatcher"] as const;

// ============================================================================
// OFFICE ACTIONS STRIP - Jobber-style attention banner
// ============================================================================
// Shows when job is in a "Needs Attention" state:
// - requires_invoicing: status='completed'
// - on_hold: status='open' AND openSubStatus='on_hold'
// - overdue: status='open' AND effectiveEnd < now
// ============================================================================

type AttentionReason = 'requires_invoicing' | 'on_hold' | 'overdue' | null;

function getAttentionReason(job: {
  status: string;
  openSubStatus?: string | null;
  scheduledStart?: Date | string | null;
  scheduledEnd?: Date | string | null;
  durationMinutes?: number | null;
}): AttentionReason {
  // Priority order: requires_invoicing > on_hold > overdue

  // 1. Completed but not invoiced
  if (job.status === 'completed') {
    return 'requires_invoicing';
  }

  // Only check further if status is 'open'
  if (job.status !== 'open') {
    return null;
  }

  // 2. On hold
  if (job.openSubStatus === 'on_hold') {
    return 'on_hold';
  }

  // 3. Overdue - matches server/storage/dashboard.ts getNeedsAttentionJobs()
  // Server SQL: CASE
  //   WHEN scheduled_end IS NOT NULL THEN scheduled_end
  //   WHEN duration_minutes IS NOT NULL THEN scheduled_start + duration_minutes
  //   ELSE scheduled_start
  // END < todayStart (midnight UTC)
  if (job.scheduledStart) {
    // Match server: compare against midnight UTC of today, not current moment
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const scheduledStart = new Date(job.scheduledStart);

    // Compute effectiveEnd matching server logic exactly
    let effectiveEnd: Date;
    if (job.scheduledEnd != null) {
      // Server: WHEN scheduled_end IS NOT NULL
      effectiveEnd = new Date(job.scheduledEnd);
    } else if (job.durationMinutes != null) {
      // Server: WHEN duration_minutes IS NOT NULL (includes 0)
      effectiveEnd = new Date(scheduledStart.getTime() + job.durationMinutes * 60 * 1000);
    } else {
      // Server: ELSE scheduled_start
      effectiveEnd = scheduledStart;
    }

    // Server: effectiveEnd < todayStart (job should have finished before today started)
    if (effectiveEnd < todayStart) {
      return 'overdue';
    }
  }

  return null;
}

// ============================================================================
// ATTENTION CONFIG - Jobber-style action buttons per attention reason
// ============================================================================
// Rules:
// A) requires_invoicing: Primary="Schedule another visit", Secondary="Mark Invoiced" (with confirm)
// B) on_hold: Primary="Schedule another visit", Secondary="Resume" (clears hold)
// C) overdue: Primary="Reschedule", Secondary="Unschedule"
//
// IMPORTANT: No path should archive jobs from on_hold or overdue.
// requires_invoicing -> invoiced (not archived) unless explicitly chosen elsewhere.
// ============================================================================
const ATTENTION_CONFIG: Record<Exclude<AttentionReason, null>, {
  label: string;
  badgeClass: string;
  icon: React.ElementType;
  primaryAction: string;
  primaryIcon: React.ElementType;
  secondaryAction: string;
  secondaryIcon: React.ElementType;
  requiresConfirm: boolean; // Whether secondary action needs confirmation dialog
}> = {
  // Phase: List Screens Cleanup — single "Create Invoice" CTA replaces old dual-button layout
  requires_invoicing: {
    label: 'Requires Invoicing',
    badgeClass: 'bg-[rgba(245,158,11,0.14)] text-[#92400E] border border-[rgba(245,158,11,0.28)] dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800',
    icon: FileText,
    primaryAction: 'Create Invoice',
    primaryIcon: Receipt,
    secondaryAction: '',
    secondaryIcon: Receipt,
    requiresConfirm: false,
  },
  // Rationalized: unique action only — Schedule Visit is always in the action bar
  on_hold: {
    label: 'On Hold',
    badgeClass: 'bg-[rgba(245,158,11,0.14)] text-[#92400E] border border-[rgba(245,158,11,0.28)] dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800',
    icon: PauseCircle,
    primaryAction: 'Resume',
    primaryIcon: Play,
    secondaryAction: '',
    secondaryIcon: Play,
    requiresConfirm: false,
  },
  // Rationalized: unique action only — Schedule Visit is always in the action bar
  overdue: {
    label: 'Overdue',
    badgeClass: 'bg-[rgba(220,38,38,0.12)] text-[#B91C1C] border border-[rgba(220,38,38,0.25)] dark:bg-red-950/40 dark:text-red-400 dark:border-red-800',
    icon: AlertCircle,
    primaryAction: 'Unschedule',
    primaryIcon: CalendarMinus,
    secondaryAction: '',
    secondaryIcon: CalendarMinus,
    requiresConfirm: false,
  },
};

// OfficeActionsStrip removed — replaced by inline attention indicator in action row

// Phase 4 Step A7: Use canonical JobHeaderDetail type for main job data.
// The canonical getJobHeader now correctly joins customerCompanies,
// fixing the location name mismatch between list and detail views.
interface JobDetailResponse extends JobHeaderDetail {
  technicians?: UserType[];
  recurringSeries?: RecurringJobSeries;
}

// Helper to format minutes as hours and minutes
function formatMinutes(minutes: number): string {
  if (minutes === 0) return "0m";
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs === 0) return `${mins}m`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

// Get running status display text
function getRunningStatusText(runningType: TimeEntryType | null): string {
  if (!runningType) return "";
  switch (runningType) {
    case "travel_to_job":
    case "travel_between_jobs":
      return "Technician en route";
    case "on_site":
      return "Technician on site";
    case "travel_to_supplier":
    case "supplier_run":
      return "At supplier";
    default:
      return "Timer running";
  }
}

// Time Entry type for display
interface TimeEntryDisplay {
  id: string;
  technicianId: string;
  technicianName: string | null;
  type: TimeEntryType;
  startAt: string;
  endAt: string | null;
  durationMinutes: number | null;
  billable: boolean;
  notes: string | null;
  invoiceId: string | null;
  invoicedAt: string | null;
  lockedAt: string | null;
  lockedByInvoiceId: string | null;
  lockReason: string | null;
}

// Format time entry type for display
function formatTimeEntryType(type: TimeEntryType): string {
  const typeLabels: Record<TimeEntryType, string> = {
    travel_to_job: "Travel",
    on_site: "On Site",
    travel_to_supplier: "To Supplier",
    supplier_run: "Supplier",
    travel_between_jobs: "Between Jobs",
    admin: "Admin",
    break: "Break",
    other: "Other",
  };
  return typeLabels[type] || type;
}

// Labour Card Content Component
function LabourCardContent({
  jobId,
  onEditEntry,
}: {
  jobId: string;
  onEditEntry: (entry: TimeEntryDisplay) => void;
}) {
  const [showEntries, setShowEntries] = useState(false);

  const { data: timeSummary, isLoading, error } = useQuery<JobTimeSummary>({
    queryKey: ["/api/jobs", jobId, "time-summary"],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/time-summary`, { credentials: "include" });
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error("Failed to fetch time summary");
      }
      return res.json();
    },
    enabled: !!jobId,
  });

  const { data: timeEntries = [] } = useQuery<TimeEntryDisplay[]>({
    queryKey: ["/api/jobs", jobId, "time-entries"],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/time-entries`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!jobId && showEntries,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading time...
      </div>
    );
  }

  if (error || !timeSummary) {
    return (
      <p className="text-xs text-muted-foreground">
        No labour entries yet. Track time against this job here.
      </p>
    );
  }

  if (timeSummary.totalMinutes === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No labour entries yet. Track time against this job here.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {/* Running indicator */}
      {timeSummary.isRunning && (
        <div className="flex items-center gap-2 text-xs text-green-600 bg-green-50 dark:bg-green-950 rounded px-2 py-1">
          <Clock className="h-3 w-3 animate-pulse" />
          <span className="font-medium">{getRunningStatusText(timeSummary.runningType)}</span>
        </div>
      )}

      {/* Time summary */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Travel:</span>
          <span className="font-medium">{formatMinutes(timeSummary.travelMinutes)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">On-site:</span>
          <span className="font-medium">{formatMinutes(timeSummary.onSiteMinutes)}</span>
        </div>
        {timeSummary.otherMinutes > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Other:</span>
            <span className="font-medium">{formatMinutes(timeSummary.otherMinutes)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-muted-foreground">Billable:</span>
          <span className="font-medium text-primary">{formatMinutes(timeSummary.billableMinutes)}</span>
        </div>
      </div>

      {/* Total */}
      <Separator className="my-2" />
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">Total:</span>
        <span className="font-semibold">{formatMinutes(timeSummary.totalMinutes)}</span>
      </div>

      {/* Collapsible time entries list */}
      <Collapsible open={showEntries} onOpenChange={setShowEntries}>
        <CollapsibleTrigger asChild>
          <button
            className="flex items-center gap-1 text-xs text-primary hover:underline mt-2"
            data-testid="toggle-time-entries"
          >
            {showEntries ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {showEntries ? "Hide entries" : "Show entries"}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 space-y-1" data-testid="time-entries-list">
            {timeEntries.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">Loading...</p>
            ) : (
              timeEntries.map((entry) => {
                const isLocked = !!(entry.lockedAt || entry.invoicedAt);
                return (
                  <div
                    key={entry.id}
                    className={cn(
                      "flex items-center justify-between text-xs py-1 px-2 rounded group",
                      entry.invoicedAt ? "bg-muted/50" : "bg-background"
                    )}
                    data-testid={`time-entry-${entry.id}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "px-1.5 py-0.5 rounded text-[10px] font-medium",
                        entry.type === "on_site" ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" :
                        entry.type.startsWith("travel") ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" :
                        entry.type === "break" ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" :
                        "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                      )}>
                        {formatTimeEntryType(entry.type)}
                      </span>
                      <span className="text-muted-foreground">
                        {entry.technicianName || "Unknown"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {entry.durationMinutes !== null ? formatMinutes(entry.durationMinutes) : (
                          <span className="text-green-600 flex items-center gap-1">
                            <Clock className="h-3 w-3 animate-pulse" />
                            Running
                          </span>
                        )}
                      </span>
                      {entry.billable && (
                        <span title="Billable">
                          <DollarSign className="h-3 w-3 text-primary" />
                        </span>
                      )}
                      {isLocked && (
                        <span title="Locked (invoiced)">
                          <Lock className="h-3 w-3 text-amber-500" />
                        </span>
                      )}
                      {entry.invoicedAt && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0">
                          Invoiced
                        </Badge>
                      )}
                      <button
                        onClick={() => onEditEntry(entry)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-muted rounded"
                        title={isLocked ? "Edit (locked - requires override)" : "Edit"}
                        data-testid={`edit-entry-${entry.id}`}
                      >
                        <Pencil className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

// ============================================================================
// VISIT STATUS DISPLAY — Copied from JobVisitsSection (not exported there)
// ============================================================================
const VISIT_STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  dispatched: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  en_route: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  on_site: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  in_progress: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  on_hold: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  cancelled: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
};

const VISIT_STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  dispatched: "Dispatched",
  en_route: "En Route",
  on_site: "On Site",
  in_progress: "In Progress",
  on_hold: "On Hold",
  completed: "Completed",
  cancelled: "Cancelled",
};

// ============================================================================
// MAIN PAGE COMPONENT
// ============================================================================
export default function JobDetailPage() {
  const [, params] = useRoute("/jobs/:id");
  const [, setLocation] = useLocation();
  const searchParams = useSearch();
  const { toast } = useToast();
  const { logActivity } = useActivityStore();

  // Deep link support: ?section=visits opens visits section automatically
  // This is triggered from calendar event cards via history icon
  const sectionParam = new URLSearchParams(searchParams).get("section");
  const { user } = useAuth();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showCreateInvoiceDialog, setShowCreateInvoiceDialog] = useState(false);
  // 2026-03-05: Rule C — confirmation dialog when completing a job
  const [showCompleteJobConfirm, setShowCompleteJobConfirm] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showActionRequiredModal, setShowActionRequiredModal] = useState(false);
  const [showScheduleVisitDialog, setShowScheduleVisitDialog] = useState(false);
  const [notesOpen, setNotesOpen] = useState(true);
  const [activityOpen, setActivityOpen] = useState(false);
  // Time entry modals
  const [showAddTimeEntry, setShowAddTimeEntry] = useState(false);
  const [showEditTimeEntry, setShowEditTimeEntry] = useState(false);
  const [editingTimeEntry, setEditingTimeEntry] = useState<TimeEntryDisplay | null>(null);
  // Visit detail dialog — FIX A: single modal state, initialEdit for active visits
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);
  // visitEditMode removed — EditVisitModal always opens in edit mode
  // Parts & Billing collapse/expand — expanded by default
  const [billingExpanded, setBillingExpanded] = useState(true);
  // Visits collapse: show first 2 by default, toggle to show all
  const [showAllVisits, setShowAllVisits] = useState(false);
  // Visit Reschedule Architecture: conflict resolution state
  const [conflictMode, setConflictMode] = useState<'replace' | 'complete_and_new' | undefined>();
  const [conflictVisitId, setConflictVisitId] = useState<string | undefined>();
  // Conflict dialog: holds the visit that conflicts + whether it's empty or actioned
  const [rescheduleConflict, setRescheduleConflict] = useState<{
    visit: import("@shared/schema").JobVisit;
    kind: 'empty' | 'actioned';
  } | null>(null);
  const jobId = params?.id;

  // Technicians directory for schedule visit dialog + visit tech name lookup
  const { teamMembers: allTechnicians } = useTechniciansDirectory();

  // Inline visits list for middle column
  const { visits: allVisits, isLoading: visitsLoading, activeVisit, completedVisits } = useJobVisits(jobId || "", { enabled: !!jobId });

  // Sort visits: active first, then by scheduledStart descending (newest first)
  const sortedVisits = [...allVisits].sort((a, b) => {
    // Active visits before inactive
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    // Then by scheduledStart descending
    const aStart = a.scheduledStart ? new Date(a.scheduledStart).getTime() : 0;
    const bStart = b.scheduledStart ? new Date(b.scheduledStart).getTime() : 0;
    return bStart - aStart;
  });

  // Inline visit date formatter — compact single-line
  const formatVisitDate = (visit: import("@shared/schema").JobVisit) => {
    if (!visit.scheduledStart) return "No date";
    const start = new Date(visit.scheduledStart);
    if (visit.isAllDay) return `${format(start, "MMM d")} · All day`;
    return `${format(start, "MMM d")} · ${format(start, "h:mm a")}`;
  };

  // Inline technician name resolver — FIX C: uses canonical getMemberDisplayName
  const getVisitTechName = (techId: string | null) => {
    if (!techId) return "Unassigned";
    const tech = allTechnicians.find((t) => String(t.id) === techId);
    return tech ? getMemberDisplayName(tech) : "Unknown";
  };

  // Visit Reschedule Architecture: check for existing active visits before scheduling.
  // Both empty and actioned visits show a confirmation dialog before proceeding.
  const handleScheduleVisit = () => {
    const VISIT_TERMINAL_STATUSES = ["completed", "cancelled"];
    const activeNonTerminal = allVisits.filter(
      (v) => v.isActive && !VISIT_TERMINAL_STATUSES.includes(v.status)
    );
    if (activeNonTerminal.length > 0) {
      const conflict = activeNonTerminal[0];
      const kind = isVisitActioned(conflict) ? 'actioned' : 'empty';
      setRescheduleConflict({ visit: conflict, kind });
    } else {
      // No conflict — open schedule dialog directly
      setConflictMode(undefined);
      setConflictVisitId(undefined);
      setShowScheduleVisitDialog(true);
    }
  };

  // Phase 4 Step C3: Use canonical useJobHeader with ['jobs', 'detail', jobId] key
  const { data: job, isLoading, error } = useJobHeader(jobId) as {
    data: JobDetailResponse | undefined;
    isLoading: boolean;
    error: Error | null;
  };

  // Phase 11: Fixed job/invoice cross-linking - use correct endpoint
  const { data: jobInvoice } = useQuery<Invoice | null>({
    // Phase 5 Step A7: canonical family key prefix
    queryKey: ["invoices", "byJob", jobId],
    queryFn: async () => {
      const res = await fetch(`/api/invoices/by-job/${jobId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!jobId,
  });

  // Status update mutation - uses POST to match Time Tracking V1 backend
  // FIXED: Include version for optimistic locking (required by server schema)
  const updateStatusMutation = useMutation({
    mutationFn: async ({ status, version }: { status: string; version: number }) => {
      return apiRequest(`/api/jobs/${jobId}/status`, {
        method: "POST",
        body: JSON.stringify({ status, version, source: "web" })
      });
    },
    onSuccess: (_data: unknown, variables: { status: string; version: number }) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "time-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/range"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      // 2026-03-05: Rule C — completing a job auto-completes visits; refetch visit list
      if (variables.status === "completed") {
        queryClient.invalidateQueries({ queryKey: ["visits"] });
      }
      const statusLabel = variables.status === "completed" ? "Marked Completed" :
                          variables.status === "open" ? "Reopened" :
                          variables.status === "invoiced" ? "Marked Invoiced" : "Updated Status";
      logActivity({
        type: variables.status === "completed" ? "completed" : "updated",
        entityType: "job",
        entityId: jobId || "",
        label: `${statusLabel} — Job #${job?.jobNumber || ""}`,
        meta: job?.locationDisplayName || undefined,
      });
      toast({ title: "Status Updated", description: "Job status has been updated." });
    },
    onError: (error: Error) => {
      // Handle version conflict (409 VERSION_MISMATCH) — non-destructive recovery
      const isVersionConflict =
        (isApiError(error) && error.status === 409) ||
        /version|expected version|optimistic/i.test(error.message);
      if (isVersionConflict) {
        toast({ title: "Conflict", description: "This job was updated elsewhere. Refreshing\u2026" });
        queryClient.invalidateQueries({ queryKey: ["jobs"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
        queryClient.invalidateQueries({ queryKey: ["/api/calendar/range"] });
        queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
        return;
      }
      toast({
        title: "Error",
        description: error.message || "Failed to update status",
        variant: "destructive",
      });
    },
  });

  // Clear hold mutation - sets openSubStatus back to null (resumes normal workflow)
  // FIXED: Include version for optimistic locking (required by server schema)
  const clearHoldMutation = useMutation({
    mutationFn: async (version: number) => {
      return apiRequest(`/api/jobs/${jobId}/status`, {
        method: "POST",
        body: JSON.stringify({ status: "open", openSubStatus: null, version, source: "web" })
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      // Phase 5.1: clearing hold changes dashboard on_hold / needs-attention counts
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast({
        title: "Hold Cleared",
        description: "Job is no longer on hold.",
      });
    },
    onError: (error: Error) => {
      // Handle version conflict (409 VERSION_MISMATCH) — non-destructive recovery
      const isVersionConflict =
        (isApiError(error) && error.status === 409) ||
        /version|expected version|optimistic/i.test(error.message);
      if (isVersionConflict) {
        toast({ title: "Conflict", description: "This job was updated elsewhere. Refreshing\u2026" });
        queryClient.invalidateQueries({ queryKey: ["jobs"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        return;
      }
      toast({
        title: "Error",
        description: error.message || "Failed to clear hold",
        variant: "destructive",
      });
    },
  });

  // Unschedule mutation — visit-centric (2026-03-06)
  const unscheduleMutation = useUnscheduleVisit();

  const deleteJobMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/jobs/${jobId}`, {
        method: "DELETE"
      });
    },
    onSuccess: () => {
      // Invalidate ALL related queries so deleted job disappears from all views
      // Family-wide ["jobs"] invalidation covers Jobs list, detail, and all feed variants
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance"] });
      // Phase 5 Step B3: canonical dashboard family key
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      // Prefix-matches ["/api/clients", id, "overview"] so Client Detail page updates
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({
        title: "Job Deleted",
        description: "Job has been deleted.",
      });
      setLocation("/jobs");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete job",
        variant: "destructive",
      });
    },
  });

  const createInvoiceMutation = useMutation({
    mutationFn: async (markJobCompleted: boolean = false) => {
      const response = await apiRequest(`/api/invoices/from-job/${jobId}`, {
        method: "POST",
        body: JSON.stringify({
          includeLineItems: true,
          includeNotes: true,
          markJobCompleted,
        })
      });
      return response;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      logActivity({
        type: "created",
        entityType: "invoice",
        entityId: data.id,
        label: `Created Invoice${data.invoiceNumber ? ` #${data.invoiceNumber}` : ""}`,
        meta: job?.locationDisplayName || undefined,
      });
      toast({ title: "Invoice Created", description: "Invoice has been created from this job." });
      setShowCreateInvoiceDialog(false);
      setLocation(`/invoices/${data.id}`);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create invoice",
        variant: "destructive",
      });
    },
  });

  const handleStatusChange = (newStatus: string) => {
    if (!job) return;
    updateStatusMutation.mutate({ status: newStatus, version: job.version });
  };

  const handleDelete = () => {
    deleteJobMutation.mutate();
    setShowDeleteConfirm(false);
  };

  // Inline status change handler for the top-section status dropdown
  // Replicates JobMetaCard logic: intercepts "on_hold" to open modal
  const handleMetaStatusChange = (newValue: string) => {
    if (!job) return;
    if (newValue.startsWith("open:")) {
      const subStatus = newValue.split(":")[1];
      if (subStatus === "on_hold") {
        setShowActionRequiredModal(true);
      } else {
        // Sub-status changes need openSubStatus field, so use direct apiRequest
        // instead of updateStatusMutation (which only sends {status, version})
        apiRequest(`/api/jobs/${jobId}/status`, {
          method: "POST",
          body: JSON.stringify({ status: "open", openSubStatus: subStatus, version: job.version, source: "web" }),
        }).then(() => {
          queryClient.invalidateQueries({ queryKey: ["jobs"] });
          // (covered by family-wide ["jobs"] invalidation)
          toast({ title: "Status Updated", description: "Job status has been updated." });
        }).catch((error: Error) => {
          toast({ title: "Error", description: error.message || "Failed to update status", variant: "destructive" });
        });
      }
    } else if (newValue === "completed" && job.status !== "completed") {
      // 2026-03-05: Rule C — show confirmation before completing job
      setShowCompleteJobConfirm(true);
    } else {
      updateStatusMutation.mutate({ status: newValue, version: job.version });
    }
  };

  const handleCreateInvoice = (closeJob: boolean = false) => {
    createInvoiceMutation.mutate(closeJob);
  };


  if (isLoading) {
    return (
      <div className="p-6" data-testid="job-detail-loading">
        <div className="text-center py-8">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
          Loading job details...
        </div>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="p-6" data-testid="job-detail-error">
        <div className="text-center py-8">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-destructive" />
          <p className="text-destructive">Job not found</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => setLocation("/jobs")}
            data-testid="button-back-to-jobs"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Jobs
          </Button>
        </div>
      </div>
    );
  }

  // Permission helpers for action bar — reuse MANAGER_ROLES from module scope
  const isOfficeUser = user?.role && (MANAGER_ROLES as readonly string[]).includes(user.role);
  const canReopen = ["completed", "archived"].includes(job.status);
  const isJobInvoiced = job.status === "invoiced";
  const isTerminal = ["completed", "archived", "invoiced"].includes(job.status);

  return (
    <div className="p-4 max-w-7xl mx-auto" data-testid="job-detail-page">
      {/* ================================================================
          ACTION ROW — inline status indicator (left) + actions (right)
          ================================================================ */}
      <div className="flex items-center justify-between mb-3">
        {/* Left: inline attention indicator (replaces full-width OfficeActionsStrip banner) */}
        <div className="flex items-center gap-2">
          {(() => {
            const reason = getAttentionReason(job);
            if (!reason) return null;
            const config = ATTENTION_CONFIG[reason];
            const Icon = config.icon;
            // Compute detail text inline
            let detail: string | null = null;
            if (reason === 'overdue' && job.scheduledStart) {
              const s = new Date(job.scheduledStart);
              let eff = job.scheduledEnd ? new Date(job.scheduledEnd)
                : job.durationMinutes != null ? new Date(s.getTime() + job.durationMinutes * 60_000) : s;
              detail = `since ${format(eff, 'MMM d')}`;
            } else if (reason === 'on_hold' && job.holdReason) {
              const r = job.holdReason.replace(/_/g, ' ');
              detail = r.charAt(0).toUpperCase() + r.slice(1);
            } else if (reason === 'requires_invoicing' && job.closedAt) {
              try { detail = `completed ${format(new Date(job.closedAt), 'MMM d')}`; } catch {}
            }
            return (
              <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", config.badgeClass)} data-testid="inline-attention-indicator">
                <Icon className="h-3.5 w-3.5" />
                {config.label}
                {detail && <span className="text-[11px] font-normal opacity-80">— {detail}</span>}
              </span>
            );
          })()}
        </div>

        {/* Right: action buttons */}
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => handleScheduleVisit()} data-testid="button-schedule-visit-action">
            <CalendarPlus className="h-4 w-4 mr-1" />
            Schedule Visit
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowEditDialog(true)} data-testid="button-edit">
            <Pencil className="h-4 w-4 mr-1" />
            Edit Job
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-more-actions">
                <MoreHorizontal className="h-4 w-4 mr-1" />
                More Actions
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {/* Create Similar */}
              <DropdownMenuItem
                onClick={() => setLocation(`/jobs/new?cloneFrom=${job.id}`)}
                data-testid="menu-create-similar"
              >
                <Copy className="h-4 w-4 mr-2" />
                Create Similar Job
              </DropdownMenuItem>
              {/* Create/View Invoice */}
              {isOfficeUser && (
                <DropdownMenuItem
                  onClick={() => {
                    if (jobInvoice) {
                      setLocation(`/invoices/${jobInvoice.id}`);
                    } else {
                      setShowCreateInvoiceDialog(true);
                    }
                  }}
                  data-testid="menu-create-invoice"
                >
                  <Receipt className="h-4 w-4 mr-2" />
                  {jobInvoice ? "View Invoice" : "Create Invoice"}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => toast({ title: "Coming Soon", description: "Signature collection will be available soon." })}
                data-testid="menu-collect-signature"
              >
                <PenTool className="h-4 w-4 mr-2" />
                Collect Signature
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => toast({ title: "Coming Soon", description: "PDF download will be available soon." })}
                data-testid="menu-download-pdf"
              >
                <Download className="h-4 w-4 mr-2" />
                Download PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.print()} data-testid="menu-print">
                <Printer className="h-4 w-4 mr-2" />
                Print
              </DropdownMenuItem>
              {/* Delete Job */}
              {isOfficeUser && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setShowDeleteConfirm(true)}
                    className="text-destructive"
                    data-testid="menu-delete-job"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete Job
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ================================================================
          UNIFIED SURFACE — one bordered workspace: header + body
          ================================================================ */}
      <div className="rounded-lg border border-border/80 bg-card shadow-sm overflow-hidden" data-testid="unified-surface">

        {/* ── HEADER SECTION: Identity (left) + Metadata (right) ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] divide-y lg:divide-y-0 lg:divide-x">
          {/* LEFT: Identity — JobHeaderCard renders without Card wrapper */}
          <div className="p-5">
            <JobHeaderCard
              job={job}
              jobInvoice={jobInvoice ?? null}
              onEdit={() => setShowEditDialog(true)}
              onDelete={() => deleteJobMutation.mutate()}
              showActions={false}
            />
            {/* Description inline below identity */}
            {job.description && job.description.trim() !== "" && (
              <p className="mt-2 text-sm text-muted-foreground/80 whitespace-pre-wrap" data-testid="text-job-description">
                {job.description}
              </p>
            )}
          </div>

          {/* RIGHT: Primary metadata — compact, aligned grid */}
          <div className="p-5 lg:w-64 text-xs">
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 items-center">
              <span className="text-muted-foreground/70 flex items-center gap-1">
                <Briefcase className="h-3 w-3" />
                Job
              </span>
              <span className="font-semibold text-foreground text-right" data-testid="text-job-number">
                #{job.jobNumber}
              </span>

              <span className="text-muted-foreground/70 flex items-center gap-1">
                <Receipt className="h-3 w-3" />
                Invoice
              </span>
              <span className="text-right">
                {jobInvoice ? (
                  <Link
                    href={`/invoices/${jobInvoice.id}`}
                    className="font-semibold text-primary hover:underline"
                    data-testid="link-invoice"
                  >
                    #{jobInvoice.invoiceNumber || `INV-${jobInvoice.id.slice(0, 6).toUpperCase()}`}
                  </Link>
                ) : (
                  <span className="text-muted-foreground/50" data-testid="text-no-invoice">—</span>
                )}
              </span>

              <span className="text-muted-foreground/70">Status</span>
              <div className="flex justify-end">
                <Select
                  value={job.openSubStatus ? `open:${job.openSubStatus}` : job.status}
                  onValueChange={handleMetaStatusChange}
                  disabled={updateStatusMutation.isPending}
                >
                  <SelectTrigger className="h-6 w-auto min-w-[100px] text-[11px]" data-testid="select-status">
                    <SelectValue placeholder="Change" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open (Backlog)</SelectItem>
                    <SelectItem value="open:in_progress">In Progress</SelectItem>
                    <SelectItem value="open:on_route">On Route</SelectItem>
                    <SelectItem value="open:on_hold">On Hold</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="invoiced">Invoiced</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <span className="text-muted-foreground/70">Created</span>
              <span className="text-right text-foreground/80" data-testid="text-created-date">
                {job.createdAt ? format(new Date(job.createdAt), "MMM d, yyyy") : "—"}
              </span>

              <span className="text-muted-foreground/70">Completed</span>
              <span className="text-right text-foreground/80" data-testid="text-completed-date">
                {job.closedAt ? format(new Date(job.closedAt), "MMM d, yyyy") : "—"}
              </span>
            </div>

            {/* On Hold info */}
            {job.status === "open" && (job.openSubStatus === "on_hold" || job.openSubStatus === "needs_review") && (
              <div className="pt-2 border-t mt-2 space-y-1.5">
                <div className="flex items-center gap-1 text-[11px] text-destructive font-medium">
                  {job.openSubStatus === "on_hold" ? (
                    <><Pause className="h-3 w-3" /><span>On Hold</span></>
                  ) : (
                    <><AlertCircle className="h-3 w-3" /><span>Needs Review</span></>
                  )}
                </div>
                {job.holdReason && (
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-muted-foreground text-[11px]">Reason:</span>
                    <span className="text-[11px] text-right" data-testid="text-hold-reason">
                      {getHoldReasonLabel(job.holdReason)}
                    </span>
                  </div>
                )}
                {job.holdNotes && (
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-muted-foreground text-[11px]">Notes:</span>
                    <span className="text-[11px] text-right max-w-[120px] truncate" title={job.holdNotes} data-testid="text-hold-notes">
                      {job.holdNotes}
                    </span>
                  </div>
                )}
                {job.nextActionDate && (
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-muted-foreground text-[11px]">Next action:</span>
                    <span className="text-[11px]" data-testid="text-next-action-date">
                      {format(new Date(job.nextActionDate), "MMM d, yyyy")}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── BODY: 2-column — Main content (left) + Utility rail (right) ── */}
        <div className="border-t grid gap-0 lg:grid-cols-[1fr_300px]">

          {/* ════════════════════════════════════════════════════════════════
              LEFT: Main working area — Billing → Notes → Visits → Activity
              ════════════════════════════════════════════════════════════════ */}
          <div className="lg:border-r min-w-0">

            {/* ┌─ BILLING SURFACE ─────────────────────────────────────────┐
                │ Parts & Billing + Expenses as one unified work zone      │
                └──────────────────────────────────────────────────────────┘ */}
            <div className="bg-muted/15" data-testid="billing-surface">
              {/* Parts & Billing — collapsible primary work surface */}
              <Collapsible open={billingExpanded} onOpenChange={setBillingExpanded}>
                <CollapsibleTrigger asChild>
                  <button
                    className={cn(
                      "w-full flex items-center justify-between px-5 py-3.5 transition-colors",
                      "hover:bg-muted/30",
                      billingExpanded && "border-b border-border/40",
                    )}
                    data-testid="trigger-parts-billing"
                  >
                    <span className="text-[13px] font-semibold text-foreground flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-muted-foreground/70" />
                      Parts & Billing
                    </span>
                    {billingExpanded
                      ? <ChevronDown className="h-4 w-4 text-muted-foreground/50" />
                      : <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
                    }
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="[&>*]:border-0 [&>*]:rounded-none [&>*]:shadow-none [&>*]:bg-transparent" data-testid="parts-billing-wrapper">
                    <PartsBillingCard jobId={jobId!} />
                  </div>
                </CollapsibleContent>
              </Collapsible>

              {/* Expenses — part of the billing surface */}
              <div className="border-t border-border/40 px-5 py-4" data-testid="section-expenses">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[13px] font-semibold text-foreground">Expenses</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-auto p-0 text-primary"
                    onClick={() => toast({ title: "Coming Soon", description: "Expense tracking coming soon." })}
                    data-testid="button-new-expense"
                  >
                    New Expense
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Track additional job costs (parking, materials, etc.) here.
                </p>
              </div>

              {/* Recurring series — part of the billing surface */}
              {job.recurringSeries && (
                <div className="border-t border-border/40 px-5 py-4" data-testid="section-recurring">
                  <h3 className="text-[13px] font-semibold flex items-center gap-2 mb-2">
                    <Repeat className="h-4 w-4 text-muted-foreground/70" />
                    Recurring Series
                  </h3>
                  <p className="text-sm" data-testid="text-series-summary">{job.recurringSeries.baseSummary}</p>
                </div>
              )}
            </div>

            {/* ┌─ NOTES SURFACE ───────────────────────────────────────────┐ */}
            <div className="border-t-2 border-border/50" data-testid="section-notes">
              <JobNotesSection jobId={job.id} defaultOpen={notesOpen} embedded />
            </div>

            {/* ┌─ VISITS SURFACE ──────────────────────────────────────────┐ */}
            <div className="border-t-2 border-border/50" id="visits-section" data-testid="section-visits">
              <div className="flex items-center justify-between px-5 py-3.5">
                <span className="text-[13px] font-semibold text-foreground flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground/70" />
                  Visits
                </span>
                <span className="text-[11px] text-muted-foreground/50">{allVisits.length} total</span>
              </div>
              <div className="px-3 pb-3">
                {visitsLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                ) : sortedVisits.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground">
                    <Calendar className="h-4 w-4 mx-auto mb-1 opacity-50" />
                    <p className="text-[11px]">No visits yet</p>
                  </div>
                ) : (
                  <>
                    {(showAllVisits ? sortedVisits : sortedVisits.slice(0, 5)).map((visit) => (
                      <button
                        key={visit.id}
                        onClick={() => setSelectedVisitId(visit.id)}
                        className="w-full text-left px-3 py-2 rounded hover:bg-accent/50 transition-colors flex items-center gap-3"
                        data-testid={`visit-row-${visit.id}`}
                      >
                        <span className="text-xs font-medium truncate flex-1">
                          {formatVisitDate(visit)}
                        </span>
                        <span className="text-xs text-muted-foreground truncate max-w-[120px] shrink-0">
                          {getVisitTechName(visit.assignedTechnicianId)}
                        </span>
                        {visit.status !== "scheduled" && (
                          <Badge className={cn("text-[9px] px-1.5 py-0 shrink-0 leading-tight", VISIT_STATUS_COLORS[visit.status] || "")}>
                            {VISIT_STATUS_LABELS[visit.status] || visit.status}
                          </Badge>
                        )}
                      </button>
                    ))}
                    {sortedVisits.length > 5 && (
                      <button
                        onClick={() => setShowAllVisits(!showAllVisits)}
                        className="w-full text-center text-xs text-primary hover:underline py-2"
                        data-testid="toggle-show-all-visits"
                      >
                        {showAllVisits ? "Show less" : `Show all (${sortedVisits.length})`}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* ┌─ ACTIVITY ────────────────────────────────────────────────┐ */}
            <div className="border-t border-border/30">
              <Collapsible open={activityOpen} onOpenChange={setActivityOpen}>
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center justify-between px-5 py-3 hover:bg-muted/20 transition-colors" data-testid="trigger-activity">
                    <span className="text-[13px] font-semibold text-foreground">Activity</span>
                    {activityOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground/50" /> : <ChevronRight className="h-4 w-4 text-muted-foreground/50" />}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-5 pb-4 pt-1">
                    <ul className="space-y-2 text-xs">
                      <li className="flex items-start gap-2">
                        <span className="mt-1 h-2 w-2 rounded-full bg-primary shrink-0" />
                        <div>
                          <div className="font-medium">Job created</div>
                          <div className="text-muted-foreground">
                            {job.createdAt ? format(new Date(job.createdAt), "MMMM do, yyyy") : "N/A"}
                          </div>
                        </div>
                      </li>
                      {job.scheduledStart && (
                        <li className="flex items-start gap-2">
                          <span className="mt-1 h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                          <div>
                            <div className="font-medium">Scheduled</div>
                            <div className="text-muted-foreground">{format(new Date(job.scheduledStart), "MMMM do, yyyy")}</div>
                          </div>
                        </li>
                      )}
                      {job.actualStart && (
                        <li className="flex items-start gap-2">
                          <span className="mt-1 h-2 w-2 rounded-full bg-green-500 shrink-0" />
                          <div>
                            <div className="font-medium">Work started</div>
                            <div className="text-muted-foreground">{format(new Date(job.actualStart), "MMMM do, yyyy")}</div>
                          </div>
                        </li>
                      )}
                      {job.actualEnd && (
                        <li className="flex items-start gap-2">
                          <span className="mt-1 h-2 w-2 rounded-full bg-green-600 shrink-0" />
                          <div>
                            <div className="font-medium">Work completed</div>
                            <div className="text-muted-foreground">{format(new Date(job.actualEnd), "MMMM do, yyyy")}</div>
                          </div>
                        </li>
                      )}
                    </ul>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          </div>

          {/* ════════════════════════════════════════════════════════════════
              RIGHT: Utility rail — Labour, Equipment, Timeline, History
              Unified sidebar with consistent module rhythm, no card-in-card
              ════════════════════════════════════════════════════════════════ */}
          <div>
            {/* Labour — primary sidebar module */}
            <div className="px-5 py-4" data-testid="section-labour">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-semibold text-foreground">Labour</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-auto p-0 text-primary"
                  onClick={() => setShowAddTimeEntry(true)}
                  data-testid="button-new-time-entry"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  New Time Entry
                </Button>
              </div>
              <LabourCardContent
                jobId={jobId!}
                onEditEntry={(entry) => {
                  setEditingTimeEntry(entry);
                  setShowEditTimeEntry(true);
                }}
              />
            </div>

            {/* Sidebar divider */}
            <div className="mx-5 border-t border-border/40" />

            {/* Equipment */}
            <div className="[&>*]:border-0 [&>*]:rounded-none [&>*]:shadow-none [&>*]:bg-transparent">
              <JobEquipmentSection jobId={job.id} locationId={job.locationId} />
            </div>

            {/* Sidebar divider */}
            <div className="mx-5 border-t border-border/40" />

            {/* Status Timeline */}
            <div className="[&>*]:border-0 [&>*]:rounded-none [&>*]:shadow-none [&>*]:bg-transparent">
              <JobStatusTimeline jobId={job.id} defaultOpen={false} />
            </div>

            {/* Sidebar divider */}
            <div className="mx-5 border-t border-border/40" />

            {/* Scheduling History */}
            <div className="[&>*]:border-0 [&>*]:rounded-none [&>*]:shadow-none [&>*]:bg-transparent">
              <SchedulingHistory jobId={job.id} defaultOpen={false} />
            </div>
          </div>
        </div>
      </div>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent data-testid="dialog-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Job</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete Job #{job.jobNumber}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <QuickAddJobDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        editJob={job as any}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["jobs"] });
        }}
      />

      <ActionRequiredModal
        jobId={job.id}
        open={showActionRequiredModal}
        onOpenChange={setShowActionRequiredModal}
      />

      {/* Schedule Visit Dialog - triggered from Office Actions strip + inline visits header */}
      <AddVisitDialog
        jobId={job.id}
        jobVersion={job.version}
        open={showScheduleVisitDialog}
        onOpenChange={(open) => {
          setShowScheduleVisitDialog(open);
          // Clear conflict state when dialog closes
          if (!open) {
            setConflictMode(undefined);
            setConflictVisitId(undefined);
          }
        }}
        technicians={allTechnicians}
        conflictMode={conflictMode}
        conflictVisitId={conflictVisitId}
      />

      {/* Edit Visit Modal — canonical shared component (replaces VisitDetailDialog) */}
      {selectedVisitId && (
        <EditVisitModal
          open={true}
          onOpenChange={(open) => { if (!open) setSelectedVisitId(null); }}
          jobId={job.id}
          visitId={selectedVisitId}
          jobStatus={job.status}
        />
      )}

      {/* Visit Reschedule Architecture: confirmation dialog for empty OR actioned visits */}
      <AlertDialog open={!!rescheduleConflict} onOpenChange={(open) => { if (!open) setRescheduleConflict(null); }}>
        <AlertDialogContent data-testid="dialog-reschedule-conflict">
          <AlertDialogHeader>
            <AlertDialogTitle>Active Visit Found</AlertDialogTitle>
            <AlertDialogDescription>
              {rescheduleConflict?.kind === 'empty'
                ? "This visit has no activity. It will be removed and replaced with the new scheduled visit."
                : "You have an uncompleted visit with activity. The uncompleted visit will be completed, and a new visit will be scheduled."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel data-testid="button-cancel-reschedule">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (rescheduleConflict) {
                  const mode = rescheduleConflict.kind === 'empty' ? 'replace' : 'complete_and_new';
                  setConflictMode(mode);
                  setConflictVisitId(rescheduleConflict.visit.id);
                }
                setRescheduleConflict(null);
                setShowScheduleVisitDialog(true);
              }}
              data-testid={rescheduleConflict?.kind === 'empty' ? "button-replace-visit" : "button-complete-and-new"}
            >
              {rescheduleConflict?.kind === 'empty' ? "Yes, Replace Visit" : "Yes, Complete & Schedule New"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 2026-03-05: Rule C — Confirmation dialog when completing a job */}
      <AlertDialog open={showCompleteJobConfirm} onOpenChange={setShowCompleteJobConfirm}>
        <AlertDialogContent data-testid="dialog-complete-job-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Complete Job</AlertDialogTitle>
            <AlertDialogDescription>
              All uncompleted visits will be marked as completed. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-complete-job">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (job) {
                  updateStatusMutation.mutate({ status: "completed", version: job.version });
                }
                setShowCompleteJobConfirm(false);
              }}
              data-testid="button-confirm-complete-job"
            >
              Yes, Complete Job
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showCreateInvoiceDialog} onOpenChange={setShowCreateInvoiceDialog}>
        <DialogContent data-testid="dialog-create-invoice">
          <DialogHeader>
            <DialogTitle>Create Invoice from Job</DialogTitle>
            <DialogDescription>
              This will create a new draft invoice with line items from this job's parts and billing.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              Job: #{job.jobNumber} - {job.summary || "No summary"}
            </p>
            <p className="text-sm text-muted-foreground">
              Client: {job.parentCompany?.name || job.location?.companyName || "Unknown"}
            </p>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setShowCreateInvoiceDialog(false)}>
              Cancel
            </Button>
            {job.status !== "completed" && (
              <Button
                variant="outline"
                onClick={() => handleCreateInvoice(true)}
                disabled={createInvoiceMutation.isPending}
                data-testid="button-close-job-create-invoice"
              >
                {createInvoiceMutation.isPending ? "Creating..." : "Close Job & Create Invoice"}
              </Button>
            )}
            <Button
              onClick={() => handleCreateInvoice(false)}
              disabled={createInvoiceMutation.isPending}
              data-testid="button-confirm-create-invoice"
            >
              {createInvoiceMutation.isPending ? "Creating..." : "Create Invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Time Entry Modals */}
      <AddTimeEntryModal
        open={showAddTimeEntry}
        onOpenChange={setShowAddTimeEntry}
        jobId={job.id}
        assignedTechnicianIds={job.assignedTechnicianIds || []}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "time-summary"] });
          queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "time-entries"] });
        }}
      />

      <EditTimeEntryModal
        open={showEditTimeEntry}
        onOpenChange={(open) => {
          setShowEditTimeEntry(open);
          if (!open) setEditingTimeEntry(null);
        }}
        jobId={job.id}
        entry={editingTimeEntry}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "time-summary"] });
          queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "time-entries"] });
        }}
      />
    </div>
  );
}
