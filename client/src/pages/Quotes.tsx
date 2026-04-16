/**
 * Quotes list page — Jobs-style informational overview + full quote list.
 *
 * 2026-03-28: Redesigned to match approved Jobs-style hierarchy.
 * - Same header/subtitle/card/filter/table rhythm as Jobs and Invoices pages
 * - Summary cards derived from canonical quote list data (client-side aggregation)
 * - Professional darker neutral tone (bg-slate-100, white cards, slate-50 headers)
 * - Preserved all canonical data paths, filters, search, actions
 */
import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, isValid, parseISO, startOfMonth } from "date-fns";
import { useLocation, useSearch } from "wouter";
import {
  Plus, FileText, Send, CheckCircle2, Briefcase, Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { FiltersButton, FilterSection } from "@/components/filters/FiltersButton";
import { getQuoteStatusBadge } from "@/lib/statusBadges";
import { tableRowClass } from "@/components/ui/list-surface";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { Quote } from "@shared/schema";
import { NewQuoteModal } from "@/components/NewQuoteModal";
import { formatCurrency } from "@/lib/formatters";

interface EnrichedQuote extends Quote {
  location?: { id: string; companyName: string };
  customerCompany?: { id: string; name: string };
}

type QuoteStatusFilter = "all" | "draft" | "sent" | "approved" | "declined" | "expired" | "converted";

// Summary card with optional small icon accent — matches Jobs/Invoices hierarchy
function SummaryCard({ label, value, note, icon: Icon, iconColor, iconBg }: {
  label: string; value: string; note: string;
  icon: React.ElementType; iconColor: string; iconBg: string;
}) {
  return (
    <div className="bg-white rounded-md border border-slate-200 shadow-sm px-5 py-4">
      <div className="flex items-center gap-3">
        <div className={`p-1.5 rounded-md ${iconBg}`}>
          <Icon className={`h-3.5 w-3.5 ${iconColor}`} />
        </div>
        <div className="text-xs font-medium text-slate-500">{label}</div>
      </div>
      <div className="text-2xl font-bold text-slate-900 tabular-nums mt-2">{value}</div>
      <div className="text-xs text-slate-500 mt-1">{note}</div>
    </div>
  );
}

export default function Quotes() {
  const [, setLocation] = useLocation();
  const search = useSearch();

  const initialStatus = useMemo(() => {
    const params = new URLSearchParams(search);
    const v = params.get("status");
    const valid: QuoteStatusFilter[] = ["all", "draft", "sent", "approved", "declined", "expired", "converted"];
    if (v && valid.includes(v as QuoteStatusFilter)) return v as QuoteStatusFilter;
    return "all";
  }, []);

  const [activeFilter, setActiveFilter] = useState<QuoteStatusFilter>(initialStatus);
  const [searchQuery, setSearchQuery] = useState("");
  // 2026-04-15: the list-page "New Quote" button opens the unified
  // NewQuoteModal directly. Template selection is inline inside that
  // modal — the prior two-step chooser → modal flow was collapsed.
  const [newQuoteModalOpen, setNewQuoteModalOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.get("create") === "true") {
      setNewQuoteModalOpen(true);
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

  // Phase 2: Fetch team for owner name display
  const { data: teamMembers = [] } = useQuery<{ id: string; firstName: string; lastName: string }[]>({
    queryKey: ["/api/team"],
    queryFn: async () => {
      const res = await fetch("/api/team", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const userNameMap = useMemo(() => {
    const m = new Map<string, string>();
    teamMembers.forEach(u => m.set(u.id, [u.firstName, u.lastName].filter(Boolean).join(" ") || "Unknown"));
    return m;
  }, [teamMembers]);

  const safeFormatDate = (value: unknown): string => {
    if (!value) return "-";
    const d = value instanceof Date ? value : typeof value === "string" ? parseISO(value) : new Date(String(value));
    return isValid(d) ? format(d, "MMM d, yyyy") : "-";
  };

  // Summary card metrics — derived from canonical quote list data
  const summaryMetrics = useMemo(() => {
    const monthStart = startOfMonth(new Date());
    let draftCount = 0;
    let sentThisMonth = 0;
    let acceptedCount = 0;
    let convertedCount = 0;

    for (const q of quotes) {
      if (q.status === "draft") draftCount++;
      if (q.status === "approved") acceptedCount++;
      if (q.status === "converted") convertedCount++;
      // Sent this month: status is "sent" and sentAt falls within current month
      if (q.status === "sent" && q.sentAt) {
        const sentDate = typeof q.sentAt === "string" ? parseISO(q.sentAt) : new Date(q.sentAt);
        if (isValid(sentDate) && sentDate >= monthStart) sentThisMonth++;
      }
      // Also count approved/declined/converted that were sent this month
      if (["approved", "declined", "converted"].includes(q.status) && q.sentAt) {
        const sentDate = typeof q.sentAt === "string" ? parseISO(q.sentAt) : new Date(q.sentAt);
        if (isValid(sentDate) && sentDate >= monthStart) sentThisMonth++;
      }
    }

    return { draftCount, sentThisMonth, acceptedCount, convertedCount };
  }, [quotes]);

  const filteredQuotes = useMemo(() => {
    let result = quotes.map(q => ({ ...q, statusInfo: getQuoteStatusBadge(q.status) }));
    if (activeFilter !== "all") result = result.filter(q => q.status === activeFilter);
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(q => {
        const quoteNumber = q.quoteNumber?.toLowerCase() || "";
        const title = q.title?.toLowerCase() || "";
        const locationName = q.location?.companyName?.toLowerCase() || "";
        const customerName = q.customerCompany?.name?.toLowerCase() || "";
        return quoteNumber.includes(query) || title.includes(query) || locationName.includes(query) || customerName.includes(query);
      });
    }
    return result;
  }, [quotes, activeFilter, searchQuery]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: quotes.length };
    for (const q of quotes) counts[q.status] = (counts[q.status] || 0) + 1;
    return counts;
  }, [quotes]);

  // List stability: single return path — loading state renders inside content area only
  return (
    <div className="min-h-screen bg-[#F4F8F4]" data-testid="quotes-page">
      <div className="p-6 space-y-5">

        {/* ── 1. Header Row ── */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Quotes</h1>
            <p className="text-sm text-slate-500 mt-0.5">Quote pipeline overview with full quote list.</p>
          </div>
          <Button size="sm" className="gap-1.5 h-9 rounded-md" onClick={() => setNewQuoteModalOpen(true)} data-testid="button-new-quote">
            <Plus className="h-4 w-4" />
            New Quote
          </Button>
        </div>

        {/* ── 2. Summary Cards Row ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard
            label="Draft Quotes"
            value={String(summaryMetrics.draftCount)}
            note="Awaiting review or sending"
            icon={FileText} iconColor="text-slate-600" iconBg="bg-slate-100"
          />
          <SummaryCard
            label="Sent This Month"
            value={String(summaryMetrics.sentThisMonth)}
            note="Quotes sent in current month"
            icon={Send} iconColor="text-blue-600" iconBg="bg-blue-100"
          />
          <SummaryCard
            label="Accepted"
            value={String(summaryMetrics.acceptedCount)}
            note="Approved by client"
            icon={CheckCircle2} iconColor="text-emerald-600" iconBg="bg-emerald-100"
          />
          <SummaryCard
            label="Converted to Jobs"
            value={String(summaryMetrics.convertedCount)}
            note="Quotes converted to active jobs"
            icon={Briefcase} iconColor="text-violet-600" iconBg="bg-violet-100"
          />
        </div>

        {/* ── 3. Search / Filter Row ── */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search quotes, clients, numbers"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 rounded-md border-slate-200 bg-white"
              data-testid="input-search-quotes"
            />
          </div>
          <FiltersButton activeCount={activeFilter !== "all" ? 1 : 0} onClear={() => setActiveFilter("all")}>
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
        </div>

        {/* ── 4. Main Table ── */}
        <div className="bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden" data-testid="table-quotes">
          {isLoading ? (
            <div className="text-center py-8 text-slate-500" data-testid="quotes-loading">Loading quotes...</div>
          ) : filteredQuotes.length === 0 ? (
            <EmptyState
              icon={FileText}
              message={searchQuery || activeFilter !== "all" ? "No quotes match your filters" : "No quotes found"}
              description={!searchQuery && activeFilter === "all" ? "Create your first quote to get started." : undefined}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="text-xs font-medium text-slate-600">Client / Location</TableHead>
                  <TableHead className="text-xs font-medium text-slate-600">Quote #</TableHead>
                  <TableHead className="text-xs font-medium text-slate-600">Title</TableHead>
                  <TableHead className="text-xs font-medium text-slate-600">Status</TableHead>
                  <TableHead className="text-xs font-medium text-slate-600">Owner</TableHead>
                  <TableHead className="text-xs font-medium text-slate-600 text-right">Total</TableHead>
                  <TableHead className="text-xs font-medium text-slate-600">Updated</TableHead>
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
                      <div>
                        <p className="text-sm font-medium text-slate-800" data-testid={`text-quote-client-${quote.id}`}>
                          {quote.customerCompany?.name || quote.location?.companyName || "Unknown"}
                        </p>
                        {quote.customerCompany?.name && quote.location?.companyName && (
                          <p className="text-xs text-slate-500">{quote.location.companyName}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-sm text-slate-800" data-testid={`text-quote-number-${quote.id}`}>
                        {quote.quoteNumber || `Q-${quote.id.slice(0, 8)}`}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-slate-500">{quote.title || "-"}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Badge variant={quote.statusInfo.variant}>{quote.statusInfo.label}</Badge>
                        {(quote as any).assessmentStatus === "required" && (
                          <Badge variant="outline" className="text-[9px] border-amber-300 text-amber-700">Assessment needed</Badge>
                        )}
                        {(quote as any).assessmentStatus === "scheduled" && (
                          <Badge variant="outline" className="text-[9px] border-amber-400 text-amber-800 bg-amber-50">Assessment scheduled</Badge>
                        )}
                        {(quote as any).assessmentStatus === "completed" && (
                          <Badge variant="outline" className="text-[9px] border-emerald-300 text-emerald-700">Assessment done</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-slate-500">{(quote as any).salesOwnerUserId ? userNameMap.get((quote as any).salesOwnerUserId) || "—" : "—"}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-sm text-slate-700 tabular-nums">{formatCurrency(quote.total)}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-slate-500">{safeFormatDate(quote.updatedAt || quote.createdAt)}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {filteredQuotes.length > 0 && (
          <div className="text-xs text-slate-500 mt-2" data-testid="text-quote-count">
            Showing {filteredQuotes.length} quote{filteredQuotes.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>

      <NewQuoteModal
        open={newQuoteModalOpen}
        onOpenChange={setNewQuoteModalOpen}
      />
    </div>
  );
}
