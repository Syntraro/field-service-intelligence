import { format } from "date-fns";
import { useLocation } from "wouter";
import { Calendar, Briefcase, Receipt, AlertCircle, Pause } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getHoldReasonLabel } from "@/components/ActionRequiredModal";
import type { Job, Invoice, JobStatus, OpenSubStatus } from "@shared/schema";

interface JobMetaCardProps {
  job: Job;
  invoice: Invoice | null;
  onStatusChange: (status: string, openSubStatus?: string | null) => void;
  onHoldSelect?: () => void; // Called when user selects "on_hold" to open modal
  statusChangePending?: boolean;
}

/**
 * Get job status display info using normalized 4-status model
 */
function getJobStatusDisplay(
  status: string,
  scheduledStart: Date | string | null,
  openSubStatus?: string | null
): {
  label: string;
  variant: "default" | "destructive" | "secondary" | "outline";
  isOverdue?: boolean;
} {
  const now = new Date();
  const isTerminal = ["completed", "invoiced", "archived"].includes(status);
  const isOverdue = !isTerminal && scheduledStart && new Date(scheduledStart) < now;

  // Terminal statuses
  if (status === "archived") {
    return { label: "Archived", variant: "outline", isOverdue: false };
  }
  if (status === "invoiced") {
    return { label: "Invoiced", variant: "default", isOverdue: false };
  }
  if (status === "completed") {
    return { label: "Completed", variant: "secondary", isOverdue: false };
  }

  // Open status - check sub-status and derived states
  if (status === "open") {
    // Check sub-status first
    if (openSubStatus === "on_hold") {
      return { label: "On Hold", variant: "destructive", isOverdue: !!isOverdue };
    }
    if (openSubStatus === "needs_review") {
      return { label: "Needs Review", variant: "destructive", isOverdue: !!isOverdue };
    }
    if (openSubStatus === "in_progress") {
      return { label: "In Progress", variant: "default", isOverdue: !!isOverdue };
    }
    if (openSubStatus === "on_route") {
      return { label: "On Route", variant: "default", isOverdue: !!isOverdue };
    }

    // Check if scheduled
    if (scheduledStart) {
      return { label: "Scheduled", variant: "secondary", isOverdue: !!isOverdue };
    }

    // Default open (backlog)
    return { label: "Open", variant: "outline", isOverdue: !!isOverdue };
  }

  // Fallback for any unknown status
  return { label: status, variant: "outline", isOverdue: !!isOverdue };
}

export function JobMetaCard({
  job,
  invoice,
  onStatusChange,
  onHoldSelect,
  statusChangePending,
}: JobMetaCardProps) {
  const [, setLocation] = useLocation();
  const statusInfo = getJobStatusDisplay(job.status, job.scheduledStart, job.openSubStatus);

  // Current display value combines status and sub-status
  const currentDisplayValue = job.openSubStatus
    ? `open:${job.openSubStatus}`
    : job.status;

  // Handle status change - intercept on_hold to open modal
  const handleStatusChange = (newValue: string) => {
    // Handle compound values like "open:in_progress"
    if (newValue.startsWith("open:")) {
      const subStatus = newValue.split(":")[1];
      if (subStatus === "on_hold") {
        // Open the modal instead of directly changing status
        onHoldSelect?.();
      } else {
        onStatusChange("open", subStatus);
      }
    } else {
      // Lifecycle status change (clears sub-status)
      onStatusChange(newValue, null);
    }
  };

  const isOnHold = job.status === "open" && (job.openSubStatus === "on_hold" || job.openSubStatus === "needs_review");

  return (
    <Card className="min-w-[200px]" data-testid="card-job-meta">
      <CardContent className="p-4 text-xs space-y-2">
        {/* Job number row */}
        <div className="flex items-center justify-between gap-4">
          <span className="font-medium text-muted-foreground flex items-center gap-1">
            <Briefcase className="h-3 w-3" />
            Job
          </span>
          <span className="font-semibold text-foreground" data-testid="text-job-number">
            #{job.jobNumber}
          </span>
        </div>

        {/* Invoice row */}
        <div className="flex items-center justify-between gap-4">
          <span className="font-medium text-muted-foreground flex items-center gap-1">
            <Receipt className="h-3 w-3" />
            Invoice
          </span>
          {invoice ? (
            <button
              type="button"
              onClick={() => setLocation(`/invoices/${invoice.id}`)}
              className="font-semibold text-primary hover:underline"
              data-testid="link-invoice"
            >
              #{invoice.invoiceNumber || `INV-${invoice.id.slice(0, 6).toUpperCase()}`}
            </button>
          ) : (
            <span className="text-[11px] text-muted-foreground" data-testid="text-no-invoice">
              Not invoiced
            </span>
          )}
        </div>

        {/* Status row */}
        <div className="flex items-center justify-between gap-4">
          <span className="font-medium text-muted-foreground">Status</span>
          <div className="flex items-center gap-2">
            {statusInfo.isOverdue && (
              <Badge variant="destructive" className="text-[11px]" data-testid="badge-overdue">
                Overdue
              </Badge>
            )}
            <Select
              value={currentDisplayValue}
              onValueChange={handleStatusChange}
              disabled={statusChangePending}
            >
              <SelectTrigger className="h-6 w-auto min-w-[100px] text-[11px]" data-testid="select-status">
                <SelectValue placeholder="Change" />
              </SelectTrigger>
              <SelectContent>
                {/* Open workflow states */}
                <SelectItem value="open">Open (Backlog)</SelectItem>
                <SelectItem value="open:in_progress">In Progress</SelectItem>
                <SelectItem value="open:on_route">On Route</SelectItem>
                <SelectItem value="open:on_hold">On Hold</SelectItem>
                {/* Lifecycle transitions */}
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="invoiced">Invoiced</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Scheduled */}
        <div className="flex items-center justify-between gap-4">
          <span className="font-medium text-muted-foreground">Scheduled</span>
          <div className="flex items-center gap-1 text-[11px]">
            <Calendar className="h-3 w-3 text-muted-foreground" />
            <span>
              {job.scheduledStart ? format(new Date(job.scheduledStart), "MMM d, yyyy h:mm a") : "Not set"}
            </span>
          </div>
        </div>

        {/* On Hold Info - show when openSubStatus is on_hold or needs_review */}
        {isOnHold && (
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
      </CardContent>
    </Card>
  );
}
