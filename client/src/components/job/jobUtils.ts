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
} from "lucide-react";

export const JOB_STATUS_FLOW = [
  { key: "draft", label: "Draft", icon: FileText },
  { key: "scheduled", label: "Scheduled", icon: Calendar },
  { key: "in_progress", label: "In Progress", icon: Play },
  { key: "requires_invoicing", label: "Requires Invoicing", icon: CheckCircle },
  { key: "invoiced", label: "Invoiced", icon: Receipt },
] as const;

export const STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ["scheduled", "cancelled"],
  scheduled: ["in_progress", "on_hold", "cancelled"],
  in_progress: ["requires_invoicing", "invoiced", "on_hold", "cancelled"],
  on_hold: ["in_progress", "cancelled"],
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
  if (status === "on_hold") {
    return { label: "On Hold", variant: "outline", icon: Pause };
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
