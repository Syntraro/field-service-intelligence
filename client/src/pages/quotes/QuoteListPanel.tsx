import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { addDays, parseISO } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/StatusBadge";
import { getQuoteStatusMeta } from "@/lib/statusBadges";
import { EntityNumber } from "@/components/common/EntityNumber";
import { EntityListTable, type EntityListColumn } from "@/components/lists/EntityListTable";
import { ListLoadMoreFooter } from "@/components/lists/ListLoadMoreFooter";
import { formatCurrency } from "@/lib/formatters";
import type { Quote } from "@shared/schema";
import type { QuoteView } from "./QuoteViewRail";

// ── Types ─────────────────────────────────────────────────────────────────────

interface EnrichedQuote extends Quote {
  location?: { id: string; companyName: string; address: string | null; city: string | null };
  customerCompany?: { id: string; name: string };
}

export interface QuoteSelectionContext {
  quoteId: string;
}

interface QuoteListPanelProps {
  activeView: QuoteView;
  onSelectionChange?: (ctx: QuoteSelectionContext | null) => void;
  externalSearchQuery?: string;
  externalActiveFilter?: string;
}

const QUOTES_PAGE_SIZE = 50;

// ── View filtering ────────────────────────────────────────────────────────────

function applyViewFilter(quotes: EnrichedQuote[], view: QuoteView): EnrichedQuote[] {
  const now = new Date();
  const sevenDaysOut = addDays(now, 7);

  switch (view) {
    case "all":       return quotes;
    case "draft":     return quotes.filter((q) => q.status === "draft");
    case "sent":      return quotes.filter((q) => q.status === "sent");
    case "approved":  return quotes.filter((q) => q.status === "approved");
    case "expired":   return quotes.filter((q) => q.status === "expired");
    case "declined":  return quotes.filter((q) => q.status === "declined");
    case "converted": return quotes.filter((q) => q.status === "converted");
    case "awaiting-approval":
      return quotes.filter((q) => {
        if (q.status !== "sent") return false;
        if (!q.expiryDate) return true;
        return parseISO(q.expiryDate) > now;
      });
    case "expiring-soon":
      return quotes.filter((q) => {
        if (q.status !== "sent" || !q.expiryDate) return false;
        const expiry = parseISO(q.expiryDate);
        return expiry > now && expiry <= sevenDaysOut;
      });
    case "needs-assessment":
      return quotes.filter((q) => q.assessmentStatus === "required");
    case "assessment-scheduled":
      return quotes.filter((q) => q.assessmentStatus === "scheduled");
    default:
      return quotes;
  }
}

// ── QuoteListPanel ────────────────────────────────────────────────────────────

export function QuoteListPanel({
  activeView,
  onSelectionChange,
  externalSearchQuery = "",
  externalActiveFilter,
}: QuoteListPanelProps) {
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(QUOTES_PAGE_SIZE);

  // Reset visible count on view/search change.
  useEffect(() => { setVisibleCount(QUOTES_PAGE_SIZE); }, [activeView, externalSearchQuery, externalActiveFilter]);

  // Deselect when view changes.
  useEffect(() => {
    setSelectedQuoteId(null);
    onSelectionChange?.(null);
  }, [activeView]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: quotes = [], isLoading, isError, refetch } = useQuery<
    { data: EnrichedQuote[]; meta: unknown },
    Error,
    EnrichedQuote[]
  >({
    queryKey: ["/api/quotes/list"],
    queryFn: async () => {
      const res = await fetch("/api/quotes/list?offset=0&limit=200", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch quotes");
      return res.json();
    },
    select: (response) => response.data,
  });

  type QuoteRow = EnrichedQuote & { statusMeta: ReturnType<typeof getQuoteStatusMeta> };

  const filteredQuotes = useMemo<QuoteRow[]>(() => {
    let result: QuoteRow[] = quotes.map((q) => ({ ...q, statusMeta: getQuoteStatusMeta(q.status) }));

    // Apply view filter first.
    result = applyViewFilter(result as EnrichedQuote[], activeView) as QuoteRow[];

    // Apply search.
    if (externalSearchQuery.trim()) {
      const q = externalSearchQuery.toLowerCase();
      result = result.filter((r) => {
        const quoteNumber = r.quoteNumber?.toLowerCase() ?? "";
        const title = r.title?.toLowerCase() ?? "";
        const locationName = r.location?.companyName?.toLowerCase() ?? "";
        const customerName = r.customerCompany?.name?.toLowerCase() ?? "";
        return quoteNumber.includes(q) || title.includes(q) || locationName.includes(q) || customerName.includes(q);
      });
    }

    return result;
  }, [quotes, activeView, externalSearchQuery]);

  const quoteColumns = useMemo<EntityListColumn<QuoteRow>[]>(() => [
    {
      id: "client",
      header: "Client / Location",
      kind: "primary",
      ratio: 1.5,
      cell: {
        type: "entity-primary",
        value: (q) => q.customerCompany?.name || q.location?.companyName || "Unknown",
        secondary: (q) => q.location?.city ?? undefined,
        testId: (q) => `text-quote-client-${q.id}`,
      },
    },
    {
      id: "title",
      header: "Summary",
      kind: "text",
      ratio: 1.3,
      cell: { type: "entity-text", value: (q) => q.title || "—" },
    },
    {
      id: "address",
      header: "Service Address",
      kind: "text",
      ratio: 1.1,
      cell: {
        type: "entity-text",
        value: (q) =>
          [q.location?.address, q.location?.city].filter(Boolean).join(", ") || "—",
      },
    },
    {
      id: "status",
      header: "Status",
      kind: "status",
      cell: {
        type: "customRender",
        reason: "multi-badge: StatusBadge + assessment sub-badges",
        render: (q) => (
          <>
            <StatusBadge meta={q.statusMeta} />
            {q.assessmentStatus === "required" && (
              <Badge variant="outline" className="text-helper border-amber-300 text-amber-700">
                Assessment needed
              </Badge>
            )}
            {q.assessmentStatus === "scheduled" && (
              <Badge variant="outline" className="text-helper border-amber-400 text-amber-800 bg-amber-50">
                Assessment scheduled
              </Badge>
            )}
            {q.assessmentStatus === "completed" && (
              <Badge variant="outline" className="text-helper border-emerald-300 text-emerald-700">
                Assessment done
              </Badge>
            )}
          </>
        ),
      },
    },
    {
      id: "created",
      header: "Created",
      kind: "date",
      cell: { type: "entity-date", value: (q) => q.createdAt },
    },
    {
      id: "total",
      header: "Total",
      kind: "money",
      cell: { type: "entity-money", value: (q) => q.total },
    },
    {
      id: "quoteNumber",
      header: "Quote #",
      kind: "badge",
      ratio: 0.7,
      minWidthPx: 96,
      cell: {
        type: "customRender",
        reason: "EntityNumber chip",
        render: (q) => (
          <EntityNumber variant="primary" data-testid={`text-quote-number-${q.id}`}>
            {q.quoteNumber || `Q-${q.id.slice(0, 8)}`}
          </EntityNumber>
        ),
      },
    },
  ], []);

  const handleRowClick = (quote: QuoteRow) => {
    const next = selectedQuoteId === quote.id ? null : quote.id;
    setSelectedQuoteId(next);
    onSelectionChange?.(next ? { quoteId: next } : null);
  };

  return (
    <>
      <EntityListTable<QuoteRow>
        rows={filteredQuotes.slice(0, visibleCount)}
        rowKey={(q) => q.id}
        onRowClick={handleRowClick}
        selectedRowKey={selectedQuoteId ?? undefined}
        selectedHighlightClass="bg-blue-50"
        fillHeight
        loadingState={isLoading ? { kind: "loading", title: "Loading quotes…", testId: "quotes-loading" } : undefined}
        emptyState={
          externalSearchQuery
            ? { kind: "no-results", title: "No quotes match your search", icon: "file" }
            : activeView !== "all"
              ? { kind: "no-results", title: "No quotes in this view", icon: "file" }
              : { kind: "empty", title: "No quotes found", icon: "file", description: "Create your first quote to get started." }
        }
        errorState={
          isError
            ? { kind: "error", title: "Failed to load quotes", primaryAction: { label: "Retry", onClick: () => refetch(), variant: "outline" } }
            : undefined
        }
        columns={quoteColumns}
        data-testid="quote-list-table"
      />
      <ListLoadMoreFooter
        visibleCount={Math.min(visibleCount, filteredQuotes.length)}
        totalCount={filteredQuotes.length}
        hasMore={visibleCount < filteredQuotes.length}
        onLoadMore={() => setVisibleCount((c) => c + QUOTES_PAGE_SIZE)}
        label="quote"
      />
    </>
  );
}
