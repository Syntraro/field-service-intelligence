/**
 * LocPricingTab — read-only "Recent Pricing" tab on Client Detail.
 *
 * Mounted under the workspace card's "Pricing" tab when scope = "location".
 * Backend contract: GET /api/clients/:locationId/pricing-history?search=...
 * (the canonical endpoint locked in 2026-05-02). Returns invoice + quote
 * derived line items only — job_parts is intentionally not a source.
 *
 * Read-only: no editing, no overrides, no "use this price" actions, no
 * pricing-difference warnings. Click-through navigates to the source
 * invoice / quote detail page.
 *
 * UI pattern matches LocInvoicesTab / LocQuotesTab on the same page:
 *   - inline TanStack `useQuery` (no extracted hook — matches the page's
 *     existing convention for subresource fetches)
 *   - div-based tables with `border ... rounded ... divide-y` (no shadcn
 *     Table — page-wide convention)
 *   - local `Intl.NumberFormat` for currency (the page's `fmt` constant
 *     is private; we redeclare the same shape here intentionally so we
 *     don't introduce a cross-file formatter import for one tab — global
 *     formatter cleanup is out of scope for this PR)
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { format } from "date-fns";

// Same shape as ClientDetailPage's local `fmt` — kept in-file on purpose
// (see header comment). DO NOT swap to the canonical `formatCurrency`
// helper without converting the surrounding tabs in the same PR.
const fmt = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });

export type PricingHistorySourceType = "invoice" | "quote";

export interface PricingHistoryItem {
  clientId: string;
  locationId: string | null;
  itemId: string | null;
  itemName: string;
  category: string | null;
  sourceType: PricingHistorySourceType;
  sourceId: string;
  sourceNumber: string | null;
  unitPrice: string;
  quantity: string;
  total: string;
  date: string;
}

interface PricingHistoryResponse {
  items: PricingHistoryItem[];
}

function formatMoneyString(raw: string | null | undefined): string {
  if (!raw) return fmt.format(0);
  const n = Number(raw);
  if (!Number.isFinite(n)) return fmt.format(0);
  return fmt.format(n);
}

function formatDateString(raw: string | null | undefined): string {
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  return format(d, "MMM dd, yyyy");
}

export default function LocPricingTab({
  locationId,
  onNavigate,
}: {
  locationId: string;
  onNavigate: (path: string) => void;
}) {
  // Server-side search via the endpoint's `search` param. Debounced 250ms
  // so each keystroke isn't a query.
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data, isLoading, isError, isFetching } = useQuery<PricingHistoryResponse>({
    queryKey: ["/api/clients", locationId, "pricing-history", debouncedSearch],
    queryFn: async () => {
      const url = new URL(`/api/clients/${locationId}/pricing-history`, window.location.origin);
      if (debouncedSearch) url.searchParams.set("search", debouncedSearch);
      const res = await fetch(url.pathname + url.search, { credentials: "include" });
      if (!res.ok) {
        throw new Error(`Pricing history request failed (${res.status})`);
      }
      return (await res.json()) as PricingHistoryResponse;
    },
    enabled: Boolean(locationId),
    placeholderData: keepPreviousData,
  });

  const items = data?.items ?? [];
  const hasSearch = debouncedSearch.length > 0;

  const headerRow = useMemo(
    () => (
      <div className="grid grid-cols-[88px_72px_88px_minmax(0,1fr)_56px_88px_96px] items-center gap-2 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-slate-500 border-b border-slate-200">
        <span>Date</span>
        <span>Source</span>
        <span>#</span>
        <span>Item</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Unit</span>
        <span className="text-right">Total</span>
      </div>
    ),
    [],
  );

  return (
    <div data-testid="loc-pricing-tab">
      {/* Search bar — server-side, debounced */}
      <div className="relative mb-2">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search items, descriptions…"
          className="pl-7 h-8 text-xs"
          data-testid="pricing-search-input"
        />
      </div>

      {isError ? (
        <p
          className="text-xs text-rose-600 py-4 text-center border border-rose-100 bg-rose-50/40 rounded"
          data-testid="pricing-error"
        >
          Couldn't load pricing history. Try refreshing the page.
        </p>
      ) : isLoading ? (
        <div className="border border-slate-200 rounded bg-white divide-y divide-slate-100">
          {headerRow}
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="px-3 py-2">
              <Skeleton className="h-4 w-full" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground" data-testid="pricing-empty">
          {hasSearch ? "No pricing matches this search." : "No pricing history yet."}
        </p>
      ) : (
        <div
          className={`border border-slate-200 rounded bg-white divide-y divide-slate-100 ${isFetching ? "opacity-80" : ""}`}
          data-testid="pricing-table"
        >
          {headerRow}
          {items.map((row) => (
            <PricingRow
              key={`${row.sourceType}:${row.sourceId}:${row.itemId ?? row.itemName}:${row.date}`}
              row={row}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PricingRow({
  row,
  onNavigate,
}: {
  row: PricingHistoryItem;
  onNavigate: (path: string) => void;
}) {
  const targetPath = row.sourceType === "invoice"
    ? `/invoices/${row.sourceId}`
    : `/quotes/${row.sourceId}`;
  const sourceLabel = row.sourceType === "invoice" ? "Invoice" : "Quote";
  const sourceNumberLabel = row.sourceNumber
    ? row.sourceNumber
    : `${row.sourceType === "invoice" ? "INV" : "Q"}-${row.sourceId.slice(0, 6)}`;

  return (
    <div
      className="grid grid-cols-[88px_72px_88px_minmax(0,1fr)_56px_88px_96px] items-center gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-slate-50 transition-colors"
      onClick={() => onNavigate(targetPath)}
      data-testid={`pricing-row-${row.sourceType}-${row.sourceId}`}
    >
      <span className="text-slate-500 tabular-nums">{formatDateString(row.date)}</span>
      <Badge
        variant={row.sourceType === "invoice" ? "secondary" : "outline"}
        className="text-[10px] capitalize w-fit justify-self-start"
      >
        {sourceLabel}
      </Badge>
      <span className="text-slate-700 font-medium tabular-nums truncate">{sourceNumberLabel}</span>
      <span className="min-w-0 truncate text-slate-700">
        {row.itemName || "—"}
        {row.category && (
          <span className="ml-1 text-slate-400 text-[11px]">· {row.category}</span>
        )}
      </span>
      <span className="text-right tabular-nums text-slate-600">{row.quantity}</span>
      <span className="text-right tabular-nums text-slate-600">{formatMoneyString(row.unitPrice)}</span>
      <span className="text-right tabular-nums font-medium text-slate-700">
        {formatMoneyString(row.total)}
      </span>
    </div>
  );
}
