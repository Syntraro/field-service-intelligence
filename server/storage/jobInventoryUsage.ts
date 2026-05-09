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
import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import {
  jobInventoryUsage,
  inventoryLocations,
  items,
  jobParts,
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
  /** Phase 4: optional linkage back to the job_parts line that
   *  triggered this consumption. NULL when the consumption was
   *  started without a line context. */
  lineItemId: string | null;
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
      lineItemId: jobInventoryUsage.lineItemId,
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

// ─── Phase 4: per-line fulfillment + line suggestion reads ──────────

/** Per-line consumption fulfillment, returned by
 *  GET /api/inventory/jobs/:jobId/line-fulfillment. The client
 *  consumes this to render small "X consumed of Y" indicators next to
 *  job line items + to compute the default quantity for the consume-
 *  from-line-item flow. */
export interface JobLineFulfillment {
  lineItemId: string;
  consumedQuantity: string;
  returnedQuantity: string;
  /** consumedQuantity − returnedQuantity. */
  netConsumedQuantity: string;
}

async function fulfillmentByLineForJob(
  companyId: string,
  jobId: string,
): Promise<JobLineFulfillment[]> {
  // Aggregate per (line_item_id, kind) with one GROUP BY pass. Rows
  // without a lineItemId are skipped (they belong to the rail-driven
  // flow + don't fulfill any specific line).
  const rows = await db
    .select({
      lineItemId: jobInventoryUsage.lineItemId,
      kind: jobInventoryUsage.kind,
      total: sql<string>`COALESCE(SUM(${jobInventoryUsage.quantity}), 0)`,
    })
    .from(jobInventoryUsage)
    .where(
      and(
        eq(jobInventoryUsage.companyId, companyId),
        eq(jobInventoryUsage.jobId, jobId),
        sql`${jobInventoryUsage.lineItemId} IS NOT NULL`,
        isNull(jobInventoryUsage.deletedAt),
      ),
    )
    .groupBy(jobInventoryUsage.lineItemId, jobInventoryUsage.kind);

  const map = new Map<string, { consumed: number; returned: number }>();
  for (const r of rows) {
    if (!r.lineItemId) continue;
    const acc = map.get(r.lineItemId) ?? { consumed: 0, returned: 0 };
    if (r.kind === "consumption") acc.consumed += Number(r.total);
    else acc.returned += Number(r.total);
    map.set(r.lineItemId, acc);
  }

  return Array.from(map.entries()).map(([lineItemId, acc]) => ({
    lineItemId,
    consumedQuantity: roundQty(acc.consumed).toString(),
    returnedQuantity: roundQty(acc.returned).toString(),
    netConsumedQuantity: roundQty(acc.consumed - acc.returned).toString(),
  }));
}

/** Suggestion row for the "consume from line item" UX. Returns the
 *  job's product line items whose linked catalog item is product +
 *  trackInventory + active, with the line's quantity, the catalog
 *  itemId, and the already-fulfilled net quantity (from
 *  fulfillmentByLineForJob). The client picks "remaining = max(0,
 *  line.quantity − netConsumed)" as the suggested default qty. */
export interface JobLineSuggestion {
  lineItemId: string;
  itemId: string;
  itemName: string | null;
  itemSku: string | null;
  description: string | null;
  /** The line's quantity on jobParts.quantity (text → string). */
  lineQuantity: string;
  /** Already consumed against this line (consumption − return). */
  netConsumedQuantity: string;
  /** lineQuantity − netConsumedQuantity, clamped at 0. */
  remainingQuantity: string;
}

async function suggestLinesForJob(
  companyId: string,
  jobId: string,
): Promise<JobLineSuggestion[]> {
  // Only product, trackInventory, active items are suggested. Service
  // items + non-stock products + inactive items can never be the
  // source of an inventory consumption — this matches the consumeForJob
  // service guards exactly so no suggestion ever fails server-side.
  const lineRows = await db
    .select({
      lineItemId: jobParts.id,
      itemId: jobParts.productId,
      itemName: items.name,
      itemSku: items.sku,
      description: jobParts.description,
      lineQuantity: jobParts.quantity,
    })
    .from(jobParts)
    .innerJoin(items, eq(jobParts.productId, items.id))
    .where(
      and(
        eq(jobParts.companyId, companyId),
        eq(jobParts.jobId, jobId),
        isNull(jobParts.deletedAt),
        eq(items.type, "product"),
        eq(items.trackInventory, true),
        eq(items.isActive, true),
      ),
    );

  if (lineRows.length === 0) return [];

  const fulfillments = await fulfillmentByLineForJob(companyId, jobId);
  const fulfillByLine = new Map(fulfillments.map((f) => [f.lineItemId, f]));

  return lineRows
    .filter((r): r is typeof r & { itemId: string } => r.itemId != null)
    .map((r) => {
      const f = fulfillByLine.get(r.lineItemId);
      const net = f ? Number(f.netConsumedQuantity) : 0;
      const lineQty = Number(r.lineQuantity ?? "0");
      const remaining = Math.max(0, lineQty - net);
      return {
        lineItemId: r.lineItemId,
        itemId: r.itemId,
        itemName: r.itemName,
        itemSku: r.itemSku,
        description: r.description,
        lineQuantity: String(roundQty(lineQty)),
        netConsumedQuantity: String(roundQty(net)),
        remainingQuantity: String(roundQty(remaining)),
      };
    });
}

export const jobInventoryUsageRepository = {
  listForJob,
  listRecentForItem,
  listRecentForLocation,
  getById,
  returnableQuantityFor,
  fulfillmentByLineForJob,
  suggestLinesForJob,
};
