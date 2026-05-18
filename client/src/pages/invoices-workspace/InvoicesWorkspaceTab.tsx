import { useCallback } from "react";
import {
  InvoiceListPanel,
  type InvoiceView,
  type InvoiceStatusFilter,
  type InvoiceDateRange,
  type SelectionContext,
} from "@/components/invoices/InvoiceListPanel";
import { WorkspaceCenterPane } from "@/components/workspace/WorkspaceCenterPane";
import { WorkspaceEntitySurface } from "@/components/workspace/WorkspaceEntitySurface";
import { WorkspaceListCard } from "@/components/workspace/WorkspaceListCard";
import { useWorkspaceSelection } from "@/hooks/useWorkspaceSelection";
import type { SelectedReceivablesContext } from "@/pages/receivables/InvoiceRailBody";

// Re-export types consumed by InvoicesPage.
export type { InvoiceView, InvoiceStatusFilter, InvoiceDateRange, SelectedReceivablesContext };

interface InvoicesWorkspaceTabProps {
  activeView: InvoiceView;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  statusFilter: InvoiceStatusFilter;
  onStatusFilterChange: (f: InvoiceStatusFilter) => void;
  dateRange: InvoiceDateRange;
  onRailContextChange: (ctx: SelectedReceivablesContext | null) => void;
}

/**
 * Table-only workspace tab for the canonical Invoices workspace.
 * Header shell (title, search, KPI, filters) is owned by InvoicesPage
 * so all four sections can share one elevated card.
 */
export function InvoicesWorkspaceTab({
  activeView,
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  dateRange,
  onRailContextChange,
}: InvoicesWorkspaceTabProps) {
  const { handleSelectionChange } = useWorkspaceSelection<SelectedReceivablesContext>(
    (ctx) => { onRailContextChange(ctx); },
  );

  const handleListSelectionChange = useCallback((ctx: SelectionContext) => {
    const isEmpty = ctx.selectedInvoiceIds.length === 0;
    if (isEmpty) {
      onRailContextChange(null);
      return;
    }
    handleSelectionChange(
      {
        customerCompanyId: ctx.customerCompanyId,
        selectedInvoiceIds: ctx.selectedInvoiceIds,
        followUpAt: ctx.followUpAt,
        invoiceNumber: ctx.invoiceNumber,
        clientName: ctx.clientName,
        dueDate: ctx.dueDate,
        balance: ctx.balance,
        locationId: ctx.locationId,
      },
      false,
    );
  }, [handleSelectionChange, onRailContextChange]);

  return (
    <div
      className="h-full flex flex-col min-h-0 overflow-hidden"
      data-testid="invoices-workspace-tab"
    >
      <WorkspaceListCard>
        <WorkspaceCenterPane>
          <WorkspaceEntitySurface data-testid="tab-content-invoices">
            <InvoiceListPanel
              activeView={activeView}
              onSelectionChange={handleListSelectionChange}
              receivablesMode
              externalSearchQuery={searchQuery}
              onExternalSearchChange={onSearchChange}
              externalActiveFilter={statusFilter}
              onExternalActiveFilterChange={onStatusFilterChange}
              externalDateRange={dateRange}
            />
          </WorkspaceEntitySurface>
        </WorkspaceCenterPane>
      </WorkspaceListCard>
    </div>
  );
}
