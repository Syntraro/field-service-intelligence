import { useState, useMemo, useEffect } from "react";
import { format, isValid, parseISO } from "date-fns";
import { useLocation, useSearch, Link } from "wouter";
import { Search, Plus, FileText, DollarSign, Clock, AlertTriangle, LayoutGrid, List, MoreHorizontal, RefreshCw } from "lucide-react";
import { QboSyncBadge, isQboSynced } from "@/components/invoice/QboSyncBanner";
import { useInvoicesFeed, useInvoiceStats, type InvoiceFeedItem } from "@/hooks/useInvoicesFeed";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ListSurface, tableRowClass } from "@/components/ui/list-surface";
import { TablePageShell } from "@/components/ui/table-page-shell";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type InvoiceStatusFilter = "all" | "draft" | "awaiting_payment" | "sent" | "viewed" | "partial_paid" | "paid" | "voided" | "overdue" | "qbo_synced" | "qbo_out_of_sync";
type ViewDensity = "comfortable" | "compact";

function getStatusBadge(status: string, dueDate: string | null, balance: string): {
  label: string;
  variant: "default" | "destructive" | "secondary" | "outline";
  isOverdue?: boolean;
} {
  const balanceNum = parseFloat(balance);
  const isOverdue = dueDate && new Date(dueDate) < new Date() && balanceNum > 0 && status !== "paid" && status !== "voided";

  if (isOverdue) {
    return { label: "Past Due", variant: "destructive", isOverdue: true };
  }

  switch (status) {
    case "draft":
      return { label: "Draft", variant: "outline" };
    case "awaiting_payment":
      return { label: "Awaiting Payment", variant: "default" };
    case "sent":
      return { label: "Sent", variant: "default" }; // Legacy
    case "viewed":
      return { label: "Viewed", variant: "secondary" };
    case "partial_paid":
      return { label: "Partial", variant: "secondary" };
    case "paid":
      return { label: "Paid", variant: "default" };
    case "voided":
      return { label: "Voided", variant: "outline" };
    default:
      return { label: status, variant: "outline" };
  }
}

function formatCurrency(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(num);
}

export default function InvoicesListPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [activeFilter, setActiveFilter] = useState<InvoiceStatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [userDensityPreference, setUserDensityPreference] = useState<ViewDensity | null>(null);

  // Parse URL filter param on mount
  useEffect(() => {
    const params = new URLSearchParams(search);
    const filterParam = params.get("filter");
    const validFilters: InvoiceStatusFilter[] = ["all", "draft", "awaiting_payment", "sent", "viewed", "partial_paid", "paid", "voided", "overdue", "qbo_synced", "qbo_out_of_sync"];
    if (filterParam && validFilters.includes(filterParam as InvoiceStatusFilter)) {
      setActiveFilter(filterParam as InvoiceStatusFilter);
    }
  }, [search]);

  // Phase 6.2 Step A2: canonical hooks replace direct useQuery
  const { invoices, isLoading } = useInvoicesFeed();
  const { stats } = useInvoiceStats();

  const outstandingAmount = stats?.outstanding?.amount ?? 0;
  const outstandingCount = stats?.outstanding?.count ?? 0;
  const overdueAmount = stats?.overdue?.amount ?? 0;
  const overdueCount = stats?.overdue?.count ?? 0;
  // Not available from byStatus aggregate — server enhancement needed
  const issuedCount30d = 0;
  const averageInvoiceAmount = 0;

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

  const autoCompact = invoices.length <= 10;
  const effectiveDensity: ViewDensity = userDensityPreference ?? (autoCompact ? "compact" : "comfortable");
  const isCompact = effectiveDensity === "compact";

  const filteredInvoices = useMemo(() => {
    let result = invoices.map(inv => {
      const statusInfo = getStatusBadge(inv.status ?? "", inv.dueDate, inv.balance ?? "0");
      return { ...inv, statusInfo };
    });

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
        const customerName = inv.locationDisplayName?.toLowerCase() || "";
        return invoiceNumber.includes(query) ||
               locationName.includes(query) ||
               customerName.includes(query);
      });
    }

    return result;
  }, [invoices, activeFilter, searchQuery]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: invoices.length, awaiting_payment: 0 };
    for (const inv of invoices) {
      const statusInfo = getStatusBadge(inv.status ?? "", inv.dueDate, inv.balance ?? "0");
      const status = inv.status ?? "";
      // Count individual statuses (except awaiting_payment which we handle specially)
      if (status !== "awaiting_payment" && status !== "sent") {
        counts[status] = (counts[status] || 0) + 1;
      }
      // Combine awaiting_payment + sent (legacy) for the "Unpaid" filter count
      if (status === "awaiting_payment" || status === "sent") {
        counts["awaiting_payment"] = (counts["awaiting_payment"] || 0) + 1;
      }
      if (statusInfo.isOverdue) {
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
  }, [invoices]);

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
      {isCompact ? (
        <div className="flex items-center gap-4 text-sm flex-wrap">
          <div className="flex items-center gap-1.5">
            <DollarSign className="h-4 w-4 text-amber-500" />
            <span className="font-semibold" data-testid="text-outstanding-amount">
              {formatCurrency(outstandingAmount)}
            </span>
            <span className="text-muted-foreground">Outstanding ({outstandingCount})</span>
          </div>
          <span className="text-muted-foreground">|</span>
          <div className="flex items-center gap-1.5">
            <FileText className="h-4 w-4 text-primary" />
            <span className="font-semibold" data-testid="text-issued-count">{issuedCount30d}</span>
            <span className="text-muted-foreground">Issued (30d)</span>
          </div>
          <span className="text-muted-foreground">|</span>
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <span className="font-semibold" data-testid="text-overdue-count">{overdueCount}</span>
            <span className="text-muted-foreground">Overdue</span>
          </div>
        </div>
      ) : (
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
      )}

      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          {(["all", "draft", "awaiting_payment", "partial_paid", "paid", "overdue", "voided"] as InvoiceStatusFilter[]).map((filter) => (
            <Button
              key={filter}
              variant={activeFilter === filter ? "default" : "outline"}
              size="sm"
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
          {/* Phase 10A: QBO sync filter buttons (only show if there are synced invoices) */}
          {(statusCounts["qbo_synced"] || statusCounts["qbo_out_of_sync"]) && (
            <>
              <span className="text-muted-foreground mx-1">|</span>
              <Button
                variant={activeFilter === "qbo_synced" ? "default" : "outline"}
                size="sm"
                onClick={() => setActiveFilter("qbo_synced")}
                data-testid="button-filter-qbo-synced"
                className="gap-1"
              >
                <RefreshCw className="h-3 w-3" />
                Synced
                {statusCounts["qbo_synced"] ? ` (${statusCounts["qbo_synced"]})` : ""}
              </Button>
              {statusCounts["qbo_out_of_sync"] > 0 && (
                <Button
                  variant={activeFilter === "qbo_out_of_sync" ? "destructive" : "outline"}
                  size="sm"
                  onClick={() => setActiveFilter("qbo_out_of_sync")}
                  data-testid="button-filter-qbo-out-of-sync"
                  className={activeFilter !== "qbo_out_of_sync" ? "text-destructive border-destructive/50" : ""}
                >
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Out of Sync ({statusCounts["qbo_out_of_sync"]})
                </Button>
              )}
            </>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search invoices..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 w-[250px]"
              data-testid="input-search-invoices"
            />
          </div>
          
          <div className="flex border rounded-md">
            <Button
              variant={effectiveDensity === "comfortable" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setUserDensityPreference("comfortable")}
              className="rounded-r-none"
              data-testid="button-view-comfortable"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={effectiveDensity === "compact" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setUserDensityPreference("compact")}
              className="rounded-l-none"
              data-testid="button-view-compact"
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <ListSurface>
          {isLoading ? (
            <div className="text-center py-12">Loading invoices...</div>
          ) : filteredInvoices.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {searchQuery || activeFilter !== "all"
                ? "No invoices match your filters"
                : "No invoices found. Create your first invoice to get started."}
            </div>
          ) : (
            <Table className={isCompact ? "text-sm" : ""}>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Issue Date</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredInvoices.map((invoice) => (
                  <TableRow
                    key={invoice.id}
                    className={cn(tableRowClass, isCompact && "h-10")}
                    onClick={() => setLocation(`/invoices/${invoice.id}`)}
                    data-testid={`row-invoice-${invoice.id}`}
                  >
                    <TableCell className={isCompact ? "py-1" : ""}>
                      <div>
                        <p className="font-medium" data-testid={`text-invoice-client-${invoice.id}`}>
                          {invoice.locationDisplayName || invoice.locationName || "Unknown"}
                        </p>
                        {!isCompact && invoice.locationDisplayName && invoice.locationName && invoice.locationDisplayName !== invoice.locationName && (
                          <p className="text-sm text-muted-foreground">{invoice.locationName}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className={isCompact ? "py-1" : ""}>
                      <span className="font-mono" data-testid={`text-invoice-number-${invoice.id}`}>
                        {invoice.invoiceNumber || `INV-${invoice.id.slice(0, 8)}`}
                      </span>
                    </TableCell>
                    <TableCell className={isCompact ? "py-1" : ""}>
                      {safeFormatDate(invoice.issueDate)}
                    </TableCell>
                    <TableCell className={isCompact ? "py-1" : ""}>
                      {safeFormatDate(invoice.dueDate)}
                    </TableCell>
                    <TableCell className={isCompact ? "py-1" : ""}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={invoice.statusInfo.variant}>
                          {invoice.statusInfo.label}
                        </Badge>
                        <QboSyncBadge invoice={invoice} />
                      </div>
                    </TableCell>
                    <TableCell className={`text-right ${isCompact ? "py-1" : ""}`}>
                      {formatCurrency(invoice.total ?? "0")}
                    </TableCell>
                    <TableCell className={`text-right ${isCompact ? "py-1" : ""}`}>
                      <span className={parseFloat(invoice.balance ?? "0") > 0 ? "font-medium" : "text-muted-foreground"}>
                        {formatCurrency(invoice.balance ?? "0")}
                      </span>
                    </TableCell>
                    <TableCell className={isCompact ? "py-1" : ""} onClick={(e) => e.stopPropagation()}>
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
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
      </ListSurface>
    </TablePageShell>
  );
}
