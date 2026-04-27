import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { getClientDisplayName } from "@shared/clientDisplayName";
import { useToast } from "@/hooks/use-toast";
import { useActivityStore } from "@/lib/activityStore";
import {
  Archive,
  ArrowLeft,
  CheckCircle2,
  Pencil,
  Trash2,
  Loader2,
  Clock,
  AlertTriangle,
  DollarSign,
  Plus,
  Lock,
  CalendarPlus,
  Receipt,
  Pause,
  Copy,
  Printer,
  MoreHorizontal,
  MapPin,
  MessageSquare,
  Truck,
  RotateCcw,
  Send,
  Tag,
  Building2,
  ChevronDown,
  ChevronRight,
  Wrench,
  Calendar as CalendarIcon,
} from "lucide-react";
import { formatCurrency } from "@/lib/formatters";
import { useJobVisits } from "@/hooks/useJobVisits";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";
import { ReferenceFieldsSection } from "@/components/shared/ReferenceFieldsSection";
import JobEquipmentSection from "@/components/JobEquipmentSection";
import { AddVisitDialog } from "@/components/AddVisitDialog";
import { VisitEditorLauncher, type VisitEditorState } from "@/components/dispatch/VisitEditorLauncher";
// 2026-04-24: mandatory single path for every Edit Visit modal opening.
// JobDetailPage holds the rich context (job detail is already in memory);
// the adapter fast-paths and returns the partial unchanged. Routing through
// it keeps the single-adapter contract uniform across every surface.
import { enrichVisitEditorState } from "@/lib/visitEditorPayloadBuilder";
import JobNotesSection from "@/components/JobNotesSection";
import { PartsBillingCard } from "@/components/PartsBillingCard";
import { JobExpensesCard } from "@/components/JobExpensesCard";
import { QuickAddJobDialog } from "@/components/QuickAddJobDialog";
import { JobHeaderCard, type JobHeaderCardHandle } from "@/components/JobHeaderCard";
import { InvoiceCompositionDialog } from "@/components/InvoiceCompositionDialog";
import { JobNoteDialog } from "@/components/JobNoteDialog";
import { ActionRequiredModal, getHoldReasonLabel } from "@/components/ActionRequiredModal";
import { getJobStatusDisplay } from "@/components/job";
import { TimeEntryModal } from "@/components/time";
// Phase 12 (2026-04-12): customer-facing job email modal.
import { SendJobModal } from "@/components/communication/SendJobModal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusPill, statusToVariant } from "@/components/ui/status-pill";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import type { User as UserType, RecurringJobSeries, Invoice, JobTimeSummary, TimeEntryType } from "@shared/schema";
import { useJobHeader } from "@/hooks/useJobsFeed";
import type { JobHeaderDetail } from "@/hooks/useJobsFeed";

// ============================================================================
// PERMISSION HELPERS - Role-based action availability
// ============================================================================
import { MANAGER_ROLES } from "@/lib/roles";

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


// 2026-04-26: Removed `LabourCardContent` helper (~225 lines). The
// Labour Summary card is now built inline in the page body — driving
// vs on-site totals, expandable to a per-entry breakdown grouped by
// category. The new layout reads directly from the page-level
// `jobTimeEntries` query, so no new endpoint or query was added.
// `TimeEntryModal` still owns create/edit; per-row click still routes
// through `setTimeEntryModal({ open: true, mode: "edit", entry })`.

function __removedLabourCardContent__({
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

  // 2026-04-16: the card lives inside DetailPageShell's user-resizable
  // rail. Status labels ("En Route" / "On Site" / "Task" / "Manual")
  // collide with the duration+cost column once the rail narrows, so
  // swap text for lucide icons once the card falls below a tested
  // width. No viewport breakpoint — this must react to the rail's
  // own width, independent of the viewport.
  const containerRef = useRef<HTMLDivElement>(null);
  const [isCompact, setIsCompact] = useState(false);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const apply = (width: number) => setIsCompact(width < 320);
    apply(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) apply(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
    <div ref={containerRef} className="space-y-1">
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
              // 2026-04-16: status badge — icon-only under ~320px so it
              // stops colliding with duration/cost when the rail is narrow.
              const statusLabel = isTravel
                ? "En Route"
                : entry.sourceType === "task"
                  ? "Task"
                  : entry.sourceType === "manual"
                    ? "Manual"
                    : "On Site";
              const statusTone = isTravel
                ? "bg-blue-50 text-blue-600"
                : entry.sourceType === "task"
                  ? "bg-indigo-50 text-indigo-600"
                  : "bg-emerald-50 text-emerald-600";
              const StatusIcon = isTravel
                ? Truck
                : entry.sourceType === "task"
                  ? Tag
                  : entry.sourceType === "manual"
                    ? Pencil
                    : MapPin;
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
                    <span className="text-xs text-muted-foreground shrink-0">
                      {format(new Date(entry.startAt), "MMM d")}
                      {entry.startAt && entry.endAt && (
                        <span className="ml-0.5 text-slate-400">{format(new Date(entry.startAt), "h:mma")}–{format(new Date(entry.endAt), "h:mma")}</span>
                      )}
                    </span>
                    <span
                      className={cn(
                        "text-xs font-medium rounded-full shrink-0 inline-flex items-center",
                        statusTone,
                        isCompact ? "h-5 w-5 justify-center" : "px-1.5 py-0.5",
                      )}
                      title={statusLabel}
                      aria-label={statusLabel}
                    >
                      {isCompact ? <StatusIcon className="h-3 w-3" /> : statusLabel}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <div className="flex flex-col items-end">
                      <span className="font-medium tabular-nums">
                        {entry.durationMinutes != null ? formatMinutes(entry.durationMinutes) : (
                          <span className="text-green-600 flex items-center gap-1"><Clock className="h-3 w-3 animate-pulse" />Running</span>
                        )}
                      </span>
                      {cost && <span className="text-xs text-muted-foreground tabular-nums">${cost}</span>}
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
// Labour Summary — per-entry row (used in expanded breakdown).
// ============================================================================
function LabourEntryRow({
  entry,
  cost,
  onClick,
  hideTechName = false,
}: {
  entry: TimeEntryDisplay;
  cost: number;
  onClick: () => void;
  /** When true, don't render the technician name on the row — the
   *  caller is already rendering a per-tech grouping header above. */
  hideTechName?: boolean;
}) {
  const start = entry.startAt ? new Date(entry.startAt) : null;
  const end = entry.endAt ? new Date(entry.endAt) : null;
  const dateStr = start ? format(start, "MMM d") : "—";
  const timeRange =
    start && end ? `${format(start, "h:mm a")}–${format(end, "h:mm a")}` : start ? format(start, "h:mm a") : "";
  const isLocked = !!(entry.lockedAt || entry.invoicedAt);
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`labour-entry-${entry.id}`}
      className="w-full flex items-center justify-between gap-2 rounded px-2 py-1 text-left hover:bg-slate-50 transition-colors"
    >
      <div className="min-w-0 flex-1 flex items-center gap-2">
        {!hideTechName && (
          <span className="text-xs font-medium text-slate-700 truncate">{entry.technicianName || "Unknown"}</span>
        )}
        <span className="text-xs text-slate-400 truncate">
          {dateStr}
          {timeRange && <span className="ml-1 text-slate-300">{timeRange}</span>}
        </span>
        {isLocked && <Lock className="h-3 w-3 text-amber-500 shrink-0" />}
      </div>
      <div className="flex items-center gap-3 text-xs tabular-nums shrink-0">
        <span className="text-slate-700">
          {entry.durationMinutes != null ? formatMinutes(entry.durationMinutes) : "running"}
        </span>
        <span className="text-slate-500 w-16 text-right">{formatCurrency(cost)}</span>
      </div>
    </button>
  );
}

// ============================================================================
// Labour Summary — expanded-view row with aligned columns:
// [Category] [Time Range] [Duration] [Cost]. Tech name / date are
// rendered by the per-block header above, so this row never shows them.
// ============================================================================
function LabourEntryLine({
  entry,
  isTravel,
  cost,
  onClick,
}: {
  entry: TimeEntryDisplay;
  isTravel: boolean;
  cost: number;
  onClick: () => void;
}) {
  const start = entry.startAt ? new Date(entry.startAt) : null;
  const end = entry.endAt ? new Date(entry.endAt) : null;
  const timeRange =
    start && end
      ? `${format(start, "h:mm a")}–${format(end, "h:mm a")}`
      : start
        ? format(start, "h:mm a")
        : "—";
  const isLocked = !!(entry.lockedAt || entry.invoicedAt);
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`labour-entry-${entry.id}`}
      // 2026-04-26: time range uses `text-[11px] whitespace-nowrap` so
      // the full "10:49 AM–11:10 AM" form fits on one line at the
      // narrowest right-column width (≈360px). Label / duration / cost
      // stay at `text-xs` for readability. The grid was rebalanced to
      // give the time-range column more room (1fr) while keeping the
      // category, duration, and cost columns at fixed widths so the
      // four columns line up across rows.
      className="w-full grid grid-cols-[5.25rem_minmax(0,1fr)_3.25rem_4.25rem] items-center gap-x-2 rounded px-2 py-1 text-left text-xs hover:bg-slate-50 transition-colors"
    >
      <span className={isTravel ? "text-blue-600 font-medium" : "text-emerald-700 font-medium"}>
        {isTravel ? "Driving" : "On-Site"}
      </span>
      <span className="text-slate-500 text-[11px] whitespace-nowrap tabular-nums flex items-center gap-1 min-w-0">
        <span className="truncate">{timeRange}</span>
        {isLocked && <Lock className="h-3 w-3 text-amber-500 shrink-0" />}
      </span>
      <span className="text-slate-700 tabular-nums text-right">
        {entry.durationMinutes != null ? formatMinutes(entry.durationMinutes) : "running"}
      </span>
      <span className="text-slate-700 tabular-nums text-right">{formatCurrency(cost)}</span>
    </button>
  );
}

// ============================================================================
// MAIN PAGE COMPONENT
// ============================================================================
export default function JobDetailPage() {
  const [, params] = useRoute("/jobs/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { logActivity } = useActivityStore();

  // 2026-04-08: useDispatchStream() now mounted once at App.tsx root for all office surfaces.
  // 2026-04-26: ?section=visits deep-link removed alongside the inline
  // visits list. Calendar history-icon links now jump straight to the
  // visit's edit modal via VisitEditorLauncher.
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
  // Unified time entry modal: mode + optional entry for edit
  const [timeEntryModal, setTimeEntryModal] = useState<{
    open: boolean;
    mode: "create" | "edit";
    entry: TimeEntryDisplay | null;
  }>({ open: false, mode: "create", entry: null });
  // Visit editor state — kept so any future visit row clicks still route
  // through the canonical VisitEditorLauncher. The simplified layout no
  // longer renders an inline visits list; scheduling happens via the
  // header primary action which opens AddVisitDialog.
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);
  const [visitEditorState, setVisitEditorState] = useState<VisitEditorState | null>(null);
  // Inline job number editing
  const [editingJobNumber, setEditingJobNumber] = useState(false);
  const [jobNumberDraft, setJobNumberDraft] = useState("");
  const [jobNumberError, setJobNumberError] = useState<string | null>(null);
  const jobNumberInputRef = useRef<HTMLInputElement>(null);
  // 2026-03-24: Ref to JobHeaderCard for imperative lifecycle triggers (close/reopen/archive)
  const headerCardRef = useRef<JobHeaderCardHandle>(null);
  // Billing totals reported by PartsBillingCard — used for the Line Items subtotal footer
  const [billingTotals, setBillingTotals] = useState<{ totalPrice: number; totalCost: number; profit: number } | null>(null);
  // Parts section-edit state — lifted so the card-header "Add Item" button can drive it.
  // PartsBillingCard reads `isEditing` and calls `onExitEdit` on Cancel / Save success.
  const [partsEditMode, setPartsEditMode] = useState(false);
  // Header-level "Add Note" dialog (mounts canonical JobNoteDialog)
  const [showAddNoteDialog, setShowAddNoteDialog] = useState(false);
  // Header-level "Add Equipment" dialog trigger forwarded into JobEquipmentSection
  const [showAddEquipmentDialog, setShowAddEquipmentDialog] = useState(false);
  // 2026-04-18 Phase 2 (multi-visit): removed `conflictMode`,
  // `conflictVisitId`, and the `rescheduleConflict` dialog state. Under
  // multi-visit, clicking "Schedule Visit" always creates a new visit —
  // existing visits are untouched. To edit an existing visit, the user
  // clicks its row in the Visits list (which opens EditVisitModal keyed
  // on that specific visit id).
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

  // 2026-04-26: Visits card data sources. Uses the canonical
  // `useJobVisits` hook (key family `["visits", jobId, "all"]`) — same
  // hook the dispatch board, EditVisitModal, and JobHeaderCard already
  // consume. The hook fires `?all=true` so completed and cancelled
  // visits show in the history list. Tech directory provides display
  // names + colours for the assigned-tech chips.
  const { visits: jobVisitsAll = [], isLoading: jobVisitsLoading } = useJobVisits(jobId ?? "");
  const { teamMembers: techDirectory } = useTechniciansDirectory();
  const techByIdMap = useMemo(() => {
    const m = new Map<string, { name: string; color: string | null }>();
    for (const t of techDirectory) m.set(t.id, { name: t.fullName, color: t.color ?? null });
    return m;
  }, [techDirectory]);

  // 2026-04-26: time entries — single canonical source for the Labour
  // Summary card. The previous redesign also fetched `/time-summary`
  // for total cost and a derived billable-price total; the new card
  // surfaces only Driving + On-site cost (computed below from each
  // entry's `costRateSnapshot`), so neither query is mounted anymore.
  const { data: jobTimeEntries = [] } = useQuery<TimeEntryDisplay[]>({
    queryKey: ["/api/jobs", jobId, "time-entries"],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/time-entries`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!jobId,
    staleTime: 2 * 60_000,
  });

  // 2026-04-26: Labour Summary categorisation. Travel entries (driving
  // to/from a job, between jobs, to a supplier) bucket as "Driving";
  // everything else buckets as "On-site" — the dispatch board's existing
  // travel-vs-on-site visual split. Costs are derived from the canonical
  // `costRateSnapshot` field already on each entry; entries with no
  // snapshot contribute $0 (no crash). Each tech may have a different
  // rate, so we sum per-entry rather than per-tech.
  const TRAVEL_TYPES: ReadonlySet<TimeEntryType> = useMemo(
    () => new Set<TimeEntryType>(["travel_to_job", "travel_between_jobs", "travel_to_supplier"]),
    [],
  );
  const entryCostDollars = (e: TimeEntryDisplay): number => {
    if (e.durationMinutes == null || !e.costRateSnapshot) return 0;
    const rate = parseFloat(e.costRateSnapshot);
    if (!Number.isFinite(rate)) return 0;
    return (e.durationMinutes / 60) * rate;
  };
  const labourBuckets = useMemo(() => {
    const driving: TimeEntryDisplay[] = [];
    const onSite: TimeEntryDisplay[] = [];
    for (const e of jobTimeEntries) {
      if (TRAVEL_TYPES.has(e.type)) driving.push(e);
      else onSite.push(e);
    }
    const sumMinutes = (rows: TimeEntryDisplay[]) =>
      rows.reduce((s, r) => s + (r.durationMinutes ?? 0), 0);
    const sumCost = (rows: TimeEntryDisplay[]) => rows.reduce((s, r) => s + entryCostDollars(r), 0);
    return {
      driving: { entries: driving, minutes: sumMinutes(driving), cost: sumCost(driving) },
      onSite: { entries: onSite, minutes: sumMinutes(onSite), cost: sumCost(onSite) },
      totalMinutes: sumMinutes(driving) + sumMinutes(onSite),
      totalCost: sumCost(driving) + sumCost(onSite),
    };
  }, [jobTimeEntries, TRAVEL_TYPES]);

  // 2026-04-26: expanded-view grouping. Blocks are keyed by
  // (technicianId, local-date) so the spec's "Name · Date" header is
  // always accurate even when a tech has entries on multiple days. Each
  // block carries a chronologically-sorted entry list, and a per-block
  // subtotal in minutes / cost. Labour costs use each entry's
  // `costRateSnapshot` (the rate captured at entry-creation time);
  // changing a team member's rate later affects future entries only —
  // historical entries keep the rate that was current when they were
  // recorded. Entries with a missing or non-numeric snapshot contribute
  // $0.00.
  type TechDayLabourBlock = {
    key: string;
    technicianId: string;
    name: string;
    dateLabel: string;
    dateSortKey: string;
    entries: TimeEntryDisplay[];
    totalMinutes: number;
    totalCost: number;
  };
  const labourByTechDay: TechDayLabourBlock[] = useMemo(() => {
    const map = new Map<string, TechDayLabourBlock>();
    for (const e of jobTimeEntries) {
      if (!e.startAt) continue;
      const start = new Date(e.startAt);
      if (Number.isNaN(start.getTime())) continue;
      const techId = e.technicianId || "__unknown__";
      const dateSortKey = format(start, "yyyy-MM-dd");
      const dateLabel = format(start, "MMM d");
      const key = `${techId}::${dateSortKey}`;
      let block = map.get(key);
      if (!block) {
        block = {
          key,
          technicianId: techId,
          name: e.technicianName || "Unknown",
          dateLabel,
          dateSortKey,
          entries: [],
          totalMinutes: 0,
          totalCost: 0,
        };
        map.set(key, block);
      }
      block.entries.push(e);
      block.totalMinutes += e.durationMinutes ?? 0;
      block.totalCost += entryCostDollars(e);
    }
    const byStart = (a: TimeEntryDisplay, b: TimeEntryDisplay) =>
      new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
    const blocks = Array.from(map.values());
    blocks.forEach((block) => block.entries.sort(byStart));
    // Recent dates first within a tech; alphabetical across techs.
    return blocks.sort((a, b) => {
      const byTech = a.name.localeCompare(b.name);
      if (byTech !== 0) return byTech;
      return b.dateSortKey.localeCompare(a.dateSortKey);
    });
  }, [jobTimeEntries]);

  // 2026-04-26: per-card collapse state. Each card has a "user-toggled"
  // flag so once the user manually opens or closes it we stop reacting
  // to data changes — avoids flicker if a note/labour entry is added
  // while the card is in a chosen state. Default is collapsed when the
  // card is empty, expanded when it has data. Notes count is reported by
  // `JobNotesSection` via its `onCountChange` callback. Equipment count
  // is reported via the new `onCountChange` prop added below. Labour is
  // derived from `jobTimeEntries.length` already in scope here.
  const [labourOpen, setLabourOpen] = useState<boolean>(true);
  const [labourUserToggled, setLabourUserToggled] = useState(false);
  // 2026-04-26: separate "expanded" state controls whether the
  // per-team-member breakdown is shown alongside the totals. Default
  // is collapsed (totals only) per spec; user toggles via the same
  // header chevron when entries exist.
  const [labourExpanded, setLabourExpanded] = useState<boolean>(false);
  const [notesOpen, setNotesOpen] = useState<boolean>(true);
  const [notesUserToggled, setNotesUserToggled] = useState(false);
  const [notesCount, setNotesCount] = useState<number | null>(null);
  const [equipmentOpen, setEquipmentOpen] = useState<boolean>(true);
  const [equipmentUserToggled, setEquipmentUserToggled] = useState(false);
  const [equipmentCount, setEquipmentCount] = useState<number | null>(null);

  // Auto-collapse when data resolves and the user hasn't intervened.
  useEffect(() => {
    if (labourUserToggled) return;
    setLabourOpen(jobTimeEntries.length > 0);
  }, [jobTimeEntries.length, labourUserToggled]);
  useEffect(() => {
    if (notesUserToggled || notesCount === null) return;
    setNotesOpen(notesCount > 0);
  }, [notesCount, notesUserToggled]);
  useEffect(() => {
    if (equipmentUserToggled || equipmentCount === null) return;
    setEquipmentOpen(equipmentCount > 0);
  }, [equipmentCount, equipmentUserToggled]);

  // 2026-04-26 redesign: the inline Visits list and Activity card were
  // removed from this page. Visit scheduling now happens via the header
  // primary action (AddVisitDialog); editing a specific visit still
  // routes through `selectedVisitId` + the canonical VisitEditorLauncher
  // so deep-links keep working. Helpers that drove the old visits list
  // (sortedVisits, formatVisitDate, getVisitTechName, getVisitCrewLabel,
  // VISIT_STATUS_COLORS) and the technicians directory hook were dropped
  // because no surface on this page reads them anymore.
  const handleScheduleVisit = () => {
    setShowScheduleVisitDialog(true);
  };

  // Phase 4 Step C3: Use canonical useJobHeader with ['jobs', 'detail', jobId] key
  const { data: job, isLoading, error } = useJobHeader(jobId) as {
    data: JobDetailResponse | undefined;
    isLoading: boolean;
    error: Error | null;
  };

  // 2026-04-24: hydrate `visitEditorState` via the canonical adapter
  // whenever `selectedVisitId` or the underlying job changes. The inline
  // ternary that used to live at the VisitEditorLauncher mount has been
  // replaced by this effect so every Edit Visit modal opening on this page
  // routes through `enrichVisitEditorState`. The page holds the full job
  // detail in memory so the adapter fast-paths (no network call) — the
  // routing is for contract uniformity, not performance.
  useEffect(() => {
    if (!selectedVisitId || !job) {
      setVisitEditorState(null);
      return;
    }
    let cancelled = false;
    const addressParts = [
      job.location?.address || job.locationAddress,
      job.location?.city || job.locationCity,
    ].filter(Boolean) as string[];
    enrichVisitEditorState(selectedVisitId, job.id, {
      customerName: job.parentCompany?.name || job.locationDisplayName || undefined,
      customerCompanyId: job.parentCompany?.id || job.location?.parentCompanyId || undefined,
      jobNumber: job.jobNumber,
      jobSummary: job.summary,
      locationName: job.location?.companyName || job.locationName || undefined,
      locationAddress: addressParts.join(", ") || undefined,
      locationId: job.locationId || undefined,
    }).then((next) => {
      if (!cancelled) setVisitEditorState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedVisitId, job]);

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

  // 2026-04-19 audit fix: plural invoice existence for header-button
  // logic. Reuses `JobInvoicesCard`'s canonical query key so the fetch
  // dedups via React Query cache — no extra network call. Needed because
  // `jobInvoice` (primary pointer) can be null even when siblings exist
  // (e.g. primary deleted without reassignment), in which case the old
  // "Create Invoice" button was offered alongside the plural list.
  const { data: jobInvoicesFeed } = useQuery<{ data: Invoice[] } | undefined>({
    queryKey: ["invoices", "list", { jobId }],
    queryFn: async () => {
      const res = await fetch(
        `/api/invoices/list?jobId=${encodeURIComponent(jobId!)}`,
        { credentials: "include" },
      );
      if (!res.ok) return undefined;
      return res.json();
    },
    enabled: !!jobId,
    staleTime: 30_000,
  });
  const jobInvoiceCount = Array.isArray(jobInvoicesFeed?.data)
    ? jobInvoicesFeed!.data.length
    : 0;
  const firstJobInvoice = jobInvoicesFeed?.data?.[0] ?? null;

  // 2026-03-24: updateStatusMutation and clearHoldMutation REMOVED.
  // Generic status mutations allowed invalid transitions (e.g. completed → open).
  // All lifecycle transitions now use canonical endpoints:
  // - Complete: POST /api/jobs/:id/close (via JobHeaderCard)
  // - Reopen: POST /api/jobs/:id/reopen (via JobHeaderCard)
  // - Put on Hold: ActionRequiredModal → POST /api/jobs/:id/status
  // - Resume from Hold: Schedule Visit clears hold server-side

  // 2026-04-21 Phase 1.5: visit unschedule + schedule on this page are
  // owned by `EditVisitModal` (via `VisitEditorLauncher`) which consumes
  // `useDispatchPreviewMutations` internally. There is no per-page
  // unschedule mutation state — the prior `useUnscheduleVisit` hook that
  // used to live here was a parallel client orchestration path and has
  // been removed. Every visit write from this page routes through the
  // canonical hook via the modal.

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
  // 2026-04-26: address renders on two lines for readability — the
  // street(s) on row 1 and "City, Province PostalCode" on row 2. Either
  // line is suppressed if it's empty so single-line addresses still
  // render cleanly.
  const streetLine = job.location
    ? [job.location.address, job.location.address2].filter(Boolean).join(", ")
    : "";
  const cityProvince = job.location
    ? [job.location.city, job.location.province].filter(Boolean).join(", ")
    : "";
  const cityLine = job.location
    ? [cityProvince, job.location.postalCode].filter(Boolean).join(" ").trim()
    : "";

  return (
    <>
      {/* Hidden JobHeaderCard — kept mounted outside the shell for
          imperative ref access (`headerCardRef.current?.openCloseJobDialog`,
          `triggerReopenJob`). Staying outside the shell avoids a phantom
          top gap from the left column's `space-y` rhythm. */}
      <div className="hidden">
        <JobHeaderCard
          ref={headerCardRef}
          job={job}
          jobInvoice={jobInvoice ?? null}
          jobInvoices={jobInvoicesFeed?.data ?? []}
          onEdit={() => setShowEditDialog(true)}
          onDelete={() => deleteJobMutation.mutate()}
          showActions={false}
        />
      </div>

      {/* 2026-04-26 redesign: replaced DetailPageShell rail with a normal
          responsive content grid. Header is full-width; body splits into
          a left column (Line Items, Expenses) and a right column (Notes,
          Labour Summary, Equipment, Reference). All cards reuse existing
          canonical components and modal flows — no new data paths. */}
      <div className="min-h-screen bg-[#f1f5f9]" data-testid="job-detail-page">
        <div className="max-w-7xl mx-auto px-3 lg:px-4 py-3 space-y-2">
          {/* ─────────────── HEADER (full width) ───────────────
              Single full-width header card matching the canonical
              invoice card chrome (`rounded-md border border-slate-200
              shadow-sm`). Layout per approved mockup:
              - Left column: title + status pill, then client (Building2
                icon) and address (MapPin icon) stacked underneath.
              - Middle: inline-horizontal metadata (Job #, Created,
                Completed) on the same row as the title (lg+); on
                smaller screens it wraps under the identity block.
              - Right: primary action button + overflow menu, on the
                same row as title and metadata. */}
          <div className="bg-white rounded-md border border-slate-200 shadow-sm" data-testid="job-header-command">
            <div className="px-4 py-2.5">
              <div className="flex flex-col lg:flex-row lg:items-start lg:gap-6">
                {/* Left: title row + identity rows */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-2xl font-bold text-slate-900 leading-snug" data-testid="text-job-title">
                      {job.summary || "Untitled Job"}
                    </h1>
                    <StatusPill
                      variant={statusToVariant(job.openSubStatus === "on_hold" ? "on_hold" : job.status)}
                      data-testid="status-badge"
                    >
                      {getJobStatusDisplay(job).label}
                    </StatusPill>
                    {job.openSubStatus === "on_hold" && job.holdReason && (
                      <Badge variant="outline" className="text-xs px-1.5 py-0 border-orange-300 text-orange-700 bg-orange-50" data-testid="hold-reason-badge">
                        {getHoldReasonLabel(job.holdReason)}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1.5 space-y-0.5">
                    {/* Row 2: company / client (slightly stronger weight) */}
                    <button
                      type="button"
                      onClick={() => setLocation(`/clients/${job.locationId}`)}
                      className="flex items-center gap-1 text-sm font-semibold text-slate-800 hover:text-[#76B054] transition-colors max-w-full"
                      data-testid="link-client-header"
                    >
                      <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span className="truncate">{clientName}</span>
                    </button>
                    {/* Rows 3 + 4: street on its own line, then city,
                        province, postal on a second line. Either line
                        is omitted if empty so single-line addresses
                        still render cleanly. The MapPin icon attaches
                        to the first non-empty line only — the second
                        line indents by `pl-4.5` so it visually aligns
                        underneath the street, not under the icon. */}
                    {(streetLine || cityLine) && (
                      <div className="text-xs text-slate-500 leading-snug" data-testid="text-job-address">
                        {streetLine && (
                          <div className="flex items-start gap-1">
                            <MapPin className="h-3 w-3 shrink-0 text-slate-400 mt-0.5" />
                            <span className="truncate" data-testid="text-job-address-street">{streetLine}</span>
                          </div>
                        )}
                        {cityLine && (
                          <div className={streetLine ? "pl-4 truncate" : "flex items-start gap-1"} data-testid="text-job-address-city">
                            {!streetLine && <MapPin className="h-3 w-3 shrink-0 text-slate-400 mt-0.5" />}
                            <span className="truncate">{cityLine}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Middle: inline-horizontal metadata (lg+) */}
                <div className="hidden lg:flex items-center gap-5 shrink-0 text-xs pt-1" data-testid="job-header-meta">
                  <div className="flex flex-col leading-tight">
                    <span className="text-slate-500">Job #</span>
                    <div className="font-semibold text-slate-800 mt-0.5">
                      {editingJobNumber ? (
                        <div className="flex items-center gap-1">
                          <input ref={jobNumberInputRef} type="number" min={1} step={1}
                            value={jobNumberDraft}
                            onChange={(e) => { setJobNumberDraft(e.target.value); setJobNumberError(null); }}
                            onKeyDown={(e) => { if (e.key === "Enter") handleJobNumberSave(); if (e.key === "Escape") handleJobNumberCancel(); }}
                            className="w-16 h-5 px-1 text-xs border rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                            autoFocus data-testid="input-job-number" />
                          <button type="button" onClick={handleJobNumberSave} className="text-primary text-xs font-medium" disabled={updateJobNumberMutation.isPending}>{updateJobNumberMutation.isPending ? "…" : "✓"}</button>
                          <button type="button" onClick={handleJobNumberCancel} className="text-muted-foreground text-xs">✕</button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => { setJobNumberDraft(String(job.jobNumber)); setJobNumberError(null); setEditingJobNumber(true); }}
                          className="group cursor-text" data-testid="text-job-number">
                          {job.jobNumber}
                          <Pencil className="inline ml-0.5 h-2 w-2 opacity-0 group-hover:opacity-40 transition-opacity" />
                        </button>
                      )}
                    </div>
                    {jobNumberError && <div className="text-xs text-destructive">{jobNumberError}</div>}
                  </div>
                  <div className="flex flex-col leading-tight">
                    <span className="text-slate-500">Created</span>
                    <span className="text-slate-700 mt-0.5" data-testid="text-job-created">
                      {job.createdAt ? format(new Date(job.createdAt), "MMM d, yyyy") : "—"}
                    </span>
                  </div>
                  <div className="flex flex-col leading-tight">
                    <span className="text-slate-500">Completed</span>
                    <span className="text-slate-700 mt-0.5" data-testid="text-job-completed">
                      {job.closedAt ? format(new Date(job.closedAt), "MMM d, yyyy") : "—"}
                    </span>
                  </div>
                </div>

                {/* Right: primary action + overflow menu (same row as title on lg+) */}
                <div className="flex items-center gap-1.5 shrink-0 mt-3 lg:mt-0">
                  {job.status === "open" && (
                    <Button
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 text-white gap-1.5"
                      onClick={handleScheduleVisit}
                      data-testid="button-schedule-visit-action"
                    >
                      <CalendarPlus className="h-4 w-4" />
                      Schedule Visit
                    </Button>
                  )}
                  {job.status === "completed" && isOfficeUser && (
                    <Button
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 text-white gap-1.5"
                      onClick={() => {
                        if (jobInvoice) {
                          setLocation(`/invoices/${jobInvoice.id}`);
                        } else if (jobInvoiceCount > 0 && firstJobInvoice) {
                          setLocation(`/invoices/${firstJobInvoice.id}`);
                        } else {
                          setShowCreateInvoiceDialog(true);
                        }
                      }}
                      data-testid="button-invoice-action"
                    >
                      <Receipt className="h-4 w-4" />
                      {jobInvoice
                        ? "View Invoice"
                        : jobInvoiceCount > 0
                          ? jobInvoiceCount === 1 ? "View Invoice" : "View Invoices"
                          : "Create Invoice"}
                    </Button>
                  )}
                  {job.status === "archived" && isOfficeUser && (
                    <Button
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 text-white gap-1.5"
                      onClick={() => headerCardRef.current?.triggerReopenJob()}
                      data-testid="button-restore-job"
                    >
                      Restore Job
                    </Button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0" data-testid="button-more-actions">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setShowEditDialog(true)} data-testid="menu-edit-job">
                        <Pencil className="h-4 w-4 mr-2" />
                        Edit Job
                      </DropdownMenuItem>
                      {job.status === "open" && job.openSubStatus !== "on_hold" && isOfficeUser && (
                        <DropdownMenuItem onClick={() => setShowActionRequiredModal(true)} data-testid="menu-hold-job">
                          <Pause className="h-4 w-4 mr-2" />
                          Hold Job
                        </DropdownMenuItem>
                      )}
                      {job.status === "open" && isOfficeUser && (
                        <DropdownMenuItem onClick={() => setShowCompleteJobConfirm(true)} className="text-emerald-600 font-medium" data-testid="menu-complete-job">
                          <CheckCircle2 className="h-4 w-4 mr-2" />
                          Complete Job
                        </DropdownMenuItem>
                      )}
                      {job.status === "completed" && isOfficeUser && (
                        <DropdownMenuItem onClick={() => headerCardRef.current?.openCloseJobDialog()} data-testid="menu-archive-job">
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

              {/* Mobile (<lg): horizontal metadata strip below the
                  identity block. Same fields, single row that wraps
                  if needed. */}
              <div className="lg:hidden mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-x-5 gap-y-1 text-xs" data-testid="job-header-meta-mobile">
                <div>
                  <span className="text-slate-500">Job # </span>
                  <span className="font-semibold text-slate-800">{job.jobNumber}</span>
                </div>
                <div>
                  <span className="text-slate-500">Created </span>
                  <span className="text-slate-700">{job.createdAt ? format(new Date(job.createdAt), "MMM d, yyyy") : "—"}</span>
                </div>
                <div>
                  <span className="text-slate-500">Completed </span>
                  <span className="text-slate-700">{job.closedAt ? format(new Date(job.closedAt), "MMM d, yyyy") : "—"}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ─────────────── BODY GRID ───────────────
              Mobile: single flex column. Each card carries an explicit
              `order-*` so the page reads Header → Line Items → Notes →
              Labour → Equipment → Reference → Expenses (per spec).
              Desktop (lg+): switches to a 2-column grid. The two column
              wrappers use `display: contents` on mobile so cards become
              direct flex children of the outer column (and `order` works
              across columns), then become normal flex columns on lg+. */}
          <div className="flex flex-col gap-2 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)] lg:gap-2">
            {/* Left column wrapper */}
            <div className="contents lg:flex lg:flex-col lg:gap-2 lg:min-w-0">
              {/* Line Items card */}
              <div className="order-1 bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden" data-testid="card-line-items">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-slate-500" />
                    <h2 className="text-sm font-semibold text-slate-900">Line Items</h2>
                  </div>
                  {!partsEditMode && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPartsEditMode(true)}
                      className="h-7 text-xs"
                      data-testid="button-add-line-item-header"
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Add Item
                    </Button>
                  )}
                </div>
                {/* PartsBillingCard ships its own Card chrome and its
                    `CardContent` uses `p-6 pt-4 space-y-4`. We strip the
                    chrome and tighten the inner padding plus the empty-
                    state cell so the card is not oversized when no rows
                    exist. The selectors are scoped to this wrapper
                    only — `PartsBillingCard` itself is unchanged. */}
                <div className="[&>*]:border-0 [&>*]:rounded-none [&>*]:shadow-none [&>*]:bg-transparent [&_.shadcn-card>div]:!p-3 [&_tbody_tr>td.py-6]:!py-3" data-testid="parts-billing-wrapper">
                  <PartsBillingCard
                    jobId={jobId!}
                    isEditing={partsEditMode}
                    onExitEdit={() => setPartsEditMode(false)}
                    onTotalsChange={setBillingTotals}
                  />
                </div>
                {/* Subtotal footer */}
                <div className="border-t border-slate-200 px-4 py-2 bg-slate-50/60 flex items-center justify-end" data-testid="line-items-subtotal">
                  <span className="text-xs text-slate-500">
                    Subtotal{" "}
                    <strong className="text-slate-900 ml-1 text-sm tabular-nums">
                      ${billingTotals ? billingTotals.totalPrice.toFixed(2) : "0.00"}
                    </strong>
                  </span>
                </div>
              </div>

              {/* Expenses card — Add Expense lives inside JobExpensesCard.
                  Scoped wrapper overrides the component's default
                  `px-5 py-4` body and `mb-3` toolbar gap so the card
                  doesn't waste height when empty. `JobExpensesCard`
                  itself is unchanged so other surfaces keep their
                  density. */}
              <div
                className="order-6 bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden [&>div.px-5]:!px-4 [&>div.py-4]:!py-3 [&_div.mb-3]:!mb-2"
                data-testid="card-expenses"
              >
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    <Receipt className="h-4 w-4 text-slate-500" />
                    <h2 className="text-sm font-semibold text-slate-900">Expenses</h2>
                  </div>
                  <span className="text-xs text-slate-500 tabular-nums" data-testid="text-expense-total">
                    Total{" "}
                    <strong className="text-slate-900 ml-1 text-sm">
                      ${expenseTotalAmount.toFixed(2)}
                    </strong>
                  </span>
                </div>
                <JobExpensesCard jobId={jobId!} />
              </div>

              {/* Visits card — left column, below Expenses. Reuses the
                  canonical `useJobVisits` hook (key family `["visits",
                  jobId, "all"]`) which the dispatch mutation invalidates
                  on success, so a freshly-scheduled visit shows up here
                  without a manual refresh. Each row click hands off to
                  `setSelectedVisitId(visit.id)`, which the existing
                  `enrichVisitEditorState` effect (declared above) routes
                  through `VisitEditorLauncher` — same canonical edit
                  modal the dispatch board / Dashboard use. The "Schedule
                  Visit" header action reuses `handleScheduleVisit`
                  (opens `AddVisitDialog`). No new endpoint, no new
                  modal, no parallel scheduling path. */}
              <div
                className="order-7 bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden"
                data-testid="card-visits"
              >
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    <CalendarIcon className="h-4 w-4 text-slate-500" />
                    <h2 className="text-sm font-semibold text-slate-900">Visits</h2>
                    {jobVisitsAll.length > 0 && (
                      <span className="text-xs text-slate-400 tabular-nums">({jobVisitsAll.length})</span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-[#76B054] hover:text-[#5F9442] hover:bg-green-50"
                    onClick={handleScheduleVisit}
                    data-testid="button-add-visit"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Schedule Visit
                  </Button>
                </div>
                {jobVisitsLoading ? (
                  <div className="px-4 py-3 text-xs text-slate-500 italic">Loading visits…</div>
                ) : jobVisitsAll.length === 0 ? (
                  <div className="px-4 py-3 text-xs text-slate-500 text-center italic">
                    No visits scheduled.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100" data-testid="visits-list">
                    {jobVisitsAll.map((v) => {
                      const techIds = Array.isArray(v.assignedTechnicianIds) ? v.assignedTechnicianIds : [];
                      const techChips = techIds.map((id) => techByIdMap.get(id)).filter(Boolean) as Array<{ name: string; color: string | null }>;
                      const start = v.scheduledStart ? new Date(v.scheduledStart) : null;
                      const end = v.scheduledEnd ? new Date(v.scheduledEnd) : null;
                      const dateLabel = start ? format(start, "MMM d, yyyy") : "Unscheduled";
                      const timeLabel =
                        start && end
                          ? `${format(start, "h:mm a")}–${format(end, "h:mm a")}`
                          : start
                            ? format(start, "h:mm a")
                            : "";
                      const statusTone =
                        v.status === "completed"
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : v.status === "cancelled"
                            ? "bg-slate-50 text-slate-500 border border-slate-200"
                            : v.status === "in_progress"
                              ? "bg-blue-50 text-blue-700 border border-blue-200"
                              : v.status === "en_route"
                                ? "bg-amber-50 text-amber-700 border border-amber-200"
                                : "bg-slate-50 text-slate-700 border border-slate-200";
                      return (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => setSelectedVisitId(v.id)}
                          className="w-full flex items-start gap-3 px-4 py-2.5 text-left hover:bg-[#F0F5F0] transition-colors"
                          data-testid={`visit-row-${v.id}`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium text-slate-800">
                                {dateLabel}
                              </span>
                              {timeLabel && (
                                <span className="text-xs text-slate-500 tabular-nums">{timeLabel}</span>
                              )}
                              {v.visitNumber != null && (
                                <span className="text-[10px] text-slate-400">· Visit #{v.visitNumber}</span>
                              )}
                            </div>
                            <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                              {techChips.length === 0 ? (
                                <span className="text-xs text-slate-400 italic">Unassigned</span>
                              ) : (
                                techChips.map((t, i) => (
                                  <span
                                    key={`${v.id}-tech-${i}`}
                                    className="inline-flex items-center gap-1 text-xs text-slate-700"
                                  >
                                    <span
                                      className="h-2 w-2 rounded-full"
                                      style={{ backgroundColor: t.color || "#64748b" }}
                                    />
                                    {t.name}
                                  </span>
                                ))
                              )}
                            </div>
                            {v.visitNotes && (
                              <div className="text-xs text-slate-500 italic mt-1 line-clamp-2">
                                {v.visitNotes}
                              </div>
                            )}
                          </div>
                          <span
                            className={`shrink-0 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded ${statusTone}`}
                          >
                            {v.status.replace(/_/g, " ")}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Right column wrapper */}
            <div className="contents lg:flex lg:flex-col lg:gap-2 lg:min-w-0">
              {/* Notes — first card on right. Auto-collapses when no
                  notes exist; the user can manually toggle. The body
                  is conditionally mounted (rather than visually hidden)
                  so a closed empty state doesn't render the section's
                  internal "No notes yet" copy at all — the card header
                  alone communicates "no notes." Scoped wrapper override
                  still tightens `JobNotesSection`'s embedded `py-3`
                  empty cell on the rare case the user opens an empty
                  card manually.
                  2026-04-26: header now uses the same `bg-[#f8fafc]
                  hover:bg-slate-100` shading + `py-2.5` padding as
                  Equipment / Reference for visual consistency across
                  the right column. */}
              <div
                className="order-2 bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden [&_.text-center.py-3]:!py-2"
                data-testid="card-notes"
                data-open={notesOpen ? "true" : "false"}
              >
                <div className="flex items-center justify-between px-4 py-2.5 bg-[#f8fafc] hover:bg-slate-100 transition-colors border-b border-slate-200">
                  <button
                    type="button"
                    onClick={() => { setNotesUserToggled(true); setNotesOpen((o) => !o); }}
                    className="flex items-center gap-2 min-w-0 flex-1 text-left"
                    aria-expanded={notesOpen}
                    data-testid="toggle-notes"
                  >
                    {notesOpen
                      ? <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      : <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />}
                    <MessageSquare className="h-4 w-4 text-[#64748b] shrink-0" />
                    <h2 className="text-sm font-semibold text-[#0f172a] truncate">Notes</h2>
                    {notesCount === 0 && (
                      <span className="text-xs text-slate-400 ml-1">No notes</span>
                    )}
                    {notesCount !== null && notesCount > 0 && (
                      <span className="text-xs text-slate-400 ml-1 tabular-nums">({notesCount})</span>
                    )}
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-[#76B054] hover:text-[#5F9442] hover:bg-green-50"
                    onClick={(e) => { e.stopPropagation(); setShowAddNoteDialog(true); }}
                    data-testid="button-add-note"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Add Note
                  </Button>
                </div>
                {notesOpen && (
                  <JobNotesSection
                    jobId={job.id}
                    embedded
                    hideAddButton
                    hideHeader
                    showCount={false}
                    onCountChange={setNotesCount}
                  />
                )}
                {/* Mount a hidden instance solely for count signalling
                    when the card is closed — keeps the Add Note empty
                    state consistent without rendering the body. */}
                {!notesOpen && (
                  <div className="hidden">
                    <JobNotesSection
                      jobId={job.id}
                      embedded
                      hideAddButton
                      hideHeader
                      showCount={false}
                      onCountChange={setNotesCount}
                    />
                  </div>
                )}
              </div>

              {/* Labour Summary — three-state card.
                  • Empty (no entries): header only, chevron present
                    but the body stays hidden until the user manually
                    expands.
                  • Default (entries exist, not expanded): header + a
                    compact totals body — Driving / On-site / Total
                    rows. No team-member names, dates, time ranges, or
                    per-entry rows in this state.
                  • Expanded (entries exist, chevron clicked): header +
                    a per-team-member breakdown — each tech is a block
                    listing their Driving rows, then On-site rows, with
                    a per-tech subtotal at the end of the block.

                  Header chevron click semantics:
                  • If empty: toggles `labourOpen` (body visibility).
                  • If non-empty: toggles `labourExpanded` (collapsed
                    totals → expanded breakdown). `labourOpen` stays
                    true so the totals always read at a glance.

                  Costs are derived from each entry's `costRateSnapshot`
                  (the value captured when the entry was created — not
                  the team member's *current* rate). Updating a team
                  member's labour cost rate therefore only changes the
                  cost of NEW entries; historical entries keep their
                  snapshot. Entries without a snapshot contribute $0.00
                  rather than crashing the page.

                  Header now uses the same `bg-[#f8fafc] hover:bg-slate-100`
                  shading as Equipment / Reference for visual parity. */}
              <div
                className="order-3 bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden"
                data-testid="card-labour-summary"
                data-open={labourOpen ? "true" : "false"}
                data-expanded={labourExpanded ? "true" : "false"}
              >
                <div className="flex items-center justify-between px-4 py-2.5 bg-[#f8fafc] hover:bg-slate-100 transition-colors border-b border-slate-200">
                  <button
                    type="button"
                    onClick={() => {
                      if (jobTimeEntries.length === 0) {
                        setLabourUserToggled(true);
                        setLabourOpen((o) => !o);
                      } else {
                        setLabourExpanded((e) => !e);
                      }
                    }}
                    className="flex items-center gap-2 min-w-0 flex-1 text-left"
                    aria-expanded={jobTimeEntries.length === 0 ? labourOpen : labourExpanded}
                    data-testid="toggle-labour"
                  >
                    {(jobTimeEntries.length === 0 ? labourOpen : labourExpanded)
                      ? <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      : <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />}
                    <Clock className="h-4 w-4 text-[#64748b] shrink-0" />
                    <h2 className="text-sm font-semibold text-[#0f172a] truncate">Labour Summary</h2>
                    {jobTimeEntries.length === 0 && (
                      <span className="text-xs text-slate-400 ml-1">No labour</span>
                    )}
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-[#76B054] hover:text-[#5F9442] hover:bg-green-50"
                    onClick={(e) => { e.stopPropagation(); setTimeEntryModal({ open: true, mode: "create", entry: null }); }}
                    data-testid="button-add-labour"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Add Labour
                  </Button>
                </div>

                {/* Empty state body — only rendered when the user has
                    manually expanded an empty card. Default empty
                    state shows just the header. */}
                {jobTimeEntries.length === 0 && labourOpen && (
                  <div className="px-3 py-2 text-xs" data-testid="labour-summary-empty-body">
                    <p className="text-xs text-slate-500 text-center py-2 italic">
                      No labour entries yet.
                    </p>
                  </div>
                )}

                {/* Default body (totals only) — always shown when
                    entries exist, regardless of `labourExpanded`. */}
                {jobTimeEntries.length > 0 && (
                  <div className="px-3 py-2 text-xs" data-testid="labour-summary-totals-body">
                    <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1 items-baseline" data-testid="labour-summary-totals">
                      <span className="text-slate-600">Driving Time</span>
                      <span className="tabular-nums text-slate-700">{formatMinutes(labourBuckets.driving.minutes)}</span>
                      <span className="tabular-nums text-slate-700 text-right">{formatCurrency(labourBuckets.driving.cost)}</span>
                      <span className="text-slate-600">On-Site Time</span>
                      <span className="tabular-nums text-slate-700">{formatMinutes(labourBuckets.onSite.minutes)}</span>
                      <span className="tabular-nums text-slate-700 text-right">{formatCurrency(labourBuckets.onSite.cost)}</span>
                      <span className="text-slate-900 font-semibold pt-1.5 border-t border-slate-100 mt-1">Total Labour</span>
                      <span className="text-slate-900 font-semibold tabular-nums pt-1.5 border-t border-slate-100 mt-1">
                        {formatMinutes(labourBuckets.totalMinutes)}
                      </span>
                      <span className="text-slate-900 font-semibold tabular-nums pt-1.5 border-t border-slate-100 mt-1 text-right">
                        {formatCurrency(labourBuckets.totalCost)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Expanded body — one block per (tech, date). Each
                    entry is a single row in the spec's preferred form:
                    [Driving|On-Site] · time range · duration · cost.
                    The tech name + date is shown once per block (header
                    row) so per-row name/date repetition is avoided.
                    Rows are clickable → canonical TimeEntryModal in
                    edit mode. Aligned 4-column grid keeps labels,
                    times, durations, and costs visually lined up. */}
                {jobTimeEntries.length > 0 && labourExpanded && (
                  <div className="px-3 py-2 border-t border-slate-100 space-y-3" data-testid="labour-summary-detail">
                    {labourByTechDay.map((block) => (
                      <div key={block.key} data-testid={`labour-tech-block-${block.key}`}>
                        <div className="flex items-baseline justify-between gap-2 mb-1">
                          <span className="text-xs font-semibold text-slate-800 truncate">
                            {block.name}
                            <span className="text-slate-400 font-normal"> · {block.dateLabel}</span>
                          </span>
                          <span className="text-[11px] text-slate-500 tabular-nums shrink-0">
                            {formatMinutes(block.totalMinutes)} · {formatCurrency(block.totalCost)}
                          </span>
                        </div>
                        <div className="space-y-0.5">
                          {block.entries.map((e) => (
                            <LabourEntryLine
                              key={e.id}
                              entry={e}
                              isTravel={TRAVEL_TYPES.has(e.type)}
                              cost={entryCostDollars(e)}
                              onClick={() => setTimeEntryModal({ open: true, mode: "edit", entry: e })}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Equipment — reuses existing canonical component
                  (renders its own card). Auto-collapses when no
                  equipment is linked. `defaultOpen` is keyed off the
                  initial count so we don't fight with the user once
                  they manually toggle: when the count flips between 0
                  and >0 we re-key the section to reset its internal
                  `useState(defaultOpen)`. The scoped wrapper still
                  tightens the empty-state `text-center py-4` cell on
                  the rare case the user opens an empty card. */}
              <div
                className="order-4 [&_.text-center.py-4]:!py-2"
                data-testid="card-equipment"
                data-open={equipmentOpen ? "true" : "false"}
              >
                <JobEquipmentSection
                  key={`equipment-${equipmentOpen ? "open" : "closed"}`}
                  jobId={job.id}
                  locationId={job.locationId}
                  defaultOpen={equipmentOpen}
                  externalAddOpen={showAddEquipmentDialog}
                  onExternalAddOpenChange={setShowAddEquipmentDialog}
                  onCountChange={setEquipmentCount}
                />
              </div>

              {/* Reference — reuses existing canonical component (renders its own card) */}
              <div className="order-5" data-testid="card-reference">
                <ReferenceFieldsSection entityType="job" entityId={job.id} />
              </div>
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
        jobVersion={job.version ?? 0}
        open={showActionRequiredModal}
        onOpenChange={setShowActionRequiredModal}
      />

      {/* Schedule Visit Dialog - triggered from Office Actions strip +
          inline visits header. 2026-04-18 Phase 2: always creates a new
          visit (no targetVisitId). Edits go through the per-row
          EditVisitModal on the Visits list. */}
      <AddVisitDialog
        jobId={job.id}
        jobVersion={job.version}
        open={showScheduleVisitDialog}
        onOpenChange={setShowScheduleVisitDialog}
      />

      {/* 2026-04-21 Phase 1.5: canonical Edit Visit launcher — identical
          mount to Dashboard + DispatchPreview. All three surfaces now open
          visit editing through the same component; there is no per-page
          mount divergence. The launcher + modal consume
          `useDispatchPreviewMutations` internally.
          2026-04-24: the inline ternary that previously composed the state
          here was moved to a `useEffect` that routes through the canonical
          `enrichVisitEditorState` adapter. Launcher just reads the hydrated
          state now — uniform with Dashboard / FinancialDashboard. */}
      <VisitEditorLauncher
        state={visitEditorState}
        onClose={() => setSelectedVisitId(null)}
      />

      {/* 2026-04-18 Phase 2: reschedule-conflict AlertDialog removed. Under
          multi-visit there is no "the other open visit" to displace. */}

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

      {/* 2026-04-18 Phase 8 (invoice composition control): canonical
          create-from-job dialog with per-item labor/parts selection. */}
      <InvoiceCompositionDialog
        mode="create"
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

      {/* Header-level canonical note dialog (create mode from this entry point) */}
      <JobNoteDialog
        jobId={job.id}
        note={null}
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
    </>
  );
}
