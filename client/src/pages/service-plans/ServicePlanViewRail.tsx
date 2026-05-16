import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  Cpu,
  FileWarning,
  Layers,
  PauseCircle,
  RefreshCw,
  Shield,
  Tag,
  Wrench,
  XCircle,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ServicePlanView =
  // Operational State
  | "all"
  | "active"
  | "work_due"
  | "overdue"
  | "upcoming"
  | "expiring_soon"
  | "expired"
  | "paused"
  // Workflow Type
  | "maintenance"
  | "inspection"
  | "warranty"
  | "recurring"
  // Attention
  | "missing_client"
  | "no_upcoming_visit"
  | "missing_billing";

interface ViewItem {
  value: ServicePlanView;
  label: string;
  icon: React.ElementType;
}

const OPERATIONAL_STATE_VIEWS: ViewItem[] = [
  { value: "all",           label: "All Plans",      icon: Layers },
  { value: "active",        label: "Active",         icon: CheckCircle2 },
  { value: "work_due",      label: "Work Due",       icon: Zap },
  { value: "overdue",       label: "Overdue",        icon: AlertTriangle },
  { value: "upcoming",      label: "Upcoming",       icon: Calendar },
  { value: "expiring_soon", label: "Expiring Soon",  icon: Clock },
  { value: "expired",       label: "Expired",        icon: XCircle },
  { value: "paused",        label: "Paused",         icon: PauseCircle },
];

const WORKFLOW_TYPE_VIEWS: ViewItem[] = [
  { value: "maintenance", label: "Maintenance", icon: Wrench },
  { value: "inspection",  label: "Inspection",  icon: Cpu },
  { value: "warranty",    label: "Warranty",    icon: Shield },
  { value: "recurring",   label: "Recurring",   icon: RefreshCw },
];

const ATTENTION_VIEWS: ViewItem[] = [
  { value: "missing_client",    label: "Missing Client",    icon: FileWarning },
  { value: "no_upcoming_visit", label: "No Upcoming Visit", icon: Calendar },
  { value: "missing_billing",   label: "Missing Billing",   icon: Tag },
];

// ── ViewButton ────────────────────────────────────────────────────────────────

function ViewButton({
  item,
  isActive,
  onViewChange,
}: {
  item: ViewItem;
  isActive: boolean;
  onViewChange: (view: ServicePlanView) => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={() => onViewChange(item.value)}
      aria-current={isActive ? "page" : undefined}
      data-testid={`service-plan-view-${item.value}`}
      className={cn(
        "flex items-center gap-2 w-full h-[34px] rounded-lg px-[10px] text-left transition-colors",
        "text-row",
        isActive
          ? "bg-primary/10 text-primary font-medium"
          : "text-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      <Icon
        className={cn("h-4 w-4 shrink-0", isActive ? "text-primary" : "text-muted-foreground")}
      />
      <span className="truncate flex-1">{item.label}</span>
    </button>
  );
}

// ── RailSectionLabel ──────────────────────────────────────────────────────────

function RailSectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.04em] mb-[4px]",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ── ServicePlanViewRail ───────────────────────────────────────────────────────

interface ServicePlanViewRailProps {
  activeView: ServicePlanView;
  onViewChange: (view: ServicePlanView) => void;
}

export function ServicePlanViewRail({ activeView, onViewChange }: ServicePlanViewRailProps) {
  return (
    <nav
      className="flex flex-col gap-0.5 py-3 px-3"
      aria-label="Service plan views"
      data-testid="service-plan-view-rail"
    >
      <RailSectionLabel>Operational State</RailSectionLabel>
      {OPERATIONAL_STATE_VIEWS.map((view) => (
        <ViewButton
          key={view.value}
          item={view}
          isActive={activeView === view.value}
          onViewChange={onViewChange}
        />
      ))}

      <RailSectionLabel className="mt-[12px]">Workflow Type</RailSectionLabel>
      {WORKFLOW_TYPE_VIEWS.map((view) => (
        <ViewButton
          key={view.value}
          item={view}
          isActive={activeView === view.value}
          onViewChange={onViewChange}
        />
      ))}

      <RailSectionLabel className="mt-[12px]">Attention</RailSectionLabel>
      {ATTENTION_VIEWS.map((view) => (
        <ViewButton
          key={view.value}
          item={view}
          isActive={activeView === view.value}
          onViewChange={onViewChange}
        />
      ))}
    </nav>
  );
}
