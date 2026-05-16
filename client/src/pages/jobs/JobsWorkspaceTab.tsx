import { useState, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { useJobsFeed, type JobFeedItem } from "@/hooks/useJobsFeed";
import { isJobScheduled, isJobOverdue } from "@shared/schema";
import { getJobStatusMeta } from "@/lib/statusBadges";
import { EntityListTable, type EntityListColumn } from "@/components/lists/EntityListTable";
import { EntityNumber } from "@/components/common/EntityNumber";
import { ListLoadMoreFooter } from "@/components/lists/ListLoadMoreFooter";
import { type JobView } from "./JobViewRail";
import { JobActionsRail, type SelectedJobContext } from "./JobActionsRail";
import { OperationalWorkspace } from "@/components/workspace/OperationalWorkspace";
import { WorkspaceCenterPane } from "@/components/workspace/WorkspaceCenterPane";
import { WorkspaceEntitySurface } from "@/components/workspace/WorkspaceEntitySurface";
import {
  WorkspaceFilterBar,
  WorkspaceViewChip,
  WorkspaceFilterBarSeparator,
  WorkspaceViewMoreDropdown,
  WorkspaceViewDropdownItem,
} from "@/components/workspace/WorkspaceFilterBar";
import { useWorkspaceState } from "@/hooks/useWorkspaceState";
import { useWorkspaceSelection } from "@/hooks/useWorkspaceSelection";

// ── Types ─────────────────────────────────────────────────────────────────────

type EnrichedJob = JobFeedItem & { _overdue: boolean };

const VALID_VIEWS: readonly JobView[] = [
  "all", "needs-scheduling", "scheduled-today", "in-progress",
  "awaiting-follow-up", "waiting-for-parts", "ready-to-invoice",
  "completed-not-invoiced", "overdue", "unassigned",
  "service", "maintenance", "install", "warranty", "emergency", "recurring",
  "missing-labor", "missing-notes", "missing-line-items",
  "no-future-visit", "return-visit-required", "technician-flagged",
];

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
  searchQuery: string;
  onSearchChange?: (q: string) => void;
}

export function JobsWorkspaceTab({ searchQuery }: JobsWorkspaceTabProps) {
  const [, setLocation] = useLocation();
  const search = useSearch();

  // ── View URL sync ──────────────────────────────────────────────────────────
  const activeView = useMemo<JobView>(() => {
    const p = new URLSearchParams(search);
    const v = p.get("view");
    return v && (VALID_VIEWS as readonly string[]).includes(v) ? (v as JobView) : "all";
  }, [search]);

  // ── Domain selection ───────────────────────────────────────────────────────
  const [selectedContext, setSelectedContext] = useState<SelectedJobContext | null>(null);
  const [railExpanded, setRailExpanded] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // ── Workspace infrastructure ───────────────────────────────────────────────
  const ws = useWorkspaceState({
    lsKey: "syntraro.jobs",
    validViews: VALID_VIEWS,
    defaultView: "all",
    onNavigate: (view) => {
      const params = new URLSearchParams(search);
      if (view === "all") params.delete("view");
      else params.set("view", view);
      setLocation(`/jobs?${params}`);
    },
    onViewChange: () => {
      setSelectedContext(null);
      setRailExpanded(false);
      setVisibleCount(PAGE_SIZE);
    },
  });

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

  // ── Selection ──────────────────────────────────────────────────────────────
  const { handleSelectionChange } = useWorkspaceSelection<SelectedJobContext>(
    (ctx) => {
      setSelectedContext(ctx);
      setRailExpanded(ctx !== null);
    },
  );

  const handleRowClick = (job: EnrichedJob) => {
    const ctx: SelectedJobContext = { jobId: job.id };
    const alreadySelected = selectedContext?.jobId === job.id;
    if (alreadySelected) {
      setSelectedContext(null);
      setRailExpanded(false);
    } else {
      handleSelectionChange(ctx, false);
    }
  };

  const handleViewChange = (view: JobView) => {
    ws.setView(view);
    // Selection clearing and visibleCount reset are handled by onViewChange in useWorkspaceState.
  };

  const moreActive = ["awaiting-follow-up", "waiting-for-parts", "ready-to-invoice", "completed-not-invoiced", "unassigned"].includes(activeView);
  const workflowActive = ["service", "maintenance", "install", "warranty", "emergency", "recurring"].includes(activeView);
  const attentionActive = ["missing-labor", "missing-notes", "missing-line-items", "no-future-visit", "return-visit-required", "technician-flagged"].includes(activeView);

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* ── Horizontal view/filter bar ── */}
      <WorkspaceFilterBar data-testid="job-filter-bar">
        <WorkspaceViewChip active={activeView === "all"} onClick={() => handleViewChange("all")} data-testid="job-view-all">All</WorkspaceViewChip>
        <WorkspaceViewChip active={activeView === "scheduled-today"} onClick={() => handleViewChange("scheduled-today")} data-testid="job-view-scheduled-today">Today</WorkspaceViewChip>
        <WorkspaceViewChip active={activeView === "needs-scheduling"} onClick={() => handleViewChange("needs-scheduling")} data-testid="job-view-needs-scheduling">Unscheduled</WorkspaceViewChip>
        <WorkspaceViewChip active={activeView === "in-progress"} onClick={() => handleViewChange("in-progress")} data-testid="job-view-in-progress">In Progress</WorkspaceViewChip>
        <WorkspaceViewChip active={activeView === "overdue"} onClick={() => handleViewChange("overdue")} data-testid="job-view-overdue">Overdue</WorkspaceViewChip>

        <WorkspaceFilterBarSeparator />

        <WorkspaceViewMoreDropdown label="More" activeInDropdown={moreActive}>
          <WorkspaceViewDropdownItem active={activeView === "awaiting-follow-up"} onClick={() => handleViewChange("awaiting-follow-up")}>Awaiting Follow-up</WorkspaceViewDropdownItem>
          <WorkspaceViewDropdownItem active={activeView === "waiting-for-parts"} onClick={() => handleViewChange("waiting-for-parts")}>Waiting for Parts</WorkspaceViewDropdownItem>
          <WorkspaceViewDropdownItem active={activeView === "ready-to-invoice"} onClick={() => handleViewChange("ready-to-invoice")}>Ready to Invoice</WorkspaceViewDropdownItem>
          <WorkspaceViewDropdownItem active={activeView === "completed-not-invoiced"} onClick={() => handleViewChange("completed-not-invoiced")}>Completed, Not Invoiced</WorkspaceViewDropdownItem>
          <WorkspaceViewDropdownItem active={activeView === "unassigned"} onClick={() => handleViewChange("unassigned")}>Unassigned</WorkspaceViewDropdownItem>
        </WorkspaceViewMoreDropdown>

        <WorkspaceViewMoreDropdown label="Workflow" activeInDropdown={workflowActive}>
          <WorkspaceViewDropdownItem active={activeView === "service"} onClick={() => handleViewChange("service")}>Service</WorkspaceViewDropdownItem>
          <WorkspaceViewDropdownItem active={activeView === "maintenance"} onClick={() => handleViewChange("maintenance")}>Maintenance</WorkspaceViewDropdownItem>
          <WorkspaceViewDropdownItem active={activeView === "install"} onClick={() => handleViewChange("install")}>Install</WorkspaceViewDropdownItem>
          <WorkspaceViewDropdownItem active={activeView === "warranty"} onClick={() => handleViewChange("warranty")}>Warranty</WorkspaceViewDropdownItem>
          <WorkspaceViewDropdownItem active={activeView === "emergency"} onClick={() => handleViewChange("emergency")}>Emergency</WorkspaceViewDropdownItem>
          <WorkspaceViewDropdownItem active={activeView === "recurring"} onClick={() => handleViewChange("recurring")}>Recurring</WorkspaceViewDropdownItem>
        </WorkspaceViewMoreDropdown>

        <WorkspaceViewMoreDropdown label="Attention" activeInDropdown={attentionActive}>
          <WorkspaceViewDropdownItem active={activeView === "missing-labor"} onClick={() => handleViewChange("missing-labor")}>Missing Labor</WorkspaceViewDropdownItem>
          <WorkspaceViewDropdownItem active={activeView === "missing-notes"} onClick={() => handleViewChange("missing-notes")}>Missing Notes</WorkspaceViewDropdownItem>
          <WorkspaceViewDropdownItem active={activeView === "missing-line-items"} onClick={() => handleViewChange("missing-line-items")}>Missing Line Items</WorkspaceViewDropdownItem>
          <WorkspaceViewDropdownItem active={activeView === "no-future-visit"} onClick={() => handleViewChange("no-future-visit")}>No Future Visit</WorkspaceViewDropdownItem>
          <WorkspaceViewDropdownItem active={activeView === "return-visit-required"} onClick={() => handleViewChange("return-visit-required")}>Return Visit Required</WorkspaceViewDropdownItem>
          <WorkspaceViewDropdownItem active={activeView === "technician-flagged"} onClick={() => handleViewChange("technician-flagged")}>Flagged by Technician</WorkspaceViewDropdownItem>
        </WorkspaceViewMoreDropdown>
      </WorkspaceFilterBar>

      {/* ── Workspace: center list + contextual right rail ── */}
      <OperationalWorkspace
        rightRailExpanded={railExpanded}
        center={
          <WorkspaceCenterPane>
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
                  selectedRowKey={selectedContext?.jobId}
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
        }
        rightRail={<JobActionsRail context={selectedContext} />}
        data-testid="jobs-workspace-tab"
      />
    </div>
  );
}
