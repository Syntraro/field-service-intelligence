import { useState, useMemo, useEffect } from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { useJobsFeed, type JobFeedItem } from "@/hooks/useJobsFeed";
import { isJobScheduled, isJobOverdue } from "@shared/schema";
import { getJobStatusMeta } from "@/lib/statusBadges";
import { EntityListTable, type EntityListColumn } from "@/components/lists/EntityListTable";
import { EntityNumber } from "@/components/common/EntityNumber";
import { ListLoadMoreFooter } from "@/components/lists/ListLoadMoreFooter";
import { type JobView } from "@/lib/jobsWorkspaceConfig";
import { type SelectedJobContext } from "./JobActionsRail";
import { WorkspaceCenterPane } from "@/components/workspace/WorkspaceCenterPane";
import { WorkspaceEntitySurface } from "@/components/workspace/WorkspaceEntitySurface";

// ── Types ─────────────────────────────────────────────────────────────────────

type EnrichedJob = JobFeedItem & { _overdue: boolean };

const PAGE_SIZE = 50;

// ── View predicate mapping ─────────────────────────────────────────────────────

function applyViewPredicate(jobs: EnrichedJob[], view: JobView): EnrichedJob[] {
  const today = new Date();
  const todayStr = format(today, "yyyy-MM-dd");

  switch (view) {
    case "all":
      return jobs.filter((j) => j.status !== "archived");
    case "needs-scheduling":
      return jobs.filter((j) => j.status === "open" && !isJobScheduled(j));
    case "scheduled-today":
      return jobs.filter((j) => j.scheduledStart?.slice(0, 10) === todayStr);
    case "in-progress":
      return jobs.filter((j) => j.status === "open" && j.openSubStatus === "in_progress");
    case "awaiting-follow-up":
      return jobs.filter((j) => j.status === "open" && j.openSubStatus === "on_hold");
    case "waiting-for-parts":
      return jobs.filter((j) => j.status === "open" && j.openSubStatus === "on_hold");
    case "ready-to-invoice":
    case "completed-not-invoiced":
      return jobs.filter((j) => j.status === "completed");
    case "overdue":
      return jobs.filter((j) => j._overdue);
    case "unassigned":
      return jobs.filter(
        (j) => j.status !== "archived" && (!j.assignedTechnicianIds || j.assignedTechnicianIds.length === 0),
      );
    // ── Workflow type ─────────────────────────────────────────────────────────
    case "service":
    case "maintenance":
    case "install":
    case "warranty":
    case "emergency":
      return jobs.filter((j) => j.jobType?.toLowerCase() === view && j.status !== "archived");
    case "recurring":
      return jobs.filter(
        (j) => j.status !== "archived" && (j.jobType?.toLowerCase().includes("recurring") || j.jobType?.toLowerCase() === "recurring"),
      );
    // ── Attention ─────────────────────────────────────────────────────────────
    case "missing-labor":
    case "technician-flagged":
      return jobs.filter(
        (j) => j.status !== "archived" && (!j.assignedTechnicianIds || j.assignedTechnicianIds.length === 0),
      );
    case "missing-notes":
    case "missing-line-items":
      // Cannot determine from feed — show all open jobs as triage candidates.
      return jobs.filter((j) => j.status === "open");
    case "no-future-visit":
    case "return-visit-required":
      return jobs.filter(
        (j) => j.status === "open" && (!j.scheduledStart || new Date(j.scheduledStart) < today),
      );
    default:
      return jobs.filter((j) => j.status !== "archived");
  }
}

// ── Search filter ─────────────────────────────────────────────────────────────

function applySearch(jobs: EnrichedJob[], query: string): EnrichedJob[] {
  if (!query.trim()) return jobs;
  const q = query.toLowerCase();
  return jobs.filter((job) => {
    return (
      job.locationDisplayName?.toLowerCase().includes(q) ||
      job.locationName?.toLowerCase().includes(q) ||
      job.locationAddress?.toLowerCase().includes(q) ||
      job.locationCity?.toLowerCase().includes(q) ||
      `#${job.jobNumber}`.includes(q) ||
      job.summary?.toLowerCase().includes(q)
    );
  });
}

// ── Secondary location line ───────────────────────────────────────────────────

function secondaryLocationLine(job: JobFeedItem): string | null {
  const raw = (job.locationName ?? "").trim();
  if (!raw) return null;
  const primary = (job.locationDisplayName ?? "").trim();
  if (primary && raw.toLowerCase() === primary.toLowerCase()) return null;
  return raw;
}

// ── Column definitions ────────────────────────────────────────────────────────

const JOB_COLUMNS: EntityListColumn<EnrichedJob>[] = [
  {
    id: "location",
    kind: "primary",
    ratio: 1.5,
    header: "Client / Location",
    sortKey: "location",
    cell: {
      type: "entity-primary",
      value: (job) => job.locationDisplayName || "Unknown Company",
      secondary: (job) => secondaryLocationLine(job) ?? undefined,
    },
  },
  {
    id: "summary",
    kind: "body",
    ratio: 1.5,
    header: "Summary",
    cell: { type: "entity-text", value: (job) => job.summary },
  },
  {
    id: "address",
    kind: "body",
    ratio: 1,
    header: "Property Address",
    cell: {
      type: "entity-text",
      value: (job) => [job.locationAddress, job.locationCity].filter(Boolean).join(", ") || "—",
    },
  },
  {
    id: "schedule",
    kind: "body",
    header: "Schedule",
    sortKey: "schedule",
    cell: {
      type: "customRender",
      reason: "icon + formatted date; conditional 'Not scheduled' branch",
      render: (job) =>
        job.scheduledStart ? (
          <div className="flex items-center gap-1" data-testid={`text-schedule-${job.id}`}>
            <CalendarIcon className="h-3 w-3 text-slate-400" />
            {format(new Date(job.scheduledStart), "MMM d, yyyy")}
          </div>
        ) : (
          <span className="text-slate-400" data-testid={`text-schedule-${job.id}`}>Not scheduled</span>
        ),
    },
  },
  {
    id: "status",
    kind: "status",
    header: "Status",
    sortKey: "status",
    cell: {
      type: "entity-status",
      getStatusMeta: (job) => getJobStatusMeta(job),
    },
  },
  {
    id: "jobNumber",
    kind: "badge",
    ratio: 0.7,
    minWidthPx: 88,
    header: "Job #",
    sortKey: "jobNumber",
    cell: {
      type: "customRender",
      reason: "entity-number chip",
      render: (job) => (
        <div data-testid={`text-jobnumber-${job.id}`}>
          <EntityNumber variant="primary">{job.jobNumber}</EntityNumber>
        </div>
      ),
    },
  },
];

// ── JobsWorkspaceTab ──────────────────────────────────────────────────────────

interface JobsWorkspaceTabProps {
  /** Active view — owned and URL-synced by the parent page. */
  activeView: JobView;
  /** Search string — owned by the parent page. */
  searchQuery: string;
  /** Highlighted row key — drives EntityListTable selection highlight. */
  selectedJobId: string | null;
  /** Called when a row is clicked; parent page owns selection state. */
  onRailContextChange: (ctx: SelectedJobContext | null) => void;
}

/**
 * Jobs table adapter.
 * Owns: feed fetch, enrichment, client-side filtering, pagination.
 * Does NOT own: view state, URL navigation, rail layout, filter bar.
 * Those are owned by JobsWorkspacePage.
 */
export function JobsWorkspaceTab({
  activeView,
  searchQuery,
  selectedJobId,
  onRailContextChange,
}: JobsWorkspaceTabProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Reset pagination when the view changes.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [activeView]);

  // ── Feed fetch ─────────────────────────────────────────────────────────────
  const { jobs: rawJobs, isLoading, error } = useJobsFeed({
    limit: 200,
    includeCounts: true,
  });

  const enrichedJobs = useMemo<EnrichedJob[]>(() => {
    const now = new Date();
    return rawJobs.map((j) => ({ ...j, _overdue: isJobOverdue(j, now) }));
  }, [rawJobs]);

  // ── Client-side filtering ─────────────────────────────────────────────────
  const filteredJobs = useMemo(() => {
    const byView = applyViewPredicate(enrichedJobs, activeView);
    return applySearch(byView, searchQuery);
  }, [enrichedJobs, activeView, searchQuery]);

  // ── Row click — toggle selection ──────────────────────────────────────────
  const handleRowClick = (job: EnrichedJob) => {
    const alreadySelected = selectedJobId === job.id;
    if (alreadySelected) {
      onRailContextChange(null);
    } else {
      onRailContextChange({
        jobId: job.id,
        jobNumber: job.jobNumber,
        locationDisplayName: job.locationDisplayName,
        locationId: job.locationId,
        locationAddress: job.locationAddress,
        locationCity: job.locationCity,
        status: job.status,
        openSubStatus: job.openSubStatus,
        scheduledStart: job.scheduledStart,
        jobType: job.jobType,
        priority: job.priority,
        _overdue: job._overdue,
      });
    }
  };

  return (
    <WorkspaceCenterPane data-testid="jobs-workspace-tab">
      <WorkspaceEntitySurface
        data-testid="tab-content-jobs"
        footer={
          <ListLoadMoreFooter
            visibleCount={Math.min(visibleCount, filteredJobs.length)}
            totalCount={filteredJobs.length}
            hasMore={visibleCount < filteredJobs.length}
            onLoadMore={() => setVisibleCount((c) => c + PAGE_SIZE)}
            label="job"
          />
        }
      >
        <div className="h-full overflow-y-auto">
          <EntityListTable<EnrichedJob>
            rows={filteredJobs.slice(0, visibleCount)}
            rowKey={(job) => job.id}
            onRowClick={handleRowClick}
            selectedRowKey={selectedJobId ?? undefined}
            loadingState={isLoading ? { kind: "loading", title: "Loading jobs…" } : undefined}
            emptyState={
              rawJobs.length === 0
                ? { kind: "empty", icon: "wrench", title: "No jobs yet" }
                : { kind: "no-results", title: "No jobs match this view" }
            }
            errorState={
              error
                ? { kind: "error", title: "Failed to load jobs" }
                : undefined
            }
            columns={JOB_COLUMNS}
          />
        </div>
      </WorkspaceEntitySurface>
    </WorkspaceCenterPane>
  );
}
