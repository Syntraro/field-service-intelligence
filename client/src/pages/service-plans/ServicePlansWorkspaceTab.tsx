import { useState, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { OperationalWorkspace } from "@/components/workspace/OperationalWorkspace";
import { WorkspaceCenterPane } from "@/components/workspace/WorkspaceCenterPane";
import { WorkspaceEntitySurface } from "@/components/workspace/WorkspaceEntitySurface";
import {
  WorkspaceFilterBar,
  WorkspaceViewChip,
  WorkspaceFilterBarSeparator,
  WorkspaceViewMoreDropdown,
  WorkspaceViewDropdownItem,
} from "@/components/workspace/WorkspaceFilterBar";
import { useWorkspaceState } from "@/hooks/useWorkspaceState";
import { useWorkspaceSelection } from "@/hooks/useWorkspaceSelection";
import { ListLoadMoreFooter } from "@/components/lists/ListLoadMoreFooter";
import { type ServicePlanView } from "./ServicePlanViewRail";
import {
  ServicePlanListPanel,
  applyViewPredicate,
  applyPlanSearch,
  type RecurringPlanItem,
  type ServicePlanSelectionContext,
} from "./ServicePlanListPanel";
import { ServicePlanActionsRail } from "./ServicePlanActionsRail";

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_VIEWS: readonly ServicePlanView[] = [
  "all", "active", "work_due", "overdue", "upcoming",
  "expiring_soon", "expired", "paused",
  "maintenance", "inspection", "warranty", "recurring",
  "missing_client", "no_upcoming_visit", "missing_billing",
];

const PAGE_SIZE = 50;

// ── Client-side sort ──────────────────────────────────────────────────────────

function sortPlans(
  plans: RecurringPlanItem[],
  sortField: string | undefined,
  sortDirection: "asc" | "desc" | undefined,
): RecurringPlanItem[] {
  if (!sortField || !sortDirection) return plans;
  return [...plans].sort((a, b) => {
    if (sortField === "nextDue") {
      if (!a.nextOccurrence && !b.nextOccurrence) return 0;
      if (!a.nextOccurrence) return 1;
      if (!b.nextOccurrence) return -1;
      const diff =
        new Date(a.nextOccurrence).getTime() - new Date(b.nextOccurrence).getTime();
      return sortDirection === "asc" ? diff : -diff;
    }
    const aVal =
      sortField === "client"
        ? a.clientName ?? ""
        : sortField === "plan"
        ? a.title
        : "";
    const bVal =
      sortField === "client"
        ? b.clientName ?? ""
        : sortField === "plan"
        ? b.title
        : "";
    const cmp = aVal.localeCompare(bVal, undefined, { sensitivity: "base" });
    return sortDirection === "asc" ? cmp : -cmp;
  });
}

// ── ServicePlansWorkspaceTab ──────────────────────────────────────────────────

interface ServicePlansWorkspaceTabProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

export function ServicePlansWorkspaceTab({ searchQuery, onSearchChange }: ServicePlansWorkspaceTabProps) {
  const [, setLocation] = useLocation();
  const search = useSearch();

  // ── Domain selection state ─────────────────────────────────────────────────
  const [selectedContext, setSelectedContext] = useState<ServicePlanSelectionContext | null>(null);
  const [railExpanded, setRailExpanded] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // ── Workspace infrastructure ───────────────────────────────────────────────
  const ws = useWorkspaceState({
    lsKey: "syntraro.servicePlans",
    validViews: VALID_VIEWS,
    defaultView: "all",
    onNavigate: (view) => {
      const params = new URLSearchParams(search);
      if (view === "all") params.delete("view");
      else params.set("view", view);
      setLocation(`/pm?${params}`);
    },
  });

  // ── Plan list query ────────────────────────────────────────────────────────
  const { data: rawPlans = [], isLoading, error } = useQuery<RecurringPlanItem[]>({
    queryKey: ["/api/recurring-templates"],
    queryFn: async () => {
      const res = await fetch("/api/recurring-templates", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load service plans");
      return res.json();
    },
    staleTime: 30_000,
    refetchIntervalInBackground: false,
  });

  // ── Active view from URL ───────────────────────────────────────────────────
  const activeView = useMemo<ServicePlanView>(() => {
    const p = new URLSearchParams(search);
    const v = p.get("view");
    return v && (VALID_VIEWS as readonly string[]).includes(v) ? (v as ServicePlanView) : "all";
  }, [search]);

  // ── Client-side filtering + sorting ───────────────────────────────────────
  const filteredPlans = useMemo(() => {
    const byView = applyViewPredicate(rawPlans, activeView);
    const searched = applyPlanSearch(byView, searchQuery);
    return sortPlans(searched, ws.sort?.field, ws.sort?.direction);
  }, [rawPlans, activeView, searchQuery, ws.sort]);

  // ── Debounced selection → right rail ──────────────────────────────────────
  const { handleSelectionChange } = useWorkspaceSelection<ServicePlanSelectionContext>(
    (ctx) => {
      setSelectedContext(ctx);
      setRailExpanded(ctx !== null);
    },
  );

  const handleRowClick = (plan: RecurringPlanItem) => {
    const alreadySelected = selectedContext?.planId === plan.id;
    if (alreadySelected) {
      setSelectedContext(null);
      setRailExpanded(false);
    } else {
      handleSelectionChange(
        {
          planId: plan.id,
          clientId: plan.clientId,
          locationId: plan.locationId,
          isActive: plan.isActive,
          title: plan.title,
          clientName: plan.clientName,
          locationName: plan.locationName,
          locationAddress: plan.locationAddress,
        },
        false,
      );
    }
  };

  const handleViewChange = (view: ServicePlanView) => {
    ws.setView(view);
    setSelectedContext(null);
    setRailExpanded(false);
    setVisibleCount(PAGE_SIZE);
  };

  // ── Sort handler — cycles asc → desc → clear ──────────────────────────────
  const handleSort = (key: string) => {
    const current = ws.sort;
    if (!current || current.field !== key) {
      ws.setSort(key, "asc");
    } else if (current.direction === "asc") {
      ws.setSort(key, "desc");
    } else {
      ws.clearSort();
    }
  };

  const visiblePlans = filteredPlans.slice(0, visibleCount);

  const SECONDARY_VIEWS: ServicePlanView[] = [
    "expiring_soon", "expired", "paused",
    "maintenance", "inspection", "warranty", "recurring",
    "missing_client", "no_upcoming_visit", "missing_billing",
  ];
  const TYPE_VIEWS: ServicePlanView[] = ["maintenance", "inspection", "warranty", "recurring"];
  const ATTENTION_VIEWS: ServicePlanView[] = ["missing_client", "no_upcoming_visit", "missing_billing"];
  const MORE_VIEWS: ServicePlanView[] = ["expiring_soon", "expired", "paused"];

  const moreActive = MORE_VIEWS.includes(activeView);
  const typeActive = TYPE_VIEWS.includes(activeView);
  const attentionActive = ATTENTION_VIEWS.includes(activeView);

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <WorkspaceFilterBar data-testid="service-plan-filter-bar">
        <WorkspaceViewChip
          active={activeView === "all"}
          onClick={() => handleViewChange("all")}
          data-testid="service-plan-view-all"
        >
          All
        </WorkspaceViewChip>
        <WorkspaceViewChip
          active={activeView === "active"}
          onClick={() => handleViewChange("active")}
          data-testid="service-plan-view-active"
        >
          Active
        </WorkspaceViewChip>
        <WorkspaceViewChip
          active={activeView === "work_due"}
          onClick={() => handleViewChange("work_due")}
          data-testid="service-plan-view-work-due"
        >
          Work Due
        </WorkspaceViewChip>
        <WorkspaceViewChip
          active={activeView === "overdue"}
          onClick={() => handleViewChange("overdue")}
          data-testid="service-plan-view-overdue"
        >
          Overdue
        </WorkspaceViewChip>
        <WorkspaceViewChip
          active={activeView === "upcoming"}
          onClick={() => handleViewChange("upcoming")}
          data-testid="service-plan-view-upcoming"
        >
          Upcoming
        </WorkspaceViewChip>

        <WorkspaceFilterBarSeparator />

        <WorkspaceViewMoreDropdown label="More" activeInDropdown={moreActive}>
          <WorkspaceViewDropdownItem
            active={activeView === "expiring_soon"}
            onClick={() => handleViewChange("expiring_soon")}
          >
            Expiring Soon
          </WorkspaceViewDropdownItem>
          <WorkspaceViewDropdownItem
            active={activeView === "expired"}
            onClick={() => handleViewChange("expired")}
          >
            Expired
          </WorkspaceViewDropdownItem>
          <WorkspaceViewDropdownItem
            active={activeView === "paused"}
            onClick={() => handleViewChange("paused")}
          >
            Paused
          </WorkspaceViewDropdownItem>
        </WorkspaceViewMoreDropdown>

        <WorkspaceViewMoreDropdown label="Type" activeInDropdown={typeActive}>
          <WorkspaceViewDropdownItem
            active={activeView === "maintenance"}
            onClick={() => handleViewChange("maintenance")}
          >
            Maintenance
          </WorkspaceViewDropdownItem>
          <WorkspaceViewDropdownItem
            active={activeView === "inspection"}
            onClick={() => handleViewChange("inspection")}
          >
            Inspection
          </WorkspaceViewDropdownItem>
          <WorkspaceViewDropdownItem
            active={activeView === "warranty"}
            onClick={() => handleViewChange("warranty")}
          >
            Warranty
          </WorkspaceViewDropdownItem>
          <WorkspaceViewDropdownItem
            active={activeView === "recurring"}
            onClick={() => handleViewChange("recurring")}
          >
            Recurring
          </WorkspaceViewDropdownItem>
        </WorkspaceViewMoreDropdown>

        <WorkspaceViewMoreDropdown label="Attention" activeInDropdown={attentionActive}>
          <WorkspaceViewDropdownItem
            active={activeView === "missing_client"}
            onClick={() => handleViewChange("missing_client")}
          >
            Missing Client
          </WorkspaceViewDropdownItem>
          <WorkspaceViewDropdownItem
            active={activeView === "no_upcoming_visit"}
            onClick={() => handleViewChange("no_upcoming_visit")}
          >
            No Upcoming Visit
          </WorkspaceViewDropdownItem>
          <WorkspaceViewDropdownItem
            active={activeView === "missing_billing"}
            onClick={() => handleViewChange("missing_billing")}
          >
            Missing Billing
          </WorkspaceViewDropdownItem>
        </WorkspaceViewMoreDropdown>
      </WorkspaceFilterBar>

      <OperationalWorkspace
        rightRailExpanded={railExpanded}
        center={
          <WorkspaceCenterPane>
            <WorkspaceEntitySurface
              data-testid="tab-content-service-plans"
              footer={
                <ListLoadMoreFooter
                  visibleCount={Math.min(visibleCount, filteredPlans.length)}
                  totalCount={filteredPlans.length}
                  hasMore={visibleCount < filteredPlans.length}
                  onLoadMore={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  label="plan"
                />
              }
            >
              <ServicePlanListPanel
                plans={visiblePlans}
                isLoading={isLoading}
                error={error as Error | null}
                hasPlans={rawPlans.length > 0}
                selectedPlanId={selectedContext?.planId ?? null}
                onRowClick={handleRowClick}
                sortField={ws.sort?.field}
                sortDirection={ws.sort?.direction}
                onSort={handleSort}
              />
            </WorkspaceEntitySurface>
          </WorkspaceCenterPane>
        }
        rightRail={<ServicePlanActionsRail context={selectedContext} />}
        data-testid="service-plans-workspace-tab"
      />
    </div>
  );
}
