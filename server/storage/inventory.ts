/**
 * Inventory storage layer (2026-05-08 foundation).
 *
 * Three repositories + one service:
 *   - inventoryLocationsRepository  CRUD on inventory_locations.
 *   - inventoryQuantitiesRepository per-(item, location) reads + lazy
 *                                   initialization. Settings-only updates
 *                                   (minimum / reorder thresholds) live
 *                                   here; QUANTITY mutations live in the
 *                                   service so they always pair with a
 *                                   transaction row.
 *   - inventoryTransactionsRepository read-only history per item.
 *   - inventoryService              performTransfer / performAdjustment.
 *                                   Both wrap a single Drizzle tx that
 *                                   (a) inserts the transaction row and
 *                                   (b) updates the quantity rows.
 *
 * Tenant scoping: every query filters by company_id. Inventory routes
 * inject companyId from req.companyId; this layer never reads it from
 * the input shape.
 *
 * Available quantity rule: derived at read time as on_hand - reserved.
 * Never stored. Single source of truth = on_hand_quantity +
 * reserved_quantity columns.
 */

import { db } from "../db";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import {
  inventoryLocations,
  inventoryQuantities,
  inventoryReservations,
  inventoryTransactions,
  jobInventoryUsage,
  items,
  jobs,
  jobParts,
  users,
  type InventoryLocation,
  type InventoryQuantity,
  type InventoryTransaction,
  type InventoryReservation,
  type InsertInventoryLocation,
  type UpdateInventoryLocation,
  type UpdateInventoryQuantitySettings,
  type TransferInventoryInput,
  type AdjustInventoryInput,
  type ConsumeInventoryForJobInput,
  type ReturnInventoryFromJobInput,
  type ReserveInventoryInput,
} from "@shared/schema";

// ─── Locations ─────────────────────────────────────────────────────────────

/** Bare location row + assigned-user display name (when an
 *  assigned_user_id is set). Used by the modal `<Select>` pickers and
 *  the transfer / adjust contexts where summary aggregates are not
 *  needed. The phase-2 enriched shape (with totals + low-stock count)
 *  lives in `LocationWithAggregates` below. */
export interface LocationListRow extends InventoryLocation {
  assignedUserName: string | null;
}

/** Phase-2 enriched shape — the Locations tab table consumes this
 *  shape. Aggregates are computed in a single GROUP BY pass keyed by
 *  location_id. */
export interface LocationWithAggregates extends LocationListRow {
  itemCount: number;
  totalQuantity: string;
  lowStockCount: number;
}

async function listLocations(companyId: string, includeInactive = false): Promise<LocationListRow[]> {
  const baseFilter = includeInactive
    ? eq(inventoryLocations.companyId, companyId)
    : and(
        eq(inventoryLocations.companyId, companyId),
        eq(inventoryLocations.isActive, true),
      );
  const rows = await db
    .select({
      id: inventoryLocations.id,
      companyId: inventoryLocations.companyId,
      name: inventoryLocations.name,
      type: inventoryLocations.type,
      isActive: inventoryLocations.isActive,
      assignedUserId: inventoryLocations.assignedUserId,
      address: inventoryLocations.address,
      address2: inventoryLocations.address2,
      city: inventoryLocations.city,
      provinceState: inventoryLocations.provinceState,
      postalCode: inventoryLocations.postalCode,
      country: inventoryLocations.country,
      notes: inventoryLocations.notes,
      createdAt: inventoryLocations.createdAt,
      updatedAt: inventoryLocations.updatedAt,
      assignedUserName: sql<string | null>`COALESCE(${users.firstName} || ' ' || ${users.lastName}, ${users.email})`,
    })
    .from(inventoryLocations)
    .leftJoin(users, eq(inventoryLocations.assignedUserId, users.id))
    .where(baseFilter)
    .orderBy(inventoryLocations.name);
  return rows;
}

/** Phase-2: the same list, but enriched per-row with itemCount /
 *  totalQuantity / lowStockCount from a single GROUP BY pass. The
 *  Locations tab consumes this directly so the table never N+1s.
 *
 *  Aggregates are computed against the (item, location) quantity rows
 *  for THIS company only (tenant scoped). A location with no quantity
 *  rows yet returns 0 / "0" / 0 — never NULL. */
async function listLocationsWithAggregates(
  companyId: string,
  includeInactive = false,
): Promise<LocationWithAggregates[]> {
  const locs = await listLocations(companyId, includeInactive);
  if (locs.length === 0) return [];

  // One aggregate pass keyed by location_id. The lowStockCount uses the
  // same `available <= minimum_quantity` rule as the Low Stock list so
  // the two surfaces never disagree.
  const aggRows = await db
    .select({
      locationId: inventoryQuantities.locationId,
      itemCount: sql<number>`COUNT(*)::int`,
      totalQuantity: sql<string>`COALESCE(SUM(${inventoryQuantities.onHandQuantity}), 0)`,
      lowStockCount: sql<number>`COUNT(*) FILTER (
        WHERE ${inventoryQuantities.minimumQuantity} IS NOT NULL
          AND (${inventoryQuantities.onHandQuantity} - ${inventoryQuantities.reservedQuantity})
              <= ${inventoryQuantities.minimumQuantity}
      )::int`,
    })
    .from(inventoryQuantities)
    .where(eq(inventoryQuantities.companyId, companyId))
    .groupBy(inventoryQuantities.locationId);

  const aggByLoc = new Map<string, { itemCount: number; totalQuantity: string; lowStockCount: number }>();
  for (const r of aggRows) {
    aggByLoc.set(r.locationId, {
      itemCount: r.itemCount,
      totalQuantity: String(r.totalQuantity),
      lowStockCount: r.lowStockCount,
    });
  }

  return locs.map((loc) => ({
    ...loc,
    itemCount: aggByLoc.get(loc.id)?.itemCount ?? 0,
    totalQuantity: aggByLoc.get(loc.id)?.totalQuantity ?? "0",
    lowStockCount: aggByLoc.get(loc.id)?.lowStockCount ?? 0,
  }));
}

async function getLocation(companyId: string, id: string): Promise<LocationListRow | null> {
  const [row] = await db
    .select({
      id: inventoryLocations.id,
      companyId: inventoryLocations.companyId,
      name: inventoryLocations.name,
      type: inventoryLocations.type,
      isActive: inventoryLocations.isActive,
      assignedUserId: inventoryLocations.assignedUserId,
      address: inventoryLocations.address,
      address2: inventoryLocations.address2,
      city: inventoryLocations.city,
      provinceState: inventoryLocations.provinceState,
      postalCode: inventoryLocations.postalCode,
      country: inventoryLocations.country,
      notes: inventoryLocations.notes,
      createdAt: inventoryLocations.createdAt,
      updatedAt: inventoryLocations.updatedAt,
      assignedUserName: sql<string | null>`COALESCE(${users.firstName} || ' ' || ${users.lastName}, ${users.email})`,
    })
    .from(inventoryLocations)
    .leftJoin(users, eq(inventoryLocations.assignedUserId, users.id))
    .where(and(eq(inventoryLocations.id, id), eq(inventoryLocations.companyId, companyId)))
    .limit(1);
  return row ?? null;
}

async function createLocation(
  companyId: string,
  data: InsertInventoryLocation,
): Promise<InventoryLocation> {
  const [row] = await db
    .insert(inventoryLocations)
    .values({ ...data, companyId })
    .returning();
  return row;
}

async function updateLocation(
  companyId: string,
  id: string,
  data: UpdateInventoryLocation,
): Promise<InventoryLocation | null> {
  const [row] = await db
    .update(inventoryLocations)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(inventoryLocations.id, id), eq(inventoryLocations.companyId, companyId)))
    .returning();
  return row ?? null;
}

/** Archive (soft-disable) a location. Sets isActive=false. The row stays
 *  in the table forever so historic transactions keep their location-name
 *  hydration; archived locations are simply hidden from default pickers
 *  and from the active Locations table view. We DELIBERATELY do NOT
 *  hard-delete — inventory_transactions reference the location id and
 *  removing it would erase history. */
async function archiveLocation(
  companyId: string,
  id: string,
): Promise<InventoryLocation | null> {
  return updateLocation(companyId, id, { isActive: false });
}

/** Per-location stock list — flipped version of `listQuantitiesForItem`.
 *  Returns one row per (item, location) pair where location_id matches,
 *  joined with the item's name / sku / model / category for display. */
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
  /** True when available <= minimum_quantity (and minimum is set).
   *  Mirrors the Low Stock list rule so the two surfaces never disagree. */
  isLowStock: boolean;
  updatedAt: Date;
}

async function listInventoryAtLocation(
  companyId: string,
  locationId: string,
): Promise<LocationItemStock[]> {
  const rows = await db
    .select({
      id: inventoryQuantities.id,
      itemId: inventoryQuantities.itemId,
      itemName: items.name,
      itemSku: items.sku,
      itemModel: items.model,
      itemCategory: items.category,
      itemType: items.type,
      itemTrackInventory: items.trackInventory,
      locationId: inventoryQuantities.locationId,
      onHandQuantity: inventoryQuantities.onHandQuantity,
      reservedQuantity: inventoryQuantities.reservedQuantity,
      minimumQuantity: inventoryQuantities.minimumQuantity,
      reorderPoint: inventoryQuantities.reorderPoint,
      updatedAt: inventoryQuantities.updatedAt,
    })
    .from(inventoryQuantities)
    .innerJoin(items, eq(inventoryQuantities.itemId, items.id))
    .where(
      and(
        eq(inventoryQuantities.companyId, companyId),
        eq(inventoryQuantities.locationId, locationId),
      ),
    )
    .orderBy(items.name);

  return rows.map((r) => {
    const availableQuantity = subtractDecimal(r.onHandQuantity, r.reservedQuantity);
    const isLowStock =
      r.minimumQuantity !== null &&
      Number(availableQuantity) <= Number(r.minimumQuantity);
    return { ...r, availableQuantity, isLowStock };
  });
}

/** Phase 6: resolve the inventory_location assigned to a specific user.
 *  Used by the tech AddPart flow to default the consume source so techs
 *  don't have to re-pick their truck for every line item. Returns the
 *  ONE active assignment, or null when the user has none.
 *
 *  Multi-assignment rule: the schema does not enforce uniqueness on
 *  (company_id, assigned_user_id) — a user could in principle be
 *  assigned to multiple locations (vehicle + a backup van). We return
 *  the most-recently-updated active row deterministically; the office
 *  Locations tab is the canonical UI for resolving multi-assignment
 *  drift. */
async function getAssignedLocationForUser(
  companyId: string,
  userId: string,
): Promise<InventoryLocation | null> {
  const [row] = await db
    .select()
    .from(inventoryLocations)
    .where(
      and(
        eq(inventoryLocations.companyId, companyId),
        eq(inventoryLocations.assignedUserId, userId),
        eq(inventoryLocations.isActive, true),
      ),
    )
    .orderBy(desc(inventoryLocations.updatedAt))
    .limit(1);
  return row ?? null;
}

export const inventoryLocationsRepository = {
  list: listLocations,
  listWithAggregates: listLocationsWithAggregates,
  get: getLocation,
  create: createLocation,
  update: updateLocation,
  archive: archiveLocation,
  listInventoryAtLocation,
  getAssignedLocationForUser,
};

// ─── Quantities ────────────────────────────────────────────────────────────

export interface ItemLocationStock {
  id: string;
  itemId: string;
  locationId: string;
  locationName: string;
  locationType: string;
  onHandQuantity: string;
  reservedQuantity: string;
  /** Derived: on_hand - reserved. Never stored. */
  availableQuantity: string;
  minimumQuantity: string | null;
  reorderPoint: string | null;
  updatedAt: Date;
}

/** Read all (location, quantity) rows for one item. Joins location name +
 *  type so the rail Locations tab can render without a follow-up query. */
async function listQuantitiesForItem(
  companyId: string,
  itemId: string,
): Promise<ItemLocationStock[]> {
  const rows = await db
    .select({
      id: inventoryQuantities.id,
      itemId: inventoryQuantities.itemId,
      locationId: inventoryQuantities.locationId,
      locationName: inventoryLocations.name,
      locationType: inventoryLocations.type,
      onHandQuantity: inventoryQuantities.onHandQuantity,
      reservedQuantity: inventoryQuantities.reservedQuantity,
      minimumQuantity: inventoryQuantities.minimumQuantity,
      reorderPoint: inventoryQuantities.reorderPoint,
      updatedAt: inventoryQuantities.updatedAt,
    })
    .from(inventoryQuantities)
    .innerJoin(
      inventoryLocations,
      eq(inventoryQuantities.locationId, inventoryLocations.id),
    )
    .where(
      and(
        eq(inventoryQuantities.companyId, companyId),
        eq(inventoryQuantities.itemId, itemId),
      ),
    )
    .orderBy(inventoryLocations.name);

  return rows.map((r) => ({
    ...r,
    availableQuantity: subtractDecimal(r.onHandQuantity, r.reservedQuantity),
  }));
}

/** Aggregated stock across all locations for a given item. Used to render
 *  the Items table On Hand / Available columns without an N+1. */
export interface ItemStockTotals {
  itemId: string;
  totalOnHand: string;
  totalReserved: string;
  totalAvailable: string;
  locationCount: number;
}

async function aggregateStockByItem(
  companyId: string,
): Promise<Map<string, ItemStockTotals>> {
  const rows = await db
    .select({
      itemId: inventoryQuantities.itemId,
      totalOnHand: sql<string>`COALESCE(SUM(${inventoryQuantities.onHandQuantity}), 0)`,
      totalReserved: sql<string>`COALESCE(SUM(${inventoryQuantities.reservedQuantity}), 0)`,
      locationCount: sql<number>`COUNT(*)::int`,
    })
    .from(inventoryQuantities)
    .where(eq(inventoryQuantities.companyId, companyId))
    .groupBy(inventoryQuantities.itemId);

  const map = new Map<string, ItemStockTotals>();
  for (const r of rows) {
    map.set(r.itemId, {
      itemId: r.itemId,
      totalOnHand: String(r.totalOnHand),
      totalReserved: String(r.totalReserved),
      totalAvailable: subtractDecimal(String(r.totalOnHand), String(r.totalReserved)),
      locationCount: r.locationCount,
    });
  }
  return map;
}

/** Low-stock query: returns (item, location) rows where AVAILABLE
 *  (on_hand − reserved) is at or below the configured minimum_quantity.
 *  Only rows with a minimum_quantity set are evaluated — un-thresholded
 *  rows never trigger a low-stock alert.
 *
 *  Phase 2 (2026-05-08) note: previously this filtered on
 *  `on_hand <= reorder_point`. The brief's operational definition is
 *  "available stock has dropped to or below the floor" — using AVAILABLE
 *  (which already nets out reservations) reflects what's really
 *  fulfillable, not just what's physically on the shelf. The
 *  reorder_point column is still surfaced in the response for display +
 *  for the suggestedReplenishment calculation, but it is no longer the
 *  filter.
 *
 *  suggestedReplenishment = max(0, (reorder_point ?? minimum_quantity) − available)
 *
 *  This is a UX hint, not an order quantity — purchase ordering is a
 *  separate workflow that intentionally hasn't shipped yet.
 */
export interface LowStockRow extends ItemLocationStock {
  itemName: string | null;
  itemSku: string | null;
  /** Replenishment suggestion. Always >= 0. Returned as a string for
   *  numeric-precision parity with the rest of the inventory layer. */
  suggestedReplenishment: string;
}

async function listLowStock(companyId: string): Promise<LowStockRow[]> {
  const rows = await db
    .select({
      id: inventoryQuantities.id,
      itemId: inventoryQuantities.itemId,
      locationId: inventoryQuantities.locationId,
      itemName: items.name,
      itemSku: items.sku,
      locationName: inventoryLocations.name,
      locationType: inventoryLocations.type,
      onHandQuantity: inventoryQuantities.onHandQuantity,
      reservedQuantity: inventoryQuantities.reservedQuantity,
      minimumQuantity: inventoryQuantities.minimumQuantity,
      reorderPoint: inventoryQuantities.reorderPoint,
      updatedAt: inventoryQuantities.updatedAt,
    })
    .from(inventoryQuantities)
    .innerJoin(items, eq(inventoryQuantities.itemId, items.id))
    .innerJoin(inventoryLocations, eq(inventoryQuantities.locationId, inventoryLocations.id))
    .where(
      and(
        eq(inventoryQuantities.companyId, companyId),
        // Threshold gate: only rows with a minimum can flag.
        sql`${inventoryQuantities.minimumQuantity} IS NOT NULL`,
        // Available = on_hand - reserved. Compare against minimum.
        sql`(${inventoryQuantities.onHandQuantity} - ${inventoryQuantities.reservedQuantity}) <= ${inventoryQuantities.minimumQuantity}`,
      ),
    )
    .orderBy(items.name, inventoryLocations.name);

  return rows.map((r) => {
    const availableQuantity = subtractDecimal(r.onHandQuantity, r.reservedQuantity);
    // Suggested replenishment uses reorder_point when set, otherwise
    // minimum_quantity as the target floor. Never negative.
    const target = r.reorderPoint ?? r.minimumQuantity ?? "0";
    const diff = Number(target) - Number(availableQuantity);
    const suggestedReplenishment = diff > 0 ? String(Math.round(diff * 10000) / 10000) : "0";
    return {
      ...r,
      availableQuantity,
      suggestedReplenishment,
    };
  });
}

/** Settings-only update: minimum / reorder threshold for a single
 *  (item, location) pair. The row is created if it doesn't exist (lazy
 *  init). Quantity mutation paths do NOT route through here. */
async function upsertQuantitySettings(
  companyId: string,
  itemId: string,
  locationId: string,
  data: UpdateInventoryQuantitySettings,
): Promise<InventoryQuantity> {
  const existing = await getQuantityRow(companyId, itemId, locationId);
  if (existing) {
    const [row] = await db
      .update(inventoryQuantities)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(inventoryQuantities.id, existing.id))
      .returning();
    return row;
  }
  const [row] = await db
    .insert(inventoryQuantities)
    .values({
      companyId,
      itemId,
      locationId,
      onHandQuantity: "0",
      reservedQuantity: "0",
      minimumQuantity: data.minimumQuantity ?? null,
      reorderPoint: data.reorderPoint ?? null,
    })
    .returning();
  return row;
}

async function getQuantityRow(
  companyId: string,
  itemId: string,
  locationId: string,
): Promise<InventoryQuantity | null> {
  const [row] = await db
    .select()
    .from(inventoryQuantities)
    .where(
      and(
        eq(inventoryQuantities.companyId, companyId),
        eq(inventoryQuantities.itemId, itemId),
        eq(inventoryQuantities.locationId, locationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export const inventoryQuantitiesRepository = {
  listForItem: listQuantitiesForItem,
  listLowStock,
  aggregateByItem: aggregateStockByItem,
  upsertSettings: upsertQuantitySettings,
};

// ─── Transactions (read-only) ──────────────────────────────────────────────

export interface InventoryTransactionRow extends InventoryTransaction {
  fromLocationName: string | null;
  toLocationName: string | null;
}

async function listTransactionsForItem(
  companyId: string,
  itemId: string,
  limit = 50,
): Promise<InventoryTransactionRow[]> {
  // Aliases needed because we join inventory_locations twice (from + to).
  const fromLoc = inventoryLocations;
  // Drizzle doesn't have a clean "alias" helper for the same table on
  // both sides of a join in this codebase; use raw sql for the second
  // side. Simpler approach: do two passes — fetch transactions, then
  // hydrate the location names client-side.
  const txRows = await db
    .select()
    .from(inventoryTransactions)
    .where(
      and(
        eq(inventoryTransactions.companyId, companyId),
        eq(inventoryTransactions.itemId, itemId),
      ),
    )
    .orderBy(desc(inventoryTransactions.createdAt))
    .limit(limit);

  if (txRows.length === 0) return [];

  // Collect location ids to hydrate names in one round-trip.
  const locIds = new Set<string>();
  for (const t of txRows) {
    if (t.fromLocationId) locIds.add(t.fromLocationId);
    if (t.toLocationId) locIds.add(t.toLocationId);
  }
  const locRows = locIds.size
    ? await db
        .select({ id: inventoryLocations.id, name: inventoryLocations.name })
        .from(inventoryLocations)
        .where(
          and(
            eq(inventoryLocations.companyId, companyId),
            sql`${inventoryLocations.id} IN (${sql.join(
              Array.from(locIds).map((id) => sql`${id}`),
              sql`, `,
            )})`,
          ),
        )
    : [];
  const nameById = new Map(locRows.map((r) => [r.id, r.name]));

  return txRows.map((t) => ({
    ...t,
    fromLocationName: t.fromLocationId ? nameById.get(t.fromLocationId) ?? null : null,
    toLocationName: t.toLocationId ? nameById.get(t.toLocationId) ?? null : null,
  }));
}

/** Per-location transaction history. Returns transactions where this
 *  location is EITHER the source OR the destination, joined with the
 *  item name + the OTHER side's location name so the rail can render
 *  "from X" / "to Y" without further hydration. */
export interface LocationTransactionRow extends InventoryTransaction {
  itemName: string | null;
  itemSku: string | null;
  fromLocationName: string | null;
  toLocationName: string | null;
}

async function listTransactionsForLocation(
  companyId: string,
  locationId: string,
  limit = 50,
): Promise<LocationTransactionRow[]> {
  const txRows = await db
    .select({
      id: inventoryTransactions.id,
      companyId: inventoryTransactions.companyId,
      itemId: inventoryTransactions.itemId,
      fromLocationId: inventoryTransactions.fromLocationId,
      toLocationId: inventoryTransactions.toLocationId,
      quantity: inventoryTransactions.quantity,
      transactionType: inventoryTransactions.transactionType,
      referenceType: inventoryTransactions.referenceType,
      referenceId: inventoryTransactions.referenceId,
      unitCost: inventoryTransactions.unitCost,
      notes: inventoryTransactions.notes,
      createdBy: inventoryTransactions.createdBy,
      createdAt: inventoryTransactions.createdAt,
      itemName: items.name,
      itemSku: items.sku,
    })
    .from(inventoryTransactions)
    .leftJoin(items, eq(inventoryTransactions.itemId, items.id))
    .where(
      and(
        eq(inventoryTransactions.companyId, companyId),
        or(
          eq(inventoryTransactions.fromLocationId, locationId),
          eq(inventoryTransactions.toLocationId, locationId),
        ),
      ),
    )
    .orderBy(desc(inventoryTransactions.createdAt))
    .limit(limit);

  if (txRows.length === 0) return [];

  // Hydrate the OTHER-side location names in one round-trip.
  const otherLocIds = new Set<string>();
  for (const t of txRows) {
    if (t.fromLocationId && t.fromLocationId !== locationId) otherLocIds.add(t.fromLocationId);
    if (t.toLocationId && t.toLocationId !== locationId) otherLocIds.add(t.toLocationId);
  }
  const locRows = otherLocIds.size
    ? await db
        .select({ id: inventoryLocations.id, name: inventoryLocations.name })
        .from(inventoryLocations)
        .where(
          and(
            eq(inventoryLocations.companyId, companyId),
            sql`${inventoryLocations.id} IN (${sql.join(
              Array.from(otherLocIds).map((id) => sql`${id}`),
              sql`, `,
            )})`,
          ),
        )
    : [];
  const nameById = new Map(locRows.map((r) => [r.id, r.name]));

  // Resolve "this location" name once for the rows that reference itself.
  const [thisLocRow] = await db
    .select({ name: inventoryLocations.name })
    .from(inventoryLocations)
    .where(
      and(
        eq(inventoryLocations.id, locationId),
        eq(inventoryLocations.companyId, companyId),
      ),
    )
    .limit(1);
  const thisLocName = thisLocRow?.name ?? null;
  const resolveLocName = (id: string | null): string | null => {
    if (!id) return null;
    if (id === locationId) return thisLocName;
    return nameById.get(id) ?? null;
  };

  return txRows.map((t) => ({
    ...t,
    fromLocationName: resolveLocName(t.fromLocationId),
    toLocationName: resolveLocName(t.toLocationId),
  }));
}

export const inventoryTransactionsRepository = {
  listForItem: listTransactionsForItem,
  listForLocation: listTransactionsForLocation,
};

// ─── Service: stock movements (transfer / adjustment) ──────────────────────

/**
 * Perform a stock transfer between two locations. Wraps a single tx that:
 *   1. inserts the inventory_transactions row (transfer)
 *   2. decrements from_location's on_hand
 *   3. increments to_location's on_hand
 *
 * Throws structured errors:
 *   - InventoryError("ITEM_NOT_TRACKED")    item.trackInventory is false
 *   - InventoryError("ITEM_IS_SERVICE")     item.type === 'service'
 *   - InventoryError("INSUFFICIENT_STOCK")  from-location on_hand < quantity
 *   - InventoryError("LOCATION_INACTIVE")   either location is_active = false
 */
export class InventoryError extends Error {
  constructor(public readonly code: InventoryErrorCode, message: string) {
    super(message);
    this.name = "InventoryError";
  }
}
export type InventoryErrorCode =
  | "ITEM_NOT_TRACKED"
  | "ITEM_IS_SERVICE"
  | "INSUFFICIENT_STOCK"
  | "LOCATION_INACTIVE"
  | "SAME_LOCATION_TRANSFER"
  | "ITEM_NOT_FOUND"
  | "LOCATION_NOT_FOUND";

async function performTransfer(
  companyId: string,
  userId: string | null,
  input: TransferInventoryInput,
): Promise<{ transactionId: string }> {
  const qty = String(input.quantity);
  if (input.fromLocationId === input.toLocationId) {
    throw new InventoryError(
      "SAME_LOCATION_TRANSFER",
      "Source and destination locations must differ.",
    );
  }
  return db.transaction(async (tx) => {
    await assertItemTracksInventory(tx, companyId, input.itemId);
    await assertLocationActive(tx, companyId, input.fromLocationId);
    await assertLocationActive(tx, companyId, input.toLocationId);

    // Decrement source — guard against insufficient stock at the SQL
    // level so the transaction rolls back cleanly if the row didn't
    // have enough on hand.
    const fromRow = await ensureQuantityRow(tx, companyId, input.itemId, input.fromLocationId);
    if (Number(fromRow.onHandQuantity) < Number(qty)) {
      throw new InventoryError(
        "INSUFFICIENT_STOCK",
        "Source location does not have enough stock for this transfer.",
      );
    }
    await tx
      .update(inventoryQuantities)
      .set({
        onHandQuantity: sql`${inventoryQuantities.onHandQuantity} - ${qty}`,
        updatedAt: new Date(),
      })
      .where(eq(inventoryQuantities.id, fromRow.id));

    // Increment destination — lazy-create the row if it doesn't exist.
    const toRow = await ensureQuantityRow(tx, companyId, input.itemId, input.toLocationId);
    await tx
      .update(inventoryQuantities)
      .set({
        onHandQuantity: sql`${inventoryQuantities.onHandQuantity} + ${qty}`,
        updatedAt: new Date(),
      })
      .where(eq(inventoryQuantities.id, toRow.id));

    // Audit row
    const [txn] = await tx
      .insert(inventoryTransactions)
      .values({
        companyId,
        itemId: input.itemId,
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        quantity: qty,
        transactionType: "transfer",
        unitCost: input.unitCost ?? null,
        notes: input.notes ?? null,
        createdBy: userId,
      })
      .returning({ id: inventoryTransactions.id });

    return { transactionId: txn.id };
  });
}

async function performAdjustment(
  companyId: string,
  userId: string | null,
  input: AdjustInventoryInput,
): Promise<{ transactionId: string }> {
  const reason = input.reason ?? "adjustment";
  const delta = Number(input.deltaQuantity);
  if (delta === 0) {
    throw new InventoryError(
      "INSUFFICIENT_STOCK",
      "Adjustment delta cannot be zero.",
    );
  }
  return db.transaction(async (tx) => {
    await assertItemTracksInventory(tx, companyId, input.itemId);
    await assertLocationActive(tx, companyId, input.locationId);

    const row = await ensureQuantityRow(tx, companyId, input.itemId, input.locationId);
    const next = Number(row.onHandQuantity) + delta;
    if (next < 0) {
      throw new InventoryError(
        "INSUFFICIENT_STOCK",
        "Adjustment would put on-hand quantity below zero.",
      );
    }
    await tx
      .update(inventoryQuantities)
      .set({
        onHandQuantity: String(next),
        updatedAt: new Date(),
      })
      .where(eq(inventoryQuantities.id, row.id));

    // Direction encoding: positive delta = stock-in (to_location set,
    // from NULL); negative delta = stock-out (from_location set, to
    // NULL). Quantity is always positive.
    const positiveQty = String(Math.abs(delta));
    const fromLocationId = delta < 0 ? input.locationId : null;
    const toLocationId = delta > 0 ? input.locationId : null;

    const [txn] = await tx
      .insert(inventoryTransactions)
      .values({
        companyId,
        itemId: input.itemId,
        fromLocationId,
        toLocationId,
        quantity: positiveQty,
        transactionType: reason,
        unitCost: input.unitCost ?? null,
        notes: input.notes ?? null,
        createdBy: userId,
      })
      .returning({ id: inventoryTransactions.id });

    return { transactionId: txn.id };
  });
}

// ─── Internal helpers ──────────────────────────────────────────────────────

async function assertItemTracksInventory(
  tx: any,
  companyId: string,
  itemId: string,
): Promise<void> {
  const [row] = await tx
    .select({ type: items.type, trackInventory: items.trackInventory })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.companyId, companyId)))
    .limit(1);
  if (!row) {
    throw new InventoryError("ITEM_NOT_FOUND", "Item not found.");
  }
  if (row.type === "service") {
    throw new InventoryError(
      "ITEM_IS_SERVICE",
      "Service items cannot have inventory transactions.",
    );
  }
  if (!row.trackInventory) {
    throw new InventoryError(
      "ITEM_NOT_TRACKED",
      "This item is not tracked as stock. Enable inventory tracking on the item first.",
    );
  }
}

async function assertLocationActive(
  tx: any,
  companyId: string,
  locationId: string,
): Promise<void> {
  const [row] = await tx
    .select({ isActive: inventoryLocations.isActive })
    .from(inventoryLocations)
    .where(and(eq(inventoryLocations.id, locationId), eq(inventoryLocations.companyId, companyId)))
    .limit(1);
  if (!row) {
    throw new InventoryError("LOCATION_NOT_FOUND", "Inventory location not found.");
  }
  if (!row.isActive) {
    throw new InventoryError("LOCATION_INACTIVE", "Inventory location is inactive.");
  }
}

/** Lazy-create the (item, location) quantity row at zero on-hand if it
 *  doesn't exist. Returns the canonical row in either case. */
async function ensureQuantityRow(
  tx: any,
  companyId: string,
  itemId: string,
  locationId: string,
): Promise<InventoryQuantity> {
  const [existing] = await tx
    .select()
    .from(inventoryQuantities)
    .where(
      and(
        eq(inventoryQuantities.companyId, companyId),
        eq(inventoryQuantities.itemId, itemId),
        eq(inventoryQuantities.locationId, locationId),
      ),
    )
    .limit(1);
  if (existing) return existing;
  const [row] = await tx
    .insert(inventoryQuantities)
    .values({
      companyId,
      itemId,
      locationId,
      onHandQuantity: "0",
      reservedQuantity: "0",
    })
    .returning();
  return row;
}

/** Decimal subtraction that preserves up to 4 fractional digits. */
function subtractDecimal(a: string, b: string): string {
  const result = Number(a) - Number(b);
  if (!Number.isFinite(result)) return "0";
  // Round to 4 dp to mirror numeric(14,4) precision.
  return (Math.round(result * 10000) / 10000).toString();
}

// ─── Phase 3: Job inventory consumption + return ───────────────────────────

/**
 * Consume inventory from a location onto a job.
 *
 * Single-tx invariant (same architecture as performTransfer):
 *   1. Validate the item is product + trackInventory.
 *   2. Validate the location is active.
 *   3. Validate sufficient on-hand at the location.
 *   4. Snapshot the item's cost for cost-basis stability.
 *   5. Decrement on_hand_quantity at the source location.
 *   6. Insert the inventory_transactions row (transactionType='job_consumption',
 *      from_location set, reference_type='job', reference_id=jobId).
 *   7. Insert the job_inventory_usage row (kind='consumption', linked
 *      to the audit row via inventory_transaction_id).
 *
 * Throws InventoryError on every safety violation.
 */
async function consumeForJob(
  companyId: string,
  jobId: string,
  userId: string | null,
  input: ConsumeInventoryForJobInput,
): Promise<{ usageId: string; transactionId: string }> {
  const qty = String(input.quantity);
  if (Number(qty) <= 0) {
    throw new InventoryError(
      "INSUFFICIENT_STOCK",
      "Quantity must be greater than zero.",
    );
  }
  return db.transaction(async (tx) => {
    // Validate the job exists + belongs to this tenant. We do this
    // once here rather than in the route because the route already
    // gates on requirePermission + the job route's own role gate is
    // applied by the parent /api/jobs router.
    const [job] = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)))
      .limit(1);
    if (!job) {
      throw new InventoryError("ITEM_NOT_FOUND", "Job not found.");
    }

    // Item validation + cost snapshot.
    const [itemRow] = await tx
      .select({
        type: items.type,
        trackInventory: items.trackInventory,
        cost: items.cost,
      })
      .from(items)
      .where(and(eq(items.id, input.itemId), eq(items.companyId, companyId)))
      .limit(1);
    if (!itemRow) throw new InventoryError("ITEM_NOT_FOUND", "Item not found.");
    if (itemRow.type === "service") {
      throw new InventoryError(
        "ITEM_IS_SERVICE",
        "Service items cannot be consumed onto a job.",
      );
    }
    if (!itemRow.trackInventory) {
      throw new InventoryError(
        "ITEM_NOT_TRACKED",
        "This item is not tracked as stock. Enable inventory tracking on the item first.",
      );
    }
    const unitCostSnapshot = itemRow.cost ?? "0";

    // Location must be active.
    await assertLocationActive(tx, companyId, input.locationId);

    // Phase 4: optional line linkage. The line MUST belong to the
    // same (company, job) — if it doesn't, treat the request as a
    // tampering attempt and refuse the consumption rather than
    // silently ignoring the linkage. Line tables remain untouched —
    // the linkage is one-directional from consumption → line.
    if (input.lineItemId) {
      const [line] = await tx
        .select({ id: jobParts.id, jobId: jobParts.jobId })
        .from(jobParts)
        .where(
          and(
            eq(jobParts.id, input.lineItemId),
            eq(jobParts.jobId, jobId),
            eq(jobParts.companyId, companyId),
          ),
        )
        .limit(1);
      if (!line) {
        throw new InventoryError(
          "ITEM_NOT_FOUND",
          "Linked line item does not belong to this job.",
        );
      }
    }

    // Decrement source on-hand.
    const fromRow = await ensureQuantityRow(tx, companyId, input.itemId, input.locationId);
    if (Number(fromRow.onHandQuantity) < Number(qty)) {
      throw new InventoryError(
        "INSUFFICIENT_STOCK",
        "Source location does not have enough stock to consume this quantity.",
      );
    }
    await tx
      .update(inventoryQuantities)
      .set({
        onHandQuantity: sql`${inventoryQuantities.onHandQuantity} - ${qty}`,
        updatedAt: new Date(),
      })
      .where(eq(inventoryQuantities.id, fromRow.id));

    // Phase 5: consume-against-active-reservation hop. If there is at
    // least one matching active reservation for this (company, job,
    // item, location), pull from those FIRST before letting the
    // consumption count as fresh on-hand draw. This:
    //   - Decrements inventory_quantities.reserved_quantity by the
    //     consumed-from-reservation amount (since that quantity was
    //     formerly counted in the reserved bucket, the on-hand-only
    //     decrement above would otherwise underflow available unless
    //     we also free the reservation).
    //   - Increments each reservation's consumed_quantity counter and
    //     transitions to status='consumed' when fully consumed.
    //   - Spreads the consumption across multiple matching active
    //     reservations FIFO (oldest first) when more than one exists.
    //   - Leaves the reservation alone (no-op) when no matching
    //     active reservation exists — the legacy "consume from raw
    //     on-hand" path still works for tenants that never adopted
    //     the reservation flow.
    let remainingToApply = Number(qty);
    if (jobId) {
      const matching = await tx
        .select({
          id: inventoryReservations.id,
          quantity: inventoryReservations.quantity,
          consumedQuantity: inventoryReservations.consumedQuantity,
        })
        .from(inventoryReservations)
        .where(
          and(
            eq(inventoryReservations.companyId, companyId),
            eq(inventoryReservations.jobId, jobId),
            eq(inventoryReservations.itemId, input.itemId),
            eq(inventoryReservations.locationId, input.locationId),
            eq(inventoryReservations.status, "active"),
          ),
        )
        .orderBy(inventoryReservations.createdAt);

      let releasedTotalFromReservations = 0;
      for (const r of matching) {
        if (remainingToApply <= 0) break;
        const open = Number(r.quantity) - Number(r.consumedQuantity);
        if (open <= 0) continue;
        const take = Math.min(open, remainingToApply);
        const nextConsumed = Number(r.consumedQuantity) + take;
        const nowFull = Math.abs(nextConsumed - Number(r.quantity)) < 1e-9;
        await tx
          .update(inventoryReservations)
          .set({
            consumedQuantity: String(Math.round(nextConsumed * 10000) / 10000),
            status: nowFull ? "consumed" : "active",
            updatedAt: new Date(),
          })
          .where(eq(inventoryReservations.id, r.id));
        releasedTotalFromReservations += take;
        remainingToApply -= take;
      }

      if (releasedTotalFromReservations > 0) {
        const releasedStr = String(
          Math.round(releasedTotalFromReservations * 10000) / 10000,
        );
        await tx
          .update(inventoryQuantities)
          .set({
            reservedQuantity: sql`${inventoryQuantities.reservedQuantity} - ${releasedStr}`,
            updatedAt: new Date(),
          })
          .where(eq(inventoryQuantities.id, fromRow.id));
      }
    }

    // Audit row.
    const [txn] = await tx
      .insert(inventoryTransactions)
      .values({
        companyId,
        itemId: input.itemId,
        fromLocationId: input.locationId,
        toLocationId: null,
        quantity: qty,
        transactionType: "job_consumption",
        referenceType: "job",
        referenceId: jobId,
        unitCost: unitCostSnapshot,
        notes: input.notes ?? null,
        createdBy: userId,
      })
      .returning({ id: inventoryTransactions.id });

    // Intent row.
    const [usage] = await tx
      .insert(jobInventoryUsage)
      .values({
        companyId,
        jobId,
        itemId: input.itemId,
        locationId: input.locationId,
        kind: "consumption",
        parentUsageId: null,
        quantity: qty,
        unitCostSnapshot,
        consumedByUserId: userId,
        notes: input.notes ?? null,
        inventoryTransactionId: txn.id,
        // Phase 4: persist the optional linkage. Returns inherit
        // their parent's lineItemId via the parent row — they don't
        // duplicate the FK because the parent already carries it.
        lineItemId: input.lineItemId ?? null,
      })
      .returning({ id: jobInventoryUsage.id });

    return { usageId: usage.id, transactionId: txn.id };
  });
}

/**
 * Return part (or all) of a previously-consumed quantity back to its
 * source location. Returns ALWAYS attach to a parent consumption row
 * (the unit_cost_snapshot + destination location come from the parent).
 *
 * Single-tx invariant. Validates that the requested quantity fits
 * within the parent's remaining returnable capacity (parent.quantity
 * minus existing returns).
 */
async function returnFromJob(
  companyId: string,
  jobId: string,
  userId: string | null,
  input: ReturnInventoryFromJobInput,
): Promise<{ usageId: string; transactionId: string }> {
  const qty = String(input.quantity);
  if (Number(qty) <= 0) {
    throw new InventoryError(
      "INSUFFICIENT_STOCK",
      "Return quantity must be greater than zero.",
    );
  }
  return db.transaction(async (tx) => {
    // Fetch the parent consumption row, scoped to (company, job).
    const [parent] = await tx
      .select()
      .from(jobInventoryUsage)
      .where(
        and(
          eq(jobInventoryUsage.companyId, companyId),
          eq(jobInventoryUsage.id, input.usageId),
          eq(jobInventoryUsage.jobId, jobId),
          eq(jobInventoryUsage.kind, "consumption"),
          isNull(jobInventoryUsage.deletedAt),
        ),
      )
      .limit(1);
    if (!parent) {
      throw new InventoryError(
        "ITEM_NOT_FOUND",
        "Original consumption row not found for this job.",
      );
    }

    // Returnable = parent.quantity - SUM(existing returns).
    const [existing] = await tx
      .select({
        total: sql<string>`COALESCE(SUM(${jobInventoryUsage.quantity}), 0)`,
      })
      .from(jobInventoryUsage)
      .where(
        and(
          eq(jobInventoryUsage.companyId, companyId),
          eq(jobInventoryUsage.parentUsageId, parent.id),
          eq(jobInventoryUsage.kind, "return"),
          isNull(jobInventoryUsage.deletedAt),
        ),
      );
    const returnable = Number(parent.quantity) - Number(existing?.total ?? 0);
    if (Number(qty) > returnable) {
      throw new InventoryError(
        "INSUFFICIENT_STOCK",
        `Cannot return more than ${returnable} — that's the remaining un-returned quantity from the original consumption.`,
      );
    }

    // Destination = parent's source location. Re-confirm it's still
    // active; if archived, the route handler can choose to allow it
    // (returning to an archived location is a corrective action and
    // should not silently fail) — for v1 we DO allow returns to
    // archived locations because the row history is what matters.
    const destLocId = parent.locationId;

    // Increment destination on-hand.
    const toRow = await ensureQuantityRow(tx, companyId, parent.itemId, destLocId);
    await tx
      .update(inventoryQuantities)
      .set({
        onHandQuantity: sql`${inventoryQuantities.onHandQuantity} + ${qty}`,
        updatedAt: new Date(),
      })
      .where(eq(inventoryQuantities.id, toRow.id));

    // Audit row.
    const [txn] = await tx
      .insert(inventoryTransactions)
      .values({
        companyId,
        itemId: parent.itemId,
        fromLocationId: null,
        toLocationId: destLocId,
        quantity: qty,
        transactionType: "job_return",
        referenceType: "job",
        referenceId: jobId,
        // Cost snapshot rides the parent's snapshot — returning at a
        // different cost basis would silently change the job's net
        // cost in surprising ways.
        unitCost: parent.unitCostSnapshot,
        notes: input.notes ?? null,
        createdBy: userId,
      })
      .returning({ id: inventoryTransactions.id });

    // Intent row.
    const [usage] = await tx
      .insert(jobInventoryUsage)
      .values({
        companyId,
        jobId,
        itemId: parent.itemId,
        locationId: destLocId,
        kind: "return",
        parentUsageId: parent.id,
        quantity: qty,
        unitCostSnapshot: parent.unitCostSnapshot,
        consumedByUserId: userId,
        notes: input.notes ?? null,
        inventoryTransactionId: txn.id,
      })
      .returning({ id: jobInventoryUsage.id });

    return { usageId: usage.id, transactionId: txn.id };
  });
}

/**
 * Remove a usage row when safe.
 *
 * Safety contract:
 *   - The row must be a consumption (returns are never directly
 *     removed; correct them with another return-of-the-return is
 *     out of scope and would be a follow-up ERP feature).
 *   - The row must have NO downstream return rows referencing it.
 *     If returns exist, the user must undo them first via a
 *     corrective adjustment / consumption — the rail simply hides
 *     the Remove action when the row is not removable.
 *
 * Side-effect: writes a reversing inventory_transactions row
 * (transactionType='job_return') so the audit log keeps a complete
 * trail. The job_inventory_usage row is soft-deleted (deletedAt set);
 * we never hard-delete because the audit row references its id via
 * inventory_transaction_id.
 */
async function removeUsage(
  companyId: string,
  jobId: string,
  userId: string | null,
  usageId: string,
): Promise<{ transactionId: string }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(jobInventoryUsage)
      .where(
        and(
          eq(jobInventoryUsage.companyId, companyId),
          eq(jobInventoryUsage.id, usageId),
          eq(jobInventoryUsage.jobId, jobId),
          isNull(jobInventoryUsage.deletedAt),
        ),
      )
      .limit(1);
    if (!row) {
      throw new InventoryError("ITEM_NOT_FOUND", "Usage row not found.");
    }
    if (row.kind !== "consumption") {
      throw new InventoryError(
        "INSUFFICIENT_STOCK",
        "Only consumption rows can be removed. To undo a return, file a new consumption.",
      );
    }
    // Block removal when downstream returns reference it.
    const [childCountRow] = await tx
      .select({
        n: sql<number>`COUNT(*)::int`,
      })
      .from(jobInventoryUsage)
      .where(
        and(
          eq(jobInventoryUsage.companyId, companyId),
          eq(jobInventoryUsage.parentUsageId, row.id),
          isNull(jobInventoryUsage.deletedAt),
        ),
      );
    if ((childCountRow?.n ?? 0) > 0) {
      throw new InventoryError(
        "INSUFFICIENT_STOCK",
        "This usage already has returns recorded against it. Remove the returns first.",
      );
    }

    // Restore stock.
    const toRow = await ensureQuantityRow(tx, companyId, row.itemId, row.locationId);
    await tx
      .update(inventoryQuantities)
      .set({
        onHandQuantity: sql`${inventoryQuantities.onHandQuantity} + ${row.quantity}`,
        updatedAt: new Date(),
      })
      .where(eq(inventoryQuantities.id, toRow.id));

    // Reversing audit row.
    const [txn] = await tx
      .insert(inventoryTransactions)
      .values({
        companyId,
        itemId: row.itemId,
        fromLocationId: null,
        toLocationId: row.locationId,
        quantity: row.quantity,
        transactionType: "job_return",
        referenceType: "job",
        referenceId: jobId,
        unitCost: row.unitCostSnapshot,
        notes: "Usage removed.",
        createdBy: userId,
      })
      .returning({ id: inventoryTransactions.id });

    // Soft-delete the usage row.
    await tx
      .update(jobInventoryUsage)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(jobInventoryUsage.id, row.id));

    return { transactionId: txn.id };
  });
}

// ─── Phase 5: Reservations (reserve / release / cancel) ────────────────
//
// Single-tx invariant carried forward: every reserved_quantity mutation
// is paired with an INSERT or UPDATE on inventory_reservations inside
// the same Drizzle tx. Reservations are their own audit log — we do
// NOT write inventory_transactions rows for reserve/release/cancel
// because no quantity moves physically (only the on_hand vs reserved
// split shifts).
//
// Available-stock guard. A new reservation must fit inside CURRENT
// availability (on_hand − reserved), not just on_hand. Otherwise
// stacking reservations would silently push availability negative.

async function reserveInventory(
  companyId: string,
  userId: string | null,
  input: ReserveInventoryInput,
): Promise<{ reservationId: string }> {
  const qty = String(input.quantity);
  if (Number(qty) <= 0) {
    throw new InventoryError(
      "INSUFFICIENT_STOCK",
      "Reservation quantity must be greater than zero.",
    );
  }
  return db.transaction(async (tx) => {
    await assertItemTracksInventory(tx, companyId, input.itemId);
    await assertLocationActive(tx, companyId, input.locationId);

    // Optional job linkage — same tampering check as consumeForJob.
    if (input.jobId) {
      const [job] = await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(eq(jobs.id, input.jobId), eq(jobs.companyId, companyId)))
        .limit(1);
      if (!job) {
        throw new InventoryError("ITEM_NOT_FOUND", "Job not found.");
      }
    }
    // Optional line linkage — must belong to the same (company, job).
    if (input.lineItemId) {
      if (!input.jobId) {
        throw new InventoryError(
          "ITEM_NOT_FOUND",
          "Reservation linked to a line item must also include the job id.",
        );
      }
      const [line] = await tx
        .select({ id: jobParts.id })
        .from(jobParts)
        .where(
          and(
            eq(jobParts.id, input.lineItemId),
            eq(jobParts.jobId, input.jobId),
            eq(jobParts.companyId, companyId),
          ),
        )
        .limit(1);
      if (!line) {
        throw new InventoryError(
          "ITEM_NOT_FOUND",
          "Linked line item does not belong to this job.",
        );
      }
    }

    // Available-stock guard. A reservation must fit inside (on_hand −
    // reserved). Stacking reservations beyond availability would push
    // available negative, so we refuse the request rather than
    // silently allow over-allocation.
    const qtyRow = await ensureQuantityRow(tx, companyId, input.itemId, input.locationId);
    const available =
      Number(qtyRow.onHandQuantity) - Number(qtyRow.reservedQuantity);
    if (available < Number(qty)) {
      throw new InventoryError(
        "INSUFFICIENT_STOCK",
        `Cannot reserve ${qty} — only ${available > 0 ? available : 0} available at this location after existing reservations.`,
      );
    }

    // Bump reserved_quantity on the (item, location) row.
    await tx
      .update(inventoryQuantities)
      .set({
        reservedQuantity: sql`${inventoryQuantities.reservedQuantity} + ${qty}`,
        updatedAt: new Date(),
      })
      .where(eq(inventoryQuantities.id, qtyRow.id));

    // Insert the reservation row (the audit log).
    const [row] = await tx
      .insert(inventoryReservations)
      .values({
        companyId,
        itemId: input.itemId,
        locationId: input.locationId,
        jobId: input.jobId ?? null,
        visitId: input.visitId ?? null,
        lineItemId: input.lineItemId ?? null,
        quantity: qty,
        consumedQuantity: "0",
        status: "active",
        reservedByUserId: userId,
        notes: input.notes ?? null,
      })
      .returning({ id: inventoryReservations.id });

    return { reservationId: row.id };
  });
}

/** Release frees the un-consumed remainder back to availability. The
 *  consumed portion is permanent (it already became real stock movement
 *  via consumeForJob). Released rows stay in the table for audit.
 *
 *  Status guard: only `active` reservations can be released. Re-releasing
 *  a `released`/`canceled`/`consumed` row is a no-op-error to preserve
 *  the audit trail's integrity. */
async function releaseReservation(
  companyId: string,
  userId: string | null,
  reservationId: string,
): Promise<{ reservationId: string; releasedQuantity: string }> {
  return releaseOrCancel(companyId, userId, reservationId, "released");
}

async function cancelReservation(
  companyId: string,
  userId: string | null,
  reservationId: string,
): Promise<{ reservationId: string; releasedQuantity: string }> {
  return releaseOrCancel(companyId, userId, reservationId, "canceled");
}

/** Internal: shared release / cancel path. Both flows do exactly the
 *  same work — free the un-consumed remainder back to availability and
 *  flip status — so they share the implementation. The only difference
 *  is the terminal status string we write. */
async function releaseOrCancel(
  companyId: string,
  userId: string | null,
  reservationId: string,
  terminalStatus: "released" | "canceled",
): Promise<{ reservationId: string; releasedQuantity: string }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(inventoryReservations)
      .where(
        and(
          eq(inventoryReservations.companyId, companyId),
          eq(inventoryReservations.id, reservationId),
        ),
      )
      .limit(1);
    if (!row) {
      throw new InventoryError("ITEM_NOT_FOUND", "Reservation not found.");
    }
    if (row.status !== "active") {
      throw new InventoryError(
        "INSUFFICIENT_STOCK",
        `Reservation is already ${row.status}; nothing to release.`,
      );
    }

    const remaining =
      Number(row.quantity) - Number(row.consumedQuantity);
    const remainingStr = String(Math.round(remaining * 10000) / 10000);

    if (remaining > 0) {
      // Decrement reserved_quantity on the (item, location) row by the
      // un-consumed remainder. The (item, location) row MUST exist
      // because the reservation row's existence implies it was
      // created/updated when the reservation was made.
      const qtyRow = await ensureQuantityRow(
        tx,
        companyId,
        row.itemId,
        row.locationId,
      );
      await tx
        .update(inventoryQuantities)
        .set({
          reservedQuantity: sql`${inventoryQuantities.reservedQuantity} - ${remainingStr}`,
          updatedAt: new Date(),
        })
        .where(eq(inventoryQuantities.id, qtyRow.id));
    }

    // Flip the status + stamp released_at. We never null reservedByUserId
    // — the audit row records who made it; the actor doing the release
    // is implicit in the API call (and surfaceable via audit log if/
    // when we wire one).
    await tx
      .update(inventoryReservations)
      .set({
        status: terminalStatus,
        releasedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(inventoryReservations.id, reservationId));

    return { reservationId, releasedQuantity: remainingStr };
  });
}

export const inventoryService = {
  performTransfer,
  performAdjustment,
  consumeForJob,
  returnFromJob,
  removeUsage,
  reserveInventory,
  releaseReservation,
  cancelReservation,
};
