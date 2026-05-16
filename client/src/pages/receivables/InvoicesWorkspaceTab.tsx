import { useCallback } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  InvoiceListPanel,
  type InvoiceView,
  type InvoiceStatusFilter,
  type InvoiceDateRange,
  type SelectionContext,
} from "@/components/invoices/InvoiceListPanel";
import { type ViewCounts } from "./InvoiceViewRail";
import { WorkspaceCenterPane } from "@/components/workspace/WorkspaceCenterPane";
import { WorkspaceEntitySurface } from "@/components/workspace/WorkspaceEntitySurface";
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
import { DateRangeButton } from "@/components/filters/DateRangeButton";
import { useWorkspaceState } from "@/hooks/useWorkspaceState";
import { useWorkspaceSelection } from "@/hooks/useWorkspaceSelection";
import { InvoiceKpiStrip } from "./InvoiceKpiStrip";

// ── Types ─────────────────────────────────────────────────────────────────────

export type { InvoiceView, InvoiceStatusFilter };

export type SelectedReceivablesContext = {
  customerCompanyId: string | null;
  selectedInvoiceIds: string[];
  selectedPaymentId?: string | null;
  followUpAt?: string | null;
  invoiceNumber?: string | null;
  clientName?: string | null;
  dueDate?: string | null;
  balance?: string | null;
  locationId?: string | null;
};

// ── URL helpers ───────────────────────────────────────────────────────────────

const VALID_VIEWS: readonly InvoiceView[] = [
  "all", "overdue", "awaiting-payment", "drafts", "paid",
  "needs-follow-up", "sent-this-week", "no-recent-contact",
  "high-balance", "disputed", "promised-payment",
];

const FILTER_TO_VIEW: Record<string, InvoiceView> = {
  overdue:          "overdue",
  draft:            "drafts",
  awaiting_payment: "awaiting-payment",
  paid:             "paid",
};

export function readViewFromSearch(search: string): InvoiceView {
  const params = new URLSearchParams(search);
  const view = params.get("view");
  if (view && (VALID_VIEWS as readonly string[]).includes(view)) return view as InvoiceView;
  const filter = params.get("filter");
  if (filter && FILTER_TO_VIEW[filter]) return FILTER_TO_VIEW[filter];
  return "all";
}

// ── Secondary views (appear in Filters dropdown) ─────────────────────────────

const SECONDARY_VIEWS: InvoiceView[] = [
  "no-recent-contact", "sent-this-week", "high-balance", "drafts", "paid",
];

// ── Status filter options (merged into Filters dropdown) ──────────────────────

const INVOICE_STATUS_FILTERS: InvoiceStatusFilter[] = [
  "all", "draft", "awaiting_payment", "partial_paid", "paid", "overdue", "voided",
];

function filterLabel(f: InvoiceStatusFilter): string {
  if (f === "all") return "All";
  if (f === "awaiting_payment") return "Unpaid";
  if (f === "partial_paid") return "Partial";
  if (f === "overdue") return "Overdue";
  return f.charAt(0).toUpperCase() + f.slice(1);
}

// ── InvoicesWorkspaceTab ──────────────────────────────────────────────────────

interface InvoicesWorkspaceTabProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  statusFilter: InvoiceStatusFilter;
  onStatusFilterChange: (f: InvoiceStatusFilter) => void;
  dateRange: InvoiceDateRange;
  onDateRangeChange: (r: InvoiceDateRange) => void;
  /** Called when the user selects or deselects an invoice row. The parent
   *  (ReceivablesPage) owns the rail and renders it at the page level so
   *  it spans the full height of the white content area. */
  onRailContextChange: (ctx: SelectedReceivablesContext | null) => void;
}

export function InvoicesWorkspaceTab({
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  dateRange,
  onDateRangeChange,
  onRailContextChange,
}: InvoicesWorkspaceTabProps) {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const activeView = readViewFromSearch(search);

  // Workspace infrastructure — view routing + view change callbacks.
  const ws = useWorkspaceState({
    lsKey: "syntraro.invoices",
    validViews: VALID_VIEWS,
    defaultView: "all",
    onNavigate: (view) => {
      const params = new URLSearchParams(search);
      params.set("tab", "invoices");
      if (view === "all") params.delete("view");
      else params.set("view", view);
      setLocation(`/receivables?${params}`);
    },
    onViewChange: () => {
      onRailContextChange(null);
    },
  });

  const { handleSelectionChange } = useWorkspaceSelection<SelectedReceivablesContext>(
    (ctx) => {
      onRailContextChange(ctx);
    },
  );

  const handleViewChange = (view: InvoiceView) => {
    ws.setView(view);
  };

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

  const { data: viewCounts } = useQuery<ViewCounts | null>({
    queryKey: ["receivables", "views", "counts"],
    queryFn: async () => {
      const res = await fetch("/api/receivables/views/counts", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: false,
  });

  const secondaryActive = SECONDARY_VIEWS.includes(activeView);

  return (
    // Pure content column: KPI → filter bar → table.
    // Rail is owned by ReceivablesPage so it spans the full page height.
    <div className="h-full flex flex-col min-h-0 overflow-hidden" data-testid="invoices-workspace-tab">
      {/* KPI cards */}
      <div className="shrink-0 px-6 py-4">
        <InvoiceKpiStrip />
      </div>

      {/* Horizontal view/filter bar */}
      <WorkspaceFilterBar className="border-b-0 px-6 py-4" data-testid="invoice-filter-bar">
        <WorkspaceViewChip
          size="md"
          active={activeView === "all"}
          onClick={() => handleViewChange("all")}
          count={viewCounts?.all}
          data-testid="invoice-view-all"
        >
          All
        </WorkspaceViewChip>
        <WorkspaceViewChip
          size="md"
          active={activeView === "needs-follow-up"}
          onClick={() => handleViewChange("needs-follow-up")}
          count={viewCounts?.needsFollowUp}
          data-testid="invoice-view-needs-follow-up"
        >
          Needs Follow-up
        </WorkspaceViewChip>
        <WorkspaceViewChip
          size="md"
          active={activeView === "overdue"}
          onClick={() => handleViewChange("overdue")}
          count={viewCounts?.overdue}
          data-testid="invoice-view-overdue"
        >
          Overdue
        </WorkspaceViewChip>
        <WorkspaceViewChip
          size="md"
          active={activeView === "awaiting-payment"}
          onClick={() => handleViewChange("awaiting-payment")}
          count={viewCounts?.awaitingPayment}
          data-testid="invoice-view-awaiting-payment"
        >
          Awaiting Payment
        </WorkspaceViewChip>
        <WorkspaceViewChip
          size="md"
          active={activeView === "promised-payment"}
          onClick={() => handleViewChange("promised-payment")}
          count={viewCounts?.promisedPayment}
          data-testid="invoice-view-promised-payment"
        >
          Promised
        </WorkspaceViewChip>
        <WorkspaceViewChip
          size="md"
          active={activeView === "disputed"}
          onClick={() => handleViewChange("disputed")}
          count={viewCounts?.disputed}
          data-testid="invoice-view-disputed"
        >
          Disputed
        </WorkspaceViewChip>

        <WorkspaceFilterBarSeparator />

        <DateRangeButton
          size="md"
          value={dateRange}
          onChange={onDateRangeChange}
        />

        <WorkspaceViewMoreDropdown
          size="md"
          label="Filters"
          activeInDropdown={secondaryActive || statusFilter !== "all"}
        >
          {/* Status filter section */}
          <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground px-2 py-1">
            Status
          </DropdownMenuLabel>
          {INVOICE_STATUS_FILTERS.map((f) => (
            <WorkspaceViewDropdownItem
              key={f}
              active={statusFilter === f}
              onClick={() => onStatusFilterChange(f)}
            >
              {filterLabel(f)}
            </WorkspaceViewDropdownItem>
          ))}

          <DropdownMenuSeparator />

          {/* Secondary views section */}
          <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground px-2 py-1">
            Views
          </DropdownMenuLabel>
          <WorkspaceViewDropdownItem
            active={activeView === "no-recent-contact"}
            onClick={() => handleViewChange("no-recent-contact")}
            count={viewCounts?.noRecentContact}
          >
            No Recent Contact
          </WorkspaceViewDropdownItem>
          <WorkspaceViewDropdownItem
            active={activeView === "sent-this-week"}
            onClick={() => handleViewChange("sent-this-week")}
            count={viewCounts?.sentThisWeek}
          >
            Sent This Week
          </WorkspaceViewDropdownItem>
          <WorkspaceViewDropdownItem
            active={activeView === "high-balance"}
            onClick={() => handleViewChange("high-balance")}
            count={viewCounts?.highBalance}
          >
            High Balance
          </WorkspaceViewDropdownItem>
          <WorkspaceViewDropdownItem
            active={activeView === "drafts"}
            onClick={() => handleViewChange("drafts")}
            count={viewCounts?.drafts}
          >
            Drafts
          </WorkspaceViewDropdownItem>
          <WorkspaceViewDropdownItem
            active={activeView === "paid"}
            onClick={() => handleViewChange("paid")}
            count={viewCounts?.paid}
          >
            Paid
          </WorkspaceViewDropdownItem>
        </WorkspaceViewMoreDropdown>
      </WorkspaceFilterBar>

      {/* Invoice table */}
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
    </div>
  );
}
