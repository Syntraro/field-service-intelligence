/**
 * Jobs list page — informational overview + full job list.
 *
 * 2026-03-28: Redesigned to match approved mockup direction.
 * - Clean informational summary cards (visits this week/month, scheduled, revenue)
 * - No attention banners, no age text, no action-dashboard crossover
 * - Professional darker neutral visual tone
 * - Preserved all canonical data paths, filters, search, sorting, pagination
 */
import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useJobsFeed } from "@/hooks/useJobsFeed";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useLocation, useSearch } from "wouter";
import {
  ChevronDown, ChevronUp, ArrowUpDown, Loader2, Plus,
  Calendar as CalendarIcon, Wrench,
  FileText, MoreHorizontal, Search, ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { StatusPill, statusToVariant } from "@/components/ui/status-pill";
import { FiltersButton, FilterSection } from "@/components/filters/FiltersButton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { QuickAddJobDialog } from "@/components/QuickAddJobDialog";
import { ApplyTemplateModal } from "@/components/ApplyTemplateModal";
import { tableRowClass, listPrimaryClass, listSecondaryClass, listResultsClass } from "@/components/ui/list-surface";
import { isJobScheduled, isJobOverdue } from "@shared/schema";
import { getJobStatusDisplay } from "@/components/job/jobUtils";
import type { JobFeedItem } from "@/hooks/useJobsFeed";

// =============================================================================
// FILTER TYPES — 4-Status Lifecycle + OpenSubStatus Workflow
// =============================================================================

type LifecycleStatusFilter = "all" | "open" | "completed" | "invoiced" | "archived";
type OpenSubStatusFilter = "any" | "in_progress" | "on_hold" | "on_route";
type SortField = "priority" | "location" | "jobNumber" | "schedule" | "status";
type SortDirection = "asc" | "desc";

// =============================================================================
// Summary card data types (canonical endpoints)
// =============================================================================

interface VisitFeedResponse { visits: unknown[]; count: number }
interface FinancialSummary {
  revenue: { today: number; week: number; month: number; lastMonth: number };
  [key: string]: unknown;
}

// =============================================================================
// Helpers
// =============================================================================

function formatJobNumber(jobNumber: number): string {
  return `#${jobNumber}`;
}

/** Single status display: overdue > requires invoicing > archived > invoiced > sub-status > derived > lifecycle.
 * Matches jobUtils.ts getJobStatusDisplay logic for consistency between list and detail views.
 * 2026-04-12 (Option A): `assignedTechnicianIds` on the job feed response is
 * the visit-derived crew union (see server/storage/visitCrew.ts). It is the
 * ONLY source checked here — no job-level fallback. */
function getDisplayStatus(job: { status: string; openSubStatus: string | null; _overdue: boolean; scheduledStart?: string | null; assignedTechnicianIds?: string[] | null }): { label: string; variant: "neutral" | "success" | "warning" | "danger" | "info"; icon?: React.ReactNode } {
  if (job._overdue) return { label: "Overdue", variant: "danger" };
  if (job.status === "completed") return { label: "Requires invoicing", variant: "warning" };
  if (job.status === "archived") return { label: "Archived", variant: "neutral" };
  if (job.status === "invoiced") return { label: "Invoiced", variant: "success" };
  if (job.status === "open" && job.openSubStatus) {
    const subLabels: Record<string, string> = { in_progress: "In Progress", on_hold: "On Hold", on_route: "On Route" };
    return { label: subLabels[job.openSubStatus] || job.openSubStatus, variant: statusToVariant(job.openSubStatus) };
  }
  if (job.status === "open") {
    if (job.scheduledStart != null) return { label: "Scheduled", variant: "info" };
    const crew = job.assignedTechnicianIds;
    if (Array.isArray(crew) && crew.length > 0) return { label: "Assigned", variant: "info" };
    return { label: "Open", variant: statusToVariant(job.status) };
  }
  return { label: job.status, variant: statusToVariant(job.status) };
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
}

const OFFICE_ROLES = ["owner", "admin", "manager", "dispatcher"];
const ITEMS_PER_PAGE = 50;

// =============================================================================
// Summary Card Component
// =============================================================================

function SummaryCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="bg-white rounded-md border border-slate-200 shadow-sm px-5 py-4">
      <div className="text-xs font-medium text-slate-500 mb-1">{label}</div>
      <div className="text-2xl font-bold text-slate-900 tabular-nums">{value}</div>
      <div className="text-xs text-slate-500 mt-1">{note}</div>
    </div>
  );
}

// =============================================================================
// Sortable Header — module scope for render stability
// =============================================================================

/** List stability: defined at module scope to avoid remount on parent re-render */
function SortableHeader({ field, sortField, sortDirection, onSort, children, testId }: {
  field: SortField; sortField: SortField; sortDirection: SortDirection;
  onSort: (field: SortField) => void; children: React.ReactNode; testId: string;
}) {
  return (
    <TableHead
      className="cursor-pointer hover:bg-slate-100 select-none text-xs font-medium text-slate-600"
      onClick={() => onSort(field)}
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
}

// =============================================================================
// Main Jobs Page
// =============================================================================

export default function Jobs() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const searchString = useSearch();

  // 2026-04-08: useDispatchStream() now mounted once at App.tsx root for all office surfaces.

  // Parse URL query params for contextual navigation from dashboard links
  const urlParams = useMemo(() => new URLSearchParams(searchString), [searchString]);
  const schedulingParam = urlParams.get("scheduling");
  const subStatusParam = urlParams.get("subStatus");

  const initialLifecycle = (): LifecycleStatusFilter => {
    const v = urlParams.get("lifecycle");
    if (v && ["all", "open", "completed", "invoiced", "archived"].includes(v)) return v as LifecycleStatusFilter;
    return "all";
  };
  const initialSubStatus = (): OpenSubStatusFilter => {
    if (subStatusParam && ["any", "in_progress", "on_hold", "on_route"].includes(subStatusParam)) return subStatusParam as OpenSubStatusFilter;
    return "any";
  };

  const [lifecycleFilter, setLifecycleFilter] = useState<LifecycleStatusFilter>(initialLifecycle);
  const [openSubStatusFilter, setOpenSubStatusFilter] = useState<OpenSubStatusFilter>(initialSubStatus);
  const [dashboardFilter, setDashboardFilter] = useState<"unscheduled" | "overdue" | null>(
    schedulingParam === "unscheduled" ? "unscheduled" : subStatusParam === "overdue" ? "overdue" : null
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("schedule");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_PAGE);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [applyTemplateJob, setApplyTemplateJob] = useState<{ id: string; jobNumber: number } | null>(null);

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
    includeCounts: true,
  }), [sortField]);
  const { jobs, isLoading, counts: serverCounts } = useJobsFeed(feedParams);

  const isOfficeUser = Boolean(user?.role && OFFICE_ROLES.includes(user.role));

  // =========================================================================
  // Summary card data — canonical /api/visits endpoint with correct filters
  // =========================================================================
  // 2026-03-28 fix: Date boundaries computed inline per query to avoid stale useMemo.
  // Query keys use ["visits", ...] prefix so dispatch board invalidation
  // (queryClient.invalidateQueries({ queryKey: ["visits"] })) refreshes them.
  // excludeStatuses=cancelled filters out cancelled visits from all counts.
  // "Scheduled" card uses from=now to count only future non-terminal visits.

  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }).toISOString();
  const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 }).toISOString();
  const monthStart = startOfMonth(new Date()).toISOString();
  const monthEnd = endOfMonth(new Date()).toISOString();
  const nowIso = new Date().toISOString();

  // Visits this week — non-cancelled visits with scheduledStart in current week
  const { data: weekVisits } = useQuery<VisitFeedResponse>({
    queryKey: ["visits", "summary-week", weekStart, weekEnd],
    queryFn: () => apiRequest(`/api/visits?from=${encodeURIComponent(weekStart)}&to=${encodeURIComponent(weekEnd)}&excludeStatuses=cancelled`),
    staleTime: 60_000,
  });

  // Visits this month — non-cancelled visits with scheduledStart in current month
  const { data: monthVisits } = useQuery<VisitFeedResponse>({
    queryKey: ["visits", "summary-month", monthStart, monthEnd],
    queryFn: () => apiRequest(`/api/visits?from=${encodeURIComponent(monthStart)}&to=${encodeURIComponent(monthEnd)}&excludeStatuses=cancelled`),
    staleTime: 60_000,
  });

  // Scheduled — future non-terminal visits only (from=now, exclude cancelled+completed)
  const { data: scheduledVisits } = useQuery<VisitFeedResponse>({
    queryKey: ["visits", "summary-scheduled", nowIso],
    queryFn: () => apiRequest(`/api/visits?from=${encodeURIComponent(nowIso)}&excludeStatuses=cancelled,completed`),
    staleTime: 60_000,
  });

  // Revenue — from canonical financial endpoint
  const { data: financialData } = useQuery<FinancialSummary>({
    queryKey: ["dashboard", "financial"],
    queryFn: () => apiRequest("/api/dashboard/financial"),
    staleTime: 60_000,
  });

  const visitsThisWeek = weekVisits?.count ?? 0;
  const visitsThisMonth = monthVisits?.count ?? 0;
  const scheduledCount = scheduledVisits?.count ?? 0;
  const revenueThisMonth = financialData?.revenue.month ?? 0;
  const revenueLastMonth = financialData?.revenue.lastMonth ?? 0;

  // Revenue comparison note
  const revenueNote = revenueLastMonth > 0
    ? `${revenueThisMonth >= revenueLastMonth ? "+" : ""}${Math.round(((revenueThisMonth - revenueLastMonth) / revenueLastMonth) * 100)}% vs last month`
    : "From completed + invoiced work";

  // =========================================================================
  // Job enrichment + filtering + sorting (unchanged logic)
  // =========================================================================

  const enrichedJobs = useMemo(() => {
    const nowDate = new Date();
    return jobs.map(job => ({
      ...job,
      statusInfo: getJobStatusDisplay(job),
      _scheduled: isJobScheduled(job),
      _overdue: isJobOverdue(job, nowDate),
    }));
  }, [jobs]);

  const filteredAndSortedJobs = useMemo(() => {
    let result = enrichedJobs.slice();

    if (lifecycleFilter === "all") {
      result = result.filter(job => job.status !== "archived");
    } else {
      result = result.filter(job => job.status === lifecycleFilter);
    }

    if (openSubStatusFilter !== "any") {
      result = result.filter(job => job.status === "open" && job.openSubStatus === openSubStatusFilter);
    }

    if (dashboardFilter === "unscheduled") {
      result = result.filter(job => job.status === "open" && !isJobScheduled(job));
    } else if (dashboardFilter === "overdue") {
      result = result.filter(job => job.status === "open" && isJobOverdue(job));
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(job => {
        const companyName = job.locationDisplayName?.toLowerCase() || "";
        const locationName = job.locationName?.toLowerCase() || "";
        const address = job.locationAddress?.toLowerCase() || "";
        const city = job.locationCity?.toLowerCase() || "";
        const jobNumber = formatJobNumber(job.jobNumber).toLowerCase();
        const summary = job.summary?.toLowerCase() || "";
        return companyName.includes(query) || locationName.includes(query) ||
               address.includes(query) || city.includes(query) ||
               jobNumber.includes(query) || summary.includes(query);
      });
    }

    if (sortField !== "priority") {
      result.sort((a, b) => {
        let comparison = 0;
        switch (sortField) {
          case "location": {
            const cc = (a.locationDisplayName || "").localeCompare(b.locationDisplayName || "");
            comparison = cc !== 0 ? cc : (a.locationName || "").localeCompare(b.locationName || "");
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

  useEffect(() => { setVisibleCount(ITEMS_PER_PAGE); }, [lifecycleFilter, openSubStatusFilter, searchQuery, sortField, sortDirection]);

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
      if (e.key === "ArrowDown") { e.preventDefault(); setSelectedRowIndex(prev => Math.min(prev + 1, visibleJobs.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setSelectedRowIndex(prev => Math.max(prev - 1, 0)); }
      else if (e.key === "Enter" && selectedRowIndex >= 0 && selectedRowIndex < visibleJobs.length) { e.preventDefault(); setLocation(`/jobs/${visibleJobs[selectedRowIndex].id}`); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [visibleJobs, selectedRowIndex, setLocation]);

  useEffect(() => { setSelectedRowIndex(-1); }, [lifecycleFilter, openSubStatusFilter, searchQuery]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDirection("asc"); }
  };

  const handleRowClick = (job: JobFeedItem) => setLocation(`/jobs/${job.id}`);

  // SortableHeader moved to module scope for render stability

  // Aggregate counts
  const counts = serverCounts ?? {
    lifecycle: { open: 0, completed: 0, invoiced: 0, archived: 0 },
    openSubStatus: { in_progress: 0, on_hold: 0, on_route: 0 },
    total: 0,
    activeTotal: 0,
  };
  // 2026-04-09: Use canonical activeTotal from server instead of subtracting
  // archived manually. Server computes it as total - lifecycle.archived.
  const totalCount = counts.activeTotal;
  const statusFilterCount = lifecycleFilter !== "all" ? 1 : 0;
  const workflowFilterCount = openSubStatusFilter !== "any" ? 1 : 0;

  // =========================================================================
  // Render
  // =========================================================================

  // List stability: single return path — loading state renders inside content area only
  return (
    <div className="min-h-screen bg-[#F4F8F4]" data-testid="jobs-page">
      <div className="p-6 space-y-5">

        {/* ── 1. Header Row ── */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Jobs</h1>
            <p className="text-sm text-slate-500 mt-0.5">Job activity and performance overview with full job list.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="gap-1.5 h-9 rounded-md"
              onClick={() => setShowCreateDialog(true)}
              data-testid="button-new-job"
            >
              <Plus className="h-4 w-4" />
              New Job
            </Button>
          </div>
        </div>

        {/* ── 2. Summary Cards Row ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard
            label="Visits This Week"
            value={String(visitsThisWeek)}
            note="Current week scheduled visits"
          />
          <SummaryCard
            label="Visits This Month"
            value={String(visitsThisMonth)}
            note="Current month scheduled visits"
          />
          <SummaryCard
            label="Scheduled"
            value={String(scheduledCount)}
            note="Upcoming booked visits"
          />
          <SummaryCard
            label="Projected Revenue"
            value={formatCurrency(revenueThisMonth)}
            note={revenueNote}
          />
        </div>

        {/* ── 3. Search / Filter Row ── */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder={isHistoryMode ? "Search all job history..." : "Search jobs, clients, addresses"}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 rounded-md border-slate-200 bg-white"
              data-testid="input-search-jobs"
            />
          </div>
          {!isHistoryMode ? (
            <>
              <FiltersButton label="Status" activeCount={statusFilterCount} onClear={() => setLifecycleFilter("all")}>
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

              {(lifecycleFilter === "all" || lifecycleFilter === "open") && (
                <FiltersButton label="Workflow" activeCount={workflowFilterCount} onClear={() => setOpenSubStatusFilter("any")}>
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
          ) : (
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setIsHistoryMode(false)}>
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to recent jobs
            </Button>
          )}
        </div>

        {/* History mode header */}
        {isHistoryMode && (
          <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-200 rounded-md text-sm text-slate-600">
            <Search className="h-4 w-4" />
            <span className="font-medium">Searching all job history</span>
          </div>
        )}

        {/* History search CTA */}
        {!isHistoryMode && searchQuery.trim().length > 0 && (
          <button
            onClick={() => setIsHistoryMode(true)}
            className="w-full py-1.5 text-center text-xs text-slate-500 hover:text-slate-800 hover:bg-slate-50 border border-slate-200 rounded-md transition-colors"
          >
            Not finding a job? <span className="font-medium underline underline-offset-2">Search all job history</span>
          </button>
        )}

        {/* ── 4. Main Table ── */}
        {isLoading ? (
          <div className="bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden" data-testid="jobs-loading">
            <div className="text-center py-8">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-slate-500" />
              <span className="text-slate-600">Loading jobs...</span>
            </div>
          </div>
        ) : isHistoryMode ? (
          <div className="bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden" data-testid="table-jobs-history">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="text-xs font-medium text-slate-600">Client / Location</TableHead>
                  <TableHead className="text-xs font-medium text-slate-600">Job</TableHead>
                  <TableHead className="text-xs font-medium text-slate-600">Summary</TableHead>
                  <TableHead className="text-xs font-medium text-slate-600">Schedule</TableHead>
                  <TableHead className="text-xs font-medium text-slate-600">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {debouncedHistoryQuery.length < 2 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-12 text-slate-500">
                      <div className="flex flex-col items-center gap-2">
                        <Search className="h-8 w-8 opacity-40" />
                        <p>Type at least 2 characters to search all job history</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : isHistoryLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-slate-400 mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : historyJobs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-12 text-slate-500">
                      No jobs found matching &ldquo;{debouncedHistoryQuery}&rdquo; in full history
                    </TableCell>
                  </TableRow>
                ) : (
                  historyJobs.map((job) => (
                    <TableRow key={job.id} className={tableRowClass} onClick={() => handleRowClick(job)}>
                      <TableCell>
                        <div className="text-sm font-medium text-slate-800 truncate">{job.locationDisplayName || "Unknown Company"}</div>
                        {job.locationName && <div className="text-xs text-slate-500 truncate">{job.locationName}</div>}
                      </TableCell>
                      <TableCell>
                        <div className="font-mono text-sm text-slate-800">{formatJobNumber(job.jobNumber)}</div>
                        <div className="text-xs text-slate-500 capitalize">{job.jobType}</div>
                      </TableCell>
                      <TableCell>
                        <div className="max-w-[300px] truncate text-sm text-slate-700">{job.summary}</div>
                      </TableCell>
                      <TableCell>
                        {job.scheduledStart ? (
                          <div className="flex items-center gap-1 text-sm text-slate-700">
                            <CalendarIcon className="h-3 w-3 text-slate-400" />
                            {format(new Date(job.scheduledStart), "MMM d, yyyy")}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">Not scheduled</span>
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
          </div>
        ) : (
        <>
          <div className="bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden" data-testid="table-jobs">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <SortableHeader field="location" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} testId="header-location">Client / Location</SortableHeader>
                  <SortableHeader field="jobNumber" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} testId="header-jobnumber">Job</SortableHeader>
                  <TableHead className="text-xs font-medium text-slate-600" data-testid="header-summary">Summary</TableHead>
                  <SortableHeader field="schedule" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} testId="header-schedule">Schedule</SortableHeader>
                  <SortableHeader field="status" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} testId="header-status">Status</SortableHeader>
                  {isOfficeUser && <TableHead className="w-10"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleJobs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={isOfficeUser ? 6 : 5} className="text-center py-8 text-slate-500" data-testid="text-no-jobs">
                      {jobs.length === 0 ? (
                        <div className="flex flex-col items-center gap-2">
                          <Wrench className="h-8 w-8 opacity-50" />
                          <p>No jobs yet</p>
                          <Button variant="outline" size="sm" className="rounded-md" onClick={() => setShowCreateDialog(true)} data-testid="button-create-first-job">
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
                        rowIdx === selectedRowIndex && "ring-1 ring-inset ring-[var(--brand)] bg-slate-50"
                      )}
                      onClick={() => handleRowClick(job)}
                      data-testid={`row-job-${job.id}`}
                    >
                      {/* Client / Location — company + address only, no age text */}
                      <TableCell data-testid={`text-location-${job.id}`}>
                        <div className="text-sm font-medium text-slate-800 truncate">{job.locationDisplayName || "Unknown Company"}</div>
                        {job.locationName && (
                          <div className="text-xs text-slate-500 truncate">{job.locationName}</div>
                        )}
                      </TableCell>
                      {/* Job number + type */}
                      <TableCell data-testid={`text-jobnumber-${job.id}`}>
                        <div className="font-mono text-sm text-slate-800">{formatJobNumber(job.jobNumber)}</div>
                        <div className="text-xs text-slate-500 capitalize">{job.jobType}</div>
                      </TableCell>
                      {/* Summary */}
                      <TableCell data-testid={`text-summary-${job.id}`}>
                        <div className="max-w-[300px] truncate text-sm text-slate-700">{job.summary}</div>
                      </TableCell>
                      {/* Schedule */}
                      <TableCell data-testid={`text-schedule-${job.id}`}>
                        {job.scheduledStart ? (
                          <div className="flex items-center gap-1 text-sm text-slate-700">
                            <CalendarIcon className="h-3 w-3 text-slate-400" />
                            {format(new Date(job.scheduledStart), "MMM d, yyyy")}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">Not scheduled</span>
                        )}
                      </TableCell>
                      {/* Status — canonical status only, no SLA aging indicator */}
                      <TableCell data-testid={`badge-status-${job.id}`}>
                        {(() => {
                          const ds = getDisplayStatus(job);
                          return <StatusPill variant={ds.variant} icon={ds.icon}>{ds.label}</StatusPill>;
                        })()}
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
          </div>

          {hasMore && (
            <div ref={loaderRef} className="flex justify-center py-4" data-testid="loader-more-jobs">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          )}

          <div className="text-xs text-slate-500 mt-2" data-testid="text-job-count">
            Showing {visibleJobs.length} of {filteredAndSortedJobs.length} job{filteredAndSortedJobs.length !== 1 ? 's' : ''}
          </div>
        </>
        )}
      </div>

      <QuickAddJobDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} />

      {applyTemplateJob && (
        <ApplyTemplateModal
          open={!!applyTemplateJob}
          onOpenChange={(open) => !open && setApplyTemplateJob(null)}
          jobId={applyTemplateJob.id}
          jobNumber={applyTemplateJob.jobNumber}
        />
      )}
    </div>
  );
}
