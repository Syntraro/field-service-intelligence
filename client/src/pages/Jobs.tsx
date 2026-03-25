/**
 * Jobs list page — standardized list-surface UI.
 * Filters split into two buttons: Status (lifecycle) and Workflow (openSubStatus).
 * Removed: Optimize Route, Reconciliation Panel, Assigned/Unassigned/All-day/Schedule filters.
 */
import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useJobsFeed } from "@/hooks/useJobsFeed";
import { format, differenceInHours } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useLocation, useSearch } from "wouter";
import { ChevronDown, ChevronUp, ArrowUpDown, Loader2, Plus, Calendar as CalendarIcon, Wrench, AlertTriangle, Clock, X, CalendarDays, FileText, MoreHorizontal, Search, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { StatusPill, statusToVariant } from "@/components/ui/status-pill";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ListToolbar } from "@/components/layout/ListToolbar";
import { FiltersButton, FilterSection } from "@/components/filters/FiltersButton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { QuickAddJobDialog } from "@/components/QuickAddJobDialog";
import { ApplyTemplateModal } from "@/components/ApplyTemplateModal";
import { ListSurface, tableRowClass, listHeaderRowClass, listPrimaryClass, listSecondaryClass, listResultsClass } from "@/components/ui/list-surface";
import { TablePageShell } from "@/components/ui/table-page-shell";
import type { User as UserType } from "@shared/schema";
import { isJobScheduled, isJobOverdue } from "@shared/schema";
import { getJobStatusDisplay } from "@/components/job/jobUtils";
import type { JobFeedItem } from "@/hooks/useJobsFeed";

// =============================================================================
// FILTER TYPES — 4-Status Lifecycle + OpenSubStatus Workflow
// =============================================================================
// Lifecycle statuses (stored in jobs.status): open, completed, invoiced, archived
// OpenSubStatus (only when status=open): in_progress, on_hold, on_route
// =============================================================================

type LifecycleStatusFilter = "all" | "open" | "completed" | "invoiced" | "archived";
type OpenSubStatusFilter = "any" | "in_progress" | "on_hold" | "on_route";

type SortField = "priority" | "location" | "jobNumber" | "schedule" | "status";
type SortDirection = "asc" | "desc";

interface SLAKPIData {
  current: {
    total: number;
    slaBreached24h: number;
    escalated: number;
    buckets: { lt24h: number; h24to72: number; gte72h: number };
  };
}

function formatJobNumber(jobNumber: number): string {
  return `#${jobNumber}`;
}

/**
 * getDisplayStatus — single { label, variant, icon? } for the status column.
 * Priority: overdue > requires invoicing > archived > invoiced > sub-status > lifecycle fallback.
 */
function getDisplayStatus(job: { status: string; openSubStatus: string | null; _overdue: boolean }): { label: string; variant: "neutral" | "success" | "warning" | "danger" | "info"; icon?: React.ReactNode } {
  if (job._overdue) return { label: "Overdue", variant: "danger" };
  if (job.status === "completed") return { label: "Requires invoicing", variant: "warning" };
  if (job.status === "archived") return { label: "Archived", variant: "neutral" };
  if (job.status === "invoiced") return { label: "Invoiced", variant: "success" };
  if (job.status === "open" && job.openSubStatus) {
    const subLabels: Record<string, string> = { in_progress: "In Progress", on_hold: "On Hold", on_route: "On Route" };
    return { label: subLabels[job.openSubStatus] || job.openSubStatus, variant: statusToVariant(job.openSubStatus) };
  }
  return { label: job.status === "open" ? "Open" : job.status, variant: statusToVariant(job.status) };
}

const SLA_WARNING_HOURS = 24;
const OFFICE_ROLES = ["owner", "admin", "manager", "dispatcher"];
const ITEMS_PER_PAGE = 50;

export default function Jobs() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const searchString = useSearch();

  // Parse URL query params for contextual navigation from dashboard links
  const urlParams = useMemo(() => new URLSearchParams(searchString), [searchString]);

  // Virtual filters from URL: ?scheduling=unscheduled, ?subStatus=overdue
  // These set lifecycle + a client-side post-filter for the specific view.
  const schedulingParam = urlParams.get("scheduling");
  const subStatusParam = urlParams.get("subStatus");

  const initialLifecycle = (): LifecycleStatusFilter => {
    const v = urlParams.get("lifecycle");
    if (v && ["all", "open", "completed", "invoiced", "archived"].includes(v)) {
      return v as LifecycleStatusFilter;
    }
    return "all";
  };
  const initialSubStatus = (): OpenSubStatusFilter => {
    // "overdue" is a virtual sub-status handled as a post-filter, map to "any" for the tab
    if (subStatusParam && ["any", "in_progress", "on_hold", "on_route"].includes(subStatusParam)) {
      return subStatusParam as OpenSubStatusFilter;
    }
    return "any";
  };

  const [lifecycleFilter, setLifecycleFilter] = useState<LifecycleStatusFilter>(initialLifecycle);
  const [openSubStatusFilter, setOpenSubStatusFilter] = useState<OpenSubStatusFilter>(initialSubStatus);
  // Dashboard virtual filters: "unscheduled" or "overdue" — applied as post-filters on the job list
  const [dashboardFilter, setDashboardFilter] = useState<"unscheduled" | "overdue" | null>(
    schedulingParam === "unscheduled" ? "unscheduled" : subStatusParam === "overdue" ? "overdue" : null
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("schedule");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_PAGE);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [applyTemplateJob, setApplyTemplateJob] = useState<{ id: string; jobNumber: number } | null>(null);
  const [dismissedSLAWarning, setDismissedSLAWarning] = useState(false);
  const [dismissedUrgentWarning, setDismissedUrgentWarning] = useState(false);

  // Hybrid search: history mode state
  const [isHistoryMode, setIsHistoryMode] = useState(false);
  const [debouncedHistoryQuery, setDebouncedHistoryQuery] = useState("");
  useEffect(() => {
    if (!isHistoryMode) return;
    const timer = setTimeout(() => setDebouncedHistoryQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery, isHistoryMode]);

  const { jobs: historyJobs, isLoading: isHistoryLoading } = useJobsFeed(
    { search: debouncedHistoryQuery, searchMode: "history", limit: 50 },
    { enabled: isHistoryMode && debouncedHistoryQuery.length >= 2 }
  );
  const [selectedRowIndex, setSelectedRowIndex] = useState(-1);
  const loaderRef = useRef<HTMLDivElement>(null);

  const feedParams = useMemo(() => ({
    limit: 200,
    offset: 0,
    ...(sortField === "priority" ? { sortBy: "priority" as const } : {}),
    includeCounts: true, // P3-05: request true aggregate counts
  }), [sortField]);
  const { jobs, isLoading, counts: serverCounts } = useJobsFeed(feedParams);

  const isOfficeUser = Boolean(user?.role && OFFICE_ROLES.includes(user.role));

  // Fetch SLA KPIs for warning banners (office users only)
  const { data: slaKpis } = useQuery<SLAKPIData>({
    queryKey: ["/api/reports/action-required-kpis"],
    queryFn: async () => {
      const res = await fetch("/api/reports/action-required-kpis?days=30", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch KPIs");
      return res.json();
    },
    enabled: isOfficeUser,
    staleTime: 5 * 60 * 1000,
  });

  // 2026-03-18: Removed escalateMutation, handleEscalate, updateActionRequiredMutation — dead code
  // calling non-existent API endpoints (/api/jobs/:id/mark-action-required-escalated, PATCH /api/jobs/:id/action-required).

  // Enriched jobs — single pass of predicate computation
  const enrichedJobs = useMemo(() => {
    const now = new Date();
    return jobs.map(job => {
      const statusInfo = getJobStatusDisplay(job);
      return {
        ...job,
        statusInfo,
        _scheduled: isJobScheduled(job),
        _overdue: isJobOverdue(job, now),
      };
    });
  }, [jobs]);

  const filteredAndSortedJobs = useMemo(() => {
    let result = enrichedJobs.slice();

    // 1. Lifecycle status filter
    if (lifecycleFilter === "all") {
      result = result.filter(job => job.status !== "archived");
    } else {
      result = result.filter(job => job.status === lifecycleFilter);
    }

    // 2. OpenSubStatus filter (only applies when viewing open jobs)
    if (openSubStatusFilter !== "any") {
      result = result.filter(job =>
        job.status === "open" && job.openSubStatus === openSubStatusFilter
      );
    }

    // 2b. Dashboard virtual filters: unscheduled or overdue
    if (dashboardFilter === "unscheduled") {
      result = result.filter(job => job.status === "open" && !isJobScheduled(job));
    } else if (dashboardFilter === "overdue") {
      result = result.filter(job => job.status === "open" && isJobOverdue(job));
    }

    // 3. Search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(job => {
        const companyName = job.locationDisplayName?.toLowerCase() || "";
        const locationName = job.locationName?.toLowerCase() || "";
        const address = job.locationAddress?.toLowerCase() || "";
        const city = job.locationCity?.toLowerCase() || "";
        const jobNumber = formatJobNumber(job.jobNumber).toLowerCase();
        const summary = job.summary?.toLowerCase() || "";
        return companyName.includes(query) ||
               locationName.includes(query) ||
               address.includes(query) ||
               city.includes(query) ||
               jobNumber.includes(query) ||
               summary.includes(query);
      });
    }

    // 4. Sort
    if (sortField !== "priority") {
      result.sort((a, b) => {
        let comparison = 0;
        switch (sortField) {
          case "location": {
            const companyCompare = (a.locationDisplayName || "").localeCompare(b.locationDisplayName || "");
            comparison = companyCompare !== 0
              ? companyCompare
              : (a.locationName || "").localeCompare(b.locationName || "");
            break;
          }
          case "jobNumber":
            comparison = a.jobNumber - b.jobNumber;
            break;
          case "schedule":
            if (!a.scheduledStart && !b.scheduledStart) comparison = 0;
            else if (!a.scheduledStart) comparison = 1;
            else if (!b.scheduledStart) comparison = -1;
            else comparison = new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime();
            break;
          case "status":
            comparison = a.statusInfo.priority - b.statusInfo.priority;
            break;
        }
        return sortDirection === "asc" ? comparison : -comparison;
      });
    }

    return result;
  }, [enrichedJobs, lifecycleFilter, openSubStatusFilter, dashboardFilter, searchQuery, sortField, sortDirection]);

  useEffect(() => {
    setVisibleCount(ITEMS_PER_PAGE);
  }, [lifecycleFilter, openSubStatusFilter, searchQuery, sortField, sortDirection]);

  const visibleJobs = useMemo(() => filteredAndSortedJobs.slice(0, visibleCount), [filteredAndSortedJobs, visibleCount]);
  const hasMore = visibleCount < filteredAndSortedJobs.length;

  const handleObserver = useCallback((entries: IntersectionObserverEntry[]) => {
    const target = entries[0];
    if (target.isIntersecting && hasMore) {
      setVisibleCount(prev => Math.min(prev + ITEMS_PER_PAGE, filteredAndSortedJobs.length));
    }
  }, [hasMore, filteredAndSortedJobs.length]);

  useEffect(() => {
    const observer = new IntersectionObserver(handleObserver, { root: null, rootMargin: "100px", threshold: 0.1 });
    if (loaderRef.current) observer.observe(loaderRef.current);
    return () => observer.disconnect();
  }, [handleObserver]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (visibleJobs.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedRowIndex(prev => Math.min(prev + 1, visibleJobs.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedRowIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && selectedRowIndex >= 0 && selectedRowIndex < visibleJobs.length) {
        e.preventDefault();
        setLocation(`/jobs/${visibleJobs[selectedRowIndex].id}`);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [visibleJobs, selectedRowIndex, setLocation]);

  useEffect(() => {
    setSelectedRowIndex(-1);
  }, [lifecycleFilter, openSubStatusFilter, searchQuery]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const handleRowClick = (job: JobFeedItem) => {
    setLocation(`/jobs/${job.id}`);
  };

  // Standardized sortable header matching list-surface tokens
  const SortableHeader = ({ field, children, testId }: { field: SortField; children: React.ReactNode; testId: string }) => (
    <TableHead
      className="cursor-pointer hover:bg-muted/50 select-none text-xs font-medium"
      onClick={() => handleSort(field)}
      data-testid={testId}
    >
      <div className="flex items-center gap-1">
        {children}
        {sortField === field ? (
          sortDirection === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-30" />
        )}
      </div>
    </TableHead>
  );

  // P3-05: True aggregate counts from server (not capped by feed limit).
  // Falls back to zero counts while loading.
  const counts = serverCounts ?? {
    lifecycle: { open: 0, completed: 0, invoiced: 0, archived: 0 },
    openSubStatus: { in_progress: 0, on_hold: 0, on_route: 0 },
    total: 0,
  };

  // "All" = total minus archived (preserves current UI semantics)
  const totalCount = counts.total - counts.lifecycle.archived;

  // Active filter count for Status button
  const statusFilterCount = lifecycleFilter !== "all" ? 1 : 0;
  // Active filter count for Workflow button
  const workflowFilterCount = openSubStatusFilter !== "any" ? 1 : 0;

  if (isLoading) {
    return (
      <div className="p-6" data-testid="jobs-loading">
        <div className="text-center py-8">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
          Loading jobs...
        </div>
      </div>
    );
  }

  return (
    <TablePageShell title="Jobs" data-testid="jobs-page">
      {/* SLA Breach Warning Banners — office users only */}
      {isOfficeUser && slaKpis?.current && (
        <div className="space-y-2" data-testid="sla-warning-banners">
          {slaKpis.current.buckets.gte72h > 0 && !dismissedUrgentWarning && (
            <Alert variant="destructive" className="border-red-400 bg-red-50" data-testid="banner-urgent">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="flex items-center justify-between flex-1 ml-2">
                <span className="font-medium">
                  {slaKpis.current.buckets.gte72h} Action Required job{slaKpis.current.buckets.gte72h !== 1 ? 's are' : ' is'} 72h+ old and require{slaKpis.current.buckets.gte72h === 1 ? 's' : ''} immediate attention.
                </span>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0 hover:bg-red-100" onClick={() => setDismissedUrgentWarning(true)} data-testid="dismiss-urgent-banner">
                  <X className="h-4 w-4" />
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {slaKpis.current.slaBreached24h > 0 && !dismissedSLAWarning && (
            <Alert className="border-orange-400 bg-orange-50" data-testid="banner-sla-warning">
              <Clock className="h-4 w-4 text-orange-600" />
              <AlertDescription className="flex items-center justify-between flex-1 ml-2">
                <span className="font-medium text-orange-800">
                  {slaKpis.current.slaBreached24h} Action Required job{slaKpis.current.slaBreached24h !== 1 ? 's have' : ' has'} breached the 24h SLA.
                </span>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0 hover:bg-orange-100" onClick={() => setDismissedSLAWarning(true)} data-testid="dismiss-sla-banner">
                  <X className="h-4 w-4" />
                </Button>
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {/* Toolbar: search + filter buttons (hidden in history mode) */}
      <ListToolbar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder={isHistoryMode ? "Search all job history..." : "Search jobs..."}
        searchTestId="input-search-jobs"
      >
        {!isHistoryMode && (
          <>
            {/* Status filter button */}
            <FiltersButton
              label="Status"
              activeCount={statusFilterCount}
              onClear={() => setLifecycleFilter("all")}
            >
              <FilterSection label="Status">
                <div className="flex flex-wrap gap-1.5">
                  {(["all", "open", "completed", "invoiced", "archived"] as LifecycleStatusFilter[]).map((val) => (
                    <Button
                      key={val}
                      variant={lifecycleFilter === val ? "default" : "outline"}
                      size="sm"
                      className="h-7 text-xs rounded-full"
                      onClick={() => setLifecycleFilter(val)}
                      data-testid={`button-filter-status-${val}`}
                    >
                      {val === "all" ? `All (${totalCount})` :
                       `${val.charAt(0).toUpperCase() + val.slice(1)} (${counts.lifecycle[val as keyof typeof counts.lifecycle]})`}
                    </Button>
                  ))}
                </div>
              </FilterSection>
            </FiltersButton>

            {/* Workflow filter button — canonical openSubStatus values only */}
            {(lifecycleFilter === "all" || lifecycleFilter === "open") && (
              <FiltersButton
                label="Workflow"
                activeCount={workflowFilterCount}
                onClear={() => setOpenSubStatusFilter("any")}
              >
                <FilterSection label="Workflow">
                  <div className="flex flex-wrap gap-1.5">
                    {([
                      { val: "any" as const, label: "Any" },
                      { val: "in_progress" as const, label: `In Progress (${counts.openSubStatus.in_progress})` },
                      { val: "on_route" as const, label: `On Route (${counts.openSubStatus.on_route})` },
                      { val: "on_hold" as const, label: `On Hold (${counts.openSubStatus.on_hold})` },
                    ]).map(({ val, label }) => (
                      <Button
                        key={val}
                        variant={openSubStatusFilter === val ? "default" : "outline"}
                        size="sm"
                        className="h-7 text-xs rounded-full"
                        onClick={() => setOpenSubStatusFilter(val)}
                        data-testid={val === "any" ? "filter-substatus-any" : `filter-substatus-${val}`}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                </FilterSection>
              </FiltersButton>
            )}
          </>
        )}
        {isHistoryMode && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => setIsHistoryMode(false)}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to recent jobs
          </Button>
        )}
      </ListToolbar>

      {/* History mode header */}
      {isHistoryMode && (
        <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 border-b border-blue-100 text-sm text-blue-700">
          <Search className="h-4 w-4" />
          <span className="font-medium">Searching all job history</span>
        </div>
      )}

      {/* History search CTA — above the list so it's visible without scrolling */}
      {!isHistoryMode && searchQuery.trim().length > 0 && (
        <button
          onClick={() => setIsHistoryMode(true)}
          className="w-full py-1.5 text-center text-xs text-muted-foreground hover:text-foreground hover:bg-slate-50 border-b transition-colors"
        >
          Not finding a job? <span className="font-medium underline underline-offset-2">Search all job history</span>
        </button>
      )}

      {/* History mode: server-searched results replace the local list */}
      {isHistoryMode ? (
        <ListSurface data-testid="table-jobs-history">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-medium">Location</TableHead>
                <TableHead className="text-xs font-medium">Job</TableHead>
                <TableHead className="text-xs font-medium">Summary</TableHead>
                <TableHead className="text-xs font-medium">Schedule</TableHead>
                <TableHead className="text-xs font-medium">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {debouncedHistoryQuery.length < 2 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <Search className="h-8 w-8 opacity-40" />
                      <p>Type at least 2 characters to search all job history</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : isHistoryLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto" />
                  </TableCell>
                </TableRow>
              ) : historyJobs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                    No jobs found matching &ldquo;{debouncedHistoryQuery}&rdquo; in full history
                  </TableCell>
                </TableRow>
              ) : (
                historyJobs.map((job) => (
                  <TableRow
                    key={job.id}
                    className={tableRowClass}
                    onClick={() => handleRowClick(job)}
                  >
                    <TableCell>
                      <div className={listPrimaryClass}>{job.locationDisplayName || "Unknown Company"}</div>
                      {job.locationName && <div className={listSecondaryClass}>{job.locationName}</div>}
                    </TableCell>
                    <TableCell>
                      <div className="font-mono text-sm">{formatJobNumber(job.jobNumber)}</div>
                      <div className={listSecondaryClass + " capitalize"}>{job.jobType}</div>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-[300px] truncate text-sm">{job.summary}</div>
                    </TableCell>
                    <TableCell>
                      {job.scheduledStart ? (
                        <div className="flex items-center gap-1 text-sm">
                          <CalendarIcon className="h-3 w-3 text-muted-foreground" />
                          {format(new Date(job.scheduledStart), "MMM d, yyyy")}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not scheduled</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const ds = getDisplayStatus({ status: job.status, openSubStatus: job.openSubStatus, _overdue: false });
                        return <StatusPill variant={ds.variant} icon={ds.icon}>{ds.label}</StatusPill>;
                      })()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </ListSurface>
      ) : (
      <>
      <ListSurface data-testid="table-jobs">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHeader field="location" testId="header-location">Location</SortableHeader>
              <SortableHeader field="jobNumber" testId="header-jobnumber">Job</SortableHeader>
              <TableHead className="text-xs font-medium" data-testid="header-summary">Summary</TableHead>
              <SortableHeader field="schedule" testId="header-schedule">Schedule</SortableHeader>
              <SortableHeader field="status" testId="header-status">Status</SortableHeader>
              {isOfficeUser && <TableHead className="w-10"></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleJobs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isOfficeUser ? 6 : 5} className="text-center py-8 text-muted-foreground" data-testid="text-no-jobs">
                  {jobs.length === 0 ? (
                    <div className="flex flex-col items-center gap-2">
                      <Wrench className="h-8 w-8 opacity-50" />
                      <p>No jobs yet</p>
                      <Button variant="outline" size="sm" onClick={() => setShowCreateDialog(true)} data-testid="button-create-first-job">
                        <Plus className="h-4 w-4 mr-2" />
                        Create your first job
                      </Button>
                    </div>
                  ) : (
                    "No jobs match your filters"
                  )}
                </TableCell>
              </TableRow>
            ) : (
              visibleJobs.map((job, rowIdx) => (
                <TableRow
                  key={job.id}
                  className={cn(
                    tableRowClass,
                    rowIdx === selectedRowIndex && "ring-1 ring-inset ring-[var(--brand)] bg-[#F3F4F6]"
                  )}
                  onClick={() => handleRowClick(job)}
                  data-testid={`row-job-${job.id}`}
                >
                  {/* Location: company + sublocation */}
                  <TableCell data-testid={`text-location-${job.id}`}>
                    <div className={listPrimaryClass}>{job.locationDisplayName || "Unknown Company"}</div>
                    {job.locationName && (
                      <div className={listSecondaryClass}>{job.locationName}</div>
                    )}
                  </TableCell>
                  {/* Job number + type */}
                  <TableCell data-testid={`text-jobnumber-${job.id}`}>
                    <div className="font-mono text-sm">{formatJobNumber(job.jobNumber)}</div>
                    <div className={listSecondaryClass + " capitalize"}>{job.jobType}</div>
                  </TableCell>
                  {/* Summary */}
                  <TableCell data-testid={`text-summary-${job.id}`}>
                    <div className="max-w-[300px] truncate text-sm">{job.summary}</div>
                  </TableCell>
                  {/* Schedule */}
                  <TableCell data-testid={`text-schedule-${job.id}`}>
                    {job.scheduledStart ? (
                      <div className="flex items-center gap-1 text-sm">
                        <CalendarIcon className="h-3 w-3 text-muted-foreground" />
                        {format(new Date(job.scheduledStart), "MMM d, yyyy")}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Not scheduled</span>
                    )}
                  </TableCell>
                  {/* Status */}
                  <TableCell data-testid={`badge-status-${job.id}`}>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1 flex-wrap">
                        {(() => {
                          const ds = getDisplayStatus(job);
                          return <StatusPill variant={ds.variant} icon={ds.icon}>{ds.label}</StatusPill>;
                        })()}
                      </div>

                      {/* SLA aging indicator for on-hold jobs */}
                      {job.status === "open" && job.openSubStatus === "on_hold" && job.onHoldAt && (() => {
                        const holdTime = job.onHoldAt;
                        const agingHours = holdTime ? differenceInHours(new Date(), new Date(holdTime)) : 0;
                        const agingDays = Math.floor(agingHours / 24);
                        const agingDisplay = agingDays >= 1 ? `${agingDays}d` : `${agingHours}h`;
                        const isOverdueSLA = agingHours >= SLA_WARNING_HOURS;

                        return (
                          <div className="flex items-center gap-1 flex-wrap">
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              Aging: {agingDisplay}
                            </span>
                            {isOverdueSLA && <StatusPill variant="warning">SLA</StatusPill>}
                          </div>
                        );
                      })()}

                      {/* 2026-03-18: Inline quick actions (next-action date picker, notes popover) removed —
                         backed by non-existent PATCH /api/jobs/:id/action-required endpoint */}
                    </div>
                  </TableCell>

                  {/* Row actions */}
                  {isOfficeUser && (
                    <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" data-testid={`btn-actions-${job.id}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => setApplyTemplateJob({ id: job.id, jobNumber: job.jobNumber })}
                            data-testid={`menu-apply-template-${job.id}`}
                          >
                            <FileText className="h-4 w-4 mr-2" />
                            Apply Template
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </ListSurface>

      {hasMore && (
        <div ref={loaderRef} className="flex justify-center py-4" data-testid="loader-more-jobs">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      <div className={listResultsClass} data-testid="text-job-count">
        Showing {visibleJobs.length} of {filteredAndSortedJobs.length} job{filteredAndSortedJobs.length !== 1 ? 's' : ''}
      </div>

      </>
      )}

      <QuickAddJobDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} />

      {applyTemplateJob && (
        <ApplyTemplateModal
          open={!!applyTemplateJob}
          onOpenChange={(open) => !open && setApplyTemplateJob(null)}
          jobId={applyTemplateJob.id}
          jobNumber={applyTemplateJob.jobNumber}
        />
      )}
    </TablePageShell>
  );
}
