import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, isValid, parseISO } from "date-fns";
import { useLocation, Link } from "wouter";
import { Search, Plus, FileText, DollarSign, Clock, AlertTriangle, LayoutGrid, List, MoreHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import type { Invoice } from "@shared/schema";

interface EnrichedInvoice extends Invoice {
  locationName?: string;
  customerCompanyName?: string;
}

interface InvoiceStats {
  outstanding: { amount: number; count: number };
  issuedLast30Days: { count: number };
  averageInvoice: number;
  overdue: { amount: number; count: number };
}

type InvoiceStatusFilter = "all" | "draft" | "sent" | "viewed" | "partial_paid" | "paid" | "voided" | "overdue";
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
    case "sent":
      return { label: "Sent", variant: "default" };
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
  const [activeFilter, setActiveFilter] = useState<InvoiceStatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [userDensityPreference, setUserDensityPreference] = useState<ViewDensity | null>(null);

  const { data: invoices = [], isLoading } = useQuery<{ data: EnrichedInvoice[]; meta: { limit: number; hasMore: boolean; nextOffset?: number } }, Error, EnrichedInvoice[]>({
    queryKey: ["/api/invoices/list", { offset: 0, limit: 200 }],
    queryFn: async () => {
      const res = await fetch("/api/invoices/list?offset=0&limit=200", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch invoices");
      return res.json();
    },
    select: (response) => response.data,
  });

  const { data: stats } = useQuery<InvoiceStats>({
    queryKey: ["/api/invoices/stats"],
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

  const autoCompact = invoices.length <= 10;
  const effectiveDensity: ViewDensity = userDensityPreference ?? (autoCompact ? "compact" : "comfortable");
  const isCompact = effectiveDensity === "compact";

  const filteredInvoices = useMemo(() => {
    let result = invoices.map(inv => {
      const statusInfo = getStatusBadge(inv.status, inv.dueDate, inv.balance);
      return { ...inv, statusInfo };
    });

    if (activeFilter !== "all") {
      result = result.filter(inv => {
        if (activeFilter === "overdue") {
          return inv.statusInfo.isOverdue;
        }
        return inv.status === activeFilter;
      });
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(inv => {
        const invoiceNumber = inv.invoiceNumber?.toLowerCase() || "";
        const locationName = inv.locationName?.toLowerCase() || "";
        const customerName = inv.customerCompanyName?.toLowerCase() || "";
        return invoiceNumber.includes(query) || 
               locationName.includes(query) || 
               customerName.includes(query);
      });
    }

    return result;
  }, [invoices, activeFilter, searchQuery]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: invoices.length };
    for (const inv of invoices) {
      const statusInfo = getStatusBadge(inv.status, inv.dueDate, inv.balance);
      counts[inv.status] = (counts[inv.status] || 0) + 1;
      if (statusInfo.isOverdue) {
        counts["overdue"] = (counts["overdue"] || 0) + 1;
      }
    }
    return counts;
  }, [invoices]);

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-semibold">Invoices</h1>
        <Link href="/invoices/new">
          <Button data-testid="button-new-invoice">
            <Plus className="h-4 w-4 mr-2" />
            New Invoice
          </Button>
        </Link>
      </div>

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
          {(["all", "draft", "sent", "partial_paid", "paid", "overdue", "voided"] as InvoiceStatusFilter[]).map((filter) => (
            <Button
              key={filter}
              variant={activeFilter === filter ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveFilter(filter)}
              data-testid={`button-filter-${filter}`}
            >
              {filter === "all" ? "All" : 
               filter === "partial_paid" ? "Partial" :
               filter === "overdue" ? "Overdue" :
               filter.charAt(0).toUpperCase() + filter.slice(1)}
              {statusCounts[filter] ? ` (${statusCounts[filter]})` : ""}
            </Button>
          ))}
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

      <Card>
        <CardContent className="p-0">
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
                    className={`cursor-pointer hover-elevate ${isCompact ? "h-10" : ""}`}
                    onClick={() => setLocation(`/invoices/${invoice.id}`)}
                    data-testid={`row-invoice-${invoice.id}`}
                  >
                    <TableCell className={isCompact ? "py-1" : ""}>
                      <div>
                        <p className="font-medium" data-testid={`text-invoice-client-${invoice.id}`}>
                          {invoice.customerCompanyName || invoice.locationName || "Unknown"}
                        </p>
                        {!isCompact && invoice.customerCompanyName && invoice.locationName && (
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
                      <Badge variant={invoice.statusInfo.variant}>
                        {invoice.statusInfo.label}
                      </Badge>
                    </TableCell>
                    <TableCell className={`text-right ${isCompact ? "py-1" : ""}`}>
                      {formatCurrency(invoice.total)}
                    </TableCell>
                    <TableCell className={`text-right ${isCompact ? "py-1" : ""}`}>
                      <span className={parseFloat(invoice.balance) > 0 ? "font-medium" : "text-muted-foreground"}>
                        {formatCurrency(invoice.balance)}
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
        </CardContent>
      </Card>
    </div>
  );
}
