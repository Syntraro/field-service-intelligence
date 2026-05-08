/**
 * Technician Time Off Routes — admin/dispatcher CRUD for blocking
 * technician availability (2026-05-07 RALPH).
 *
 * Mounted at `/api/technician-time-off`. Permission gate (every
 * endpoint): `requireAuth` + `requireRole(MANAGER_ROLES)`. The coarse
 * role gate is the canonical layer for scheduling-edit operations on
 * this team; technicians never reach these routes.
 *
 * Endpoints
 * ---------
 *   GET    /api/technician-time-off?technicianUserId=…&start=…&end=…
 *           List time-off rows in `[start, end)` for the current
 *           tenant. `technicianUserId` optional — when omitted,
 *           returns all-team rows. Default window = today (company
 *           local) when start/end are omitted.
 *
 *   POST   /api/technician-time-off
 *           Body: { technicianUserId, reason, startsAt, endsAt,
 *                   allDay, note? }. Server-side checks:
 *             1. The technician exists in the same company.
 *             2. End is strictly after start (zod + DB CHECK).
 *             3. Reason is in the canonical union (zod + DB CHECK).
 *
 *   PATCH  /api/technician-time-off/:id
 *           Body: partial of POST. Single-sided range updates are
 *           validated against the persisted opposite end.
 *
 *   DELETE /api/technician-time-off/:id
 *           Soft-delete (sets `archived_at = NOW()`).
 *
 * Tenant isolation: every storage call filters by `req.companyId`.
 * Cross-tenant `technicianUserId` lookups return 404 (the technician
 * isn't visible from this tenant's perspective).
 */
import { Router, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { AuthedRequest } from "../auth/tenantIsolation";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { requireAuth } from "../auth/requireAuth";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { db } from "../db";
import { users } from "@shared/schema";
import {
  insertTechnicianTimeOffSchema,
  updateTechnicianTimeOffSchema,
  TECHNICIAN_TIME_OFF_REASONS,
} from "@shared/schema";
import { technicianTimeOffRepository } from "../storage/technicianTimeOff";

const router = Router();

// Mount-level coarse gate — every endpoint requires authenticated
// MANAGER_ROLES (owner, admin, manager, dispatcher). Technicians
// never reach these routes.
router.use(requireAuth);
router.use(requireRole(MANAGER_ROLES));

const listQuerySchema = z
  .object({
    technicianUserId: z.string().uuid().optional(),
    start: z.string().datetime({ offset: true }).optional(),
    end: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

/** Verify the technician belongs to the requesting tenant. Returns
 *  the user row when valid, or throws 404. */
async function assertTechnicianInCompany(
  companyId: string,
  technicianUserId: string,
): Promise<void> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, technicianUserId), eq(users.companyId, companyId)))
    .limit(1);
  if (rows.length === 0) {
    throw createError(404, "Technician not found in this company");
  }
}

// ─── GET /api/technician-time-off ──────────────────────────────────

router.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const query = validateSchema(listQuerySchema, req.query);
    const companyId = req.companyId!;
    // Default window: a wide "next 90 days" so the dashboard's
    // capacity reads + a generic admin list both get useful data
    // without requiring the caller to compute a window.
    const now = new Date();
    const defaultStart = new Date(now);
    defaultStart.setDate(defaultStart.getDate() - 1);
    const defaultEnd = new Date(now);
    defaultEnd.setDate(defaultEnd.getDate() + 90);
    const windowStart = query.start ? new Date(query.start) : defaultStart;
    const windowEnd = query.end ? new Date(query.end) : defaultEnd;
    if (windowEnd <= windowStart) {
      throw createError(400, "end must be strictly after start");
    }
    const rows = await technicianTimeOffRepository.listOverlapping(
      companyId,
      {
        technicianUserId: query.technicianUserId,
        windowStart,
        windowEnd,
      },
    );
    res.json({ entries: rows });
  }),
);

// ─── POST /api/technician-time-off ─────────────────────────────────

router.post(
  "/",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const body = validateSchema(insertTechnicianTimeOffSchema, req.body);
    const companyId = req.companyId!;
    await assertTechnicianInCompany(companyId, body.technicianUserId);
    const row = await technicianTimeOffRepository.create(companyId, {
      technicianUserId: body.technicianUserId,
      reason: body.reason,
      startsAt: new Date(body.startsAt),
      endsAt: new Date(body.endsAt),
      allDay: body.allDay ?? false,
      note: body.note ?? null,
      createdByUserId: req.user!.id,
    });
    res.status(201).json({ entry: row });
  }),
);

// ─── PATCH /api/technician-time-off/:id ────────────────────────────

const idParamSchema = z.object({ id: z.string().uuid() }).strict();

router.patch(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { id } = validateSchema(idParamSchema, req.params);
    const body = validateSchema(updateTechnicianTimeOffSchema, req.body);
    const companyId = req.companyId!;
    const existing = await technicianTimeOffRepository.findById(
      companyId,
      id,
    );
    if (!existing) {
      throw createError(404, "Time-off entry not found");
    }
    // Single-sided range check: validate against the persisted
    // opposite end so PATCH { startsAt } can't quietly break the
    // ordering invariant the DB CHECK constraint enforces.
    const nextStart = body.startsAt
      ? new Date(body.startsAt)
      : existing.startsAt;
    const nextEnd = body.endsAt ? new Date(body.endsAt) : existing.endsAt;
    if (nextEnd <= nextStart) {
      throw createError(400, "endsAt must be strictly after startsAt");
    }
    const row = await technicianTimeOffRepository.update(companyId, id, {
      reason: body.reason,
      startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
      endsAt: body.endsAt ? new Date(body.endsAt) : undefined,
      allDay: body.allDay,
      note: body.note,
    });
    if (!row) {
      throw createError(404, "Time-off entry not found");
    }
    res.json({ entry: row });
  }),
);

// ─── DELETE /api/technician-time-off/:id ───────────────────────────

router.delete(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { id } = validateSchema(idParamSchema, req.params);
    const companyId = req.companyId!;
    const ok = await technicianTimeOffRepository.softDelete(companyId, id);
    if (!ok) {
      throw createError(404, "Time-off entry not found");
    }
    res.status(204).end();
  }),
);

export default router;

// Re-exports kept for the route-mount tests.
export const __TECHNICIAN_TIME_OFF_REASON_COUNT =
  TECHNICIAN_TIME_OFF_REASONS.length;
