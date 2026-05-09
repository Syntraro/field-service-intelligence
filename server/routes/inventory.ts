/**
 * Inventory API (2026-05-08 foundation).
 *
 * Mounted at `/api/inventory`. Reads + writes BOTH gate on:
 *   - requireFeature("inventory_core")  — capability gate (canonical entitlement resolver)
 *   - requirePermission("inventory.view"|"inventory.manage") — RBAC
 *
 * Endpoints
 * ---------
 *   GET    /api/inventory/items
 *           List items with aggregated stock totals across all
 *           locations. Each row carries: { ...item, totalOnHand,
 *           totalReserved, totalAvailable, locationCount }. Available
 *           = onHand - reserved (derived).
 *
 *   GET    /api/inventory/items/:id
 *           Fetch a single item by id (tenant-scoped).
 *
 *   POST   /api/inventory/items
 *           Create a new item via the canonical insertItemSchema.
 *           Server enforces: services cannot have trackInventory=true.
 *
 *   PATCH  /api/inventory/items/:id
 *           Partial update. Same service-can't-track rule applies.
 *
 *   GET    /api/inventory/items/:id/locations
 *           Per-(item, location) stock rows for the rail Locations tab.
 *           availableQuantity is derived (on_hand - reserved).
 *
 *   GET    /api/inventory/items/:id/transactions
 *           Recent inventory_transactions for the item (limit 50).
 *
 *   PATCH  /api/inventory/items/:id/locations/:locationId/settings
 *           Settings-only update (minimum / reorder thresholds).
 *
 *   GET    /api/inventory/locations
 *           List all locations (active by default; ?includeInactive=true
 *           expands).
 *
 *   POST   /api/inventory/locations
 *           Create a new inventory location.
 *
 *   PATCH  /api/inventory/locations/:id
 *           Update a location.
 *
 *   POST   /api/inventory/transfers
 *           Move stock between two locations. Single-tx invariant:
 *           inventory_transactions row + both quantity rows update
 *           together. Rejects: insufficient stock, same-location,
 *           inactive location, service item, untracked item.
 *
 *   POST   /api/inventory/adjustments
 *           Stock-up or stock-down at one location. Same-tx invariant.
 *
 *   GET    /api/inventory/low-stock
 *           Rows where on_hand <= reorder_point. Joins item + location.
 */

import { Router, type Response } from "express";
import { z } from "zod";
import type { AuthedRequest } from "../auth/tenantIsolation";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { requireFeature } from "../auth/requireFeature";
import { requirePermission } from "../permissions";
import { db } from "../db";
import { and, desc, eq } from "drizzle-orm";
import {
  items,
  insertItemSchema,
  insertInventoryLocationSchema,
  updateInventoryLocationSchema,
  updateInventoryQuantitySettingsSchema,
  transferInventorySchema,
  adjustInventorySchema,
  consumeInventoryForJobSchema,
  returnInventoryFromJobSchema,
  reserveInventorySchema,
  type InsertItem,
  type Item,
} from "@shared/schema";
import {
  inventoryLocationsRepository,
  inventoryQuantitiesRepository,
  inventoryTransactionsRepository,
  inventoryService,
  InventoryError,
} from "../storage/inventory";
import { jobInventoryUsageRepository } from "../storage/jobInventoryUsage";
import { inventoryReservationsRepository } from "../storage/inventoryReservations";

const router = Router();

// 2026-05-08 — capability gate runs at the mount layer so every route
// below inherits it. Tenants without inventory_core get 403 on every
// inventory request, including reads. The permission gate is
// per-route (view vs manage) so dispatcher (view-only) can browse but
// not mutate.
router.use(requireFeature("inventory_core"));

// ─── Items: list / get / create / update ─────────────────────────────

const updateItemSchema = z.object({
  type: z.enum(["product", "service"]).optional(),
  name: z.string().min(1).max(200).optional(),
  sku: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  cost: z.string().nullable().optional(),
  unitPrice: z.string().nullable().optional(),
  isTaxable: z.boolean().optional(),
  category: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  trackInventory: z.boolean().optional(),
});

router.get(
  "/items",
  requirePermission("inventory.view"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    // Phase 3: ?stockOnly=true narrows to product items that track
    // inventory — used by the Add Inventory modal's item picker so
    // the user can't select a service item or a non-stock product.
    const stockOnly = req.query.stockOnly === "true";
    const baseFilter = stockOnly
      ? and(
          eq(items.companyId, companyId),
          eq(items.type, "product"),
          eq(items.trackInventory, true),
          eq(items.isActive, true),
        )
      : eq(items.companyId, companyId);
    const itemRows = await db
      .select()
      .from(items)
      .where(baseFilter)
      .orderBy(items.name);

    // Aggregate stock totals once (single GROUP BY) and zip onto items.
    const totalsByItem = await inventoryQuantitiesRepository.aggregateByItem(companyId);

    const enriched = itemRows.map((it) => ({
      ...it,
      stock: totalsByItem.get(it.id) ?? {
        itemId: it.id,
        totalOnHand: "0",
        totalReserved: "0",
        totalAvailable: "0",
        locationCount: 0,
      },
    }));

    res.json({ items: enriched });
  }),
);

router.get(
  "/items/:id",
  requirePermission("inventory.view"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const id = req.params.id;
    const [row] = await db
      .select()
      .from(items)
      .where(and(eq(items.id, id), eq(items.companyId, companyId)))
      .limit(1);
    if (!row) throw createError(404, "Item not found");
    res.json(row);
  }),
);

router.post(
  "/items",
  requirePermission("inventory.manage"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const userId = req.user?.id ?? null;
    const data = validateSchema(insertItemSchema, req.body) as InsertItem;
    if (data.type === "service" && data.trackInventory) {
      throw createError(400, "Service items cannot track inventory.");
    }
    const [row] = await db
      .insert(items)
      .values({ ...data, companyId, userId })
      .returning();
    res.status(201).json(row);
  }),
);

router.patch(
  "/items/:id",
  requirePermission("inventory.manage"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const id = req.params.id;
    const data = validateSchema(updateItemSchema, req.body);
    if (data.type === "service" && data.trackInventory) {
      throw createError(400, "Service items cannot track inventory.");
    }
    const [row] = await db
      .update(items)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(items.id, id), eq(items.companyId, companyId)))
      .returning();
    if (!row) throw createError(404, "Item not found");
    res.json(row);
  }),
);

// ─── Per-item stock + transactions ──────────────────────────────────

router.get(
  "/items/:id/locations",
  requirePermission("inventory.view"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const rows = await inventoryQuantitiesRepository.listForItem(
      req.companyId,
      req.params.id,
    );
    res.json({ rows });
  }),
);

router.get(
  "/items/:id/transactions",
  requirePermission("inventory.view"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const rows = await inventoryTransactionsRepository.listForItem(
      req.companyId,
      req.params.id,
      Number.isFinite(limit) && limit > 0 ? limit : 50,
    );
    res.json({ rows });
  }),
);

router.patch(
  "/items/:itemId/locations/:locationId/settings",
  requirePermission("inventory.manage"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const data = validateSchema(updateInventoryQuantitySettingsSchema, req.body);
    const row = await inventoryQuantitiesRepository.upsertSettings(
      req.companyId,
      req.params.itemId,
      req.params.locationId,
      data,
    );
    res.json(row);
  }),
);

// ─── Locations ───────────────────────────────────────────────────────

router.get(
  "/locations",
  requirePermission("inventory.view"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const includeInactive = req.query.includeInactive === "true";
    // Phase-2: every list response is now enriched with per-row
    // aggregates (itemCount, totalQuantity, lowStockCount) + assigned
    // user name. The Locations tab table consumes these directly so
    // there's no client-side N+1.
    const rows = await inventoryLocationsRepository.listWithAggregates(
      req.companyId,
      includeInactive,
    );
    res.json({ rows });
  }),
);

// Phase 6 (2026-05-08): resolve the assigned inventory location for the
// authenticated user. Used by the tech AddPart flow to default the
// consume source. Returns { location: null } when the user has no
// active assignment so the client can fall through to the manual
// picker without treating "no assignment" as an error.
//
// IMPORTANT: This literal route MUST be registered BEFORE the
// `/locations/:id` param route below — Express matches the first
// declared route, and `:id` would otherwise swallow the literal
// segment and produce a 404 lookup for a location with
// id="assigned-to-me".
router.get(
  "/locations/assigned-to-me",
  requirePermission("inventory.view"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) throw createError(401, "Unauthenticated");
    const row = await inventoryLocationsRepository.getAssignedLocationForUser(
      req.companyId,
      userId,
    );
    res.json({ location: row ?? null });
  }),
);

router.get(
  "/locations/:id",
  requirePermission("inventory.view"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const row = await inventoryLocationsRepository.get(req.companyId, req.params.id);
    if (!row) throw createError(404, "Inventory location not found");
    res.json(row);
  }),
);

router.get(
  "/locations/:id/inventory",
  requirePermission("inventory.view"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const rows = await inventoryLocationsRepository.listInventoryAtLocation(
      req.companyId,
      req.params.id,
    );
    res.json({ rows });
  }),
);

router.get(
  "/locations/:id/transactions",
  requirePermission("inventory.view"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const rows = await inventoryTransactionsRepository.listForLocation(
      req.companyId,
      req.params.id,
      Number.isFinite(limit) && limit > 0 ? limit : 50,
    );
    res.json({ rows });
  }),
);

router.post(
  "/locations",
  requirePermission("inventory.manage"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const data = validateSchema(insertInventoryLocationSchema, req.body);
    const row = await inventoryLocationsRepository.create(req.companyId, data);
    res.status(201).json(row);
  }),
);

router.patch(
  "/locations/:id",
  requirePermission("inventory.manage"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const data = validateSchema(updateInventoryLocationSchema, req.body);
    const row = await inventoryLocationsRepository.update(req.companyId, req.params.id, data);
    if (!row) throw createError(404, "Inventory location not found");
    res.json(row);
  }),
);

/** Archive (soft-disable) a location. Sets isActive=false. We DO NOT
 *  hard-delete because inventory_transactions reference the location
 *  id — the rail's transaction history must keep its location-name
 *  hydration intact forever. Archived locations are simply hidden from
 *  default pickers and from the active Locations tab view. */
router.post(
  "/locations/:id/archive",
  requirePermission("inventory.manage"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const row = await inventoryLocationsRepository.archive(req.companyId, req.params.id);
    if (!row) throw createError(404, "Inventory location not found");
    res.json(row);
  }),
);

// ─── Transfers + adjustments (the only quantity-mutation paths) ─────

router.post(
  "/transfers",
  requirePermission("inventory.manage"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const data = validateSchema(transferInventorySchema, req.body);
    try {
      const result = await inventoryService.performTransfer(
        req.companyId,
        req.user?.id ?? null,
        data,
      );
      res.status(201).json(result);
    } catch (err) {
      throw mapInventoryError(err);
    }
  }),
);

router.post(
  "/adjustments",
  requirePermission("inventory.manage"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const data = validateSchema(adjustInventorySchema, req.body);
    try {
      const result = await inventoryService.performAdjustment(
        req.companyId,
        req.user?.id ?? null,
        data,
      );
      res.status(201).json(result);
    } catch (err) {
      throw mapInventoryError(err);
    }
  }),
);

// ─── Low-stock view ─────────────────────────────────────────────────

router.get(
  "/low-stock",
  requirePermission("inventory.view"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const rows = await inventoryQuantitiesRepository.listLowStock(req.companyId);
    res.json({ rows });
  }),
);

// ─── Phase 3: per-item / per-location recent usage ───────────────────

router.get(
  "/items/:id/recent-usage",
  requirePermission("inventory.view"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const limit = Math.min(Number(req.query.limit ?? 10), 50);
    const rows = await jobInventoryUsageRepository.listRecentForItem(
      req.companyId,
      req.params.id,
      Number.isFinite(limit) && limit > 0 ? limit : 10,
    );
    res.json({ rows });
  }),
);

router.get(
  "/locations/:id/recent-usage",
  requirePermission("inventory.view"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const limit = Math.min(Number(req.query.limit ?? 10), 50);
    const rows = await jobInventoryUsageRepository.listRecentForLocation(
      req.companyId,
      req.params.id,
      Number.isFinite(limit) && limit > 0 ? limit : 10,
    );
    res.json({ rows });
  }),
);

// ─── Phase 3: per-job consumption + return + remove ──────────────────
//
// Mounted under /api/inventory/jobs/:jobId/usage so the existing
// requireFeature("inventory_core") gate at the router root applies
// automatically. Per-route permission gates: read on inventory.view,
// write on inventory.manage. The job's own role gate lives on
// /api/jobs/* (mount-level requireRole(MANAGER_ROLES)) — consumption
// here is a separate API surface scoped to the inventory module.

router.get(
  "/jobs/:jobId/usage",
  requirePermission("inventory.view"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const data = await jobInventoryUsageRepository.listForJob(
      req.companyId,
      req.params.jobId,
    );
    res.json(data);
  }),
);

// Phase 4: per-line aggregate. Surfaces "X consumed of Y" indicators
// next to job line items + drives the consume-from-line-item modal's
// default quantity.
router.get(
  "/jobs/:jobId/line-fulfillment",
  requirePermission("inventory.view"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const rows = await jobInventoryUsageRepository.fulfillmentByLineForJob(
      req.companyId,
      req.params.jobId,
    );
    res.json({ rows });
  }),
);

// Phase 4: suggested lines for the consume-from-line-item UX. Server
// applies the same consume-eligibility rules consumeForJob enforces
// (product + trackInventory + active) so no suggestion ever fails on
// submit.
router.get(
  "/jobs/:jobId/line-suggestions",
  requirePermission("inventory.view"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const rows = await jobInventoryUsageRepository.suggestLinesForJob(
      req.companyId,
      req.params.jobId,
    );
    res.json({ rows });
  }),
);

router.post(
  "/jobs/:jobId/usage",
  requirePermission("inventory.manage"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const data = validateSchema(consumeInventoryForJobSchema, req.body);
    try {
      const result = await inventoryService.consumeForJob(
        req.companyId,
        req.params.jobId,
        req.user?.id ?? null,
        data,
      );
      res.status(201).json(result);
    } catch (err) {
      throw mapInventoryError(err);
    }
  }),
);

router.post(
  "/jobs/:jobId/usage/:usageId/return",
  requirePermission("inventory.manage"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    // The route's :usageId is the canonical id; we accept the same id
    // in the body for client convenience but the URL wins. Keep them
    // aligned so a stale client cannot return against a different
    // parent than the URL implies.
    const data = validateSchema(returnInventoryFromJobSchema, {
      ...req.body,
      usageId: req.params.usageId,
    });
    try {
      const result = await inventoryService.returnFromJob(
        req.companyId,
        req.params.jobId,
        req.user?.id ?? null,
        data,
      );
      res.status(201).json(result);
    } catch (err) {
      throw mapInventoryError(err);
    }
  }),
);

router.delete(
  "/jobs/:jobId/usage/:usageId",
  requirePermission("inventory.manage"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    try {
      const result = await inventoryService.removeUsage(
        req.companyId,
        req.params.jobId,
        req.user?.id ?? null,
        req.params.usageId,
      );
      res.json(result);
    } catch (err) {
      throw mapInventoryError(err);
    }
  }),
);

// ─── Phase 5: Reservations ───────────────────────────────────────────
//
// Reservation reads on inventory.view; writes on inventory.manage.
// Reservations are gated by the same requireFeature("inventory_core")
// that wraps every route in this router.
//
// Routes:
//   GET    /jobs/:jobId/reservations           — active reservations for a job
//   POST   /jobs/:jobId/reservations           — create one (jobId from URL wins)
//   POST   /reservations                       — create one (no job, ad-hoc)
//   POST   /reservations/:id/release           — free remainder, status='released'
//   POST   /reservations/:id/cancel            — free remainder, status='canceled'
//   GET    /items/:id/reservations             — recent reservations for an item
//   GET    /locations/:id/reservations         — recent reservations for a location

router.get(
  "/jobs/:jobId/reservations",
  requirePermission("inventory.view"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    // Active-only by default. ?includeHistorical=true expands to all
    // statuses for the audit-trail view.
    const activeOnly = req.query.includeHistorical !== "true";
    const rows = await inventoryReservationsRepository.listForJob(
      req.companyId,
      req.params.jobId,
      { activeOnly },
    );
    res.json({ rows });
  }),
);

router.post(
  "/jobs/:jobId/reservations",
  requirePermission("inventory.manage"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    // URL jobId wins over body jobId so a stale client cannot reserve
    // against a different job than the URL implies.
    const data = validateSchema(reserveInventorySchema, {
      ...req.body,
      jobId: req.params.jobId,
    });
    try {
      const result = await inventoryService.reserveInventory(
        req.companyId,
        req.user?.id ?? null,
        data,
      );
      res.status(201).json(result);
    } catch (err) {
      throw mapInventoryError(err);
    }
  }),
);

router.post(
  "/reservations",
  requirePermission("inventory.manage"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const data = validateSchema(reserveInventorySchema, req.body);
    try {
      const result = await inventoryService.reserveInventory(
        req.companyId,
        req.user?.id ?? null,
        data,
      );
      res.status(201).json(result);
    } catch (err) {
      throw mapInventoryError(err);
    }
  }),
);

router.post(
  "/reservations/:id/release",
  requirePermission("inventory.manage"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    try {
      const result = await inventoryService.releaseReservation(
        req.companyId,
        req.user?.id ?? null,
        req.params.id,
      );
      res.json(result);
    } catch (err) {
      throw mapInventoryError(err);
    }
  }),
);

router.post(
  "/reservations/:id/cancel",
  requirePermission("inventory.manage"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    try {
      const result = await inventoryService.cancelReservation(
        req.companyId,
        req.user?.id ?? null,
        req.params.id,
      );
      res.json(result);
    } catch (err) {
      throw mapInventoryError(err);
    }
  }),
);

router.get(
  "/items/:id/reservations",
  requirePermission("inventory.view"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const limit = Math.min(Number(req.query.limit ?? 10), 50);
    const rows = await inventoryReservationsRepository.listRecentForItem(
      req.companyId,
      req.params.id,
      Number.isFinite(limit) && limit > 0 ? limit : 10,
    );
    res.json({ rows });
  }),
);

router.get(
  "/locations/:id/reservations",
  requirePermission("inventory.view"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const limit = Math.min(Number(req.query.limit ?? 10), 50);
    const rows = await inventoryReservationsRepository.listRecentForLocation(
      req.companyId,
      req.params.id,
      Number.isFinite(limit) && limit > 0 ? limit : 10,
    );
    res.json({ rows });
  }),
);

// ─── Internal: map InventoryError → HTTP error ──────────────────────

function mapInventoryError(err: unknown): Error {
  if (err instanceof InventoryError) {
    const status =
      err.code === "ITEM_NOT_FOUND" || err.code === "LOCATION_NOT_FOUND" ? 404 : 400;
    return createError(status, err.message, err.code);
  }
  return err as Error;
}

export default router;
