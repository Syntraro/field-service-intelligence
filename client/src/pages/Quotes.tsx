import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, isValid, parseISO } from "date-fns";
import { useLocation, useSearch, Link } from "wouter";
import { Search, Plus, FileText, MoreHorizontal, Check, X, Send } from "lucide-react";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-semibold">Quotes</h1>
        <Button onClick={() => setNewQuoteModalOpen(true)} data-testid="button-new-quote">
          <Plus className="h-4 w-4 mr-2" />
          New Quote
        </Button>
      </div>

      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          {(["all", "draft", "sent", "approved", "declined", "converted"] as QuoteStatusFilter[]).map((filter) => (
            <Button
              key={filter}
              variant={activeFilter === filter ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveFilter(filter)}
              data-testid={`button-filter-${filter}`}
            >
              {filter === "all" ? "All" : filter.charAt(0).toUpperCase() + filter.slice(1)}
              {statusCounts[filter] ? ` (${statusCounts[filter]})` : ""}
            </Button>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search quotes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 w-[250px]"
            data-testid="input-search-quotes"
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-center py-12">Loading quotes...</div>
          ) : filteredQuotes.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {searchQuery || activeFilter !== "all"
                ? "No quotes match your filters"
                : "No quotes found. Create your first quote to get started."}
            </div>
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
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredQuotes.map((quote) => (
                  <TableRow
                    key={quote.id}
                    className="cursor-pointer hover-elevate"
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
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" data-testid={`button-quote-menu-${quote.id}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setLocation(`/quotes/${quote.id}`)}>
                            <FileText className="h-4 w-4 mr-2" />
                            View
                          </DropdownMenuItem>
                          {quote.status === "draft" && (
                            <>
                              <DropdownMenuItem onClick={() => setLocation(`/quotes/${quote.id}?edit=true`)}>
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem>
                                <Send className="h-4 w-4 mr-2" />
                                Send
                              </DropdownMenuItem>
                            </>
                          )}
                          {quote.status === "sent" && (
                            <>
                              <DropdownMenuItem>
                                <Check className="h-4 w-4 mr-2" />
                                Mark Approved
                              </DropdownMenuItem>
                              <DropdownMenuItem>
                                <X className="h-4 w-4 mr-2" />
                                Mark Declined
                              </DropdownMenuItem>
                            </>
                          )}
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

      <NewQuoteModal
        open={newQuoteModalOpen}
        onOpenChange={setNewQuoteModalOpen}
      />
    </div>
  );
}
