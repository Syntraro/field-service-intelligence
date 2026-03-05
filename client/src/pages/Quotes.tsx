import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, isValid, parseISO } from "date-fns";
import { useLocation, useSearch, Link } from "wouter";
import { Plus, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ListToolbar } from "@/components/layout/ListToolbar";
import { FiltersButton, FilterSection } from "@/components/filters/FiltersButton";
// Card, CardContent removed — unused after List Pages Refactor
import { ListSurface, tableRowClass } from "@/components/ui/list-surface";
import { TablePageShell } from "@/components/ui/table-page-shell";
import { EmptyState } from "@/components/ui/empty-state";
// cn import removed — no longer needed after List Pages Refactor
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Quote } from "@shared/schema";
import { NewQuoteModal } from "@/components/NewQuoteModal";

interface EnrichedQuote extends Quote {
  location?: { id: string; companyName: string };
  customerCompany?: { id: string; name: string };
}

type QuoteStatusFilter = "all" | "draft" | "sent" | "approved" | "declined" | "expired" | "converted";

function getStatusBadge(status: string): {
  label: string;
  variant: "default" | "destructive" | "secondary" | "outline";
} {
  switch (status) {
    case "draft":
      return { label: "Draft", variant: "outline" };
    case "sent":
      return { label: "Sent", variant: "default" };
    case "approved":
      return { label: "Approved", variant: "default" };
    case "declined":
      return { label: "Declined", variant: "destructive" };
    case "expired":
      return { label: "Expired", variant: "secondary" };
    case "converted":
      return { label: "Converted", variant: "secondary" };
    default:
      return { label: status, variant: "outline" };
  }
}

function formatCurrency(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(num);
}

export default function Quotes() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [activeFilter, setActiveFilter] = useState<QuoteStatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [newQuoteModalOpen, setNewQuoteModalOpen] = useState(false);

  // Open modal if ?create=true
  useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.get("create") === "true") {
      setNewQuoteModalOpen(true);
      // Clear the param
      setLocation("/quotes", { replace: true });
    }
  }, [search, setLocation]);

  const { data: quotes = [], isLoading } = useQuery<{ data: EnrichedQuote[]; meta: any }, Error, EnrichedQuote[]>({
    queryKey: ["/api/quotes/list"],
    queryFn: async () => {
      const res = await fetch("/api/quotes/list?offset=0&limit=200", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch quotes");
      return res.json();
    },
    select: (response) => response.data,
  });

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

  const filteredQuotes = useMemo(() => {
    let result = quotes.map(q => {
      const statusInfo = getStatusBadge(q.status);
      return { ...q, statusInfo };
    });

    if (activeFilter !== "all") {
      result = result.filter(q => q.status === activeFilter);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(q => {
        const quoteNumber = q.quoteNumber?.toLowerCase() || "";
        const title = q.title?.toLowerCase() || "";
        const locationName = q.location?.companyName?.toLowerCase() || "";
        const customerName = q.customerCompany?.name?.toLowerCase() || "";
        return quoteNumber.includes(query) ||
               title.includes(query) ||
               locationName.includes(query) ||
               customerName.includes(query);
      });
    }

    return result;
  }, [quotes, activeFilter, searchQuery]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: quotes.length };
    for (const q of quotes) {
      counts[q.status] = (counts[q.status] || 0) + 1;
    }
    return counts;
  }, [quotes]);

  return (
    <TablePageShell
      title="Quotes"
      actions={
        <Button onClick={() => setNewQuoteModalOpen(true)} data-testid="button-new-quote">
          <Plus className="h-4 w-4 mr-2" />
          New Quote
        </Button>
      }
    >
      {/* List Pages Refactor: Consolidated toolbar with search + filters popover */}
      <ListToolbar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search quotes..."
        searchTestId="input-search-quotes"
      >
        <FiltersButton
          activeCount={activeFilter !== "all" ? 1 : 0}
          onClear={() => setActiveFilter("all")}
        >
          <FilterSection label="Status">
            <div className="flex flex-wrap gap-1.5">
              {(["all", "draft", "sent", "approved", "declined", "converted"] as QuoteStatusFilter[]).map((filter) => (
                <Button
                  key={filter}
                  variant={activeFilter === filter ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs rounded-full"
                  onClick={() => setActiveFilter(filter)}
                  data-testid={`button-filter-${filter}`}
                >
                  {filter === "all" ? "All" : filter.charAt(0).toUpperCase() + filter.slice(1)}
                  {statusCounts[filter] ? ` (${statusCounts[filter]})` : ""}
                </Button>
              ))}
            </div>
          </FilterSection>
        </FiltersButton>
      </ListToolbar>

      <ListSurface>
          {isLoading ? (
            <div className="text-center py-12 text-sm text-muted-foreground">Loading quotes...</div>
          ) : filteredQuotes.length === 0 ? (
            <EmptyState
              icon={FileText}
              message={searchQuery || activeFilter !== "all"
                ? "No quotes match your filters"
                : "No quotes found"}
              description={!searchQuery && activeFilter === "all" ? "Create your first quote to get started." : undefined}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quote #</TableHead>
                  <TableHead>Client / Location</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredQuotes.map((quote) => (
                  <TableRow
                    key={quote.id}
                    className={tableRowClass}
                    onClick={() => setLocation(`/quotes/${quote.id}`)}
                    data-testid={`row-quote-${quote.id}`}
                  >
                    <TableCell>
                      <span className="font-mono" data-testid={`text-quote-number-${quote.id}`}>
                        {quote.quoteNumber || `Q-${quote.id.slice(0, 8)}`}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium" data-testid={`text-quote-client-${quote.id}`}>
                          {quote.customerCompany?.name || quote.location?.companyName || "Unknown"}
                        </p>
                        {quote.customerCompany?.name && quote.location?.companyName && (
                          <p className="text-sm text-muted-foreground">{quote.location.companyName}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground">
                        {quote.title || "-"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={quote.statusInfo.variant}>
                        {quote.statusInfo.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(quote.total)}
                    </TableCell>
                    <TableCell>
                      {safeFormatDate(quote.updatedAt || quote.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
      </ListSurface>

      <NewQuoteModal
        open={newQuoteModalOpen}
        onOpenChange={setNewQuoteModalOpen}
      />
    </TablePageShell>
  );
}
