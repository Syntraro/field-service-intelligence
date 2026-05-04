/**
 * Tech location access scoping (Phase 2 PR 1, 2026-05-04)
 *
 * Single source of truth for "can this tech-app caller see resources
 * scoped to client_location X in tenant T?". Reused by every
 * `/api/tech/locations/:locationId/*` endpoint and the future
 * `/api/tech/equipment/:id/{timeline,notes}` endpoints (which resolve
 * the equipment row's locationId, then call this helper).
 *
 * Rules:
 *   1. Tenant gate. The location must exist within `companyId` and not
 *      be soft-deleted. If it doesn't, throw 403 — we deny without
 *      leaking existence (same shape as `requirePermission`).
 *   2. Office bypass. owner / admin / manager pass once tenant gate (1)
 *      passes. They are using the tech app intentionally (e.g. office
 *      staff covering a route) and existing office RBAC already governs
 *      their data access at the storage layer.
 *   3. Assignment scope. Other tenant roles (dispatcher, technician,
 *      and any future schedulable role) need at least one ACTIVE visit
 *      at this location whose `assigned_technician_ids` array contains
 *      `userId`. Inactive visits do NOT grant access.
 *
 * Throws `createError(403)` on denial. Resolves on success.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { clientLocations, jobVisits, jobs } from "@shared/schema";
import { createError } from "../middleware/errorHandler";

/** Roles that bypass per-visit assignment scoping when using the tech app. */
const OFFICE_BYPASS_ROLES = new Set(["owner", "admin", "manager"]);

export async function assertCanAccessTechLocation(
  companyId: string,
  userId: string,
  role: string,
  locationId: string,
): Promise<void> {
  if (!companyId || !userId || !locationId) {
    throw createError(403, "Access denied for this location");
  }

  // 1) Tenant gate — location must belong to this tenant.
  const locRows = await db
    .select({ id: clientLocations.id })
    .from(clientLocations)
    .where(
      and(
        eq(clientLocations.id, locationId),
        eq(clientLocations.companyId, companyId),
      ),
    )
    .limit(1);

  if (locRows.length === 0) {
    throw createError(403, "Access denied for this location");
  }

  // 2) Office bypass — owner / admin / manager skip assignment scoping.
  if (OFFICE_BYPASS_ROLES.has(role)) {
    return;
  }

  // 3) Assignment scope — require ≥1 active assigned visit at this
  // location for this user. job_visits has no locationId of its own,
  // so we join through jobs.location_id.
  const assignedRows = await db
    .select({ id: jobVisits.id })
    .from(jobVisits)
    .innerJoin(jobs, eq(jobs.id, jobVisits.jobId))
    .where(
      and(
        eq(jobVisits.companyId, companyId),
        eq(jobs.locationId, locationId),
        eq(jobs.companyId, companyId),
        sql`${jobVisits.isActive} = true`,
        sql`${userId} = ANY(${jobVisits.assignedTechnicianIds})`,
      ),
    )
    .limit(1);

  if (assignedRows.length === 0) {
    throw createError(403, "Access denied for this location");
  }
}
