import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, isValid, parseISO } from "date-fns";
import { useLocation, useSearch, Link } from "wouter";
import { Plus, FileText, DollarSign, AlertTriangle, MoreHorizontal, RefreshCw } from "lucide-react";
import { QboSyncBadge, isQboSynced } from "@/components/invoice/QboSyncBanner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ListToolbar } from "@/components/layout/ListToolbar";
import { FiltersButton, FilterSection } from "@/components/filters/FiltersButton";
import { Card, CardContent } from "@/components/ui/card";
import { ListSurface, tableRowClass, listPrimaryClass, listSecondaryClass, listResultsClass } from "@/components/ui/list-surface";
import { TablePageShell } from "@/components/ui/table-page-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Invoice } from "@shared/schema";
import { getInvoiceStatusBadge } from "@/lib/statusBadges";

interface EnrichedInvoice extends Invoice {
  locationName?: string;
  customerCompanyName?: string;
  locationDisplayName?: string;
  /** Server-computed overdue flag from invoicesFeed mapper */
  isPastDue?: boolean;
}

interface InvoiceStats {
  outstanding: { amount: number; count: number };
  issuedLast30Days: { count: number };
  averageInvoice: number;
  overdue: { amount: number; count: number };
}

type InvoiceStatusFilter = "all" | "draft" | "awaiting_payment" | "sent" | "viewed" | "partial_paid" | "paid" | "voided" | "overdue" | "qbo_synced" | "qbo_out_of_sync";

// 2026-03-20: Local getInvoiceStatusBadge() removed — canonical owner is lib/statusBadges.ts:getInvoiceStatusBadge()

function formatCurrency(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(num);
}

// Grid columns — Client gets a min-width to prevent compression
const INVOICES_GRID_COLS = "minmax(260px, 1.8fr) 1.2fr 0.8fr 0.8fr 0.9fr 0.7fr 0.7fr 50px";

export default function InvoicesListPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [activeFilter, setActiveFilter] = useState<InvoiceStatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  // Parse URL filter param on mount
  useEffect(() => {
    const params = new URLSearchParams(search);
    const filterParam = params.get("filter");
    const validFilters: InvoiceStatusFilter[] = ["all", "draft", "awaiting_payment", "sent", "viewed", "partial_paid", "paid", "voided", "overdue", "qbo_synced", "qbo_out_of_sync"];
    if (filterParam && validFilters.includes(filterParam as InvoiceStatusFilter)) {
      setActiveFilter(filterParam as InvoiceStatusFilter);
    }
  }, [search]);

  const { data: invoices = [], isLoading } = useQuery<{ data: EnrichedInvoice[]; meta: { limit: number; hasMore: boolean; nextOffset?: number } }, Error, EnrichedInvoice[]>({
    // Phase 5 Step A7: canonical family key prefix
    queryKey: ["invoices", "feed", { offset: 0, limit: 200 }],
    queryFn: async () => {
      const res = await fetch("/api/invoices/list?offset=0&limit=200", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch invoices");
      return res.json();
    },
    select: (response) => response.data,
  });

  const { data: stats } = useQuery<InvoiceStats>({
    // Phase 5 Step A7: canonical family key prefix
    queryKey: ["invoices", "stats"],
    queryFn: async () => {
      const res = await fetch("/api/invoices/stats", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch invoice stats");
      return res.json();
    },
  });

  const outstandingAmount = stats?.outstanding?.amount ?? 0;
  const outstandingCount = stats?.outstanding?.count ?? 0;
  const issuedCount30d = stats?.issuedLast30Days?.count ?? 0;
  const overdueAmount = stats?.overdue?.amount ?? 0;
  const overdueCount = stats?.overdue?.count ?? 0;
  const averageInvoiceAmount = stats?.averageInvoice ?? 0;

  const safeFormatDate = (value: unknown): string => {
    if (!value) return "-";
    const d =
      value instanceof Date
        ? value
        : typeof value === "string"
          ? parseISO(value)
          : new Date(String(value));
    return isValid(d) ? format(d, "MMM d, yyyy") : "-";
  };

  // Enriched invoices — single pass of getStatusBadge, depends only on [invoices].
  // Both filteredInvoices and statusCounts read pre-computed statusInfo.
  const enrichedInvoices = useMemo(() => {
    return invoices.map(inv => ({
      ...inv,
      statusInfo: getInvoiceStatusBadge(inv.status, inv.isPastDue ?? false),
    }));
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    let result = enrichedInvoices.slice();

    if (activeFilter !== "all") {
      result = result.filter(inv => {
        if (activeFilter === "overdue") {
          return inv.statusInfo.isOverdue;
        }
        // Phase 10A: QBO sync filters
        if (activeFilter === "qbo_synced") {
          return isQboSynced(inv) && !inv.qboOutOfSync;
        }
        if (activeFilter === "qbo_out_of_sync") {
          return inv.qboOutOfSync === true;
        }
        // "awaiting_payment" filter includes legacy "sent" status
        if (activeFilter === "awaiting_payment") {
          return inv.status === "awaiting_payment" || inv.status === "sent";
        }
        return inv.status === activeFilter;
      });
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(inv => {
        const invoiceNumber = inv.invoiceNumber?.toLowerCase() || "";
        const locationName = inv.locationName?.toLowerCase() || "";
        const companyName = (inv.locationDisplayName || inv.customerCompanyName || "").toLowerCase();
        const description = (inv.workDescription || "").toLowerCase();
        return invoiceNumber.includes(query) ||
               locationName.includes(query) ||
               companyName.includes(query) ||
               description.includes(query);
      });
    }

    return result;
  }, [enrichedInvoices, activeFilter, searchQuery]);

  // Status counts — reads pre-computed statusInfo from enrichedInvoices
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: enrichedInvoices.length, awaiting_payment: 0 };
    for (const inv of enrichedInvoices) {
      if (inv.status !== "awaiting_payment" && inv.status !== "sent") {
        counts[inv.status] = (counts[inv.status] || 0) + 1;
      }
      if (inv.status === "awaiting_payment" || inv.status === "sent") {
        counts["awaiting_payment"] = (counts["awaiting_payment"] || 0) + 1;
      }
      if (inv.statusInfo.isOverdue) {
        counts["overdue"] = (counts["overdue"] || 0) + 1;
      }
      // Phase 10A: Count QBO sync states
      if (isQboSynced(inv)) {
        if (inv.qboOutOfSync) {
          counts["qbo_out_of_sync"] = (counts["qbo_out_of_sync"] || 0) + 1;
        } else {
          counts["qbo_synced"] = (counts["qbo_synced"] || 0) + 1;
        }
      }
    }
    return counts;
  }, [enrichedInvoices]);

  return (
    <TablePageShell
      title="Invoices"
      actions={
        <Link href="/invoices/new">
          <Button data-testid="button-new-invoice">
            <Plus className="h-4 w-4 mr-2" />
            New Invoice
          </Button>
        </Link>
      }
    >
      {/* Phase: List Screens Cleanup — always show cards layout (view toggle removed) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-500/10 rounded-lg">
                  <DollarSign className="h-5 w-5 text-amber-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold" data-testid="text-outstanding-amount">
                    {formatCurrency(outstandingAmount)}
                  </p>
                  <p className="text-xs text-muted-foreground">Outstanding ({outstandingCount})</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <FileText className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold" data-testid="text-issued-count">{issuedCount30d}</p>
                  <p className="text-xs text-muted-foreground">Issued (30 days)</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-500/10 rounded-lg">
                  <DollarSign className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold" data-testid="text-average-invoice">
                    {formatCurrency(averageInvoiceAmount)}
                  </p>
                  <p className="text-xs text-muted-foreground">Average Invoice</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-destructive/10 rounded-lg">
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                </div>
                <div>
                  <p className="text-2xl font-bold" data-testid="text-overdue-amount">
                    {formatCurrency(overdueAmount)}
                  </p>
                  <p className="text-xs text-muted-foreground">Overdue ({overdueCount})</p>
                </div>
              </div>
            </CardContent>
          </Card>
      </div>

      {/* List Pages Refactor: Consolidated toolbar with search + filters popover */}
      <ListToolbar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search invoices..."
        searchTestId="input-search-invoices"
      >
        <FiltersButton
          activeCount={activeFilter !== "all" ? 1 : 0}
          onClear={() => setActiveFilter("all")}
        >
          <FilterSection label="Status">
            <div className="flex flex-wrap gap-1.5">
              {(["all", "draft", "awaiting_payment", "partial_paid", "paid", "overdue", "voided"] as InvoiceStatusFilter[]).map((filter) => (
                <Button
                  key={filter}
                  variant={activeFilter === filter ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs rounded-full"
                  onClick={() => setActiveFilter(filter)}
                  data-testid={`button-filter-${filter}`}
                >
                  {filter === "all" ? "All" :
                   filter === "awaiting_payment" ? "Unpaid" :
                   filter === "partial_paid" ? "Partial" :
                   filter === "overdue" ? "Overdue" :
                   filter.charAt(0).toUpperCase() + filter.slice(1)}
                  {statusCounts[filter] ? ` (${statusCounts[filter]})` : ""}
                </Button>
              ))}
            </div>
          </FilterSection>

          {/* QBO sync filters (only shown when synced invoices exist) */}
          {(statusCounts["qbo_synced"] || statusCounts["qbo_out_of_sync"]) ? (
            <FilterSection label="QuickBooks Sync">
              <div className="flex flex-wrap gap-1.5">
                <Button
                  variant={activeFilter === "qbo_synced" ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs rounded-full gap-1"
                  onClick={() => setActiveFilter("qbo_synced")}
                  data-testid="button-filter-qbo-synced"
                >
                  <RefreshCw className="h-3 w-3" />
                  Synced {statusCounts["qbo_synced"] ? `(${statusCounts["qbo_synced"]})` : ""}
                </Button>
                {statusCounts["qbo_out_of_sync"] > 0 && (
                  <Button
                    variant={activeFilter === "qbo_out_of_sync" ? "destructive" : "outline"}
                    size="sm"
                    className="h-7 text-xs rounded-full gap-1"
                    onClick={() => setActiveFilter("qbo_out_of_sync")}
                    data-testid="button-filter-qbo-out-of-sync"
                  >
                    <AlertTriangle className="h-3 w-3" />
                    Out of Sync ({statusCounts["qbo_out_of_sync"]})
                  </Button>
                )}
              </div>
            </FilterSection>
          ) : null}
        </FiltersButton>
      </ListToolbar>

      <ListSurface>
          {isLoading ? (
            <div className="text-center py-12 text-sm text-muted-foreground">Loading invoices...</div>
          ) : filteredInvoices.length === 0 ? (
            <EmptyState
              icon={FileText}
              message={searchQuery || activeFilter !== "all"
                ? "No invoices match your filters"
                : "No invoices found"}
              description={!searchQuery && activeFilter === "all" ? "Create your first invoice to get started." : undefined}
            />
          ) : (
            <>
              {/* Standardized grid header */}
              <div
                className="grid items-center border-b border-gray-200 dark:border-gray-800 py-2 text-xs font-medium text-muted-foreground bg-[#FAFAFA] dark:bg-gray-900/50"
                style={{ gridTemplateColumns: INVOICES_GRID_COLS }}
              >
                <div className="px-4">Client</div>
                <div className="px-4">Description</div>
                <div className="px-4">Invoice #</div>
                <div className="px-4">Due Date</div>
                <div className="px-4">Status</div>
                <div className="px-4 text-right">Total</div>
                <div className="px-4 text-right">Balance</div>
                <div className="w-[50px]"></div>
              </div>

              {/* Rows — no virtualization so page scroll handles overflow */}
              {filteredInvoices.map((invoice) => (
                <div
                  key={invoice.id}
                  className={cn("grid items-center", tableRowClass)}
                  style={{ gridTemplateColumns: INVOICES_GRID_COLS }}
                  onClick={() => setLocation(`/invoices/${invoice.id}`)}
                  data-testid={`row-invoice-${invoice.id}`}
                >
                  {/* Client: 2-line identity block — company name + location */}
                  <div className={cn("px-4 min-w-0", "py-2.5")}>
                    <p className={listPrimaryClass} data-testid={`text-invoice-client-${invoice.id}`}>
                      {invoice.locationDisplayName || invoice.locationName || "Unknown"}
                    </p>
                    {invoice.locationName && invoice.locationDisplayName && (
                      <p className={listSecondaryClass}>{invoice.locationName}</p>
                    )}
                  </div>
                  <div className={cn("px-4 min-w-0", "py-2.5")}>
                    <p className={listSecondaryClass}>
                      {invoice.workDescription || "-"}
                    </p>
                  </div>
                  <div className={cn("px-4", "py-2.5")}>
                    <span className="font-mono text-sm" data-testid={`text-invoice-number-${invoice.id}`}>
                      {invoice.invoiceNumber || `INV-${invoice.id.slice(0, 8)}`}
                    </span>
                  </div>
                  <div className={cn("px-4 text-sm", "py-2.5")}>
                    {safeFormatDate(invoice.dueDate)}
                  </div>
                  <div className={cn("px-4", "py-2.5")}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={invoice.statusInfo.variant}>
                        {invoice.statusInfo.label}
                      </Badge>
                      <QboSyncBadge invoice={invoice} />
                    </div>
                  </div>
                  <div className={cn("px-4 text-right whitespace-nowrap tabular-nums text-sm", "py-2.5")}>
                    {formatCurrency(invoice.total)}
                  </div>
                  <div className={cn("px-4 text-right whitespace-nowrap tabular-nums text-sm", "py-2.5")}>
                    <span className={parseFloat(invoice.balance) > 0 ? "font-medium" : "text-muted-foreground"}>
                      {formatCurrency(invoice.balance)}
                    </span>
                  </div>
                  <div className={cn("py-2.5")} onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" data-testid={`button-invoice-menu-${invoice.id}`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setLocation(`/invoices/${invoice.id}`)}>
                          View
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setLocation(`/invoices/${invoice.id}?edit=true`)}>
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem>Send</DropdownMenuItem>
                        <DropdownMenuItem>Collect Payment</DropdownMenuItem>
                        <DropdownMenuItem>Download PDF</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </>
          )}
      </ListSurface>

      {!isLoading && filteredInvoices.length > 0 && (
        <div className={listResultsClass}>
          Showing {filteredInvoices.length} invoice{filteredInvoices.length !== 1 ? 's' : ''}
        </div>
      )}
    </TablePageShell>
  );
}
