/**
 * Lead-visit access scoping for tech endpoints (2026-05-05).
 *
 * Mirrors `assertCanAccessTechLocation` in shape: tenant gate +
 * office-bypass + per-tech assignment scope. Used by every
 * `/api/tech/lead-visits/:visitId/*` endpoint.
 *
 * Rules:
 *   1. Tenant gate. Visit must exist within the caller's company.
 *      404 on miss (no leak of cross-tenant existence).
 *   2. Office bypass. owner / admin / manager pass once tenant gate
 *      passes — same policy as the tech location surface.
 *   3. Assignment scope. Other tenant roles (dispatcher,
 *      technician, schedulable custom roles) need to be in the
 *      visit's `assigned_technician_ids` array. 403 otherwise.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { leadVisits } from "@shared/schema";
import { createError } from "../middleware/errorHandler";

const OFFICE_BYPASS_ROLES = new Set(["owner", "admin", "manager"]);

export async function assertCanAccessLeadVisit(
  companyId: string,
  userId: string,
  role: string,
  visitId: string,
): Promise<{ id: string; leadId: string; assignedTechnicianIds: string[] | null }> {
  if (!companyId || !userId || !visitId) {
    throw createError(404, "Lead visit not found");
  }

  // 1) Tenant + active gate.
  const rows = await db
    .select({
      id: leadVisits.id,
      leadId: leadVisits.leadId,
      assignedTechnicianIds: leadVisits.assignedTechnicianIds,
    })
    .from(leadVisits)
    .where(
      and(
        eq(leadVisits.id, visitId),
        eq(leadVisits.companyId, companyId),
        eq(leadVisits.isActive, true),
      ),
    )
    .limit(1);

  if (rows.length === 0) {
    throw createError(404, "Lead visit not found");
  }
  const visit = rows[0];

  // 2) Office bypass.
  if (OFFICE_BYPASS_ROLES.has(role)) {
    return visit;
  }

  // 3) Assignment scope. Use SQL ANY() rather than JS .includes so
  // null arrays return false (not throw). Mirrors the technician
  // filter used elsewhere in the codebase.
  const assignedRows = await db
    .select({ id: leadVisits.id })
    .from(leadVisits)
    .where(
      and(
        eq(leadVisits.id, visitId),
        eq(leadVisits.companyId, companyId),
        sql`${userId} = ANY(${leadVisits.assignedTechnicianIds})`,
      ),
    )
    .limit(1);

  if (assignedRows.length === 0) {
    throw createError(403, "Access denied for this visit");
  }
  return visit;
}
