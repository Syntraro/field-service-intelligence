/**
 * InventoryPage — capability-gated inventory module home.
 * Phase 1 (2026-05-08): foundation. Phase 2 (2026-05-08): location rail,
 * location aggregates, low-stock formula update, search/filter,
 * canonical inventory badges, transfer/adjust prefill, item rail
 * keyboard nav.
 *
 * Mounted at /inventory. Six tabs:
 *   - Items       (working — EntityListTable + InventoryItemRail with
 *                  ESC close + prev/next nav + canonical badges)
 *   - Locations   (working — summary cards + EntityListTable +
 *                  InventoryLocationRail + DropdownMenu row actions)
 *   - Transfers   (canonical empty state — modals work, list view
 *                  ships in a follow-up)
 *   - Adjustments (canonical empty state — same)
 *   - Counts      (canonical empty state — deferred)
 *   - Low Stock   (working — Phase-2 rule: available <= minimum_quantity,
 *                  with suggestedReplenishment column)
 *
 * Capability gating:
 *   - Server: requireFeature("inventory_core") on /api/inventory/* (authoritative).
 *   - Client: this page short-circuits to a canonical "Inventory not
 *     available" panel when useFeatureEnabled returns false.
 *
 * Mutually-exclusive rails: an item rail and a location rail cannot be
 * open simultaneously — opening one closes the other. The Inventory tab
 * inside the Location Rail can cross-navigate to the item rail (the
 * page swaps the rail surface).
 *
 * Industry-agnostic: every label / hint / helper here is generic.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  Boxes,
  MapPin,
  ArrowRightLeft,
  ClipboardList,
  Layers,
  AlertTriangle,
  Search,
  MoreHorizontal,
  Building2,
  Truck,
  Archive,
  Pencil,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { FilterChip, StatusChip } from "@/components/ui/chip";
import { EntityListTable, type EntityListColumn } from "@/components/lists/EntityListTable";
import { useFeatureEnabled } from "@/hooks/useEntitlements";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";
import { InventoryItemRail } from "@/components/inventory/InventoryItemRail";
import { InventoryLocationRail } from "@/components/inventory/InventoryLocationRail";
import { InventoryItemModal } from "@/components/inventory/InventoryItemModal";
import { InventoryLocationModal } from "@/components/inventory/InventoryLocationModal";
import { TransferStockModal } from "@/components/inventory/TransferStockModal";
import { AdjustStockModal } from "@/components/inventory/AdjustStockModal";
import {
  ItemActiveBadge,
  ItemStockBadge,
  LocationTypeBadge,
} from "@/components/inventory/InventoryStatusBadges";
import type {
  InventoryItemRow,
  InventoryLocation,
  LocationWithAggregates,
  LowStockRow,
} from "@/lib/inventory/types";

const TAB_DEFS = [
  { key: "items", label: "Items", icon: Boxes },
  { key: "locations", label: "Locations", icon: MapPin },
  { key: "transfers", label: "Transfers", icon: ArrowRightLeft },
  { key: "adjustments", label: "Adjustments", icon: Layers },
  { key: "counts", label: "Counts", icon: ClipboardList },
  { key: "low_stock", label: "Low Stock", icon: AlertTriangle },
] as const;

type TabKey = (typeof TAB_DEFS)[number]["key"];

// Item filter shape. `all` is the open-everything default; the rest
// narrow the list. The set is intentionally small — heavy filtering
// belongs on a future advanced-filters drawer, not the top bar.
type ItemTypeFilter = "all" | "product" | "service";
type ItemStockFilter = "all" | "stock" | "non_stock" | "active_only";

type LocationTypeFilter = "all" | "warehouse" | "vehicle" | "office" | "storage" | "temporary" | "other";
type LocationActiveFilter = "active" | "inactive" | "all";

export default function InventoryPage() {
  const featureEnabled = useFeatureEnabled("inventory_core");
  const [activeTab, setActiveTab] = useState<TabKey>("items");

  // Mutually-exclusive rail state — opening one closes the other.
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);

  // Modal state.
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItemRow | null>(null);
  const [locationModalOpen, setLocationModalOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<InventoryLocation | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  // Phase-2: contextual prefill for Transfer + Adjust modals.
  const [transferPrefillFromLocId, setTransferPrefillFromLocId] = useState<string | null>(null);
  const [adjustPrefillLocId, setAdjustPrefillLocId] = useState<string | null>(null);

  // ── Capability short-circuit ─────────────────────────────────────
  if (featureEnabled === false) {
    return (
      <div className="px-6 py-6 max-w-3xl mx-auto" data-testid="inventory-feature-disabled">
        <h1 className="text-page-title font-semibold text-slate-900">Inventory</h1>
        <p className="text-row text-text-secondary mt-2">
          Inventory is not enabled on your plan. Contact support to enable it for your tenant.
        </p>
      </div>
    );
  }

  function openItemRail(itemId: string) {
    setSelectedLocationId(null); // mutually exclusive
    setSelectedItemId(itemId);
  }
  function openLocationRail(locationId: string) {
    setSelectedItemId(null); // mutually exclusive
    setSelectedLocationId(locationId);
  }

  return (
    <div className="p-6 space-y-5" data-testid="inventory-page">
      {/* ── Page header ──────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1
            className="text-page-title font-semibold text-slate-900"
            data-testid="inventory-page-title"
          >
            Inventory
          </h1>
          <p className="text-row text-text-secondary mt-0.5">
            Track items, stock levels, and locations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === "items" && (
            <Button
              size="sm"
              onClick={() => {
                setEditingItem(null);
                setItemModalOpen(true);
              }}
              data-testid="inventory-new-item"
            >
              <Plus className="h-4 w-4 mr-1" />
              New Item
            </Button>
          )}
          {activeTab === "locations" && (
            <Button
              size="sm"
              onClick={() => {
                setEditingLocation(null);
                setLocationModalOpen(true);
              }}
              data-testid="inventory-new-location"
            >
              <Plus className="h-4 w-4 mr-1" />
              New Location
            </Button>
          )}
        </div>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────── */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
        <TabsList data-testid="inventory-tabs">
          {TAB_DEFS.map((t) => {
            const Icon = t.icon;
            return (
              <TabsTrigger
                key={t.key}
                value={t.key}
                data-testid={`inventory-tab-${t.key}`}
              >
                <Icon className="h-3.5 w-3.5 mr-1.5" />
                {t.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {/* ITEMS — table + right rail */}
        <TabsContent value="items" className="mt-3">
          <ItemsTabBody
            selectedItemId={selectedItemId}
            onSelectItem={openItemRail}
            onCloseItemRail={() => setSelectedItemId(null)}
            onEditItem={(item) => {
              setEditingItem(item);
              setItemModalOpen(true);
            }}
            onTransferStock={() => {
              setTransferPrefillFromLocId(null);
              setTransferOpen(true);
            }}
            onAdjustStock={() => {
              setAdjustPrefillLocId(null);
              setAdjustOpen(true);
            }}
          />
        </TabsContent>

        {/* LOCATIONS — summary cards + table + location rail */}
        <TabsContent value="locations" className="mt-3">
          <LocationsTabBody
            selectedLocationId={selectedLocationId}
            onSelectLocation={openLocationRail}
            onCloseLocationRail={() => setSelectedLocationId(null)}
            onEditLocation={(loc) => {
              setEditingLocation(loc);
              setLocationModalOpen(true);
            }}
            onSelectItemFromLocation={(itemId) => openItemRail(itemId)}
            onTransferFromLocation={(locationId, itemId) => {
              setTransferPrefillFromLocId(locationId);
              // No way to prefill itemId on transfer right now without
              // additional plumbing — modal opens with item selector
              // un-locked. Source location is what the rail conveys.
              setTransferOpen(true);
              if (itemId) openItemRail(itemId); // also open item rail so quantity context is visible
            }}
            onAdjustFromLocation={(locationId, itemId) => {
              setAdjustPrefillLocId(locationId);
              setAdjustOpen(true);
              if (itemId) openItemRail(itemId);
            }}
          />
        </TabsContent>

        {/* TRANSFERS — canonical empty state */}
        <TabsContent value="transfers" className="mt-3">
          <CanonicalEmpty
            icon={ArrowRightLeft}
            message="No transfers yet"
            hint="Move stock between locations from an item's right rail or a location's Inventory tab."
            testId="inventory-transfers-empty"
          />
        </TabsContent>

        {/* ADJUSTMENTS — canonical empty state */}
        <TabsContent value="adjustments" className="mt-3">
          <CanonicalEmpty
            icon={Layers}
            message="No adjustments yet"
            hint="Adjust stock at a location from an item's right rail or a location's Inventory tab."
            testId="inventory-adjustments-empty"
          />
        </TabsContent>

        {/* COUNTS — deferred for v1 */}
        <TabsContent value="counts" className="mt-3">
          <CanonicalEmpty
            icon={ClipboardList}
            message="Stock counts coming soon"
            hint="Periodic count + reconcile workflow ships in a follow-up release."
            testId="inventory-counts-empty"
          />
        </TabsContent>

        {/* LOW STOCK */}
        <TabsContent value="low_stock" className="mt-3">
          <LowStockTabBody />
        </TabsContent>
      </Tabs>

      {/* ── Modals ───────────────────────────────────────────────── */}
      <InventoryItemModal
        open={itemModalOpen}
        onOpenChange={setItemModalOpen}
        editing={editingItem}
      />
      <InventoryLocationModal
        open={locationModalOpen}
        onOpenChange={setLocationModalOpen}
        editing={editingLocation}
      />
      <TransferStockModal
        open={transferOpen}
        onOpenChange={(open) => {
          setTransferOpen(open);
          if (!open) setTransferPrefillFromLocId(null);
        }}
        itemId={selectedItemId}
        prefillFromLocationId={transferPrefillFromLocId}
      />
      <AdjustStockModal
        open={adjustOpen}
        onOpenChange={(open) => {
          setAdjustOpen(open);
          if (!open) setAdjustPrefillLocId(null);
        }}
        itemId={selectedItemId}
        prefillLocationId={adjustPrefillLocId}
      />
    </div>
  );
}

// ─── Items tab ──────────────────────────────────────────────────────

interface ItemsTabBodyProps {
  selectedItemId: string | null;
  onSelectItem: (id: string) => void;
  onCloseItemRail: () => void;
  onEditItem: (item: InventoryItemRow) => void;
  onTransferStock: () => void;
  onAdjustStock: () => void;
}

function ItemsTabBody({
  selectedItemId,
  onSelectItem,
  onCloseItemRail,
  onEditItem,
  onTransferStock,
  onAdjustStock,
}: ItemsTabBodyProps) {
  // Phase-2 search + filters. Server query is unfiltered (cheap; the
  // page's typical row count is small enough); client-side filtering
  // keeps the implementation simple and avoids a server change.
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<ItemTypeFilter>("all");
  const [stockFilter, setStockFilter] = useState<ItemStockFilter>("all");

  const itemsQuery = useQuery<{ items: InventoryItemRow[] }>({
    queryKey: ["/api/inventory/items"],
    queryFn: async () => {
      const res = await fetch("/api/inventory/items", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load inventory items (${res.status})`);
      return res.json();
    },
  });

  const items = itemsQuery.data?.items ?? [];

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((it) => {
      if (typeFilter !== "all" && it.type !== typeFilter) return false;
      if (stockFilter === "stock" && (it.type !== "product" || !it.trackInventory)) return false;
      if (stockFilter === "non_stock" && (it.type !== "product" || it.trackInventory)) return false;
      if (stockFilter === "active_only" && !it.isActive) return false;
      if (q) {
        const haystack = [
          it.name ?? "",
          it.sku ?? "",
          it.model ?? "",
          it.category ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [items, searchQuery, typeFilter, stockFilter]);

  const selectedItem = useMemo(
    () => items.find((it) => it.id === selectedItemId) ?? null,
    [items, selectedItemId],
  );

  // Phase-2 prev/next: walk the FILTERED list so the rail navigation
  // respects the active search/filter state. The handlers are null when
  // there's no neighbour in that direction — the rail disables the
  // button + the keyboard shortcut becomes a no-op.
  const selectedIdx = filteredItems.findIndex((it) => it.id === selectedItemId);
  const prevItem = selectedIdx > 0 ? filteredItems[selectedIdx - 1] : null;
  const nextItem =
    selectedIdx >= 0 && selectedIdx < filteredItems.length - 1
      ? filteredItems[selectedIdx + 1]
      : null;

  const columns: EntityListColumn<InventoryItemRow>[] = useMemo(
    () => [
      {
        id: "item",
        kind: "primary",
        ratio: 1.6,
        header: "Item",
        render: (it) => it.name ?? "—",
      },
      {
        id: "sku",
        kind: "text",
        ratio: 0.9,
        header: "SKU / Model",
        render: (it) => (
          <span>
            {it.sku ?? "—"}
            {it.model ? <span className="text-slate-500"> · {it.model}</span> : null}
          </span>
        ),
      },
      {
        id: "category",
        kind: "text",
        ratio: 0.9,
        header: "Category",
        render: (it) => it.category ?? "—",
      },
      {
        id: "type",
        kind: "badge",
        ratio: 0.7,
        header: "Type",
        render: (it) => (
          <ItemStockBadge itemType={it.type} trackInventory={it.trackInventory} />
        ),
      },
      {
        id: "on_hand",
        kind: "money",
        ratio: 0.5,
        header: <span>On Hand</span>,
        render: (it) => renderQuantity(it),
      },
      {
        id: "available",
        kind: "money",
        ratio: 0.5,
        header: <span>Available</span>,
        render: (it) => renderAvailable(it),
      },
      {
        id: "unit_cost",
        kind: "money",
        ratio: 0.5,
        header: <span>Unit Cost</span>,
        render: (it) => formatMoney(it.cost),
      },
      {
        id: "unit_price",
        kind: "money",
        ratio: 0.5,
        header: <span>Unit Price</span>,
        render: (it) => formatMoney(it.unitPrice),
      },
      {
        id: "status",
        kind: "status",
        ratio: 0.6,
        header: "Status",
        render: (it) => <ItemActiveBadge active={it.isActive ?? true} />,
      },
    ],
    [],
  );

  return (
    <div className="space-y-3">
      {/* Search + filter bar */}
      <ItemsFilterBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        stockFilter={stockFilter}
        onStockFilterChange={setStockFilter}
        resultCount={filteredItems.length}
        totalCount={items.length}
      />

      <div className="flex gap-4">
        <div className="flex-1 min-w-0">
          <EntityListTable<InventoryItemRow>
            rows={filteredItems}
            columns={columns}
            rowKey={(it) => it.id}
            onRowClick={(it) =>
              it.id === selectedItemId ? onCloseItemRail() : onSelectItem(it.id)
            }
            selectedRowKey={selectedItemId ?? undefined}
            loadingState={
              itemsQuery.isLoading ? (
                <div className="px-4 py-3 space-y-2">
                  <Skeleton className="h-7 w-full" />
                  <Skeleton className="h-7 w-full" />
                  <Skeleton className="h-7 w-full" />
                </div>
              ) : undefined
            }
            emptyState={
              <CanonicalEmpty
                icon={Boxes}
                message={items.length === 0 ? "No items yet" : "No items match these filters"}
                hint={
                  items.length === 0
                    ? "Click + New Item to add the first product or service to your catalog."
                    : "Try clearing the search or widening the filters."
                }
                testId="inventory-items-empty"
              />
            }
          />
        </div>

        {selectedItem && (
          <div className="w-[420px] shrink-0">
            <InventoryItemRail
              item={selectedItem}
              onClose={onCloseItemRail}
              onEditItem={() => onEditItem(selectedItem)}
              onTransferStock={onTransferStock}
              onAdjustStock={onAdjustStock}
              onSelectPrev={prevItem ? () => onSelectItem(prevItem.id) : undefined}
              onSelectNext={nextItem ? () => onSelectItem(nextItem.id) : undefined}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Items filter bar ──────────────────────────────────────────────

interface ItemsFilterBarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  typeFilter: ItemTypeFilter;
  onTypeFilterChange: (v: ItemTypeFilter) => void;
  stockFilter: ItemStockFilter;
  onStockFilterChange: (v: ItemStockFilter) => void;
  resultCount: number;
  totalCount: number;
}

function ItemsFilterBar({
  searchQuery,
  onSearchChange,
  typeFilter,
  onTypeFilterChange,
  stockFilter,
  onStockFilterChange,
  resultCount,
  totalCount,
}: ItemsFilterBarProps) {
  return (
    <div
      className="flex flex-wrap items-center gap-3"
      data-testid="inventory-items-filter-bar"
    >
      <div className="relative flex-1 min-w-[220px] max-w-md">
        <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <Input
          type="text"
          placeholder="Search items by name, SKU, model, or category"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-8"
          data-testid="inventory-items-search"
        />
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <FilterChip
          selected={typeFilter === "all"}
          onClick={() => onTypeFilterChange("all")}
          data-testid="inventory-items-filter-type-all"
        >
          All Types
        </FilterChip>
        <FilterChip
          selected={typeFilter === "product"}
          onClick={() => onTypeFilterChange("product")}
          data-testid="inventory-items-filter-type-product"
        >
          Products
        </FilterChip>
        <FilterChip
          selected={typeFilter === "service"}
          onClick={() => onTypeFilterChange("service")}
          data-testid="inventory-items-filter-type-service"
        >
          Services
        </FilterChip>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <FilterChip
          selected={stockFilter === "all"}
          onClick={() => onStockFilterChange("all")}
          data-testid="inventory-items-filter-stock-all"
        >
          All
        </FilterChip>
        <FilterChip
          selected={stockFilter === "stock"}
          onClick={() => onStockFilterChange("stock")}
          data-testid="inventory-items-filter-stock-tracked"
        >
          Stock
        </FilterChip>
        <FilterChip
          selected={stockFilter === "non_stock"}
          onClick={() => onStockFilterChange("non_stock")}
          data-testid="inventory-items-filter-stock-non"
        >
          Non-Stock
        </FilterChip>
        <FilterChip
          selected={stockFilter === "active_only"}
          onClick={() => onStockFilterChange("active_only")}
          data-testid="inventory-items-filter-stock-active"
        >
          Active Only
        </FilterChip>
      </div>

      {resultCount !== totalCount && (
        <span
          className="text-helper text-slate-500 ml-auto"
          data-testid="inventory-items-result-count"
        >
          {resultCount} of {totalCount}
        </span>
      )}
    </div>
  );
}

// ─── Locations tab ──────────────────────────────────────────────────

interface LocationsTabBodyProps {
  selectedLocationId: string | null;
  onSelectLocation: (id: string) => void;
  onCloseLocationRail: () => void;
  onEditLocation: (loc: InventoryLocation) => void;
  onSelectItemFromLocation: (itemId: string) => void;
  onTransferFromLocation: (locationId: string, itemId: string | null) => void;
  onAdjustFromLocation: (locationId: string, itemId: string | null) => void;
}

function LocationsTabBody({
  selectedLocationId,
  onSelectLocation,
  onCloseLocationRail,
  onEditLocation,
  onSelectItemFromLocation,
  onTransferFromLocation,
  onAdjustFromLocation,
}: LocationsTabBodyProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<LocationTypeFilter>("all");
  const [activeFilter, setActiveFilter] = useState<LocationActiveFilter>("active");

  const locationsQuery = useQuery<{ rows: LocationWithAggregates[] }>({
    queryKey: ["/api/inventory/locations", "with-aggregates"],
    queryFn: async () => {
      const res = await fetch("/api/inventory/locations?includeInactive=true", {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load inventory locations (${res.status})`);
      return res.json();
    },
  });

  const rows = locationsQuery.data?.rows ?? [];

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((loc) => {
      if (activeFilter === "active" && !loc.isActive) return false;
      if (activeFilter === "inactive" && loc.isActive) return false;
      if (typeFilter !== "all" && loc.type !== typeFilter) return false;
      if (q) {
        const haystack = [
          loc.name,
          loc.assignedUserName ?? "",
          loc.address ?? "",
          loc.city ?? "",
          loc.notes ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [rows, searchQuery, typeFilter, activeFilter]);

  const selectedLocation = useMemo(
    () => rows.find((loc) => loc.id === selectedLocationId) ?? null,
    [rows, selectedLocationId],
  );

  // Summary card aggregates (computed from already-fetched rows; no
  // extra round-trip).
  const summary = useMemo(() => {
    const total = rows.length;
    const active = rows.filter((r) => r.isActive).length;
    const vehicles = rows.filter((r) => r.type === "vehicle").length;
    const warehouses = rows.filter((r) => r.type === "warehouse").length;
    const lowStockLocations = rows.filter((r) => r.lowStockCount > 0).length;
    const totalQty = rows.reduce((acc, r) => acc + Number(r.totalQuantity || 0), 0);
    return { total, active, vehicles, warehouses, lowStockLocations, totalQty };
  }, [rows]);

  async function archiveLocation(locationId: string) {
    try {
      await apiRequest(`/api/inventory/locations/${locationId}/archive`, {
        method: "POST",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/locations"] });
      toast({ title: "Location archived" });
      if (selectedLocationId === locationId) onCloseLocationRail();
    } catch (err) {
      toast({
        title: "Couldn't archive location",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  const columns: EntityListColumn<LocationWithAggregates>[] = useMemo(
    () => [
      {
        id: "name",
        kind: "primary",
        ratio: 1.4,
        header: "Name",
        render: (loc) => loc.name,
      },
      {
        id: "type",
        kind: "badge",
        ratio: 0.7,
        header: "Type",
        render: (loc) => <LocationTypeBadge type={loc.type} />,
      },
      {
        id: "assigned",
        kind: "text",
        ratio: 1.0,
        header: "Assigned User",
        render: (loc) => loc.assignedUserName ?? "—",
      },
      {
        id: "address",
        kind: "text",
        ratio: 1.5,
        header: "Address",
        render: (loc) => formatAddress(loc),
      },
      {
        id: "items",
        kind: "money",
        ratio: 0.45,
        header: <span>Items</span>,
        render: (loc) => (
          <span data-testid={`inventory-location-itemcount-${loc.id}`}>
            {loc.itemCount}
          </span>
        ),
      },
      {
        id: "qty",
        kind: "money",
        ratio: 0.5,
        header: <span>Total Qty</span>,
        render: (loc) => (
          <span data-testid={`inventory-location-totalqty-${loc.id}`}>
            {formatQty(loc.totalQuantity)}
          </span>
        ),
      },
      {
        id: "status",
        kind: "status",
        ratio: 0.7,
        header: "Status",
        render: (loc) => (
          <span className="flex items-center gap-1">
            <ItemActiveBadge active={loc.isActive} />
            {loc.lowStockCount > 0 && (
              <StatusChip
                tone="warning"
                data-testid={`inventory-location-low-stock-${loc.id}`}
              >
                {loc.lowStockCount} low
              </StatusChip>
            )}
          </span>
        ),
      },
      {
        id: "actions",
        kind: "badge",
        ratio: 0.4,
        header: "",
        render: (loc) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-slate-100"
                onClick={(e) => e.stopPropagation()}
                aria-label={`Actions for ${loc.name}`}
                data-testid={`inventory-location-actions-${loc.id}`}
              >
                <MoreHorizontal className="h-4 w-4 text-slate-500" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectLocation(loc.id);
                }}
              >
                View details
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onEditLocation(loc);
                }}
              >
                <Pencil className="h-3.5 w-3.5 mr-2" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {loc.isActive && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    archiveLocation(loc.id);
                  }}
                >
                  <Archive className="h-3.5 w-3.5 mr-2" />
                  Archive
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [onSelectLocation, onEditLocation],
  );

  return (
    <div className="space-y-3">
      {/* Phase-2: 5-card summary strip above the table. Inline JSX
          mirrors the InvoicesListPage SummaryCard pattern (no shared
          stat-card primitive exists — every list page implements its
          own row of summary tiles). Industry-agnostic copy. */}
      <div
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4"
        data-testid="inventory-locations-summary"
      >
        <SummaryCard
          label="Total Locations"
          value={String(summary.total)}
          note={summary.active === summary.total ? "All active" : `${summary.active} active`}
          icon={MapPin}
          iconColor="text-slate-600"
          iconBg="bg-slate-100"
          testId="inventory-summary-total"
        />
        <SummaryCard
          label="Vehicles"
          value={String(summary.vehicles)}
          note=""
          icon={Truck}
          iconColor="text-amber-600"
          iconBg="bg-amber-50"
          testId="inventory-summary-vehicles"
        />
        <SummaryCard
          label="Warehouses"
          value={String(summary.warehouses)}
          note=""
          icon={Building2}
          iconColor="text-blue-600"
          iconBg="bg-blue-50"
          testId="inventory-summary-warehouses"
        />
        <SummaryCard
          label="Low Stock Locations"
          value={String(summary.lowStockLocations)}
          note={summary.lowStockLocations > 0 ? "Need attention" : "All healthy"}
          icon={AlertTriangle}
          iconColor={summary.lowStockLocations > 0 ? "text-amber-600" : "text-emerald-600"}
          iconBg={summary.lowStockLocations > 0 ? "bg-amber-50" : "bg-emerald-50"}
          testId="inventory-summary-low-stock"
        />
        <SummaryCard
          label="Total Quantity"
          value={formatQty(String(summary.totalQty))}
          note=""
          icon={Boxes}
          iconColor="text-emerald-600"
          iconBg="bg-emerald-50"
          testId="inventory-summary-total-qty"
        />
      </div>

      {/* Search + filter bar */}
      <LocationsFilterBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        activeFilter={activeFilter}
        onActiveFilterChange={setActiveFilter}
        resultCount={filteredRows.length}
        totalCount={rows.length}
      />

      <div className="flex gap-4">
        <div className="flex-1 min-w-0">
          <EntityListTable<LocationWithAggregates>
            rows={filteredRows}
            columns={columns}
            rowKey={(loc) => loc.id}
            onRowClick={(loc) =>
              loc.id === selectedLocationId
                ? onCloseLocationRail()
                : onSelectLocation(loc.id)
            }
            selectedRowKey={selectedLocationId ?? undefined}
            loadingState={
              locationsQuery.isLoading ? (
                <div className="px-4 py-3 space-y-2">
                  <Skeleton className="h-7 w-full" />
                  <Skeleton className="h-7 w-full" />
                </div>
              ) : undefined
            }
            emptyState={
              <CanonicalEmpty
                icon={MapPin}
                message={
                  rows.length === 0
                    ? "No locations yet"
                    : "No locations match these filters"
                }
                hint={
                  rows.length === 0
                    ? "Add warehouses, vehicles, and other places stock lives."
                    : "Try clearing the search or widening the filters."
                }
                testId="inventory-locations-empty"
              />
            }
          />
        </div>

        {selectedLocation && (
          <div className="w-[420px] shrink-0">
            <InventoryLocationRail
              location={selectedLocation}
              onClose={onCloseLocationRail}
              onEditLocation={() => onEditLocation(selectedLocation)}
              onArchiveLocation={() => archiveLocation(selectedLocation.id)}
              onSelectItem={onSelectItemFromLocation}
              onTransferStock={({ itemId }) =>
                onTransferFromLocation(selectedLocation.id, itemId)
              }
              onAdjustStock={({ itemId }) =>
                onAdjustFromLocation(selectedLocation.id, itemId)
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Locations filter bar ──────────────────────────────────────────

interface LocationsFilterBarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  typeFilter: LocationTypeFilter;
  onTypeFilterChange: (v: LocationTypeFilter) => void;
  activeFilter: LocationActiveFilter;
  onActiveFilterChange: (v: LocationActiveFilter) => void;
  resultCount: number;
  totalCount: number;
}

const LOCATION_TYPE_FILTERS: { value: LocationTypeFilter; label: string }[] = [
  { value: "all", label: "All Types" },
  { value: "warehouse", label: "Warehouses" },
  { value: "vehicle", label: "Vehicles" },
  { value: "office", label: "Office" },
  { value: "storage", label: "Storage" },
  { value: "temporary", label: "Temporary" },
  { value: "other", label: "Other" },
];

function LocationsFilterBar({
  searchQuery,
  onSearchChange,
  typeFilter,
  onTypeFilterChange,
  activeFilter,
  onActiveFilterChange,
  resultCount,
  totalCount,
}: LocationsFilterBarProps) {
  return (
    <div
      className="flex flex-wrap items-center gap-3"
      data-testid="inventory-locations-filter-bar"
    >
      <div className="relative flex-1 min-w-[220px] max-w-md">
        <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <Input
          type="text"
          placeholder="Search locations by name, assigned user, or address"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-8"
          data-testid="inventory-locations-search"
        />
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {LOCATION_TYPE_FILTERS.map((f) => (
          <FilterChip
            key={f.value}
            selected={typeFilter === f.value}
            onClick={() => onTypeFilterChange(f.value)}
            data-testid={`inventory-locations-filter-type-${f.value}`}
          >
            {f.label}
          </FilterChip>
        ))}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <FilterChip
          selected={activeFilter === "active"}
          onClick={() => onActiveFilterChange("active")}
          data-testid="inventory-locations-filter-active"
        >
          Active
        </FilterChip>
        <FilterChip
          selected={activeFilter === "inactive"}
          onClick={() => onActiveFilterChange("inactive")}
          data-testid="inventory-locations-filter-inactive"
        >
          Archived
        </FilterChip>
        <FilterChip
          selected={activeFilter === "all"}
          onClick={() => onActiveFilterChange("all")}
          data-testid="inventory-locations-filter-all"
        >
          All
        </FilterChip>
      </div>

      {resultCount !== totalCount && (
        <span
          className="text-helper text-slate-500 ml-auto"
          data-testid="inventory-locations-result-count"
        >
          {resultCount} of {totalCount}
        </span>
      )}
    </div>
  );
}

// ─── Low stock tab ──────────────────────────────────────────────────

function LowStockTabBody() {
  const lowStockQuery = useQuery<{ rows: LowStockRow[] }>({
    queryKey: ["/api/inventory/low-stock"],
    queryFn: async () => {
      const res = await fetch("/api/inventory/low-stock", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load low-stock list (${res.status})`);
      return res.json();
    },
  });

  const rows = lowStockQuery.data?.rows ?? [];

  const columns: EntityListColumn<LowStockRow>[] = useMemo(
    () => [
      {
        id: "item",
        kind: "primary",
        ratio: 1.3,
        header: "Item",
        render: (r) => (
          <span>
            {r.itemName ?? "—"}
            {r.itemSku ? <span className="text-slate-500"> · {r.itemSku}</span> : null}
          </span>
        ),
      },
      {
        id: "location",
        kind: "text",
        ratio: 1.0,
        header: "Location",
        render: (r) => r.locationName,
      },
      {
        id: "available",
        kind: "money",
        ratio: 0.5,
        header: <span>Available</span>,
        render: (r) => formatQty(r.availableQuantity),
      },
      {
        id: "minimum",
        kind: "money",
        ratio: 0.5,
        header: <span>Minimum</span>,
        render: (r) => (r.minimumQuantity != null ? formatQty(r.minimumQuantity) : "—"),
      },
      {
        id: "reorder",
        kind: "money",
        ratio: 0.5,
        header: <span>Reorder At</span>,
        render: (r) => (r.reorderPoint != null ? formatQty(r.reorderPoint) : "—"),
      },
      {
        id: "suggested",
        kind: "money",
        ratio: 0.6,
        header: <span>Suggested</span>,
        render: (r) => (
          <span data-testid={`inventory-low-stock-suggested-${r.id}`}>
            {formatQty(r.suggestedReplenishment)}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <EntityListTable<LowStockRow>
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      loadingState={
        lowStockQuery.isLoading ? (
          <div className="px-4 py-3 space-y-2">
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-full" />
          </div>
        ) : undefined
      }
      emptyState={
        <CanonicalEmpty
          icon={AlertTriangle}
          message="Nothing is low on stock"
          hint="Items appear here when their available quantity (on-hand minus reserved) drops to or below the configured minimum."
          testId="inventory-low-stock-empty"
        />
      }
    />
  );
}

// ─── Helpers + shared canonical primitives ──────────────────────────

function CanonicalEmpty({
  icon: Icon,
  message,
  hint,
  testId,
}: {
  icon: React.ComponentType<{ className?: string }>;
  message: string;
  hint?: string;
  testId: string;
}) {
  return (
    <div
      className="text-center py-12 px-4 space-y-2 rounded-md border border-slate-200 bg-white"
      data-testid={testId}
    >
      <Icon className="h-6 w-6 mx-auto text-slate-400" />
      <p className="text-row text-slate-700">{message}</p>
      {hint && <p className="text-helper text-slate-500">{hint}</p>}
    </div>
  );
}

interface SummaryCardProps {
  label: string;
  value: string;
  note: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  iconBg: string;
  testId?: string;
}

/** Inline mirror of the InvoicesListPage SummaryCard pattern. No shared
 *  stat-card primitive exists today — every list page implements its
 *  own row of summary tiles. Industry-agnostic copy. */
function SummaryCard({ label, value, note, icon: Icon, iconColor, iconBg, testId }: SummaryCardProps) {
  return (
    <div
      className="bg-white rounded-md border border-slate-200 shadow-sm px-5 py-4"
      data-testid={testId}
    >
      <div className="flex items-center gap-2">
        <div className={`p-1.5 rounded-md ${iconBg}`}>
          <Icon className={`h-3.5 w-3.5 ${iconColor}`} />
        </div>
        <div className="text-caption font-medium text-slate-500">{label}</div>
      </div>
      <div className="text-page-title font-bold text-slate-900 tabular-nums mt-2">{value}</div>
      {note && <div className="text-caption text-slate-500 mt-0.5">{note}</div>}
    </div>
  );
}

/** Render the On Hand cell. Service items + non-stock items show em-dash
 *  per the foundation rules. */
function renderQuantity(it: InventoryItemRow): React.ReactNode {
  if (it.type === "service" || !it.trackInventory)
    return <span className="text-slate-400">—</span>;
  return (
    <span data-testid={`inventory-item-onhand-${it.id}`}>
      {formatQty(it.stock.totalOnHand)}
    </span>
  );
}

function renderAvailable(it: InventoryItemRow): React.ReactNode {
  if (it.type === "service" || !it.trackInventory)
    return <span className="text-slate-400">—</span>;
  return (
    <span data-testid={`inventory-item-available-${it.id}`}>
      {formatQty(it.stock.totalAvailable)}
    </span>
  );
}

function formatMoney(value: string | null | undefined): React.ReactNode {
  if (value == null || value === "") return <span className="text-slate-400">—</span>;
  const n = Number(value);
  if (!Number.isFinite(n)) return <span className="text-slate-400">—</span>;
  return `$${n.toFixed(2)}`;
}

function formatQty(value: string | null | undefined): string {
  if (value == null) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n % 1 === 0 ? String(n) : String(Number(n.toFixed(4)));
}

function formatAddress(loc: InventoryLocation): string {
  const parts = [loc.address, loc.city, loc.provinceState, loc.postalCode].filter(Boolean);
  return parts.length ? parts.join(", ") : "—";
}
