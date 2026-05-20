import { useState, useCallback } from "react";
import { Link, useSearch, useLocation } from "wouter";
import { Download, Search, Inbox } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OperationalWorkspace } from "@/components/workspace/OperationalWorkspace";
import { OperationalWorkspaceHeader } from "@/components/workspace/OperationalWorkspaceHeader";
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
  VALID_VIEWS,
  SECONDARY_VIEWS,
  INVOICE_STATUS_FILTERS,
  readViewFromSearch,
  filterLabel,
} from "@/lib/invoiceWorkspaceConfig";
import {
  InvoicesWorkspaceTab,
  type InvoiceView,
  type InvoiceStatusFilter,
  type InvoiceDateRange,
  type SelectedReceivablesContext,
} from "./invoices-workspace/InvoicesWorkspaceTab";
import { InvoiceKpiStrip } from "./invoices-workspace/InvoiceKpiStrip";
import { InvoiceRailBody } from "./receivables/InvoiceRailBody";

// ── ViewCounts ────────────────────────────────────────────────────────────────

interface ViewCounts {
  all?: number;
  overdue?: number;
  awaitingPayment?: number;
  drafts?: number;
  paid?: number;
  needsFollowUp?: number;
  promisedPayment?: number;
  disputed?: number;
  sentThisWeek?: number;
  noRecentContact?: number;
  highBalance?: number;
}

// ── InvoicesPage ──────────────────────────────────────────────────────────────

export default function InvoicesPage() {
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

  const ws = useWorkspaceState({
    lsKey: "syntraro.invoices",
    validViews: VALID_VIEWS,
    defaultView: "all",
    onNavigate: (view) => {
      const params = new URLSearchParams(search);
      if (view === "all") params.delete("view");
      else params.set("view", view);
      setLocation(`/invoices?${params}`);
    },
    onViewChange: () => {
      setSelectedContext(null);
    },
  });

  const handleViewChange = (view: InvoiceView) => ws.setView(view);

  const handleRailContextChange = useCallback((ctx: SelectedReceivablesContext | null) => {
    setSelectedContext(ctx);
  }, []);

  const { data: viewCounts } = useQuery<ViewCounts | null>({
    queryKey: ["receivables", "views", "counts"],
    queryFn: async () => {
      const res = await fetch("/api/receivables/views/counts", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load invoice counts: ${res.status}`);
      return res.json();
    },
    staleTime: 120_000,
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

  // ── Center content ────────────────────────────────────────────────────────

  const centerContent = (
    <>
      <OperationalWorkspaceHeader
        icon={Inbox}
        iconColor="text-violet-600"
        iconBg="bg-violet-50"
        title="Invoices"
        subtitle="Manage and track all your invoices."
        search={
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
              data-testid="input-search-invoices"
            />
          </div>
        }
        actions={
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
        }
        primaryAction={
          <Link href="/invoices/new">
            <Button
              type="button"
              size="sm"
              className="rounded-lg px-3.5"
              data-testid="button-new-invoice"
            >
              New Invoice
            </Button>
          </Link>
        }
        kpis={<InvoiceKpiStrip />}
      />

      {/* Filter row — on app background, between header shell and table */}
      <div className="shrink-0 px-4 py-2">
        <WorkspaceFilterBar
          variant="flat"
          data-testid="invoice-filter-bar"
        >
          <WorkspaceViewChip
            size="md"
            active={activeView === "all"}
            onClick={() => handleViewChange("all")}
            count={viewCounts?.all}
            data-testid="inv-view-all"
          >
            All
          </WorkspaceViewChip>
          <WorkspaceViewChip
            size="md"
            active={activeView === "needs-follow-up"}
            onClick={() => handleViewChange("needs-follow-up")}
            count={viewCounts?.needsFollowUp}
            data-testid="inv-view-needs-follow-up"
          >
            Needs Follow-up
          </WorkspaceViewChip>
          <WorkspaceViewChip
            size="md"
            active={activeView === "overdue"}
            onClick={() => handleViewChange("overdue")}
            count={viewCounts?.overdue}
            data-testid="inv-view-overdue"
          >
            Overdue
          </WorkspaceViewChip>
          <WorkspaceViewChip
            size="md"
            active={activeView === "awaiting-payment"}
            onClick={() => handleViewChange("awaiting-payment")}
            count={viewCounts?.awaitingPayment}
            data-testid="inv-view-awaiting-payment"
          >
            Awaiting Payment
          </WorkspaceViewChip>
          <WorkspaceViewChip
            size="md"
            active={activeView === "promised-payment"}
            onClick={() => handleViewChange("promised-payment")}
            count={viewCounts?.promisedPayment}
            data-testid="inv-view-promised-payment"
          >
            Promised
          </WorkspaceViewChip>
          <WorkspaceViewChip
            size="md"
            active={activeView === "disputed"}
            onClick={() => handleViewChange("disputed")}
            count={viewCounts?.disputed}
            data-testid="inv-view-disputed"
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

      {/* Table — flex-col parent so WorkspaceCenterPane's flex-1 resolves correctly */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <InvoicesWorkspaceTab
          activeView={activeView}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          dateRange={dateRange}
          onRailContextChange={handleRailContextChange}
        />
      </div>
    </>
  );

  return (
    <div className="h-full bg-app-bg overflow-hidden" data-testid="invoices-page">
      <OperationalWorkspace
        center={centerContent}
        centerClassName="overflow-x-auto overflow-y-hidden"
        rightRailExpanded={railExpanded}
        rightRail={
          selectedContext
            ? <InvoiceRailBody context={selectedContext} activeView={activeView} />
            : <></>
        }
        rightCollapsedWidth={0}
        rightExpandedWidth={380}
        rightRailClassName={cn(
          railExpanded && "border-l border-border shadow-[-8px_0_18px_rgba(15,23,42,0.06)]",
        )}
        showRailDivider={false}
        rightRailTestId="invoice-workspace-rail"
        data-testid="invoices-workspace"
      />
    </div>
  );
}
