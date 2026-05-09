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
import { useLocation, useSearch, Link } from "wouter";
import {
  Plus, FileText, DollarSign, AlertTriangle, RefreshCw, Search, Send,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
// Phase 14 (2026-04-12): bulk send for multiple invoices.
import { BatchSendInvoicesModal } from "@/components/communication/BatchSendInvoicesModal";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { QboSyncBadge, isQboSynced } from "@/components/invoice/QboSyncBanner";
import { Button } from "@/components/ui/button";
// 2026-05-08 chip Phase 2: status filter buttons → FilterChip. The QBO
// sync filter below stays on Button — it uses `variant="destructive"`
// for the selected state, which is a Cat B concern (FilterChip's
// selected tone is currently locked to brand-active).
import { FilterChip } from "@/components/ui/chip";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { FiltersButton, FilterSection } from "@/components/filters/FiltersButton";
import { formatCurrency } from "@/lib/formatters";
// 2026-05-09: state-block migration — EmptyState replaced by typed descriptors.
// 2026-05-02 entity-number visual language: blue pill for current entity row.
import { EntityNumber } from "@/components/common/EntityNumber";
// 2026-05-03: migrated to canonical EntityListTable. The hand-rolled
// `INVOICES_GRID_COLS` template is gone — column sizing is now derived
// from per-column `kind` defaults inside the shared component, with
// `minmax(<floor>, fr)` floors that make the original "Awaiting Payment"
// column-compression bug structurally impossible. The per-row kebab
// menu (View / Edit / Send / Collect Payment / Download PDF) was
// removed: per the canonical-list product direction, core entity lists
// are navigational and detail pages own row-level actions. Every
// removed kebab item is mirrored on `/invoices/:id`. The bulk-action
// bar (Send reminders, Send invoices, Clear selection) lives ABOVE the
// table and is unaffected.
import { ENTITY_SECONDARY_CLASS } from "@/components/ui/list-surface";
import { EntityListTable, type EntityListColumn } from "@/components/lists/EntityListTable";
import { ListLoadMoreFooter } from "@/components/lists/ListLoadMoreFooter";
import type { Invoice } from "@shared/schema";
import { UNPAID_INVOICE_STATUSES } from "@shared/invoiceStatus";
import { StatusBadge } from "@/components/StatusBadge";
import { getInvoiceStatusMeta } from "@/lib/statusBadges";

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

// 2026-05-03 Load more pattern. Underlying fetch ceiling stays at 200
// (server-side limit on `/api/invoices/list`); this only paginates the
// client-side render. Bulk select / reconciliation banner / batch send
// are unaffected — they operate on the FILTERED set, not the visible
// slice (preserving the prior behavior).
const INVOICES_PAGE_SIZE = 50;

// 2026-05-03: `INVOICES_GRID_COLS` removed — column sizing is now owned
// by EntityListTable's per-kind track defaults (with explicit floors).

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
        <div className="text-caption font-medium text-slate-500">{label}</div>
      </div>
      <div className="text-page-title font-bold text-slate-900 tabular-nums mt-2">{value}</div>
      <div className="text-caption text-slate-500 mt-1">{note}</div>
    </div>
  );
}

export default function InvoicesListPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [activeFilter, setActiveFilter] = useState<InvoiceStatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(INVOICES_PAGE_SIZE);
  // Reset visible slice on filter / search change.
  useEffect(() => { setVisibleCount(INVOICES_PAGE_SIZE); }, [activeFilter, searchQuery]);
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

  const { data: invoices = [], isLoading, isError, refetch: refetchInvoices } = useQuery<{ data: EnrichedInvoice[]; meta: { limit: number; hasMore: boolean; nextOffset?: number } }, Error, EnrichedInvoice[]>({
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

  const enrichedInvoices = useMemo(() => {
    return invoices.map(inv => ({
      ...inv,
      // 2026-04-18 Phase 9: pass dueDate so awaiting-payment invoices
      // within the Due Soon window render the "Due Soon" badge.
      statusMeta: getInvoiceStatusMeta(inv.status, inv.isPastDue ?? false, inv.dueDate),
    }));
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    let result = enrichedInvoices.slice();
    if (activeFilter !== "all") {
      result = result.filter(inv => {
        if (activeFilter === "overdue") return inv.isPastDue ?? false;
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
      if (inv.isPastDue) counts["overdue"] = (counts["overdue"] || 0) + 1;
      if (isQboSynced(inv)) {
        if (inv.qboOutOfSync) counts["qbo_out_of_sync"] = (counts["qbo_out_of_sync"] || 0) + 1;
        else counts["qbo_synced"] = (counts["qbo_synced"] || 0) + 1;
      }
    }
    return counts;
  }, [enrichedInvoices]);

  /**
   * Column config for EntityListTable. Defined inside the component
   * because the select column closes over the bulk-selection state
   * (`selectedIds` / `setSelectedIds`) and the select-all checkbox
   * derives its `checked` from `filteredInvoices`. The other columns
   * are pure render functions over the row.
   *
   * Status cell composes the canonical badge with QboSyncBadge —
   * EntityListTable's `status` kind wraps multi-badge children in a
   * flex-wrap container so they wrap inside the cell instead of
   * pushing Total / Balance.
   */
  type InvoiceRow = typeof filteredInvoices[number];
  const allChecked = filteredInvoices.length > 0 && filteredInvoices.every((inv) => selectedIds.has(inv.id));
  // Column order (2026-05-09): identity + quick-lookup left → flexible detail centre → financial right.
  // Left:   Client · Invoice # · Due Date
  // Centre: Description (flexible/truncating — gets the highest ratio)
  // Right:  Status · Total · Balance
  const invoiceColumns = useMemo<EntityListColumn<InvoiceRow>[]>(() => [
    {
      id: "select",
      kind: "select",
      header: (
        <Checkbox
          checked={allChecked}
          onCheckedChange={(v) => {
            if (v) setSelectedIds(new Set(filteredInvoices.map((inv) => inv.id)));
            else setSelectedIds(new Set());
          }}
          aria-label="Select all invoices"
          data-testid="checkbox-invoice-select-all"
        />
      ),
      cell: {
        type: "customRender",
        reason: "interactive checkbox with bulk-selection state machine",
        render: (invoice) => (
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
        ),
      },
    },
    {
      id: "client",
      header: "Client",
      kind: "primary",
      ratio: 1.5,
      minWidthPx: 200,
      cell: {
        type: "entity-primary",
        value: (invoice) => invoice.locationDisplayName || invoice.locationName || "Unknown",
        secondary: (invoice) =>
          invoice.locationName && invoice.locationDisplayName
            ? invoice.locationName
            : undefined,
        testId: (invoice) => `text-invoice-client-${invoice.id}`,
      },
    },
    {
      id: "invoiceNumber",
      header: "Invoice #",
      kind: "badge",
      ratio: 0.7,
      minWidthPx: 88,
      cell: {
        type: "customRender",
        reason: "entity-number chip with per-row data-testid",
        render: (invoice) => (
          <EntityNumber variant="primary" data-testid={`text-invoice-number-${invoice.id}`}>
            {invoice.invoiceNumber || `INV-${invoice.id.slice(0, 8)}`}
          </EntityNumber>
        ),
      },
    },
    {
      id: "dueDate",
      header: "Due Date",
      kind: "date",
      cell: {
        type: "entity-date",
        value: (invoice) => invoice.dueDate,
      },
    },
    {
      id: "description",
      header: "Description",
      kind: "text",
      ratio: 1.5,
      cell: {
        type: "entity-text",
        value: (invoice) => invoice.workDescription || "-",
      },
    },
    {
      id: "status",
      header: "Status",
      kind: "status",
      cell: {
        type: "customRender",
        reason: "multi-badge: StatusBadge + QboSyncBadge",
        render: (invoice) => (
          <>
            <StatusBadge meta={invoice.statusMeta} />
            <QboSyncBadge invoice={invoice} />
          </>
        ),
      },
    },
    {
      id: "total",
      header: "Total",
      kind: "money",
      cell: { type: "entity-money", value: (invoice) => invoice.total },
    },
    {
      id: "balance",
      header: "Balance",
      kind: "money",
      cell: {
        type: "customRender",
        reason: "conditional style: muted zero vs medium non-zero",
        render: (invoice) => (
          <span className={parseFloat(invoice.balance) > 0 ? "font-medium text-slate-900" : "text-slate-400"}>
            {formatCurrency(invoice.balance)}
          </span>
        ),
      },
    },
  ], [filteredInvoices, selectedIds, allChecked]);

  // List stability: single return path — loading state renders inside content area only
  return (
    <div className="min-h-screen bg-app-bg" data-testid="invoices-page">
      <div className="p-6 space-y-5">

        {/* ── 1. Header Row ── */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-page-title font-semibold text-slate-900">Invoices</h1>
            <p className="text-row text-slate-500 mt-0.5">Invoice performance overview with full invoice list.</p>
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
              <div className="text-row font-medium text-amber-900">
                {reconciliationIssues.length} invoice
                {reconciliationIssues.length === 1 ? "" : "s"} need
                {reconciliationIssues.length === 1 ? "s" : ""} reconciliation
              </div>
              <div className="text-caption text-amber-800 mt-0.5">
                Status and payment totals have drifted on these rows. Open
                each to review and correct.
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-caption">
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
                  <FilterChip
                    key={filter}
                    selected={activeFilter === filter}
                    onClick={() => setActiveFilter(filter)}
                    data-testid={`button-filter-${filter}`}
                  >
                    {filter === "all" ? "All" : filter === "awaiting_payment" ? "Unpaid" : filter === "partial_paid" ? "Partial" : filter === "overdue" ? "Overdue" : filter.charAt(0).toUpperCase() + filter.slice(1)}
                    {statusCounts[filter] ? ` (${statusCounts[filter]})` : ""}
                  </FilterChip>
                ))}
              </div>
            </FilterSection>
            {(statusCounts["qbo_synced"] || statusCounts["qbo_out_of_sync"]) ? (
              <FilterSection label="QuickBooks Sync">
                {/* 2026-05-08 chip Phase 3a: migrated from
                    <Button variant={"default"|"destructive"|"outline"}>
                    to canonical <FilterChip>. The "Out of Sync" filter
                    keeps its destructive selected style via
                    `selectedTone="danger"` (which routes to the
                    canonical `bg-destructive text-destructive-foreground`
                    solid variant in chipVariants.ts). */}
                <div className="flex flex-wrap gap-1.5">
                  <FilterChip
                    selected={activeFilter === "qbo_synced"}
                    onClick={() => setActiveFilter("qbo_synced")}
                    leadingIcon={<RefreshCw className="h-3 w-3" />}
                    data-testid="button-filter-qbo-synced"
                  >
                    Synced {statusCounts["qbo_synced"] ? `(${statusCounts["qbo_synced"]})` : ""}
                  </FilterChip>
                  {statusCounts["qbo_out_of_sync"] > 0 && (
                    <FilterChip
                      selected={activeFilter === "qbo_out_of_sync"}
                      selectedTone="danger"
                      onClick={() => setActiveFilter("qbo_out_of_sync")}
                      leadingIcon={<AlertTriangle className="h-3 w-3" />}
                      data-testid="button-filter-qbo-out-of-sync"
                    >
                      Out of Sync ({statusCounts["qbo_out_of_sync"]})
                    </FilterChip>
                  )}
                </div>
              </FilterSection>
            ) : null}
          </FiltersButton>
        </div>

        {/* ── 4. Bulk-action bar (sibling, above the table) ── */}
        {selectedIds.size > 0 && filteredInvoices.length > 0 && (
          <div
            className="flex items-center justify-between gap-3 px-4 py-2 border border-slate-200 bg-blue-50 rounded-md"
            data-testid="bulk-action-bar"
          >
            <div className="text-row text-slate-700">
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
                  server-side. */}
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

        {/* ── 5. Main Table ── */}
        <EntityListTable<typeof filteredInvoices[number]>
          rows={filteredInvoices.slice(0, visibleCount)}
          rowKey={(invoice) => invoice.id}
          onRowClick={(invoice) => setLocation(`/invoices/${invoice.id}`)}
          loadingState={isLoading ? { kind: "loading", title: "Loading invoices…", testId: "invoices-loading" } : undefined}
          emptyState={
            searchQuery || activeFilter !== "all"
              ? { kind: "no-results", title: "No invoices match your filters", icon: "file" }
              : { kind: "empty", title: "No invoices found", icon: "file", description: "Create your first invoice to get started." }
          }
          errorState={
            isError
              ? { kind: "error", title: "Failed to load invoices", primaryAction: { label: "Retry", onClick: () => refetchInvoices(), variant: "outline" } }
              : undefined
          }
          columns={invoiceColumns}
        />

        <ListLoadMoreFooter
          visibleCount={Math.min(visibleCount, filteredInvoices.length)}
          totalCount={filteredInvoices.length}
          hasMore={visibleCount < filteredInvoices.length}
          onLoadMore={() => setVisibleCount((c) => c + INVOICES_PAGE_SIZE)}
          label="invoice"
        />
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
