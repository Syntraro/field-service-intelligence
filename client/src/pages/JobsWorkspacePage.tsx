import { useState, useCallback } from "react";
import { useSearch, useLocation } from "wouter";
import { Search, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CreateJobModal } from "@/components/CreateJobModal";
import { OperationalWorkspace } from "@/components/workspace/OperationalWorkspace";
import { OperationalWorkspaceHeader } from "@/components/workspace/OperationalWorkspaceHeader";
import {
  WorkspaceFilterBar,
  WorkspaceViewChip,
  WorkspaceFilterBarSeparator,
  WorkspaceViewMoreDropdown,
  WorkspaceViewDropdownItem,
} from "@/components/workspace/WorkspaceFilterBar";
import { VALID_VIEWS, type JobView, readViewFromSearch } from "@/lib/jobsWorkspaceConfig";
import { useWorkspaceState } from "@/hooks/useWorkspaceState";
import { JobsWorkspaceTab } from "./jobs/JobsWorkspaceTab";
import { JobKpiStrip } from "./jobs/JobKpiStrip";
import { JobRailBody } from "./jobs/JobRailBody";
import type { SelectedJobContext } from "./jobs/JobActionsRail";

// ── JobsWorkspacePage ─────────────────────────────────────────────────────────

/**
 * Canonical Jobs workspace page shell.
 *
 * Owns: active view (URL-synced), search query, selected job context,
 * rail expansion, view navigation, CreateJob modal.
 * Delegates: feed fetch, enrichment, filtering, table render → JobsWorkspaceTab.
 * Delegates: rail content + scroll → JobRailBody → JobActionsRail.
 */
export default function JobsWorkspacePage() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const activeView = readViewFromSearch(search);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedContext, setSelectedContext] = useState<SelectedJobContext | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const railExpanded = selectedContext !== null;

  // ── View navigation ────────────────────────────────────────────────────────

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
    },
  });

  const handleViewChange = (view: JobView) => ws.setView(view);

  const handleRailContextChange = useCallback((ctx: SelectedJobContext | null) => {
    setSelectedContext(ctx);
  }, []);

  // ── Filter bar active-marker helpers ──────────────────────────────────────

  const moreActive     = (["awaiting-follow-up", "waiting-for-parts", "ready-to-invoice", "completed-not-invoiced", "unassigned"] as JobView[]).includes(activeView);
  const workflowActive = (["service", "maintenance", "install", "warranty", "emergency", "recurring"] as JobView[]).includes(activeView);
  const attentionActive = (["missing-labor", "missing-notes", "missing-line-items", "no-future-visit", "return-visit-required", "technician-flagged"] as JobView[]).includes(activeView);

  // ── Center content ────────────────────────────────────────────────────────

  const centerContent = (
    <>
      <OperationalWorkspaceHeader
        icon={Wrench}
        iconColor="text-blue-600"
        iconBg="bg-blue-50"
        title="Jobs"
        subtitle="Manage service jobs and maintenance visits."
        search={
          <div className="relative">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
              aria-hidden="true"
            />
            <Input
              placeholder="Search jobs, clients, addresses…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 w-52 h-8 rounded-lg border-slate-200 bg-white text-sm"
              data-testid="input-search-jobs"
            />
          </div>
        }
        primaryAction={
          <Button
            size="sm"
            className="rounded-lg px-3.5"
            onClick={() => setCreateOpen(true)}
            data-testid="button-new-job"
          >
            New Job
          </Button>
        }
        kpis={<JobKpiStrip />}
        testId="jobs-workspace-header"
      />

      {/* Filter bar — sits on app background between header card and table */}
      <div className="shrink-0 px-4 py-2">
        <WorkspaceFilterBar
          className="bg-transparent border-b-0 px-0 py-0 min-h-0"
          data-testid="job-filter-bar"
        >
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
      </div>

      {/* Table — flex-col parent so WorkspaceCenterPane's flex-1 resolves correctly */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <JobsWorkspaceTab
          activeView={activeView}
          searchQuery={searchQuery}
          selectedJobId={selectedContext?.jobId ?? null}
          onRailContextChange={handleRailContextChange}
        />
      </div>
    </>
  );

  return (
    <div className="h-full bg-app-bg overflow-hidden" data-testid="jobs-workspace-page">
      <OperationalWorkspace
        center={centerContent}
        centerClassName="overflow-x-auto overflow-y-hidden"
        rightRailExpanded={railExpanded}
        rightRail={
          selectedContext
            ? <JobRailBody context={selectedContext} />
            : <></>
        }
        rightExpandedWidth={380}
        rightCollapsedWidth={0}
        rightRailClassName={cn(
          railExpanded && "border-l border-border shadow-[-8px_0_18px_rgba(15,23,42,0.06)]",
        )}
        showRailDivider={false}
        rightRailTestId="job-workspace-rail"
        data-testid="jobs-workspace"
      />
      <CreateJobModal open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
