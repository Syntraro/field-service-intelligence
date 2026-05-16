import { useState, useCallback } from "react";
import { Link, useSearch } from "wouter";
import { Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/layout/PageHeader";
import { WorkspaceRightRail } from "@/components/workspace/WorkspaceRightRail";
import { useToast } from "@/hooks/use-toast";
import {
  InvoicesWorkspaceTab,
  readViewFromSearch,
  type SelectedReceivablesContext,
} from "./receivables/InvoicesWorkspaceTab";
import { InvoiceRailBody } from "./receivables/InvoiceRailBody";
import type { InvoiceStatusFilter } from "@shared/invoiceStatus";
import type { InvoiceDateRange } from "@shared/invoiceStatus";
import { cn } from "@/lib/utils";

// ── ReceivablesPage ───────────────────────────────────────────────────────────

export default function ReceivablesPage() {
  const { toast } = useToast();
  const search = useSearch();
  const activeView = readViewFromSearch(search);

  const [isExporting, setIsExporting] = useState(false);

  // Search + filter state — rendered in page header, threaded into workspace.
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<InvoiceStatusFilter>("all");
  const [dateRange, setDateRange] = useState<InvoiceDateRange>({ preset: null, start: null, end: null });

  // Rail selection state — owned here so the rail can span from the top of
  // the white page surface (including PageHeader) to the bottom.
  const [selectedContext, setSelectedContext] = useState<SelectedReceivablesContext | null>(null);
  const railExpanded = selectedContext !== null;

  const handleRailContextChange = useCallback((ctx: SelectedReceivablesContext | null) => {
    setSelectedContext(ctx);
  }, []);

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
    // Top-level horizontal layout: left column (page header + content) beside
    // the canonical right rail. Rail is a sibling of the entire left column so
    // it spans from the very top of the white page surface to the bottom.
    <div className="h-full bg-app-bg flex overflow-hidden" data-testid="receivables-page">

      {/* ── Left column: page header + workspace content ── */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden">
        <PageHeader title="Invoices" subtitle="Manage and track all your invoices." className="border-b-0">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden="true" />
            <Input
              placeholder="Search invoices…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 w-56 h-8 rounded-lg border-slate-200 bg-white text-sm"
              data-testid="input-search-invoices-toolbar"
            />
          </div>

          {/* Export */}
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

          {/* New Invoice */}
          <Link href="/invoices/new">
            <Button
              type="button"
              size="sm"
              className="rounded-lg px-3.5"
              data-testid="button-new-invoice-receivables"
            >
              New Invoice
            </Button>
          </Link>
        </PageHeader>

        <div className="flex-1 min-h-0 overflow-hidden">
          <InvoicesWorkspaceTab
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            onRailContextChange={handleRailContextChange}
          />
        </div>
      </div>

      {/* ── Right rail: always mounted so the CSS width transition runs.
           collapsedWidth=0 means no phantom strip when closed.
           Content renders only when selectedContext is non-null — the
           WorkspaceRightRail's overflow-hidden clips it while at 0px. */}
      <WorkspaceRightRail
        expanded={railExpanded}
        collapsedWidth={0}
        expandedWidth={380}
        className={cn(
          railExpanded && "border-l border-border shadow-[-8px_0_18px_rgba(15,23,42,0.06)]",
        )}
        data-testid="invoice-workspace-rail"
      >
        {selectedContext && (
          <InvoiceRailBody context={selectedContext} activeView={activeView} />
        )}
      </WorkspaceRightRail>
    </div>
  );
}
