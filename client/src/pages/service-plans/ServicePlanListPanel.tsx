import { format } from "date-fns";
import { EntityListTable, type EntityListColumn } from "@/components/lists/EntityListTable";
import { Chip } from "@/components/ui/chip";
import { type ServicePlanView, formatFrequencyStacked } from "@/lib/servicePlanWorkspaceConfig";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface RecurringPlanItem {
  id: string;
  title: string;
  jobType: string;
  clientId: string | null;
  locationId: string | null;
  clientName?: string | null;
  locationName?: string | null;
  locationCity?: string | null;
  locationAddress?: string | null;
  recurrenceKind: string;
  interval: number;
  monthsOfYear: number[] | null;
  generationMode: string | null;
  generationDayOfMonth: number | null;
  isActive: boolean;
  startDate?: string | null;
  endDate?: string | null;
  pmBillingModel?: string | null;
  createdAt: string;
  updatedAt: string | null;
  nextOccurrence?: string | null;
}

export interface ServicePlanSelectionContext {
  planId: string;
  clientId: string | null;
  locationId: string | null;
  isActive: boolean;
  title: string;
  clientName?: string | null;
  locationName?: string | null;
  locationAddress?: string | null;
}

// ── View predicate ────────────────────────────────────────────────────────────

export function applyViewPredicate(
  plans: RecurringPlanItem[],
  view: ServicePlanView,
): RecurringPlanItem[] {
  const now = Date.now();
  const ms90d = 90 * 864e5;
  const ms30d = 30 * 864e5;
  const ms7d  =  7 * 864e5;

  switch (view) {
    case "all":
      return plans;
    case "active":
      return plans.filter((p) => p.isActive);
    case "work_due":
      return plans.filter((p) => {
        if (!p.isActive || !p.nextOccurrence) return false;
        return new Date(p.nextOccurrence).getTime() <= now + ms7d;
      });
    case "overdue":
      return plans.filter((p) => {
        if (!p.nextOccurrence) return false;
        return new Date(p.nextOccurrence).getTime() < now;
      });
    case "upcoming":
      return plans.filter((p) => {
        if (!p.isActive || !p.nextOccurrence) return false;
        const occ = new Date(p.nextOccurrence).getTime();
        return occ >= now && occ <= now + ms30d;
      });
    case "expiring_soon":
      return plans.filter((p) => {
        if (!p.endDate) return false;
        const end = new Date(p.endDate).getTime();
        return end > now && end <= now + ms90d;
      });
    case "expired":
      return plans.filter((p) => !!p.endDate && new Date(p.endDate).getTime() < now);
    case "paused":
      return plans.filter((p) => !p.isActive);
    case "maintenance":
      return plans.filter((p) => p.jobType === "maintenance");
    case "inspection":
      return plans.filter((p) => p.jobType === "inspection");
    case "warranty":
      return plans.filter((p) => p.jobType === "warranty");
    case "recurring":
      return plans.filter((p) => p.jobType !== "maintenance");
    case "missing_client":
      return plans.filter((p) => !p.clientId);
    case "no_upcoming_visit":
      return plans.filter((p) => p.isActive && !p.nextOccurrence);
    case "missing_billing":
      return plans.filter((p) => !p.pmBillingModel);
    default:
      return plans;
  }
}

export function applyPlanSearch(plans: RecurringPlanItem[], query: string): RecurringPlanItem[] {
  if (!query.trim()) return plans;
  const q = query.toLowerCase();
  return plans.filter(
    (p) =>
      p.title.toLowerCase().includes(q) ||
      p.clientName?.toLowerCase().includes(q) ||
      p.locationName?.toLowerCase().includes(q) ||
      p.locationAddress?.toLowerCase().includes(q) ||
      p.locationCity?.toLowerCase().includes(q),
  );
}

// ── Column definitions ────────────────────────────────────────────────────────

export const SERVICE_PLAN_COLUMNS: EntityListColumn<RecurringPlanItem>[] = [
  {
    id: "client",
    kind: "primary",
    ratio: 1.4,
    header: "Client",
    sortKey: "client",
    cell: {
      type: "entity-primary",
      value: (plan) => plan.clientName || "No client assigned",
      secondary: (plan) => plan.locationName || undefined,
    },
  },
  {
    id: "plan",
    kind: "primary",
    ratio: 1.9,
    header: "Plan",
    sortKey: "plan",
    cell: {
      type: "customRender",
      reason: "plan title + badge for non-maintenance job types",
      render: (plan) => (
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate text-list-primary">{plan.title}</span>
          {plan.jobType !== "maintenance" && (
            <Chip tone="neutral" className="shrink-0 capitalize">{plan.jobType}</Chip>
          )}
        </div>
      ),
    },
  },
  {
    id: "frequency",
    kind: "primary",
    ratio: 1.1,
    header: "Frequency",
    cell: {
      type: "customRender",
      reason: "stacked headline + optional sub-line",
      render: (plan) => {
        const { headline, sub } = formatFrequencyStacked(
          plan.recurrenceKind,
          plan.interval,
          plan.monthsOfYear,
        );
        return (
          <div className="min-w-0">
            <p className="text-list-primary truncate">{headline}</p>
            {sub && <p className="text-helper text-muted-foreground truncate">{sub}</p>}
          </div>
        );
      },
    },
  },
  {
    id: "nextDue",
    kind: "date",
    ratio: 1.0,
    header: "Next Due",
    sortKey: "nextDue",
    cell: {
      type: "customRender",
      reason: "null nextOccurrence needs em-dash; overdue shows date in red (not the word 'Overdue')",
      render: (plan) => {
        if (!plan.nextOccurrence) {
          return <span className="text-muted-foreground">—</span>;
        }
        const [y, m, d] = plan.nextOccurrence.split("-").map(Number);
        const date = new Date(y, m - 1, d);
        const isOverdue = plan.isActive && date < new Date();
        return (
          <span className={isOverdue ? "text-red-600 font-medium whitespace-nowrap" : "whitespace-nowrap"}>
            {format(date, "MMM d, yyyy")}
          </span>
        );
      },
    },
  },
  {
    id: "status",
    kind: "status",
    ratio: 0.9,
    header: "Status",
    cell: {
      type: "entity-status",
      getStatusMeta: (plan) =>
        plan.isActive
          ? { label: "Active", tone: "success" as const }
          : { label: "Paused", tone: "warning" as const },
    },
  },
];

// ── ServicePlanListPanel ──────────────────────────────────────────────────────

interface ServicePlanListPanelProps {
  plans: RecurringPlanItem[];
  isLoading: boolean;
  error: Error | null;
  hasPlans: boolean;
  selectedPlanId: string | null;
  onRowClick: (plan: RecurringPlanItem) => void;
  sortField?: string;
  sortDirection?: "asc" | "desc";
  onSort?: (key: string) => void;
}

export function ServicePlanListPanel({
  plans,
  isLoading,
  error,
  hasPlans,
  selectedPlanId,
  onRowClick,
  sortField,
  sortDirection,
  onSort,
}: ServicePlanListPanelProps) {
  return (
    <EntityListTable<RecurringPlanItem>
      rows={plans}
      rowKey={(plan) => plan.id}
      onRowClick={onRowClick}
      selectedRowKey={selectedPlanId ?? undefined}
      loadingState={isLoading ? { kind: "loading", title: "Loading service plans…" } : undefined}
      emptyState={
        !hasPlans
          ? { kind: "empty", icon: "wrench", title: "No service plans yet" }
          : { kind: "no-results", title: "No plans match this view" }
      }
      errorState={error ? { kind: "error", title: "Failed to load service plans" } : undefined}
      columns={SERVICE_PLAN_COLUMNS}
      cellPy="py-2.5"
      sortField={sortField}
      sortDirection={sortDirection}
      onSort={onSort}
    />
  );
}
