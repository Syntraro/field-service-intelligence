import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { WorkspaceCenterPane } from "@/components/workspace/WorkspaceCenterPane";
import { WorkspaceEntitySurface } from "@/components/workspace/WorkspaceEntitySurface";
import { WorkspaceListCard } from "@/components/workspace/WorkspaceListCard";
import { useWorkspaceSelection } from "@/hooks/useWorkspaceSelection";
import { ListLoadMoreFooter } from "@/components/lists/ListLoadMoreFooter";
import { type ServicePlanView } from "@/lib/servicePlanWorkspaceConfig";
import {
  ServicePlanListPanel,
  applyViewPredicate,
  applyPlanSearch,
  type RecurringPlanItem,
  type ServicePlanSelectionContext,
} from "./ServicePlanListPanel";

// ── Constants ─────────────────────────────────────────────────────────────────

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
      sortField === "client" ? a.clientName ?? "" :
      sortField === "plan"   ? a.title          : "";
    const bVal =
      sortField === "client" ? b.clientName ?? "" :
      sortField === "plan"   ? b.title          : "";
    const cmp = aVal.localeCompare(bVal, undefined, { sensitivity: "base" });
    return sortDirection === "asc" ? cmp : -cmp;
  });
}

// ── ServicePlansWorkspaceTab ──────────────────────────────────────────────────

/**
 * Table-only workspace tab for the canonical Service Plans workspace.
 * Header shell (title, search, KPI, filters) is owned by ServicePlansPage
 * so all four sections can share one elevated card.
 */

interface ServicePlansWorkspaceTabProps {
  activeView: ServicePlanView;
  searchQuery: string;
  sortField?: string;
  sortDirection?: "asc" | "desc";
  onSort: (key: string) => void;
  selectedPlanId: string | null;
  onRailContextChange: (ctx: ServicePlanSelectionContext | null) => void;
}

export function ServicePlansWorkspaceTab({
  activeView,
  searchQuery,
  sortField,
  sortDirection,
  onSort,
  selectedPlanId,
  onRailContextChange,
}: ServicePlansWorkspaceTabProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Reset pagination when the active view changes.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [activeView]);

  // Plan list query — shared key with ServicePlanKpiStrip (React Query deduplicates).
  const { data: rawPlans = [], isLoading, error } = useQuery<RecurringPlanItem[]>({
    queryKey: ["/api/recurring-templates"],
    queryFn: async () => {
      const res = await fetch("/api/recurring-templates", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load service plans");
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  // Client-side filter + sort.
  const filteredPlans = useMemo(() => {
    const byView = applyViewPredicate(rawPlans, activeView);
    const searched = applyPlanSearch(byView, searchQuery);
    return sortPlans(searched, sortField, sortDirection);
  }, [rawPlans, activeView, searchQuery, sortField, sortDirection]);

  // Debounced selection → rail.
  const { handleSelectionChange } = useWorkspaceSelection<ServicePlanSelectionContext>(
    (ctx) => onRailContextChange(ctx),
  );

  const handleRowClick = (plan: RecurringPlanItem) => {
    if (selectedPlanId === plan.id) {
      onRailContextChange(null);
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

  const visiblePlans = filteredPlans.slice(0, visibleCount);

  return (
    <div
      className="h-full flex flex-col min-h-0 overflow-hidden"
      data-testid="service-plans-workspace-tab"
    >
      <WorkspaceListCard>
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
              selectedPlanId={selectedPlanId}
              onRowClick={handleRowClick}
              sortField={sortField}
              sortDirection={sortDirection}
              onSort={onSort}
            />
          </WorkspaceEntitySurface>
        </WorkspaceCenterPane>
      </WorkspaceListCard>
    </div>
  );
}
