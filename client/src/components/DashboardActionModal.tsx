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
  Loader2, Receipt, ArrowUpRight, Wrench,
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
// 2026-04-26: bottom "View all on Jobs page" link removed; the
// `viewAllAction` field on each MODE_CONFIG entry is now informational
// only (kept for forward-compat with surfaces that may inspect it).
// `resolveDashboardNav` is no longer needed in this file.
import type { DashboardAction } from "@/lib/dashboardNavigation";
import { getHoldReasonLabel } from "@shared/schema";

// ============================================================================
// Mode / source configuration
// ============================================================================

/** Three user-facing modes the dashboard Jobs card exposes. */
export type DashboardActionMode = "action_required" | "scheduling_issues" | "ready_to_invoice";

/**
 * Internal "source" identifies one query shape. Each user-facing mode
 * composes one or two sources. Sources map 1:1 onto the same canonical
 * filters the dashboard widget counters use — this preserves the invariant
 * that tile counts and drill-down lists stay in lockstep by construction.
 *
 * 2026-04-26: `pm_due` added — preventive-maintenance instances awaiting
 * job generation. Folded into the `action_required` mode alongside `on_hold`.
 * Hits `/api/dashboard/pm-due-instances` (rows mirror the workflow tile's
 * `pm.awaitingGenerationCount`); generation routes through the canonical
 * `POST /api/recurring-templates/generate-selected`.
 */
type InternalSource = "overdue" | "on_hold" | "unscheduled" | "ready_to_invoice" | "pm_due";

/** Query params per source. Job-table sources hit `/api/jobs?…`; `pm_due`
 *  hits its own dashboard endpoint. */
const SOURCE_PARAMS: Record<InternalSource, string> = {
  overdue: "status=open&overdue=true&limit=50",
  on_hold: "status=open&openSubStatus=on_hold&limit=50",
  unscheduled: "status=open&unscheduledOnly=true&limit=50",
  ready_to_invoice: "readyToInvoiceOnly=true&limit=50",
  pm_due: "limit=50",
};

/** Sources that hit `/api/jobs` (and return `JobsResponse`). `pm_due` is
 *  the lone exception — it returns `PMDueInstancesResponse` instead. */
function sourceUrl(source: InternalSource): string {
  if (source === "pm_due") return `/api/dashboard/pm-due-instances?${SOURCE_PARAMS.pm_due}`;
  return `/api/jobs?${SOURCE_PARAMS[source]}`;
}

/** Human label for a section header when more than one source is rendered. */
const SOURCE_SECTION_LABEL: Record<InternalSource, string> = {
  overdue: "Past Due — Reschedule",
  on_hold: "On Hold",
  unscheduled: "Needs Scheduling",
  ready_to_invoice: "Ready to Invoice",
  pm_due: "PMs Due / Overdue",
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
    // 2026-04-26: PM-due rows now fold into "Action Required" alongside
    // on-hold jobs. Same modal, same dismiss behaviour, two grouped
    // sections rendered top-to-bottom.
    sources: ["on_hold", "pm_due"],
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

// 2026-04-26: PM-due drill-down row. Sourced from
// `/api/dashboard/pm-due-instances`; generation routes through
// `/api/recurring-templates/generate-selected`.
interface PMDueInstance {
  instanceId: string;
  instanceDate: string;
  isOverdue: boolean;
  templateId: string;
  templateTitle: string;
  customerCompanyId: string | null;
  customerName: string | null;
  locationId: string | null;
  locationName: string | null;
  locationDisplayName: string | null;
}

interface PMDueInstancesResponse {
  data: PMDueInstance[];
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
  // Every mode has at least a primary source; some modes have a secondary
  // one. All hooks are declared unconditionally (React rule); each is
  // gated via `enabled` when the current mode does not include that
  // source. 2026-04-26: PM-due rows added under `action_required`. Their
  // shape differs from `JobsResponse`, so they have their own query +
  // render path.
  const primarySource = config.sources[0];
  const secondarySource: InternalSource | undefined = config.sources[1];

  const isPMDue = (s: InternalSource | undefined) => s === "pm_due";
  const isJobSource = (s: InternalSource | undefined) =>
    !!s && s !== "pm_due";

  // The job-source queries cover every source EXCEPT `pm_due`.
  const primaryJobQuery = useQuery<JobsResponse>({
    queryKey: ["dashboard-action", mode, primarySource],
    queryFn: async () => {
      const res = await fetch(sourceUrl(primarySource), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: open && isJobSource(primarySource),
    staleTime: 30_000,
  });

  const secondaryJobQuery = useQuery<JobsResponse>({
    queryKey: ["dashboard-action", mode, secondarySource ?? "none"],
    queryFn: async () => {
      if (!secondarySource) return { data: [] };
      const res = await fetch(sourceUrl(secondarySource), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: open && isJobSource(secondarySource),
    staleTime: 30_000,
  });

  // Dedicated PM-due query — fires only when one of the configured
  // sources is `pm_due` (today: only `action_required`).
  const pmDueSource = isPMDue(primarySource)
    ? primarySource
    : isPMDue(secondarySource)
      ? secondarySource
      : null;
  const pmDueQuery = useQuery<PMDueInstancesResponse>({
    queryKey: ["dashboard-action", mode, "pm_due"],
    queryFn: async () => {
      const res = await fetch(sourceUrl("pm_due"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: open && !!pmDueSource,
    staleTime: 30_000,
  });

  const refetchAll = useCallback(() => {
    if (isJobSource(primarySource)) primaryJobQuery.refetch();
    if (isJobSource(secondarySource)) secondaryJobQuery.refetch();
    if (pmDueSource) pmDueQuery.refetch();
  }, [primaryJobQuery, secondaryJobQuery, pmDueQuery, primarySource, secondarySource, pmDueSource]);

  const isLoading =
    (isJobSource(primarySource) && primaryJobQuery.isLoading) ||
    (isJobSource(secondarySource) && secondaryJobQuery.isLoading) ||
    (!!pmDueSource && pmDueQuery.isLoading);
  const isError =
    (isJobSource(primarySource) && primaryJobQuery.isError) ||
    (isJobSource(secondarySource) && secondaryJobQuery.isError) ||
    (!!pmDueSource && pmDueQuery.isError);

  const primaryJobs: JobItem[] = isJobSource(primarySource) ? (primaryJobQuery.data?.data ?? []) : [];
  const secondaryJobs: JobItem[] = isJobSource(secondarySource) ? (secondaryJobQuery.data?.data ?? []) : [];
  const pmDueRows: PMDueInstance[] = pmDueSource ? (pmDueQuery.data?.data ?? []) : [];
  const totalJobCount = primaryJobs.length + secondaryJobs.length + pmDueRows.length;

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

      // 2026-04-26 (Option A): both branches now check the typed result so
      // a swallowed hook-level failure can't fall through to the green
      // "Scheduled" toast and the row-collapse / form-reset / dashboard +
      // attention invalidations. The hook fires its own failure toast.
      if (visitId) {
        // Overdue reschedule OR placeholder visit promotion — both go
        // through the orchestrator-backed reschedule path. The orchestrator
        // decides spawn-on-actioned vs in-place update.
        const result = await rescheduleVisit({
          jobId,
          visitId,
          assignedTechnicianIds: crew,
          startAt,
          endAt,
        });
        if (!result.ok) {
          return;
        }
      } else {
        // Job has no existing visit row (rare) — create a new one.
        const result = await scheduleVisit({
          jobId,
          assignedTechnicianIds: crew,
          startAt,
          endAt,
        });
        if (!result.ok) {
          return;
        }
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

  // ── PM job-generation mutation ──────────────────────────────────────────
  //
  // 2026-04-26: dashboard PM rows reuse the canonical generation route
  // `POST /api/recurring-templates/generate-selected` — same endpoint
  // PMWorkspacePage drives. No parallel generation logic. Single-row
  // generation passes a one-element `instanceIds` array. Toast + cache
  // invalidations mirror the workspace mutation so the dashboard stays
  // in lockstep with the rest of the PM surface.
  const pmGenerateMutation = useMutation({
    mutationFn: (instanceIds: string[]) =>
      apiRequest<{ jobsCreated?: number }>(
        "/api/recurring-templates/generate-selected",
        { method: "POST", body: JSON.stringify({ instanceIds }) },
      ),
    onSuccess: (data) => {
      const count = data?.jobsCreated ?? 0;
      toast({
        title: `${count} work order${count !== 1 ? "s" : ""} created`,
        description: "Schedule them from the dispatch board.",
      });
      refetchAll();
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates/upcoming"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
    },
    onError: (err: any) => {
      toast({
        title: "Generation failed",
        description: err?.message || "Could not generate the work order.",
        variant: "destructive",
      });
    },
  });

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
  function renderJobRow(job: JobItem, source: InternalSource, _isLastInSection: boolean) {
    const isExpanded = expandedJobId === job.id;
    const isActioning = actionLoading === job.id;
    const location = job.locationDisplayName || job.locationName || "—";
    const city = job.locationCity ? `, ${job.locationCity}` : "";
    const isScheduleRow = source === "overdue" || source === "unscheduled";
    const isOnHoldRow = source === "on_hold";
    const isOverdueRow = source === "overdue";
    const isReadyToInvoiceRow = source === "ready_to_invoice";

    // 2026-04-26: On Hold rows render as a single <button> wrapping
    // the whole card body — clicking anywhere navigates to the job's
    // detail page. The previous `Open Job` action button was redundant
    // with this row click and is removed. Hold reason moves to the
    // right side as a compact pill (replaces the inline " · Hold:"
    // suffix that used to push location text into wrap territory).
    if (isOnHoldRow) {
      return (
        <div
          key={job.id}
          className="bg-white rounded-md border border-[#e5e7eb] hover:bg-[#F0F5F0] hover:border-[#cbd5e1] transition-colors"
          data-testid={`action-row-on-hold-${job.id}`}
        >
          <button
            type="button"
            onClick={() => { handleOpenChange(false); setLocation(`/jobs/${job.id}`); }}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-left cursor-pointer"
            title="Open job detail"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-bold text-[#4b5563] tabular-nums shrink-0">#{job.jobNumber}</span>
                <span className="text-sm font-medium text-[#111827] truncate min-w-0 flex-1">{job.summary}</span>
              </div>
              <div className="text-xs text-[#4b5563] mt-0.5 truncate">
                {location}{city}
              </div>
              {job.holdNotes && (
                <div className="text-xs text-[#4b5563] mt-1 line-clamp-2 italic">
                  {/* 2026-04-26: strip the leading `Visit #N — ` prefix
                      that some upstream completion paths embed in
                      `holdNotes` (e.g. `Visit #1 — Needs parts: motor`).
                      Display-only — the stored text is unchanged so
                      audit history and visit association are preserved.
                      Idempotent: notes without the prefix render
                      verbatim. */}
                  {job.holdNotes.replace(/^Visit\s+#\d+\s+—\s+/, "")}
                </div>
              )}
            </div>
            {job.holdReason && (
              <span
                className="shrink-0 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider rounded bg-orange-50 text-orange-700 border border-orange-200 whitespace-nowrap"
                data-testid={`hold-reason-pill-${job.id}`}
              >
                Hold: {getHoldReasonLabel(job.holdReason)}
              </span>
            )}
          </button>
        </div>
      );
    }

    // Non-on-hold rows keep the existing div + per-action-button layout.
    // The outer card chrome was added so they sit alongside the on-hold
    // and PM cards consistently against the grey body.
    return (
      <div
        key={job.id}
        className="bg-white rounded-md border border-[#e5e7eb] overflow-hidden"
        data-testid={`action-row-${source}-${job.id}`}
      >
        <div className="flex items-center justify-between px-3 py-2.5 hover:bg-[#f8fafc] transition-colors">
          {isOverdueRow && (
            <div className="mr-2 shrink-0">
              <Checkbox
                checked={selectedIds.has(job.id)}
                onCheckedChange={() => toggleSelect(job.id)}
                disabled={bulkUnscheduleMutation.isPending}
                className="h-3.5 w-3.5"
              />
            </div>
          )}
          <div className="min-w-0 flex-1 mr-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-bold text-[#4b5563] tabular-nums shrink-0">#{job.jobNumber}</span>
              <span className="text-sm font-medium text-[#111827] truncate">{job.summary}</span>
            </div>
            <div className="text-xs text-[#4b5563] mt-0.5 truncate">
              {location}{city}
            </div>
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
            {!isExpanded && (
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
          <div className="px-3 pb-3 pt-1 bg-[#f8fafc] border-t border-[#e5e7eb]">
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
    // 2026-04-26: ON HOLD section header now carries a "View all jobs"
    // link on the right side — replaces the bottom footer's vague
    // "View all on Jobs page" CTA. Other job sources (overdue,
    // unscheduled, ready_to_invoice) keep just the title for now since
    // the dashboard's `viewAllAction` already points each mode at the
    // right destination via the section-internal action buttons.
    const showViewAllJobs = source === "on_hold";
    return (
      <div key={source}>
        {showHeader && (
          <div className="sticky top-0 z-10 bg-[#f1f5f9] px-5 py-1.5 border-b border-[#e5e7eb] flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#64748b]">
              {SOURCE_SECTION_LABEL[source]}
              <span className="ml-2 text-[#94a3b8] tabular-nums normal-case">({rows.length})</span>
            </span>
            {showViewAllJobs && (
              <button
                type="button"
                onClick={() => { handleOpenChange(false); setLocation("/jobs"); }}
                className="text-[11px] font-medium text-[#76B054] hover:text-[#5F9442] inline-flex items-center gap-1"
                data-testid="action-required-view-all-jobs"
              >
                View all jobs
                <ArrowUpRight className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
        {/* 2026-04-26: rows render as white cards stacked on the grey
            body — `space-y-1.5` (tightened from `space-y-2`), individual
            `bg-white border rounded-md` chrome owned by the row
            renderers below. */}
        <div className="px-3 py-1.5 space-y-1.5">
          {rows.map((job, i) => renderJobRow(job, source, i === rows.length - 1))}
        </div>
      </div>
    );
  }

  // 2026-04-26: compact PM-due row. Two lines max:
  //   Line 1: PM template name (truncated) · status pill (Overdue/Due).
  //   Line 2: customer · location · due-date (each segment truncates).
  // The whole row is the navigation target — clicking the title block
  // opens the existing PM detail page (`/pm/{templateId}`). The
  // separate "View PM" secondary button was removed; the row click
  // replaces it. "Generate job" stays as the primary on the far right
  // and uses `e.stopPropagation()` so it doesn't bubble into the row's
  // navigation handler. `min-w-0 flex-1 truncate` on the title block
  // prevents long names from forcing the status pill or the action
  // button onto a new line.
  function renderPMRow(row: PMDueInstance, isLastInSection: boolean) {
    const isGenerating =
      pmGenerateMutation.isPending && pmGenerateMutation.variables?.[0] === row.instanceId;
    const statusLabel = row.isOverdue ? "Overdue" : "Due";
    const statusTone = row.isOverdue
      ? "bg-red-50 text-red-700 border border-red-200"
      : "bg-amber-50 text-amber-700 border border-amber-200";
    const customer = row.customerName ?? row.locationDisplayName ?? "—";
    const location = row.locationName ?? row.locationDisplayName ?? "";
    const handleNavigate = () => {
      handleOpenChange(false);
      setLocation(`/pm/${row.templateId}`);
    };
    return (
      <div
        key={row.instanceId}
        className="bg-white rounded-md border border-[#e5e7eb] hover:bg-[#F0F5F0] hover:border-[#cbd5e1] transition-colors"
        data-testid={`pm-due-row-${row.instanceId}`}
      >
        <div className="flex items-center gap-3 px-3 py-2.5">
          <button
            type="button"
            onClick={handleNavigate}
            className="min-w-0 flex-1 text-left cursor-pointer"
            data-testid={`pm-due-open-${row.instanceId}`}
            title="Open PM contract"
          >
            {/* Line 1 — name + status pill */}
            <div className="flex items-center gap-2 min-w-0">
              <Wrench className="h-3.5 w-3.5 text-[#76B054] shrink-0" />
              <span className="text-sm font-medium text-[#111827] truncate min-w-0 flex-1">
                {row.templateTitle}
              </span>
              <span className={`text-[10px] font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 shrink-0 ${statusTone}`}>
                {statusLabel}
              </span>
            </div>
            {/* Line 2 — customer · location · due date */}
            <div className="text-xs text-[#4b5563] mt-0.5 truncate">
              <span className="text-[#111827]">{customer}</span>
              {location && <span className="text-[#4b5563]"> · {location}</span>}
              <span className="text-[#94a3b8]"> · Due {row.instanceDate}</span>
            </div>
          </button>
          <Button
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              pmGenerateMutation.mutate([row.instanceId]);
            }}
            disabled={pmGenerateMutation.isPending}
            className="shrink-0 h-8 text-xs"
            data-testid={`pm-due-generate-${row.instanceId}`}
          >
            {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Generate job"}
          </Button>
        </div>
      </div>
    );
  }

  function renderPMSection(rows: PMDueInstance[]) {
    if (rows.length === 0) return null;
    const showHeader = config.sources.length > 1;
    return (
      <div key="pm_due">
        {/* 2026-04-26: section header carries a single "View all PMs"
            link to `/pm` (the PM workspace) — replaces the per-row
            "View PM" button. Header always renders for the PM section
            so the link is reachable even when on-hold has no rows. */}
        {showHeader && (
          <div className="sticky top-0 z-10 bg-[#f1f5f9] px-5 py-1.5 border-b border-[#e5e7eb] flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#64748b]">
              {SOURCE_SECTION_LABEL.pm_due}
              <span className="ml-2 text-[#94a3b8] tabular-nums normal-case">({rows.length})</span>
            </span>
            <button
              type="button"
              onClick={() => {
                handleOpenChange(false);
                setLocation("/pm");
              }}
              className="text-[11px] font-medium text-[#76B054] hover:text-[#5F9442] inline-flex items-center gap-1"
              data-testid="pm-due-view-all"
            >
              View all PMs
              <ArrowUpRight className="h-3 w-3" />
            </button>
          </div>
        )}
        <div className="px-3 py-1.5 space-y-1.5">
          {rows.map((row, i) => renderPMRow(row, i === rows.length - 1))}
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

        {/* 2026-04-26: body background switched from default white to
            a light slate so the action rows below can render as
            distinct white cards. The visual emphasis (white card on
            grey body) matches how the dashboard cards themselves sit
            against the page. */}
        <div className="flex-1 overflow-y-auto min-h-0 bg-[#f1f5f9]">
          {isLoading ? (
            <div className="p-5 space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}
            </div>
          ) : isError ? (
            <div className="p-5 text-sm text-red-600">Failed to load jobs. Please try again.</div>
          ) : totalJobCount === 0 ? (
            <div className="p-8 text-center text-sm text-[#4b5563]">No items in this category.</div>
          ) : (
            <div>
              {/* 2026-04-26: render configured sources in declaration
                  order. PM-due rows have a different shape and use
                  their own renderer. Empty sections silently no-op,
                  so a tenant with on-hold jobs but zero PM-due work
                  sees only the on-hold section (and vice versa). */}
              {config.sources.map((source) => {
                if (source === "pm_due") return renderPMSection(pmDueRows);
                if (source === primarySource) return renderSection(primarySource, primaryJobs);
                if (source === secondarySource) return renderSection(secondarySource, secondaryJobs);
                return null;
              })}
            </div>
          )}
        </div>

        {/* 2026-04-26: bottom "View all on Jobs page" link removed —
            section-level links (`View all jobs` beside ON HOLD,
            `View all PMs` beside the PM section) replace it. The
            footer keeps just the Close button. */}
        <div className="px-5 py-3 border-t border-[#e5e7eb] shrink-0 flex items-center justify-end">
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
