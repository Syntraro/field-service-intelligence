/**
 * InventoryLocationRail — canonical right rail for the Locations tab
 * (2026-05-08 Phase 2).
 *
 * Same architecture as InventoryItemRail — composes the canonical
 * `<DetailRightRail testIdPrefix="inventory-loc-side">` primitive plus
 * a thin identity strip on top. Four tabs:
 *   - overview     location identity, type, assigned user, address,
 *                  totals (item count, total quantity, low-stock count).
 *   - inventory    per-(item) stock at this location. Click an item row
 *                  to cross-navigate to the item rail. Each row has
 *                  Adjust + Transfer + View Item actions.
 *   - transfers    transactions of type='transfer' touching this loc
 *                  (either source or destination).
 *   - activity     ALL transactions touching this location, sorted DESC.
 *
 * Industry-agnostic: location-type labels come from the canonical
 * `<LocationTypeBadge>` mapping. No vertical-specific copy.
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Info,
  Boxes,
  ArrowRightLeft,
  History,
  ExternalLink,
  Layers,
  MapPin,
} from "lucide-react";
import {
  DetailRightRail,
  DetailRightRailEmpty,
  type DetailRailTab,
} from "@/components/detail-rail/DetailRightRail";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ItemActiveBadge,
  LocationTypeBadge,
  StockStatusBadge,
} from "./InventoryStatusBadges";
import { RecentUsageStrip } from "./RecentUsageStrip";
import type {
  LocationItemStock,
  LocationTransactionRow,
  LocationWithAggregates,
} from "@/lib/inventory/types";

interface InventoryLocationRailProps {
  location: LocationWithAggregates;
  onClose: () => void;
  onEditLocation: () => void;
  onArchiveLocation: () => void;
  /** Cross-navigate to the item rail when the user clicks an item row
   *  in the Inventory tab. The Locations tab on the parent page
   *  switches the rail to the item rail and stays in the same view. */
  onSelectItem: (itemId: string) => void;
  /** Open Transfer modal prefilled with this location as the source. */
  onTransferStock: (opts: { itemId: string | null }) => void;
  /** Open Adjust modal prefilled with this location. */
  onAdjustStock: (opts: { itemId: string | null }) => void;
}

export function InventoryLocationRail({
  location,
  onClose,
  onEditLocation,
  onArchiveLocation,
  onSelectItem,
  onTransferStock,
  onAdjustStock,
}: InventoryLocationRailProps) {
  const [activeTab, setActiveTab] = useState<string | null>("overview");
  // Reset tab on every location switch so opening location B doesn't
  // leave the user on location A's Activity tab.
  useEffect(() => {
    setActiveTab("overview");
  }, [location.id]);

  // Lazy per-tab fetches.
  const inventoryQuery = useQuery<{ rows: LocationItemStock[] }>({
    queryKey: ["/api/inventory/locations", location.id, "inventory"],
    queryFn: async () => {
      const res = await fetch(`/api/inventory/locations/${location.id}/inventory`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load location inventory (${res.status})`);
      return res.json();
    },
    enabled: activeTab === "inventory" || activeTab === "overview",
  });

  const transactionsQuery = useQuery<{ rows: LocationTransactionRow[] }>({
    queryKey: ["/api/inventory/locations", location.id, "transactions"],
    queryFn: async () => {
      const res = await fetch(
        `/api/inventory/locations/${location.id}/transactions`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`Failed to load location transactions (${res.status})`);
      return res.json();
    },
    enabled: activeTab === "transfers" || activeTab === "activity",
  });

  const allTx = transactionsQuery.data?.rows ?? [];
  const transferTx = allTx.filter((t) => t.transactionType === "transfer");

  const tabs: DetailRailTab[] = [
    {
      id: "overview",
      label: "Overview",
      icon: Info,
      testId: "inventory-loc-rail-tab-overview",
      action: (
        <div className="flex items-center gap-1">
          {location.isActive && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-helper text-slate-700"
              onClick={onArchiveLocation}
              data-testid="inventory-loc-rail-archive"
            >
              Archive
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-helper text-slate-700"
            onClick={onEditLocation}
            data-testid="inventory-loc-rail-edit"
          >
            Edit
          </Button>
        </div>
      ),
      content: <OverviewTab location={location} />,
    },
    {
      id: "inventory",
      label: "Inventory",
      icon: Boxes,
      testId: "inventory-loc-rail-tab-inventory",
      content: (
        <InventoryTab
          rows={inventoryQuery.data?.rows ?? []}
          isLoading={inventoryQuery.isLoading}
          onSelectItem={onSelectItem}
          onTransferStock={(itemId) => onTransferStock({ itemId })}
          onAdjustStock={(itemId) => onAdjustStock({ itemId })}
        />
      ),
    },
    {
      id: "transfers",
      label: "Transfers",
      icon: ArrowRightLeft,
      testId: "inventory-loc-rail-tab-transfers",
      content: (
        <TransactionList
          rows={transferTx}
          isLoading={transactionsQuery.isLoading}
          locationId={location.id}
          empty={{
            message: "No transfers touching this location yet",
            hint: "Stock moves to / from this location appear here as they happen.",
          }}
        />
      ),
    },
    {
      id: "activity",
      label: "Activity",
      icon: History,
      testId: "inventory-loc-rail-tab-activity",
      content: (
        <div className="space-y-4">
          {/* Phase 3: compact "Recent usage" strip surfaces the most
              recent job_inventory_usage rows touching this location
              alongside the stock-movement audit log below. */}
          <RecentUsageStrip
            scope="location"
            id={location.id}
            testIdPrefix="inventory-loc-rail-recent-usage"
          />
          <TransactionList
            rows={allTx}
            isLoading={transactionsQuery.isLoading}
            locationId={location.id}
            empty={{
              message: "No activity at this location yet",
              hint: "Transfers, adjustments, and consumption events appear here as they happen.",
            }}
          />
        </div>
      ),
    },
  ];

  return (
    <div
      className="h-full bg-white border border-slate-200 rounded-md overflow-hidden flex flex-col"
      data-testid="inventory-loc-rail"
    >
      <header className="px-3 py-2 border-b border-slate-200 flex items-center gap-2 min-w-0">
        <div className="min-w-0 flex-1">
          <div
            className="text-row-emphasis text-slate-900 truncate"
            data-testid="inventory-loc-rail-name"
          >
            {location.name}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <LocationTypeBadge type={location.type} />
            <ItemActiveBadge active={location.isActive} />
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0">
        <DetailRightRail
          tabs={tabs}
          activeTabId={activeTab}
          onActiveTabChange={(id) => {
            if (id === null) {
              onClose();
              return;
            }
            setActiveTab(id);
          }}
          testIdPrefix="inventory-loc-side"
          ariaLabel="Inventory location rail"
        />
      </div>
    </div>
  );
}

// ─── Overview ───────────────────────────────────────────────────────

function OverviewTab({ location }: { location: LocationWithAggregates }) {
  const addrParts = [
    location.address,
    location.address2,
    [location.city, location.provinceState, location.postalCode]
      .filter(Boolean)
      .join(", "),
    location.country,
  ].filter((s): s is string => Boolean(s && s.trim()));

  return (
    <dl className="space-y-2 text-row" data-testid="inventory-loc-rail-overview">
      <Field label="Type">
        <LocationTypeBadge type={location.type} />
      </Field>
      <Field label="Status">
        <ItemActiveBadge active={location.isActive} />
      </Field>
      <Field label="Assigned to">{location.assignedUserName ?? "—"}</Field>
      <Field label="Created">
        {location.createdAt ? new Date(location.createdAt).toLocaleDateString() : "—"}
      </Field>

      {addrParts.length > 0 && (
        <div className="pt-2">
          <div className="text-helper text-slate-500 mb-0.5">Address</div>
          <div className="text-row text-slate-700 flex items-start gap-1.5">
            <MapPin className="h-3.5 w-3.5 text-slate-400 mt-0.5 shrink-0" />
            <span className="min-w-0">{addrParts.join(" · ")}</span>
          </div>
        </div>
      )}

      {/* Totals row — single source of truth for the location's stock
          summary. The same numbers appear in the Locations table row
          via the same /locations endpoint. */}
      <div className="pt-3 mt-3 border-t border-slate-200 grid grid-cols-3 gap-2 text-helper text-slate-600">
        <Stat label="Items" value={String(location.itemCount)} />
        <Stat label="Total Qty" value={formatQty(location.totalQuantity)} />
        <Stat
          label="Low Stock"
          value={String(location.lowStockCount)}
          tone={location.lowStockCount > 0 ? "warning" : "neutral"}
        />
      </div>

      {location.notes ? (
        <div className="pt-2">
          <div className="text-helper text-slate-500 mb-0.5">Notes</div>
          <p className="text-row text-slate-700 whitespace-pre-wrap">{location.notes}</p>
        </div>
      ) : null}
    </dl>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-helper text-slate-500 shrink-0">{label}</dt>
      <dd className="text-row text-slate-900 text-right min-w-0">{children}</dd>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "warning";
}) {
  return (
    <div className="text-center">
      <div
        className={
          tone === "warning"
            ? "text-row-emphasis text-amber-700 tabular-nums"
            : "text-row-emphasis text-slate-900 tabular-nums"
        }
      >
        {value}
      </div>
      <div className="text-helper text-slate-500">{label}</div>
    </div>
  );
}

// ─── Inventory tab ─────────────────────────────────────────────────

interface InventoryTabProps {
  rows: LocationItemStock[];
  isLoading: boolean;
  onSelectItem: (itemId: string) => void;
  onTransferStock: (itemId: string) => void;
  onAdjustStock: (itemId: string) => void;
}

function InventoryTab({
  rows,
  isLoading,
  onSelectItem,
  onTransferStock,
  onAdjustStock,
}: InventoryTabProps) {
  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="inventory-loc-rail-inventory-loading">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <DetailRightRailEmpty
        message="No stock at this location yet"
        hint="Use Adjust Stock to record an opening balance, or Make Transfer to move stock in."
        testIdPrefix="inventory-loc-side"
      />
    );
  }

  return (
    <ul className="space-y-2" data-testid="inventory-loc-rail-inventory">
      {rows.map((r) => (
        <li
          key={r.id}
          className="rounded-md border border-slate-200 bg-white px-3 py-2"
          data-testid={`inventory-loc-rail-item-${r.itemId}`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-row-emphasis text-slate-900 truncate">
                {r.itemName ?? "Unnamed item"}
              </div>
              {(r.itemSku || r.itemModel) && (
                <div className="text-helper text-slate-500 truncate">
                  {[r.itemSku, r.itemModel].filter(Boolean).join(" · ")}
                </div>
              )}
            </div>
            <div className="text-right shrink-0">
              <div className="text-row-emphasis text-slate-900 tabular-nums">
                {formatQty(r.onHandQuantity)}
              </div>
              <div className="text-helper text-slate-500">on hand</div>
            </div>
          </div>
          <div className="mt-1.5 grid grid-cols-3 gap-2 text-helper text-slate-600">
            <div>
              <span className="text-slate-500">Available:</span>{" "}
              <span className="tabular-nums">{formatQty(r.availableQuantity)}</span>
            </div>
            <div>
              <span className="text-slate-500">Reserved:</span>{" "}
              <span className="tabular-nums">{formatQty(r.reservedQuantity)}</span>
            </div>
            <div className="flex items-center gap-1">
              <StockStatusBadge
                onHand={r.onHandQuantity}
                available={r.availableQuantity}
                minimum={r.minimumQuantity}
                reorderPoint={r.reorderPoint}
              />
            </div>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-helper"
              onClick={() => onTransferStock(r.itemId)}
              data-testid={`inventory-loc-rail-item-transfer-${r.itemId}`}
            >
              <ArrowRightLeft className="h-3 w-3 mr-1" />
              Transfer
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-helper"
              onClick={() => onAdjustStock(r.itemId)}
              data-testid={`inventory-loc-rail-item-adjust-${r.itemId}`}
            >
              <Layers className="h-3 w-3 mr-1" />
              Adjust
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-helper"
              onClick={() => onSelectItem(r.itemId)}
              data-testid={`inventory-loc-rail-item-view-${r.itemId}`}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              View Item
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─── Transaction list (used by Transfers + Activity tabs) ──────────

interface TransactionListProps {
  rows: LocationTransactionRow[];
  isLoading: boolean;
  locationId: string;
  empty: { message: string; hint?: string };
}

function TransactionList({ rows, isLoading, locationId, empty }: TransactionListProps) {
  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="inventory-loc-rail-tx-loading">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <DetailRightRailEmpty
        message={empty.message}
        hint={empty.hint}
        testIdPrefix="inventory-loc-side-tx"
      />
    );
  }

  return (
    <ul className="space-y-2" data-testid="inventory-loc-rail-transactions">
      {rows.map((t) => {
        const direction = formatTxDirection(t, locationId);
        return (
          <li
            key={t.id}
            className="rounded-md border border-slate-200 bg-white px-3 py-2"
            data-testid={`inventory-loc-rail-tx-${t.id}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-row text-slate-900 truncate">
                  {t.itemName ?? "Unnamed item"}
                </div>
                <div className="text-helper text-slate-500 truncate">
                  <span className="capitalize">
                    {t.transactionType.replace(/_/g, " ")}
                  </span>
                  {direction ? <> · {direction}</> : null}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-row-emphasis text-slate-900 tabular-nums">
                  {formatQty(t.quantity)}
                </div>
                <div className="text-helper text-slate-500">
                  {formatRelativeDate(t.createdAt)}
                </div>
              </div>
            </div>
            {t.notes ? (
              <div className="mt-1 text-helper text-slate-600 whitespace-pre-wrap">{t.notes}</div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────

/** From the perspective of the location whose rail we're rendering,
 *  describe the movement direction in plain language. Industry-agnostic. */
function formatTxDirection(t: LocationTransactionRow, locationId: string): string {
  if (t.fromLocationId === locationId && t.toLocationId) {
    return `→ ${t.toLocationName ?? "—"}`;
  }
  if (t.toLocationId === locationId && t.fromLocationId) {
    return `← ${t.fromLocationName ?? "—"}`;
  }
  if (t.toLocationId === locationId) return "in";
  if (t.fromLocationId === locationId) return "out";
  return "";
}

function formatQty(value: string | null | undefined): string {
  if (value == null) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n % 1 === 0 ? String(n) : String(Number(n.toFixed(4)));
}

function formatRelativeDate(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
