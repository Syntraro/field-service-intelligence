import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { receivablesKeys } from "@/lib/receivablesQueryKeys";
import { useLocation, Link } from "wouter";
import {
  FileText, DollarSign, AlertTriangle, RefreshCw, Search, Send, ExternalLink,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { BatchSendInvoicesModal } from "@/components/communication/BatchSendInvoicesModal";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { QboSyncBadge, isQboSynced } from "@/components/invoice/QboSyncBanner";
import { Button } from "@/components/ui/button";
import { FilterChip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { FiltersButton, FilterSection } from "@/components/filters/FiltersButton";
import { formatCurrency } from "@/lib/formatters";
import { EntityNumber } from "@/components/common/EntityNumber";
import { EntityListTable, type EntityListColumn } from "@/components/lists/EntityListTable";
import { ListLoadMoreFooter } from "@/components/lists/ListLoadMoreFooter";
import type { Invoice } from "@shared/schema";
import { UNPAID_INVOICE_STATUSES } from "@shared/invoiceStatus";
import { StatusBadge } from "@/components/StatusBadge";
import { getInvoiceStatusMeta } from "@/lib/statusBadges";
import { InvoiceParticularsPanel } from "@/components/invoices/InvoiceParticularsPanel";

// ── Types ────────────────────────────────────────────────────────────────────

export type InvoiceView =
  | "all" | "overdue" | "awaiting-payment" | "drafts" | "paid"
  | "needs-follow-up" | "sent-this-week" | "no-recent-contact"
  | "high-balance" | "disputed" | "promised-payment";

export interface SelectionContext {
  selectedInvoiceIds: string[];
  customerCompanyId: string | null;
  /** followUpAt from the sole selected invoice; null/undefined when ≠1 selected. */
  followUpAt?: string | null;
}

interface InvoiceListPanelProps {
  activeView: InvoiceView;
  onSelectionChange?: (ctx: SelectionContext) => void;
  receivablesMode?: boolean;
  /** When in receivablesMode: controlled search query from the parent tab row. */
  externalSearchQuery?: string;
  onExternalSearchChange?: (q: string) => void;
  /** When in receivablesMode: controlled status filter from the parent tab row. */
  externalActiveFilter?: InvoiceStatusFilter;
  onExternalActiveFilterChange?: (f: InvoiceStatusFilter) => void;
  /** When in receivablesMode: invoice date range filter from the workspace toolbar. */
  externalDateRange?: InvoiceDateRange;
}

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

export type InvoiceStatusFilter =
  | "all" | "draft" | "awaiting_payment" | "partial_paid" | "paid"
  | "voided" | "overdue" | "qbo_synced" | "qbo_out_of_sync";

export type InvoiceDatePreset = "this_month" | "last_month" | "last_30_days" | "custom";
export interface InvoiceDateRange {
  preset: InvoiceDatePreset | null;
  start: string | null; // YYYY-MM-DD
  end: string | null;   // YYYY-MM-DD
}

const INVOICES_PAGE_SIZE = 50;

function viewToFilter(view: InvoiceView): InvoiceStatusFilter {
  switch (view) {
    case "overdue":          return "overdue";
    case "awaiting-payment": return "awaiting_payment";
    case "drafts":           return "draft";
    case "paid":             return "paid";
    default:                 return "all";
  }
}

// ── SummaryCard ───────────────────────────────────────────────────────────────

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
        <div className="text-row font-medium text-slate-500">{label}</div>
      </div>
      <div className="text-title font-medium text-slate-900 tabular-nums mt-2">{value}</div>
      <div className="text-row text-slate-500 mt-1">{note}</div>
    </div>
  );
}

// ── InvoiceListPanel ──────────────────────────────────────────────────────────

export function InvoiceListPanel({
  activeView, onSelectionChange, receivablesMode,
  externalSearchQuery, onExternalSearchChange,
  externalActiveFilter, onExternalActiveFilterChange,
  externalDateRange,
}: InvoiceListPanelProps) {
  const [, setLocation] = useLocation();
  const [activeFilter, setActiveFilter] = useState<InvoiceStatusFilter>(() => viewToFilter(activeView));
  const [searchQuery, setSearchQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(INVOICES_PAGE_SIZE);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Reset filter, visible slice, and selection when the view changes from the rail.
  useEffect(() => {
    setActiveFilter(viewToFilter(activeView));
    setVisibleCount(INVOICES_PAGE_SIZE);
    setSelectedIds(new Set());
  }, [activeView]);

  // Reset visible slice on local filter, search, or date range change.
  useEffect(() => { setVisibleCount(INVOICES_PAGE_SIZE); }, [activeFilter, searchQuery, externalDateRange]);

  const UNPAID_STATUSES = new Set(UNPAID_INVOICE_STATUSES);

  const bulkRemindersMutation = useMutation({
    mutationFn: async (invoiceIds: string[]) =>
      apiRequest<{
        totalCount: number; successCount: number; skippedCount: number; failedCount: number;
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
      queryClient.invalidateQueries({ queryKey: ["invoices", "stats"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      // Reminder send updates lastEmailedAt, which affects noRecentContact view membership and counts.
      queryClient.invalidateQueries({ queryKey: receivablesKeys.invoicesRoot() });
      queryClient.invalidateQueries({ queryKey: receivablesKeys.viewsCounts() });
    },
    onError: (err: any) => {
      toast({ title: "Reminders failed", description: err?.message, variant: "destructive" });
    },
  });

  // Standard invoices feed — disabled when in receivables mode
  const { data: invoices = [], isLoading, isError, refetch: refetchInvoices } = useQuery<
    { data: EnrichedInvoice[]; meta: { limit: number; hasMore: boolean; nextOffset?: number } },
    Error,
    EnrichedInvoice[]
  >({
    queryKey: ["invoices", "feed", { offset: 0, limit: 200 }],
    queryFn: async () => {
      const res = await fetch("/api/invoices/list?offset=0&limit=200", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch invoices");
      return res.json();
    },
    select: (response) => response.data,
    enabled: !receivablesMode,
  });

  // Receivables feed — only active when in receivables mode; server pre-filters by view
  const { data: receivablesData = [], isLoading: receivablesLoading, isError: receivablesError, refetch: refetchReceivables } = useQuery<EnrichedInvoice[]>({
    queryKey: ["receivables", "invoices", activeView],
    queryFn: async () => {
      const res = await fetch(`/api/receivables/invoices?view=${encodeURIComponent(activeView)}&limit=200`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch invoices");
      const json = await res.json();
      return (json.data ?? []) as EnrichedInvoice[];
    },
    enabled: !!receivablesMode,
  });

  // Unified data source — switch between standard and receivables feeds
  const baseInvoices = receivablesMode ? receivablesData : invoices;
  const isLoadingInvoices = receivablesMode ? receivablesLoading : isLoading;
  const isErrorInvoices = receivablesMode ? receivablesError : isError;
  const refetch = receivablesMode ? refetchReceivables : refetchInvoices;

  // Effective search/filter/date — external when in receivablesMode, internal otherwise.
  const effectiveSearchQuery = receivablesMode ? (externalSearchQuery ?? "") : searchQuery;
  const effectiveActiveFilter = receivablesMode ? (externalActiveFilter ?? "all") : activeFilter;
  const effectiveDateRange = receivablesMode ? (externalDateRange ?? null) : null;

  const { data: stats } = useQuery<InvoiceStats>({
    queryKey: ["invoices", "stats"],
    queryFn: async () => {
      const res = await fetch("/api/invoices/stats", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch invoice stats");
      return res.json();
    },
    enabled: !receivablesMode,
  });

  const { data: reconciliationData } = useQuery<{
    data: Array<{
      invoiceId: string; invoiceNumber: string | null; status: string | null;
      balance: string | null; amountPaid: string | null; locationDisplayName: string | null;
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
    return baseInvoices.map(inv => ({
      ...inv,
      statusMeta: getInvoiceStatusMeta(inv.status, inv.isPastDue ?? false, inv.dueDate),
    }));
  }, [baseInvoices]);

  const filteredInvoices = useMemo(() => {
    let result = enrichedInvoices.slice();
    if (effectiveActiveFilter !== "all") {
      result = result.filter(inv => {
        if (effectiveActiveFilter === "overdue") return inv.isPastDue ?? false;
        if (effectiveActiveFilter === "qbo_synced") return isQboSynced(inv) && !inv.qboOutOfSync;
        if (effectiveActiveFilter === "qbo_out_of_sync") return inv.qboOutOfSync === true;
        if (effectiveActiveFilter === "awaiting_payment") return inv.status === "awaiting_payment" || inv.status === "sent";
        return inv.status === effectiveActiveFilter;
      });
    }
    if (effectiveSearchQuery.trim()) {
      const query = effectiveSearchQuery.toLowerCase();
      result = result.filter(inv => {
        const invoiceNumber = inv.invoiceNumber?.toLowerCase() || "";
        const locationName = inv.locationName?.toLowerCase() || "";
        const companyName = (inv.locationDisplayName || inv.customerCompanyName || "").toLowerCase();
        const description = (inv.workDescription || "").toLowerCase();
        return invoiceNumber.includes(query) || locationName.includes(query) || companyName.includes(query) || description.includes(query);
      });
    }
    if (effectiveDateRange?.start || effectiveDateRange?.end) {
      result = result.filter(inv => {
        const d = (inv as any).issueDate as string | null | undefined;
        if (!d) return true;
        if (effectiveDateRange.start && d < effectiveDateRange.start) return false;
        if (effectiveDateRange.end && d > effectiveDateRange.end) return false;
        return true;
      });
    }
    return result;
  }, [enrichedInvoices, effectiveActiveFilter, effectiveSearchQuery, effectiveDateRange]);

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

  // Propagate selection context to the workspace coordinator.
  useEffect(() => {
    if (!onSelectionChange) return;
    const ids = Array.from(selectedIds);
    let customerCompanyId: string | null = null;
    let followUpAt: string | null | undefined;
    if (ids.length === 1) {
      const inv = enrichedInvoices.find(i => i.id === ids[0]);
      customerCompanyId = (inv as any)?.customerCompanyId ?? null;
      followUpAt = (inv as any)?.followUpAt ?? null;
    }
    onSelectionChange({ selectedInvoiceIds: ids, customerCompanyId, followUpAt });
  }, [selectedIds, enrichedInvoices, onSelectionChange]);

  type InvoiceRow = typeof filteredInvoices[number];
  const allChecked = filteredInvoices.length > 0 && filteredInvoices.every((inv) => selectedIds.has(inv.id));

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
          invoice.locationName && invoice.locationDisplayName ? invoice.locationName : undefined,
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
      cell: { type: "entity-date", value: (invoice) => invoice.dueDate },
    },
    {
      id: "description",
      header: "Description",
      kind: "text",
      ratio: 1.5,
      cell: { type: "entity-text", value: (invoice) => invoice.workDescription || "-" },
    },
    {
      id: "status",
      header: "Status",
      kind: "status",
      minWidthPx: 130,
      cell: {
        type: "customRender",
        reason: "multi-badge: StatusBadge + QboSyncBadge; minWidthPx prevents 'Awaiting Payment' overflow",
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

  // ── Receivables-mode column set: base columns + "Open" action ───────────────
  // The Open column uses kind="select" (40 px, centered, stops click propagation)
  // so clicking the ExternalLink icon navigates without triggering row-body
  // selection. Standard mode uses invoiceColumns directly (no open button).

  const receivablesColumns = useMemo<EntityListColumn<InvoiceRow>[]>(() => [
    ...invoiceColumns,
    {
      id: "open",
      header: "",
      kind: "select",
      cell: {
        type: "customRender",
        reason: "navigation affordance — ExternalLink navigates to /invoices/:id without selecting the row",
        render: (invoice) => (
          <button
            type="button"
            className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            onClick={() => setLocation(`/invoices/${invoice.id}`)}
            aria-label={`Open invoice ${invoice.invoiceNumber ?? invoice.id}`}
            data-testid={`button-open-invoice-${invoice.id}`}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        ),
      },
    },
  ], [invoiceColumns, setLocation]);

  // In receivablesMode, the selected invoice drives the inline particulars panel.
  const particularsInvoiceId = receivablesMode && selectedIds.size === 1
    ? Array.from(selectedIds)[0]
    : null;

  // Single selected row key for receivablesMode highlight — only when exactly 1
  // invoice is selected (row body click). Multi-select via checkboxes uses the
  // checkbox checked state for visual indication.
  const receivablesSelectedKey = particularsInvoiceId ?? undefined;

  // Clear selection when the selected invoice is no longer in the filtered list
  // (e.g. the user types in search and the selected row disappears).
  useEffect(() => {
    if (!receivablesMode) return;
    if (selectedIds.size !== 1) return;
    const selectedId = Array.from(selectedIds)[0];
    if (!filteredInvoices.some((inv) => inv.id === selectedId)) {
      setSelectedIds(new Set());
    }
  }, [filteredInvoices, receivablesMode, selectedIds]);

  // ── Shared section nodes (used in both receivablesMode and standard mode) ──────

  const reconcBannerNode = reconciliationIssues.length > 0 && (
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
        <div className="text-row text-amber-800 mt-0.5">
          Status and payment totals have drifted on these rows. Open each to review and correct.
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-row">
          {reconciliationIssues.slice(0, 6).map((iss) => {
            const label =
              iss.kind === "paid_with_balance" ? "Paid · balance owed"
              : iss.kind === "zero_balance_still_unpaid" ? "Unpaid · no balance"
              : "Partial · no payments";
            return (
              <Link
                key={iss.invoiceId}
                href={`/invoices/${iss.invoiceId}`}
                className="text-amber-900 hover:underline inline-flex items-center gap-1"
                data-testid={`reconciliation-link-${iss.invoiceId}`}
              >
                <span className="font-medium">{iss.invoiceNumber ?? "—"}</span>
                <span className="text-amber-700">· {label}</span>
              </Link>
            );
          })}
          {reconciliationIssues.length > 6 && (
            <span className="text-amber-700">+{reconciliationIssues.length - 6} more</span>
          )}
        </div>
      </div>
    </div>
  );

  const bulkBarNode = !receivablesMode && selectedIds.size > 0 && filteredInvoices.length > 0 && (
    <div
      className="flex items-center justify-between gap-3 px-4 py-2 border border-slate-200 bg-blue-50 rounded-md"
      data-testid="bulk-action-bar"
    >
      <div className="text-row text-slate-700">
        <span className="font-medium">{selectedIds.size}</span> selected
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())} data-testid="button-bulk-clear">
          Clear
        </Button>
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
        <Button size="sm" onClick={() => setBatchOpen(true)} data-testid="button-bulk-send">
          <Send className="h-3.5 w-3.5 mr-2" />
          Send {selectedIds.size} invoice{selectedIds.size === 1 ? "" : "s"}
        </Button>
      </div>
    </div>
  );

  const batchModalNode = (
    <BatchSendInvoicesModal
      invoiceIds={Array.from(selectedIds)}
      isOpen={batchOpen}
      onClose={() => setBatchOpen(false)}
      onSuccess={(result) => {
        toast({
          title: `Batch send: ${result.successCount} sent / ${result.failureCount} failed`,
        });
        queryClient.invalidateQueries({ queryKey: ["invoices"] });
        queryClient.invalidateQueries({ queryKey: receivablesKeys.invoicesRoot() });
        queryClient.invalidateQueries({ queryKey: receivablesKeys.viewsCounts() });
        if (result.failureCount === 0) setSelectedIds(new Set());
      }}
    />
  );

  // ── receivablesMode layout: flex column; single scroll container for table + particulars ──
  //
  // The center panel wrapper (InvoicesWorkspaceTab) is overflow-hidden.
  // This component fills it with h-full. The reconciliation banner (if any) is
  // pinned shrink-0 at the top. Everything else — table rows and the inline
  // particulars panel — lives in one overflow-y-auto container so they scroll
  // as a single unit with no gap and no scroll-fight.
  //
  // Bulk action bar is intentionally absent: the right rail owns selected-invoice
  // actions in receivablesMode.

  if (receivablesMode) {
    return (
      <div className="flex flex-col h-full min-h-0" data-testid="invoice-list-panel">
        {/* Reconciliation banner — pinned at top, never compresses table area */}
        {reconcBannerNode && (
          <div className="shrink-0 px-4 pt-3">
            {reconcBannerNode}
          </div>
        )}

        {/* Single scrollable area — table and particulars panel scroll as one unit */}
        <div className="flex-1 min-h-0 overflow-y-auto" data-testid="invoice-table-area">
          <div className="px-4 pt-3 pb-4">
            <EntityListTable<InvoiceRow>
              rows={filteredInvoices.slice(0, visibleCount)}
              rowKey={(invoice) => invoice.id}
              onRowClick={(invoice) => {
                setSelectedIds((prev) =>
                  prev.size === 1 && prev.has(invoice.id) ? new Set() : new Set([invoice.id]),
                );
              }}
              selectedRowKey={receivablesSelectedKey}
              selectedHighlightClass="bg-blue-50"
              loadingState={isLoadingInvoices ? { kind: "loading", title: "Loading invoices…", testId: "invoices-loading" } : undefined}
              emptyState={
                effectiveSearchQuery || effectiveActiveFilter !== "all"
                  ? { kind: "no-results", title: "No invoices match your filters", icon: "file" }
                  : { kind: "empty", title: "No invoices found", icon: "file", description: "Create your first invoice to get started." }
              }
              errorState={
                isErrorInvoices
                  ? { kind: "error", title: "Failed to load invoices", primaryAction: { label: "Retry", onClick: () => refetch(), variant: "outline" } }
                  : undefined
              }
              columns={receivablesColumns}
              fillHeight={!particularsInvoiceId}
              inlineRowDetail={(invoice) => {
                if (invoice.id !== particularsInvoiceId) return null;
                return (
                  <div className="border-t border-border" data-testid="invoice-particulars-container">
                    <InvoiceParticularsPanel
                      invoiceId={invoice.id}
                      onClose={() => setSelectedIds(new Set())}
                    />
                  </div>
                );
              }}
              data-testid="invoice-list-table-receivables"
            />
            <ListLoadMoreFooter
              visibleCount={Math.min(visibleCount, filteredInvoices.length)}
              totalCount={filteredInvoices.length}
              hasMore={visibleCount < filteredInvoices.length}
              onLoadMore={() => setVisibleCount((c) => c + INVOICES_PAGE_SIZE)}
              label="invoice"
              hideCountText
            />
          </div>
        </div>

        {batchModalNode}
      </div>
    );
  }

  // ── Standard mode layout: natural block height, page-level scroll ────────────

  return (
    <div className="p-6 space-y-5" data-testid="invoice-list-panel">
      {/* ── 1. Summary Cards Row ── */}
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

      {/* ── 2. Reconciliation banner ── */}
      {reconcBannerNode}

      {/* ── 3. Search / Filter Row — receivablesMode controls live in tab row ── */}
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
                  {filter === "all" ? "All"
                    : filter === "awaiting_payment" ? "Unpaid"
                    : filter === "partial_paid" ? "Partial"
                    : filter === "overdue" ? "Overdue"
                    : filter.charAt(0).toUpperCase() + filter.slice(1)}
                  {statusCounts[filter] ? ` (${statusCounts[filter]})` : ""}
                </FilterChip>
              ))}
            </div>
          </FilterSection>
          {(statusCounts["qbo_synced"] || statusCounts["qbo_out_of_sync"]) ? (
            <FilterSection label="QuickBooks Sync">
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

      {/* ── 4. Bulk-action bar ── */}
      {bulkBarNode}

      {/* ── 5. Main Table ── */}
      <EntityListTable<InvoiceRow>
        rows={filteredInvoices.slice(0, visibleCount)}
        rowKey={(invoice) => invoice.id}
        onRowClick={(invoice) => setLocation(`/invoices/${invoice.id}`)}
        loadingState={isLoadingInvoices ? { kind: "loading", title: "Loading invoices…", testId: "invoices-loading" } : undefined}
        emptyState={
          effectiveSearchQuery || effectiveActiveFilter !== "all"
            ? { kind: "no-results", title: "No invoices match your filters", icon: "file" }
            : { kind: "empty", title: "No invoices found", icon: "file", description: "Create your first invoice to get started." }
        }
        errorState={
          isErrorInvoices
            ? { kind: "error", title: "Failed to load invoices", primaryAction: { label: "Retry", onClick: () => refetch(), variant: "outline" } }
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

      {batchModalNode}
    </div>
  );
}
