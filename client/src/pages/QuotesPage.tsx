import { useState, useCallback } from "react";
import { Link, useSearch, useLocation } from "wouter";
import { FileText, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OperationalWorkspace } from "@/components/workspace/OperationalWorkspace";
import { OperationalWorkspaceHeader } from "@/components/workspace/OperationalWorkspaceHeader";
import { WorkspaceListCard } from "@/components/workspace/WorkspaceListCard";
import {
  WorkspaceFilterBar,
  WorkspaceViewChip,
  WorkspaceFilterBarSeparator,
  WorkspaceViewMoreDropdown,
  WorkspaceViewDropdownItem,
} from "@/components/workspace/WorkspaceFilterBar";
import {
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { useWorkspaceState } from "@/hooks/useWorkspaceState";
import { cn } from "@/lib/utils";
import {
  VALID_VIEWS,
  SECONDARY_VIEWS,
  QUOTE_STATUS_FILTERS,
  readQuoteViewFromSearch,
  filterLabel,
} from "@/lib/quoteWorkspaceConfig";
import type { QuoteView, QuoteStatusFilter, QuoteViewCounts } from "@/lib/quoteWorkspaceConfig";
import { QuotesWorkspaceTab } from "./quotes/QuotesWorkspaceTab";
import { QuoteRailBody } from "./quotes/QuoteRailBody";
import { QuoteKpiStrip } from "./quotes/QuoteKpiStrip";
import type { SelectedQuoteContext } from "./quotes/QuoteActionsRail";

// ── QuotesPage ────────────────────────────────────────────────────────────────

export default function QuotesPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const activeView = readQuoteViewFromSearch(search);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<QuoteStatusFilter>("all");
  const [selectedContext, setSelectedContext] = useState<SelectedQuoteContext | null>(null);
  const railExpanded = selectedContext !== null;

  const ws = useWorkspaceState({
    lsKey: "syntraro.quotes",
    validViews: VALID_VIEWS,
    defaultView: "all",
    onNavigate: (view) => {
      const params = new URLSearchParams(search);
      if (view === "all") params.delete("view");
      else params.set("view", view);
      setLocation(`/quotes?${params}`);
    },
    onViewChange: () => {
      setSelectedContext(null);
    },
  });

  const handleViewChange = (view: QuoteView) => ws.setView(view);

  const handleRailContextChange = useCallback((ctx: SelectedQuoteContext | null) => {
    setSelectedContext(ctx);
  }, []);

  const { data: viewCounts } = useQuery<QuoteViewCounts | null>({
    queryKey: ["quotes", "views", "counts"],
    queryFn: async () => {
      const res = await fetch("/api/quotes/views/counts", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load quote counts: ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: false,
  });

  const secondaryActive = SECONDARY_VIEWS.includes(activeView);

  // ── Center content ────────────────────────────────────────────────────────

  const centerContent = (
    <>
      <OperationalWorkspaceHeader
        icon={FileText}
        iconColor="text-emerald-600"
        iconBg="bg-emerald-50"
        title="Quotes"
        subtitle="Manage and track all your quotes."
        search={
          <div className="relative">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
              aria-hidden="true"
            />
            <Input
              placeholder="Search quotes…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 w-52 h-8 rounded-lg border-slate-200 bg-white text-sm"
              data-testid="input-search-quotes-toolbar"
            />
          </div>
        }
        primaryAction={
          <Link href="/quotes/new">
            <Button
              type="button"
              size="sm"
              className="rounded-lg px-3.5"
              data-testid="button-new-quote"
            >
              New Quote
            </Button>
          </Link>
        }
        kpis={<QuoteKpiStrip />}
      />

      {/* Filter bar — between header shell and table */}
      <div className="shrink-0 px-4 py-2">
        <WorkspaceFilterBar
          variant="flat"
          data-testid="quote-filter-bar"
        >
          <WorkspaceViewChip
            size="md"
            active={activeView === "all"}
            onClick={() => handleViewChange("all")}
            count={viewCounts?.all}
            data-testid="quote-view-all"
          >
            All
          </WorkspaceViewChip>
          <WorkspaceViewChip
            size="md"
            active={activeView === "draft"}
            onClick={() => handleViewChange("draft")}
            count={viewCounts?.draft}
            data-testid="quote-view-draft"
          >
            Draft
          </WorkspaceViewChip>
          <WorkspaceViewChip
            size="md"
            active={activeView === "sent"}
            onClick={() => handleViewChange("sent")}
            count={viewCounts?.sent}
            data-testid="quote-view-sent"
          >
            Sent
          </WorkspaceViewChip>
          <WorkspaceViewChip
            size="md"
            active={activeView === "awaiting-approval"}
            onClick={() => handleViewChange("awaiting-approval")}
            count={viewCounts?.awaitingApproval}
            data-testid="quote-view-awaiting-approval"
          >
            Awaiting Approval
          </WorkspaceViewChip>
          <WorkspaceViewChip
            size="md"
            active={activeView === "approved"}
            onClick={() => handleViewChange("approved")}
            count={viewCounts?.approved}
            data-testid="quote-view-approved"
          >
            Approved
          </WorkspaceViewChip>

          <WorkspaceFilterBarSeparator />

          <WorkspaceViewMoreDropdown
            size="md"
            label="Filters"
            activeInDropdown={secondaryActive || statusFilter !== "all"}
          >
            <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground px-2 py-1">
              Status
            </DropdownMenuLabel>
            {QUOTE_STATUS_FILTERS.map((f) => (
              <WorkspaceViewDropdownItem
                key={f}
                active={statusFilter === f}
                onClick={() => setStatusFilter(f)}
              >
                {filterLabel(f)}
              </WorkspaceViewDropdownItem>
            ))}

            <DropdownMenuSeparator />

            <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground px-2 py-1">
              Views
            </DropdownMenuLabel>
            <WorkspaceViewDropdownItem
              active={activeView === "expiring-soon"}
              onClick={() => handleViewChange("expiring-soon")}
              count={viewCounts?.expiringSoon}
            >
              Expiring Soon
            </WorkspaceViewDropdownItem>
            <WorkspaceViewDropdownItem
              active={activeView === "needs-assessment"}
              onClick={() => handleViewChange("needs-assessment")}
              count={viewCounts?.needsAssessment}
            >
              Needs Assessment
            </WorkspaceViewDropdownItem>
            <WorkspaceViewDropdownItem
              active={activeView === "assessment-scheduled"}
              onClick={() => handleViewChange("assessment-scheduled")}
              count={viewCounts?.assessmentScheduled}
            >
              Assessment Scheduled
            </WorkspaceViewDropdownItem>
            <WorkspaceViewDropdownItem
              active={activeView === "expired"}
              onClick={() => handleViewChange("expired")}
              count={viewCounts?.expired}
            >
              Expired
            </WorkspaceViewDropdownItem>
            <WorkspaceViewDropdownItem
              active={activeView === "declined"}
              onClick={() => handleViewChange("declined")}
              count={viewCounts?.declined}
            >
              Declined
            </WorkspaceViewDropdownItem>
            <WorkspaceViewDropdownItem
              active={activeView === "converted"}
              onClick={() => handleViewChange("converted")}
              count={viewCounts?.converted}
            >
              Converted
            </WorkspaceViewDropdownItem>
          </WorkspaceViewMoreDropdown>
        </WorkspaceFilterBar>
      </div>

      <WorkspaceListCard>
        <QuotesWorkspaceTab
          activeView={activeView}
          searchQuery={searchQuery}
          statusFilter={statusFilter}
          onRailContextChange={handleRailContextChange}
        />
      </WorkspaceListCard>
    </>
  );

  return (
    <div className="h-full bg-app-bg overflow-hidden" data-testid="quotes-page">
      <OperationalWorkspace
        center={centerContent}
        centerClassName="overflow-x-auto overflow-y-hidden"
        rightRailExpanded={railExpanded}
        rightRail={
          selectedContext
            ? <QuoteRailBody context={selectedContext} />
            : <></>
        }
        rightCollapsedWidth={0}
        rightExpandedWidth={380}
        rightRailClassName={cn(
          railExpanded && "border-l border-border shadow-[-8px_0_18px_rgba(15,23,42,0.06)]",
        )}
        showRailDivider={false}
        rightRailTestId="quote-workspace-rail"
        data-testid="quotes-workspace"
      />
    </div>
  );
}
