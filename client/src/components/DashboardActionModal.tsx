/**
 * DashboardActionModal — Reusable modal for triaging dashboard job action rows.
 *
 * 2026-04-19 Task B consolidation: user-facing modes reduced from four to three.
 * Internally the modal still composes the same canonical /api/jobs queries —
 * no parallel backend aggregation introduced.
 *
 * User-facing modes:
 * - action_required:    Jobs on hold (needs parts, customer approval, access,
 *                       internal approval, weather, other). Row action: Open Job.
 *                       Hold reason label rendered via canonical
 *                       `getHoldReasonLabel()` from `@shared/schema`.
 * - scheduling_issues:  Two sections in one modal — Past Due jobs (with
 *                       bulk-unschedule + inline reschedule), then a labelled
 *                       divider, then Jobs Needing Scheduling (inline schedule).
 * - ready_to_invoice:   Completed jobs with no invoice yet. Row action: Create
 *                       Invoice (unchanged from prior implementation).
 *
 * Internally each mode composes one or two "sources". Each source is a single
 * canonical /api/jobs query param set (the same params the dashboard widget
 * counters read). No new aggregation endpoint added, no duplicate filter logic.
 *
 * All write actions route through canonical flows:
 *   - Schedule / reschedule → useDispatchPreviewMutations (Phase 1.5)
 *   - Create invoice from job → /api/invoices/from-job
 *   - Bulk unschedule → /api/calendar/bulk-unschedule (now delegates to
 *     lifecycle.unscheduleVisit per-visit with actioned-visit guards)
 * This module only changes how rows are *grouped* and *labeled*, not how
 * they are acted upon.
 */

import { useState, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Loader2, ExternalLink, Receipt, ArrowUpRight,
} from "lucide-react";
import {
  JobScheduleFields, createDefaultScheduleValue,
  type JobScheduleValue,
} from "@/components/jobs/JobScheduleFields";
// 2026-04-21 Phase 1.5 canonicalization: dashboard Action Required rows
// route their schedule/reschedule writes through the canonical dispatch
// mutation hook, not the legacy `applyJobSchedule` helper. One operational
// client root — the hook applies optimistic patching, version caching,
// per-visit serialization, and canonical invalidation uniformly.
import { useDispatchPreviewMutations } from "@/components/dispatch/useDispatchPreviewMutations";
import { resolveDashboardNav, type DashboardAction } from "@/lib/dashboardNavigation";
import { getHoldReasonLabel } from "@shared/schema";

// ============================================================================
// Mode / source configuration
// ============================================================================

/** Three user-facing modes the dashboard Jobs card exposes. */
export type DashboardActionMode = "action_required" | "scheduling_issues" | "ready_to_invoice";

/**
 * Internal "source" identifies one /api/jobs query shape. Each user-facing
 * mode composes one or two sources. Sources map 1:1 onto the same canonical
 * filters the dashboard widget counters use — this preserves the invariant
 * that tile counts and drill-down lists stay in lockstep by construction.
 */
type InternalSource = "overdue" | "on_hold" | "unscheduled" | "ready_to_invoice";

/** Query params per source. Mirrors getWorkflowSummary / getJobCounts in
 *  server/storage/dashboard.ts and the readyToInvoiceOnly filter in
 *  server/storage/jobsFeed.ts. */
const SOURCE_PARAMS: Record<InternalSource, string> = {
  overdue: "status=open&overdue=true&limit=50",
  on_hold: "status=open&openSubStatus=on_hold&limit=50",
  unscheduled: "status=open&unscheduledOnly=true&limit=50",
  ready_to_invoice: "readyToInvoiceOnly=true&limit=50",
};

/** Human label for a section header when more than one source is rendered. */
const SOURCE_SECTION_LABEL: Record<InternalSource, string> = {
  overdue: "Past Due — Reschedule",
  on_hold: "On Hold",
  unscheduled: "Needs Scheduling",
  ready_to_invoice: "Ready to Invoice",
};

interface ModeConfig {
  title: string;
  /** Ordered list of sources. Primary first. Length 1 = single section. */
  sources: InternalSource[];
  viewAllAction: DashboardAction;
}

const MODE_CONFIG: Record<DashboardActionMode, ModeConfig> = {
  action_required: {
    title: "Action Required",
    sources: ["on_hold"],
    viewAllAction: "ops.onHold",
  },
  scheduling_issues: {
    title: "Scheduling Issues",
    sources: ["overdue", "unscheduled"],
    viewAllAction: "alerts.overdueJobs",
  },
  ready_to_invoice: {
    title: "Jobs Ready to Invoice",
    sources: ["ready_to_invoice"],
    viewAllAction: "jobs.needsInvoicing",
  },
};

// ============================================================================
// Job list item shape (subset of JobFeedItem)
// ============================================================================

interface JobItem {
  id: string;
  jobNumber: number;
  summary: string;
  status: string;
  openSubStatus?: string | null;
  locationDisplayName?: string | null;
  locationName?: string | null;
  locationCity?: string | null;
  scheduledStart?: string | null;
  holdReason?: string | null;
  holdNotes?: string | null;
  onHoldAt?: string | null;
  completedAt?: string | null;
  /** 2026-04-18 Phase 3: active non-terminal visit ids on this job.
   *  Source: canonical jobsFeed DTO extension. Lets this modal resolve
   *  bulk-unschedule visit ids without an N+1 per-job API round-trip. */
  visitIds?: string[];
}

interface JobsResponse {
  data: JobItem[];
}

// ============================================================================
// Component
// ============================================================================

interface DashboardActionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: DashboardActionMode;
}

export function DashboardActionModal({ open, onOpenChange, mode }: DashboardActionModalProps) {
  const config = MODE_CONFIG[mode];
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  // Canonical visit mutation hook — shared with EditVisitModal / dispatch
  // board / AddVisitDialog. All schedule/reschedule writes from this modal
  // go through here.
  const { scheduleVisit, rescheduleVisit } = useDispatchPreviewMutations();

  // Inline-scheduler expansion and per-row action loading state are both
  // keyed on job id, so they continue to work unchanged across composed
  // multi-source views.
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [scheduleValue, setScheduleValue] = useState<JobScheduleValue>(createDefaultScheduleValue({ unscheduled: false }));
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Selection state — only meaningful when an overdue section is rendered.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);

  // ── Data fetches ─────────────────────────────────────────────────────────
  //
  // Every mode has at least a primary source; scheduling_issues has a
  // secondary one. Both hooks are declared unconditionally (React rule) and
  // the secondary hook is gated via `enabled` when the current mode has no
  // secondary source.
  const primarySource = config.sources[0];
  const secondarySource: InternalSource | undefined = config.sources[1];

  const primaryQuery = useQuery<JobsResponse>({
    queryKey: ["dashboard-action", mode, primarySource],
    queryFn: async () => {
      const res = await fetch(`/api/jobs?${SOURCE_PARAMS[primarySource]}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: open,
    staleTime: 30_000,
  });

  const secondaryQuery = useQuery<JobsResponse>({
    queryKey: ["dashboard-action", mode, secondarySource ?? "none"],
    queryFn: async () => {
      if (!secondarySource) return { data: [] };
      const res = await fetch(`/api/jobs?${SOURCE_PARAMS[secondarySource]}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: open && !!secondarySource,
    staleTime: 30_000,
  });

  const refetchAll = useCallback(() => {
    primaryQuery.refetch();
    if (secondarySource) secondaryQuery.refetch();
  }, [primaryQuery, secondaryQuery, secondarySource]);

  const isLoading = primaryQuery.isLoading || (!!secondarySource && secondaryQuery.isLoading);
  const isError = primaryQuery.isError || (!!secondarySource && secondaryQuery.isError);

  const primaryJobs: JobItem[] = primaryQuery.data?.data ?? [];
  const secondaryJobs: JobItem[] = secondarySource ? (secondaryQuery.data?.data ?? []) : [];
  const totalJobCount = primaryJobs.length + secondaryJobs.length;

  // Overdue section only surfaces under `scheduling_issues` — that's the only
  // mode that currently pulls from the "overdue" source. If it shifts in
  // the future we recompute from the visible sections, not the mode name.
  const overdueJobs = useMemo<JobItem[]>(() => {
    const out: JobItem[] = [];
    if (primarySource === "overdue") out.push(...primaryJobs);
    if (secondarySource === "overdue") out.push(...secondaryJobs);
    return out;
  }, [primarySource, secondarySource, primaryJobs, secondaryJobs]);

  const overdueSelectableCount = overdueJobs.length;
  const allOverdueSelected = overdueSelectableCount > 0 && selectedIds.size === overdueSelectableCount;
  const someOverdueSelected = selectedIds.size > 0;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (allOverdueSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(overdueJobs.map((j) => j.id)));
    }
  };

  // Reset local state when modal closes.
  const handleOpenChange = useCallback((v: boolean) => {
    if (!v) {
      setExpandedJobId(null);
      setScheduleValue(createDefaultScheduleValue({ unscheduled: false }));
      setSelectedIds(new Set());
      setShowBulkConfirm(false);
    }
    onOpenChange(v);
  }, [onOpenChange]);

  // ── Schedule/Reschedule action (overdue + unscheduled sources) ──
  //
  // 2026-04-21 Phase 1.5: routes through `useDispatchPreviewMutations`
  // exclusively. No parallel helper, no inline `apiRequest` — every path
  // lands in `lifecycle.rescheduleVisit` (for existing visits) or
  // `schedulingRepository.scheduleJob` (for new visits on jobs without a
  // placeholder). Per-visit optimistic patching + invalidation is owned
  // by the hook, not reconstructed here.
  const handleSchedule = useCallback(async (jobId: string, source: InternalSource) => {
    setActionLoading(jobId);
    try {
      const pool = source === "overdue" ? overdueJobs : secondaryJobs;
      const row = pool.find((j) => j.id === jobId)
        ?? primaryJobs.find((j) => j.id === jobId)
        ?? secondaryJobs.find((j) => j.id === jobId);
      const ids = Array.isArray(row?.visitIds) ? row!.visitIds : [];
      const visitId = ids.length > 0 ? ids[0] : undefined;

      if (scheduleValue.unscheduled) {
        // Scheduling a row to "unscheduled" is a logical contradiction for
        // this handler — bulk unschedule uses its own mutation path below.
        toast({ title: "Error", description: "Pick a date + time to schedule.", variant: "destructive" });
        return;
      }

      const time = scheduleValue.time || "09:00";
      const start = new Date(`${scheduleValue.date}T${time}:00`);
      const end = new Date(start.getTime() + scheduleValue.durationMinutes * 60_000);
      const startAt = start.toISOString();
      const endAt = end.toISOString();
      const crew = scheduleValue.assignedTechnicianIds ?? [];

      if (visitId) {
        // Overdue reschedule OR placeholder visit promotion — both go
        // through the orchestrator-backed reschedule path. The orchestrator
        // decides spawn-on-actioned vs in-place update.
        await rescheduleVisit({
          jobId,
          visitId,
          assignedTechnicianIds: crew,
          startAt,
          endAt,
        });
      } else {
        // Job has no existing visit row (rare) — create a new one.
        await scheduleVisit({
          jobId,
          assignedTechnicianIds: crew,
          startAt,
          endAt,
        });
      }

      toast({ title: "Scheduled", description: "Job scheduled successfully." });
      setExpandedJobId(null);
      setScheduleValue(createDefaultScheduleValue({ unscheduled: false }));
      refetchAll();
      // The hook invalidates calendar + jobs/dashboard already; these two
      // dashboard-scoped keys are dashboard-action drill-down specific and
      // not currently in the hook's invalidation set.
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["attention"] });
    } catch (err: any) {
      // The hook surfaces its own toast for dispatch-level failures; this
      // catch only fires for pre-hook validation issues.
      toast({ title: "Error", description: err.message || "Failed to schedule", variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  }, [scheduleValue, toast, refetchAll, overdueJobs, primaryJobs, secondaryJobs, rescheduleVisit, scheduleVisit]);

  // ── Create invoice action (ready_to_invoice) ──
  const handleCreateInvoice = useCallback(async (jobId: string) => {
    setActionLoading(jobId);
    try {
      const result = await apiRequest<any>(`/api/invoices/from-job/${jobId}`, {
        method: "POST",
        body: JSON.stringify({ markJobCompleted: false }),
      });
      toast({ title: "Invoice Created", description: `Invoice #${result.invoiceNumber || ""} created.` });
      refetchAll();
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["attention"] });
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to create invoice", variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  }, [toast, refetchAll]);

  // ── Bulk unschedule mutation (overdue section inside scheduling_issues) ──
  //
  // Preserved verbatim from the prior implementation — same canonical
  // `/api/calendar/bulk-unschedule` contract, same visit-id resolution from
  // the cached `visitIds` field on each JobItem, same result messaging.
  interface BulkUnscheduleResponse {
    totalCount: number;
    successCount: number;
    skippedCount: number;
    failedCount: number;
    affectedJobIds: string[];
    succeeded: string[];
    skipped: { visitId: string; reason: string }[];
    failed: { visitId: string; reason: string }[];
  }

  const bulkUnscheduleMutation = useMutation({
    mutationFn: async (jobIds: string[]) => {
      const byId = new Map<string, JobItem>(overdueJobs.map((j) => [j.id, j]));
      const visitIds = jobIds.flatMap((jobId) => {
        const row = byId.get(jobId);
        const ids = Array.isArray(row?.visitIds) ? row!.visitIds : [];
        return ids;
      });

      if (visitIds.length === 0) {
        throw new Error(
          "No eligible visits to unschedule. Each selected job must have at least one scheduled, non-terminal visit.",
        );
      }

      return apiRequest<BulkUnscheduleResponse>(
        "/api/calendar/bulk-unschedule",
        { method: "POST", body: JSON.stringify({ visitIds }) },
      );
    },
    onSuccess: (data) => {
      if (data.failedCount === 0 && data.skippedCount === 0) {
        toast({
          title: "Visits Moved to Unscheduled",
          description: `${data.successCount} visit${data.successCount === 1 ? "" : "s"} moved across ${data.affectedJobIds.length} job${data.affectedJobIds.length === 1 ? "" : "s"}.`,
        });
      } else {
        const parts: string[] = [`${data.successCount} moved`];
        if (data.skippedCount > 0) parts.push(`${data.skippedCount} skipped`);
        if (data.failedCount > 0) parts.push(`${data.failedCount} failed`);
        toast({
          title: "Bulk Unschedule Complete",
          description: parts.join(", ") + ".",
          variant: data.failedCount > 0 ? "destructive" : undefined,
        });
      }
      setSelectedIds(new Set());
      setShowBulkConfirm(false);
      refetchAll();
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["attention"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Bulk unschedule failed", variant: "destructive" });
    },
  });

  const toggleExpand = useCallback((jobId: string) => {
    if (expandedJobId === jobId) {
      setExpandedJobId(null);
      setScheduleValue(createDefaultScheduleValue({ unscheduled: false }));
    } else {
      setExpandedJobId(jobId);
      setScheduleValue(createDefaultScheduleValue({ unscheduled: false }));
    }
  }, [expandedJobId]);

  const showOverdueBulkControls = primarySource === "overdue" && overdueJobs.length > 0 && !isLoading;

  // ── Row renderer — source-aware ─────────────────────────────────────────
  //
  // The same <JobRow /> shape renders under every section; per-row action
  // varies by the *source* the row came from (not the enclosing mode), so
  // scheduling_issues can render a "Reschedule" button on overdue rows and
  // "Schedule" on unscheduled rows in the same modal without branching on
  // the user-facing mode.
  function renderJobRow(job: JobItem, source: InternalSource, isLastInSection: boolean) {
    const isExpanded = expandedJobId === job.id;
    const isActioning = actionLoading === job.id;
    const location = job.locationDisplayName || job.locationName || "—";
    const city = job.locationCity ? `, ${job.locationCity}` : "";
    const isScheduleRow = source === "overdue" || source === "unscheduled";
    const isOnHoldRow = source === "on_hold";
    const isOverdueRow = source === "overdue";
    const isReadyToInvoiceRow = source === "ready_to_invoice";

    return (
      <div key={job.id} className={`${!isLastInSection ? "border-b border-[#e5e7eb]" : ""}`}>
        <div className="flex items-center justify-between px-5 py-3 hover:bg-[#f8fafc] transition-colors">
          {isOverdueRow && (
            <div className="mr-3 shrink-0">
              <Checkbox
                checked={selectedIds.has(job.id)}
                onCheckedChange={() => toggleSelect(job.id)}
                disabled={bulkUnscheduleMutation.isPending}
                className="h-3.5 w-3.5"
              />
            </div>
          )}
          <div className="min-w-0 flex-1 mr-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-[#4b5563] tabular-nums">#{job.jobNumber}</span>
              <span className="text-sm font-medium text-[#111827] truncate">{job.summary}</span>
            </div>
            <div className="text-xs text-[#4b5563] mt-0.5 truncate">
              {location}{city}
              {/* 2026-04-19 Task A: canonical hold-reason label.
                  Replaces the previous `job.holdReason.replace(/_/g, " ")`
                  which rendered "parts" as "parts" (lowercase enum) instead
                  of "Needs Parts". `getHoldReasonLabel` is the single
                  source of truth in `@shared/schema` and is already used
                  by JobDetailPage and ActionRequiredModal. */}
              {job.holdReason && (
                <span className="ml-2 text-orange-600">· Hold: {getHoldReasonLabel(job.holdReason)}</span>
              )}
            </div>
            {isOnHoldRow && job.holdNotes && (
              <div className="text-xs text-[#4b5563] mt-1 line-clamp-2 italic">
                {job.holdNotes}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {isScheduleRow ? (
              <Button
                size="sm"
                variant={isExpanded ? "outline" : "default"}
                onClick={() => toggleExpand(job.id)}
                className="shrink-0 h-8 text-xs"
              >
                {isExpanded ? "Cancel" : (isOverdueRow ? "Reschedule" : "Schedule")}
              </Button>
            ) : isOnHoldRow ? (
              <Button
                size="sm"
                onClick={() => { handleOpenChange(false); setLocation(`/jobs/${job.id}`); }}
                className="shrink-0 h-8 text-xs"
              >
                Open Job <ArrowUpRight className="h-3 w-3 ml-0.5" />
              </Button>
            ) : isReadyToInvoiceRow ? (
              <Button
                size="sm"
                onClick={() => handleCreateInvoice(job.id)}
                disabled={isActioning}
                className="shrink-0 h-8 text-xs"
              >
                {isActioning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Receipt className="h-3.5 w-3.5 mr-1" />}
                Create Invoice
              </Button>
            ) : null}
            {!isExpanded && !isOnHoldRow && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { handleOpenChange(false); setLocation(`/jobs/${job.id}`); }}
                className="shrink-0 h-8 text-xs text-[#4b5563] hover:text-[#111827]"
                title="Open full job detail"
              >
                Open Job <ArrowUpRight className="h-3 w-3 ml-0.5" />
              </Button>
            )}
          </div>
        </div>
        {isScheduleRow && isExpanded && (
          <div className="px-5 pb-4 pt-1 bg-[#f8fafc] border-t border-[#e5e7eb]">
            <JobScheduleFields
              value={scheduleValue}
              onChange={setScheduleValue}
              hideUnscheduledToggle
              compact
            />
            <div className="flex items-center gap-2 mt-3">
              <Button
                size="sm"
                onClick={() => handleSchedule(job.id, source)}
                disabled={isActioning || scheduleValue.unscheduled}
                className="h-8 text-xs"
              >
                {isActioning && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                Save Schedule
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setExpandedJobId(null); setScheduleValue(createDefaultScheduleValue({ unscheduled: false })); }}
                className="h-8 text-xs"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderSection(source: InternalSource, rows: JobItem[]) {
    if (rows.length === 0) return null;
    const showHeader = config.sources.length > 1;
    return (
      <div key={source}>
        {showHeader && (
          <div className="sticky top-0 z-10 bg-[#f1f5f9] px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#64748b] border-b border-[#e5e7eb]">
            {SOURCE_SECTION_LABEL[source]}
            <span className="ml-2 text-[#94a3b8] tabular-nums normal-case">({rows.length})</span>
          </div>
        )}
        <div>
          {rows.map((job, i) => renderJobRow(job, source, i === rows.length - 1))}
        </div>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col p-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-[#e5e7eb] shrink-0">
          <DialogTitle className="text-base font-semibold text-[#111827] flex items-center gap-2">
            {config.title}
            {!isLoading && (
              <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-[#f8fafc] text-xs font-bold text-[#4b5563] tabular-nums">
                {totalJobCount}
              </span>
            )}
          </DialogTitle>
          {showOverdueBulkControls && (
            <div className="flex items-center justify-between mt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={allOverdueSelected}
                  onCheckedChange={toggleSelectAll}
                  disabled={bulkUnscheduleMutation.isPending}
                  className="h-3.5 w-3.5"
                />
                <span className="text-xs text-[#4b5563]">
                  {someOverdueSelected ? `${selectedIds.size} of ${overdueJobs.length} past-due selected` : `Select all ${overdueJobs.length} past-due`}
                </span>
              </label>
              {someOverdueSelected && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1"
                  onClick={() => setShowBulkConfirm(true)}
                  disabled={bulkUnscheduleMutation.isPending}
                >
                  Move {selectedIds.size} to Unscheduled
                </Button>
              )}
            </div>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          {isLoading ? (
            <div className="p-5 space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}
            </div>
          ) : isError ? (
            <div className="p-5 text-sm text-red-600">Failed to load jobs. Please try again.</div>
          ) : totalJobCount === 0 ? (
            <div className="p-8 text-center text-sm text-[#4b5563]">No jobs in this category.</div>
          ) : (
            <div>
              {renderSection(primarySource, primaryJobs)}
              {secondarySource && renderSection(secondarySource, secondaryJobs)}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[#e5e7eb] shrink-0 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-[#4b5563] hover:text-[#111827]"
            onClick={() => {
              handleOpenChange(false);
              setLocation(resolveDashboardNav(config.viewAllAction));
            }}
          >
            <ExternalLink className="h-3.5 w-3.5 mr-1" />
            View all on Jobs page
          </Button>
          <Button variant="outline" size="sm" className="text-xs" onClick={() => handleOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>

      {showBulkConfirm && (
        <Dialog open={showBulkConfirm} onOpenChange={(v) => { if (!v) setShowBulkConfirm(false); }}>
          <DialogContent className="sm:max-w-[440px]">
            <DialogHeader>
              <DialogTitle>Move {selectedIds.size} jobs to Unscheduled?</DialogTitle>
              <DialogDescription>
                The scheduled date and time will be removed from {selectedIds.size === 1 ? "this job" : `these ${selectedIds.size} jobs`}.
                They will appear in the Unscheduled queue for future scheduling.
                This does not delete any jobs.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setShowBulkConfirm(false)}>Cancel</Button>
              <Button
                onClick={() => bulkUnscheduleMutation.mutate(Array.from(selectedIds))}
                disabled={bulkUnscheduleMutation.isPending}
              >
                {bulkUnscheduleMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                Confirm Move
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}
