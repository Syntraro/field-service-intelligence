import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Search, ChevronDown, ChevronUp, ArrowUpDown, Loader2, Plus, Calendar, Wrench, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { QuickAddJobDialog } from "@/components/QuickAddJobDialog";
import type { Job } from "@shared/schema";

interface EnrichedJob extends Job {
  locationCompanyName: string;
  locationName: string;
  locationCity: string;
  locationAddress: string;
}

type JobStatusFilter = "all" | "draft" | "scheduled" | "in_progress" | "completed" | "requires_invoicing" | "cancelled" | "on_hold" | "overdue";
type SortField = "location" | "jobNumber" | "schedule" | "status";
type SortDirection = "asc" | "desc";

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
  if (status === "on_hold") {
    return { label: "On Hold", variant: "outline", priority: 4 };
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

const ITEMS_PER_PAGE = 50;

export default function Jobs() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [activeFilter, setActiveFilter] = useState<JobStatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("schedule");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_PAGE);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
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
      on_hold: 0,
      overdue: 0 
    };
    
    jobs.forEach(job => {
      const statusInfo = getJobStatusDisplay(job.status, job.scheduledStart);
      if (statusInfo.isOverdue) {
        counts.overdue++;
      } else if (job.status in counts) {
        counts[job.status as keyof typeof counts]++;
      }
    });
    
    return counts;
  }, [jobs]);

  const totalCount = jobs.length;

  const statusFilterOptions: { value: JobStatusFilter; label: string; count: number; variant: "default" | "destructive" | "secondary" | "outline" }[] = [
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
            return (
              <Button
                key={option.value}
                variant={isActive ? activeVariant : "outline"}
                size="sm"
                onClick={() => setActiveFilter(option.value)}
                className={!isActive ? "opacity-60" : ""}
                data-testid={`button-filter-status-${option.value}`}
              >
                {option.label} ({option.count})
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleJobs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground" data-testid="text-no-jobs">
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
                        <Calendar className="h-3 w-3 text-muted-foreground" />
                        {format(new Date(job.scheduledStart), "MMM d, yyyy")}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">Not scheduled</span>
                    )}
                  </TableCell>
                  <TableCell data-testid={`badge-status-${job.id}`}>
                    <Badge variant={job.statusInfo.variant}>
                      {job.statusInfo.isOverdue && (
                        <AlertTriangle className="h-3 w-3 mr-1" />
                      )}
                      {job.statusInfo.label}
                    </Badge>
                  </TableCell>
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
    </div>
  );
}
