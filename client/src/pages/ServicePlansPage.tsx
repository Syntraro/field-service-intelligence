import { useState, useCallback } from "react";
import { useSearch, useLocation } from "wouter";
import { CalendarCheck, ChevronDown, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { OperationalWorkspace } from "@/components/workspace/OperationalWorkspace";
import { OperationalWorkspaceHeader } from "@/components/workspace/OperationalWorkspaceHeader";
import {
  WorkspaceFilterBar,
  WorkspaceViewChip,
  WorkspaceFilterBarSeparator,
  WorkspaceViewMoreDropdown,
  WorkspaceViewDropdownItem,
} from "@/components/workspace/WorkspaceFilterBar";
import { useWorkspaceState } from "@/hooks/useWorkspaceState";
import { cn } from "@/lib/utils";
import {
  VALID_VIEWS,
  MORE_VIEWS,
  TYPE_VIEWS,
  ATTENTION_VIEWS,
  readViewFromSearch,
  type ServicePlanView,
} from "@/lib/servicePlanWorkspaceConfig";
import { ServicePlansWorkspaceTab } from "./service-plans/ServicePlansWorkspaceTab";
import { ServicePlanTemplatesTab } from "./service-plans/ServicePlanTemplatesTab";
import { ServicePlanKpiStrip } from "./service-plans/ServicePlanKpiStrip";
import { ServicePlanRailBody } from "./service-plans/ServicePlanRailBody";
import type { ServicePlanSelectionContext } from "./service-plans/ServicePlanListPanel";
import CreateMaintenancePlanDialog from "@/components/pm/CreateMaintenancePlanDialog";
import { QuickAddJobDialog } from "@/components/QuickAddJobDialog";

// ── ServicePlansPage ──────────────────────────────────────────────────────────

export default function ServicePlansPage() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const activeView = readViewFromSearch(search);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedContext, setSelectedContext] = useState<ServicePlanSelectionContext | null>(null);
  // Templates view is a setup surface — no plan selection or right rail.
  const isTemplatesView = activeView === "templates";
  const railExpanded = selectedContext !== null && !isTemplatesView;

  const [createPmDialogOpen, setCreatePmDialogOpen] = useState(false);
  const [quickAddJobOpen, setQuickAddJobOpen] = useState(false);

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
    onViewChange: () => {
      setSelectedContext(null);
    },
  });

  const handleViewChange = (view: ServicePlanView) => ws.setView(view);

  const handleRailContextChange = useCallback((ctx: ServicePlanSelectionContext | null) => {
    setSelectedContext(ctx);
  }, []);

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

  const moreActive      = MORE_VIEWS.includes(activeView);
  const typeActive      = TYPE_VIEWS.includes(activeView);
  const attentionActive = ATTENTION_VIEWS.includes(activeView);

  // ── Center content ────────────────────────────────────────────────────────

  const centerContent = (
    <>
      <OperationalWorkspaceHeader
        icon={CalendarCheck}
        iconColor="text-emerald-600"
        iconBg="bg-emerald-50"
        title="Service Plans"
        subtitle="Manage preventive maintenance contracts and schedules."
        search={
          // Templates tab has its own internal search row; hide the header search.
          isTemplatesView ? undefined : (
            <div className="relative">
              <Search
                className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
                aria-hidden="true"
              />
              <Input
                placeholder="Search plans, clients, addresses…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 w-56 h-8 rounded-lg border-slate-200 bg-white text-sm"
                data-testid="input-search-service-plans"
              />
            </div>
          )
        }
        primaryAction={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="rounded-lg px-3.5 gap-1.5">
                <Plus className="h-4 w-4" />
                New Plan
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setCreatePmDialogOpen(true)}>
                Service Plan
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setQuickAddJobOpen(true)}>
                Recurring Job
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
        kpis={<ServicePlanKpiStrip />}
      />

      {/* Filter row — on app background, between header shell and table */}
      <div className="shrink-0 px-4 py-2">
        <WorkspaceFilterBar
          className="bg-transparent border-b-0 px-0 py-0 min-h-0"
          data-testid="service-plan-filter-bar"
        >
          <WorkspaceViewChip
            size="md"
            active={activeView === "all"}
            onClick={() => handleViewChange("all")}
            data-testid="service-plan-view-all"
          >
            All
          </WorkspaceViewChip>
          <WorkspaceViewChip
            size="md"
            active={activeView === "active"}
            onClick={() => handleViewChange("active")}
            data-testid="service-plan-view-active"
          >
            Active
          </WorkspaceViewChip>
          <WorkspaceViewChip
            size="md"
            active={activeView === "work_due"}
            onClick={() => handleViewChange("work_due")}
            data-testid="service-plan-view-work-due"
          >
            Work Due
          </WorkspaceViewChip>
          <WorkspaceViewChip
            size="md"
            active={activeView === "overdue"}
            onClick={() => handleViewChange("overdue")}
            data-testid="service-plan-view-overdue"
          >
            Overdue
          </WorkspaceViewChip>
          <WorkspaceViewChip
            size="md"
            active={activeView === "upcoming"}
            onClick={() => handleViewChange("upcoming")}
            data-testid="service-plan-view-upcoming"
          >
            Upcoming
          </WorkspaceViewChip>

          <WorkspaceFilterBarSeparator />

          <WorkspaceViewMoreDropdown
            size="md"
            label="More"
            activeInDropdown={moreActive}
          >
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
            <WorkspaceViewDropdownItem
              active={activeView === "templates"}
              onClick={() => handleViewChange("templates")}
              data-testid="service-plan-view-templates"
            >
              Templates
            </WorkspaceViewDropdownItem>
          </WorkspaceViewMoreDropdown>

          <WorkspaceViewMoreDropdown
            size="md"
            label="Type"
            activeInDropdown={typeActive}
          >
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

          <WorkspaceViewMoreDropdown
            size="md"
            label="Attention"
            activeInDropdown={attentionActive}
          >
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
      </div>

      {/* Content area — templates view renders its own table; all other views use the plan list. */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {isTemplatesView ? (
          <ServicePlanTemplatesTab />
        ) : (
          <ServicePlansWorkspaceTab
            activeView={activeView}
            searchQuery={searchQuery}
            sortField={ws.sort?.field}
            sortDirection={ws.sort?.direction}
            onSort={handleSort}
            selectedPlanId={selectedContext?.planId ?? null}
            onRailContextChange={handleRailContextChange}
          />
        )}
      </div>
    </>
  );

  return (
    <div className="h-full bg-app-bg overflow-hidden" data-testid="service-plans-page">
      <OperationalWorkspace
        center={centerContent}
        centerClassName="overflow-x-auto overflow-y-hidden"
        rightRailExpanded={railExpanded}
        rightRail={
          selectedContext
            ? <ServicePlanRailBody context={selectedContext} onDeleted={() => setSelectedContext(null)} />
            : <></>
        }
        rightCollapsedWidth={0}
        rightExpandedWidth={380}
        rightRailClassName={cn(
          railExpanded && "border-l border-border shadow-[-8px_0_18px_rgba(15,23,42,0.06)]",
        )}
        showRailDivider={false}
        rightRailTestId="service-plans-workspace-rail"
        data-testid="service-plans-workspace"
      />

      <CreateMaintenancePlanDialog
        open={createPmDialogOpen}
        onOpenChange={setCreatePmDialogOpen}
      />
      <QuickAddJobDialog
        open={quickAddJobOpen}
        onOpenChange={setQuickAddJobOpen}
      />
    </div>
  );
}
