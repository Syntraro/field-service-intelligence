/**
 * Inventory reservations storage layer (2026-05-08 — Inventory Phase 5).
 *
 * Read repository for the inventory_reservations table. The MUTATION
 * paths (reserveInventory / releaseReservation / cancelReservation +
 * the consume-against-active-reservation hop inside consumeForJob) live
 * on inventoryService in `./inventory.ts` because every reservation
 * mutation is paired with an inventory_quantities.reserved_quantity
 * update inside the same Drizzle transaction (Phase 1 invariant carried
 * forward).
 *
 * Reservation accounting model (recap from migration header):
 *   - Reservations are their OWN audit log. We do NOT write
 *     inventory_transactions rows for reserve/release/cancel because
 *     no quantity moves physically — only the (on_hand vs reserved)
 *     split shifts.
 *   - Two-counter row: `quantity` (immutable) + `consumed_quantity`
 *     (running). Remaining un-consumed = quantity − consumed_quantity.
 *   - Status transitions: active → consumed (when consumed_quantity
 *     hits quantity), active → released (manual, frees the unconsumed
 *     remainder back to availability), active → canceled (admin undo,
 *     also frees remainder).
 *   - Active reads filter on status='active'; historic rows stay in
 *     the table forever for audit.
 */

import { db } from "../db";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  inventoryReservations,
  inventoryLocations,
  items,
  jobs,
  users,
  type InventoryReservation,
} from "@shared/schema";

// ─── Wire shapes ────────────────────────────────────────────────────────

/** Reservation row joined with display fields for the rails + the
 *  job-detail Reservations section. */
export interface InventoryReservationRow {
  id: string;
  companyId: string;
  itemId: string;
  itemName: string | null;
  itemSku: string | null;
  itemModel: string | null;
  locationId: string;
  locationName: string;
  jobId: string | null;
  jobName: string | null;
  visitId: string | null;
  lineItemId: string | null;
  quantity: string;
  consumedQuantity: string;
  /** Derived: quantity − consumedQuantity. Always >= 0 by table CHECK. */
  remainingQuantity: string;
  status: "active" | "consumed" | "released" | "canceled";
  reservedByUserId: string | null;
  reservedByUserName: string | null;
  notes: string | null;
  releasedAt: Date | null;
  createdAt: Date;
  updatedAt: Date | null;
}

/** Aggregate "currently reserved" totals per (item) across all locations.
 *  Used by the item rail's Reservations sub-strip header + the picker
 *  "fully reserved" chip rule (totalAvailable === 0 && totalReserved > 0). */
export interface ItemReservationAggregate {
  itemId: string;
  activeReservationCount: number;
  totalActiveQuantity: string;
}

// ─── Hydration helpers ──────────────────────────────────────────────────

/** Single SELECT shape used by every list method below. Joins are kept
 *  identical so the result mapper can stay one function. */
function buildSelectShape() {
  return {
    id: inventoryReservations.id,
    companyId: inventoryReservations.companyId,
    itemId: inventoryReservations.itemId,
    itemName: items.name,
    itemSku: items.sku,
    itemModel: items.model,
    locationId: inventoryReservations.locationId,
    locationName: inventoryLocations.name,
    jobId: inventoryReservations.jobId,
    jobName: jobs.summary,
    visitId: inventoryReservations.visitId,
    lineItemId: inventoryReservations.lineItemId,
    quantity: inventoryReservations.quantity,
    consumedQuantity: inventoryReservations.consumedQuantity,
    status: inventoryReservations.status,
    reservedByUserId: inventoryReservations.reservedByUserId,
    reservedByUserName: sql<string | null>`COALESCE(${users.firstName} || ' ' || ${users.lastName}, ${users.email})`,
    notes: inventoryReservations.notes,
    releasedAt: inventoryReservations.releasedAt,
    createdAt: inventoryReservations.createdAt,
    updatedAt: inventoryReservations.updatedAt,
  } as const;
}

function mapRow(r: any): InventoryReservationRow {
  const remaining = Math.max(
    0,
    Math.round((Number(r.quantity) - Number(r.consumedQuantity)) * 10000) / 10000,
  );
  return {
    ...r,
    locationName: r.locationName ?? "—",
    status: r.status as InventoryReservationRow["status"],
    remainingQuantity: String(remaining),
  };
}

// ─── Reads ──────────────────────────────────────────────────────────────

async function listForJob(
  companyId: string,
  jobId: string,
  options: { activeOnly?: boolean } = {},
): Promise<InventoryReservationRow[]> {
  const activeOnly = options.activeOnly ?? true;
  const whereClause = activeOnly
    ? and(
        eq(inventoryReservations.companyId, companyId),
        eq(inventoryReservations.jobId, jobId),
        eq(inventoryReservations.status, "active"),
      )
    : and(
        eq(inventoryReservations.companyId, companyId),
        eq(inventoryReservations.jobId, jobId),
      );
  const rows = await db
    .select(buildSelectShape())
    .from(inventoryReservations)
    .leftJoin(items, eq(inventoryReservations.itemId, items.id))
    .leftJoin(inventoryLocations, eq(inventoryReservations.locationId, inventoryLocations.id))
    .leftJoin(jobs, eq(inventoryReservations.jobId, jobs.id))
    .leftJoin(users, eq(inventoryReservations.reservedByUserId, users.id))
    .where(whereClause)
    .orderBy(desc(inventoryReservations.createdAt));
  return rows.map(mapRow);
}

async function listRecentForItem(
  companyId: string,
  itemId: string,
  limit = 10,
): Promise<InventoryReservationRow[]> {
  const rows = await db
    .select(buildSelectShape())
    .from(inventoryReservations)
    .leftJoin(items, eq(inventoryReservations.itemId, items.id))
    .leftJoin(inventoryLocations, eq(inventoryReservations.locationId, inventoryLocations.id))
    .leftJoin(jobs, eq(inventoryReservations.jobId, jobs.id))
    .leftJoin(users, eq(inventoryReservations.reservedByUserId, users.id))
    .where(
      and(
        eq(inventoryReservations.companyId, companyId),
        eq(inventoryReservations.itemId, itemId),
      ),
    )
    .orderBy(desc(inventoryReservations.createdAt))
    .limit(limit);
  return rows.map(mapRow);
}

async function listRecentForLocation(
  companyId: string,
  locationId: string,
  limit = 10,
): Promise<InventoryReservationRow[]> {
  const rows = await db
    .select(buildSelectShape())
    .from(inventoryReservations)
    .leftJoin(items, eq(inventoryReservations.itemId, items.id))
    .leftJoin(inventoryLocations, eq(inventoryReservations.locationId, inventoryLocations.id))
    .leftJoin(jobs, eq(inventoryReservations.jobId, jobs.id))
    .leftJoin(users, eq(inventoryReservations.reservedByUserId, users.id))
    .where(
      and(
        eq(inventoryReservations.companyId, companyId),
        eq(inventoryReservations.locationId, locationId),
      ),
    )
    .orderBy(desc(inventoryReservations.createdAt))
    .limit(limit);
  return rows.map(mapRow);
}

async function getById(
  companyId: string,
  id: string,
): Promise<InventoryReservation | null> {
  const [row] = await db
    .select()
    .from(inventoryReservations)
    .where(
      and(
        eq(inventoryReservations.companyId, companyId),
        eq(inventoryReservations.id, id),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Aggregate "currently reserved" totals per item across all locations.
 *  Returned as a Map for O(1) hydration onto item rows by callers that
 *  list many items at once (parallel to inventoryQuantitiesRepository
 *  .aggregateByItem). Only active rows count toward the aggregate. */
async function aggregateActiveByItem(
  companyId: string,
): Promise<Map<string, ItemReservationAggregate>> {
  const rows = await db
    .select({
      itemId: inventoryReservations.itemId,
      count: sql<number>`COUNT(*)::int`,
      total: sql<string>`COALESCE(SUM(${inventoryReservations.quantity} - ${inventoryReservations.consumedQuantity}), 0)`,
    })
    .from(inventoryReservations)
    .where(
      and(
        eq(inventoryReservations.companyId, companyId),
        eq(inventoryReservations.status, "active"),
      ),
    )
    .groupBy(inventoryReservations.itemId);

  const map = new Map<string, ItemReservationAggregate>();
  for (const r of rows) {
    map.set(r.itemId, {
      itemId: r.itemId,
      activeReservationCount: r.count,
      totalActiveQuantity: String(r.total),
    });
  }
  return map;
}

export const inventoryReservationsRepository = {
  listForJob,
  listRecentForItem,
  listRecentForLocation,
  getById,
  aggregateActiveByItem,
};
