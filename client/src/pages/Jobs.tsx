/**
 * Jobs list page — informational overview + full job list.
 *
 * 2026-03-28: Redesigned to match approved mockup direction.
 * 2026-05-03: Migrated to EntityListTable. Removed keyboard navigation,
 *   IntersectionObserver-driven infinite scroll, and the per-row
 *   "Apply Template" kebab menu. The kebab's only menu item is mirrored
 *   on the job detail page; per the canonical-list product direction,
 *   core entity lists are navigational and detail pages own row-level
 *   actions. Sorting remains at the page layer (EntityListTable does
 *   not implement sorting in V1); each sortable column header passes a
 *   small page-local `SortableHeaderCell` ReactNode through the
 *   component's `header` slot.
 */
import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useJobsFeed } from "@/hooks/useJobsFeed";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { useLocation, useSearch } from "wouter";
import {
  ChevronDown, ChevronUp, ArrowUpDown, Loader2, Plus,
  Calendar as CalendarIcon, Wrench,
  Search, ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
// 2026-05-08 chip Phase 2: lifecycle + workflow filter buttons → FilterChip.
import { FilterChip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import { getJobStatusMeta, toneToStatusPillVariant } from "@/lib/statusBadges";
import { FiltersButton, FilterSection } from "@/components/filters/FiltersButton";
// 2026-04-26: Routed through the canonical CreateNewDialog (Job / Task /
// Supplier Visit tabs). Same defaults — opens on the Job tab.
import { CreateNewDialog } from "@/components/CreateNewDialog";
// 2026-05-02 entity-number visual language: blue pill for current entity row.
import { EntityNumber } from "@/components/common/EntityNumber";
// 2026-05-03: migrated from shadcn `<Table>` to canonical EntityListTable.
import { EntityListTable, type EntityListColumn } from "@/components/lists/EntityListTable";
import { ListLoadMoreFooter } from "@/components/lists/ListLoadMoreFooter";

// 2026-05-03 Load more pattern. Underlying fetch ceiling stays at 200
// (server-side `useJobsFeed({ limit: 200 })`); this only paginates the
// rendered set. History mode caps at 50 server-side and is small enough
// not to need client pagination — its footer is omitted.
const JOBS_PAGE_SIZE = 50;
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

// 2026-05-03 status consolidation: the inline `getDisplayStatus` helper
// was migrated to `getJobStatusMeta` in `lib/statusBadges.ts`. The
// precedence chain (overdue > requires-invoicing > archived > invoiced
// > sub-status > derived > lifecycle) is preserved exactly. The new
// helper returns `StatusMeta { label, tone }`; the page maps tone →
// StatusPill variant via `toneToStatusPillVariant` for the cell render.
// `getJobStatusDisplay` (in `jobUtils.ts`) is intentionally LEFT ALONE
// — it has different precedence ("Completed" vs "Requires invoicing")
// and is consumed by detail/timeline pages.

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
}

// =============================================================================
// Summary Card Component
// =============================================================================

function SummaryCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="bg-white rounded-md border border-slate-200 shadow-sm px-5 py-4">
      <div className="text-caption font-medium text-slate-500 mb-1">{label}</div>
      <div className="text-page-title font-bold text-slate-900 tabular-nums">{value}</div>
      <div className="text-caption text-slate-500 mt-1">{note}</div>
    </div>
  );
}

// =============================================================================
// Sortable header cell — page-local replacement for the prior shadcn-Table
// `<TableHead>`-based component. EntityListTable's `header` slot accepts any
// ReactNode, so we render this as a button. The button supplies its own
// `px-4` padding and the column config sets `headerClassName: ""` to opt
// out of EntityListTable's default header padding.
// =============================================================================

function SortableHeaderCell({ field, sortField, sortDirection, onSort, children, testId }: {
  field: SortField; sortField: SortField; sortDirection: SortDirection;
  onSort: (field: SortField) => void; children: React.ReactNode; testId: string;
}) {
  // Typography (`text-label text-muted-foreground` — uppercase, 11/14,
  // weight 500, 0.04em tracking) is inherited from `listHeaderRowClass`
  // on the EntityListTable header row. Don't override font-size or
  // weight here; only layout + interaction utilities. This keeps Jobs'
  // sortable headers visually identical to the plain-string headers
  // used by the other six migrated lists.
  return (
    <button
      type="button"
      className="flex items-center gap-1 px-4 w-full text-left hover:text-foreground select-none cursor-pointer"
      onClick={() => onSort(field)}
      data-testid={testId}
    >
      {children}
      {sortField === field ? (
        sortDirection === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-30" />
      )}
    </button>
  );
}

// =============================================================================
// 2026-05-06 RALPH polish (post-blank-location-name): Jobs list column
// helper. Returns the secondary `clients.location` value to render under
// the primary client/company line ONLY when it is a real, distinct
// location name. Suppresses two cases that produce a visually duplicated
// row:
//
//   1. Empty / null `locationName` — new clients save the column as NULL
//      after the previous RALPH change; nothing to render.
//   2. `locationName` that case-insensitively matches the primary
//      `locationDisplayName` — old clients (created before the
//      blank-location-name fix) had the customer/company name auto-copied
//      into `clients.location`, so the raw column value still equals the
//      parent customer name resolved by `locationDisplayNameExpr`. This
//      catches that legacy data without a backfill migration. The user
//      explicitly accepted leaving old rows in place — this is the
//      defensive render that lets the duplicate disappear visually.
//
// The function deliberately reads from the canonical feed shape only
// (`locationName` is `clients.location` raw; `locationDisplayName` is
// the COALESCE display). It is NOT a fallback / synthesis: when both
// fields are truthy and distinct, the raw `locationName` is returned
// verbatim — same as the prior `{job.locationName && ...}` render
// produced before this hardening.
// =============================================================================

function secondaryLocationLine(job: {
  locationName?: string | null;
  locationDisplayName?: string | null;
}): string | null {
  const raw = (job.locationName ?? "").trim();
  if (!raw) return null;
  const primary = (job.locationDisplayName ?? "").trim();
  if (primary && raw.toLowerCase() === primary.toLowerCase()) return null;
  return raw;
}

// =============================================================================
// Main Jobs Page
// =============================================================================

type EnrichedJob = JobFeedItem & {
  statusInfo: ReturnType<typeof getJobStatusDisplay>;
  _scheduled: boolean;
  _overdue: boolean;
};

export default function Jobs() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();

  // 2026-04-08: useDispatchStream() now mounted once at App.tsx root for all office surfaces.

  // Parse URL query params for contextual navigation from dashboard links
  const urlParams = useMemo(() => new URLSearchParams(searchString), [searchString]);
  const schedulingParam = urlParams.get("scheduling");
  const subStatusParam = urlParams.get("subStatus");
  // 2026-04-21 Financial Dashboard deep-link: `readyToInvoiceOnly=true`
  // scopes the feed to completed jobs with no existing invoice. Server
  // filter does the work; we preserve the flag to drive UI affordance.
  const readyToInvoiceParam = urlParams.get("readyToInvoiceOnly") === "true";

  const initialLifecycle = (): LifecycleStatusFilter => {
    if (urlParams.get("readyToInvoiceOnly") === "true") return "completed";
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
  const [dashboardFilter] = useState<"unscheduled" | "overdue" | null>(
    schedulingParam === "unscheduled" ? "unscheduled" : subStatusParam === "overdue" ? "overdue" : null
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("schedule");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [visibleCount, setVisibleCount] = useState(JOBS_PAGE_SIZE);
  // Reset visible slice when filters / search / sort change. (History
  // mode uses a separate query and doesn't paginate client-side.)
  useEffect(() => {
    setVisibleCount(JOBS_PAGE_SIZE);
  }, [lifecycleFilter, openSubStatusFilter, dashboardFilter, searchQuery, sortField, sortDirection]);

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

  const feedParams = useMemo(() => ({
    limit: 200,
    offset: 0,
    ...(sortField === "priority" ? { sortBy: "priority" as const } : {}),
    includeCounts: true,
    ...(readyToInvoiceParam ? { readyToInvoiceOnly: true } : {}),
  }), [sortField, readyToInvoiceParam]);
  const { jobs, isLoading, counts: serverCounts } = useJobsFeed(feedParams);

  // =========================================================================
  // Summary card data — canonical /api/visits endpoint with correct filters
  // =========================================================================

  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }).toISOString();
  const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 }).toISOString();
  const monthStart = startOfMonth(new Date()).toISOString();
  const monthEnd = endOfMonth(new Date()).toISOString();
  const nowIso = new Date().toISOString();

  const { data: weekVisits } = useQuery<VisitFeedResponse>({
    queryKey: ["visits", "summary-week", weekStart, weekEnd],
    queryFn: () => apiRequest(`/api/visits?from=${encodeURIComponent(weekStart)}&to=${encodeURIComponent(weekEnd)}&excludeStatuses=cancelled`),
    staleTime: 60_000,
  });

  const { data: monthVisits } = useQuery<VisitFeedResponse>({
    queryKey: ["visits", "summary-month", monthStart, monthEnd],
    queryFn: () => apiRequest(`/api/visits?from=${encodeURIComponent(monthStart)}&to=${encodeURIComponent(monthEnd)}&excludeStatuses=cancelled`),
    staleTime: 60_000,
  });

  const { data: scheduledVisits } = useQuery<VisitFeedResponse>({
    queryKey: ["visits", "summary-scheduled", nowIso],
    queryFn: () => apiRequest(`/api/visits?from=${encodeURIComponent(nowIso)}&excludeStatuses=cancelled,completed`),
    staleTime: 60_000,
  });

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

  const revenueNote = revenueLastMonth > 0
    ? `${revenueThisMonth >= revenueLastMonth ? "+" : ""}${Math.round(((revenueThisMonth - revenueLastMonth) / revenueLastMonth) * 100)}% vs last month`
    : "From completed + invoiced work";

  // =========================================================================
  // Job enrichment + filtering + sorting (unchanged logic)
  // =========================================================================

  const enrichedJobs = useMemo<EnrichedJob[]>(() => {
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

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDirection("asc"); }
  };

  const handleRowClick = (job: JobFeedItem | EnrichedJob) => setLocation(`/jobs/${job.id}`);

  // Aggregate counts
  const counts = serverCounts ?? {
    lifecycle: { open: 0, completed: 0, invoiced: 0, archived: 0 },
    openSubStatus: { in_progress: 0, on_hold: 0, on_route: 0 },
    total: 0,
    activeTotal: 0,
  };
  const totalCount = counts.activeTotal;
  const statusFilterCount = lifecycleFilter !== "all" ? 1 : 0;
  const workflowFilterCount = openSubStatusFilter !== "any" ? 1 : 0;

  // =========================================================================
  // Column configs for EntityListTable
  // =========================================================================

  /**
   * Live mode columns (sortable headers). Defined inside the component
   * because four headers close over `sortField` / `sortDirection` /
   * `handleSort`. Each sortable column sets `headerClassName: ""` so its
   * SortableHeaderCell button supplies its own `px-4` padding without
   * doubling up on the kind's default header padding.
   *
   * Column kinds:
   *   - location → primary (two-line: company + sub-location)
   *   - jobNumber → badge (EntityNumber pill + jobType secondary text)
   *   - summary → text (single-line, truncates via the kind's wrapper)
   *   - schedule → date (nowrap, 100 px floor; renders icon + formatted
   *     date or "Not scheduled" placeholder)
   *   - status → status (StatusPill; the cell's flex-wrap container is a
   *     no-op for the single-pill render but leaves room for future
   *     overlay badges, matching the Quotes/Invoices pattern)
   */
  const liveJobColumns = useMemo<EntityListColumn<EnrichedJob>[]>(() => [
    {
      id: "location",
      kind: "primary",
      ratio: 1.5,
      headerClassName: "",
      header: (
        <SortableHeaderCell
          field="location"
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={handleSort}
          testId="header-location"
        >
          Client / Location
        </SortableHeaderCell>
      ),
      render: (job) => {
        const secondary = secondaryLocationLine(job);
        return (
          <div className="min-w-0" data-testid={`text-location-${job.id}`}>
            <div className="truncate">{job.locationDisplayName || "Unknown Company"}</div>
            {secondary && (
              <div className="text-caption text-slate-500 font-normal truncate">{secondary}</div>
            )}
          </div>
        );
      },
      cellClassName: "px-4 py-2.5 min-w-0",
    },
    {
      id: "jobNumber",
      kind: "badge",
      ratio: 0.7,
      minWidthPx: 88,
      headerClassName: "",
      header: (
        <SortableHeaderCell
          field="jobNumber"
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={handleSort}
          testId="header-jobnumber"
        >
          Job
        </SortableHeaderCell>
      ),
      render: (job) => (
        <div data-testid={`text-jobnumber-${job.id}`}>
          {/* 2026-05-02 entity-number system: row IS a job → primary
              blue pill. Pill chrome makes the legacy `#` prefix
              redundant. */}
          <EntityNumber variant="primary">{job.jobNumber}</EntityNumber>
          <div className="text-caption text-slate-500 capitalize mt-0.5">{job.jobType}</div>
        </div>
      ),
    },
    {
      id: "summary",
      kind: "text",
      ratio: 1.5,
      // Plain-string headers inherit `text-label text-muted-foreground`
      // (uppercase) from `listHeaderRowClass` on the EntityListTable
      // header row. Don't restate font-size / weight / color here.
      header: "Summary",
      render: (job) => <span data-testid={`text-summary-${job.id}`}>{job.summary}</span>,
    },
    {
      id: "schedule",
      kind: "date",
      headerClassName: "",
      header: (
        <SortableHeaderCell
          field="schedule"
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={handleSort}
          testId="header-schedule"
        >
          Schedule
        </SortableHeaderCell>
      ),
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
    {
      id: "status",
      kind: "status",
      headerClassName: "",
      header: (
        <SortableHeaderCell
          field="status"
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={handleSort}
          testId="header-status"
        >
          Status
        </SortableHeaderCell>
      ),
      render: (job) => {
        const meta = getJobStatusMeta(job);
        return (
          <span data-testid={`badge-status-${job.id}`}>
            <StatusPill variant={toneToStatusPillVariant(meta.tone)}>{meta.label}</StatusPill>
          </span>
        );
      },
    },
  ], [sortField, sortDirection]);

  /**
   * History mode columns — same five fields as live mode, but plain
   * (non-sortable) headers because the history feed is a separate
   * server query that doesn't honor the page-local sort state.
   */
  const historyJobColumns = useMemo<EntityListColumn<JobFeedItem>[]>(() => [
    {
      id: "location",
      kind: "primary",
      ratio: 1.5,
      header: "Client / Location",
      render: (job) => {
        const secondary = secondaryLocationLine(job);
        return (
          <div className="min-w-0">
            <div className="truncate">{job.locationDisplayName || "Unknown Company"}</div>
            {secondary && (
              <div className="text-caption text-slate-500 font-normal truncate">{secondary}</div>
            )}
          </div>
        );
      },
      cellClassName: "px-4 py-2.5 min-w-0",
    },
    {
      id: "jobNumber",
      kind: "badge",
      ratio: 0.7,
      minWidthPx: 88,
      header: "Job",
      render: (job) => (
        <div>
          <EntityNumber variant="primary">{job.jobNumber}</EntityNumber>
          <div className="text-caption text-slate-500 capitalize mt-0.5">{job.jobType}</div>
        </div>
      ),
    },
    {
      id: "summary",
      kind: "text",
      ratio: 1.5,
      header: "Summary",
      render: (job) => job.summary,
    },
    {
      id: "schedule",
      kind: "date",
      header: "Schedule",
      render: (job) =>
        job.scheduledStart ? (
          <div className="flex items-center gap-1">
            <CalendarIcon className="h-3 w-3 text-slate-400" />
            {format(new Date(job.scheduledStart), "MMM d, yyyy")}
          </div>
        ) : (
          <span className="text-slate-400">Not scheduled</span>
        ),
    },
    {
      id: "status",
      kind: "status",
      header: "Status",
      // History rows don't carry the live `_overdue` enrichment; we pass
      // false to preserve the prior behavior (history mode never showed
      // an "Overdue" pill).
      render: (job) => {
        const meta = getJobStatusMeta({ status: job.status, openSubStatus: job.openSubStatus, _overdue: false });
        return <StatusPill variant={toneToStatusPillVariant(meta.tone)}>{meta.label}</StatusPill>;
      },
    },
  ], []);

  // =========================================================================
  // Render
  // =========================================================================

  return (
    <div className="min-h-screen bg-app-bg" data-testid="jobs-page">
      <div className="p-6 space-y-5">

        {/* ── 1. Header Row ── */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-page-title font-semibold text-slate-900">Jobs</h1>
            <p className="text-row text-slate-500 mt-0.5">Job activity and performance overview with full job list.</p>
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
                      <FilterChip
                        key={val}
                        selected={lifecycleFilter === val}
                        onClick={() => setLifecycleFilter(val)}
                        data-testid={`button-filter-status-${val}`}
                      >
                        {val === "all" ? `All (${totalCount})` :
                         `${val.charAt(0).toUpperCase() + val.slice(1)} (${counts.lifecycle[val as keyof typeof counts.lifecycle]})`}
                      </FilterChip>
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
                        <FilterChip
                          key={val}
                          selected={openSubStatusFilter === val}
                          onClick={() => setOpenSubStatusFilter(val)}
                          data-testid={val === "any" ? "filter-substatus-any" : `filter-substatus-${val}`}
                        >
                          {label}
                        </FilterChip>
                      ))}
                    </div>
                  </FilterSection>
                </FiltersButton>
              )}
            </>
          ) : (
            <Button variant="ghost" size="sm" className="h-7 text-caption gap-1" onClick={() => setIsHistoryMode(false)}>
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to recent jobs
            </Button>
          )}
        </div>

        {/* History mode header */}
        {isHistoryMode && (
          <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-200 rounded-md text-row text-slate-600">
            <Search className="h-4 w-4" />
            <span className="font-medium">Searching all job history</span>
          </div>
        )}

        {/* History search CTA */}
        {!isHistoryMode && searchQuery.trim().length > 0 && (
          <button
            onClick={() => setIsHistoryMode(true)}
            className="w-full py-1.5 text-center text-caption text-slate-500 hover:text-slate-800 hover:bg-slate-50 border border-slate-200 rounded-md transition-colors"
          >
            Not finding a job? <span className="font-medium underline underline-offset-2">Search all job history</span>
          </button>
        )}

        {/* ── 4. Main Table ── */}
        {isHistoryMode ? (
          <EntityListTable<JobFeedItem>
            rows={debouncedHistoryQuery.length < 2 ? [] : historyJobs}
            rowKey={(job) => job.id}
            onRowClick={handleRowClick}
            loadingState={
              isHistoryLoading && debouncedHistoryQuery.length >= 2 ? (
                <div className="text-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-slate-400 mx-auto" />
                </div>
              ) : undefined
            }
            emptyState={
              <div className="text-center py-12 text-slate-500">
                {debouncedHistoryQuery.length < 2 ? (
                  <div className="flex flex-col items-center gap-2">
                    <Search className="h-8 w-8 opacity-40" />
                    <p>Type at least 2 characters to search all job history</p>
                  </div>
                ) : (
                  <p>No jobs found matching &ldquo;{debouncedHistoryQuery}&rdquo; in full history</p>
                )}
              </div>
            }
            columns={historyJobColumns}
          />
        ) : (
          <>
            <EntityListTable<EnrichedJob>
              rows={filteredAndSortedJobs.slice(0, visibleCount)}
              rowKey={(job) => job.id}
              onRowClick={handleRowClick}
              loadingState={
                isLoading ? (
                  <div className="text-center py-8" data-testid="jobs-loading">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-slate-500" />
                    <span className="text-slate-600">Loading jobs...</span>
                  </div>
                ) : undefined
              }
              emptyState={
                <div className="text-center py-8 text-slate-500" data-testid="text-no-jobs">
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
                </div>
              }
              columns={liveJobColumns}
            />

            <ListLoadMoreFooter
              visibleCount={Math.min(visibleCount, filteredAndSortedJobs.length)}
              totalCount={filteredAndSortedJobs.length}
              hasMore={visibleCount < filteredAndSortedJobs.length}
              onLoadMore={() => setVisibleCount((c) => c + JOBS_PAGE_SIZE)}
              label="job"
            />
          </>
        )}
      </div>

      <CreateNewDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} defaultTab="job" />
    </div>
  );
}
