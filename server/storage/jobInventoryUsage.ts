/**
 * Job inventory usage storage layer (2026-05-08 — Inventory Phase 3).
 *
 * Two-row return model. Every row carries a positive quantity; `kind`
 * drives accounting direction (consumption | return). Returns reference
 * their parent consumption row via parent_usage_id.
 *
 * The mutation paths (consumeForJob / returnFromJob) are part of the
 * canonical inventoryService — this file is the read layer + the
 * helper used by the inventoryService to write the usage row inside
 * the same Drizzle tx as the inventory_transactions row + the
 * inventory_quantities update.
 */

import { db } from "../db";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import {
  jobInventoryUsage,
  inventoryLocations,
  items,
  users,
  type JobInventoryUsage,
} from "@shared/schema";

// ─── Read shapes ────────────────────────────────────────────────────

/** Per-job usage row, joined with display fields the Job Detail
 *  Inventory Usage section needs without an N+1 round-trip. */
export interface JobInventoryUsageRow {
  id: string;
  jobId: string;
  itemId: string;
  itemName: string | null;
  itemSku: string | null;
  itemModel: string | null;
  locationId: string;
  locationName: string;
  kind: "consumption" | "return";
  parentUsageId: string | null;
  quantity: string;
  unitCostSnapshot: string;
  /** Derived: signed quantity (consumption=positive, return=negative)
   *  multiplied by snapshot cost. The job's net inventory cost is
   *  SUM(lineCost) across rows. */
  lineCost: string;
  consumedByUserId: string | null;
  consumedByUserName: string | null;
  notes: string | null;
  inventoryTransactionId: string | null;
  createdAt: Date;
  /** True when this consumption row is safe to remove. False when at
   *  least one child return row references it (we never erase a row
   *  with downstream references — instead the user undoes the returns
   *  first or just files a corrective transaction). */
  removable: boolean;
}

/** Per-job aggregate. Returned alongside the rows so the section
 *  header can display "Net inventory cost: $X" without recomputing on
 *  the client. */
export interface JobInventoryUsageSummary {
  totalConsumptionQuantity: string;
  totalReturnQuantity: string;
  totalNetQuantity: string;
  netCost: string;
}

// ─── List per job (consumption + returns interleaved) ───────────────

async function listForJob(
  companyId: string,
  jobId: string,
): Promise<{ rows: JobInventoryUsageRow[]; summary: JobInventoryUsageSummary }> {
  const usageRows = await db
    .select({
      id: jobInventoryUsage.id,
      jobId: jobInventoryUsage.jobId,
      itemId: jobInventoryUsage.itemId,
      itemName: items.name,
      itemSku: items.sku,
      itemModel: items.model,
      locationId: jobInventoryUsage.locationId,
      locationName: inventoryLocations.name,
      kind: jobInventoryUsage.kind,
      parentUsageId: jobInventoryUsage.parentUsageId,
      quantity: jobInventoryUsage.quantity,
      unitCostSnapshot: jobInventoryUsage.unitCostSnapshot,
      consumedByUserId: jobInventoryUsage.consumedByUserId,
      consumedByUserName: sql<string | null>`COALESCE(${users.firstName} || ' ' || ${users.lastName}, ${users.email})`,
      notes: jobInventoryUsage.notes,
      inventoryTransactionId: jobInventoryUsage.inventoryTransactionId,
      createdAt: jobInventoryUsage.createdAt,
    })
    .from(jobInventoryUsage)
    .leftJoin(items, eq(jobInventoryUsage.itemId, items.id))
    .leftJoin(inventoryLocations, eq(jobInventoryUsage.locationId, inventoryLocations.id))
    .leftJoin(users, eq(jobInventoryUsage.consumedByUserId, users.id))
    .where(
      and(
        eq(jobInventoryUsage.companyId, companyId),
        eq(jobInventoryUsage.jobId, jobId),
        isNull(jobInventoryUsage.deletedAt),
      ),
    )
    .orderBy(asc(jobInventoryUsage.createdAt));

  // Compute removable flag for each row by counting downstream return
  // children. A consumption row is removable when no return row points
  // at it; return rows are removable individually (they undo
  // themselves).
  const childCount = new Map<string, number>();
  for (const r of usageRows) {
    if (r.kind === "return" && r.parentUsageId) {
      childCount.set(r.parentUsageId, (childCount.get(r.parentUsageId) ?? 0) + 1);
    }
  }

  const rows: JobInventoryUsageRow[] = usageRows.map((r) => {
    const sign = r.kind === "consumption" ? 1 : -1;
    const lineCost = String(
      Math.round(sign * Number(r.quantity) * Number(r.unitCostSnapshot) * 100) / 100,
    );
    const removable =
      r.kind === "return"
        ? true
        : (childCount.get(r.id) ?? 0) === 0;
    return {
      ...r,
      kind: r.kind as "consumption" | "return",
      locationName: r.locationName ?? "—",
      lineCost,
      removable,
    };
  });

  // Summary aggregates.
  let consumeQty = 0;
  let returnQty = 0;
  let net = 0;
  for (const r of rows) {
    const q = Number(r.quantity);
    const cost = Number(r.unitCostSnapshot);
    if (r.kind === "consumption") {
      consumeQty += q;
      net += q * cost;
    } else {
      returnQty += q;
      net -= q * cost;
    }
  }
  const summary: JobInventoryUsageSummary = {
    totalConsumptionQuantity: String(roundQty(consumeQty)),
    totalReturnQuantity: String(roundQty(returnQty)),
    totalNetQuantity: String(roundQty(consumeQty - returnQty)),
    netCost: (Math.round(net * 100) / 100).toFixed(2),
  };

  return { rows, summary };
}

function roundQty(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ─── Recent-usage reads for the rails ────────────────────────────────

export interface RecentUsageRow {
  id: string;
  jobId: string;
  itemId: string;
  locationId: string;
  locationName: string;
  kind: "consumption" | "return";
  quantity: string;
  createdAt: Date;
  consumedByUserName: string | null;
}

async function listRecentForItem(
  companyId: string,
  itemId: string,
  limit = 10,
): Promise<RecentUsageRow[]> {
  const rows = await db
    .select({
      id: jobInventoryUsage.id,
      jobId: jobInventoryUsage.jobId,
      itemId: jobInventoryUsage.itemId,
      locationId: jobInventoryUsage.locationId,
      locationName: inventoryLocations.name,
      kind: jobInventoryUsage.kind,
      quantity: jobInventoryUsage.quantity,
      createdAt: jobInventoryUsage.createdAt,
      consumedByUserName: sql<string | null>`COALESCE(${users.firstName} || ' ' || ${users.lastName}, ${users.email})`,
    })
    .from(jobInventoryUsage)
    .leftJoin(inventoryLocations, eq(jobInventoryUsage.locationId, inventoryLocations.id))
    .leftJoin(users, eq(jobInventoryUsage.consumedByUserId, users.id))
    .where(
      and(
        eq(jobInventoryUsage.companyId, companyId),
        eq(jobInventoryUsage.itemId, itemId),
        isNull(jobInventoryUsage.deletedAt),
      ),
    )
    .orderBy(desc(jobInventoryUsage.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    ...r,
    kind: r.kind as "consumption" | "return",
    locationName: r.locationName ?? "—",
  }));
}

async function listRecentForLocation(
  companyId: string,
  locationId: string,
  limit = 10,
): Promise<RecentUsageRow[]> {
  const rows = await db
    .select({
      id: jobInventoryUsage.id,
      jobId: jobInventoryUsage.jobId,
      itemId: jobInventoryUsage.itemId,
      locationId: jobInventoryUsage.locationId,
      locationName: inventoryLocations.name,
      kind: jobInventoryUsage.kind,
      quantity: jobInventoryUsage.quantity,
      createdAt: jobInventoryUsage.createdAt,
      consumedByUserName: sql<string | null>`COALESCE(${users.firstName} || ' ' || ${users.lastName}, ${users.email})`,
    })
    .from(jobInventoryUsage)
    .leftJoin(inventoryLocations, eq(jobInventoryUsage.locationId, inventoryLocations.id))
    .leftJoin(users, eq(jobInventoryUsage.consumedByUserId, users.id))
    .where(
      and(
        eq(jobInventoryUsage.companyId, companyId),
        eq(jobInventoryUsage.locationId, locationId),
        isNull(jobInventoryUsage.deletedAt),
      ),
    )
    .orderBy(desc(jobInventoryUsage.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    ...r,
    kind: r.kind as "consumption" | "return",
    locationName: r.locationName ?? "—",
  }));
}

// ─── Get + remove (used by the service) ──────────────────────────────

async function getById(
  companyId: string,
  id: string,
): Promise<JobInventoryUsage | null> {
  const [row] = await db
    .select()
    .from(jobInventoryUsage)
    .where(
      and(
        eq(jobInventoryUsage.companyId, companyId),
        eq(jobInventoryUsage.id, id),
        isNull(jobInventoryUsage.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Returnable quantity = parent.quantity − SUM(existing returns
 *  against parent). Used by the service to validate a return request
 *  against the parent's remaining capacity. */
async function returnableQuantityFor(
  companyId: string,
  parentUsageId: string,
): Promise<number> {
  const [parent] = await db
    .select({ quantity: jobInventoryUsage.quantity })
    .from(jobInventoryUsage)
    .where(
      and(
        eq(jobInventoryUsage.companyId, companyId),
        eq(jobInventoryUsage.id, parentUsageId),
        eq(jobInventoryUsage.kind, "consumption"),
        isNull(jobInventoryUsage.deletedAt),
      ),
    )
    .limit(1);
  if (!parent) return 0;

  const [existing] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${jobInventoryUsage.quantity}), 0)`,
    })
    .from(jobInventoryUsage)
    .where(
      and(
        eq(jobInventoryUsage.companyId, companyId),
        eq(jobInventoryUsage.parentUsageId, parentUsageId),
        eq(jobInventoryUsage.kind, "return"),
        isNull(jobInventoryUsage.deletedAt),
      ),
    );

  return Number(parent.quantity) - Number(existing?.total ?? 0);
}

export const jobInventoryUsageRepository = {
  listForJob,
  listRecentForItem,
  listRecentForLocation,
  getById,
  returnableQuantityFor,
};
