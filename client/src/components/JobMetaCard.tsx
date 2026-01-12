import { format } from "date-fns";
import { useLocation } from "wouter";
import { Calendar, Briefcase, Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Job, Invoice } from "@shared/schema";

interface JobMetaCardProps {
  job: Job;
  invoice: Invoice | null;
  onStatusChange: (status: string) => void;
  statusChangePending?: boolean;
}

function getJobStatusDisplay(status: string, scheduledStart: Date | null): { 
  label: string; 
  variant: "default" | "destructive" | "secondary" | "outline"; 
  isOverdue?: boolean;
} {
  const now = new Date();
  const isOverdue = !!(scheduledStart && new Date(scheduledStart) < now &&
    !["completed", "requires_invoicing", "invoiced", "cancelled", "closed", "archived"].includes(status));

  switch (status) {
    case "draft": return { label: "Draft", variant: "outline", isOverdue };
    case "scheduled": return { label: "Scheduled", variant: "secondary", isOverdue };
    case "dispatched": return { label: "Dispatched", variant: "secondary", isOverdue };
    case "en_route": return { label: "En Route", variant: "default", isOverdue };
    case "on_site": return { label: "On Site", variant: "default", isOverdue };
    case "in_progress": return { label: "In Progress", variant: "default", isOverdue };
    case "needs_parts": return { label: "Needs Parts", variant: "secondary", isOverdue };
    case "on_hold": return { label: "On Hold", variant: "secondary", isOverdue };
    case "completed": return { label: "Completed", variant: "default", isOverdue: false }; // LEGACY
    case "requires_invoicing": return { label: "Requires Invoicing", variant: "secondary", isOverdue: false };
    case "invoiced": return { label: "Invoiced", variant: "default", isOverdue: false };
    case "cancelled": return { label: "Cancelled", variant: "outline", isOverdue: false };
    case "closed": return { label: "Closed", variant: "outline", isOverdue: false };
    case "archived": return { label: "Archived", variant: "outline", isOverdue: false };
    default: return { label: status, variant: "outline", isOverdue };
  }
}

export function JobMetaCard({
  job,
  invoice,
  onStatusChange,
  statusChangePending,
}: JobMetaCardProps) {
  const [, setLocation] = useLocation();
  const statusInfo = getJobStatusDisplay(job.status, job.scheduledStart);

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
              value={job.status}
              onValueChange={onStatusChange}
              disabled={statusChangePending}
            >
              <SelectTrigger className="h-6 w-auto min-w-[100px] text-[11px]" data-testid="select-status">
                <SelectValue placeholder="Change" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="scheduled">Scheduled</SelectItem>
                <SelectItem value="dispatched">Dispatched</SelectItem>
                <SelectItem value="en_route">En Route</SelectItem>
                <SelectItem value="on_site">On Site</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="needs_parts">Needs Parts</SelectItem>
                <SelectItem value="on_hold">On Hold</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="invoiced">Invoiced</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
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
      </CardContent>
    </Card>
  );
}
