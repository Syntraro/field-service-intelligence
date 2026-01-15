// Job status utilities and constants
// Extracted from JobDetailPage.tsx

import {
  FileText,
  Calendar,
  Play,
  CheckCircle,
  Receipt,
  XCircle,
  Pause,
  AlertTriangle,
  AlertCircle,
} from "lucide-react";

export const JOB_STATUS_FLOW = [
  { key: "draft", label: "Draft", icon: FileText },
  { key: "scheduled", label: "Scheduled", icon: Calendar },
  { key: "in_progress", label: "In Progress", icon: Play },
  { key: "requires_invoicing", label: "Requires Invoicing", icon: CheckCircle },
  { key: "invoiced", label: "Invoiced", icon: Receipt },
] as const;

// Status transitions for UI dropdowns (excludes legacy statuses)
export const STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ["scheduled", "cancelled"],
  scheduled: ["in_progress", "action_required", "cancelled"],
  in_progress: ["requires_invoicing", "invoiced", "action_required", "cancelled"],
  action_required: ["scheduled", "in_progress", "cancelled"],
  // LEGACY statuses can transition to action_required or active states (read-only, cannot be set)
  on_hold: ["in_progress", "action_required", "cancelled"],
  needs_parts: ["in_progress", "action_required", "cancelled"],
  // LEGACY: "completed" treated same as "requires_invoicing"
  completed: ["invoiced", "requires_invoicing"],
  requires_invoicing: ["invoiced"],
  invoiced: [],
  cancelled: [],
};

export type JobStatusDisplay = {
  label: string;
  variant: "default" | "destructive" | "secondary" | "outline";
  icon: any;
  isOverdue?: boolean;
};

export function getJobStatusDisplay(
  status: string,
  scheduledStart: Date | null
): JobStatusDisplay {
  const now = new Date();

  // LEGACY: "completed" treated same as "requires_invoicing" for display
  if (status === "completed") {
    return { label: "Completed", variant: "secondary", icon: CheckCircle };
  }
  if (status === "requires_invoicing") {
    return { label: "Requires Invoicing", variant: "secondary", icon: CheckCircle };
  }
  if (status === "invoiced") {
    return { label: "Invoiced", variant: "default", icon: Receipt };
  }
  if (status === "cancelled") {
    return { label: "Cancelled", variant: "outline", icon: XCircle };
  }
  // LEGACY: needs_parts and on_hold display as Action Required variants
  if (status === "needs_parts") {
    return { label: "Action Required (Needs Parts)", variant: "destructive", icon: AlertCircle };
  }
  if (status === "on_hold") {
    return { label: "Action Required (On Hold)", variant: "destructive", icon: AlertCircle };
  }
  if (status === "action_required") {
    return { label: "Action Required", variant: "destructive", icon: AlertCircle };
  }
  if (status === "in_progress") {
    return { label: "In Progress", variant: "default", icon: Play };
  }
  if (status === "draft") {
    return { label: "Draft", variant: "outline", icon: FileText };
  }

  if (status === "scheduled" && scheduledStart) {
    const scheduled = new Date(scheduledStart);
    if (scheduled < now) {
      return { label: "Overdue", variant: "destructive", icon: AlertTriangle, isOverdue: true };
    }
    return { label: "Scheduled", variant: "default", icon: Calendar };
  }

  return { label: status, variant: "outline", icon: FileText };
}

export type PriorityDisplay = {
  label: string;
  variant: "default" | "destructive" | "secondary" | "outline";
};

export function getPriorityDisplay(priority: string): PriorityDisplay {
  switch (priority) {
    case "urgent":
      return { label: "Urgent", variant: "destructive" };
    case "high":
      return { label: "High", variant: "default" };
    case "medium":
      return { label: "Medium", variant: "secondary" };
    case "low":
      return { label: "Low", variant: "outline" };
    default:
      return { label: priority, variant: "outline" };
  }
}
