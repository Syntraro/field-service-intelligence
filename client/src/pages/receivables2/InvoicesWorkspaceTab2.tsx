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
import { useWorkspaceSelection } from "@/hooks/useWorkspaceSelection";
import type { SelectedReceivablesContext } from "@/pages/receivables/InvoicesWorkspaceTab";

// Re-export types consumed by ReceivablesPage2.
export type { InvoiceView, InvoiceStatusFilter, InvoiceDateRange, SelectedReceivablesContext };

interface InvoicesWorkspaceTab2Props {
  activeView: InvoiceView;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  statusFilter: InvoiceStatusFilter;
  onStatusFilterChange: (f: InvoiceStatusFilter) => void;
  dateRange: InvoiceDateRange;
  onRailContextChange: (ctx: SelectedReceivablesContext | null) => void;
}

/**
 * Table-only workspace tab for Invoices 2.
 * Header shell (title, search, KPI, filters) is owned by ReceivablesPage2
 * so all four sections can share one elevated card.
 */
export function InvoicesWorkspaceTab2({
  activeView,
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  dateRange,
  onRailContextChange,
}: InvoicesWorkspaceTab2Props) {
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
      data-testid="invoices-workspace-tab-v2"
    >
      {/* Elevated table container */}
      <div className="flex-1 min-h-0 flex flex-col mx-4 mb-6 rounded-md overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.07),0_0_1px_rgba(0,0,0,0.05)]">
        <WorkspaceCenterPane>
          <WorkspaceEntitySurface data-testid="tab-content-invoices-v2">
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
      </div>
    </div>
  );
}
