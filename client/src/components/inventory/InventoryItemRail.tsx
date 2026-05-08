/**
 * InventoryItemRail — canonical right-rail consumer for the Inventory
 * Items tab (2026-05-08 foundation).
 *
 * Mounts <DetailRightRail testIdPrefix="inventory-side"> with 4 tabs:
 *   - overview     item identity + pricing + tax + tracking flags
 *   - locations    per-location stock with Make Transfer / Adjust Stock
 *   - transactions recent inventory_transactions for this item
 *   - settings     reorder thresholds (per-location editable)
 *
 * The rail is stateless about the active tab — InventoryPage owns
 * `selectedItemId`, this component owns `activeRailTab` (defaults to
 * "overview" on every fresh selection so the user lands on the
 * identity card every time they open a different item).
 *
 * Service items and non-stock products are still allowed in the rail —
 * the Locations tab + transfer/adjust actions short-circuit to a
 * canonical empty/disabled state for them per the foundation rules:
 *   Rule 6: services + non-stock show em-dash for quantity fields.
 *   Rule 6: services + non-stock do NOT allow transfer/adjustment actions.
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Info,
  MapPin,
  History,
  Settings,
  ArrowRightLeft,
  Layers,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import {
  DetailRightRail,
  DetailRightRailEmpty,
  type DetailRailTab,
} from "@/components/detail-rail/DetailRightRail";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ItemActiveBadge, ItemStockBadge, StockStatusBadge } from "./InventoryStatusBadges";
import { RecentUsageStrip } from "./RecentUsageStrip";
import type {
  InventoryItemRow,
  ItemLocationStock,
  InventoryTransactionRow,
} from "@/lib/inventory/types";

interface InventoryItemRailProps {
  item: InventoryItemRow;
  onClose: () => void;
  onEditItem: () => void;
  onTransferStock: () => void;
  onAdjustStock: () => void;
  /** Phase-2: prev/next navigation between rows in the current Items
   *  view. The page passes both handlers + null when there's no
   *  neighbour in that direction (first or last row). The rail header
   *  renders the prev/next buttons; ESC closes the rail. */
  onSelectPrev?: () => void;
  onSelectNext?: () => void;
}

export function InventoryItemRail({
  item,
  onClose,
  onEditItem,
  onTransferStock,
  onAdjustStock,
  onSelectPrev,
  onSelectNext,
}: InventoryItemRailProps) {
  // Reset the active rail tab to "overview" when the user switches
  // items (so opening item B doesn't leave the user on item A's
  // Settings tab).
  const [activeTab, setActiveTab] = useState<string | null>("overview");
  useEffect(() => {
    setActiveTab("overview");
  }, [item.id]);

  // Phase-2 keyboard shortcuts:
  //   - Escape closes the rail.
  //   - ArrowUp / ArrowDown move to the previous / next item.
  // The handlers DO NOT fire when the user is typing in an input or
  // textarea — typical "global key inside a rail" hygiene check so the
  // shortcuts don't hijack search-box input.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isFormField =
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        target?.isContentEditable;
      if (isFormField) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowUp" && onSelectPrev) {
        e.preventDefault();
        onSelectPrev();
        return;
      }
      if (e.key === "ArrowDown" && onSelectNext) {
        e.preventDefault();
        onSelectNext();
        return;
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, onSelectPrev, onSelectNext]);

  const stockable = item.type === "product" && item.trackInventory;

  // Per-tab data fetching is gated on the active tab so we don't
  // pre-fetch transactions / locations until the user actually opens
  // those tabs.
  const locationsQuery = useQuery<{ rows: ItemLocationStock[] }>({
    queryKey: ["/api/inventory/items", item.id, "locations"],
    queryFn: async () => {
      const res = await fetch(`/api/inventory/items/${item.id}/locations`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load item locations (${res.status})`);
      return res.json();
    },
    enabled: activeTab === "locations" || activeTab === "settings",
  });

  const transactionsQuery = useQuery<{ rows: InventoryTransactionRow[] }>({
    queryKey: ["/api/inventory/items", item.id, "transactions"],
    queryFn: async () => {
      const res = await fetch(`/api/inventory/items/${item.id}/transactions`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load item transactions (${res.status})`);
      return res.json();
    },
    enabled: activeTab === "transactions",
  });

  const tabs: DetailRailTab[] = [
    {
      id: "overview",
      label: "Overview",
      icon: Info,
      testId: "inventory-rail-tab-overview",
      action: (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-helper text-slate-700"
          onClick={onEditItem}
          data-testid="inventory-rail-edit-item"
        >
          Edit
        </Button>
      ),
      content: <OverviewTab item={item} />,
    },
    {
      id: "locations",
      label: "Locations",
      icon: MapPin,
      testId: "inventory-rail-tab-locations",
      content: (
        <LocationsTab
          item={item}
          stockable={stockable}
          rows={locationsQuery.data?.rows ?? []}
          isLoading={locationsQuery.isLoading}
          onTransferStock={onTransferStock}
          onAdjustStock={onAdjustStock}
        />
      ),
    },
    {
      id: "transactions",
      label: "Activity",
      icon: History,
      testId: "inventory-rail-tab-transactions",
      content: (
        <div className="space-y-4">
          {/* Phase 3: compact "Recent usage" strip surfaces the most
              recent job_inventory_usage rows for this item so the
              user sees consumption activity alongside the stock-
              movement audit log below. */}
          {stockable && (
            <RecentUsageStrip
              scope="item"
              id={item.id}
              testIdPrefix="inventory-rail-recent-usage"
            />
          )}
          <TransactionsTab
            stockable={stockable}
            rows={transactionsQuery.data?.rows ?? []}
            isLoading={transactionsQuery.isLoading}
          />
        </div>
      ),
    },
    {
      id: "settings",
      label: "Settings",
      icon: Settings,
      testId: "inventory-rail-tab-settings",
      content: (
        <SettingsTab
          item={item}
          stockable={stockable}
          rows={locationsQuery.data?.rows ?? []}
          isLoading={locationsQuery.isLoading}
        />
      ),
    },
  ];

  return (
    <div className="h-full bg-white border border-slate-200 rounded-md overflow-hidden flex flex-col" data-testid="inventory-rail">
      {/* Identity strip — item name + sku/model + active state. The
          DetailRightRail primitive already renders a per-tab header;
          this thin strip above it is the item identity (always visible
          while the rail is open). */}
      <header className="px-3 py-2 border-b border-slate-200 flex items-center gap-2 min-w-0">
        <div className="min-w-0 flex-1">
          <div
            className="text-row-emphasis text-slate-900 truncate"
            data-testid="inventory-rail-item-name"
          >
            {item.name ?? "Untitled item"}
          </div>
          {(item.sku || item.model) && (
            <div className="text-helper text-slate-500 truncate">
              {[item.sku, item.model].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Prev/Next item navigation. Disabled when the page passes
              null (first / last row). Same affordance keyboard
              ArrowUp / ArrowDown drive — see the keydown effect above. */}
          {(onSelectPrev || onSelectNext) && (
            <div className="flex items-center" data-testid="inventory-rail-nav">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={onSelectPrev}
                disabled={!onSelectPrev}
                aria-label="Previous item"
                data-testid="inventory-rail-nav-prev"
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={onSelectNext}
                disabled={!onSelectNext}
                aria-label="Next item"
                data-testid="inventory-rail-nav-next"
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </div>
          )}
          <ItemActiveBadge active={item.isActive ?? true} />
        </div>
      </header>

      <div className="flex-1 min-h-0">
        <DetailRightRail
          tabs={tabs}
          activeTabId={activeTab}
          onActiveTabChange={(id) => {
            // Closing the rail (id === null) clears the page-level
            // selectedItemId so the highlight + rail unmount in sync.
            if (id === null) {
              onClose();
              return;
            }
            setActiveTab(id);
          }}
          testIdPrefix="inventory-side"
          ariaLabel="Inventory item rail"
        />
      </div>
    </div>
  );
}

// ─── Tabs ───────────────────────────────────────────────────────────

function OverviewTab({ item }: { item: InventoryItemRow }) {
  return (
    <dl className="space-y-2 text-row" data-testid="inventory-rail-overview">
      <Field label="Type">
        <span className="capitalize">{item.type}</span>
      </Field>
      <Field label="Category">{item.category ?? "—"}</Field>
      <Field label="SKU">{item.sku ?? "—"}</Field>
      <Field label="Model">{item.model ?? "—"}</Field>
      <Field label="Unit Cost">{formatMoney(item.cost)}</Field>
      <Field label="Unit Price">{formatMoney(item.unitPrice)}</Field>
      <Field label="Track Inventory">
        {item.type === "service"
          ? "—"
          : item.trackInventory
            ? "Yes (Stock Item)"
            : "No (Non-Stock)"}
      </Field>
      <Field label="Taxable">
        {item.isTaxable ? "Yes" : "No"}
      </Field>
      {item.description ? (
        <div className="pt-2">
          <div className="text-helper text-slate-500 mb-0.5">Description</div>
          <p className="text-row text-slate-700 whitespace-pre-wrap">{item.description}</p>
        </div>
      ) : null}
    </dl>
  );
}

interface LocationsTabProps {
  item: InventoryItemRow;
  stockable: boolean;
  rows: ItemLocationStock[];
  isLoading: boolean;
  onTransferStock: () => void;
  onAdjustStock: () => void;
}

function LocationsTab({
  item,
  stockable,
  rows,
  isLoading,
  onTransferStock,
  onAdjustStock,
}: LocationsTabProps) {
  if (!stockable) {
    return (
      <DetailRightRailEmpty
        message={
          item.type === "service"
            ? "Service items don't track stock."
            : "This item is non-stock."
        }
        hint={
          item.type === "service"
            ? "Services can't have inventory locations or transfers."
            : "Enable Track Inventory in Edit to start tracking stock at locations."
        }
        testIdPrefix="inventory-side"
      />
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="inventory-rail-locations-loading">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="inventory-rail-locations">
      {/* Action row — transfer + adjust live here, not on the panel
          header, so they feel like Locations-tab actions specifically. */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={onTransferStock}
          data-testid="inventory-rail-transfer-action"
        >
          <ArrowRightLeft className="h-3.5 w-3.5 mr-1" />
          Make Transfer
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onAdjustStock}
          data-testid="inventory-rail-adjust-action"
        >
          <Layers className="h-3.5 w-3.5 mr-1" />
          Adjust Stock
        </Button>
      </div>

      {rows.length === 0 ? (
        <DetailRightRailEmpty
          message="No stock at any location yet"
          hint="Use Adjust Stock to record an opening balance, or Make Transfer to move stock in."
          testIdPrefix="inventory-side-locations"
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="rounded-md border border-slate-200 bg-white px-3 py-2"
              data-testid={`inventory-rail-loc-${r.locationId}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-row-emphasis text-slate-900 truncate">{r.locationName}</div>
                  <div className="text-helper text-slate-500 capitalize">{r.locationType}</div>
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
                <div>
                  <span className="text-slate-500">Reorder:</span>{" "}
                  <span className="tabular-nums">{r.reorderPoint ?? "—"}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface TransactionsTabProps {
  stockable: boolean;
  rows: InventoryTransactionRow[];
  isLoading: boolean;
}

function TransactionsTab({ stockable, rows, isLoading }: TransactionsTabProps) {
  if (!stockable) {
    return (
      <DetailRightRailEmpty
        message="No activity to show."
        hint="Inventory activity is only tracked for stock items."
        testIdPrefix="inventory-side-tx"
      />
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="inventory-rail-tx-loading">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <DetailRightRailEmpty
        message="No activity yet"
        hint="Transfers, adjustments, and consumption show up here once you record any."
        testIdPrefix="inventory-side-tx"
      />
    );
  }

  return (
    <ul className="space-y-2" data-testid="inventory-rail-transactions">
      {rows.map((t) => (
        <li
          key={t.id}
          className="rounded-md border border-slate-200 bg-white px-3 py-2"
          data-testid={`inventory-rail-tx-${t.id}`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-row text-slate-900 truncate capitalize">
                {t.transactionType.replace(/_/g, " ")}
              </div>
              <div className="text-helper text-slate-500">
                {formatTxDirection(t)}
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
      ))}
    </ul>
  );
}

interface SettingsTabProps {
  item: InventoryItemRow;
  stockable: boolean;
  rows: ItemLocationStock[];
  isLoading: boolean;
}

function SettingsTab({ item, stockable, rows, isLoading }: SettingsTabProps) {
  if (!stockable) {
    return (
      <DetailRightRailEmpty
        message="No reorder settings."
        hint="Reorder thresholds apply only to stock items."
        testIdPrefix="inventory-side-settings"
      />
    );
  }
  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="inventory-rail-settings-loading">
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <DetailRightRailEmpty
        message="No locations to configure"
        hint="Stock the item at a location first; then per-location minimum + reorder thresholds appear here."
        testIdPrefix="inventory-side-settings"
      />
    );
  }
  return (
    <div className="space-y-2" data-testid="inventory-rail-settings">
      {rows.map((r) => (
        <div
          key={r.id}
          className="rounded-md border border-slate-200 bg-white px-3 py-2"
          data-testid={`inventory-rail-settings-${r.locationId}`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="text-row-emphasis text-slate-900 truncate">{r.locationName}</div>
            <span className="text-helper text-slate-500 capitalize">{r.locationType}</span>
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-2 text-helper text-slate-700">
            <div>
              <span className="text-slate-500">Minimum:</span>{" "}
              <span className="tabular-nums">{r.minimumQuantity ?? "—"}</span>
            </div>
            <div>
              <span className="text-slate-500">Reorder At:</span>{" "}
              <span className="tabular-nums">{r.reorderPoint ?? "—"}</span>
            </div>
          </div>
        </div>
      ))}
      <p className="text-helper text-slate-500 px-1">
        Threshold editing ships in a follow-up release.
      </p>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-helper text-slate-500 shrink-0">{label}</dt>
      <dd className="text-row text-slate-900 text-right min-w-0">{children}</dd>
    </div>
  );
}

function formatMoney(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

function formatQty(value: string | null | undefined): string {
  if (value == null) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n % 1 === 0 ? String(n) : String(Number(n.toFixed(4)));
}

function formatTxDirection(t: InventoryTransactionRow): string {
  if (t.fromLocationId && t.toLocationId) {
    return `${t.fromLocationName ?? "—"} → ${t.toLocationName ?? "—"}`;
  }
  if (t.toLocationId) return `→ ${t.toLocationName ?? "—"} (in)`;
  if (t.fromLocationId) return `${t.fromLocationName ?? "—"} → (out)`;
  return "—";
}

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
