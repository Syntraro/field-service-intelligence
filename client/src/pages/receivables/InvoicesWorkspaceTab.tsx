import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { InvoiceListPanel, type InvoiceView, type InvoiceStatusFilter, type SelectionContext } from "@/components/invoices/InvoiceListPanel";
import { InvoiceViewRail, type ViewCounts } from "./InvoiceViewRail";
import { ReceivablesActionsRail } from "./ReceivablesActionsRail";

// ── Types ─────────────────────────────────────────────────────────────────────

export type { InvoiceView, InvoiceStatusFilter };

export type SelectedReceivablesContext = {
  customerCompanyId: string | null;
  selectedInvoiceIds: string[];
  selectedPaymentId?: string | null;
  /** followUpAt from the sole selected invoice; forwarded to SetFollowUpDialog so it
   *  opens pre-populated with the existing value instead of blank. */
  followUpAt?: string | null;
};

// ── URL helpers ───────────────────────────────────────────────────────────────

const VALID_VIEWS: InvoiceView[] = [
  "all", "overdue", "awaiting-payment", "drafts", "paid",
  "needs-follow-up", "sent-this-week", "no-recent-contact",
  "high-balance", "disputed", "promised-payment",
];

// Maps legacy ?filter= values (used by dashboard navigation links) to InvoiceView.
const FILTER_TO_VIEW: Record<string, InvoiceView> = {
  overdue:          "overdue",
  draft:            "drafts",
  awaiting_payment: "awaiting-payment",
  paid:             "paid",
};

export function readViewFromSearch(search: string): InvoiceView {
  const params = new URLSearchParams(search);
  const view = params.get("view");
  if (view && (VALID_VIEWS as string[]).includes(view)) return view as InvoiceView;
  // Legacy ?filter= alias — used by dashboard nav links (tab=invoices&filter=overdue).
  const filter = params.get("filter");
  if (filter && FILTER_TO_VIEW[filter]) return FILTER_TO_VIEW[filter];
  return "all";
}

// ── InvoicesWorkspaceTab ──────────────────────────────────────────────────────

interface InvoicesWorkspaceTabProps {
  externalSearchQuery?: string;
  onExternalSearchChange?: (q: string) => void;
  externalActiveFilter?: InvoiceStatusFilter;
  onExternalActiveFilterChange?: (f: InvoiceStatusFilter) => void;
}

export function InvoicesWorkspaceTab({
  externalSearchQuery,
  onExternalSearchChange,
  externalActiveFilter,
  onExternalActiveFilterChange,
}: InvoicesWorkspaceTabProps = {}) {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const activeView = readViewFromSearch(search);

  const [selectedContext, setSelectedContext] = useState<SelectedReceivablesContext | null>(null);

  // Fetch view counts once — used by InvoiceViewRail for badges.
  // On error, returns null so the rail still renders without badges.
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

  const handleViewChange = (view: InvoiceView) => {
    const params = new URLSearchParams(search);
    params.set("tab", "invoices");
    if (view === "all") params.delete("view");
    else params.set("view", view);
    setLocation(`/receivables?${params}`);
    // Clear selection when switching views.
    setSelectedContext(null);
  };

  const handleSelectionChange = (ctx: SelectionContext) => {
    if (ctx.selectedInvoiceIds.length === 0) {
      setSelectedContext(null);
    } else {
      setSelectedContext({
        customerCompanyId: ctx.customerCompanyId,
        selectedInvoiceIds: ctx.selectedInvoiceIds,
        followUpAt: ctx.followUpAt,
      });
    }
  };

  return (
    <div
      className="flex h-full min-h-0 divide-x divide-border"
      data-testid="invoices-workspace-tab"
    >
      {/* Left rail — invoice view navigation */}
      <div className="w-56 shrink-0 overflow-y-auto bg-white">
        <InvoiceViewRail
          activeView={activeView}
          onViewChange={handleViewChange}
          counts={viewCounts}
        />
      </div>

      {/* Center panel — invoice list; overflow handled inside InvoiceListPanel (flex-1 table wrapper) */}
      <div className="flex-1 min-w-0 overflow-hidden">
        <InvoiceListPanel
          activeView={activeView}
          onSelectionChange={handleSelectionChange}
          receivablesMode
          externalSearchQuery={externalSearchQuery}
          onExternalSearchChange={onExternalSearchChange}
          externalActiveFilter={externalActiveFilter}
          onExternalActiveFilterChange={onExternalActiveFilterChange}
        />
      </div>

      {/* Right rail — receivables actions */}
      <div className="w-72 shrink-0 bg-white">
        <ReceivablesActionsRail context={selectedContext} activeView={activeView} />
      </div>
    </div>
  );
}
