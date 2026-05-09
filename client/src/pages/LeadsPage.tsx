/**
 * Leads list page — Pre-quote pipeline tracking.
 *
 * Matches Jobs/Invoices/Quotes page hierarchy:
 * Header → Summary cards → Search/filters → Table
 */
import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Plus, Search, FileText, Users, Briefcase, TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
// 2026-05-08 chip Phase 2: status filter buttons → FilterChip.
import { FilterChip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { FiltersButton, FilterSection } from "@/components/filters/FiltersButton";
// 2026-05-09: state-block migration — EmptyState replaced by typed descriptors.
// 2026-05-03: migrated from shadcn `<Table>` to canonical EntityListTable.
// See `client/src/components/lists/EntityListTable.tsx` for the rationale
// and the per-kind sizing rules baked into the component.
import { EntityListTable, type EntityListColumn } from "@/components/lists/EntityListTable";
import { getLeadStatusMeta } from "@/lib/statusBadges";
import { ListLoadMoreFooter } from "@/components/lists/ListLoadMoreFooter";
import { apiRequest } from "@/lib/queryClient";
// 2026-05-06: lead creation moved to /leads/new (full-page CreateLeadPage).
// The button below navigates via wouter instead of opening a modal.
import type { Lead } from "@shared/schema";

interface EnrichedLead extends Lead {
  locationDisplayName: string | null;
  locationSiteName: string | null;
  locationCity: string | null;
}

type LeadFilterStatus = "all" | "needs_action" | "quoted" | "won" | "lost";

// 2026-05-03 Load more pattern: render in batches of 50 client-side. The
// underlying `/api/leads` query fetches the full list per the existing
// behavior; this only controls how many rows render at a time. Reset on
// filter / search change.
const LEADS_PAGE_SIZE = 50;

// 2026-05-03 status consolidation: the inline `STATUS_BADGE` map was
// migrated to `getLeadStatusMeta` in `lib/statusBadges.ts`. The status
// cell now renders via the canonical `<StatusBadge>` component.

// Column order (2026-05-09): Client · Title · Source · Priority · Status · Est. Value · Created
// Client is the entity identity (company + location helper text).
// Title is the flexible/truncating description column.
// Module-scoped (stable identity across renders — no closures on render-state).
const LEAD_COLUMNS: EntityListColumn<EnrichedLead>[] = [
  {
    id: "client",
    header: "Client",
    kind: "primary",
    ratio: 1.4,
    minWidthPx: 160,
    cell: {
      type: "entity-primary",
      value: (lead) => lead.locationDisplayName || "Unknown Client",
      secondary: (lead) => lead.locationSiteName || lead.locationCity || undefined,
    },
  },
  {
    id: "title",
    header: "Title",
    kind: "text",
    ratio: 1.5,
    cell: {
      type: "entity-text",
      value: (lead) => lead.title,
    },
  },
  {
    id: "source",
    header: "Source",
    kind: "text",
    ratio: 0.7,
    cell: {
      type: "entity-text",
      value: (lead) => lead.sourceType
        ? lead.sourceType.charAt(0).toUpperCase() + lead.sourceType.slice(1)
        : null,
    },
  },
  {
    id: "priority",
    header: "Priority",
    kind: "text",
    ratio: 0.6,
    cell: {
      type: "entity-text",
      value: (lead) => lead.priority
        ? lead.priority.charAt(0).toUpperCase() + lead.priority.slice(1)
        : null,
    },
  },
  {
    id: "status",
    header: "Status",
    kind: "status",
    cell: {
      type: "entity-status",
      getStatusMeta: (lead) => getLeadStatusMeta(lead.status),
    },
  },
  {
    id: "estValue",
    header: "Est. Value",
    kind: "money",
    cell: {
      type: "entity-money",
      value: (lead) => lead.estimatedValue,
    },
  },
  {
    id: "createdAt",
    header: "Created",
    kind: "date",
    cell: {
      type: "entity-date",
      value: (lead) => lead.createdAt,
    },
  },
];

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
        <div className="text-caption font-medium text-slate-500">{label}</div>
      </div>
      <div className="text-page-title font-bold text-slate-900 tabular-nums mt-2">{value}</div>
      <div className="text-caption text-slate-500 mt-1">{note}</div>
    </div>
  );
}

export default function LeadsPage() {
  const [, setLocation] = useLocation();
  const [activeFilter, setActiveFilter] = useState<LeadFilterStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(LEADS_PAGE_SIZE);

  // Reset slice on filter / search change so the user always sees the
  // first page of the new result set.
  useEffect(() => { setVisibleCount(LEADS_PAGE_SIZE); }, [activeFilter, searchQuery]);

  const { data: leadsResponse, isLoading, isError, refetch: refetchLeads } = useQuery<{ data: EnrichedLead[] }>({
    queryKey: ["leads"],
    queryFn: () => apiRequest("/api/leads"),
  });

  const leads: EnrichedLead[] = leadsResponse?.data ?? [];

  // Summary metrics
  const metrics = useMemo(() => {
    let needsAction = 0, quoted = 0, won = 0, lost = 0;
    for (const l of leads) {
      if (l.status === "new" || l.status === "contacted") needsAction++;
      if (l.status === "quoted") quoted++;
      if (l.status === "won") won++;
      if (l.status === "lost") lost++;
    }
    return { needsAction, quoted, won, lost, total: leads.length };
  }, [leads]);

  const filteredLeads = useMemo(() => {
    let result = leads;
    if (activeFilter === "needs_action") result = result.filter(l => l.status === "new" || l.status === "contacted");
    else if (activeFilter === "quoted") result = result.filter(l => l.status === "quoted");
    else if (activeFilter === "won") result = result.filter(l => l.status === "won");
    else if (activeFilter === "lost") result = result.filter(l => l.status === "lost");

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(l =>
        l.title?.toLowerCase().includes(q) ||
        l.description?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [leads, activeFilter, searchQuery]);

  const statusCounts = useMemo(() => ({
    all: leads.length,
    needs_action: metrics.needsAction,
    quoted: metrics.quoted,
    won: metrics.won,
    lost: metrics.lost,
  }), [leads.length, metrics]);

  // List stability: single return path — loading state renders inside content area only
  return (
    <div className="min-h-screen bg-app-bg" data-testid="leads-page">
      <div className="p-6 space-y-5">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-page-title font-semibold text-slate-900">Leads</h1>
            <p className="text-row text-slate-500 mt-0.5">Sales pipeline overview with full lead list.</p>
          </div>
          {/* 2026-05-06: navigates to the full-page /leads/new flow.
              The data-testid is preserved so existing test pins still match. */}
          <Button size="sm" className="gap-1.5 h-9 rounded-md" onClick={() => setLocation("/leads/new")} data-testid="button-new-lead">
            <Plus className="h-4 w-4" />
            New Lead
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label="Needs Action" value={String(metrics.needsAction)} note="New + contacted leads" icon={Users} iconColor="text-blue-600" iconBg="bg-blue-100" />
          <SummaryCard label="Quoted" value={String(metrics.quoted)} note="Converted to quote" icon={FileText} iconColor="text-amber-600" iconBg="bg-amber-100" />
          <SummaryCard label="Won" value={String(metrics.won)} note="Converted to job" icon={Briefcase} iconColor="text-emerald-600" iconBg="bg-emerald-100" />
          <SummaryCard label="Lost" value={String(metrics.lost)} note="Declined or expired" icon={TrendingUp} iconColor="text-slate-500" iconBg="bg-slate-100" />
        </div>

        {/* Search / Filters */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search leads..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 rounded-md border-slate-200 bg-white"
              data-testid="input-search-leads"
            />
          </div>
          <FiltersButton activeCount={activeFilter !== "all" ? 1 : 0} onClear={() => setActiveFilter("all")}>
            <FilterSection label="Status">
              <div className="flex flex-wrap gap-1.5">
                {(["all", "needs_action", "quoted", "won", "lost"] as LeadFilterStatus[]).map((f) => (
                  <FilterChip
                    key={f}
                    selected={activeFilter === f}
                    onClick={() => setActiveFilter(f)}
                    data-testid={`button-filter-${f}`}
                  >
                    {f === "all" ? "All" : f === "needs_action" ? "Needs Action" : f.charAt(0).toUpperCase() + f.slice(1)}
                    {` (${statusCounts[f]})`}
                  </FilterChip>
                ))}
              </div>
            </FilterSection>
          </FiltersButton>
        </div>

        {/* Table */}
        <EntityListTable<EnrichedLead>
          rows={filteredLeads.slice(0, visibleCount)}
          rowKey={(lead) => lead.id}
          onRowClick={(lead) => setLocation(`/leads/${lead.id}`)}
          loadingState={isLoading}
          emptyState={
            searchQuery || activeFilter !== "all"
              ? { kind: "no-results", title: "No leads match your filters", icon: "users" }
              : { kind: "empty", title: "No leads yet", icon: "users", description: "Create your first lead to start tracking opportunities." }
          }
          errorState={
            isError
              ? { kind: "error", title: "Failed to load leads", primaryAction: { label: "Retry", onClick: () => refetchLeads(), variant: "outline" } }
              : undefined
          }
          columns={LEAD_COLUMNS}
        />

        <ListLoadMoreFooter
          visibleCount={Math.min(visibleCount, filteredLeads.length)}
          totalCount={filteredLeads.length}
          hasMore={visibleCount < filteredLeads.length}
          onLoadMore={() => setVisibleCount((c) => c + LEADS_PAGE_SIZE)}
          label="lead"
        />
      </div>

    </div>
  );
}
