import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  CircleDot,
  Clock,
  Cpu,
  FileWarning,
  Layers,
  ListChecks,
  Play,
  RefreshCw,
  Shield,
  Tag,
  UserX,
  Wrench,
  Zap,
} from "lucide-react";
import {
  WorkspaceViewRail,
  type WorkspaceViewGroup,
} from "@/components/workspace/WorkspaceViewRail";

// ── Domain view type ──────────────────────────────────────────────────────────

export type JobView =
  // Operational State
  | "all"
  | "needs-scheduling"
  | "scheduled-today"
  | "in-progress"
  | "awaiting-follow-up"
  | "waiting-for-parts"
  | "ready-to-invoice"
  | "completed-not-invoiced"
  | "overdue"
  | "unassigned"
  // Workflow Type
  | "service"
  | "maintenance"
  | "install"
  | "warranty"
  | "emergency"
  | "recurring"
  // Attention
  | "missing-labor"
  | "missing-notes"
  | "missing-line-items"
  | "no-future-visit"
  | "return-visit-required"
  | "technician-flagged";

// ── View group definitions ────────────────────────────────────────────────────

const JOB_VIEW_GROUPS: WorkspaceViewGroup<JobView>[] = [
  {
    label: "Operational State",
    items: [
      { value: "all",                    label: "All Jobs",               icon: Layers },
      { value: "needs-scheduling",       label: "Needs Scheduling",       icon: Clock },
      { value: "scheduled-today",        label: "Scheduled Today",        icon: Calendar },
      { value: "in-progress",            label: "In Progress",            icon: Play },
      { value: "awaiting-follow-up",     label: "Awaiting Follow-Up",     icon: RefreshCw },
      { value: "waiting-for-parts",      label: "Waiting for Parts",      icon: Tag },
      { value: "ready-to-invoice",       label: "Ready to Invoice",       icon: CheckCircle2 },
      { value: "completed-not-invoiced", label: "Completed, Not Invoiced", icon: ListChecks },
      { value: "overdue",                label: "Overdue",                icon: AlertTriangle },
      { value: "unassigned",             label: "Unassigned",             icon: UserX },
    ],
  },
  {
    label: "Workflow Type",
    items: [
      { value: "service",     label: "Service",     icon: Wrench },
      { value: "maintenance", label: "Maintenance", icon: Cpu },
      { value: "install",     label: "Install",     icon: CircleDot },
      { value: "warranty",    label: "Warranty",    icon: Shield },
      { value: "emergency",   label: "Emergency",   icon: Zap },
      { value: "recurring",   label: "Recurring",   icon: RefreshCw },
    ],
  },
  {
    label: "Attention",
    items: [
      { value: "missing-labor",         label: "Missing Labor",          icon: FileWarning },
      { value: "missing-notes",         label: "Missing Notes",          icon: FileWarning },
      { value: "missing-line-items",    label: "Missing Line Items",     icon: FileWarning },
      { value: "no-future-visit",       label: "No Future Visit",        icon: Calendar },
      { value: "return-visit-required", label: "Return Visit Required",  icon: RefreshCw },
      { value: "technician-flagged",    label: "Technician Flagged",     icon: AlertTriangle },
    ],
  },
];

// ── JobViewRail ───────────────────────────────────────────────────────────────

interface JobViewRailProps {
  activeView: JobView;
  onViewChange: (view: JobView) => void;
}

export function JobViewRail({ activeView, onViewChange }: JobViewRailProps) {
  return (
    <WorkspaceViewRail<JobView>
      groups={JOB_VIEW_GROUPS}
      activeView={activeView}
      onChange={onViewChange}
      aria-label="Job views"
      testIdPrefix="job-view"
      data-testid="job-view-rail"
    />
  );
}
