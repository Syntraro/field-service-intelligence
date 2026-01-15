import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, formatDistanceToNow, differenceInHours } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Search, ChevronDown, ChevronUp, ArrowUpDown, Loader2, Plus, Calendar as CalendarIcon, Wrench, AlertTriangle, AlertCircle, Clock, X, CalendarDays, FileText, MoreHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
import { ActionRequiredKPIs } from "@/components/ActionRequiredKPIs";
import { ApplyTemplateModal } from "@/components/ApplyTemplateModal";
import type { Job } from "@shared/schema";

interface EnrichedJob extends Job {
  locationCompanyName: string;
  locationName: string;
  locationCity: string;
  locationAddress: string;
}

type JobStatusFilter = "all" | "draft" | "scheduled" | "in_progress" | "completed" | "requires_invoicing" | "cancelled" | "overdue" | "action_required";
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

function getJobStatusDisplay(status: string, scheduledStart: Date | null): {
  label: string;
  variant: "default" | "destructive" | "secondary" | "outline";
  priority: number;
  isOverdue?: boolean;
} {
  const now = new Date();

  // LEGACY: "completed" treated same as "requires_invoicing" for display
  if (status === "completed") {
    return { label: "Completed", variant: "secondary", priority: 5 };
  }
  if (status === "requires_invoicing") {
    return { label: "Requires Invoicing", variant: "secondary", priority: 5 };
  }
  if (status === "cancelled") {
    return { label: "Cancelled", variant: "outline", priority: 6 };
  }
  if (status === "action_required") {
    return { label: "Action Required", variant: "destructive", priority: 0 };
  }
  if (status === "in_progress") {
    return { label: "In Progress", variant: "default", priority: 1 };
  }
  if (status === "draft") {
    return { label: "Draft", variant: "outline", priority: 3 };
  }

  if (status === "scheduled" && scheduledStart) {
    const scheduled = new Date(scheduledStart);
    if (scheduled < now) {
      return { label: "Overdue", variant: "destructive", priority: 0, isOverdue: true };
    }
    return { label: "Scheduled", variant: "default", priority: 2 };
  }
  
  return { label: status, variant: "outline", priority: 3 };
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
  const [activeFilter, setActiveFilter] = useState<JobStatusFilter>("all");
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
    let result = jobs.map(job => {
      const statusInfo = getJobStatusDisplay(job.status, job.scheduledStart);
      return {
        ...job,
        statusInfo,
      };
    });

    if (activeFilter !== "all") {
      result = result.filter(job => {
        if (activeFilter === "overdue") {
          return job.statusInfo.isOverdue;
        }
        if (activeFilter === "action_required") {
          return job.status === "action_required";
        }
        return job.status === activeFilter;
      });
    }

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
  }, [jobs, activeFilter, searchQuery, sortField, sortDirection]);

  useEffect(() => {
    setVisibleCount(ITEMS_PER_PAGE);
  }, [activeFilter, searchQuery, sortField, sortDirection]);

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

  const statusCounts = useMemo(() => {
    const counts = {
      draft: 0,
      scheduled: 0,
      in_progress: 0,
      completed: 0,
      cancelled: 0,
      action_required: 0,
      overdue: 0
    };

    jobs.forEach(job => {
      const statusInfo = getJobStatusDisplay(job.status, job.scheduledStart);
      if (statusInfo.isOverdue) {
        counts.overdue++;
      } else if (job.status === "action_required") {
        counts.action_required++;
      } else if (job.status in counts) {
        counts[job.status as keyof typeof counts]++;
      }
    });

    return counts;
  }, [jobs]);

  const totalCount = jobs.length;

  const statusFilterOptions: { value: JobStatusFilter; label: string; count: number; variant: "default" | "destructive" | "secondary" | "outline" }[] = [
    { value: "action_required", label: "Action Required", count: statusCounts.action_required, variant: "destructive" },
    { value: "overdue", label: "Overdue", count: statusCounts.overdue, variant: "destructive" },
    { value: "in_progress", label: "In Progress", count: statusCounts.in_progress, variant: "default" },
    { value: "scheduled", label: "Scheduled", count: statusCounts.scheduled, variant: "default" },
    { value: "draft", label: "Draft", count: statusCounts.draft, variant: "outline" },
    { value: "completed", label: "Completed", count: statusCounts.completed, variant: "secondary" },
  ];

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
      {/* Action Required KPIs - visible to office users only */}
      <ActionRequiredKPIs />

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

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant={activeFilter === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveFilter("all")}
            className={activeFilter !== "all" ? "opacity-60" : ""}
            data-testid="button-filter-status-all"
          >
            All ({totalCount})
          </Button>
          {statusFilterOptions.map(option => {
            const isActive = activeFilter === option.value;
            const activeVariant = option.value === "overdue" ? "destructive" : "default";
            // Show SLA badge for Action Required button when there are breached jobs
            const showSLABadge = option.value === "action_required" &&
              isOfficeUser &&
              slaKpis?.current?.slaBreached24h &&
              slaKpis.current.slaBreached24h > 0;
            return (
              <Button
                key={option.value}
                variant={isActive ? activeVariant : "outline"}
                size="sm"
                onClick={() => setActiveFilter(option.value)}
                className={`${!isActive ? "opacity-60" : ""} ${showSLABadge ? "relative pr-7" : ""}`}
                data-testid={`button-filter-status-${option.value}`}
              >
                {option.label} ({option.count})
                {showSLABadge && (
                  <Badge
                    variant="destructive"
                    className="absolute -top-1.5 -right-1.5 h-5 min-w-5 px-1 text-[10px] flex items-center justify-center"
                    data-testid="badge-sla-breach"
                  >
                    {slaKpis.current.slaBreached24h}
                  </Badge>
                )}
              </Button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search jobs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="input-search-jobs"
            />
          </div>
          <Button
            onClick={() => setShowCreateDialog(true)}
            data-testid="button-create-job"
          >
            <Plus className="h-4 w-4 mr-2" />
            Create Job
          </Button>
        </div>
      </div>

      <div className="border rounded-lg" data-testid="table-jobs">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHeader field="location" testId="header-location">Location</SortableHeader>
              <SortableHeader field="jobNumber" testId="header-jobnumber">Job</SortableHeader>
              <TableHead data-testid="header-summary">Summary</TableHead>
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
                      <Badge variant={job.statusInfo.variant}>
                        {job.statusInfo.isOverdue && (
                          <AlertTriangle className="h-3 w-3 mr-1" />
                        )}
                        {job.statusInfo.label}
                      </Badge>
                      {/* SLA indicators for action_required jobs */}
                      {job.status === "action_required" && job.actionRequiredAt && (() => {
                        const agingHours = differenceInHours(new Date(), new Date(job.actionRequiredAt));
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
                      {/* Inline quick actions for action_required jobs (office users only) */}
                      {job.status === "action_required" && isOfficeUser && (
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
      </div>

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
