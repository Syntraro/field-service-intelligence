/**
 * Tech Location Routes — Phase 2 PR 1 (2026-05-04)
 *
 * Tech-safe replacements for the office endpoints currently in use by
 * the technician PWA when it loads a location screen:
 *
 *   GET /api/clients/:id              → /api/tech/locations/:locationId
 *   GET /api/clients/:id/equipment    → /api/tech/locations/:locationId/equipment
 *   GET /api/jobs?locationId=...      → /api/tech/locations/:locationId/jobs
 *
 * All three endpoints:
 *   - Require `requireSchedulable` (any tenant role with isSchedulable
 *     !== false; matches the rest of /api/tech).
 *   - Pass through `assertCanAccessTechLocation()` so a technician only
 *     reaches a location where they have ≥1 active assigned visit.
 *     owner/admin/manager bypass once tenant-scoped existence is
 *     confirmed.
 *   - Return explicit allowlist DTOs only — no schema-row passthrough.
 *     QBO sync fields, optimistic-locking columns, internal flags
 *     (`needsDetails`, `inactive`, `selectedMonths`, `nextDue`,
 *     `notes`, `userId`, `parentCompanyId`, etc.) are intentionally
 *     omitted from every shape.
 *
 * Sibling to `techField.ts` because that file is already past 2000
 * lines; the location surface is its own coherent slice and warrants
 * its own router.
 */

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { locationEquipment, users } from "@shared/schema";
import { asyncHandler, createError } from "../middleware/errorHandler";
import type { AuthedRequest } from "../auth/tenantIsolation";
import { storage } from "../storage/index";
import { getJobsFeed } from "../storage/jobsFeed";
import { getQueryCtx } from "../lib/queryCtx";
import { assertCanAccessTechLocation } from "../auth/techLocationAccess";

const router = Router();

/**
 * requireSchedulable — same shape as the gate in `techField.ts`.
 * Local copy keeps the two routers independent; both files are mounted
 * at /api/tech and may evolve at different rates.
 */
function requireSchedulable(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const user = req.user as any;
  if (!user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  if (user.isSchedulable === false) {
    return res
      .status(403)
      .json({ error: "User is not schedulable (Show on calendar is disabled)" });
  }
  next();
}

router.use(requireSchedulable);

/**
 * GET /api/tech/locations/:locationId
 *
 * Tech-safe replacement for `GET /api/clients/:id`. Returns only the
 * field set the technician PWA needs to render a location header.
 */
router.get(
  "/locations/:locationId",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const user = req.user as any;
    const { locationId } = req.params;

    await assertCanAccessTechLocation(
      companyId,
      user.id,
      user.role ?? "technician",
      locationId,
    );

    const loc = await storage.getClient(companyId, locationId);
    if (!loc) {
      // Should be unreachable — assert above already gated on existence.
      throw createError(403, "Access denied for this location");
    }

    let parentCompanyName: string | null = null;
    if (loc.parentCompanyId) {
      const parent = await storage.getCustomerCompany(
        companyId,
        loc.parentCompanyId,
      );
      parentCompanyName = parent?.name ?? null;
    }

    res.json({
      id: loc.id,
      companyName: loc.companyName ?? null,
      parentCompanyName,
      location: loc.location ?? null,
      address: loc.address ?? null,
      address2: loc.address2 ?? null,
      city: loc.city ?? null,
      province: loc.province ?? null,
      postalCode: loc.postalCode ?? null,
      country: loc.country ?? null,
      lat: loc.lat ?? null,
      lng: loc.lng ?? null,
      contactName: loc.contactName ?? null,
      email: loc.email ?? null,
      phone: loc.phone ?? null,
      roofLadderCode: loc.roofLadderCode ?? null,
    });
  }),
);

/**
 * GET /api/tech/locations/:locationId/equipment
 *
 * Tech-safe replacement for `GET /api/clients/:id/equipment`. Returns
 * the active equipment list with field names tuned for the tech app
 * (`type` instead of `equipmentType`, `model` instead of `modelNumber`,
 * `installedAt` instead of `installDate`).
 */
router.get(
  "/locations/:locationId/equipment",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const user = req.user as any;
    const { locationId } = req.params;

    await assertCanAccessTechLocation(
      companyId,
      user.id,
      user.role ?? "technician",
      locationId,
    );

    const rows = await db
      .select({
        id: locationEquipment.id,
        equipmentType: locationEquipment.equipmentType,
        manufacturer: locationEquipment.manufacturer,
        modelNumber: locationEquipment.modelNumber,
        serialNumber: locationEquipment.serialNumber,
        installDate: locationEquipment.installDate,
        notes: locationEquipment.notes,
      })
      .from(locationEquipment)
      .where(
        and(
          eq(locationEquipment.companyId, companyId),
          eq(locationEquipment.locationId, locationId),
          eq(locationEquipment.isActive, true),
        ),
      )
      .orderBy(desc(locationEquipment.createdAt));

    res.json(
      rows.map((r) => ({
        id: r.id,
        type: r.equipmentType ?? null,
        manufacturer: r.manufacturer ?? null,
        model: r.modelNumber ?? null,
        serialNumber: r.serialNumber ?? null,
        installedAt: r.installDate ?? null,
        notes: r.notes ?? null,
      })),
    );
  }),
);

/**
 * GET /api/tech/locations/:locationId/jobs
 *
 * Tech-safe replacement for `GET /api/jobs?locationId=...`. Reuses
 * the canonical `getJobsFeed()` so the tenant filter, soft-delete
 * predicate, and visit-derived crew resolution stay consistent with
 * the office Jobs list. Default page size 10, newest first.
 */
router.get(
  "/locations/:locationId/jobs",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const user = req.user as any;
    const { locationId } = req.params;

    await assertCanAccessTechLocation(
      companyId,
      user.id,
      user.role ?? "technician",
      locationId,
    );

    const limitParam =
      typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 10;
    const limit =
      Number.isFinite(limitParam) && limitParam > 0
        ? Math.min(limitParam, 50)
        : 10;
    const offsetParam =
      typeof req.query.offset === "string"
        ? parseInt(req.query.offset, 10)
        : 0;
    const offset =
      Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : 0;

    const ctx = getQueryCtx(req);
    // Fetch limit+1 to compute hasMore without running a count query.
    const { items } = await getJobsFeed(ctx, {
      locationId,
      limit: limit + 1,
      offset,
      sortBy: "scheduledStart",
      sortOrder: "desc",
    });

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;

    // Resolve technician display names for the visible page only.
    const techIds = new Set<string>();
    for (const it of page) {
      for (const id of it.assignedTechnicianIds ?? []) techIds.add(id);
    }
    const techNameById = new Map<string, string>();
    if (techIds.size > 0) {
      const techRows = await db
        .select({ id: users.id, fullName: users.fullName })
        .from(users)
        .where(eq(users.companyId, companyId));
      for (const r of techRows) {
        if (r.fullName) techNameById.set(r.id, r.fullName);
      }
    }

    const data = page.map((it) => {
      const assigned = it.assignedTechnicianIds ?? [];
      const names = assigned
        .map((id) => techNameById.get(id))
        .filter((n): n is string => !!n);
      return {
        id: it.id,
        jobNumber: it.jobNumber,
        jobType: it.jobType ?? null,
        status: it.status,
        scheduledStart: it.scheduledStart,
        scheduledEnd: it.scheduledEnd,
        summary: it.summary,
        technicianName: names.length > 0 ? names.join(", ") : null,
      };
    });

    res.json({ data, meta: { hasMore } });
  }),
);

export default router;
