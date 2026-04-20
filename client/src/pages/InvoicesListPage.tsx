/**
 * Invoices list page — Jobs-style informational overview + full invoice list.
 *
 * 2026-03-28: Redesigned to match approved Jobs-style hierarchy.
 * - Same header/subtitle/card/filter/table rhythm as Jobs page
 * - Summary cards from canonical /api/invoices/stats endpoint
 * - Professional darker neutral tone (bg-slate-100, white cards, slate-50 headers)
 * - Preserved all canonical data paths, filters, search, QBO sync, actions
 */
import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { format, isValid, parseISO } from "date-fns";
import { useLocation, useSearch, Link } from "wouter";
import {
  Plus, FileText, DollarSign, AlertTriangle, MoreHorizontal, RefreshCw, Search, Send,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
// Phase 14 (2026-04-12): bulk send for multiple invoices.
import { BatchSendInvoicesModal } from "@/components/communication/BatchSendInvoicesModal";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { QboSyncBadge, isQboSynced } from "@/components/invoice/QboSyncBanner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { FiltersButton, FilterSection } from "@/components/filters/FiltersButton";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/formatters";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { tableRowClass, listPrimaryClass, listSecondaryClass } from "@/components/ui/list-surface";
import type { Invoice } from "@shared/schema";
import { UNPAID_INVOICE_STATUSES } from "@shared/invoiceStatus";
import { getInvoiceStatusBadge } from "@/lib/statusBadges";

interface EnrichedInvoice extends Invoice {
  locationName?: string;
  customerCompanyName?: string;
  locationDisplayName?: string;
  isPastDue?: boolean;
}

interface InvoiceStats {
  outstanding: { amount: number; count: number };
  issuedLast30Days: { count: number };
  averageInvoice: number;
  overdue: { amount: number; count: number };
}

/**
 * Invoice list filters.
 *
 * Real lifecycle statuses: draft, awaiting_payment, partial_paid, paid, voided.
 * Derived state: overdue (computed from isPastDue, never persisted).
 * QBO sync flags: qbo_synced, qbo_out_of_sync (independent of lifecycle).
 *
 * Legacy "sent" rows are matched by the "awaiting_payment" filter (see filter
 * predicate below) and do not appear as a distinct user-facing option.
 * "viewed" was never a real lifecycle status — removed 2026-04-08.
 */
type InvoiceStatusFilter = "all" | "draft" | "awaiting_payment" | "partial_paid" | "paid" | "voided" | "overdue" | "qbo_synced" | "qbo_out_of_sync";

// Phase 14 (2026-04-12): added 40px column at start for selection checkbox.
const INVOICES_GRID_COLS = "40px minmax(260px, 1.8fr) 1.2fr 0.8fr 0.8fr 0.9fr 0.7fr 0.7fr 50px";

// Summary card with optional small icon accent — matches Jobs page hierarchy
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

export default function InvoicesListPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [activeFilter, setActiveFilter] = useState<InvoiceStatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  // Phase 14 (2026-04-12): bulk selection + send.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // 2026-04-18 Phase 9 (collections): bulk reminders. Reuses the
  // canonical `invoiceReminderService.sendOne` per invoice server-side
  // via `POST /api/invoices/bulk-send-reminders`. Gate failures (paused,
  // snoozed, billing-locked) come back in the `skipped` array and are
  // surfaced in the toast alongside the success count.
  const UNPAID_STATUSES = new Set(UNPAID_INVOICE_STATUSES);
  const bulkRemindersMutation = useMutation({
    mutationFn: async (invoiceIds: string[]) =>
      apiRequest<{
        totalCount: number;
        successCount: number;
        skippedCount: number;
        failedCount: number;
        succeeded: string[];
        skipped: { invoiceId: string; reason: string; code?: string }[];
        failed: { invoiceId: string; reason: string }[];
      }>("/api/invoices/bulk-send-reminders", {
        method: "POST",
        body: JSON.stringify({ invoiceIds }),
      }),
    onSuccess: (data) => {
      const parts: string[] = [];
      if (data.successCount > 0) parts.push(`${data.successCount} sent`);
      if (data.skippedCount > 0) parts.push(`${data.skippedCount} skipped`);
      if (data.failedCount > 0) parts.push(`${data.failedCount} failed`);
      toast({
        title: data.failedCount > 0 ? "Reminders partial" : "Reminders sent",
        description: parts.join(", ") + ".",
        variant: data.failedCount > 0 ? "destructive" : undefined,
      });
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/invoices/stats"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (err: any) => {
      toast({ title: "Reminders failed", description: err?.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    const params = new URLSearchParams(search);
    const filterParam = params.get("filter");
    const validFilters: InvoiceStatusFilter[] = ["all", "draft", "awaiting_payment", "partial_paid", "paid", "voided", "overdue", "qbo_synced", "qbo_out_of_sync"];
    if (filterParam && validFilters.includes(filterParam as InvoiceStatusFilter)) {
      setActiveFilter(filterParam as InvoiceStatusFilter);
    }
  }, [search]);

  const { data: invoices = [], isLoading } = useQuery<{ data: EnrichedInvoice[]; meta: { limit: number; hasMore: boolean; nextOffset?: number } }, Error, EnrichedInvoice[]>({
    queryKey: ["invoices", "feed", { offset: 0, limit: 200 }],
    queryFn: async () => {
      const res = await fetch("/api/invoices/list?offset=0&limit=200", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch invoices");
      return res.json();
    },
    select: (response) => response.data,
  });

  const { data: stats } = useQuery<InvoiceStats>({
    queryKey: ["invoices", "stats"],
    queryFn: async () => {
      const res = await fetch("/api/invoices/stats", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch invoice stats");
      return res.json();
    },
  });

  // 2026-04-18 Phase 10 (payments clarity): surface invoices whose
  // status / money fields have drifted apart so a manager can
  // reconcile them. Manager-gated endpoint returns [] to non-managers
  // — the banner silently stays hidden in that case.
  const { data: reconciliationData } = useQuery<{
    data: Array<{
      invoiceId: string;
      invoiceNumber: string | null;
      status: string | null;
      balance: string | null;
      amountPaid: string | null;
      locationDisplayName: string | null;
      kind: "paid_with_balance" | "zero_balance_still_unpaid" | "partial_without_payment";
    }>;
    count: number;
  }>({
    queryKey: ["invoices", "reconciliation"],
    queryFn: async () => {
      const res = await fetch("/api/invoices/reconciliation", { credentials: "include" });
      if (!res.ok) return { data: [], count: 0 };
      return res.json();
    },
    staleTime: 60_000,
  });
  const reconciliationIssues = reconciliationData?.data ?? [];

  const outstandingAmount = stats?.outstanding?.amount ?? 0;
  const outstandingCount = stats?.outstanding?.count ?? 0;
  const issuedCount30d = stats?.issuedLast30Days?.count ?? 0;
  const overdueAmount = stats?.overdue?.amount ?? 0;
  const overdueCount = stats?.overdue?.count ?? 0;
  const averageInvoiceAmount = stats?.averageInvoice ?? 0;

  const safeFormatDate = (value: unknown): string => {
    if (!value) return "-";
    const d = value instanceof Date ? value : typeof value === "string" ? parseISO(value) : new Date(String(value));
    return isValid(d) ? format(d, "MMM d, yyyy") : "-";
  };

  const enrichedInvoices = useMemo(() => {
    return invoices.map(inv => ({
      ...inv,
      // 2026-04-18 Phase 9: pass dueDate so awaiting-payment invoices
      // within the Due Soon window render the "Due Soon" badge.
      statusInfo: getInvoiceStatusBadge(inv.status, inv.isPastDue ?? false, inv.dueDate),
    }));
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    let result = enrichedInvoices.slice();
    if (activeFilter !== "all") {
      result = result.filter(inv => {
        if (activeFilter === "overdue") return inv.statusInfo.isOverdue;
        if (activeFilter === "qbo_synced") return isQboSynced(inv) && !inv.qboOutOfSync;
        if (activeFilter === "qbo_out_of_sync") return inv.qboOutOfSync === true;
        if (activeFilter === "awaiting_payment") return inv.status === "awaiting_payment" || inv.status === "sent";
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
        return invoiceNumber.includes(query) || locationName.includes(query) || companyName.includes(query) || description.includes(query);
      });
    }
    return result;
  }, [enrichedInvoices, activeFilter, searchQuery]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: enrichedInvoices.length, awaiting_payment: 0 };
    for (const inv of enrichedInvoices) {
      if (inv.status !== "awaiting_payment" && inv.status !== "sent") {
        counts[inv.status] = (counts[inv.status] || 0) + 1;
      }
      if (inv.status === "awaiting_payment" || inv.status === "sent") {
        counts["awaiting_payment"] = (counts["awaiting_payment"] || 0) + 1;
      }
      if (inv.statusInfo.isOverdue) counts["overdue"] = (counts["overdue"] || 0) + 1;
      if (isQboSynced(inv)) {
        if (inv.qboOutOfSync) counts["qbo_out_of_sync"] = (counts["qbo_out_of_sync"] || 0) + 1;
        else counts["qbo_synced"] = (counts["qbo_synced"] || 0) + 1;
      }
    }
    return counts;
  }, [enrichedInvoices]);

  // List stability: single return path — loading state renders inside content area only
  return (
    <div className="min-h-screen bg-[#F4F8F4]" data-testid="invoices-page">
      <div className="p-6 space-y-5">

        {/* ── 1. Header Row ── */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Invoices</h1>
            <p className="text-sm text-slate-500 mt-0.5">Invoice performance overview with full invoice list.</p>
          </div>
          <Link href="/invoices/new">
            <Button size="sm" className="gap-1.5 h-9 rounded-md" data-testid="button-new-invoice">
              <Plus className="h-4 w-4" />
              New Invoice
            </Button>
          </Link>
        </div>

        {/* ── 2. Summary Cards Row ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard
            label="Outstanding"
            value={formatCurrency(outstandingAmount)}
            note={`${outstandingCount} outstanding invoice${outstandingCount !== 1 ? "s" : ""}`}
            icon={DollarSign} iconColor="text-amber-600" iconBg="bg-amber-100"
          />
          <SummaryCard
            label="Issued This Month"
            value={String(issuedCount30d)}
            note="Last 30 days"
            icon={FileText} iconColor="text-blue-600" iconBg="bg-blue-100"
          />
          <SummaryCard
            label="Average Invoice"
            value={formatCurrency(averageInvoiceAmount)}
            note="Based on issued invoices"
            icon={DollarSign} iconColor="text-emerald-600" iconBg="bg-emerald-100"
          />
          <SummaryCard
            label="Overdue"
            value={formatCurrency(overdueAmount)}
            note={overdueCount > 0 ? `${overdueCount} overdue invoice${overdueCount !== 1 ? "s" : ""}` : "No overdue invoices"}
            icon={AlertTriangle} iconColor="text-red-600" iconBg="bg-red-100"
          />
        </div>

        {/* ── 2b. Reconciliation banner (Phase 10) ── */}
        {reconciliationIssues.length > 0 && (
          <div
            className="bg-amber-50 border border-amber-200 rounded-md px-4 py-2.5 flex items-start gap-3"
            data-testid="reconciliation-banner"
          >
            <AlertTriangle className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-amber-900">
                {reconciliationIssues.length} invoice
                {reconciliationIssues.length === 1 ? "" : "s"} need
                {reconciliationIssues.length === 1 ? "s" : ""} reconciliation
              </div>
              <div className="text-xs text-amber-800 mt-0.5">
                Status and payment totals have drifted on these rows. Open
                each to review and correct.
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                {reconciliationIssues.slice(0, 6).map((iss) => {
                  const label =
                    iss.kind === "paid_with_balance"
                      ? "Paid · balance owed"
                      : iss.kind === "zero_balance_still_unpaid"
                        ? "Unpaid · no balance"
                        : "Partial · no payments";
                  return (
                    <Link
                      key={iss.invoiceId}
                      href={`/invoices/${iss.invoiceId}`}
                      className="text-amber-900 hover:underline inline-flex items-center gap-1"
                      data-testid={`reconciliation-link-${iss.invoiceId}`}
                    >
                      <span className="font-medium">
                        {iss.invoiceNumber ?? "—"}
                      </span>
                      <span className="text-amber-700">· {label}</span>
                    </Link>
                  );
                })}
                {reconciliationIssues.length > 6 && (
                  <span className="text-amber-700">
                    +{reconciliationIssues.length - 6} more
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── 3. Search / Filter Row ── */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search invoices, clients, numbers"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 rounded-md border-slate-200 bg-white"
              data-testid="input-search-invoices"
            />
          </div>
          <FiltersButton activeCount={activeFilter !== "all" ? 1 : 0} onClear={() => setActiveFilter("all")}>
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
                    {filter === "all" ? "All" : filter === "awaiting_payment" ? "Unpaid" : filter === "partial_paid" ? "Partial" : filter === "overdue" ? "Overdue" : filter.charAt(0).toUpperCase() + filter.slice(1)}
                    {statusCounts[filter] ? ` (${statusCounts[filter]})` : ""}
                  </Button>
                ))}
              </div>
            </FilterSection>
            {(statusCounts["qbo_synced"] || statusCounts["qbo_out_of_sync"]) ? (
              <FilterSection label="QuickBooks Sync">
                <div className="flex flex-wrap gap-1.5">
                  <Button variant={activeFilter === "qbo_synced" ? "default" : "outline"} size="sm" className="h-7 text-xs rounded-full gap-1" onClick={() => setActiveFilter("qbo_synced")} data-testid="button-filter-qbo-synced">
                    <RefreshCw className="h-3 w-3" />
                    Synced {statusCounts["qbo_synced"] ? `(${statusCounts["qbo_synced"]})` : ""}
                  </Button>
                  {statusCounts["qbo_out_of_sync"] > 0 && (
                    <Button variant={activeFilter === "qbo_out_of_sync" ? "destructive" : "outline"} size="sm" className="h-7 text-xs rounded-full gap-1" onClick={() => setActiveFilter("qbo_out_of_sync")} data-testid="button-filter-qbo-out-of-sync">
                      <AlertTriangle className="h-3 w-3" />
                      Out of Sync ({statusCounts["qbo_out_of_sync"]})
                    </Button>
                  )}
                </div>
              </FilterSection>
            ) : null}
          </FiltersButton>
        </div>

        {/* ── 4. Main Table ── */}
        <div className="bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden" data-testid="table-invoices">
          {isLoading ? (
            <div className="text-center py-8 text-slate-500" data-testid="invoices-loading">Loading invoices...</div>
          ) : filteredInvoices.length === 0 ? (
            <EmptyState
              icon={FileText}
              message={searchQuery || activeFilter !== "all" ? "No invoices match your filters" : "No invoices found"}
              description={!searchQuery && activeFilter === "all" ? "Create your first invoice to get started." : undefined}
            />
          ) : (
            <>
              {/* Phase 14 bulk-action bar — visible only when invoices are selected. */}
              {selectedIds.size > 0 && (
                <div
                  className="flex items-center justify-between gap-3 px-4 py-2 border-b border-slate-200 bg-blue-50"
                  data-testid="bulk-action-bar"
                >
                  <div className="text-sm text-slate-700">
                    <span className="font-medium">{selectedIds.size}</span> selected
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedIds(new Set())}
                      data-testid="button-bulk-clear"
                    >
                      Clear
                    </Button>
                    {/* 2026-04-18 Phase 9: bulk reminder action. Shown
                        only when every selected row is an unpaid invoice
                        (awaiting_payment / sent / partial_paid) — the
                        same set that `invoiceReminderService` gates
                        server-side. Keeps the button out of the way
                        when the selection contains drafts or paid
                        invoices, which can't legitimately receive a
                        reminder. */}
                    {(() => {
                      const remindable = filteredInvoices.filter(
                        (inv) => selectedIds.has(inv.id) && UNPAID_STATUSES.has(inv.status),
                      );
                      if (remindable.length === 0 || remindable.length !== selectedIds.size) return null;
                      return (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => bulkRemindersMutation.mutate(remindable.map((r) => r.id))}
                          disabled={bulkRemindersMutation.isPending}
                          data-testid="button-bulk-send-reminders"
                        >
                          <Send className="h-3.5 w-3.5 mr-2" />
                          Send {remindable.length} reminder{remindable.length === 1 ? "" : "s"}
                        </Button>
                      );
                    })()}
                    <Button
                      size="sm"
                      onClick={() => setBatchOpen(true)}
                      data-testid="button-bulk-send"
                    >
                      <Send className="h-3.5 w-3.5 mr-2" />
                      Send {selectedIds.size} invoice{selectedIds.size === 1 ? "" : "s"}
                    </Button>
                  </div>
                </div>
              )}
              <div
                className="grid items-center border-b border-[#e5e7eb] py-2 text-xs font-medium text-slate-600 bg-slate-50"
                style={{ gridTemplateColumns: INVOICES_GRID_COLS }}
              >
                <div className="px-4 flex items-center">
                  {/* Select-all — toggles all filtered rows. */}
                  <Checkbox
                    checked={filteredInvoices.length > 0 && filteredInvoices.every((inv) => selectedIds.has(inv.id))}
                    onCheckedChange={(v) => {
                      if (v) {
                        setSelectedIds(new Set(filteredInvoices.map((inv) => inv.id)));
                      } else {
                        setSelectedIds(new Set());
                      }
                    }}
                    aria-label="Select all invoices"
                    data-testid="checkbox-invoice-select-all"
                  />
                </div>
                <div className="px-4">Client</div>
                <div className="px-4">Description</div>
                <div className="px-4">Invoice #</div>
                <div className="px-4">Due Date</div>
                <div className="px-4">Status</div>
                <div className="px-4 text-right">Total</div>
                <div className="px-4 text-right">Balance</div>
                <div className="w-[50px]"></div>
              </div>
              {filteredInvoices.map((invoice) => (
                <div
                  key={invoice.id}
                  className={cn("grid items-center", tableRowClass)}
                  style={{ gridTemplateColumns: INVOICES_GRID_COLS }}
                  onClick={() => setLocation(`/invoices/${invoice.id}`)}
                  data-testid={`row-invoice-${invoice.id}`}
                >
                  <div className="px-4 flex items-center" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.has(invoice.id)}
                      onCheckedChange={(v) => {
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (v) next.add(invoice.id);
                          else next.delete(invoice.id);
                          return next;
                        });
                      }}
                      aria-label={`Select invoice ${invoice.invoiceNumber ?? invoice.id}`}
                      data-testid={`checkbox-invoice-${invoice.id}`}
                    />
                  </div>
                  <div className="px-4 min-w-0 py-2.5">
                    <p className="text-sm font-medium text-slate-800 truncate" data-testid={`text-invoice-client-${invoice.id}`}>
                      {invoice.locationDisplayName || invoice.locationName || "Unknown"}
                    </p>
                    {invoice.locationName && invoice.locationDisplayName && (
                      <p className="text-xs text-slate-500 truncate">{invoice.locationName}</p>
                    )}
                  </div>
                  <div className="px-4 min-w-0 py-2.5">
                    <p className="text-xs text-slate-500 truncate">{invoice.workDescription || "-"}</p>
                  </div>
                  <div className="px-4 py-2.5">
                    <span className="font-mono text-sm text-slate-800" data-testid={`text-invoice-number-${invoice.id}`}>
                      {invoice.invoiceNumber || `INV-${invoice.id.slice(0, 8)}`}
                    </span>
                  </div>
                  <div className="px-4 text-sm text-slate-700 py-2.5">{safeFormatDate(invoice.dueDate)}</div>
                  <div className="px-4 py-2.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={invoice.statusInfo.variant}>{invoice.statusInfo.label}</Badge>
                      <QboSyncBadge invoice={invoice} />
                    </div>
                  </div>
                  <div className="px-4 text-right whitespace-nowrap tabular-nums text-sm text-slate-700 py-2.5">{formatCurrency(invoice.total)}</div>
                  <div className="px-4 text-right whitespace-nowrap tabular-nums text-sm py-2.5">
                    <span className={parseFloat(invoice.balance) > 0 ? "font-medium text-slate-900" : "text-slate-400"}>
                      {formatCurrency(invoice.balance)}
                    </span>
                  </div>
                  <div className="py-2.5" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" data-testid={`button-invoice-menu-${invoice.id}`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setLocation(`/invoices/${invoice.id}`)}>View</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setLocation(`/invoices/${invoice.id}?edit=true`)}>Edit</DropdownMenuItem>
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
        </div>

        {filteredInvoices.length > 0 && (
          <div className="text-xs text-slate-500 mt-2" data-testid="text-invoice-count">
            Showing {filteredInvoices.length} invoice{filteredInvoices.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>

      {/* Phase 14 (2026-04-12): batch send modal. */}
      <BatchSendInvoicesModal
        invoiceIds={Array.from(selectedIds)}
        isOpen={batchOpen}
        onClose={() => setBatchOpen(false)}
        onSuccess={(result) => {
          toast({
            title: `Batch send: ${result.successCount} sent / ${result.failureCount} failed`,
          });
          queryClient.invalidateQueries({ queryKey: ["invoices"] });
          if (result.failureCount === 0) setSelectedIds(new Set());
        }}
      />
    </div>
  );
}
