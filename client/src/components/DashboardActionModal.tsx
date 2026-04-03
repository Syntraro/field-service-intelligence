/**
 * DashboardActionModal — Reusable modal for triaging dashboard job action rows.
 *
 * One shared modal shell configured by `mode` prop. Supports:
 * - overdue: Jobs past due — reschedule
 * - on_hold: Jobs on hold ��� schedule (clears hold server-side)
 * - unscheduled: Jobs needing scheduling — schedule
 * - ready_to_invoice: Completed jobs — create invoice
 *
 * All write actions use existing canonical flows (applyJobSchedule, /api/invoices/from-job).
 * No parallel scheduling or invoice logic introduced.
 */

import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Calendar, ChevronRight, Loader2, X, ExternalLink, Receipt, ArrowUpRight,
} from "lucide-react";
import {
  JobScheduleFields, createDefaultScheduleValue,
  type JobScheduleValue,
} from "@/components/jobs/JobScheduleFields";
import { applyJobSchedule } from "@/lib/jobScheduling";
import { resolveDashboardNav, type DashboardAction } from "@/lib/dashboardNavigation";

// ============================================================================
// Action mode configuration
// ============================================================================

export type DashboardActionMode = "overdue" | "on_hold" | "unscheduled" | "ready_to_invoice";

interface ModeConfig {
  title: string;
  /** Query params for GET /api/jobs to fetch matching jobs */
  fetchParams: string;
  /** Label for the primary row action button */
  actionLabel: string;
  /** Dashboard nav action for "View all" footer link */
  viewAllAction: DashboardAction;
}

const MODE_CONFIG: Record<DashboardActionMode, ModeConfig> = {
  overdue: {
    title: "Jobs Past Due — Need Rescheduling",
    fetchParams: "status=open&overdue=true&limit=50",
    actionLabel: "Reschedule",
    viewAllAction: "alerts.overdueJobs",
  },
  on_hold: {
    title: "Jobs On Hold — Needs Action",
    fetchParams: "status=open&openSubStatus=on_hold&limit=50",
    actionLabel: "Open Job",
    viewAllAction: "ops.onHold",
  },
  unscheduled: {
    title: "Jobs Needing Scheduling",
    fetchParams: "status=open&unscheduledOnly=true&limit=50",
    actionLabel: "Schedule",
    viewAllAction: "jobs.unscheduled",
  },
  ready_to_invoice: {
    title: "Jobs Ready to Invoice",
    fetchParams: "status=completed&limit=50",
    actionLabel: "Create Invoice",
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
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [scheduleValue, setScheduleValue] = useState<JobScheduleValue>(createDefaultScheduleValue({ unscheduled: false }));
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Fetch jobs for this action mode
  const { data, isLoading, isError, refetch } = useQuery<{ data: JobItem[] }>({
    queryKey: ["dashboard-action", mode],
    queryFn: async () => {
      const res = await fetch(`/api/jobs?${config.fetchParams}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: open,
    staleTime: 30_000,
  });

  const jobs: JobItem[] = data?.data ?? [];

  // Reset expanded state when modal opens/closes or mode changes
  const handleOpenChange = useCallback((v: boolean) => {
    if (!v) {
      setExpandedJobId(null);
      setScheduleValue(createDefaultScheduleValue({ unscheduled: false }));
    }
    onOpenChange(v);
  }, [onOpenChange]);

  // ── Schedule/Reschedule action (overdue, on_hold, unscheduled) ──
  const handleSchedule = useCallback(async (jobId: string) => {
    setActionLoading(jobId);
    try {
      const result = await applyJobSchedule(jobId, scheduleValue, { isUpdate: true });
      if (result.success) {
        toast({ title: "Scheduled", description: `Job scheduled successfully.` });
        setExpandedJobId(null);
        setScheduleValue(createDefaultScheduleValue({ unscheduled: false }));
        // Refresh modal list + dashboard counts
        refetch();
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        queryClient.invalidateQueries({ queryKey: ["attention"] });
      } else {
        toast({ title: "Error", description: result.error || "Failed to schedule", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to schedule", variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  }, [scheduleValue, toast, refetch]);

  // ── Create invoice action (ready_to_invoice) ──
  const handleCreateInvoice = useCallback(async (jobId: string) => {
    setActionLoading(jobId);
    try {
      const result = await apiRequest<any>(`/api/invoices/from-job/${jobId}`, {
        method: "POST",
        body: JSON.stringify({ markJobCompleted: false }),
      });
      toast({ title: "Invoice Created", description: `Invoice #${result.invoiceNumber || ""} created.` });
      // Refresh modal list + dashboard counts
      refetch();
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["attention"] });
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to create invoice", variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  }, [toast, refetch]);

  // Toggle inline scheduler for a row
  const toggleExpand = useCallback((jobId: string) => {
    if (expandedJobId === jobId) {
      setExpandedJobId(null);
      setScheduleValue(createDefaultScheduleValue({ unscheduled: false }));
    } else {
      setExpandedJobId(jobId);
      setScheduleValue(createDefaultScheduleValue({ unscheduled: false }));
    }
  }, [expandedJobId]);

  const isScheduleMode = mode !== "ready_to_invoice" && mode !== "on_hold";
  const isOnHoldMode = mode === "on_hold";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col p-0">
        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-[#e5e7eb] shrink-0">
          <DialogTitle className="text-base font-semibold text-[#111827] flex items-center gap-2">
            {config.title}
            {!isLoading && (
              <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-[#f8fafc] text-[11px] font-bold text-[#4b5563] tabular-nums">
                {jobs.length}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {isLoading ? (
            <div className="p-5 space-y-3">
              {[1,2,3].map(i => <Skeleton key={i} className="h-14" />)}
            </div>
          ) : isError ? (
            <div className="p-5 text-sm text-red-600">Failed to load jobs. Please try again.</div>
          ) : jobs.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#4b5563]">No jobs in this category.</div>
          ) : (
            <div>
              {jobs.map((job, i) => {
                const isExpanded = expandedJobId === job.id;
                const isActioning = actionLoading === job.id;
                const location = job.locationDisplayName || job.locationName || "—";
                const city = job.locationCity ? `, ${job.locationCity}` : "";

                return (
                  <div key={job.id} className={`${i < jobs.length - 1 ? "border-b border-[#e5e7eb]" : ""}`}>
                    {/* Job row */}
                    <div className="flex items-center justify-between px-5 py-3 hover:bg-[#f8fafc] transition-colors">
                      <div className="min-w-0 flex-1 mr-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-[#4b5563] tabular-nums">#{job.jobNumber}</span>
                          <span className="text-sm font-medium text-[#111827] truncate">{job.summary}</span>
                        </div>
                        <div className="text-xs text-[#4b5563] mt-0.5 truncate">
                          {location}{city}
                          {job.holdReason && <span className="ml-2 text-orange-600">· Hold: {job.holdReason.replace(/_/g, " ")}</span>}
                        </div>
                        {/* On-hold context: show hold notes when present */}
                        {isOnHoldMode && job.holdNotes && (
                          <div className="text-xs text-[#4b5563] mt-1 line-clamp-2 italic">
                            {job.holdNotes}
                          </div>
                        )}
                      </div>
                      {/* Row actions */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        {isScheduleMode ? (
                          <Button
                            size="sm"
                            variant={isExpanded ? "outline" : "default"}
                            onClick={() => toggleExpand(job.id)}
                            className="shrink-0 h-8 text-xs"
                          >
                            {isExpanded ? "Cancel" : config.actionLabel}
                          </Button>
                        ) : isOnHoldMode ? (
                          /* On-hold primary action: Open Job for triage (hold reasons vary) */
                          <Button
                            size="sm"
                            onClick={() => { handleOpenChange(false); setLocation(`/jobs/${job.id}`); }}
                            className="shrink-0 h-8 text-xs"
                          >
                            Open Job <ArrowUpRight className="h-3 w-3 ml-0.5" />
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => handleCreateInvoice(job.id)}
                            disabled={isActioning}
                            className="shrink-0 h-8 text-xs"
                          >
                            {isActioning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Receipt className="h-3.5 w-3.5 mr-1" />}
                            {config.actionLabel}
                          </Button>
                        )}
                        {!isExpanded && !isOnHoldMode && (
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
                    {/* Inline compact scheduler (schedule modes only) */}
                    {isScheduleMode && isExpanded && (
                      <div className="px-5 pb-4 pt-1 bg-[#f8fafc] border-t border-[#e5e7eb]">
                        <JobScheduleFields
                          value={scheduleValue}
                          onChange={setScheduleValue}
                          hideUnscheduledToggle
                          compact
                        />
                        <div className="flex items-center gap-2 mt-3">
                          <Button
                            size="sm"
                            onClick={() => handleSchedule(job.id)}
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
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#e5e7eb] shrink-0 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-[#4b5563] hover:text-[#111827]"
            onClick={() => {
              handleOpenChange(false);
              setLocation(resolveDashboardNav(config.viewAllAction));
            }}
          >
            <ExternalLink className="h-3.5 w-3.5 mr-1" />
            View all on Jobs page
          </Button>
          <Button variant="outline" size="sm" className="text-xs" onClick={() => handleOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
