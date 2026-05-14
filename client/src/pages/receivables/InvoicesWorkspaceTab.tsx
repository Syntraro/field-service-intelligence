import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { FilterChip } from "@/components/ui/chip";
import { FiltersButton, FilterSection } from "@/components/filters/FiltersButton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  InvoiceListPanel,
  type InvoiceView,
  type InvoiceStatusFilter,
  type InvoiceDateRange,
  type SelectionContext,
} from "@/components/invoices/InvoiceListPanel";
import { InvoiceViewRail, type ViewCounts } from "./InvoiceViewRail";
import { ReceivablesActionsRail } from "./ReceivablesActionsRail";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

export type { InvoiceView, InvoiceStatusFilter };

export type SelectedReceivablesContext = {
  customerCompanyId: string | null;
  selectedInvoiceIds: string[];
  selectedPaymentId?: string | null;
  /** followUpAt from the sole selected invoice; forwarded to SetFollowUpDialog so it
   *  opens pre-populated with the existing value instead of blank. */
  followUpAt?: string | null;
};

// ── URL helpers ───────────────────────────────────────────────────────────────

const VALID_VIEWS: InvoiceView[] = [
  "all", "overdue", "awaiting-payment", "drafts", "paid",
  "needs-follow-up", "sent-this-week", "no-recent-contact",
  "high-balance", "disputed", "promised-payment",
];

const FILTER_TO_VIEW: Record<string, InvoiceView> = {
  overdue:          "overdue",
  draft:            "drafts",
  awaiting_payment: "awaiting-payment",
  paid:             "paid",
};

export function readViewFromSearch(search: string): InvoiceView {
  const params = new URLSearchParams(search);
  const view = params.get("view");
  if (view && (VALID_VIEWS as string[]).includes(view)) return view as InvoiceView;
  const filter = params.get("filter");
  if (filter && FILTER_TO_VIEW[filter]) return FILTER_TO_VIEW[filter];
  return "all";
}

// ── Filter constants ──────────────────────────────────────────────────────────

const INVOICE_STATUS_FILTERS: InvoiceStatusFilter[] = [
  "all", "draft", "awaiting_payment", "partial_paid", "paid", "overdue", "voided",
];

function filterLabel(f: InvoiceStatusFilter): string {
  if (f === "all") return "All";
  if (f === "awaiting_payment") return "Unpaid";
  if (f === "partial_paid") return "Partial";
  if (f === "overdue") return "Overdue";
  return f.charAt(0).toUpperCase() + f.slice(1);
}

// ── Invoice date range helpers ────────────────────────────────────────────────

const DATE_PRESETS: { value: NonNullable<InvoiceDateRange["preset"]>; label: string }[] = [
  { value: "this_month",   label: "This Month" },
  { value: "last_month",   label: "Last Month" },
  { value: "last_30_days", label: "Last 30 Days" },
  { value: "custom",       label: "Custom Range" },
];

function computePresetBounds(
  preset: NonNullable<InvoiceDateRange["preset"]>,
): { start: string; end: string } | null {
  if (preset === "custom") return null;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  if (preset === "this_month") {
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const lastDay = new Date(y, m, 0).getDate();
    return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(lastDay)}` };
  }
  if (preset === "last_month") {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const lastDay = new Date(y, m, 0).getDate();
    return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(lastDay)}` };
  }
  // last_30_days
  const end = now.toISOString().slice(0, 10);
  const s = new Date(now);
  s.setDate(s.getDate() - 30);
  return { start: s.toISOString().slice(0, 10), end };
}

const EMPTY_DATE_RANGE: InvoiceDateRange = { preset: null, start: null, end: null };

function InvoiceDateRangeButton({
  value,
  onChange,
}: {
  value: InvoiceDateRange;
  onChange: (r: InvoiceDateRange) => void;
}) {
  const isActive = value.preset !== null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-2 h-9 px-3 rounded-lg border text-sm transition-colors",
            isActive
              ? "border-primary/60 bg-primary/5 text-primary"
              : "border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50",
          )}
          data-testid="button-invoice-date-filter"
        >
          <CalendarDays className="h-4 w-4" />
          Invoice Date
          {isActive && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-2">
        <div className="space-y-0.5">
          {DATE_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              className={cn(
                "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                value.preset === p.value
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-foreground hover:bg-muted",
              )}
              onClick={() => {
                if (p.value === "custom") {
                  onChange({ preset: "custom", start: value.start, end: value.end });
                } else {
                  const bounds = computePresetBounds(p.value);
                  onChange({ preset: p.value, start: bounds?.start ?? null, end: bounds?.end ?? null });
                }
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {value.preset === "custom" && (
          <div className="mt-2 pt-2 border-t border-border space-y-2">
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.06em] mb-1">
                From
              </div>
              <input
                type="date"
                value={value.start ?? ""}
                onChange={(e) => onChange({ ...value, start: e.target.value || null })}
                className="w-full h-8 px-2 rounded-md border border-slate-200 text-sm bg-white"
              />
            </div>
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.06em] mb-1">
                To
              </div>
              <input
                type="date"
                value={value.end ?? ""}
                onChange={(e) => onChange({ ...value, end: e.target.value || null })}
                className="w-full h-8 px-2 rounded-md border border-slate-200 text-sm bg-white"
              />
            </div>
          </div>
        )}

        {isActive && (
          <div className="mt-1 pt-1 border-t border-border">
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-muted transition-colors"
              onClick={() => onChange(EMPTY_DATE_RANGE)}
              data-testid="button-invoice-date-filter-clear"
            >
              Clear
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ── InvoicesWorkspaceTab ──────────────────────────────────────────────────────

export function InvoicesWorkspaceTab() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const activeView = readViewFromSearch(search);

  const [selectedContext, setSelectedContext] = useState<SelectedReceivablesContext | null>(null);
  const [railExpanded, setRailExpanded] = useState(false);

  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [invoiceFilter, setInvoiceFilter] = useState<InvoiceStatusFilter>("all");
  const [dateRange, setDateRange] = useState<InvoiceDateRange>(EMPTY_DATE_RANGE);

  // Reset search/filter/date when the active view changes.
  useEffect(() => {
    setInvoiceSearch("");
    setInvoiceFilter("all");
    setDateRange(EMPTY_DATE_RANGE);
  }, [activeView]);

  const { data: viewCounts } = useQuery<ViewCounts | null>({
    queryKey: ["receivables", "views", "counts"],
    queryFn: async () => {
      const res = await fetch("/api/receivables/views/counts", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: false,
  });

  const handleViewChange = (view: InvoiceView) => {
    const params = new URLSearchParams(search);
    params.set("tab", "invoices");
    if (view === "all") params.delete("view");
    else params.set("view", view);
    setLocation(`/receivables?${params}`);
    setSelectedContext(null);
    setRailExpanded(false);
  };

  const handleSelectionChange = (ctx: SelectionContext) => {
    if (ctx.selectedInvoiceIds.length === 0) {
      setSelectedContext(null);
      setRailExpanded(false);
    } else {
      setSelectedContext({
        customerCompanyId: ctx.customerCompanyId,
        selectedInvoiceIds: ctx.selectedInvoiceIds,
        followUpAt: ctx.followUpAt,
      });
      setRailExpanded(true);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="invoices-workspace-tab">
      {/* Workspace toolbar */}
      <div className="h-14 border-b border-border flex items-center px-4 gap-3 bg-white shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search invoices…"
            value={invoiceSearch}
            onChange={(e) => setInvoiceSearch(e.target.value)}
            className="pl-9 h-9 w-60 rounded-lg border-slate-200 bg-white text-sm"
            data-testid="input-search-invoices-toolbar"
          />
        </div>
        <FiltersButton
          activeCount={invoiceFilter !== "all" ? 1 : 0}
          onClear={() => setInvoiceFilter("all")}
        >
          <FilterSection label="Status">
            <div className="flex flex-wrap gap-1.5">
              {INVOICE_STATUS_FILTERS.map((f) => (
                <FilterChip
                  key={f}
                  selected={invoiceFilter === f}
                  onClick={() => setInvoiceFilter(f)}
                  data-testid={`button-toolbar-filter-${f}`}
                >
                  {filterLabel(f)}
                </FilterChip>
              ))}
            </div>
          </FilterSection>
        </FiltersButton>
        <InvoiceDateRangeButton value={dateRange} onChange={setDateRange} />
      </div>

      {/* Three-column workspace */}
      <div className="flex flex-1 min-h-0 divide-x divide-border">
        {/* Left rail — white bg, matches right rail */}
        <div className="w-[232px] shrink-0 overflow-y-auto bg-white">
          <InvoiceViewRail
            activeView={activeView}
            onViewChange={handleViewChange}
            counts={viewCounts}
          />
        </div>

        {/* Center panel */}
        <div className="flex-1 min-w-0 overflow-hidden">
          <InvoiceListPanel
            activeView={activeView}
            onSelectionChange={handleSelectionChange}
            receivablesMode
            externalSearchQuery={invoiceSearch}
            onExternalSearchChange={setInvoiceSearch}
            externalActiveFilter={invoiceFilter}
            onExternalActiveFilterChange={setInvoiceFilter}
            externalDateRange={dateRange}
          />
        </div>

        {/* Right rail — width transitions 48px (collapsed) ↔ 360px (expanded) */}
        <div
          className="shrink-0 overflow-hidden bg-white"
          style={{ width: railExpanded ? "360px" : "48px", transition: "width 180ms ease-out" }}
          data-testid="receivables-right-rail"
        >
          <ReceivablesActionsRail
            context={selectedContext}
            activeView={activeView}
          />
        </div>
      </div>
    </div>
  );
}
