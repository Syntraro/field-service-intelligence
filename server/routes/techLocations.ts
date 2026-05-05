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
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import {
  clientLocations,
  customerCompanies,
  jobs,
  jobVisits,
  locationEquipment,
  users,
} from "@shared/schema";
import { asyncHandler, createError } from "../middleware/errorHandler";
import type { AuthedRequest } from "../auth/tenantIsolation";
import { storage } from "../storage/index";
import { clientRepository } from "../storage/clients";
import { equipmentCatalogRepository } from "../storage/equipmentCatalog";
import { getJobsFeed } from "../storage/jobsFeed";
import { getQueryCtx } from "../lib/queryCtx";
import { assertCanAccessTechLocation } from "../auth/techLocationAccess";

/** Mirrors `server/routes/equipment.routes.ts::mapJobTypeToEntryType`.
 *  Five-line lookup; duplicated rather than exported from a route file
 *  so the tech surface stays self-contained. Keep in sync. */
function mapJobTypeToEntryType(jobType: string | null): string {
  switch (jobType) {
    case "maintenance":
      return "pm";
    case "inspection":
      return "inspection";
    case "installation":
      return "install";
    case "repair":
    case "emergency":
    default:
      return "service";
  }
}

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

/** Roles that bypass per-visit assignment scoping when using the tech app.
 * Mirrors the policy in `assertCanAccessTechLocation`. */
const OFFICE_BYPASS_ROLES = new Set(["owner", "admin", "manager"]);

/**
 * GET /api/tech/locations/search
 *
 * Tech-safe location search. Replaces the office `/api/clients/search-locations`
 * endpoint for technician-PWA consumers (SearchPage, CreateLeadPage,
 * CreateJobPage). Two scoping modes:
 *
 *   - office bypass (owner / admin / manager): tenant-wide search.
 *   - assignment-scoped (technician / dispatcher / future schedulable
 *     roles): results restricted to locations where the user has at
 *     least one ACTIVE assigned visit. The same predicate that backs
 *     `assertCanAccessTechLocation` — implemented here as a bulk
 *     EXISTS subquery so we don't make N round-trips to the helper.
 *
 * Allowlist DTO. Drops QBO sync columns, billing flags, PM cadence,
 * audit timestamps, parent-company id, soft-delete fields. Includes
 * `parentCompanyName` so consumers can display "Acme — Toronto" style
 * labels (no parent_id leak).
 *
 * Declared BEFORE `/locations/:locationId` so Express path matching
 * resolves "/locations/search" to this handler instead of treating
 * "search" as a locationId param.
 */
router.get(
  "/locations/search",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const user = req.user as any;
    const role: string = user.role ?? "technician";

    const rawQuery = ((req.query.q as string) ?? "").trim();
    const limitParam =
      typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 20;
    const limit =
      Number.isFinite(limitParam) && limitParam > 0
        ? Math.min(limitParam, 50)
        : 20;

    // Empty query returns the empty list (callers debounce + minLength
    // gate before hitting this — but we still answer cheaply).
    if (rawQuery.length === 0) {
      return res.json({ data: [], meta: { hasMore: false } });
    }

    const conditions: SQL[] = [
      eq(clientLocations.companyId, companyId),
      sql`${clientLocations.deletedAt} IS NULL`,
      sql`(${clientLocations.inactive} = false OR ${clientLocations.inactive} IS NULL)`,
    ];

    // Assignment-scoping for non-office roles. Subquery is faster than
    // a JOIN+DISTINCT here because the tech-side join cardinality is
    // tiny (a tech has tens, not thousands, of assigned visits).
    if (!OFFICE_BYPASS_ROLES.has(role)) {
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM ${jobVisits} jv
          INNER JOIN ${jobs} j ON j.id = jv.job_id
          WHERE jv.company_id = ${companyId}
            AND j.location_id = ${clientLocations.id}
            AND jv.is_active = true
            AND ${user.id} = ANY(jv.assigned_technician_ids)
        )`,
      );
    }

    // Search predicate: company name (own or parent), location label,
    // address, city. ILIKE — case-insensitive; no fancy normalization
    // here (tech-app users are searching their own assigned set, not
    // a 50k-location office catalog).
    const term = `%${rawQuery}%`;
    conditions.push(
      or(
        ilike(clientLocations.companyName, term),
        ilike(customerCompanies.name, term),
        ilike(clientLocations.location, term),
        ilike(clientLocations.address, term),
        ilike(clientLocations.city, term),
      )!,
    );

    // limit+1 trick → hasMore without a separate COUNT.
    const rows = await db
      .select({
        id: clientLocations.id,
        ownName: clientLocations.companyName,
        parentName: customerCompanies.name,
        location: clientLocations.location,
        address: clientLocations.address,
        city: clientLocations.city,
        province: clientLocations.province,
        postalCode: clientLocations.postalCode,
        phone: clientLocations.phone,
      })
      .from(clientLocations)
      .leftJoin(
        customerCompanies,
        eq(clientLocations.parentCompanyId, customerCompanies.id),
      )
      .where(and(...conditions))
      .orderBy(asc(sql`COALESCE(${customerCompanies.name}, ${clientLocations.companyName})`))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    res.json({
      data: page.map((r) => ({
        id: r.id,
        // Display companyName falls back to the parent's current name
        // when present (matches the canonical office search behavior in
        // `normalizeLocationRow` — tenant rename propagation).
        companyName: r.parentName ?? r.ownName ?? null,
        location: r.location ?? null,
        address: r.address ?? null,
        city: r.city ?? null,
        province: r.province ?? null,
        postalCode: r.postalCode ?? null,
        phone: r.phone ?? null,
      })),
      meta: { hasMore },
    });
  }),
);

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
        // 2026-05-04 Phase 2 PR 3: `name` added to the allowlist so
        // the visit-detail equipment picker can filter on the canonical
        // asset label ("RTU #1", "Walk-in Freezer", etc.) without
        // falling back to manufacturer/model. The column is NOT NULL
        // in `location_equipment`, so consumers can rely on it.
        name: locationEquipment.name,
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
        name: r.name ?? null,
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

/**
 * Resolve the equipment row for a tech-app caller and verify the
 * caller can access its location. Returns the equipment row so
 * subsequent lookups don't have to re-fetch. Single source of truth
 * for the "equipment-id → location-id → access check" chain used by
 * the timeline and notes endpoints below.
 */
async function loadEquipmentWithLocationGate(
  req: AuthedRequest,
  equipmentId: string,
) {
  const companyId = req.companyId!;
  const user = req.user as any;
  const eq = await clientRepository.getLocationEquipmentAny(
    companyId,
    equipmentId,
  );
  // Mirror the office route: 404 when equipment is missing in this
  // tenant. Distinct from the location-access-denied 403 below — a
  // missing equipment row really is "not found" because the caller
  // already has access to *some* location to navigate here.
  if (!eq) throw createError(404, "Equipment not found");
  await assertCanAccessTechLocation(
    companyId,
    user.id,
    user.role ?? "technician",
    eq.locationId,
  );
  return eq;
}

/**
 * GET /api/tech/equipment/:equipmentId/timeline
 *
 * Tech-safe replacement for `GET /api/equipment/:equipmentId/timeline`.
 * Reuses `equipmentCatalogRepository.getTimeline` (same data source
 * the office route uses) and the same display-shape mapper so the
 * UI rendering stays consistent. Adds per-tech assignment scoping
 * via the canonical helper.
 */
router.get(
  "/equipment/:equipmentId/timeline",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { equipmentId } = req.params;
    await loadEquipmentWithLocationGate(req, equipmentId);

    const rows = await equipmentCatalogRepository.getTimeline(
      companyId,
      equipmentId,
    );

    // Batch-resolve crew display names in one query, like the office
    // route does. Pulled out by user id, not user email / role.
    const crewIds = new Set<string>();
    for (const r of rows) {
      for (const id of r.assignedTechnicianIds ?? []) {
        if (id) crewIds.add(id);
      }
    }
    const nameById = new Map<string, string>();
    if (crewIds.size > 0) {
      const userRows = await db
        .select({
          id: users.id,
          fullName: users.fullName,
          firstName: users.firstName,
          lastName: users.lastName,
        })
        .from(users)
        .where(
          and(
            eq(users.companyId, companyId),
            inArray(users.id, Array.from(crewIds)),
          ),
        );
      for (const u of userRows) {
        const name =
          u.fullName ||
          [u.firstName, u.lastName].filter(Boolean).join(" ") ||
          null;
        if (name) nameById.set(u.id, name);
      }
    }

    const timeline = rows.map((r: any) => {
      const date = r.visitDate || r.visitDateFallback;
      const entryType = mapJobTypeToEntryType(r.jobType);
      const title =
        entryType === "pm"
          ? "PM Visit"
          : entryType === "inspection"
            ? "Inspection"
            : entryType === "install"
              ? "Installation"
              : "Service Visit";
      const summary =
        r.visitNotes ||
        r.outcomeNote ||
        r.equipmentNotes ||
        r.jobSummary ||
        null;
      const crewNames = (r.assignedTechnicianIds ?? [])
        .map((id: string) => nameById.get(id))
        .filter(Boolean) as string[];
      const techName = crewNames.length > 0 ? crewNames.join(", ") : null;
      return {
        id: r.visitId,
        date: date?.toISOString() || null,
        entryType,
        title,
        summary,
        jobId: r.jobId,
        jobNumber: r.jobNumber,
        visitId: r.visitId,
        visitStatus: r.visitStatus,
        outcome: r.outcome,
        technicianName: techName,
      };
    });

    res.json(timeline);
  }),
);

/**
 * GET /api/tech/equipment/:equipmentId/notes
 *
 * Tech-safe replacement for `GET /api/equipment/:equipmentId/notes`.
 * Reuses `equipmentCatalogRepository.getNotes` and the same allowlist
 * mapper used by the office route.
 */
router.get(
  "/equipment/:equipmentId/notes",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { equipmentId } = req.params;
    await loadEquipmentWithLocationGate(req, equipmentId);

    const rows = await equipmentCatalogRepository.getNotes(
      companyId,
      equipmentId,
    );

    res.json(
      rows.map((r: any) => ({
        id: r.id,
        text: r.noteText,
        author: r.userFirstName || r.userName || "Unknown",
        date: r.createdAt?.toISOString() || null,
        jobId: r.jobId,
      })),
    );
  }),
);

export default router;
