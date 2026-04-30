/**
 * Leads list page — Pre-quote pipeline tracking.
 *
 * Matches Jobs/Invoices/Quotes page hierarchy:
 * Header → Summary cards → Search/filters → Table
 */
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, isValid, parseISO } from "date-fns";
import { useLocation } from "wouter";
import {
  Plus, Search, FileText, Users, Briefcase, TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { FiltersButton, FilterSection } from "@/components/filters/FiltersButton";
import { EmptyState } from "@/components/ui/empty-state";
import { tableRowClass } from "@/components/ui/list-surface";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { apiRequest } from "@/lib/queryClient";
import { CreateLeadModal } from "@/components/CreateLeadModal";
import type { Lead } from "@shared/schema";

type LeadFilterStatus = "all" | "needs_action" | "quoted" | "won" | "lost";

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  new: { label: "New", variant: "default" },
  contacted: { label: "Contacted", variant: "secondary" },
  quoted: { label: "Quoted", variant: "outline" },
  won: { label: "Won", variant: "default" },
  lost: { label: "Lost", variant: "destructive" },
};

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
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const { data: leadsResponse, isLoading } = useQuery<{ data: Lead[] }>({
    queryKey: ["leads"],
    queryFn: () => apiRequest("/api/leads"),
  });

  const leads = leadsResponse?.data ?? [];

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

  const safeFormatDate = (value: unknown): string => {
    if (!value) return "-";
    const d = value instanceof Date ? value : typeof value === "string" ? parseISO(value) : new Date(String(value));
    return isValid(d) ? format(d, "MMM d, yyyy") : "-";
  };

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
          <Button size="sm" className="gap-1.5 h-9 rounded-md" onClick={() => setCreateModalOpen(true)} data-testid="button-new-lead">
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
                  <Button
                    key={f}
                    variant={activeFilter === f ? "default" : "outline"}
                    size="sm"
                    className="h-7 text-caption rounded-full"
                    onClick={() => setActiveFilter(f)}
                    data-testid={`button-filter-${f}`}
                  >
                    {f === "all" ? "All" : f === "needs_action" ? "Needs Action" : f.charAt(0).toUpperCase() + f.slice(1)}
                    {` (${statusCounts[f]})`}
                  </Button>
                ))}
              </div>
            </FilterSection>
          </FiltersButton>
        </div>

        {/* Table */}
        <div className="bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden" data-testid="table-leads">
          {isLoading ? (
            <div className="text-center py-8 text-slate-500">Loading leads...</div>
          ) : filteredLeads.length === 0 ? (
            <EmptyState
              icon={Users}
              message={searchQuery || activeFilter !== "all" ? "No leads match your filters" : "No leads yet"}
              description={!searchQuery && activeFilter === "all" ? "Create your first lead to start tracking opportunities." : undefined}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="text-caption font-medium text-slate-600">Title</TableHead>
                  <TableHead className="text-caption font-medium text-slate-600">Source</TableHead>
                  <TableHead className="text-caption font-medium text-slate-600">Priority</TableHead>
                  <TableHead className="text-caption font-medium text-slate-600">Status</TableHead>
                  <TableHead className="text-caption font-medium text-slate-600 text-right">Est. Value</TableHead>
                  <TableHead className="text-caption font-medium text-slate-600">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLeads.map((lead) => {
                  const badge = STATUS_BADGE[lead.status] || STATUS_BADGE.new;
                  return (
                    <TableRow
                      key={lead.id}
                      className={tableRowClass}
                      onClick={() => setLocation(`/leads/${lead.id}`)}
                      data-testid={`row-lead-${lead.id}`}
                    >
                      <TableCell>
                        <div className="text-row font-medium text-slate-800">{lead.title}</div>
                        {lead.description && <div className="text-caption text-slate-500 truncate max-w-[300px]">{lead.description}</div>}
                      </TableCell>
                      <TableCell>
                        <span className="text-caption text-slate-600 capitalize">{lead.sourceType}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-caption text-slate-600 capitalize">{lead.priority || "-"}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-row text-slate-700 tabular-nums">
                          {lead.estimatedValue ? `$${parseFloat(lead.estimatedValue).toLocaleString()}` : "-"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-row text-slate-500">{safeFormatDate(lead.createdAt)}</span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>

        {filteredLeads.length > 0 && (
          <div className="text-caption text-slate-500 mt-2">
            Showing {filteredLeads.length} lead{filteredLeads.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>

      <CreateLeadModal open={createModalOpen} onOpenChange={setCreateModalOpen} />
    </div>
  );
}
