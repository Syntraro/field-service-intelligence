/**
 * RecentUsageStrip — compact rail-internal "Recent usage" list.
 * (2026-05-08 — Inventory Phase 3.)
 *
 * Used by both InventoryItemRail and InventoryLocationRail to surface
 * the most-recent job_inventory_usage rows (consumption + return).
 * Keeps each rail consistent without duplicating render logic.
 *
 * Industry-agnostic — labels read as generic field-service vocabulary.
 *
 * The component is intentionally minimal:
 *   - 3-line empty state (canonical pattern, matches DetailRightRailEmpty
 *     visual rhythm).
 *   - Skeleton loading (canonical primitive).
 *   - Compact list rows (no actions; Job # + qty + direction badge +
 *     date). Drilldown lives in the main JobDetailPage section.
 *
 * Mounted as a sub-section inside an existing rail tab — does NOT add
 * a new tab.
 */

import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusChip } from "@/components/ui/chip";
import type { RecentUsageRow } from "@/lib/inventory/types";

interface RecentUsageStripProps {
  /** "item" → fetches /api/inventory/items/:id/recent-usage.
   *  "location" → fetches /api/inventory/locations/:id/recent-usage. */
  scope: "item" | "location";
  /** The id whose recent usage to fetch. */
  id: string;
  /** Header text. Optional — defaults to "Recent usage". */
  title?: string;
  /** Limit, capped server-side at 50. Defaults to 5 — rail strips
   *  stay compact. */
  limit?: number;
  /** Test id prefix forwarded onto the strip wrapper + each row. */
  testIdPrefix?: string;
}

export function RecentUsageStrip({
  scope,
  id,
  title = "Recent usage",
  limit = 5,
  testIdPrefix = "recent-usage",
}: RecentUsageStripProps) {
  const url =
    scope === "item"
      ? `/api/inventory/items/${id}/recent-usage?limit=${limit}`
      : `/api/inventory/locations/${id}/recent-usage?limit=${limit}`;
  const queryKey =
    scope === "item"
      ? ["/api/inventory/items", id, "recent-usage"]
      : ["/api/inventory/locations", id, "recent-usage"];

  const usageQuery = useQuery<{ rows: RecentUsageRow[] }>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load recent usage (${res.status})`);
      return res.json();
    },
  });

  const rows = usageQuery.data?.rows ?? [];

  return (
    <div className="space-y-1.5" data-testid={`${testIdPrefix}-strip`}>
      <div className="text-helper text-slate-500">{title}</div>
      {usageQuery.isLoading ? (
        <div className="space-y-1.5">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <div
          className="text-helper text-slate-400 italic"
          data-testid={`${testIdPrefix}-empty`}
        >
          Nothing yet.
        </div>
      ) : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li
              key={r.id}
              className="text-helper text-slate-700 flex items-center justify-between gap-2"
              data-testid={`${testIdPrefix}-row-${r.id}`}
            >
              <span className="min-w-0 flex items-center gap-1.5 truncate">
                {r.kind === "return" ? (
                  <StatusChip tone="info" size="compact">
                    Returned
                  </StatusChip>
                ) : (
                  <StatusChip tone="neutral" size="compact">
                    Consumed
                  </StatusChip>
                )}
                <span className="truncate text-slate-500">
                  {scope === "item"
                    ? r.locationName
                    : (r.consumedByUserName ?? "—")}
                </span>
              </span>
              <span className="shrink-0 tabular-nums text-slate-700">
                {r.kind === "return" ? "−" : ""}
                {formatQty(r.quantity)}
                <span className="text-slate-400 ml-1.5">{formatDate(r.createdAt)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatQty(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n % 1 === 0 ? String(n) : String(Number(n.toFixed(4)));
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
