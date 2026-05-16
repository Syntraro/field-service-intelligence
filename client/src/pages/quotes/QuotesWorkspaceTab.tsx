import { useState } from "react";
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
import { type QuoteView, type QuoteViewCounts } from "./QuoteViewRail";
import { QuoteActionsRail, type SelectedQuoteContext } from "./QuoteActionsRail";
import { QuoteListPanel, type QuoteSelectionContext } from "./QuoteListPanel";

// ── Types ─────────────────────────────────────────────────────────────────────

export type QuoteStatusFilter = "all" | "draft" | "sent" | "approved" | "declined" | "expired" | "converted";

// ── URL helpers ───────────────────────────────────────────────────────────────

const VALID_VIEWS: readonly QuoteView[] = [
  "all", "draft", "sent", "awaiting-approval", "expiring-soon",
  "approved", "expired", "declined", "converted",
  "needs-assessment", "assessment-scheduled",
];

export function readQuoteViewFromSearch(search: string): QuoteView {
  const params = new URLSearchParams(search);
  const view = params.get("view");
  if (view && (VALID_VIEWS as readonly string[]).includes(view)) return view as QuoteView;
  return "all";
}

// ── QuotesWorkspaceTab ────────────────────────────────────────────────────────

interface QuotesWorkspaceTabProps {
  searchQuery: string;
  onSearchChange?: (q: string) => void;
  statusFilter: QuoteStatusFilter;
  onStatusFilterChange?: (f: QuoteStatusFilter) => void;
}

export function QuotesWorkspaceTab({
  searchQuery,
  statusFilter,
}: QuotesWorkspaceTabProps) {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const activeView = readQuoteViewFromSearch(search);

  const [selectedContext, setSelectedContext] = useState<SelectedQuoteContext | null>(null);
  const [railExpanded, setRailExpanded] = useState(false);

  // Workspace infrastructure — rail collapse + view routing only.
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
  });

  const { handleSelectionChange } = useWorkspaceSelection<SelectedQuoteContext>((ctx) => {
    setSelectedContext(ctx);
    setRailExpanded(ctx !== null);
  });

  const handleViewChange = (view: QuoteView) => {
    ws.setView(view);
    setSelectedContext(null);
    setRailExpanded(false);
  };

  const handleListSelectionChange = (ctx: QuoteSelectionContext | null) => {
    if (!ctx) {
      setSelectedContext(null);
      setRailExpanded(false);
      return;
    }
    handleSelectionChange({ quoteId: ctx.quoteId }, false);
  };

  const { data: viewCounts } = useQuery<QuoteViewCounts | null>({
    queryKey: ["quotes", "views", "counts"],
    queryFn: async () => {
      const res = await fetch("/api/quotes/views/counts", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: false,
  });

  const SECONDARY_VIEWS: QuoteView[] = [
    "expiring-soon", "needs-assessment", "assessment-scheduled", "expired", "declined", "converted",
  ];
  const secondaryActive = SECONDARY_VIEWS.includes(activeView);

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <WorkspaceFilterBar data-testid="quote-filter-bar">
        <WorkspaceViewChip
          active={activeView === "all"}
          onClick={() => handleViewChange("all")}
          count={viewCounts?.all}
          data-testid="quote-view-all"
        >
          All
        </WorkspaceViewChip>
        <WorkspaceViewChip
          active={activeView === "draft"}
          onClick={() => handleViewChange("draft")}
          count={viewCounts?.draft}
          data-testid="quote-view-draft"
        >
          Draft
        </WorkspaceViewChip>
        <WorkspaceViewChip
          active={activeView === "sent"}
          onClick={() => handleViewChange("sent")}
          count={viewCounts?.sent}
          data-testid="quote-view-sent"
        >
          Sent
        </WorkspaceViewChip>
        <WorkspaceViewChip
          active={activeView === "awaiting-approval"}
          onClick={() => handleViewChange("awaiting-approval")}
          count={viewCounts?.awaitingApproval}
          data-testid="quote-view-awaiting-approval"
        >
          Awaiting Approval
        </WorkspaceViewChip>
        <WorkspaceViewChip
          active={activeView === "approved"}
          onClick={() => handleViewChange("approved")}
          count={viewCounts?.approved}
          data-testid="quote-view-approved"
        >
          Approved
        </WorkspaceViewChip>

        <WorkspaceFilterBarSeparator />

        <WorkspaceViewMoreDropdown label="More" activeInDropdown={secondaryActive}>
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

      <OperationalWorkspace
        rightRailExpanded={railExpanded}
        center={
          <WorkspaceCenterPane>
            <WorkspaceEntitySurface data-testid="tab-content-quotes">
              <QuoteListPanel
                activeView={activeView}
                onSelectionChange={handleListSelectionChange}
                externalSearchQuery={searchQuery}
                externalActiveFilter={statusFilter !== "all" ? statusFilter : undefined}
              />
            </WorkspaceEntitySurface>
          </WorkspaceCenterPane>
        }
        rightRail={
          <QuoteActionsRail context={selectedContext} />
        }
        data-testid="quotes-workspace-tab"
      />
    </div>
  );
}
