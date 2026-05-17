import { useCallback } from "react";
import { WorkspaceCenterPane } from "@/components/workspace/WorkspaceCenterPane";
import { WorkspaceEntitySurface } from "@/components/workspace/WorkspaceEntitySurface";
import { QuoteListPanel, type QuoteSelectionContext } from "./QuoteListPanel";
import type { QuoteView, QuoteStatusFilter } from "@/lib/quoteWorkspaceConfig";
import type { SelectedQuoteContext } from "./QuoteActionsRail";

interface QuotesWorkspaceTabProps {
  activeView: QuoteView;
  searchQuery: string;
  statusFilter: QuoteStatusFilter;
  /** Called when the user selects or deselects a quote row. */
  onRailContextChange: (ctx: SelectedQuoteContext | null) => void;
}

/**
 * Quote list/table adapter.
 *
 * Owns only the center-pane content: WorkspaceCenterPane shell +
 * WorkspaceEntitySurface + QuoteListPanel.
 *
 * All page-level orchestration (shell, header, filter bar, right rail,
 * view routing, view counts) lives in QuotesPage.
 */
export function QuotesWorkspaceTab({
  activeView,
  searchQuery,
  statusFilter,
  onRailContextChange,
}: QuotesWorkspaceTabProps) {
  const handleListSelectionChange = useCallback(
    (ctx: QuoteSelectionContext | null) => {
      onRailContextChange(
        ctx
          ? {
              quoteId: ctx.quoteId,
              quoteNumber: ctx.quoteNumber,
              clientName: ctx.clientName,
              locationId: ctx.locationId,
              customerCompanyId: ctx.customerCompanyId,
              total: ctx.total,
              expiryDate: ctx.expiryDate,
              status: ctx.status,
            }
          : null,
      );
    },
    [onRailContextChange],
  );

  return (
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
  );
}
