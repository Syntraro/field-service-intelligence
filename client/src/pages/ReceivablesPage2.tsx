import { useState, useCallback } from "react";
import { Link, useSearch, useLocation } from "wouter";
import { Download, Search, Inbox } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WorkspaceRightRail } from "@/components/workspace/WorkspaceRightRail";
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
import { useToast } from "@/hooks/use-toast";
import { useWorkspaceState } from "@/hooks/useWorkspaceState";
import { cn } from "@/lib/utils";
import {
  InvoicesWorkspaceTab2,
  type InvoiceView,
  type InvoiceStatusFilter,
  type InvoiceDateRange,
  type SelectedReceivablesContext,
} from "./receivables2/InvoicesWorkspaceTab2";
import { InvoiceKpiStrip2 } from "./receivables2/InvoiceKpiStrip2";
import { InvoiceRailBody } from "./receivables/InvoiceRailBody";
import type { ViewCounts } from "./receivables/InvoiceViewRail";

// ── Constants (mirrored from InvoicesWorkspaceTab) ────────────────────────────

const VALID_VIEWS: readonly InvoiceView[] = [
  "all", "overdue", "awaiting-payment", "drafts", "paid",
  "needs-follow-up", "sent-this-week", "no-recent-contact",
  "high-balance", "disputed", "promised-payment",
];

const SECONDARY_VIEWS: InvoiceView[] = [
  "no-recent-contact", "sent-this-week", "high-balance", "drafts", "paid",
];

const FILTER_TO_VIEW: Record<string, InvoiceView> = {
  overdue:          "overdue",
  draft:            "drafts",
  awaiting_payment: "awaiting-payment",
  paid:             "paid",
};

const INVOICE_STATUS_FILTERS: InvoiceStatusFilter[] = [
  "all", "draft", "awaiting_payment", "partial_paid", "paid", "overdue", "voided",
];

function readViewFromSearch(search: string): InvoiceView {
  const params = new URLSearchParams(search);
  const view = params.get("view");
  if (view && (VALID_VIEWS as readonly string[]).includes(view)) return view as InvoiceView;
  const filter = params.get("filter");
  if (filter && FILTER_TO_VIEW[filter]) return FILTER_TO_VIEW[filter];
  return "all";
}

function filterLabel(f: InvoiceStatusFilter): string {
  if (f === "all") return "All";
  if (f === "awaiting_payment") return "Unpaid";
  if (f === "partial_paid") return "Partial";
  if (f === "overdue") return "Overdue";
  return f.charAt(0).toUpperCase() + f.slice(1);
}

// ── ReceivablesPage2 ──────────────────────────────────────────────────────────

export default function ReceivablesPage2() {
  const { toast } = useToast();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const activeView = readViewFromSearch(search);

  const [isExporting, setIsExporting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<InvoiceStatusFilter>("all");
  const [dateRange, setDateRange] = useState<InvoiceDateRange>({ preset: null, start: null, end: null });
  const [selectedContext, setSelectedContext] = useState<SelectedReceivablesContext | null>(null);
  const railExpanded = selectedContext !== null;

  // Workspace state — different lsKey + navigates to /invoices-v2 instead of /receivables.
  const ws = useWorkspaceState({
    lsKey: "syntraro.invoices2",
    validViews: VALID_VIEWS,
    defaultView: "all",
    onNavigate: (view) => {
      const params = new URLSearchParams(search);
      if (view === "all") params.delete("view");
      else params.set("view", view);
      setLocation(`/invoices-v2?${params}`);
    },
    onViewChange: () => {
      setSelectedContext(null);
    },
  });

  const handleViewChange = (view: InvoiceView) => ws.setView(view);

  const handleRailContextChange = useCallback((ctx: SelectedReceivablesContext | null) => {
    setSelectedContext(ctx);
  }, []);

  // View counts (same query key as original — shares the cache).
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

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const res = await fetch("/api/receivables/invoices?view=all&limit=5000", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load invoices for export");
      const json = await res.json();
      const items: Array<{
        invoiceNumber?: string | null;
        locationDisplayName?: string | null;
        customerCompanyName?: string | null;
        locationName?: string | null;
        status?: string | null;
        issueDate?: string | null;
        dueDate?: string | null;
        total?: string | null;
        balance?: string | null;
        workDescription?: string | null;
      }> = json.data ?? [];

      const headers = ["Invoice #", "Client", "Location", "Status", "Issue Date", "Due Date", "Total", "Balance Due", "Description"];
      const rows = items.map((inv) => [
        inv.invoiceNumber ?? "",
        inv.locationDisplayName ?? inv.customerCompanyName ?? "",
        inv.locationName ?? "",
        inv.status ?? "",
        inv.issueDate ?? "",
        inv.dueDate ?? "",
        inv.total ?? "",
        inv.balance ?? "",
        inv.workDescription ?? "",
      ]);

      const csv = [headers, ...rows]
        .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
        .join("\n");

      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `invoices-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: `Exported ${items.length} invoice${items.length !== 1 ? "s" : ""}` });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Export failed";
      toast({ title: "Export failed", description: message, variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="h-full bg-app-bg flex overflow-hidden" data-testid="receivables-page-v2">

      {/* ── Left column ── */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0 overflow-x-auto overflow-y-hidden">

        {/* ── Unified operational header shell ── */}
        <div className="shrink-0 px-4 pt-5 pb-3">
          <div className="bg-white rounded-md border border-slate-100 shadow-[0_1px_8px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.03)] p-5">

            {/* Section 1: Title + utility actions */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {/* Icon badge */}
                <div className="h-10 w-10 shrink-0 rounded-xl bg-violet-50 flex items-center justify-center">
                  <Inbox className="h-5 w-5 text-violet-600" aria-hidden="true" />
                </div>
                <div>
                  <h1 className="text-title text-slate-900">
                    Invoices
                  </h1>
                  <p className="text-helper text-muted-foreground mt-0.5">
                    Manage and track all your invoices.
                  </p>
                </div>
              </div>

              {/* Utility actions */}
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
                    aria-hidden="true"
                  />
                  <Input
                    placeholder="Search invoices…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 w-52 h-8 rounded-lg border-slate-200 bg-white text-sm"
                    data-testid="input-search-invoices-v2"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2 rounded-lg px-3.5"
                  onClick={handleExport}
                  disabled={isExporting}
                >
                  <Download className="h-4 w-4" />
                  {isExporting ? "Exporting…" : "Export"}
                </Button>
                {/* Subtle divider before primary action */}
                <div className="h-5 w-px bg-slate-200 mx-0.5" aria-hidden="true" />
                <Link href="/invoices/new">
                  <Button
                    type="button"
                    size="sm"
                    className="rounded-lg px-3.5"
                    data-testid="button-new-invoice-v2"
                  >
                    New Invoice
                  </Button>
                </Link>
              </div>
            </div>

            {/* Section 2: KPI row — 16px gap */}
            <div className="mt-4">
              <InvoiceKpiStrip2 />
            </div>

          </div>
        </div>

        {/* ── Filter row — on app background, between header shell and table ── */}
        <div className="shrink-0 px-4 py-2">
          <WorkspaceFilterBar
            className="bg-transparent border-b-0 px-0 py-0 min-h-0"
            data-testid="invoice-filter-bar-v2"
          >
            <WorkspaceViewChip
              size="md"
              active={activeView === "all"}
              onClick={() => handleViewChange("all")}
              count={viewCounts?.all}
              data-testid="inv2-view-all"
            >
              All
            </WorkspaceViewChip>
            <WorkspaceViewChip
              size="md"
              active={activeView === "needs-follow-up"}
              onClick={() => handleViewChange("needs-follow-up")}
              count={viewCounts?.needsFollowUp}
              data-testid="inv2-view-needs-follow-up"
            >
              Needs Follow-up
            </WorkspaceViewChip>
            <WorkspaceViewChip
              size="md"
              active={activeView === "overdue"}
              onClick={() => handleViewChange("overdue")}
              count={viewCounts?.overdue}
              data-testid="inv2-view-overdue"
            >
              Overdue
            </WorkspaceViewChip>
            <WorkspaceViewChip
              size="md"
              active={activeView === "awaiting-payment"}
              onClick={() => handleViewChange("awaiting-payment")}
              count={viewCounts?.awaitingPayment}
              data-testid="inv2-view-awaiting-payment"
            >
              Awaiting Payment
            </WorkspaceViewChip>
            <WorkspaceViewChip
              size="md"
              active={activeView === "promised-payment"}
              onClick={() => handleViewChange("promised-payment")}
              count={viewCounts?.promisedPayment}
              data-testid="inv2-view-promised-payment"
            >
              Promised
            </WorkspaceViewChip>
            <WorkspaceViewChip
              size="md"
              active={activeView === "disputed"}
              onClick={() => handleViewChange("disputed")}
              count={viewCounts?.disputed}
              data-testid="inv2-view-disputed"
            >
              Disputed
            </WorkspaceViewChip>

            <WorkspaceFilterBarSeparator />

            <DateRangeButton
              size="md"
              value={dateRange}
              onChange={setDateRange}
            />

            <WorkspaceViewMoreDropdown
              size="md"
              label="Filters"
              activeInDropdown={secondaryActive || statusFilter !== "all"}
            >
              <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground px-2 py-1">
                Status
              </DropdownMenuLabel>
              {INVOICE_STATUS_FILTERS.map((f) => (
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
        </div>

        {/* ── Table content ── */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <InvoicesWorkspaceTab2
            activeView={activeView}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            dateRange={dateRange}
            onRailContextChange={handleRailContextChange}
          />
        </div>
      </div>

      {/* ── Right rail — untouched, identical to ReceivablesPage ── */}
      <WorkspaceRightRail
        expanded={railExpanded}
        collapsedWidth={0}
        expandedWidth={380}
        className={cn(
          railExpanded && "border-l border-border shadow-[-8px_0_18px_rgba(15,23,42,0.06)]",
        )}
        data-testid="invoice-workspace-rail-v2"
      >
        {selectedContext && (
          <InvoiceRailBody context={selectedContext} activeView={activeView} />
        )}
      </WorkspaceRightRail>
    </div>
  );
}
