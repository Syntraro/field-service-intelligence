import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";
import { useJobVisits } from "@/hooks/useJobVisits";
import { useUnscheduleJob } from "@/hooks/useCalendarApi";
import { useRoute, useLocation, Link, useSearch } from "wouter";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Pencil,
  Trash2,
  Loader2,
  MapPin,
  User,
  Calendar,
  Clock,
  AlertTriangle,
  AlertCircle,
  Building2,
  Phone,
  Mail,
  DollarSign,
  Repeat,
  ChevronRight,
  ChevronDown,
  Package,
  History,
  Wrench,
  Send,
  Check,
  Plus,
  Lock,
  CalendarPlus,
  CalendarMinus,
  XCircle,
  FileText,
  PauseCircle,
  Play,
  Briefcase,
  Receipt,
  Pause,
  MoreVertical,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import JobEquipmentSection from "@/components/JobEquipmentSection";
import { AddVisitDialog } from "@/components/AddVisitDialog";
import JobNotesSection from "@/components/JobNotesSection";
import { PartsBillingCard } from "@/components/PartsBillingCard";
import { QuickAddJobDialog } from "@/components/QuickAddJobDialog";
import { JobHeaderCard } from "@/components/JobHeaderCard";
// JobAssignmentsCard + JobMetaCard replaced by unified top-section layout
import { ActionRequiredModal, getHoldReasonLabel } from "@/components/ActionRequiredModal";
import { JobStatusTimeline } from "@/components/job/JobStatusTimeline";
import { StatusProgressBar, getJobStatusDisplay, getPriorityDisplay, SchedulingHistory } from "@/components/job";
import { AddTimeEntryModal, EditTimeEntryModal, type TimeEntryForEdit } from "@/components/time";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Job, Client, CustomerCompany, User as UserType, RecurringJobSeries, Invoice, JobTimeSummary, TimeEntryType } from "@shared/schema";
import { useJobHeader } from "@/hooks/useJobsFeed";
import type { JobHeaderDetail } from "@/hooks/useJobsFeed";

// ============================================================================
// PERMISSION HELPERS - Role-based action availability
// ============================================================================
// Manager roles can perform all office actions
// Technicians have limited permissions (view only for most office actions)
const MANAGER_ROLES = ["owner", "admin", "manager", "dispatcher"] as const;

function canPerformOfficeActions(userRole: string | undefined): boolean {
  if (!userRole) return false;
  return (MANAGER_ROLES as readonly string[]).includes(userRole);
}

// ============================================================================
// OFFICE ACTIONS STRIP - Jobber-style attention banner
// ============================================================================
// Shows when job is in a "Needs Attention" state:
// - requires_invoicing: status='completed'
// - on_hold: status='open' AND openSubStatus='on_hold'
// - overdue: status='open' AND effectiveEnd < now
// ============================================================================

type AttentionReason = 'requires_invoicing' | 'on_hold' | 'overdue' | null;

function getAttentionReason(job: {
  status: string;
  openSubStatus?: string | null;
  scheduledStart?: Date | string | null;
  scheduledEnd?: Date | string | null;
  durationMinutes?: number | null;
}): AttentionReason {
  // Priority order: requires_invoicing > on_hold > overdue

  // 1. Completed but not invoiced
  if (job.status === 'completed') {
    return 'requires_invoicing';
  }

  // Only check further if status is 'open'
  if (job.status !== 'open') {
    return null;
  }

  // 2. On hold
  if (job.openSubStatus === 'on_hold') {
    return 'on_hold';
  }

  // 3. Overdue - matches server/storage/dashboard.ts getNeedsAttentionJobs()
  // Server SQL: CASE
  //   WHEN scheduled_end IS NOT NULL THEN scheduled_end
  //   WHEN duration_minutes IS NOT NULL THEN scheduled_start + duration_minutes
  //   ELSE scheduled_start
  // END < todayStart (midnight UTC)
  if (job.scheduledStart) {
    // Match server: compare against midnight UTC of today, not current moment
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const scheduledStart = new Date(job.scheduledStart);

    // Compute effectiveEnd matching server logic exactly
    let effectiveEnd: Date;
    if (job.scheduledEnd != null) {
      // Server: WHEN scheduled_end IS NOT NULL
      effectiveEnd = new Date(job.scheduledEnd);
    } else if (job.durationMinutes != null) {
      // Server: WHEN duration_minutes IS NOT NULL (includes 0)
      effectiveEnd = new Date(scheduledStart.getTime() + job.durationMinutes * 60 * 1000);
    } else {
      // Server: ELSE scheduled_start
      effectiveEnd = scheduledStart;
    }

    // Server: effectiveEnd < todayStart (job should have finished before today started)
    if (effectiveEnd < todayStart) {
      return 'overdue';
    }
  }

  return null;
}

// ============================================================================
// ATTENTION CONFIG - Jobber-style action buttons per attention reason
// ============================================================================
// Rules:
// A) requires_invoicing: Primary="Schedule another visit", Secondary="Mark Invoiced" (with confirm)
// B) on_hold: Primary="Schedule another visit", Secondary="Resume" (clears hold)
// C) overdue: Primary="Reschedule", Secondary="Unschedule"
//
// IMPORTANT: No path should archive jobs from on_hold or overdue.
// requires_invoicing -> invoiced (not archived) unless explicitly chosen elsewhere.
// ============================================================================
const ATTENTION_CONFIG: Record<Exclude<AttentionReason, null>, {
  label: string;
  badgeClass: string;
  icon: React.ElementType;
  primaryAction: string;
  primaryIcon: React.ElementType;
  secondaryAction: string;
  secondaryIcon: React.ElementType;
  requiresConfirm: boolean; // Whether secondary action needs confirmation dialog
}> = {
  requires_invoicing: {
    label: 'Requires Invoicing',
    badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    icon: FileText,
    primaryAction: 'Schedule another visit',
    primaryIcon: CalendarPlus,
    secondaryAction: 'Mark Invoiced',
    secondaryIcon: Check,
    requiresConfirm: true, // Lifecycle change: completed -> invoiced
  },
  on_hold: {
    label: 'On Hold',
    badgeClass: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
    icon: PauseCircle,
    primaryAction: 'Schedule another visit',
    primaryIcon: CalendarPlus,
    secondaryAction: 'Resume',
    secondaryIcon: Play,
    requiresConfirm: false, // Just clears openSubStatus, no lifecycle change
  },
  overdue: {
    label: 'Overdue',
    badgeClass: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    icon: AlertCircle,
    primaryAction: 'Reschedule',
    primaryIcon: Calendar,
    secondaryAction: 'Unschedule',
    secondaryIcon: CalendarMinus,
    requiresConfirm: false, // Unschedule is reversible, no lifecycle change
  },
};

interface OfficeActionsStripProps {
  job: {
    id: string;
    jobNumber?: number | null;
    status: string;
    openSubStatus?: string | null;
    holdReason?: string | null;
    nextActionDate?: string | null;  // For on_hold: follow-up date
    closedAt?: Date | string | null; // For requires_invoicing: when job was completed
    scheduledStart?: Date | string | null;
    scheduledEnd?: Date | string | null;
    durationMinutes?: number | null;
    version: number;
  };
  userRole?: string;
  onScheduleVisit: () => void;
  onClearHold: () => void;
  onUnschedule: () => void;
  onMarkInvoiced: () => void;
  isUnscheduling?: boolean;
  isMarkingInvoiced?: boolean;
  isClearingHold?: boolean;
}

// ============================================================================
// OFFICE ACTIONS STRIP - Jobber-grade attention banner
// ============================================================================
// Polished rules:
// - Button labels match reason exactly
// - Disabled buttons show tooltip explaining why
// - Invalid actions are hidden (not just disabled)
// - Destructive/lifecycle actions require confirmation
// ============================================================================
function OfficeActionsStrip({
  job,
  userRole,
  onScheduleVisit,
  onClearHold,
  onUnschedule,
  onMarkInvoiced,
  isUnscheduling,
  isMarkingInvoiced,
  isClearingHold,
}: OfficeActionsStripProps) {
  // Confirmation dialog state for lifecycle-changing actions
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  const reason = getAttentionReason(job);

  if (!reason) {
    return null;
  }

  const config = ATTENTION_CONFIG[reason];
  const IconComponent = config.icon;
  const PrimaryIconComponent = config.primaryIcon;
  const SecondaryIconComponent = config.secondaryIcon;

  // Permission checks
  const hasOfficePermission = canPerformOfficeActions(userRole);
  const permissionTooltip = "You don't have permission to perform this action";

  // Action validity checks based on current state
  // For overdue: can only unschedule if job is actually scheduled
  const isJobScheduled = job.scheduledStart != null;
  const canUnschedule = reason === 'overdue' && isJobScheduled;

  // Determine if secondary action should be shown
  // Hide "Unschedule" for overdue jobs that aren't scheduled (edge case)
  const showSecondaryAction = reason !== 'overdue' || canUnschedule;

  // Compute detail text based on reason (stable computation, no layout shift)
  const getDetailText = (): string | null => {
    switch (reason) {
      case 'on_hold': {
        // Show holdReason + nextActionDate if present
        const parts: string[] = [];
        if (job.holdReason) {
          // Capitalize first letter of hold reason
          const formatted = job.holdReason.replace(/_/g, ' ');
          parts.push(formatted.charAt(0).toUpperCase() + formatted.slice(1));
        }
        if (job.nextActionDate) {
          try {
            const date = new Date(job.nextActionDate + 'T00:00:00'); // Parse date-only string
            parts.push(`Follow-up: ${format(date, 'MMM d')}`);
          } catch {
            // Ignore invalid date
          }
        }
        return parts.length > 0 ? parts.join(' · ') : null;
      }
      case 'overdue': {
        // Show "Overdue since <date>" based on effectiveEnd
        // Matches server/storage/dashboard.ts logic exactly
        if (!job.scheduledStart) return null;
        const scheduledStart = new Date(job.scheduledStart);
        let effectiveEnd: Date;
        if (job.scheduledEnd != null) {
          effectiveEnd = new Date(job.scheduledEnd);
        } else if (job.durationMinutes != null) {
          effectiveEnd = new Date(scheduledStart.getTime() + job.durationMinutes * 60 * 1000);
        } else {
          effectiveEnd = scheduledStart;
        }
        return `Overdue since ${format(effectiveEnd, 'MMM d')}`;
      }
      case 'requires_invoicing': {
        // Show completion date using closedAt if available
        if (job.closedAt) {
          try {
            const date = new Date(job.closedAt);
            return `Completed ${format(date, 'MMM d')}`;
          } catch {
            return null;
          }
        }
        return null;
      }
      default:
        return null;
    }
  };

  const detailText = getDetailText();

  // Handle secondary action - show confirm dialog if needed, else execute directly
  const handleSecondaryClick = () => {
    if (!hasOfficePermission) return; // Extra safety check
    if (config.requiresConfirm) {
      setShowConfirmDialog(true);
    } else {
      executeSecondaryAction();
    }
  };

  // Execute the actual secondary action
  const executeSecondaryAction = () => {
    setShowConfirmDialog(false);
    switch (reason) {
      case 'requires_invoicing':
        // Lifecycle change: completed -> invoiced
        onMarkInvoiced();
        break;
      case 'on_hold':
        // Clear hold: sets openSubStatus to null (no lifecycle change)
        onClearHold();
        break;
      case 'overdue':
        // Unschedule: removes from calendar (no lifecycle change)
        onUnschedule();
        break;
    }
  };

  // Get confirmation dialog content based on reason
  const getConfirmDialogContent = () => {
    switch (reason) {
      case 'requires_invoicing':
        return {
          title: 'Mark Job as Invoiced',
          description: `This will change Job #${job.jobNumber || job.id} status from "Completed" to "Invoiced". The job will be locked for billing purposes.`,
          confirmText: 'Mark Invoiced',
        };
      default:
        return {
          title: 'Confirm Action',
          description: 'Are you sure you want to proceed?',
          confirmText: 'Confirm',
        };
    }
  };

  const confirmContent = getConfirmDialogContent();

  // Determine if secondary action is in progress
  const isSecondaryPending =
    (reason === 'requires_invoicing' && isMarkingInvoiced) ||
    (reason === 'on_hold' && isClearingHold) ||
    (reason === 'overdue' && isUnscheduling);

  // Determine if secondary button should be disabled
  const isSecondaryDisabled = !hasOfficePermission || isSecondaryPending;

  // Get tooltip for secondary button when disabled
  const getSecondaryTooltip = (): string | null => {
    if (!hasOfficePermission) return permissionTooltip;
    if (isSecondaryPending) return "Action in progress...";
    return null;
  };

  const secondaryTooltip = getSecondaryTooltip();

  // Render button with optional tooltip wrapper
  const renderSecondaryButton = () => {
    const button = (
      <Button
        variant="outline"
        size="sm"
        onClick={handleSecondaryClick}
        disabled={isSecondaryDisabled}
        data-testid={`button-secondary-${reason}`}
        className={!hasOfficePermission ? "cursor-not-allowed" : undefined}
      >
        {isSecondaryPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
        {!isSecondaryPending && <SecondaryIconComponent className="h-4 w-4 mr-1" />}
        {config.secondaryAction}
      </Button>
    );

    // Wrap with tooltip if disabled and has tooltip text
    if (secondaryTooltip) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>{button}</span>
            </TooltipTrigger>
            <TooltipContent>
              <p>{secondaryTooltip}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return button;
  };

  // Primary button tooltip for non-managers
  const renderPrimaryButton = () => {
    const button = (
      <Button
        variant="default"
        size="sm"
        onClick={hasOfficePermission ? onScheduleVisit : undefined}
        disabled={!hasOfficePermission}
        data-testid="button-primary-action"
        className={!hasOfficePermission ? "cursor-not-allowed" : undefined}
      >
        <PrimaryIconComponent className="h-4 w-4 mr-1" />
        {config.primaryAction}
      </Button>
    );

    if (!hasOfficePermission) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>{button}</span>
            </TooltipTrigger>
            <TooltipContent>
              <p>{permissionTooltip}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return button;
  };

  return (
    <>
      <div
        className="mb-4 rounded-lg border-2 border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 p-4"
        data-testid="office-actions-strip"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          {/* Left side: Label + Badge + Details */}
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-amber-900 dark:text-amber-100">
                Office Action Required
              </span>
              <Badge className={cn("text-xs", config.badgeClass)}>
                <IconComponent className="h-3 w-3 mr-1" />
                {config.label}
              </Badge>
              {/* Compact detail text - reason-specific context */}
              {detailText && (
                <span className="text-sm text-muted-foreground">
                  — {detailText}
                </span>
              )}
            </div>
          </div>

          {/* Right side: Action buttons */}
          <div className="flex items-center gap-2">
            {renderPrimaryButton()}
            {showSecondaryAction && renderSecondaryButton()}
          </div>
        </div>
      </div>

      {/* Confirmation Dialog for lifecycle-changing actions */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent data-testid="dialog-confirm-secondary-action">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmContent.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmContent.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={executeSecondaryAction}>
              {confirmContent.confirmText}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// Phase 4 Step A7: Use canonical JobHeaderDetail type for main job data.
// The canonical getJobHeader now correctly joins customerCompanies,
// fixing the location name mismatch between list and detail views.
interface JobDetailResponse extends JobHeaderDetail {
  technicians?: UserType[];
  recurringSeries?: RecurringJobSeries;
}

// Helper to format minutes as hours and minutes
function formatMinutes(minutes: number): string {
  if (minutes === 0) return "0m";
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs === 0) return `${mins}m`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

// Get running status display text
function getRunningStatusText(runningType: TimeEntryType | null): string {
  if (!runningType) return "";
  switch (runningType) {
    case "travel_to_job":
    case "travel_between_jobs":
      return "Technician en route";
    case "on_site":
      return "Technician on site";
    case "travel_to_supplier":
    case "supplier_run":
      return "At supplier";
    default:
      return "Timer running";
  }
}

// Time Entry type for display
interface TimeEntryDisplay {
  id: string;
  technicianId: string;
  technicianName: string | null;
  type: TimeEntryType;
  startAt: string;
  endAt: string | null;
  durationMinutes: number | null;
  billable: boolean;
  notes: string | null;
  invoiceId: string | null;
  invoicedAt: string | null;
  lockedAt: string | null;
  lockedByInvoiceId: string | null;
  lockReason: string | null;
}

// Format time entry type for display
function formatTimeEntryType(type: TimeEntryType): string {
  const typeLabels: Record<TimeEntryType, string> = {
    travel_to_job: "Travel",
    on_site: "On Site",
    travel_to_supplier: "To Supplier",
    supplier_run: "Supplier",
    travel_between_jobs: "Between Jobs",
    admin: "Admin",
    break: "Break",
    other: "Other",
  };
  return typeLabels[type] || type;
}

// Labour Card Content Component
function LabourCardContent({
  jobId,
  onEditEntry,
}: {
  jobId: string;
  onEditEntry: (entry: TimeEntryDisplay) => void;
}) {
  const [showEntries, setShowEntries] = useState(false);

  const { data: timeSummary, isLoading, error } = useQuery<JobTimeSummary>({
    queryKey: ["/api/jobs", jobId, "time-summary"],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/time-summary`, { credentials: "include" });
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error("Failed to fetch time summary");
      }
      return res.json();
    },
    enabled: !!jobId,
  });

  const { data: timeEntries = [] } = useQuery<TimeEntryDisplay[]>({
    queryKey: ["/api/jobs", jobId, "time-entries"],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/time-entries`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!jobId && showEntries,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading time...
      </div>
    );
  }

  if (error || !timeSummary) {
    return (
      <p className="text-xs text-muted-foreground">
        No labour entries yet. Track time against this job here.
      </p>
    );
  }

  if (timeSummary.totalMinutes === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No labour entries yet. Track time against this job here.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {/* Running indicator */}
      {timeSummary.isRunning && (
        <div className="flex items-center gap-2 text-xs text-green-600 bg-green-50 dark:bg-green-950 rounded px-2 py-1">
          <Clock className="h-3 w-3 animate-pulse" />
          <span className="font-medium">{getRunningStatusText(timeSummary.runningType)}</span>
        </div>
      )}

      {/* Time summary */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Travel:</span>
          <span className="font-medium">{formatMinutes(timeSummary.travelMinutes)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">On-site:</span>
          <span className="font-medium">{formatMinutes(timeSummary.onSiteMinutes)}</span>
        </div>
        {timeSummary.otherMinutes > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Other:</span>
            <span className="font-medium">{formatMinutes(timeSummary.otherMinutes)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-muted-foreground">Billable:</span>
          <span className="font-medium text-primary">{formatMinutes(timeSummary.billableMinutes)}</span>
        </div>
      </div>

      {/* Total */}
      <Separator className="my-2" />
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">Total:</span>
        <span className="font-semibold">{formatMinutes(timeSummary.totalMinutes)}</span>
      </div>

      {/* Collapsible time entries list */}
      <Collapsible open={showEntries} onOpenChange={setShowEntries}>
        <CollapsibleTrigger asChild>
          <button
            className="flex items-center gap-1 text-xs text-primary hover:underline mt-2"
            data-testid="toggle-time-entries"
          >
            {showEntries ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {showEntries ? "Hide entries" : "Show entries"}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 space-y-1" data-testid="time-entries-list">
            {timeEntries.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">Loading...</p>
            ) : (
              timeEntries.map((entry) => {
                const isLocked = !!(entry.lockedAt || entry.invoicedAt);
                return (
                  <div
                    key={entry.id}
                    className={cn(
                      "flex items-center justify-between text-xs py-1 px-2 rounded group",
                      entry.invoicedAt ? "bg-muted/50" : "bg-background"
                    )}
                    data-testid={`time-entry-${entry.id}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "px-1.5 py-0.5 rounded text-[10px] font-medium",
                        entry.type === "on_site" ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" :
                        entry.type.startsWith("travel") ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" :
                        entry.type === "break" ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" :
                        "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                      )}>
                        {formatTimeEntryType(entry.type)}
                      </span>
                      <span className="text-muted-foreground">
                        {entry.technicianName || "Unknown"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {entry.durationMinutes !== null ? formatMinutes(entry.durationMinutes) : (
                          <span className="text-green-600 flex items-center gap-1">
                            <Clock className="h-3 w-3 animate-pulse" />
                            Running
                          </span>
                        )}
                      </span>
                      {entry.billable && (
                        <span title="Billable">
                          <DollarSign className="h-3 w-3 text-primary" />
                        </span>
                      )}
                      {isLocked && (
                        <span title="Locked (invoiced)">
                          <Lock className="h-3 w-3 text-amber-500" />
                        </span>
                      )}
                      {entry.invoicedAt && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0">
                          Invoiced
                        </Badge>
                      )}
                      <button
                        onClick={() => onEditEntry(entry)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-muted rounded"
                        title={isLocked ? "Edit (locked - requires override)" : "Edit"}
                        data-testid={`edit-entry-${entry.id}`}
                      >
                        <Pencil className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

// ============================================================================
// VISIT STATUS DISPLAY — Copied from JobVisitsSection (not exported there)
// ============================================================================
const VISIT_STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  dispatched: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  en_route: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  on_site: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  in_progress: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  on_hold: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  cancelled: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
};

const VISIT_STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  dispatched: "Dispatched",
  en_route: "En Route",
  on_site: "On Site",
  in_progress: "In Progress",
  on_hold: "On Hold",
  completed: "Completed",
  cancelled: "Cancelled",
};

// ============================================================================
// VISIT DETAIL DIALOG — Inline dialog for viewing/managing a single visit
// ============================================================================
function VisitDetailDialog({
  open,
  onOpenChange,
  jobId,
  visitId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  visitId: string;
}) {
  const { toast } = useToast();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Fetch single visit data — stable key gated on real visitId
  const { data: visit, isLoading } = useQuery<import("@shared/schema").JobVisit>({
    queryKey: ["visit-detail", visitId],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/visits/${visitId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch visit");
      return res.json();
    },
    enabled: open && !!visitId && visitId.length > 0,
  });

  // Technician name resolution
  const { teamMembers } = useTechniciansDirectory();
  const getTechName = (techId: string | null) => {
    if (!techId) return "Unassigned";
    const tech = teamMembers.find((t) => String(t.id) === techId);
    return tech ? (tech.firstName && tech.lastName ? `${tech.firstName} ${tech.lastName}` : tech.email) : "Unknown";
  };

  // Status update mutation
  const updateStatusMutation = useMutation({
    mutationFn: async (status: string) => {
      return apiRequest(`/api/jobs/${jobId}/visits/${visitId}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["visits"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      toast({ title: "Visit Updated", description: "Visit status has been updated." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to update visit", variant: "destructive" });
    },
  });

  // Delete (soft delete) mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/jobs/${jobId}/visits/${visitId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["visits"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      toast({ title: "Visit Deleted", description: "Visit has been removed." });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to delete visit", variant: "destructive" });
    },
  });

  // Format visit date/time
  const formatVisitDate = (v: import("@shared/schema").JobVisit) => {
    if (!v.scheduledStart) return "No date set";
    const start = new Date(v.scheduledStart);
    if (v.isAllDay) return format(start, "MMM dd, yyyy") + " (All day)";
    const end = v.scheduledEnd ? new Date(v.scheduledEnd) : null;
    return `${format(start, "MMM dd, yyyy h:mm a")}${end ? ` – ${format(end, "h:mm a")}` : ""}`;
  };

  // Duration display
  const getDuration = (v: import("@shared/schema").JobVisit) => {
    if (v.actualDurationMinutes) return `${v.actualDurationMinutes} min (actual)`;
    if (v.estimatedDurationMinutes) return `${v.estimatedDurationMinutes} min (est.)`;
    if (v.scheduledStart && v.scheduledEnd && !v.isAllDay) {
      const mins = Math.round((new Date(v.scheduledEnd).getTime() - new Date(v.scheduledStart).getTime()) / 60000);
      return `${mins} min`;
    }
    return "—";
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-visit-detail">
          <DialogHeader>
            <DialogTitle>Visit #{visit?.visitNumber || ""}</DialogTitle>
            <DialogDescription>Visit details</DialogDescription>
          </DialogHeader>

          {isLoading || !visit ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <div className="space-y-4 py-2">
              {/* Status badge */}
              <div>
                <Badge className={cn("text-xs", VISIT_STATUS_COLORS[visit.status] || "")}>
                  {VISIT_STATUS_LABELS[visit.status] || visit.status}
                </Badge>
                {!visit.isActive && (
                  <Badge variant="outline" className="ml-2 text-xs text-muted-foreground">Inactive</Badge>
                )}
              </div>

              {/* Date/Time */}
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span>{formatVisitDate(visit)}</span>
              </div>

              {/* Technician */}
              <div className="flex items-center gap-2 text-sm">
                <User className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span>{getTechName(visit.assignedTechnicianId)}</span>
              </div>

              {/* Duration */}
              <div className="flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span>{getDuration(visit)}</span>
              </div>

              {/* Notes */}
              {visit.visitNotes && (
                <div className="text-sm text-muted-foreground bg-muted/30 rounded-md p-2">
                  {visit.visitNotes}
                </div>
              )}

              {/* Check-in/out times */}
              {visit.checkedInAt && (
                <div className="text-xs text-muted-foreground">
                  Checked in: {format(new Date(visit.checkedInAt), "MMM dd h:mm a")}
                </div>
              )}
              {visit.checkedOutAt && (
                <div className="text-xs text-muted-foreground">
                  Checked out: {format(new Date(visit.checkedOutAt), "MMM dd h:mm a")}
                </div>
              )}
            </div>
          )}

          {/* Actions bar */}
          {visit && (
            <DialogFooter className="flex justify-between sm:justify-between">
              <div className="flex gap-2">
                {/* Quick status action — mark completed for scheduled visits */}
                {visit.status === "scheduled" && (
                  <Button
                    size="sm"
                    onClick={() => updateStatusMutation.mutate("completed")}
                    disabled={updateStatusMutation.isPending}
                    data-testid="button-complete-visit"
                  >
                    {updateStatusMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4 mr-1" />
                    )}
                    Complete
                  </Button>
                )}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" data-testid="button-visit-more-actions">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => setShowDeleteConfirm(true)}
                    className="text-destructive focus:text-destructive"
                    data-testid="menuitem-delete-visit"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete Visit
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent data-testid="dialog-delete-visit-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Visit</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete Visit #{visit?.visitNumber || ""}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function JobDetailPage() {
  const [, params] = useRoute("/jobs/:id");
  const [, setLocation] = useLocation();
  const searchParams = useSearch();
  const { toast } = useToast();

  // Deep link support: ?section=visits opens visits section automatically
  // This is triggered from calendar event cards via history icon
  const sectionParam = new URLSearchParams(searchParams).get("section");
  const { user } = useAuth();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showCreateInvoiceDialog, setShowCreateInvoiceDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showActionRequiredModal, setShowActionRequiredModal] = useState(false);
  const [showScheduleVisitDialog, setShowScheduleVisitDialog] = useState(false);
  const [notesOpen, setNotesOpen] = useState(true);
  const [activityOpen, setActivityOpen] = useState(false);
  // Time entry modals
  const [showAddTimeEntry, setShowAddTimeEntry] = useState(false);
  const [showEditTimeEntry, setShowEditTimeEntry] = useState(false);
  const [editingTimeEntry, setEditingTimeEntry] = useState<TimeEntryDisplay | null>(null);
  // Visit detail dialog
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);
  // Visits collapse: show first 3 by default, toggle to show all
  const [showAllVisits, setShowAllVisits] = useState(false);
  // Reschedule conflict dialog: holds the existing visit that conflicts
  const [rescheduleConflict, setRescheduleConflict] = useState<{
    visit: import("@shared/schema").JobVisit;
    isEmptyDraft: boolean;
  } | null>(null);
  const jobId = params?.id;

  // Technicians directory for schedule visit dialog + visit tech name lookup
  const { teamMembers: allTechnicians } = useTechniciansDirectory();

  // Inline visits list for middle column
  const { visits: allVisits, isLoading: visitsLoading } = useJobVisits(jobId || "", { enabled: !!jobId });

  // Sort visits: active first, then by scheduledStart descending (newest first)
  const sortedVisits = [...allVisits].sort((a, b) => {
    // Active visits before inactive
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    // Then by scheduledStart descending
    const aStart = a.scheduledStart ? new Date(a.scheduledStart).getTime() : 0;
    const bStart = b.scheduledStart ? new Date(b.scheduledStart).getTime() : 0;
    return bStart - aStart;
  });

  // Inline visit date formatter — compact single-line
  const formatVisitDate = (visit: import("@shared/schema").JobVisit) => {
    if (!visit.scheduledStart) return "No date";
    const start = new Date(visit.scheduledStart);
    if (visit.isAllDay) return `${format(start, "MMM d")} · All day`;
    return `${format(start, "MMM d")} · ${format(start, "h:mm a")}`;
  };

  // Inline technician name resolver
  const getVisitTechName = (techId: string | null) => {
    if (!techId) return "Unassigned";
    const tech = allTechnicians.find((t) => String(t.id) === techId);
    return tech ? (tech.firstName && tech.lastName ? `${tech.firstName} ${tech.lastName}` : tech.email) : "Unknown";
  };

  // Determine if a visit is an "empty draft" — no tech, no notes, still in scheduled status
  const isEmptyDraftVisit = (v: import("@shared/schema").JobVisit) =>
    v.status === "scheduled" && !v.assignedTechnicianId && !v.visitNotes;

  // Reschedule rule: check for existing non-completed active visits before creating a new one
  const handleScheduleFollowUp = () => {
    // Phase 5 E1: renamed to disambiguate from job terminal statuses
    const VISIT_TERMINAL_STATUSES = ["completed", "cancelled"];
    const activeNonTerminal = allVisits.filter(
      (v) => v.isActive && !VISIT_TERMINAL_STATUSES.includes(v.status)
    );
    if (activeNonTerminal.length > 0) {
      // Found a conflicting visit — determine if it's an empty draft
      const conflict = activeNonTerminal[0];
      setRescheduleConflict({
        visit: conflict,
        isEmptyDraft: isEmptyDraftVisit(conflict),
      });
    } else {
      // No conflict — open dialog directly
      setShowScheduleVisitDialog(true);
    }
  };

  // Phase 4 Step C3: Use canonical useJobHeader with ['jobs', 'detail', jobId] key
  const { data: job, isLoading, error } = useJobHeader(jobId) as {
    data: JobDetailResponse | undefined;
    isLoading: boolean;
    error: Error | null;
  };

  // Phase 11: Fixed job/invoice cross-linking - use correct endpoint
  const { data: jobInvoice } = useQuery<Invoice | null>({
    // Phase 5 Step A7: canonical family key prefix
    queryKey: ["invoices", "by-job", jobId],
    queryFn: async () => {
      const res = await fetch(`/api/invoices/by-job/${jobId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!jobId,
  });

  // Status update mutation - uses POST to match Time Tracking V1 backend
  // FIXED: Include version for optimistic locking (required by server schema)
  const updateStatusMutation = useMutation({
    mutationFn: async ({ status, version }: { status: string; version: number }) => {
      return apiRequest(`/api/jobs/${jobId}/status`, {
        method: "POST",
        body: JSON.stringify({ status, version, source: "web" })
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      // (covered by family-wide ["jobs"] invalidation)
      // Also invalidate time summary so Labour card updates immediately
      queryClient.invalidateQueries({ queryKey: ["jobs", jobId, "time-summary"] });
      // Refresh calendar and dashboard to reflect status change
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/range"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      // Phase 5 Step B3: canonical dashboard family key
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast({
        title: "Status Updated",
        description: "Job status has been updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update status",
        variant: "destructive",
      });
    },
  });

  // Clear hold mutation - sets openSubStatus back to null (resumes normal workflow)
  // FIXED: Include version for optimistic locking (required by server schema)
  const clearHoldMutation = useMutation({
    mutationFn: async (version: number) => {
      return apiRequest(`/api/jobs/${jobId}/status`, {
        method: "POST",
        body: JSON.stringify({ status: "open", openSubStatus: null, version, source: "web" })
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      // Phase 5.1: clearing hold changes dashboard on_hold / needs-attention counts
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast({
        title: "Hold Cleared",
        description: "Job is no longer on hold.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to clear hold",
        variant: "destructive",
      });
    },
  });

  // Unschedule mutation - uses canonical calendar hook from useCalendarApi
  // The hook handles all standard invalidations: /api/calendar, /api/calendar/range,
  // /api/calendar/unscheduled, and /api/jobs (prefix matches job-specific queries)
  const unscheduleMutation = useUnscheduleJob();

  const deleteJobMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/jobs/${jobId}`, {
        method: "DELETE"
      });
    },
    onSuccess: () => {
      // Invalidate ALL related queries so deleted job disappears from all views
      // (covered by family-wide ["jobs"] invalidation)
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance"] });
      // Phase 5 Step B3: canonical dashboard family key
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      // Prefix-matches ["/api/clients", id, "overview"] so Client Detail page updates
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({
        title: "Job Deleted",
        description: "Job has been deleted.",
      });
      setLocation("/jobs");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete job",
        variant: "destructive",
      });
    },
  });

  const createInvoiceMutation = useMutation({
    mutationFn: async (markJobCompleted: boolean = false) => {
      const response = await apiRequest(`/api/invoices/from-job/${jobId}`, {
        method: "POST",
        body: JSON.stringify({
          includeLineItems: true,
          includeNotes: true,
          markJobCompleted,
        })
      });
      return response;
    },
    onSuccess: (data: any) => {
      // Phase 5 Step A7: canonical family key invalidation
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      toast({
        title: "Invoice Created",
        description: "Invoice has been created from this job.",
      });
      setShowCreateInvoiceDialog(false);
      setLocation(`/invoices/${data.id}`);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create invoice",
        variant: "destructive",
      });
    },
  });

  const handleStatusChange = (newStatus: string) => {
    if (!job) return;
    updateStatusMutation.mutate({ status: newStatus, version: job.version });
  };

  const handleDelete = () => {
    deleteJobMutation.mutate();
    setShowDeleteConfirm(false);
  };

  // Inline status change handler for the top-section status dropdown
  // Replicates JobMetaCard logic: intercepts "on_hold" to open modal
  const handleMetaStatusChange = (newValue: string) => {
    if (!job) return;
    if (newValue.startsWith("open:")) {
      const subStatus = newValue.split(":")[1];
      if (subStatus === "on_hold") {
        setShowActionRequiredModal(true);
      } else {
        // Sub-status changes need openSubStatus field, so use direct apiRequest
        // instead of updateStatusMutation (which only sends {status, version})
        apiRequest(`/api/jobs/${jobId}/status`, {
          method: "POST",
          body: JSON.stringify({ status: "open", openSubStatus: subStatus, version: job.version, source: "web" }),
        }).then(() => {
          queryClient.invalidateQueries({ queryKey: ["jobs"] });
          // (covered by family-wide ["jobs"] invalidation)
          toast({ title: "Status Updated", description: "Job status has been updated." });
        }).catch((error: Error) => {
          toast({ title: "Error", description: error.message || "Failed to update status", variant: "destructive" });
        });
      }
    } else {
      updateStatusMutation.mutate({ status: newValue, version: job.version });
    }
  };

  const handleCreateInvoice = (closeJob: boolean = false) => {
    createInvoiceMutation.mutate(closeJob);
  };


  if (isLoading) {
    return (
      <div className="p-6" data-testid="job-detail-loading">
        <div className="text-center py-8">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
          Loading job details...
        </div>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="p-6" data-testid="job-detail-error">
        <div className="text-center py-8">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-destructive" />
          <p className="text-destructive">Job not found</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => setLocation("/jobs")}
            data-testid="button-back-to-jobs"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Jobs
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4" data-testid="job-detail-page">
      {/* OFFICE ACTIONS STRIP - Shows when job needs attention */}
      {/* Jobber-style workflow: actions depend on attention reason */}
      {/* A) requires_invoicing: Schedule visit / Mark Invoiced (with confirm) */}
      {/* B) on_hold: Schedule visit / Resume (clears hold) */}
      {/* C) overdue: Reschedule / Unschedule */}
      {/* IMPORTANT: No path archives jobs - invoiced is the only lifecycle target */}
      <OfficeActionsStrip
        job={job}
        userRole={user?.role}
        onScheduleVisit={() => handleScheduleFollowUp()}
        onClearHold={() => clearHoldMutation.mutate(job.version)}
        onUnschedule={() => {
          // Use canonical hook with custom toast callbacks
          // Hook handles standard invalidations: /api/calendar/*, /api/jobs
          unscheduleMutation.mutate(
            { jobId: job.id, version: job.version },
            {
              onSuccess: () => {
                toast({
                  title: "Job Unscheduled",
                  description: "Job has been returned to the backlog.",
                });
              },
              onError: (error: Error) => {
                toast({
                  title: "Error",
                  description: error.message || "Failed to unschedule job",
                  variant: "destructive",
                });
              },
            }
          );
        }}
        onMarkInvoiced={() => updateStatusMutation.mutate({ status: 'invoiced', version: job.version })}
        isUnscheduling={unscheduleMutation.isPending}
        isMarkingInvoiced={updateStatusMutation.isPending}
        isClearingHold={clearHoldMutation.isPending}
      />

      {/* ================================================================
          TOP SECTION — Unified Meta Card (3-column grid)
          Left: Job Identity | Middle: Visits | Right: Status Stack
          ================================================================ */}
      <div className="rounded-lg border bg-card shadow-sm overflow-hidden mb-4" data-testid="card-top-meta">
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1.5fr_1fr]">
          {/* LEFT COLUMN — Job Identity */}
          <div className="[&_.shadcn-card]:border-0 [&_.shadcn-card]:shadow-none [&_.shadcn-card]:rounded-none">
            <JobHeaderCard
              job={job}
              jobInvoice={jobInvoice ?? null}
              onEdit={() => setShowEditDialog(true)}
              onDelete={() => deleteJobMutation.mutate()}
            />
            {/* Description inline (standalone card removed) */}
            {job.description && job.description.trim() !== "" && (
              <div className="px-4 pb-4 -mt-2">
                <p className="text-sm text-muted-foreground whitespace-pre-wrap" data-testid="text-job-description">
                  {job.description}
                </p>
              </div>
            )}
          </div>

          {/* MIDDLE COLUMN — Compact inline visits list */}
          <div id="visits-section" className="lg:border-l flex flex-col" style={{ maxHeight: 'calc(100vh - 16rem)' }}>
            {/* Header: visit count + schedule follow-up */}
            <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
              <span className="text-sm font-semibold">
                Visits {allVisits.length > 0 && `(${allVisits.length})`}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-auto py-1 px-2 text-primary"
                onClick={() => handleScheduleFollowUp()}
                data-testid="button-schedule-followup"
              >
                <CalendarPlus className="h-3 w-3 mr-1" />
                Schedule follow-up
              </Button>
            </div>

            {/* Visit rows — collapsed to 3 by default, scrollable when expanded */}
            <div className={cn(
              "px-2 py-1",
              showAllVisits && allVisits.length > 3 ? "overflow-y-auto flex-1" : ""
            )}>
              {visitsLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : allVisits.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground">
                  <Calendar className="h-5 w-5 mx-auto mb-1 opacity-50" />
                  <p className="text-xs">No visits scheduled</p>
                </div>
              ) : (
                <>
                  {(showAllVisits ? sortedVisits : sortedVisits.slice(0, 3)).map((visit) => (
                    <button
                      key={visit.id}
                      onClick={() => setSelectedVisitId(visit.id)}
                      className={cn(
                        "w-full text-left px-2 py-1.5 rounded hover:bg-accent/50 transition-colors flex items-center gap-2",
                        !visit.isActive && "opacity-50"
                      )}
                      data-testid={`visit-row-${visit.id}`}
                    >
                      {/* Date/time */}
                      <span className="text-[11px] font-medium truncate min-w-0 flex-1">
                        {formatVisitDate(visit)}
                      </span>
                      {/* Tech name — truncated */}
                      <span className="text-[11px] text-muted-foreground truncate max-w-[80px] shrink-0">
                        {getVisitTechName(visit.assignedTechnicianId)}
                      </span>
                      {/* Status pill */}
                      <Badge className={cn("text-[9px] px-1.5 py-0 shrink-0 leading-tight", VISIT_STATUS_COLORS[visit.status] || "")}>
                        {VISIT_STATUS_LABELS[visit.status] || visit.status}
                      </Badge>
                    </button>
                  ))}
                  {/* Collapse toggle when more than 3 visits */}
                  {sortedVisits.length > 3 && (
                    <button
                      onClick={() => setShowAllVisits(!showAllVisits)}
                      className="w-full text-center text-[11px] text-primary hover:underline py-1.5"
                      data-testid="toggle-show-all-visits"
                    >
                      {showAllVisits
                        ? "Show less"
                        : `Show all visits (${sortedVisits.length})`}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN — Status Stack */}
          <div className="lg:border-l p-4 text-xs space-y-3">
            {/* Job number */}
            <div className="flex items-center justify-between gap-4">
              <span className="font-medium text-muted-foreground flex items-center gap-1">
                <Briefcase className="h-3 w-3" />
                Job
              </span>
              <span className="font-semibold text-foreground" data-testid="text-job-number">
                #{job.jobNumber}
              </span>
            </div>

            {/* Invoice */}
            <div className="flex items-center justify-between gap-4">
              <span className="font-medium text-muted-foreground flex items-center gap-1">
                <Receipt className="h-3 w-3" />
                Invoice
              </span>
              {jobInvoice ? (
                <Link
                  href={`/invoices/${jobInvoice.id}`}
                  className="font-semibold text-primary hover:underline"
                  data-testid="link-invoice"
                >
                  #{jobInvoice.invoiceNumber || `INV-${jobInvoice.id.slice(0, 6).toUpperCase()}`}
                </Link>
              ) : (
                <span className="text-[11px] text-muted-foreground" data-testid="text-no-invoice">
                  Not invoiced
                </span>
              )}
            </div>

            {/* Status dropdown */}
            <div className="flex items-center justify-between gap-4">
              <span className="font-medium text-muted-foreground">Status</span>
              <Select
                value={job.openSubStatus ? `open:${job.openSubStatus}` : job.status}
                onValueChange={handleMetaStatusChange}
                disabled={updateStatusMutation.isPending}
              >
                <SelectTrigger className="h-6 w-auto min-w-[100px] text-[11px]" data-testid="select-status">
                  <SelectValue placeholder="Change" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open (Backlog)</SelectItem>
                  <SelectItem value="open:in_progress">In Progress</SelectItem>
                  <SelectItem value="open:on_route">On Route</SelectItem>
                  <SelectItem value="open:on_hold">On Hold</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="invoiced">Invoiced</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Created on — static, read-only */}
            <div className="flex items-center justify-between gap-4">
              <span className="font-medium text-muted-foreground">Created</span>
              <span className="text-[11px]" data-testid="text-created-date">
                {job.createdAt ? format(new Date(job.createdAt), "MMM d, yyyy") : "—"}
              </span>
            </div>

            {/* Completed on — static, read-only (closedAt is set when job is closed/completed) */}
            <div className="flex items-center justify-between gap-4">
              <span className="font-medium text-muted-foreground">Completed</span>
              <span className="text-[11px]" data-testid="text-completed-date">
                {job.closedAt ? format(new Date(job.closedAt), "MMM d, yyyy") : "—"}
              </span>
            </div>

            {/* On Hold info (mirrors JobMetaCard on-hold section) */}
            {job.status === "open" && (job.openSubStatus === "on_hold" || job.openSubStatus === "needs_review") && (
              <div className="pt-2 border-t mt-2 space-y-1.5">
                <div className="flex items-center gap-1 text-[11px] text-destructive font-medium">
                  {job.openSubStatus === "on_hold" ? (
                    <>
                      <Pause className="h-3 w-3" />
                      <span>On Hold</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-3 w-3" />
                      <span>Needs Review</span>
                    </>
                  )}
                </div>
                {job.holdReason && (
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-muted-foreground text-[11px]">Reason:</span>
                    <span className="text-[11px] text-right" data-testid="text-hold-reason">
                      {getHoldReasonLabel(job.holdReason)}
                    </span>
                  </div>
                )}
                {job.holdNotes && (
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-muted-foreground text-[11px]">Notes:</span>
                    <span className="text-[11px] text-right max-w-[120px] truncate" title={job.holdNotes} data-testid="text-hold-notes">
                      {job.holdNotes}
                    </span>
                  </div>
                )}
                {job.nextActionDate && (
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-muted-foreground text-[11px]">Next action:</span>
                    <span className="text-[11px]" data-testid="text-next-action-date">
                      {format(new Date(job.nextActionDate), "MMM d, yyyy")}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ================================================================
          MAIN 2-COLUMN LAYOUT — Parts (left) + Sidebar Stack (right)
          ================================================================ */}
      <div className="grid gap-3 lg:grid-cols-[3fr_1fr]">
        {/* LEFT: Parts & Billing + Expenses */}
        <div className="space-y-3">
          <PartsBillingCard jobId={jobId!} />

          <Card data-testid="card-expenses">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
              <CardTitle className="text-sm font-semibold">Expenses</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-auto p-0 text-primary"
                onClick={() => toast({ title: "Coming Soon", description: "Expense tracking coming soon." })}
                data-testid="button-new-expense"
              >
                New Expense
              </Button>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Track additional job costs (parking, materials, etc.) here.
              </p>
            </CardContent>
          </Card>

          {job.recurringSeries && (
            <Card data-testid="card-recurring">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Repeat className="h-4 w-4" />
                  Recurring Series
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm" data-testid="text-series-summary">{job.recurringSeries.baseSummary}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* RIGHT: Sidebar Stack (each card independent, scrollable column) */}
        <div className="space-y-2">
          {/* Labour */}
          <Card data-testid="card-labour">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
              <CardTitle className="text-sm font-semibold">Labour</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-auto p-0 text-primary"
                onClick={() => setShowAddTimeEntry(true)}
                data-testid="button-new-time-entry"
              >
                <Plus className="h-3 w-3 mr-1" />
                New Time Entry
              </Button>
            </CardHeader>
            <CardContent>
              <LabourCardContent
                jobId={jobId!}
                onEditEntry={(entry) => {
                  setEditingTimeEntry(entry);
                  setShowEditTimeEntry(true);
                }}
              />
            </CardContent>
          </Card>

          {/* Notes */}
          <JobNotesSection jobId={job.id} defaultOpen={notesOpen} />

          {/* Equipment */}
          <JobEquipmentSection jobId={job.id} locationId={job.locationId} />

          {/* Status Timeline */}
          <JobStatusTimeline jobId={job.id} defaultOpen={false} />

          {/* Scheduling History */}
          <SchedulingHistory jobId={job.id} defaultOpen={false} />

          {/* Activity */}
          <Collapsible open={activityOpen} onOpenChange={setActivityOpen}>
            <Card>
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center justify-between px-4 py-3 hover-elevate" data-testid="trigger-activity">
                  <span className="text-sm font-semibold">Activity</span>
                  {activityOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border-t px-4 pb-4 pt-3">
                  <ul className="space-y-2 text-xs">
                    <li className="flex items-start gap-2">
                      <span className="mt-1 h-2 w-2 rounded-full bg-primary shrink-0" />
                      <div>
                        <div className="font-medium">Job created</div>
                        <div className="text-muted-foreground">
                          {job.createdAt ? format(new Date(job.createdAt), "MMMM do, yyyy") : "N/A"}
                        </div>
                      </div>
                    </li>
                    {job.scheduledStart && (
                      <li className="flex items-start gap-2">
                        <span className="mt-1 h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                        <div>
                          <div className="font-medium">Scheduled</div>
                          <div className="text-muted-foreground">{format(new Date(job.scheduledStart), "MMMM do, yyyy")}</div>
                        </div>
                      </li>
                    )}
                    {job.actualStart && (
                      <li className="flex items-start gap-2">
                        <span className="mt-1 h-2 w-2 rounded-full bg-green-500 shrink-0" />
                        <div>
                          <div className="font-medium">Work started</div>
                          <div className="text-muted-foreground">{format(new Date(job.actualStart), "MMMM do, yyyy")}</div>
                        </div>
                      </li>
                    )}
                    {job.actualEnd && (
                      <li className="flex items-start gap-2">
                        <span className="mt-1 h-2 w-2 rounded-full bg-green-600 shrink-0" />
                        <div>
                          <div className="font-medium">Work completed</div>
                          <div className="text-muted-foreground">{format(new Date(job.actualEnd), "MMMM do, yyyy")}</div>
                        </div>
                      </li>
                    )}
                  </ul>
                </div>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </div>
      </div>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent data-testid="dialog-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Job</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete Job #{job.jobNumber}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <QuickAddJobDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        editJob={job as any}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["jobs"] });
        }}
      />

      <ActionRequiredModal
        jobId={job.id}
        open={showActionRequiredModal}
        onOpenChange={setShowActionRequiredModal}
      />

      {/* Schedule Visit Dialog - triggered from Office Actions strip + inline visits header */}
      <AddVisitDialog
        jobId={job.id}
        jobVersion={job.version}
        open={showScheduleVisitDialog}
        onOpenChange={setShowScheduleVisitDialog}
        technicians={allTechnicians}
      />

      {/* Visit Detail Dialog — opens when clicking a visit row in middle column */}
      {/* Only mount when selectedVisitId is set to prevent stale query keys */}
      {selectedVisitId && (
        <VisitDetailDialog
          open={true}
          onOpenChange={(open) => { if (!open) setSelectedVisitId(null); }}
          jobId={job.id}
          visitId={selectedVisitId}
        />
      )}

      {/* Existing Visit Conflict Dialog — explicit Reschedule vs Add Follow-up */}
      <AlertDialog open={!!rescheduleConflict} onOpenChange={(open) => { if (!open) setRescheduleConflict(null); }}>
        <AlertDialogContent data-testid="dialog-reschedule-conflict">
          <AlertDialogHeader>
            <AlertDialogTitle>Existing Visit Found</AlertDialogTitle>
            <AlertDialogDescription>
              {rescheduleConflict?.isEmptyDraft ? (
                <>
                  Visit #{rescheduleConflict.visit.visitNumber || "—"} ({formatVisitDate(rescheduleConflict.visit)}) is an empty draft with no technician or notes.
                  You can reschedule it or add a separate follow-up visit.
                </>
              ) : (
                <>
                  Visit #{rescheduleConflict?.visit.visitNumber || "—"} ({VISIT_STATUS_LABELS[rescheduleConflict?.visit.status || ""] || rescheduleConflict?.visit.status}) is already scheduled.
                  Would you like to reschedule it, or add a new follow-up visit?
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel data-testid="button-cancel-reschedule">Cancel</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                // Reschedule existing: open visit detail for rescheduling
                if (rescheduleConflict) {
                  setSelectedVisitId(rescheduleConflict.visit.id);
                }
                setRescheduleConflict(null);
              }}
              data-testid="button-reschedule-existing"
            >
              Reschedule Existing Visit
            </Button>
            <AlertDialogAction
              onClick={() => {
                // Add follow-up: create a new visit (no conflict resolution needed)
                setRescheduleConflict(null);
                setShowScheduleVisitDialog(true);
              }}
              data-testid="button-add-followup"
            >
              Add Follow-up Visit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showCreateInvoiceDialog} onOpenChange={setShowCreateInvoiceDialog}>
        <DialogContent data-testid="dialog-create-invoice">
          <DialogHeader>
            <DialogTitle>Create Invoice from Job</DialogTitle>
            <DialogDescription>
              This will create a new draft invoice with line items from this job's parts and billing.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              Job: #{job.jobNumber} - {job.summary || "No summary"}
            </p>
            <p className="text-sm text-muted-foreground">
              Client: {job.parentCompany?.name || job.location?.companyName || "Unknown"}
            </p>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setShowCreateInvoiceDialog(false)}>
              Cancel
            </Button>
            {job.status !== "completed" && (
              <Button
                variant="outline"
                onClick={() => handleCreateInvoice(true)}
                disabled={createInvoiceMutation.isPending}
                data-testid="button-close-job-create-invoice"
              >
                {createInvoiceMutation.isPending ? "Creating..." : "Close Job & Create Invoice"}
              </Button>
            )}
            <Button
              onClick={() => handleCreateInvoice(false)}
              disabled={createInvoiceMutation.isPending}
              data-testid="button-confirm-create-invoice"
            >
              {createInvoiceMutation.isPending ? "Creating..." : "Create Invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Time Entry Modals */}
      <AddTimeEntryModal
        open={showAddTimeEntry}
        onOpenChange={setShowAddTimeEntry}
        jobId={job.id}
        assignedTechnicianIds={job.assignedTechnicianIds || []}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["jobs", jobId, "time-summary"] });
          queryClient.invalidateQueries({ queryKey: ["jobs", jobId, "time-entries"] });
        }}
      />

      <EditTimeEntryModal
        open={showEditTimeEntry}
        onOpenChange={(open) => {
          setShowEditTimeEntry(open);
          if (!open) setEditingTimeEntry(null);
        }}
        jobId={job.id}
        entry={editingTimeEntry}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["jobs", jobId, "time-summary"] });
          queryClient.invalidateQueries({ queryKey: ["jobs", jobId, "time-entries"] });
        }}
      />
    </div>
  );
}
