/**
 * Leads workspace page — thin shell.
 *
 * Owns: URL ?view= sync, searchQuery, query, metrics/counts, KPI cards,
 * workspace shell, header, filter bar.
 * Delegates: columns, pagination, table/footer render → LeadListPanel.
 */
import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearch, useLocation } from "wouter";
import {
  Search, FileText, TrendingUp, AlertCircle, XCircle, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { OperationalWorkspace } from "@/components/workspace/OperationalWorkspace";
import { OperationalWorkspaceHeader } from "@/components/workspace/OperationalWorkspaceHeader";
import { WorkspaceCenterPane } from "@/components/workspace/WorkspaceCenterPane";
import { WorkspaceListCard } from "@/components/workspace/WorkspaceListCard";
import { WorkspaceKpiStrip, type WorkspaceKpiDescriptor } from "@/components/workspace/WorkspaceKpiStrip";
import {
  WorkspaceFilterBar,
  WorkspaceViewChip,
} from "@/components/workspace/WorkspaceFilterBar";
import {
  type EnrichedLead,
  type LeadView,
  VALID_LEAD_VIEWS,
  readLeadViewFromSearch,
  leadFilterLabel,
} from "@/lib/leadWorkspaceConfig";
import { LeadListPanel } from "./leads/LeadListPanel";
import { LeadRailBody } from "./leads/LeadRailBody";
import type { SelectedLeadContext } from "./leads/LeadActionsRail";

export default function LeadsPage() {
  const search = useSearch();
  const [, setLocation] = useLocation();

  // Active view is derived from URL; URL is the single source of truth.
  const activeView = readLeadViewFromSearch(search);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedContext, setSelectedContext] = useState<SelectedLeadContext | null>(null);

  const handleSelectionChange = useCallback((ctx: SelectedLeadContext | null) => {
    setSelectedContext(ctx);
  }, []);

  const { data: leadsResponse, isLoading, isError, refetch: refetchLeads } = useQuery<{ data: EnrichedLead[] }>({
    queryKey: ["leads"],
    queryFn: () => apiRequest("/api/leads"),
  });

  const leads: EnrichedLead[] = leadsResponse?.data ?? [];

  // Summary metrics — drives both KPI cards and chip counts.
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

  // Client-side filtering. needs_action is composite (new | contacted).
  const filteredLeads = useMemo(() => {
    let result = leads;
    if (activeView === "needs_action") result = result.filter(l => l.status === "new" || l.status === "contacted");
    else if (activeView === "quoted") result = result.filter(l => l.status === "quoted");
    else if (activeView === "won") result = result.filter(l => l.status === "won");
    else if (activeView === "lost") result = result.filter(l => l.status === "lost");

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(l =>
        l.title?.toLowerCase().includes(q) ||
        l.description?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [leads, activeView, searchQuery]);

  const statusCounts = useMemo(() => ({
    all: leads.length,
    needs_action: metrics.needsAction,
    quoted: metrics.quoted,
    won: metrics.won,
    lost: metrics.lost,
  }), [leads.length, metrics]);

  // Opaque key passed to LeadListPanel to reset its load-more cursor whenever
  // the view or search changes, without triggering a reset on background refresh.
  const resetKey = `${activeView}:${searchQuery}`;
  const hasActiveFilter = activeView !== "all" || searchQuery.trim() !== "";

  const handleViewChange = (view: LeadView) => {
    const params = new URLSearchParams(search);
    if (view === "all") params.delete("view");
    else params.set("view", view);
    // Preserve any other existing params (e.g. future tab= or date= params).
    const qs = params.toString();
    setLocation(qs ? `/leads?${qs}` : "/leads");
  };

  const kpiCards: WorkspaceKpiDescriptor[] = [
    {
      id: "needs-action",
      label: "Needs Action",
      value: String(metrics.needsAction),
      sub: "New + contacted leads",
      icon: AlertCircle,
      iconColor: "text-amber-600",
      iconBg: "bg-amber-100",
      loading: isLoading,
      testId: "kpi-leads-needs-action",
    },
    {
      id: "quoted",
      label: "Quoted",
      value: String(metrics.quoted),
      sub: "Converted to quote",
      icon: FileText,
      iconColor: "text-blue-600",
      iconBg: "bg-blue-100",
      loading: isLoading,
      testId: "kpi-leads-quoted",
    },
    {
      id: "won",
      label: "Won",
      value: String(metrics.won),
      sub: "Converted to job",
      icon: TrendingUp,
      iconColor: "text-green-600",
      iconBg: "bg-green-100",
      loading: isLoading,
      testId: "kpi-leads-won",
    },
    {
      id: "lost",
      label: "Lost",
      value: String(metrics.lost),
      sub: "Declined or expired",
      icon: XCircle,
      iconColor: "text-red-500",
      iconBg: "bg-red-100",
      loading: isLoading,
      testId: "kpi-leads-lost",
    },
  ];

  return (
    <div className="h-full bg-app-bg overflow-hidden" data-testid="leads-page">
      <OperationalWorkspace
        center={
          <>
            <OperationalWorkspaceHeader
              icon={Users}
              iconColor="text-blue-600"
              iconBg="bg-blue-50"
              title="Leads"
              subtitle="Track pre-quote pipeline opportunities."
              search={
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden="true" />
                  <Input
                    placeholder="Search leads…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 w-52 h-8 rounded-lg border-slate-200 bg-white text-sm"
                    data-testid="input-search-leads"
                  />
                </div>
              }
              primaryAction={
                <Button
                  size="sm"
                  className="gap-1.5 rounded-lg px-3.5"
                  onClick={() => setLocation("/leads/new")}
                  data-testid="button-new-lead"
                >
                  New Lead
                </Button>
              }
              kpis={
                <WorkspaceKpiStrip kpis={kpiCards} data-testid="leads-kpi-strip" />
              }
            />

            {/* Filter bar — between header card and table, matching Invoices/Quotes/Jobs */}
            <div className="shrink-0 px-4 py-2">
              <WorkspaceFilterBar variant="flat" data-testid="leads-filter-bar">
                {VALID_LEAD_VIEWS.map((view) => (
                  <WorkspaceViewChip
                    key={view}
                    size="md"
                    active={activeView === view}
                    onClick={() => handleViewChange(view)}
                    count={statusCounts[view]}
                    data-testid={`button-filter-${view}`}
                  >
                    {leadFilterLabel(view)}
                  </WorkspaceViewChip>
                ))}
              </WorkspaceFilterBar>
            </div>

            <WorkspaceListCard>
              <WorkspaceCenterPane data-testid="leads-center-pane">
                <LeadListPanel
                  rows={filteredLeads}
                  loading={isLoading}
                  isError={isError}
                  onRetry={refetchLeads}
                  resetKey={resetKey}
                  hasActiveFilter={hasActiveFilter}
                  selectedLeadId={selectedContext?.leadId}
                  onSelectionChange={handleSelectionChange}
                />
              </WorkspaceCenterPane>
            </WorkspaceListCard>
          </>
        }
        centerClassName="overflow-x-auto overflow-y-hidden"
        rightRail={selectedContext ? <LeadRailBody context={selectedContext} /> : null}
        rightRailExpanded={!!selectedContext}
        data-testid="leads-workspace"
      />
    </div>
  );
}
