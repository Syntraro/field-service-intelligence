/**
 * Inventory wire types (2026-05-08 foundation).
 *
 * Mirrors the server's response shapes exactly. The client never derives
 * `availableQuantity` itself — the server does, so the rule
 * "available = on_hand - reserved" lives in exactly one place.
 */

import type {
  InventoryLocation,
  InventoryLocationType,
  InventoryTransactionType,
  Item,
} from "@shared/schema";

export type {
  InventoryLocation,
  InventoryLocationType,
  InventoryTransactionType,
  Item,
};

/** Aggregated stock totals across all locations for a single item. */
export interface ItemStockTotals {
  itemId: string;
  totalOnHand: string;
  totalReserved: string;
  totalAvailable: string;
  locationCount: number;
}

/** Item row returned by GET /api/inventory/items. Item fields verbatim
 *  from the canonical items table + a stock summary block. */
export interface InventoryItemRow extends Item {
  stock: ItemStockTotals;
}

/** Per-(item, location) stock row returned by
 *  GET /api/inventory/items/:id/locations. */
export interface ItemLocationStock {
  id: string;
  itemId: string;
  locationId: string;
  locationName: string;
  locationType: string;
  onHandQuantity: string;
  reservedQuantity: string;
  availableQuantity: string; // Derived server-side
  minimumQuantity: string | null;
  reorderPoint: string | null;
  updatedAt: string;
}

export interface InventoryTransactionRow {
  id: string;
  companyId: string;
  itemId: string;
  fromLocationId: string | null;
  toLocationId: string | null;
  fromLocationName: string | null;
  toLocationName: string | null;
  quantity: string;
  transactionType: InventoryTransactionType;
  referenceType: string | null;
  referenceId: string | null;
  unitCost: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface LowStockRow extends ItemLocationStock {
  itemName: string | null;
  itemSku: string | null;
  /** Replenishment hint. Always >= "0". UX-only; purchase ordering is
   *  a separate workflow that hasn't shipped yet. */
  suggestedReplenishment: string;
}

/** Phase-2 enriched location row. Returned by GET /api/inventory/locations.
 *  Aggregates are computed server-side in a single GROUP BY pass; the
 *  client never N+1s for these. */
export interface LocationListRow extends InventoryLocation {
  assignedUserName: string | null;
}

export interface LocationWithAggregates extends LocationListRow {
  itemCount: number;
  totalQuantity: string;
  lowStockCount: number;
}

/** Per-(item) stock row at one location, returned by
 *  GET /api/inventory/locations/:id/inventory. Mirror of
 *  ItemLocationStock but joined with the item's display fields. */
export interface LocationItemStock {
  id: string;
  itemId: string;
  itemName: string | null;
  itemSku: string | null;
  itemModel: string | null;
  itemCategory: string | null;
  itemType: string;
  itemTrackInventory: boolean;
  locationId: string;
  onHandQuantity: string;
  reservedQuantity: string;
  availableQuantity: string;
  minimumQuantity: string | null;
  reorderPoint: string | null;
  isLowStock: boolean;
  updatedAt: string;
}

export interface LocationTransactionRow extends InventoryTransactionRow {
  itemName: string | null;
  itemSku: string | null;
}

// ── Phase 3: job inventory usage ───────────────────────────────────

export type JobInventoryUsageKind = "consumption" | "return";

/** Per-job usage row, returned by GET /api/inventory/jobs/:jobId/usage. */
export interface JobInventoryUsageRow {
  id: string;
  jobId: string;
  itemId: string;
  itemName: string | null;
  itemSku: string | null;
  itemModel: string | null;
  locationId: string;
  locationName: string;
  kind: JobInventoryUsageKind;
  parentUsageId: string | null;
  quantity: string;
  unitCostSnapshot: string;
  /** Server-derived: signed quantity * snapshot cost. */
  lineCost: string;
  consumedByUserId: string | null;
  consumedByUserName: string | null;
  notes: string | null;
  inventoryTransactionId: string | null;
  createdAt: string;
  /** True when this consumption row can be safely removed (no
   *  downstream return rows reference it). Returns are always
   *  removable individually. */
  removable: boolean;
}

export interface JobInventoryUsageSummary {
  totalConsumptionQuantity: string;
  totalReturnQuantity: string;
  totalNetQuantity: string;
  netCost: string;
}

export interface JobInventoryUsageResponse {
  rows: JobInventoryUsageRow[];
  summary: JobInventoryUsageSummary;
}

/** Compact "recent usage" row, returned by item + location rails. */
export interface RecentUsageRow {
  id: string;
  jobId: string;
  itemId: string;
  locationId: string;
  locationName: string;
  kind: JobInventoryUsageKind;
  quantity: string;
  createdAt: string;
  consumedByUserName: string | null;
}
