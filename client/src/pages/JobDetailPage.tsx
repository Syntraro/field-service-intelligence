import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";
import { useJobVisits } from "@/hooks/useJobVisits";
import { useUnscheduleVisit } from "@/hooks/useSchedulingApi";
import { useRoute, useLocation, Link, useSearch } from "wouter";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { getMemberDisplayName } from "@/lib/displayName";
import { visitStatusLabel } from "@/lib/visitStatusDisplay";
import { getClientDisplayName } from "@shared/clientDisplayName";
import { useToast } from "@/hooks/use-toast";
import { useActivityStore } from "@/lib/activityStore";
import {
  Archive,
  ArrowLeft,
  Check,
  CheckCircle2,
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
  MapPin,
  MessageSquare,
  RotateCcw,
  Send,
  Wrench,
  X,
  Tag,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ReferenceFieldsSection } from "@/components/shared/ReferenceFieldsSection";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import JobEquipmentSection from "@/components/JobEquipmentSection";
import { AddVisitDialog } from "@/components/AddVisitDialog";
import { EditVisitModal } from "@/components/visits/EditVisitModal";
import JobNotesSection from "@/components/JobNotesSection";
import { PartsBillingCard } from "@/components/PartsBillingCard";
import { JobExpensesCard } from "@/components/JobExpensesCard";
import { QuickAddJobDialog } from "@/components/QuickAddJobDialog";
import { JobHeaderCard, type JobHeaderCardHandle } from "@/components/JobHeaderCard";
import { CreateInvoiceFromJobDialog } from "@/components/CreateInvoiceFromJobDialog";
import { AddJobNoteDialog } from "@/components/AddJobNoteDialog";
// JobAssignmentsCard + JobMetaCard replaced by unified top-section layout
import { ActionRequiredModal, getHoldReasonLabel } from "@/components/ActionRequiredModal";
import { JobStatusTimeline } from "@/components/job/JobStatusTimeline";
import { StatusProgressBar, getJobStatusDisplay, getPriorityDisplay, SchedulingHistory } from "@/components/job";
import { TimeEntryModal, type TimeEntryForModal } from "@/components/time";
// Phase 12 (2026-04-12): customer-facing job email modal.
import { SendJobModal } from "@/components/communication/SendJobModal";
// Phase 15 (2026-04-12): email delivery status card.
import { DeliveryStatusCard } from "@/components/communication/DeliveryStatusCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusPill, statusToVariant } from "@/components/ui/status-pill";
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
// Select imports removed (2026-03-24) — status dropdown eliminated
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
import { MetaRow } from "@/components/ui/meta-row";
import type { Job, Client, CustomerCompany, User as UserType, RecurringJobSeries, Invoice, JobTimeSummary, TimeEntryType } from "@shared/schema";
import { useJobHeader } from "@/hooks/useJobsFeed";
import type { JobHeaderDetail } from "@/hooks/useJobsFeed";

// ============================================================================
// PERMISSION HELPERS - Role-based action availability
// ============================================================================
import { MANAGER_ROLES } from "@/lib/roles";

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

// Time Entry type for display — matches getJobTimeEntries canonical output
interface TimeEntryDisplay {
  id: string;
  technicianId: string;
  technicianName: string | null;
  type: TimeEntryType;
  taskId: string | null;
  visitId: string | null;
  sourceType: "visit" | "task" | "manual";
  startAt: string;
  endAt: string | null;
  durationMinutes: number | null;
  billable: boolean;
  billableRateSnapshot: string | null;
  costRateSnapshot: string | null;
  notes: string | null;
  invoiceId: string | null;
  invoicedAt: string | null;
  lockedAt: string | null;
  lockedByInvoiceId: string | null;
  lockReason: string | null;
  visitLabel: string | null;
}


// Labour Card Content Component
function LabourCardContent({
  jobId,
  onEditEntry,
}: {
  jobId: string;
  onEditEntry: (entry: TimeEntryDisplay) => void;
}) {
  const timeSummaryQuery = useQuery<JobTimeSummary>({
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
    // Semi-live summary; realtime SSE invalidates ["/api/jobs"] family on visit/time events.
    // Short cache prevents redundant fetches on mount/focus when timer is idle.
    staleTime: 30_000,
    // Poll every 60s while a timer is actively running (foreground only)
    refetchInterval: (query) => (query.state.data as any)?.isRunning ? 60_000 : false,
    refetchIntervalInBackground: false,
  });
  const timeSummary = timeSummaryQuery.data;
  const isLoading = timeSummaryQuery.isLoading;
  const error = timeSummaryQuery.error;

  const { data: timeEntries = [] } = useQuery<TimeEntryDisplay[]>({
    queryKey: ["/api/jobs", jobId, "time-entries"],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/time-entries`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!jobId,
    staleTime: 2 * 60_000,
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

  // Labour Summary: entries render immediately when card is expanded (no nested toggle)
  return (
    <div className="space-y-1">
      {/* Running indicator */}
      {timeSummary.isRunning && (
        <div className="flex items-center gap-2 text-xs text-green-600 bg-green-50 dark:bg-green-950 rounded px-2 py-1 mb-1">
          <Clock className="h-3 w-3 animate-pulse" />
          <span className="font-medium">{getRunningStatusText(timeSummary.runningType)}</span>
        </div>
      )}

      {/* Entry list — rendered immediately, no nested show/hide step */}
      <div className="space-y-1" data-testid="time-entries-list">
        {timeEntries.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">Loading...</p>
        ) : (
          (() => {
            // Group visit entries by technician+visitId. Non-visit entries stay ungrouped.
            const TRAVEL_SET = new Set(["travel_to_job", "travel_between_jobs", "travel_to_supplier"]);
            type Group = { techName: string; visitLabel: string | null; entries: typeof timeEntries };
            const groups: Group[] = [];
            const ungrouped: typeof timeEntries = [];
            const visitMap = new Map<string, Group>();

            timeEntries.forEach((e) => {
              if (e.sourceType === "visit" && e.visitId && e.technicianId) {
                const key = `${e.technicianId}:${e.visitId}`;
                let g = visitMap.get(key);
                if (!g) {
                  g = { techName: e.technicianName || "Unknown", visitLabel: e.visitLabel, entries: [] };
                  visitMap.set(key, g);
                  groups.push(g);
                }
                g.entries.push(e);
              } else {
                ungrouped.push(e);
              }
            });

            // Sort within each group: travel first, then by startAt
            groups.forEach((g) => g.entries.sort((a, b) => {
              const aT = TRAVEL_SET.has(a.type) ? 0 : 1;
              const bT = TRAVEL_SET.has(b.type) ? 0 : 1;
              if (aT !== bT) return aT - bT;
              return new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
            }));

            const renderRow = (entry: typeof timeEntries[0], showTech: boolean) => {
              const isLocked = !!(entry.lockedAt || entry.invoicedAt);
              const cost = entry.durationMinutes != null && entry.costRateSnapshot
                ? ((entry.durationMinutes / 60) * parseFloat(entry.costRateSnapshot)).toFixed(2)
                : null;
              const isTravel = TRAVEL_SET.has(entry.type);
              return (
                <div
                  key={entry.id}
                  className={cn(
                    "flex items-center justify-between text-xs py-1.5 px-2 rounded group cursor-pointer hover:bg-muted/60",
                    entry.invoicedAt ? "bg-muted/50" : "bg-background"
                  )}
                  onClick={() => onEditEntry(entry)}
                  data-testid={`time-entry-${entry.id}`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    {showTech && <span className="font-medium text-slate-700 dark:text-slate-200 truncate shrink-0">{entry.technicianName || "Unknown"}</span>}
                    <span className="text-[11px] text-muted-foreground shrink-0">
                      {format(new Date(entry.startAt), "MMM d")}
                      {entry.startAt && entry.endAt && (
                        <span className="ml-0.5 text-slate-400">{format(new Date(entry.startAt), "h:mma")}–{format(new Date(entry.endAt), "h:mma")}</span>
                      )}
                    </span>
                    <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0",
                      isTravel ? "bg-blue-50 text-blue-600" : entry.sourceType === "task" ? "bg-indigo-50 text-indigo-600" : "bg-emerald-50 text-emerald-600"
                    )}>
                      {isTravel ? "En Route" : entry.sourceType === "task" ? "Task" : entry.sourceType === "manual" ? "Manual" : "On Site"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <div className="flex flex-col items-end">
                      <span className="font-medium tabular-nums">
                        {entry.durationMinutes != null ? formatMinutes(entry.durationMinutes) : (
                          <span className="text-green-600 flex items-center gap-1"><Clock className="h-3 w-3 animate-pulse" />Running</span>
                        )}
                      </span>
                      {cost && <span className="text-[11px] text-muted-foreground tabular-nums">${cost}</span>}
                    </div>
                    {isLocked && <span title="Locked (invoiced)"><Lock className="h-3 w-3 text-amber-500 shrink-0" /></span>}
                  </div>
                </div>
              );
            };

            return (
              <>
                {groups.map((g, gi) => (
                  <div key={`group-${gi}`} className="rounded border border-slate-200/60 overflow-hidden">
                    <div className="px-2 py-1 bg-slate-50/80">
                      <span className="text-xs font-medium text-slate-700">{g.techName}</span>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {g.entries.map((e) => renderRow(e, false))}
                    </div>
                  </div>
                ))}
                {ungrouped.map((e) => renderRow(e, true))}
              </>
            );
          })()
        )}
      </div>
    </div>
  );
}

// ============================================================================
// VISIT STATUS DISPLAY — Labels from canonical visitStatusDisplay.ts
//
// Colors are intentionally LOCAL and distinct from both visitStatusColor()
// (dispatch board palette, subtle 50-series) and visitStatusColorTech()
// (tech app palette, bold 100-series). The Job Detail page uses its own
// palette that emphasizes contrast against the white card background and
// includes dark mode variants.
//
// Audit note 2026-04-08: Verified intentional design separation. Do not
// replace with canonical helpers — they use materially different colors.
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

// ============================================================================
// MAIN PAGE COMPONENT
// ============================================================================
export default function JobDetailPage() {
  const [, params] = useRoute("/jobs/:id");
  const [, setLocation] = useLocation();
  const searchParams = useSearch();
  const { toast } = useToast();
  const { logActivity } = useActivityStore();

  // 2026-04-08: useDispatchStream() now mounted once at App.tsx root for all office surfaces.

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
  // Phase 12 (2026-04-12): customer-facing job email modal.
  const [showSendJobEmail, setShowSendJobEmail] = useState(false);
  const [showScheduleVisitDialog, setShowScheduleVisitDialog] = useState(false);
  // notesOpen removed — notes always visible, no vertical collapse
  const [activityOpen, setActivityOpen] = useState(false);
  // Time entry modals
  // Unified time entry modal: mode + optional entry for edit
  const [timeEntryModal, setTimeEntryModal] = useState<{
    open: boolean;
    mode: "create" | "edit";
    entry: TimeEntryDisplay | null;
  }>({ open: false, mode: "create", entry: null });
  // Visit detail dialog — FIX A: single modal state, initialEdit for active visits
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);
  // visitEditMode removed — EditVisitModal always opens in edit mode
  // Inline job number editing
  const [editingJobNumber, setEditingJobNumber] = useState(false);
  const [jobNumberDraft, setJobNumberDraft] = useState("");
  const [jobNumberError, setJobNumberError] = useState<string | null>(null);
  const jobNumberInputRef = useRef<HTMLInputElement>(null);
  // Inline description editing
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const descInputRef = useRef<HTMLTextAreaElement>(null);
  // 2026-03-24: Ref to JobHeaderCard for imperative lifecycle triggers (close/reopen/archive)
  const headerCardRef = useRef<JobHeaderCardHandle>(null);
  // Billing KPI totals reported by PartsBillingCard
  const [billingTotals, setBillingTotals] = useState<{ totalPrice: number; totalCost: number; profit: number } | null>(null);
  // Parts & Billing collapse/expand — expanded by default
  const [billingExpanded, setBillingExpanded] = useState(true);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  // Notes count for display
  const [notesCount, setNotesCount] = useState(0);
  // Notes card collapse/expand — open by default (2026-04-05: dispatcher needs notes visible immediately)
  const [notesExpanded, setNotesExpanded] = useState(true);
  // Job Summary collapse/expand — minimized by default (2026-04-05: profit line visible when collapsed)
  const [jobSummaryExpanded, setJobSummaryExpanded] = useState(false);
  // Labour Summary collapse/expand — open by default (2026-04-05: dispatcher needs labour visible immediately)
  const [labourSummaryExpanded, setLabourSummaryExpanded] = useState(true);
  // Rail-level "Add Note" dialog (single source — Notes card's internal button is hidden)
  const [showAddNoteDialog, setShowAddNoteDialog] = useState(false);
  // Rail-level "Add Equipment" dialog trigger
  const [showAddEquipmentDialog, setShowAddEquipmentDialog] = useState(false);
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

  // Expense totals — query directly so header always reflects latest data
  // Shares query key with JobExpensesCard so mutations auto-invalidate both
  const { data: expensesRaw = [] } = useQuery<{ amount: string }[]>({
    queryKey: ["/api/jobs", jobId, "expenses"],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/expenses`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!jobId,
    staleTime: 5 * 60_000,
  });
  const expenseTotalAmount = useMemo(
    () => expensesRaw.reduce((sum, e) => sum + parseFloat(e.amount || "0"), 0),
    [expensesRaw],
  );
  // Page-level time summary — shares query key with LabourCardContent (React Query deduplicates)
  const { data: pageLevelTimeSummary } = useQuery<JobTimeSummary>({
    queryKey: ["/api/jobs", jobId, "time-summary"],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/time-summary`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!jobId,
    // Same key as LabourCardContent — keep staleTime aligned for consistency
    staleTime: 30_000,
  });

  // Labour cost — derived from time entry cost rates via the time-summary endpoint.
  // All Job Summary references use this single const so no multi-site refactor is needed.
  const labourCostAmount = pageLevelTimeSummary?.totalCostAmount ?? 0;

  // Technicians directory for schedule visit dialog + visit tech name lookup
  const { teamMembers: allTechnicians } = useTechniciansDirectory();

  // Inline visits list for middle column
  const { visits: allVisits, isLoading: visitsLoading, activeVisit, completedVisits } = useJobVisits(jobId || "", { enabled: !!jobId });

  // Sort visits: active first, then by scheduledStart descending (newest first)
  const sortedVisits = useMemo(() => [...allVisits].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    const aStart = a.scheduledStart ? new Date(a.scheduledStart).getTime() : 0;
    const bStart = b.scheduledStart ? new Date(b.scheduledStart).getTime() : 0;
    return bStart - aStart;
  }), [allVisits]);

  // Inline visit date formatter — compact single-line
  const formatVisitDate = (visit: import("@shared/schema").JobVisit) => {
    if (!visit.scheduledStart) return "No date";
    const start = new Date(visit.scheduledStart);
    return `${format(start, "MMM d")} · ${format(start, "h:mm a")}`;
  };

  // Inline technician name resolver — FIX C: uses canonical getMemberDisplayName
  const getVisitTechName = (techId: string | null) => {
    if (!techId) return "Unassigned";
    const tech = allTechnicians.find((t) => String(t.id) === techId);
    return tech ? getMemberDisplayName(tech) : "Unknown";
  };

  const getVisitCrewLabel = (visit: { assignedTechnicianIds?: string[] | null }): string => {
    const ids = Array.isArray(visit.assignedTechnicianIds) ? visit.assignedTechnicianIds : [];
    if (ids.length === 0) return "Unassigned";
    const names = ids
      .map((id) => {
        const tech = allTechnicians.find((t) => String(t.id) === id);
        return tech ? getMemberDisplayName(tech) : null;
      })
      .filter((n): n is string => !!n);
    if (names.length === 0) return "Unknown";
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]}, ${names[1]}`;
    return `${names[0]} +${names.length - 1}`;
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
    staleTime: 10 * 60_000,
  });

  // 2026-03-24: updateStatusMutation and clearHoldMutation REMOVED.
  // Generic status mutations allowed invalid transitions (e.g. completed → open).
  // All lifecycle transitions now use canonical endpoints:
  // - Complete: POST /api/jobs/:id/close (via JobHeaderCard)
  // - Reopen: POST /api/jobs/:id/reopen (via JobHeaderCard)
  // - Put on Hold: ActionRequiredModal → POST /api/jobs/:id/status
  // - Resume from Hold: Schedule Visit clears hold server-side

  // Unschedule mutation — visit-centric (2026-03-06)
  const unscheduleMutation = useUnscheduleVisit();

  // Inline description update — uses existing PATCH /api/jobs/:id endpoint
  const updateDescriptionMutation = useMutation({
    mutationFn: async (description: string | null) => {
      return apiRequest(`/api/jobs/${jobId}`, {
        method: "PATCH",
        body: JSON.stringify({ description, version: job?.version }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to update description", variant: "destructive" });
    },
  });

  const handleDescriptionSave = useCallback(() => {
    if (!job) return;
    const trimmed = descriptionDraft.trim();
    const newVal = trimmed || null;
    if (newVal !== (job.description || null)) {
      updateDescriptionMutation.mutate(newVal);
    }
    setEditingDescription(false);
  }, [descriptionDraft, job, updateDescriptionMutation]);

  const handleDescriptionCancel = useCallback(() => {
    setEditingDescription(false);
    setDescriptionDraft(job?.description || "");
  }, [job?.description]);

  // Inline job number update — uses PATCH /api/jobs/:id with uniqueness validation
  const updateJobNumberMutation = useMutation({
    mutationFn: async (newJobNumber: number) => {
      return apiRequest(`/api/jobs/${jobId}`, {
        method: "PATCH",
        body: JSON.stringify({ jobNumber: newJobNumber, version: job?.version }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      setJobNumberError(null);
      setEditingJobNumber(false);
    },
    onError: (error: Error) => {
      // Show inline error for duplicate job number
      setJobNumberError(error.message || "Failed to update job number");
    },
  });

  const handleJobNumberSave = useCallback(() => {
    if (!job) return;
    setJobNumberError(null);
    const parsed = parseInt(jobNumberDraft, 10);
    if (isNaN(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
      setJobNumberError("Must be a positive whole number");
      return;
    }
    if (parsed === job.jobNumber) {
      setEditingJobNumber(false);
      return;
    }
    updateJobNumberMutation.mutate(parsed);
  }, [jobNumberDraft, job, updateJobNumberMutation]);

  const handleJobNumberCancel = useCallback(() => {
    setEditingJobNumber(false);
    setJobNumberDraft(String(job?.jobNumber || ""));
    setJobNumberError(null);
  }, [job?.jobNumber]);

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

  // createInvoiceMutation extracted to CreateInvoiceFromJobDialog (2026-03-22)

  // handleStatusChange removed (2026-03-24) — no longer used, generic status mutation eliminated

  const handleDelete = () => {
    deleteJobMutation.mutate();
    setShowDeleteConfirm(false);
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

  // Header-level computed values (same as JobHeaderCard but needed for command-center header)
  // 2026-04-10: location name takes priority, company name is fallback
  const clientName = job.parentCompany ? getClientDisplayName(job.parentCompany) : (job.location?.companyName || "Client");
  const fullAddress = job.location
    ? [job.location.address, job.location.address2, job.location.city, job.location.province, job.location.postalCode].filter(Boolean).join(", ")
    : "";

  return (
    <div className="bg-[#f1f5f9] h-full flex flex-col" data-testid="job-detail-page">
      {/* Hidden: JobHeaderCard kept for dialog/mutation logic via imperative ref */}
      <div className="hidden">
        <JobHeaderCard
          ref={headerCardRef}
          job={job}
          jobInvoice={jobInvoice ?? null}
          onEdit={() => setShowEditDialog(true)}
          onDelete={() => deleteJobMutation.mutate()}
          showActions={false}
        />
      </div>

      <div className="px-4 lg:px-6 py-4 flex-1 flex flex-col min-h-0">
        {/* Two-pane layout: both columns fill available height, each scrolls independently */}
        {/* lg:grid-rows-[1fr] forces the single row to fill the grid's flex-1 height
            instead of sizing to content (the default auto). Without this, the auto row
            expands to content height, h-full on columns resolves to that expanded height,
            overflow-y-auto never activates, and <main overflow-auto> scrolls the whole page. */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] lg:grid-rows-[1fr] gap-4 flex-1 min-h-0" data-testid="job-body-area">

        {/* ════════════════════════════════════════════════════════════════
            LEFT COLUMN — independently scrollable primary content
            ════════════════════════════════════════════════════════════════ */}
        <div className="space-y-2.5 min-w-0 min-h-0 overflow-y-auto lg:pr-1 h-full">

          {/* Phase 15 (2026-04-12): email delivery status + resend. */}
          <DeliveryStatusCard entityType="job" entityId={job.id} />

          {/* ── Unified Header + Action Bar ────────────────────────────── */}
          <div className="bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden" data-testid="job-header-command">
            {/* Section A: Header content — title dominant, metadata right */}
            <div className="px-4 py-3">
              <div className="flex items-start justify-between gap-6">
                {/* Left: title → separator → company/address */}
                <div className="flex-1 min-w-0">
                  {/* Row 1: Title + status — title is the dominant element */}
                  <div className="flex items-center gap-2">
                    <h1 className="text-2xl font-bold text-slate-900 leading-snug truncate" data-testid="text-job-title">
                      {job.summary || "Untitled Job"}
                    </h1>
                    <StatusPill
                      variant={statusToVariant(job.openSubStatus === "on_hold" ? "on_hold" : job.status)}
                      data-testid="status-badge"
                    >
                      {getJobStatusDisplay(job).label}
                    </StatusPill>
                    {job.openSubStatus === "on_hold" && job.holdReason && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-orange-300 text-orange-700 bg-orange-50" data-testid="hold-reason-badge">
                        {getHoldReasonLabel(job.holdReason)}
                      </Badge>
                    )}
                  </div>
                  {/* Separator + company/address — more breathing room */}
                  <div className="border-t border-slate-100 mt-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setLocation(`/clients/${job.locationId}`)}
                      className="text-xs font-medium text-slate-600 hover:text-[#76B054] transition-colors truncate block"
                      data-testid="link-client-header"
                    >
                      {clientName}
                    </button>
                    {fullAddress && (
                      <span className="flex items-center gap-0.5 text-[11px] text-slate-400 mt-0.5">
                        <MapPin className="h-2.5 w-2.5 shrink-0" />
                        {fullAddress}
                      </span>
                    )}
                  </div>
                </div>
                {/* Right: metadata — left-aligned labels within block, block sits right */}
                <div className="shrink-0 w-48">
                  <table className="text-left text-xs w-full">
                    <tbody>
                      <tr>
                        <td className="text-[11px] text-slate-400 pr-3 py-0.5 whitespace-nowrap">Job #</td>
                        <td className="font-semibold text-slate-700 py-0.5">
                          {editingJobNumber ? (
                            <div className="flex items-center gap-1">
                              <input ref={jobNumberInputRef} type="number" min={1} step={1}
                                value={jobNumberDraft}
                                onChange={(e) => { setJobNumberDraft(e.target.value); setJobNumberError(null); }}
                                onKeyDown={(e) => { if (e.key === "Enter") handleJobNumberSave(); if (e.key === "Escape") handleJobNumberCancel(); }}
                                className="w-16 h-5 px-1 text-xs border rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                                autoFocus data-testid="input-job-number" />
                              <button type="button" onClick={handleJobNumberSave} className="text-primary text-[10px] font-medium" disabled={updateJobNumberMutation.isPending}>{updateJobNumberMutation.isPending ? "…" : "✓"}</button>
                              <button type="button" onClick={handleJobNumberCancel} className="text-muted-foreground text-[10px]">✕</button>
                            </div>
                          ) : (
                            <button type="button" onClick={() => { setJobNumberDraft(String(job.jobNumber)); setJobNumberError(null); setEditingJobNumber(true); }}
                              className="group cursor-text" data-testid="text-job-number">
                              {job.jobNumber}
                              <Pencil className="inline ml-0.5 h-2 w-2 opacity-0 group-hover:opacity-40 transition-opacity" />
                            </button>
                          )}
                          {jobNumberError && <div className="text-[9px] text-destructive">{jobNumberError}</div>}
                        </td>
                      </tr>
                      <tr>
                        <td className="text-[11px] text-slate-400 pr-3 py-0.5 whitespace-nowrap">Invoice #</td>
                        <td className="py-0.5">
                          {jobInvoice ? (
                            <Link href={`/invoices/${jobInvoice.id}`} className="font-semibold text-primary hover:underline" data-testid="link-invoice">
                              {(jobInvoice as any).invoiceNumber || "—"}
                            </Link>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                      </tr>
                      <tr>
                        <td className="text-[11px] text-slate-400 pr-3 py-0.5 whitespace-nowrap">Created</td>
                        <td className="text-slate-600 py-0.5">{job.createdAt ? format(new Date(job.createdAt), "MMM d, yyyy") : "—"}</td>
                      </tr>
                      <tr>
                        <td className="text-[11px] text-slate-400 pr-3 py-0.5 whitespace-nowrap">Completed</td>
                        <td className="text-slate-600 py-0.5">{job.closedAt ? format(new Date(job.closedAt), "MMM d, yyyy") : "—"}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            {/* Section B: Action row — visually unified with header via shared container */}
            <div className="px-4 py-1.5 border-t border-slate-200/60 flex items-center gap-1.5 flex-wrap" data-testid="action-bar">
              {/* Hold — only for active open jobs, never for completed/archived/invoiced */}
              {job.status === "open" && (
                <Button variant="outline" size="sm" className="gap-1 text-xs h-7 text-amber-600 border-amber-200 hover:bg-amber-50 hover:text-amber-700" onClick={() => setShowActionRequiredModal(true)} data-testid="button-hold-action">
                  <Pause className="h-3.5 w-3.5" />
                  Hold
                </Button>
              )}
              {/* Spacer pushes right group to far right */}
              <div className="flex-1" />
              {/* Right group: primary CTA + overflow */}
              {job.status === "open" && (
                <Button
                  size="sm"
                  className="bg-green-600 hover:bg-green-700 text-white gap-1.5 h-7"
                  onClick={handleScheduleVisit}
                  data-testid="button-schedule-visit-action"
                >
                  <CalendarPlus className="h-3.5 w-3.5" />
                  Schedule Visit
                </Button>
              )}
              {job.status === "completed" && isOfficeUser && (
                <Button
                  size="sm"
                  className="bg-green-600 hover:bg-green-700 text-white gap-1.5 h-7"
                  onClick={() => { jobInvoice ? setLocation(`/invoices/${jobInvoice.id}`) : setShowCreateInvoiceDialog(true); }}
                  data-testid="button-invoice-action"
                >
                  <Receipt className="h-3.5 w-3.5" />
                  {jobInvoice ? "View Invoice" : "Create Invoice"}
                </Button>
              )}
              {job.status === "archived" && isOfficeUser && (
                <Button
                  size="sm"
                  className="bg-green-600 hover:bg-green-700 text-white gap-1.5 h-7"
                  onClick={() => headerCardRef.current?.triggerReopenJob()}
                  data-testid="button-restore-job"
                >
                  Restore Job
                </Button>
              )}
              {/* Overflow menu — icon-only, furthest right */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" data-testid="button-more-actions">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setShowEditDialog(true)} data-testid="menu-edit-job">
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit Job
                  </DropdownMenuItem>
                  {job.status === "open" && isOfficeUser && (
                    <DropdownMenuItem onClick={() => setShowCompleteJobConfirm(true)} className="text-emerald-600 font-medium" data-testid="button-complete-job">
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Complete Job
                    </DropdownMenuItem>
                  )}
                  {job.status === "open" && job.openSubStatus !== "on_hold" && isOfficeUser && (
                    <DropdownMenuItem onClick={() => setShowActionRequiredModal(true)} data-testid="button-put-on-hold">
                      <Pause className="h-4 w-4 mr-2" />
                      Put on Hold
                    </DropdownMenuItem>
                  )}
                  {job.status === "completed" && isOfficeUser && (
                    <DropdownMenuItem onClick={() => headerCardRef.current?.openCloseJobDialog()} data-testid="button-archive-job">
                      <Archive className="h-4 w-4 mr-2" />
                      Archive Job
                    </DropdownMenuItem>
                  )}
                  {(job.status === "completed" || job.status === "archived") && isOfficeUser && (
                    <DropdownMenuItem onClick={() => headerCardRef.current?.triggerReopenJob()} data-testid="menu-reopen-job">
                      <RotateCcw className="h-4 w-4 mr-2" />
                      Reopen Job
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  {/* Phase 12 (2026-04-12): dispatch a customer-facing job email. */}
                  {isOfficeUser && (
                    <DropdownMenuItem onClick={() => setShowSendJobEmail(true)} data-testid="menu-send-job-email">
                      <Send className="h-4 w-4 mr-2" />
                      Send Email
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => setLocation(`/jobs/new?cloneFrom=${job.id}`)} data-testid="menu-create-similar">
                    <Copy className="h-4 w-4 mr-2" />
                    Create Similar Job
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => window.print()} data-testid="menu-print">
                    <Printer className="h-4 w-4 mr-2" />
                    Print
                  </DropdownMenuItem>
                  {isOfficeUser && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setShowDeleteConfirm(true)} className="text-destructive" data-testid="menu-delete-job">
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete Job
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* ── Job Description Card (collapsed by default) ──────────── */}
          <div className="rounded-md border border-slate-200 bg-white shadow-sm overflow-hidden" data-testid="job-description-card">
            <Collapsible open={descriptionExpanded} onOpenChange={setDescriptionExpanded}>
              <CollapsibleTrigger asChild>
                <button
                  className={cn(
                    "w-full px-4 py-2.5 flex items-center justify-between transition-colors hover:bg-slate-50",
                    descriptionExpanded && "border-b border-slate-200",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-slate-400" />
                    <span className="text-sm font-semibold text-slate-700">Job Description</span>
                    {!descriptionExpanded && job.description && (
                      <span className="text-xs text-slate-400 truncate max-w-[200px]">{job.description}</span>
                    )}
                  </div>
                  <ChevronDown className={cn("h-4 w-4 text-slate-400 transition-transform", descriptionExpanded && "rotate-180")} />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-4 py-3" data-testid="text-job-description">
                  {editingDescription ? (
                    <div className="space-y-1">
                      <textarea
                        ref={descInputRef}
                        value={descriptionDraft}
                        onChange={e => {
                          setDescriptionDraft(e.target.value);
                          const el = e.target;
                          el.style.height = "auto";
                          el.style.height = Math.min(el.scrollHeight, 120) + "px";
                        }}
                        onKeyDown={e => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleDescriptionSave(); }
                          if (e.key === "Escape") handleDescriptionCancel();
                        }}
                        rows={2}
                        style={{ minHeight: "48px", maxHeight: "120px" }}
                        className="w-full text-sm text-slate-700 bg-transparent border border-primary/30 focus:border-primary rounded px-2 outline-none resize-none py-1.5 placeholder:text-slate-400 overflow-y-auto"
                        placeholder="Add description…"
                        autoFocus
                        onFocus={e => {
                          const el = e.target;
                          el.style.height = "auto";
                          el.style.height = Math.min(el.scrollHeight, 120) + "px";
                        }}
                      />
                      <div className="flex items-center gap-1.5">
                        <button type="button" onClick={handleDescriptionSave} disabled={updateDescriptionMutation.isPending}
                          className="inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:text-primary/80 disabled:opacity-50" data-testid="button-description-save">
                          <Check className="h-3 w-3" /> Save
                        </button>
                        <button type="button" onClick={handleDescriptionCancel}
                          className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-muted-foreground/80" data-testid="button-description-cancel">
                          <X className="h-3 w-3" /> Cancel
                        </button>
                        <span className="text-[9px] text-muted-foreground/40 ml-auto">Cmd+Enter to save</span>
                      </div>
                    </div>
                  ) : (
                    <div
                      className="group flex items-start gap-1.5 cursor-pointer"
                      onClick={() => { setDescriptionDraft(job.description || ""); setEditingDescription(true); }}
                      data-testid="button-edit-description"
                      role="button" tabIndex={0}
                      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDescriptionDraft(job.description || ""); setEditingDescription(true); } }}
                    >
                      {job.description && job.description.trim() !== "" ? (
                        <p className="text-sm text-slate-600 whitespace-pre-wrap flex-1 min-w-0 group-hover:text-slate-800 transition-colors">
                          {job.description}
                        </p>
                      ) : (
                        <p className="text-sm text-slate-400 italic group-hover:text-slate-500 transition-colors">
                          Click to add description…
                        </p>
                      )}
                      <Pencil className="h-3.5 w-3.5 text-slate-300 group-hover:text-slate-500 transition-colors shrink-0 mt-0.5" />
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>

          {/* ── Unified Card: Parts, Labour & Expenses ────────────────── */}
          <div id="parts-billing-section" className="rounded-md border border-slate-200 bg-white shadow-sm overflow-hidden" data-testid="job-main-card">
            <Collapsible open={billingExpanded} onOpenChange={setBillingExpanded}>
              <CollapsibleTrigger asChild>
                <button
                  className={cn(
                    "w-full flex items-center justify-between px-5 py-3 transition-colors",
                    "bg-slate-50 hover:bg-slate-100",
                    billingExpanded && "border-b border-slate-200",
                  )}
                  data-testid="trigger-parts-billing"
                >
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-5 w-5 text-slate-900" />
                    <span className="text-xl font-bold text-slate-900 tracking-tight">Parts, Labour & Expenses</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {/* Collapsed profit snapshot */}
                    {!billingExpanded && billingTotals && (() => {
                      const profit = billingTotals.totalPrice - billingTotals.totalCost - labourCostAmount - expenseTotalAmount;
                      return (
                        <span className={cn("text-xs font-bold", profit >= 0 ? "text-green-600" : "text-red-600")}>
                          ${billingTotals.totalPrice.toFixed(2)} rev / ${profit.toFixed(2)} profit
                        </span>
                      );
                    })()}
                    {billingExpanded
                      ? <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
                      : <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
                    }
                  </div>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                {/* Line Items (Parts) */}
                <div className="[&>*]:border-0 [&>*]:rounded-none [&>*]:shadow-none [&>*]:bg-transparent" data-testid="parts-billing-wrapper">
                  <PartsBillingCard jobId={jobId!} onTotalsChange={setBillingTotals} />
                </div>

                {/* Expenses — flows as continuation, no separate sub-header */}
                <div className="border-t border-slate-100" data-testid="section-expenses">
                  <JobExpensesCard jobId={jobId!} />
                </div>

                {/* Compact totals footer — clean card ending */}
                {billingTotals && (
                  <div className="border-t border-slate-200 px-5 py-2.5 bg-slate-50/60 flex items-center justify-end gap-5 text-xs" data-testid="card-totals-footer">
                    <span className="text-slate-400">Total Cost <strong className="text-slate-700 ml-1">${billingTotals.totalCost.toFixed(2)}</strong></span>
                    <span className="text-slate-400">Total Price <strong className="text-slate-900 ml-1">${billingTotals.totalPrice.toFixed(2)}</strong></span>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>

            {/* PM Billing Disposition — guidance for PM-generated jobs */}
            {job.pmBillingDisposition && (
              <div className="border-t border-slate-200 px-5 py-4" data-testid="section-pm-billing">
                <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2 mb-3">
                  <Briefcase className="h-4 w-4 text-slate-500" />
                  PM Billing
                </h3>
                <div className="space-y-2 text-sm">
                  {job.pmBillingLabel && (
                    <MetaRow label="Contract" value={job.pmBillingLabel} />
                  )}
                  <MetaRow label="Billing model" value={
                    job.pmBillingModel === "per_visit" ? "Per Visit" :
                    job.pmBillingModel === "monthly_fixed" ? "Monthly Fixed" :
                    job.pmBillingModel === "annual_prepaid" ? "Annual Prepaid" :
                    job.pmBillingModel === "do_not_bill" ? "Do Not Bill" : "Not set"
                  } />
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Job billing action</span>
                    <Badge variant="outline" className={cn(
                      "text-xs",
                      job.pmBillingDisposition === "invoice_on_completion"
                        ? "border-blue-300 bg-blue-50 text-blue-700"
                        : job.pmBillingDisposition === "covered_by_contract"
                        ? "border-green-300 bg-green-50 text-green-700"
                        : "border-gray-300 bg-gray-50 text-gray-600"
                    )}>
                      {job.pmBillingDisposition === "invoice_on_completion" ? "Invoice required on completion" :
                       job.pmBillingDisposition === "covered_by_contract" ? "Covered by PM contract" :
                       job.pmBillingDisposition === "archive_no_invoice" ? "No job invoice expected" :
                       job.pmBillingDisposition}
                    </Badge>
                  </div>
                  {job.status === "completed" && (
                    <div className={cn(
                      "mt-2 p-2.5 rounded-md text-xs",
                      job.pmBillingDisposition === "invoice_on_completion"
                        ? "bg-blue-50 text-blue-800 border border-blue-200"
                        : "bg-green-50 text-green-800 border border-green-200"
                    )}>
                      {job.pmBillingDisposition === "invoice_on_completion"
                        ? "This PM job should be invoiced. Create an invoice to close out this job."
                        : job.pmBillingDisposition === "covered_by_contract"
                        ? "This PM job is covered by the contract. No per-job invoice needed — mark as invoiced or archive."
                        : "No invoice is expected for this job. You can archive it directly."}
                    </div>
                  )}
                  {job.pmBillingStatus && (
                    <div className="flex justify-between items-center pt-1">
                      <span className="text-muted-foreground">Billing status</span>
                      <span className={cn("text-xs font-medium",
                        job.pmBillingStatus === "invoiced" ? "text-green-600" :
                        job.pmBillingStatus === "pending_invoice" ? "text-blue-600" :
                        job.pmBillingStatus === "no_invoice_expected" ? "text-gray-500" :
                        job.pmBillingStatus === "billing_exception" ? "text-red-600" : ""
                      )}>
                        {job.pmBillingStatus === "invoiced" ? "Invoiced" :
                         job.pmBillingStatus === "pending_invoice" ? "Pending invoice" :
                         job.pmBillingStatus === "no_invoice_expected" ? "No invoice expected" :
                         job.pmBillingStatus === "billing_exception" ? "Billing exception" :
                         job.pmBillingStatus}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Recurring series */}
            {job.recurringSeries && (
              <div className="border-t border-slate-200 px-5 py-4" data-testid="section-recurring">
                <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
                  <Repeat className="h-4 w-4 text-muted-foreground/70" />
                  Recurring Series
                </h3>
                <p className="text-sm" data-testid="text-series-summary">{job.recurringSeries.baseSummary}</p>
              </div>
            )}
          </div>

          {/* ── Visits + Activity ─────────────────────────────────────── */}
          <div className="rounded-md border border-slate-200 bg-white shadow-sm overflow-hidden" data-testid="section-visits-activity">
            <div id="visits-section" data-testid="section-visits">
              <div className="flex items-center justify-between px-5 py-3 bg-slate-50 border-b border-slate-200">
                <span className="text-[13px] font-bold text-slate-900 tracking-tight flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-slate-900" />
                  Visits
                </span>
                <span className="text-[11px] text-slate-400 font-medium">{allVisits.length} total</span>
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
                          {getVisitCrewLabel(visit as any)}
                        </span>
                        {visit.status !== "scheduled" && (
                          <Badge className={cn("text-[9px] px-1.5 py-0 shrink-0 leading-tight", VISIT_STATUS_COLORS[visit.status] || "")}>
                            {visitStatusLabel(visit.status)}
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

            {/* Activity — collapsed by default */}
            <Collapsible open={activityOpen} onOpenChange={setActivityOpen}>
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center justify-between px-5 py-3 bg-slate-50 hover:bg-slate-100 transition-colors border-t border-slate-200" data-testid="trigger-activity">
                  <span className="text-[13px] font-bold text-slate-900 tracking-tight">Activity</span>
                  {activityOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
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
            RIGHT COLUMN — sticky operations rail
            ════════════════════════════════════════════════════════════════ */}
        <aside className="space-y-3 min-h-0 overflow-y-auto h-full">

          {/* 1. JOB SUMMARY — collapsible, minimized by default, profit visible when collapsed */}
          <div className="bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden" data-testid="section-job-summary">
            <Collapsible open={jobSummaryExpanded} onOpenChange={setJobSummaryExpanded}>
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center justify-between px-4 py-2.5 bg-[#f8fafc] hover:bg-slate-100 transition-colors">
                  <span className="text-sm font-semibold text-[#0f172a] flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-[#64748b]" />
                    Job Summary
                  </span>
                  <div className="flex items-center gap-2">
                    {/* Collapsed profit metric — always visible */}
                    {billingTotals && (() => {
                      const profit = billingTotals.totalPrice - billingTotals.totalCost - labourCostAmount - expenseTotalAmount;
                      const pct = billingTotals.totalPrice > 0 ? (profit / billingTotals.totalPrice) * 100 : 0;
                      return (
                        <span className={cn("text-xs font-bold tabular-nums", profit >= 0 ? "text-green-600" : "text-red-600")}>
                          {pct.toFixed(0)}% &bull; ${profit.toFixed(2)}
                        </span>
                      );
                    })()}
                    {jobSummaryExpanded
                      ? <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
                      : <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
                    }
                  </div>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border-t border-slate-200">
                  {billingTotals ? (
                    <div className="px-4 py-2.5 space-y-1.5 text-xs" data-testid="job-summary-rows">
                      {/* Revenue — sell-side total from line items */}
                      <div className="flex justify-between">
                        <span className="text-slate-500">Revenue</span>
                        <span className="font-medium text-slate-900 tabular-nums">${billingTotals.totalPrice.toFixed(2)}</span>
                      </div>
                      {/* Line Items — material/parts cost */}
                      <div className="flex justify-between">
                        <span className="text-slate-500">Line Items</span>
                        <span className="font-medium text-slate-700 tabular-nums">${billingTotals.totalCost.toFixed(2)}</span>
                      </div>
                      {/* Labour — uses labourCostAmount const (swap when labour costing is implemented) */}
                      <div className="flex justify-between">
                        <span className="text-slate-500">Labour</span>
                        <span className="font-medium text-slate-700 tabular-nums">${labourCostAmount.toFixed(2)}</span>
                      </div>
                      {/* Expenses — sum of all job expenses */}
                      <div className="flex justify-between">
                        <span className="text-slate-500">Expenses</span>
                        <span className="font-medium text-slate-700 tabular-nums">${expenseTotalAmount.toFixed(2)}</span>
                      </div>
                      {/* Total Cost — line items + labour + expenses */}
                      {(() => {
                        const totalCost = billingTotals.totalCost + labourCostAmount + expenseTotalAmount;
                        return (
                          <div className="flex justify-between pt-1 border-t border-slate-100">
                            <span className="text-slate-600 font-medium">Total Cost</span>
                            <span className="font-semibold text-slate-900 tabular-nums">${totalCost.toFixed(2)}</span>
                          </div>
                        );
                      })()}
                      {/* Profit — emphasized */}
                      {(() => {
                        const profit = billingTotals.totalPrice - billingTotals.totalCost - labourCostAmount - expenseTotalAmount;
                        const pct = billingTotals.totalPrice > 0 ? (profit / billingTotals.totalPrice) * 100 : 0;
                        return (
                          <div className={cn("flex justify-between pt-1 border-t border-slate-100", profit >= 0 ? "text-green-600" : "text-red-600")}>
                            <span className="font-semibold">Profit</span>
                            <span className="font-bold tabular-nums">{pct.toFixed(0)}% &bull; ${profit.toFixed(2)}</span>
                          </div>
                        );
                      })()}
                    </div>
                  ) : (
                    <div className="px-4 py-3 text-xs text-slate-400 italic">No billing data yet</div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>

          {/* 2. LABOUR SUMMARY — collapsible, open by default */}
          <div className="bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden" data-testid="section-labour">
            <Collapsible open={labourSummaryExpanded} onOpenChange={setLabourSummaryExpanded}>
              <CollapsibleTrigger asChild>
                <div className="w-full flex items-center justify-between px-4 py-2.5 bg-[#f8fafc] hover:bg-slate-100 transition-colors">
                  <button className="flex items-center gap-2 flex-1 min-w-0">
                    <Clock className="h-4 w-4 text-[#64748b]" />
                    <span className="text-sm font-semibold text-[#0f172a]">Labour Summary</span>
                    {pageLevelTimeSummary && pageLevelTimeSummary.totalMinutes > 0 && (
                      <span className="text-xs text-slate-500 tabular-nums">{formatMinutes(pageLevelTimeSummary.totalMinutes)}</span>
                    )}
                  </button>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); setTimeEntryModal({ open: true, mode: "create", entry: null }); }} title="Add Time" data-testid="button-add-time">
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                    {labourSummaryExpanded ? <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" /> : <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />}
                  </div>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border-t border-slate-200 px-4 py-2.5">
                  <LabourCardContent
                    jobId={jobId!}
                    onEditEntry={(entry) => {
                      setTimeEntryModal({ open: true, mode: "edit", entry });
                    }}
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>

          {/* 3. NOTES — collapsible */}
          <div className="bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden" data-testid="section-notes">
            <Collapsible open={notesExpanded} onOpenChange={setNotesExpanded}>
              <CollapsibleTrigger asChild>
                <div className="w-full flex items-center justify-between px-4 py-2.5 bg-[#f8fafc] hover:bg-slate-100 transition-colors">
                  <button className="flex items-center gap-2 flex-1 min-w-0">
                    <MessageSquare className="h-4 w-4 text-[#64748b]" />
                    <span className="text-sm font-semibold text-[#0f172a]">Notes</span>
                  </button>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); setShowAddNoteDialog(true); }} title="Add Note" data-testid="button-add-note">
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                    {notesExpanded ? <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" /> : <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />}
                  </div>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border-t border-slate-200">
                  <JobNotesSection jobId={job.id} embedded onCountChange={setNotesCount} hideAddButton hideHeader />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>

          {/* 4. REFERENCE — compact section in right rail */}
          <ReferenceFieldsSection entityType="job" entityId={job.id} />

          {/* 5. EQUIPMENT — collapsible, collapsed by default */}
          <JobEquipmentSection
            jobId={job.id}
            locationId={job.locationId}
            defaultOpen={false}
            externalAddOpen={showAddEquipmentDialog}
            onExternalAddOpenChange={setShowAddEquipmentDialog}
          />

        </aside>
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
        jobVersion={job.version ?? 0}
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
        conflictMode={conflictMode}
        conflictVisitId={conflictVisitId}
      />

      {/* Edit Visit Modal — canonical shared component (replaces VisitDetailDialog)
          2026-03-23: Pass full location/company context so header is identical to dispatch entry point. */}
      {selectedVisitId && (
        <EditVisitModal
          open={true}
          onOpenChange={(open) => { if (!open) setSelectedVisitId(null); }}
          jobId={job.id}
          visitId={selectedVisitId}
          customerName={job.parentCompany?.name || job.locationDisplayName || undefined}
          customerCompanyId={job.parentCompany?.id || job.location?.parentCompanyId || undefined}
          jobNumber={job.jobNumber}
          jobSummary={job.summary}
          locationName={job.location?.companyName || job.locationName || undefined}
          locationAddress={[job.location?.address || job.locationAddress, job.location?.city || job.locationCity].filter(Boolean).join(", ") || undefined}
          locationId={job.locationId || undefined}
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

      {/* 2026-03-24: Complete Job confirmation now delegates to canonical Close Job dialog
          in JobHeaderCard, which handles invoice_now/later/archive options and visit guardrails. */}
      <AlertDialog open={showCompleteJobConfirm} onOpenChange={setShowCompleteJobConfirm}>
        <AlertDialogContent data-testid="dialog-complete-job-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Complete Job</AlertDialogTitle>
            <AlertDialogDescription>
              Choose how to close this job: create an invoice now, invoice later, or archive without billing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-complete-job">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowCompleteJobConfirm(false);
                // Delegate to canonical Close Job dialog in JobHeaderCard
                headerCardRef.current?.openCloseJobDialog();
              }}
              data-testid="button-confirm-complete-job"
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Create Invoice from Job — canonical component */}
      <CreateInvoiceFromJobDialog
        open={showCreateInvoiceDialog}
        onOpenChange={setShowCreateInvoiceDialog}
        jobId={job.id}
        jobNumber={job.jobNumber}
        jobSummary={job.summary}
        jobStatus={job.status}
        locationDisplayName={job.locationDisplayName || "Unknown"}
        onCreated={(invoice) => {
          logActivity({
            type: "created",
            entityType: "invoice",
            entityId: invoice.id,
            label: `Created Invoice${invoice.invoiceNumber ? ` #${invoice.invoiceNumber}` : ""}`,
            meta: job?.locationDisplayName || undefined,
          });
          setLocation(`/invoices/${invoice.id}`);
        }}
      />

      {/* Header-level Add Note Dialog */}
      <AddJobNoteDialog
        jobId={job.id}
        open={showAddNoteDialog}
        onOpenChange={setShowAddNoteDialog}
      />

      {/* Canonical Time Entry Modal (create + edit) */}
      <TimeEntryModal
        open={timeEntryModal.open}
        onOpenChange={(open) => {
          if (!open) setTimeEntryModal({ open: false, mode: "create", entry: null });
        }}
        jobId={job.id}
        mode={timeEntryModal.mode}
        // 2026-04-12 (Option A): server-returned assignedTechnicianIds is the
        // visit-derived crew union for this job. Safe display-only read.
        assignedTechnicianIds={Array.isArray((job as any).assignedTechnicianIds) ? (job as any).assignedTechnicianIds : []}
        entry={timeEntryModal.entry}
      />

      {/* Phase 12 (2026-04-12): customer-facing job email modal. */}
      <SendJobModal
        jobId={job.id}
        isOpen={showSendJobEmail}
        onClose={() => setShowSendJobEmail(false)}
        onSuccess={() => {
          toast({ title: "Job email sent" });
        }}
      />
    </div>
  );
}
