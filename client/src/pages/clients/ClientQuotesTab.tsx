import { useState, useMemo } from "react";
import type { Client } from "@shared/schema";
import { getQuoteStatusMeta } from "@/lib/statusBadges";
import { EntityListTable, type EntityListColumn } from "@/components/lists/EntityListTable";
import { locationDisplayName } from "@/lib/clientHelpers";
import {
  EmptyState,
  FilterChips,
  matchQuoteFilter,
  type EnrichedQuote,
  type QuoteFilter,
} from "./tabShared";

export function ClientQuotesTab({
  quotes,
  locations,
  showLocation,
  onNavigate,
}: {
  quotes: EnrichedQuote[];
  locations: Client[];
  showLocation: boolean;
  onNavigate: (p: string) => void;
}) {
  const [filter, setFilter] = useState<QuoteFilter>("all");
  const locMap = useMemo(
    () => new Map(locations.map((l) => [l.id, locationDisplayName(l)])),
    [locations],
  );
  const counts = useMemo(
    () => ({
      all: quotes.length,
      draft: quotes.filter((q) => matchQuoteFilter(q, "draft")).length,
      sent: quotes.filter((q) => matchQuoteFilter(q, "sent")).length,
      approved: quotes.filter((q) => matchQuoteFilter(q, "approved")).length,
    }),
    [quotes],
  );
  const filtered = useMemo(
    () => quotes.filter((q) => matchQuoteFilter(q, filter)),
    [quotes, filter],
  );

  const columns = useMemo<EntityListColumn<EnrichedQuote>[]>(
    () => [
      {
        id: "number",
        header: "Quote #",
        kind: "badge",
        cell: {
          type: "entity-number",
          value: (q) => (q as any).quoteNumber || `Q-${q.id.slice(0, 6)}`,
        },
        minWidthPx: 70,
        ratio: 0.6,
      },
      {
        id: "title",
        header: "Title",
        kind: "primary",
        cell: {
          type: "entity-primary",
          value: (q) => q.title || "(No title)",
        },
        ratio: 2,
      },
      ...(showLocation
        ? [
            {
              id: "location",
              header: "Location",
              kind: "text" as const,
              cell: {
                type: "entity-text" as const,
                value: (q: EnrichedQuote) =>
                  q.locationId ? locMap.get(q.locationId) ?? "—" : "—",
              },
              ratio: 1.5,
            },
          ]
        : []),
      {
        id: "status",
        header: "Status",
        kind: "status",
        cell: {
          type: "entity-status",
          getStatusMeta: (q) => getQuoteStatusMeta(q.status),
        },
        ratio: 1,
      },
      {
        id: "total",
        header: "Total",
        kind: "money",
        cell: { type: "entity-money", value: (q) => q.total },
        ratio: 0.8,
        align: "right",
      },
      {
        id: "date",
        header: "Updated",
        kind: "date",
        cell: { type: "entity-date", value: (q) => q.updatedAt ?? q.createdAt },
        ratio: 0.9,
      },
    ],
    [showLocation, locMap],
  );

  if (quotes.length === 0)
    return (
      <EmptyState
        label={
          showLocation ? "No quotes for this client" : "No quotes for this location"
        }
      />
    );

  return (
    <div>
      <FilterChips<QuoteFilter>
        value={filter}
        onChange={setFilter}
        options={[
          { key: "all", label: "All", count: counts.all },
          { key: "draft", label: "Draft", count: counts.draft },
          { key: "sent", label: "Sent", count: counts.sent },
          { key: "approved", label: "Approved", count: counts.approved },
        ]}
      />
      <EntityListTable
        rows={filtered}
        columns={columns}
        rowKey={(q) => q.id}
        onRowClick={(q) => onNavigate(`/quotes/${q.id}`)}
        emptyState={{ kind: "no-results", title: "No quotes match this filter" }}
      />
    </div>
  );
}
