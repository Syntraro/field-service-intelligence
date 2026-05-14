/**
 * InvoicePricingHistoryPanel — per-line pricing context for Invoice Detail.
 *
 * Line selector: a vertical compact list of the current invoice's line items.
 * The active item drives two pricing sections below:
 *   - "Previous client pricing" — recent prices billed/quoted to the same
 *     location for the selected item (exact productId match)
 *   - "Most recent elsewhere" — most recent price for the same item at any
 *     other location, including client name if available
 *
 * Matching strategy: exact productId match only. Free-text-only lines (no
 * productId) will show the section empty states — documented limitation.
 *
 * Active-item fallback: `effectiveSelectedId` is derived — if `selectedLineId`
 * is absent or no longer in the lines array (item removed from invoice), it
 * falls back to `lines[0]` automatically without an effect.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/formatters";
import {
  RailContentCard,
  RailContentCardHeader,
  RailContentCardTitle,
} from "@/components/detail-rail/RailContentCard";
import type { InvoiceLine } from "@shared/schema";

export interface InvoicePricingHistoryPanelProps {
  invoiceId: string;
  locationId: string | null;
  lines: InvoiceLine[];
}

interface PricingHistoryItem {
  itemId: string | null;
  locationName: string | null;
  itemName: string;
  sourceType: "invoice" | "quote";
  sourceId: string;
  sourceNumber: string | null;
  unitPrice: string;
  quantity: string;
  total: string;
  date: string;
}

interface PricingHistoryResult {
  items: PricingHistoryItem[];
}

function PricingRow({
  item,
  showLocationName,
}: {
  item: PricingHistoryItem;
  showLocationName?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 py-1.5 border-t border-slate-100 first:border-t-0">
      <div className="flex-1 min-w-0">
        {showLocationName && item.locationName && (
          <p className="text-helper text-foreground truncate leading-tight">{item.locationName}</p>
        )}
        <p className="text-helper text-muted-foreground leading-tight">
          <span className="tabular-nums">
            {item.sourceType === "invoice" ? "INV" : "QUO"}
            {item.sourceNumber ? ` #${item.sourceNumber}` : ""}
          </span>
          {" · "}
          <span className="tabular-nums">{format(new Date(item.date), "MMM d, yyyy")}</span>
        </p>
      </div>
      <span className="shrink-0 text-emphasis tabular-nums text-text-primary">
        {formatCurrency(item.unitPrice)}
      </span>
    </div>
  );
}

function PricingSection({
  title,
  items,
  isLoading,
  testId,
  showLocationName,
  emptyMessage = "No history found.",
}: {
  title: string;
  items: PricingHistoryItem[];
  isLoading: boolean;
  testId: string;
  showLocationName?: boolean;
  emptyMessage?: string;
}) {
  return (
    <RailContentCard testId={testId}>
      <RailContentCardHeader>
        <RailContentCardTitle as="h4">{title}</RailContentCardTitle>
      </RailContentCardHeader>
      {isLoading && (
        <p className="text-helper text-muted-foreground mt-1.5">Loading…</p>
      )}
      {!isLoading && items.length === 0 && (
        <p className="text-helper text-muted-foreground mt-1.5 italic">{emptyMessage}</p>
      )}
      {!isLoading && items.length > 0 && (
        <div className="mt-1">
          {items.map((item, i) => (
            <PricingRow
              key={`${item.sourceType}-${item.sourceId ?? i}`}
              item={item}
              showLocationName={showLocationName}
            />
          ))}
        </div>
      )}
    </RailContentCard>
  );
}

export function InvoicePricingHistoryPanel({
  locationId,
  lines,
}: InvoicePricingHistoryPanelProps) {
  // Explicit user selection — null means "use first line by default"
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);

  // Derived active id: if selectedLineId is absent or stale (item removed from
  // invoice), fall back to lines[0] without needing a useEffect.
  const effectiveSelectedId =
    selectedLineId !== null && lines.find((l) => l.id === selectedLineId)
      ? selectedLineId
      : (lines[0]?.id ?? null);

  const selectedLine = lines.find((l) => l.id === effectiveSelectedId) ?? null;
  const selectedItemId = selectedLine?.productId ?? null;

  const { data: prevClientData, isLoading: prevClientLoading } =
    useQuery<PricingHistoryResult>({
      queryKey: ["pricing-history", "client", locationId, selectedItemId],
      queryFn: async () => {
        const url = `/api/clients/${locationId}/pricing-history?itemId=${selectedItemId}&limit=5`;
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) throw new Error("Failed to fetch client pricing history");
        return res.json();
      },
      enabled: !!locationId && !!selectedItemId,
      staleTime: 60_000,
      refetchIntervalInBackground: false,
    });

  const { data: elsewhereData, isLoading: elsewhereLoading } =
    useQuery<PricingHistoryResult>({
      queryKey: ["pricing-history", "elsewhere", selectedItemId, locationId],
      queryFn: async () => {
        const params = new URLSearchParams({ itemId: selectedItemId!, limit: "5" });
        if (locationId) params.set("excludeLocationId", locationId);
        const res = await fetch(`/api/invoices/item-pricing-context?${params}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error("Failed to fetch elsewhere pricing");
        return res.json();
      },
      enabled: !!selectedItemId,
      staleTime: 60_000,
      refetchIntervalInBackground: false,
    });

  if (lines.length === 0) {
    return (
      <div className="py-2" data-testid="invoice-pricing-history-panel">
        <p className="text-helper text-muted-foreground">
          Add a line item to view pricing history.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="invoice-pricing-history-panel">
      {/* ── Vertical compact line selector ──────────────────── */}
      <div data-testid="invoice-pricing-line-picker">
        <p className="text-label uppercase tracking-wide text-muted-foreground mb-1.5">
          Select a line item to view pricing history
        </p>
        <div
          className="overflow-y-auto rounded-md border border-slate-200 bg-white max-h-48"
          data-testid="invoice-pricing-line-list"
        >
          {lines.map((line) => {
            const isActive = line.id === effectiveSelectedId;
            return (
              <button
                key={line.id}
                type="button"
                onClick={() => setSelectedLineId(line.id)}
                className={`relative w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors border-b border-slate-100 last:border-b-0 ${
                  isActive ? "bg-emerald-50" : "hover:bg-slate-50"
                }`}
                data-testid={`pricing-line-pick-${line.id}`}
              >
                {/* Active left accent bar — canonical brand green */}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-0 bottom-0 w-0.5 bg-[#76B054] rounded-r"
                  />
                )}
                {/* Radio dot — filled green when active, outlined neutral when not */}
                <span
                  aria-hidden="true"
                  className={`shrink-0 h-2.5 w-2.5 rounded-full border-2 transition-colors ${
                    isActive ? "border-[#76B054] bg-[#76B054]" : "border-slate-300"
                  }`}
                />
                <span className="flex-1 min-w-0 text-helper text-foreground truncate">
                  {line.description || "(no description)"}
                </span>
                <span className="shrink-0 text-helper tabular-nums text-muted-foreground">
                  {formatCurrency(line.unitPrice ?? "0")}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Pricing history sections ─────────────────────────── */}
      <PricingSection
        title="Previous client pricing"
        items={prevClientData?.items ?? []}
        isLoading={prevClientLoading}
        testId="invoice-pricing-this-client"
        emptyMessage="No previous pricing for this client."
      />

      <PricingSection
        title="Most recent elsewhere"
        items={elsewhereData?.items ?? []}
        isLoading={elsewhereLoading}
        testId="invoice-pricing-elsewhere"
        showLocationName
        emptyMessage="No recent pricing elsewhere."
      />
    </div>
  );
}
