/**
 * Tech-side Lead Visits routes — 2026-05-05.
 *
 * Tech endpoints:
 *   GET  /api/tech/lead-visits/today
 *   GET  /api/tech/lead-visits/:visitId
 *   POST /api/tech/lead-visits/:visitId/complete
 *   POST /api/tech/lead-visits/:visitId/notes
 *
 * Auth: `requireSchedulable` mounted at the router level + per-route
 * `assertCanAccessLeadVisit(...)` for visit-id endpoints. Office
 * roles (owner/admin/manager) bypass assignment scoping; everyone
 * else needs to be in the visit's `assigned_technician_ids`.
 *
 * **Strict allowlist DTO** — never returns the full lead row. Spec
 * fields only:
 *   { id, leadId, leadTitle, location: { ... }, scheduledStart,
 *     scheduledEnd, status, visitNotes, durationMinutes,
 *     type: "lead_visit" }
 *
 * Excluded by design: lead.description, lead.estimatedValue,
 * lead.priority, lead.sourceType, lead.assignedToUserId, etc.
 */

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  leadVisits,
  leads,
  clientLocations,
  leadNotes,
} from "@shared/schema";
import { asyncHandler, createError } from "../middleware/errorHandler";
import type { AuthedRequest } from "../auth/tenantIsolation";
import {
  listLeadVisitsForUserInRange,
  markLeadVisitCompleted,
} from "../storage/leadVisits";
import { assertCanAccessLeadVisit } from "../auth/leadVisitAccess";
import { scheduleEligibleLeadVisitFilter } from "../storage/leadVisitPredicates";
import {
  getStartOfDayInTimezone,
  getStartOfNextDayInTimezone,
  DEFAULT_TIMEZONE,
} from "../domain/scheduling";
import { companyRepository } from "../storage/company";

const router = Router();

// ── requireSchedulable (local copy, same shape as techField.ts) ─────

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

// ── DTO mapping ─────────────────────────────────────────────────────

interface TechLeadVisitDto {
  id: string;
  leadId: string;
  leadTitle: string;
  location: {
    companyName: string | null;
    address: string | null;
    city: string | null;
    province: string | null;
    postalCode: string | null;
    contactName: string | null;
    phone: string | null;
  };
  scheduledStart: string | null;
  scheduledEnd: string | null;
  status: string;
  visitNotes: string | null;
  durationMinutes: number | null;
  type: "lead_visit";
}

interface JoinedRow {
  visitId: string;
  visitLeadId: string;
  visitStatus: string;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  visitNotes: string | null;
  durationMinutes: number | null;
  leadTitle: string;
  locCompanyName: string | null;
  locAddress: string | null;
  locCity: string | null;
  locProvince: string | null;
  locPostalCode: string | null;
  locContactName: string | null;
  locPhone: string | null;
}

function toDto(row: JoinedRow): TechLeadVisitDto {
  return {
    id: row.visitId,
    leadId: row.visitLeadId,
    leadTitle: row.leadTitle,
    location: {
      companyName: row.locCompanyName,
      address: row.locAddress,
      city: row.locCity,
      province: row.locProvince,
      postalCode: row.locPostalCode,
      contactName: row.locContactName,
      phone: row.locPhone,
    },
    scheduledStart:
      row.scheduledStart instanceof Date
        ? row.scheduledStart.toISOString()
        : (row.scheduledStart ?? null),
    scheduledEnd:
      row.scheduledEnd instanceof Date
        ? row.scheduledEnd.toISOString()
        : (row.scheduledEnd ?? null),
    status: row.visitStatus,
    visitNotes: row.visitNotes,
    durationMinutes: row.durationMinutes,
    type: "lead_visit",
  };
}

// ── Joined query helpers ────────────────────────────────────────────

async function fetchLeadVisitDtoById(
  companyId: string,
  visitId: string,
): Promise<TechLeadVisitDto | null> {
  const rows = await db
    .select({
      visitId: leadVisits.id,
      visitLeadId: leadVisits.leadId,
      visitStatus: leadVisits.status,
      scheduledStart: leadVisits.scheduledStart,
      scheduledEnd: leadVisits.scheduledEnd,
      visitNotes: leadVisits.visitNotes,
      durationMinutes: leadVisits.estimatedDurationMinutes,
      leadTitle: leads.title,
      locCompanyName: clientLocations.companyName,
      locAddress: clientLocations.address,
      locCity: clientLocations.city,
      locProvince: clientLocations.province,
      locPostalCode: clientLocations.postalCode,
      locContactName: clientLocations.contactName,
      locPhone: clientLocations.phone,
    })
    .from(leadVisits)
    .innerJoin(leads, eq(leads.id, leadVisits.leadId))
    .leftJoin(clientLocations, eq(clientLocations.id, leads.locationId))
    .where(
      and(
        eq(leadVisits.id, visitId),
        eq(leadVisits.companyId, companyId),
      ),
    )
    .limit(1);

  if (rows.length === 0) return null;
  return toDto(rows[0] as JoinedRow);
}

// ── Endpoints ───────────────────────────────────────────────────────

/**
 * GET /api/tech/lead-visits/today
 *
 * Returns today's lead visits assigned to the caller (per their
 * tenant timezone). Allowlist DTO; never the raw row.
 */
router.get(
  "/today",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;

    const tz =
      (await companyRepository.getCompanyTimezone(companyId)) ??
      DEFAULT_TIMEZONE;
    const now = new Date();
    const start = getStartOfDayInTimezone(now, tz);
    const end = getStartOfNextDayInTimezone(now, tz);

    // Use the user-range list as a tenant + assignment filter, then
    // re-fetch the joined DTO shape. (We could fold this into one
    // query but keeping the canonical list helper keeps the predicate
    // single-sourced via leadVisitPredicates.ts.)
    const assignedVisits = await listLeadVisitsForUserInRange(
      companyId,
      userId,
      start,
      end,
    );
    const idSet = new Set(assignedVisits.map((v) => v.id));
    if (idSet.size === 0) {
      return res.json({ data: [] });
    }

    const rows = await db
      .select({
        visitId: leadVisits.id,
        visitLeadId: leadVisits.leadId,
        visitStatus: leadVisits.status,
        scheduledStart: leadVisits.scheduledStart,
        scheduledEnd: leadVisits.scheduledEnd,
        visitNotes: leadVisits.visitNotes,
        durationMinutes: leadVisits.estimatedDurationMinutes,
        leadTitle: leads.title,
        locCompanyName: clientLocations.companyName,
        locAddress: clientLocations.address,
        locCity: clientLocations.city,
        locProvince: clientLocations.province,
        locPostalCode: clientLocations.postalCode,
        locContactName: clientLocations.contactName,
        locPhone: clientLocations.phone,
      })
      .from(leadVisits)
      .innerJoin(leads, eq(leads.id, leadVisits.leadId))
      .leftJoin(clientLocations, eq(clientLocations.id, leads.locationId))
      .where(
        and(
          eq(leadVisits.companyId, companyId),
          scheduleEligibleLeadVisitFilter(),
        ),
      )
      .orderBy(asc(leadVisits.scheduledStart));

    const filtered = rows.filter((r) => idSet.has(r.visitId));
    res.json({ data: filtered.map((r) => toDto(r as JoinedRow)) });
  }),
);

/** GET /api/tech/lead-visits/:visitId — single visit, allowlist DTO. */
router.get(
  "/:visitId",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const user = req.user as any;
    const { visitId } = req.params;

    await assertCanAccessLeadVisit(
      companyId,
      user.id,
      user.role ?? "technician",
      visitId,
    );

    const dto = await fetchLeadVisitDtoById(companyId, visitId);
    if (!dto) throw createError(404, "Lead visit not found");
    res.json(dto);
  }),
);

/**
 * POST /api/tech/lead-visits/:visitId/complete
 *
 * Atomic completion path. Inside `markLeadVisitCompleted`:
 *   1. Visit -> 'completed', stamps completedAt/By.
 *   2. If this was the last open visit on the lead AND the lead is
 *      in (new | contacted), the lead transitions to 'needs_review'.
 *
 * Body: { outcomeNote?: string } — optional short summary the tech
 * left at completion. Must be non-empty if the spec wants to enforce
 * "no empty completion"; the frontend prevents empty submission and
 * the body is at least validated for max length here.
 */
const completeBodySchema = z.object({
  outcomeNote: z.string().max(5000).nullable().optional(),
});

router.post(
  "/:visitId/complete",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const user = req.user as any;
    const { visitId } = req.params;

    await assertCanAccessLeadVisit(
      companyId,
      user.id,
      user.role ?? "technician",
      visitId,
    );

    const body = completeBodySchema.parse(req.body ?? {});
    const result = await markLeadVisitCompleted(
      companyId,
      visitId,
      user.id,
      body.outcomeNote ?? null,
    );
    if (!result) {
      // Visit was missing, already terminal, or cross-tenant; map
      // to 404 from the caller's perspective.
      throw createError(404, "Lead visit not found or not in an open state");
    }

    const dto = await fetchLeadVisitDtoById(companyId, visitId);
    res.json({
      visit: dto,
      leadTransitioned: result.leadTransitioned,
    });
  }),
);

/**
 * POST /api/tech/lead-visits/:visitId/notes
 *
 * Add a note to the parent lead, attributed to the tech. Stored in
 * the canonical `lead_notes` table (same surface as office notes —
 * no second notes system). Attachments go through the standard R2
 * pipeline using `FileEntityType="lead_note"` once the canonical
 * file flow is wired (Step 4-5 of this PR).
 */
const addNoteBodySchema = z.object({
  noteText: z.string().min(1).max(5000),
});

router.post(
  "/:visitId/notes",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const user = req.user as any;
    const { visitId } = req.params;

    const visit = await assertCanAccessLeadVisit(
      companyId,
      user.id,
      user.role ?? "technician",
      visitId,
    );

    const body = addNoteBodySchema.parse(req.body ?? {});
    const inserted = await db
      .insert(leadNotes)
      .values({
        companyId,
        leadId: visit.leadId,
        userId: user.id,
        noteText: body.noteText,
      })
      .returning();
    res.status(201).json(inserted[0]);
  }),
);

export default router;
