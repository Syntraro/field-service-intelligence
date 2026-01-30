import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, differenceInHours } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Search, ChevronDown, ChevronUp, ArrowUpDown, Loader2, Plus, Calendar as CalendarIcon, Wrench, AlertTriangle, AlertCircle, Clock, X, CalendarDays, FileText, MoreHorizontal, User, Bug } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Card, CardContent } from "@/components/ui/card";
import type { Job, User as UserType } from "@shared/schema";
import { isJobScheduled, isJobAssigned, isBacklogEligible, isJobOverdue } from "@shared/schema";
import { getJobStatusDisplay } from "@/components/job/jobUtils";
import { getMemberDisplayName } from "@/lib/displayName";

interface EnrichedJob extends Job {
  locationCompanyName: string;
  locationName: string;
  locationCity: string;
  locationAddress: string;
}

// =============================================================================
// FILTER TYPES - Phase 2 Step 4: 4-Status Lifecycle Model
// =============================================================================
// Lifecycle statuses (stored in jobs.status): open, completed, invoiced, archived
// Derived states (computed, not stored):
//   - Scheduled: isJobScheduled(job) = scheduledStart != null
//   - Backlog: isBacklogEligible(job) = status=open && !scheduled
//   - Assigned: isJobAssigned(job) = has technician(s)
//   - All-day: isAllDay === true
// OpenSubStatus (only when status=open): in_progress, on_hold, on_route, needs_review
// =============================================================================

// Lifecycle status filter (canonical 4 values only)
type LifecycleStatusFilter = "all" | "open" | "completed" | "invoiced" | "archived";

// Derived state filters (checkboxes)
interface DerivedFilters {
  scheduled: boolean | null;    // true=scheduled, false=backlog, null=any
  assigned: boolean | null;     // true=assigned, false=unassigned, null=any
  allDay: boolean | null;       // true=all-day only, null=any
  overdue: boolean;             // true=overdue only
}

// OpenSubStatus filter (only applies when status=open)
type OpenSubStatusFilter = "any" | "in_progress" | "on_hold" | "on_route" | "needs_review";

type SortField = "location" | "jobNumber" | "schedule" | "status";
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

// SLA thresholds for Action Required jobs
const SLA_WARNING_HOURS = 24;
const SLA_ESCALATE_HOURS = 72;
const OFFICE_ROLES = ["owner", "admin", "manager", "dispatcher"];

const ITEMS_PER_PAGE = 50;

// Inline note popover component for action required jobs
function ActionRequiredNotePopover({
  jobId,
  currentNote,
  onSave,
  isPending,
}: {
  jobId: string;
  currentNote: string | null | undefined;
  onSave: (note: string) => void;
  isPending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(currentNote || "");

  // Reset note when popover opens
  useEffect(() => {
    if (open) {
      setNote(currentNote || "");
    }
  }, [open, currentNote]);

  const handleSave = () => {
    onSave(note);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-1.5 text-xs text-muted-foreground hover:text-foreground"
          onClick={(e) => e.stopPropagation()}
          data-testid={`btn-add-note-${jobId}`}
        >
          <FileText className="h-3 w-3 mr-1" />
          {currentNote ? "Edit note" : "Add note"}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-3">
          <Label htmlFor={`note-${jobId}`} className="text-sm font-medium">
            Action Required Notes
          </Label>
          <Textarea
            id={`note-${jobId}`}
            placeholder="Add notes about this action required job..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="min-h-[80px] text-sm"
            data-testid={`textarea-note-${jobId}`}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isPending}
              data-testid={`btn-save-note-${jobId}`}
            >
              {isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Save
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function Jobs() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  // Lifecycle status filter (4 canonical values)
  const [lifecycleFilter, setLifecycleFilter] = useState<LifecycleStatusFilter>("all");

  // Derived state filters
  const [derivedFilters, setDerivedFilters] = useState<DerivedFilters>({
    scheduled: null,
    assigned: null,
    allDay: null,
    overdue: false,
  });

  // OpenSubStatus filter (only when status=open)
  const [openSubStatusFilter, setOpenSubStatusFilter] = useState<OpenSubStatusFilter>("any");

  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("schedule");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_PAGE);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [applyTemplateJob, setApplyTemplateJob] = useState<{ id: string; jobNumber: number } | null>(null);
  const [dismissedSLAWarning, setDismissedSLAWarning] = useState(false);
  const [dismissedUrgentWarning, setDismissedUrgentWarning] = useState(false);
  const loaderRef = useRef<HTMLDivElement>(null);

  const { data: jobs = [], isLoading } = useQuery<{ data: EnrichedJob[]; meta: { limit: number; hasMore: boolean; nextOffset?: number } }, Error, EnrichedJob[]>({
    queryKey: ["/api/jobs", { offset: 0, limit: 200 }],
    queryFn: async () => {
      const res = await fetch("/api/jobs?offset=0&limit=200", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch jobs");
      return res.json();
    },
    select: (response) => response.data,
  });

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
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Technician lookup for the Assignment column
  const { data: technicians = [] } = useQuery<UserType[]>({
    queryKey: ["/api/team/technicians"],
  });
  const techNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of technicians) {
      map.set(t.id, getMemberDisplayName(t));
    }
    return map;
  }, [technicians]);

  // Dev-only: fetch /api/calendar/state-snapshot for reconciliation panel
  const [showDevPanel, setShowDevPanel] = useState(false);
  const { data: stateSnapshot } = useQuery<{
    jobs: { total: number; open: number; completed: number; invoiced: number; archived: number };
    scheduled: { total: number; open: number; completed: number };
    backlog: { total: number };
    violations: Record<string, { count: number; jobIds: string[] }>;
    _invariants: {
      open_equals_scheduled_plus_backlog: boolean;
      no_violations: boolean;
      total_violation_count: number;
    };
    _timestamp: string;
  }>({
    queryKey: ["/api/calendar/state-snapshot"],
    queryFn: async () => {
      const res = await fetch("/api/calendar/state-snapshot", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch state snapshot");
      return res.json();
    },
    enabled: import.meta.env.DEV && showDevPanel,
    staleTime: 10_000,
  });

  const escalateMutation = useMutation({
    mutationFn: async (jobId: string) => {
      return apiRequest(`/api/jobs/${jobId}/mark-action-required-escalated`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({ title: "Job escalated", description: "The job has been marked as escalated." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to escalate", description: error.message, variant: "destructive" });
    },
  });

  const handleEscalate = (e: React.MouseEvent, jobId: string) => {
    e.stopPropagation(); // Prevent row click navigation
    escalateMutation.mutate(jobId);
  };

  // Mutation for inline action required field updates
  const updateActionRequiredMutation = useMutation({
    mutationFn: async ({ jobId, payload }: {
      jobId: string;
      payload: { nextActionDate?: string | null; actionRequiredNotes?: string | null }
    }) => {
      return apiRequest(`/api/jobs/${jobId}/action-required`, {
        method: "PATCH",
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
      });
    },
    onSuccess: (_, { payload }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      const field = payload.nextActionDate !== undefined ? "next action date" : "notes";
      toast({ title: "Updated", description: `Action required ${field} updated.` });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update", description: error.message, variant: "destructive" });
    },
  });

  const filteredAndSortedJobs = useMemo(() => {
    const now = new Date();
    let result = jobs.map(job => {
      // Phase 2 Step 5: Use canonical getJobStatusDisplay from jobUtils
      const statusInfo = getJobStatusDisplay(job);
      // Compute ALL derived states using canonical predicates only.
      // These booleans are the single source of truth for filtering and display.
      const scheduled = isJobScheduled(job);
      const assigned = isJobAssigned(job);
      const backlog = isBacklogEligible(job);
      const overdue = isJobOverdue(job, now);
      return {
        ...job,
        statusInfo,
        _scheduled: scheduled,
        _assigned: assigned,
        _backlog: backlog,
        _overdue: overdue,
      };
    });

    // 1. Apply lifecycle status filter (canonical 4 values)
    if (lifecycleFilter !== "all") {
      result = result.filter(job => job.status === lifecycleFilter);
    }

    // 2. Apply derived filters
    // Scheduled filter (true=scheduled, false=backlog, null=any)
    if (derivedFilters.scheduled === true) {
      result = result.filter(job => job._scheduled);
    } else if (derivedFilters.scheduled === false) {
      result = result.filter(job => !job._scheduled);
    }

    // Assigned filter (true=assigned, false=unassigned, null=any)
    if (derivedFilters.assigned === true) {
      result = result.filter(job => job._assigned);
    } else if (derivedFilters.assigned === false) {
      result = result.filter(job => !job._assigned);
    }

    // All-day filter
    if (derivedFilters.allDay === true) {
      result = result.filter(job => job.isAllDay === true);
    }

    // Overdue filter: uses canonical _overdue (isJobOverdue predicate).
    // statusInfo.isOverdue is unreliable because getJobStatusDisplay short-circuits
    // on sub-status before reaching the overdue check.
    if (derivedFilters.overdue) {
      result = result.filter(job => job._overdue);
    }

    // 3. Apply openSubStatus filter (only applies when viewing open jobs)
    if (openSubStatusFilter !== "any") {
      result = result.filter(job =>
        job.status === "open" && job.openSubStatus === openSubStatusFilter
      );
    }

    // 4. Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(job => {
        const companyName = job.locationCompanyName?.toLowerCase() || "";
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

    // 5. Sort
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "location":
          const companyCompare = (a.locationCompanyName || "").localeCompare(b.locationCompanyName || "");
          if (companyCompare !== 0) {
            comparison = companyCompare;
          } else {
            comparison = (a.locationName || "").localeCompare(b.locationName || "");
          }
          break;
        case "jobNumber":
          comparison = a.jobNumber - b.jobNumber;
          break;
        case "schedule":
          if (!a.scheduledStart && !b.scheduledStart) {
            comparison = 0;
          } else if (!a.scheduledStart) {
            comparison = 1;
          } else if (!b.scheduledStart) {
            comparison = -1;
          } else {
            const dateA = new Date(a.scheduledStart);
            const dateB = new Date(b.scheduledStart);
            comparison = dateA.getTime() - dateB.getTime();
          }
          break;
        case "status":
          comparison = a.statusInfo.priority - b.statusInfo.priority;
          break;
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });

    return result;
  }, [jobs, lifecycleFilter, derivedFilters, openSubStatusFilter, searchQuery, sortField, sortDirection]);

  useEffect(() => {
    setVisibleCount(ITEMS_PER_PAGE);
  }, [lifecycleFilter, derivedFilters, openSubStatusFilter, searchQuery, sortField, sortDirection]);

  const visibleJobs = useMemo(() => {
    return filteredAndSortedJobs.slice(0, visibleCount);
  }, [filteredAndSortedJobs, visibleCount]);

  const hasMore = visibleCount < filteredAndSortedJobs.length;

  const handleObserver = useCallback((entries: IntersectionObserverEntry[]) => {
    const target = entries[0];
    if (target.isIntersecting && hasMore) {
      setVisibleCount(prev => Math.min(prev + ITEMS_PER_PAGE, filteredAndSortedJobs.length));
    }
  }, [hasMore, filteredAndSortedJobs.length]);

  useEffect(() => {
    const option = {
      root: null,
      rootMargin: "100px",
      threshold: 0.1,
    };
    const observer = new IntersectionObserver(handleObserver, option);
    if (loaderRef.current) observer.observe(loaderRef.current);
    return () => observer.disconnect();
  }, [handleObserver]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const handleRowClick = (job: EnrichedJob) => {
    setLocation(`/jobs/${job.id}`);
  };

  const SortableHeader = ({ field, children, testId }: { field: SortField; children: React.ReactNode; testId: string }) => (
    <TableHead 
      className="cursor-pointer hover:bg-muted/50 select-none"
      onClick={() => handleSort(field)}
      data-testid={testId}
    >
      <div className="flex items-center gap-1">
        {children}
        {sortField === field ? (
          sortDirection === "asc" ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
        ) : (
          <ArrowUpDown className="h-4 w-4 opacity-30" />
        )}
      </div>
    </TableHead>
  );

  // =============================================================================
  // Counts using canonical predicates
  // =============================================================================
  const counts = useMemo(() => {
    const result = {
      // Lifecycle status counts
      lifecycle: {
        open: 0,
        completed: 0,
        invoiced: 0,
        archived: 0,
      },
      // Derived state counts
      derived: {
        scheduled: 0,
        backlog: 0,
        assigned: 0,
        unassigned: 0,
        allDay: 0,
        overdue: 0,
      },
      // OpenSubStatus counts (only when status=open)
      openSubStatus: {
        in_progress: 0,
        on_hold: 0,
        on_route: 0,
        needs_review: 0,
      },
    };

    const now = new Date();

    jobs.forEach(job => {
      // Lifecycle counts
      if (job.status === "open") result.lifecycle.open++;
      else if (job.status === "completed") result.lifecycle.completed++;
      else if (job.status === "invoiced") result.lifecycle.invoiced++;
      else if (job.status === "archived") result.lifecycle.archived++;

      // Derived counts using canonical predicates
      const scheduled = isJobScheduled(job);
      const assigned = isJobAssigned(job);

      if (scheduled) result.derived.scheduled++;
      if (isBacklogEligible(job)) result.derived.backlog++;
      if (assigned) result.derived.assigned++;
      if (!assigned) result.derived.unassigned++;
      if (job.isAllDay) result.derived.allDay++;

      // Overdue: uses canonical isJobOverdue predicate
      if (isJobOverdue(job, now)) result.derived.overdue++;

      // OpenSubStatus counts (only for open jobs)
      if (job.status === "open" && job.openSubStatus) {
        const subStatus = job.openSubStatus as keyof typeof result.openSubStatus;
        if (subStatus in result.openSubStatus) {
          result.openSubStatus[subStatus]++;
        }
      }
    });

    return result;
  }, [jobs]);

  // Dev-only: client-side bucket sample for reconciliation
  const devBuckets = useMemo(() => {
    if (!import.meta.env.DEV) return null;
    const openScheduled: string[] = [];
    const openBacklog: string[] = [];
    const overdue: string[] = [];
    jobs.forEach(job => {
      if (job.status === "open" && isJobScheduled(job)) openScheduled.push(job.id);
      if (isBacklogEligible(job)) openBacklog.push(job.id);
      if (isJobOverdue(job, new Date())) overdue.push(job.id);
    });
    return {
      openScheduled: { count: openScheduled.length, sample: openScheduled.slice(0, 10) },
      openBacklog: { count: openBacklog.length, sample: openBacklog.slice(0, 10) },
      overdue: { count: overdue.length, sample: overdue.slice(0, 10) },
    };
  }, [jobs]);

  const totalCount = jobs.length;

  // Helper to toggle derived filter
  const toggleDerivedFilter = (key: keyof DerivedFilters, value: boolean | null) => {
    setDerivedFilters(prev => ({ ...prev, [key]: value }));
  };

  // Check if any filters are active
  const hasActiveFilters = lifecycleFilter !== "all" ||
    derivedFilters.scheduled !== null ||
    derivedFilters.assigned !== null ||
    derivedFilters.allDay !== null ||
    derivedFilters.overdue ||
    openSubStatusFilter !== "any";

  // Clear all filters
  const clearAllFilters = () => {
    setLifecycleFilter("all");
    setDerivedFilters({ scheduled: null, assigned: null, allDay: null, overdue: false });
    setOpenSubStatusFilter("any");
  };

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
    <div className="p-6 space-y-6" data-testid="jobs-page">
      {/* SLA Breach Warning Banners - office users only */}
      {isOfficeUser && slaKpis?.current && (
        <div className="space-y-2" data-testid="sla-warning-banners">
          {/* Urgent banner: 72h+ jobs */}
          {slaKpis.current.buckets.gte72h > 0 && !dismissedUrgentWarning && (
            <Alert variant="destructive" className="border-red-400 bg-red-50" data-testid="banner-urgent">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="flex items-center justify-between flex-1 ml-2">
                <span className="font-medium">
                  {slaKpis.current.buckets.gte72h} Action Required job{slaKpis.current.buckets.gte72h !== 1 ? 's are' : ' is'} 72h+ old and require{slaKpis.current.buckets.gte72h === 1 ? 's' : ''} immediate attention.
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 hover:bg-red-100"
                  onClick={() => setDismissedUrgentWarning(true)}
                  data-testid="dismiss-urgent-banner"
                >
                  <X className="h-4 w-4" />
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {/* Warning banner: 24h+ jobs (SLA breached) */}
          {slaKpis.current.slaBreached24h > 0 && !dismissedSLAWarning && (
            <Alert className="border-orange-400 bg-orange-50" data-testid="banner-sla-warning">
              <Clock className="h-4 w-4 text-orange-600" />
              <AlertDescription className="flex items-center justify-between flex-1 ml-2">
                <span className="font-medium text-orange-800">
                  {slaKpis.current.slaBreached24h} Action Required job{slaKpis.current.slaBreached24h !== 1 ? 's have' : ' has'} breached the 24h SLA.
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 hover:bg-orange-100"
                  onClick={() => setDismissedSLAWarning(true)}
                  data-testid="dismiss-sla-banner"
                >
                  <X className="h-4 w-4" />
                </Button>
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {/* Filter Section - Phase 2 Step 4: 4-Status Model */}
      <div className="space-y-3">
        {/* Row 1: Lifecycle Status Pills + Search */}
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-muted-foreground mr-1">Status:</span>
            <Button
              variant={lifecycleFilter === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setLifecycleFilter("all")}
              data-testid="button-filter-status-all"
            >
              All ({totalCount})
            </Button>
            <Button
              variant={lifecycleFilter === "open" ? "default" : "outline"}
              size="sm"
              onClick={() => setLifecycleFilter("open")}
              data-testid="button-filter-status-open"
            >
              Open ({counts.lifecycle.open})
            </Button>
            <Button
              variant={lifecycleFilter === "completed" ? "secondary" : "outline"}
              size="sm"
              onClick={() => setLifecycleFilter("completed")}
              data-testid="button-filter-status-completed"
            >
              Completed ({counts.lifecycle.completed})
            </Button>
            <Button
              variant={lifecycleFilter === "invoiced" ? "default" : "outline"}
              size="sm"
              onClick={() => setLifecycleFilter("invoiced")}
              data-testid="button-filter-status-invoiced"
            >
              Invoiced ({counts.lifecycle.invoiced})
            </Button>
            <Button
              variant={lifecycleFilter === "archived" ? "outline" : "outline"}
              size="sm"
              onClick={() => setLifecycleFilter("archived")}
              className={lifecycleFilter === "archived" ? "bg-muted" : ""}
              data-testid="button-filter-status-archived"
            >
              Archived ({counts.lifecycle.archived})
            </Button>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search jobs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 w-[250px]"
              data-testid="input-search-jobs"
            />
          </div>
        </div>

        {/* Row 2: Derived Filters + OpenSubStatus */}
        <div className="flex flex-wrap items-center gap-4 text-sm">
          {/* Derived State Filters */}
          <div className="flex items-center gap-3 border-r pr-4">
            <span className="text-muted-foreground">Show:</span>

            {/* Scheduled/Backlog toggle */}
            <div className="flex items-center gap-1">
              <Button
                variant={derivedFilters.scheduled === true ? "default" : "ghost"}
                size="sm"
                className="h-7 px-2"
                onClick={() => toggleDerivedFilter("scheduled", derivedFilters.scheduled === true ? null : true)}
                data-testid="filter-scheduled"
              >
                <CalendarIcon className="h-3 w-3 mr-1" />
                Scheduled ({counts.derived.scheduled})
              </Button>
              <Button
                variant={derivedFilters.scheduled === false ? "default" : "ghost"}
                size="sm"
                className="h-7 px-2"
                onClick={() => toggleDerivedFilter("scheduled", derivedFilters.scheduled === false ? null : false)}
                data-testid="filter-backlog"
              >
                Backlog ({counts.derived.backlog})
              </Button>
            </div>

            {/* Assigned/Unassigned toggle */}
            <div className="flex items-center gap-1">
              <Button
                variant={derivedFilters.assigned === true ? "default" : "ghost"}
                size="sm"
                className="h-7 px-2"
                onClick={() => toggleDerivedFilter("assigned", derivedFilters.assigned === true ? null : true)}
                data-testid="filter-assigned"
              >
                <User className="h-3 w-3 mr-1" />
                Assigned ({counts.derived.assigned})
              </Button>
              <Button
                variant={derivedFilters.assigned === false ? "default" : "ghost"}
                size="sm"
                className="h-7 px-2"
                onClick={() => toggleDerivedFilter("assigned", derivedFilters.assigned === false ? null : false)}
                data-testid="filter-unassigned"
              >
                Unassigned ({counts.derived.unassigned})
              </Button>
            </div>

            {/* All-day checkbox */}
            <div className="flex items-center gap-1.5">
              <Checkbox
                id="filter-allday"
                checked={derivedFilters.allDay === true}
                onCheckedChange={(checked) => toggleDerivedFilter("allDay", checked ? true : null)}
                data-testid="filter-allday"
              />
              <label htmlFor="filter-allday" className="text-xs cursor-pointer">
                All-day ({counts.derived.allDay})
              </label>
            </div>

            {/* Overdue filter */}
            {counts.derived.overdue > 0 && (
              <Button
                variant={derivedFilters.overdue ? "destructive" : "ghost"}
                size="sm"
                className="h-7 px-2"
                onClick={() => toggleDerivedFilter("overdue", !derivedFilters.overdue)}
                data-testid="filter-overdue"
              >
                <AlertTriangle className="h-3 w-3 mr-1" />
                Overdue ({counts.derived.overdue})
              </Button>
            )}
          </div>

          {/* OpenSubStatus Filter (only when viewing open jobs) */}
          {(lifecycleFilter === "all" || lifecycleFilter === "open") && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Workflow:</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7" data-testid="filter-substatus">
                    {openSubStatusFilter === "any" ? "Any" :
                      openSubStatusFilter === "in_progress" ? "In Progress" :
                      openSubStatusFilter === "on_hold" ? "On Hold" :
                      openSubStatusFilter === "on_route" ? "On Route" :
                      "Needs Review"}
                    <ChevronDown className="h-3 w-3 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => setOpenSubStatusFilter("any")}>
                    Any
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setOpenSubStatusFilter("in_progress")}>
                    In Progress ({counts.openSubStatus.in_progress})
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setOpenSubStatusFilter("on_route")}>
                    On Route ({counts.openSubStatus.on_route})
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setOpenSubStatusFilter("on_hold")}>
                    On Hold ({counts.openSubStatus.on_hold})
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setOpenSubStatusFilter("needs_review")}>
                    Needs Review ({counts.openSubStatus.needs_review})
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          {/* Clear filters button */}
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-muted-foreground"
              onClick={clearAllFilters}
              data-testid="clear-filters"
            >
              <X className="h-3 w-3 mr-1" />
              Clear filters
            </Button>
          )}
        </div>
      </div>

      <Card data-testid="table-jobs">
        <CardContent className="p-0">
          <Table>
          <TableHeader>
            <TableRow>
              <SortableHeader field="location" testId="header-location">Location</SortableHeader>
              <SortableHeader field="jobNumber" testId="header-jobnumber">Job</SortableHeader>
              <TableHead data-testid="header-summary">Summary</TableHead>
              <SortableHeader field="schedule" testId="header-schedule">Schedule</SortableHeader>
              <SortableHeader field="status" testId="header-status">Status</SortableHeader>
              <TableHead data-testid="header-assignment">Assignment</TableHead>
              {isOfficeUser && <TableHead className="w-10"></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleJobs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isOfficeUser ? 7 : 6} className="text-center py-8 text-muted-foreground" data-testid="text-no-jobs">
                  {jobs.length === 0 ? (
                    <div className="flex flex-col items-center gap-2">
                      <Wrench className="h-8 w-8 opacity-50" />
                      <p>No jobs yet</p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowCreateDialog(true)}
                        data-testid="button-create-first-job"
                      >
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
              visibleJobs.map((job) => (
                <TableRow 
                  key={job.id} 
                  className="cursor-pointer hover-elevate"
                  onClick={() => handleRowClick(job)}
                  data-testid={`row-job-${job.id}`}
                >
                  <TableCell className="font-medium" data-testid={`text-location-${job.id}`}>
                    <div>{job.locationCompanyName || "Unknown Company"}</div>
                    {job.locationName && (
                      <div className="text-xs text-muted-foreground">{job.locationName}</div>
                    )}
                  </TableCell>
                  <TableCell data-testid={`text-jobnumber-${job.id}`}>
                    <div className="font-mono text-sm">{formatJobNumber(job.jobNumber)}</div>
                    <div className="text-xs text-muted-foreground capitalize">{job.jobType}</div>
                  </TableCell>
                  <TableCell data-testid={`text-summary-${job.id}`}>
                    <div className="max-w-[300px] truncate">{job.summary}</div>
                  </TableCell>
                  <TableCell data-testid={`text-schedule-${job.id}`}>
                    {job.scheduledStart ? (
                      <div className="flex items-center gap-1">
                        <CalendarIcon className="h-3 w-3 text-muted-foreground" />
                        {format(new Date(job.scheduledStart), "MMM d, yyyy")}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">Not scheduled</span>
                    )}
                  </TableCell>
                  <TableCell data-testid={`badge-status-${job.id}`}>
                    <div className="flex flex-col gap-1">
                      {/* Row 1: Lifecycle badge + OpenSubStatus badge */}
                      <div className="flex items-center gap-1 flex-wrap">
                        {/* Lifecycle badge (4 canonical statuses) */}
                        <Badge
                          variant={
                            job.status === "open" ? "outline" :
                            job.status === "completed" ? "secondary" :
                            job.status === "invoiced" ? "default" :
                            "outline"
                          }
                        >
                          {job.status === "open" ? "Open" :
                           job.status === "completed" ? "Completed" :
                           job.status === "invoiced" ? "Invoiced" :
                           "Archived"}
                        </Badge>

                        {/* OpenSubStatus badge (only for open jobs with a sub-status) */}
                        {job.status === "open" && job.openSubStatus && (
                          <Badge
                            variant={job.openSubStatus === "on_hold" || job.openSubStatus === "needs_review" ? "destructive" : "default"}
                            className="text-xs"
                          >
                            {job.openSubStatus === "in_progress" ? "In Progress" :
                             job.openSubStatus === "on_route" ? "On Route" :
                             job.openSubStatus === "on_hold" ? "On Hold" :
                             "Needs Review"}
                          </Badge>
                        )}

                        {/* Overdue indicator: canonical _overdue from isJobOverdue predicate */}
                        {job._overdue && (
                          <Badge variant="destructive" className="text-xs">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            Overdue
                          </Badge>
                        )}

                        {/* All-day badge */}
                        {job.isAllDay && (
                          <Badge variant="outline" className="text-xs px-1.5 py-0 text-muted-foreground">
                            All-day
                          </Badge>
                        )}
                      </div>

                      {/* SLA indicators for on-hold/needs-review jobs */}
                      {job.status === "open" && (job.openSubStatus === "on_hold" || job.openSubStatus === "needs_review") && job.onHoldAt && (() => {
                        const holdTime = job.onHoldAt || job.actionRequiredAt;
                        const agingHours = holdTime ? differenceInHours(new Date(), new Date(holdTime)) : 0;
                        const agingDays = Math.floor(agingHours / 24);
                        const agingDisplay = agingDays >= 1 ? `${agingDays}d` : `${agingHours}h`;
                        const isOverdueSLA = agingHours >= SLA_WARNING_HOURS;
                        const needsEscalation = agingHours >= SLA_ESCALATE_HOURS && !job.actionRequiredEscalatedAt;
                        const isEscalated = !!job.actionRequiredEscalatedAt;

                        return (
                          <div className="flex items-center gap-1 flex-wrap">
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              Aging: {agingDisplay}
                            </span>
                            {isOverdueSLA && !isEscalated && (
                              <Badge variant="outline" className="text-xs px-1 py-0 text-orange-600 border-orange-300">
                                SLA
                              </Badge>
                            )}
                            {isEscalated && (
                              <Badge variant="outline" className="text-xs px-1 py-0 text-red-600 border-red-300">
                                <AlertCircle className="h-2.5 w-2.5 mr-0.5" />
                                Escalated
                              </Badge>
                            )}
                            {needsEscalation && isOfficeUser && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 px-1.5 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                                onClick={(e) => handleEscalate(e, job.id)}
                                disabled={escalateMutation.isPending}
                              >
                                Escalate
                              </Button>
                            )}
                          </div>
                        );
                      })()}
                      {/* Inline quick actions for on-hold jobs (office users only) */}
                      {job.status === "open" && (job.openSubStatus === "on_hold" || job.openSubStatus === "needs_review") && isOfficeUser && (
                        <div className="flex items-center gap-1 mt-1">
                          {/* Next Action Date Picker */}
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                                onClick={(e) => e.stopPropagation()}
                                data-testid={`btn-next-action-${job.id}`}
                              >
                                <CalendarDays className="h-3 w-3 mr-1" />
                                {job.nextActionDate
                                  ? format(new Date(job.nextActionDate), "MMM d")
                                  : "Next action"}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent
                              className="w-auto p-0"
                              align="start"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Calendar
                                mode="single"
                                selected={job.nextActionDate ? new Date(job.nextActionDate) : undefined}
                                onSelect={(date) => {
                                  updateActionRequiredMutation.mutate({
                                    jobId: job.id,
                                    payload: { nextActionDate: date ? format(date, "yyyy-MM-dd") : null },
                                  });
                                }}
                                initialFocus
                              />
                              {job.nextActionDate && (
                                <div className="p-2 border-t">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="w-full text-xs text-muted-foreground"
                                    onClick={() => {
                                      updateActionRequiredMutation.mutate({
                                        jobId: job.id,
                                        payload: { nextActionDate: null },
                                      });
                                    }}
                                  >
                                    Clear date
                                  </Button>
                                </div>
                              )}
                            </PopoverContent>
                          </Popover>
                          {/* Add/Edit Note Popover */}
                          <ActionRequiredNotePopover
                            jobId={job.id}
                            currentNote={job.actionRequiredNotes}
                            onSave={(note) => {
                              updateActionRequiredMutation.mutate({
                                jobId: job.id,
                                payload: { actionRequiredNotes: note || null },
                              });
                            }}
                            isPending={updateActionRequiredMutation.isPending}
                          />
                        </div>
                      )}
                    </div>
                  </TableCell>
                  {/* Assignment column: technician name(s) or "Unassigned" */}
                  <TableCell data-testid={`text-assignment-${job.id}`}>
                    {job._assigned ? (() => {
                      const primaryName = job.primaryTechnicianId
                        ? techNameMap.get(job.primaryTechnicianId)
                        : undefined;
                      const otherCount = (job.assignedTechnicianIds?.length ?? 0) - (job.primaryTechnicianId ? 1 : 0);
                      return (
                        <div className="flex items-center gap-1">
                          <User className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                          <span className="truncate max-w-[140px]">
                            {primaryName ?? "Assigned"}
                          </span>
                          {otherCount > 0 && (
                            <span className="text-xs text-muted-foreground flex-shrink-0">
                              +{otherCount}
                            </span>
                          )}
                        </div>
                      );
                    })() : (
                      <span className="text-muted-foreground">Unassigned</span>
                    )}
                  </TableCell>
                  {isOfficeUser && (
                    <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            data-testid={`btn-actions-${job.id}`}
                          >
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
        </CardContent>
      </Card>

      {hasMore && (
        <div 
          ref={loaderRef} 
          className="flex justify-center py-4"
          data-testid="loader-more-jobs"
        >
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      <div className="text-sm text-muted-foreground" data-testid="text-job-count">
        Showing {visibleJobs.length} of {filteredAndSortedJobs.length} job{filteredAndSortedJobs.length !== 1 ? 's' : ''}
      </div>

      {/* Dev-only: Reconciliation panel comparing client counts vs state-snapshot */}
      {import.meta.env.DEV && (
        <div className="mt-4">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground"
            onClick={() => setShowDevPanel(prev => !prev)}
            data-testid="toggle-dev-panel"
          >
            <Bug className="h-3 w-3 mr-1" />
            {showDevPanel ? "Hide" : "Show"} Reconciliation Panel
          </Button>
          {showDevPanel && (
            <Card className="mt-2 border-dashed border-yellow-400 bg-yellow-50/50">
              <CardContent className="p-4 space-y-3">
                <div className="text-xs font-mono font-bold text-yellow-800">
                  DEV: Jobs Reconciliation Panel
                </div>

                {/* Client-side counts */}
                <div className="text-xs font-mono space-y-1">
                  <div className="font-semibold">Client-Side Counts (from /api/jobs)</div>
                  <div>total: {totalCount}</div>
                  <div>open: {counts.lifecycle.open} | completed: {counts.lifecycle.completed} | invoiced: {counts.lifecycle.invoiced} | archived: {counts.lifecycle.archived}</div>
                  <div>scheduled(open): {devBuckets?.openScheduled.count ?? "?"} | backlog: {devBuckets?.openBacklog.count ?? "?"} | overdue: {devBuckets?.overdue.count ?? "?"}</div>
                </div>

                {/* Server state-snapshot counts */}
                <div className="text-xs font-mono space-y-1">
                  <div className="font-semibold">Server State-Snapshot (/api/calendar/state-snapshot)</div>
                  {stateSnapshot ? (
                    <>
                      <div>total: {stateSnapshot.jobs.total}</div>
                      <div>open: {stateSnapshot.jobs.open} | completed: {stateSnapshot.jobs.completed} | invoiced: {stateSnapshot.jobs.invoiced} | archived: {stateSnapshot.jobs.archived}</div>
                      <div>scheduled(open): {stateSnapshot.scheduled.open} | backlog: {stateSnapshot.backlog.total}</div>
                      <div>
                        invariants: open=sched+backlog:{" "}
                        <span className={stateSnapshot._invariants.open_equals_scheduled_plus_backlog ? "text-green-700" : "text-red-700 font-bold"}>
                          {stateSnapshot._invariants.open_equals_scheduled_plus_backlog ? "PASS" : "FAIL"}
                        </span>
                        {" | "}violations:{" "}
                        <span className={stateSnapshot._invariants.no_violations ? "text-green-700" : "text-red-700 font-bold"}>
                          {stateSnapshot._invariants.total_violation_count}
                        </span>
                      </div>
                      <div className="text-muted-foreground">snapshot at: {stateSnapshot._timestamp}</div>
                    </>
                  ) : (
                    <div className="text-muted-foreground italic">Loading snapshot...</div>
                  )}
                </div>

                {/* Diff */}
                {stateSnapshot && devBuckets && (
                  <div className="text-xs font-mono space-y-1 border-t pt-2">
                    <div className="font-semibold">Diff (client - server)</div>
                    {(() => {
                      const diffs = {
                        total: totalCount - stateSnapshot.jobs.total,
                        open: counts.lifecycle.open - stateSnapshot.jobs.open,
                        completed: counts.lifecycle.completed - stateSnapshot.jobs.completed,
                        invoiced: counts.lifecycle.invoiced - stateSnapshot.jobs.invoiced,
                        archived: counts.lifecycle.archived - stateSnapshot.jobs.archived,
                        openScheduled: devBuckets.openScheduled.count - stateSnapshot.scheduled.open,
                        backlog: devBuckets.openBacklog.count - stateSnapshot.backlog.total,
                      };
                      const hasDrift = Object.values(diffs).some(d => d !== 0);
                      return (
                        <>
                          <div className={hasDrift ? "text-red-700 font-bold" : "text-green-700"}>
                            {hasDrift ? "DRIFT DETECTED" : "NO DRIFT"}
                          </div>
                          {Object.entries(diffs).map(([key, val]) => (
                            <div key={key} className={val !== 0 ? "text-red-700" : ""}>
                              {key}: {val > 0 ? `+${val}` : val}
                            </div>
                          ))}
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* Sample job IDs per bucket */}
                {devBuckets && (
                  <div className="text-xs font-mono space-y-1 border-t pt-2">
                    <div className="font-semibold">Sample JobIds (up to 10 per bucket)</div>
                    <div>openScheduled: [{devBuckets.openScheduled.sample.join(", ")}]</div>
                    <div>openBacklog: [{devBuckets.openBacklog.sample.join(", ")}]</div>
                    <div>overdue: [{devBuckets.overdue.sample.join(", ")}]</div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <QuickAddJobDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
      />

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
