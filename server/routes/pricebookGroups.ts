/**
 * Pricebook Groups API (2026-05-07 RALPH).
 *
 * Mounted at `/api/pricebook-groups`. Reads stay open (matches the
 * items route — the picker is a shared dependency for non-MANAGER
 * users creating jobs/invoices). Mutations gate on
 * `requireRole(MANAGER_ROLES)` + `requirePermission("pricing.edit")`,
 * mirroring the `/api/items` write contract.
 *
 * Endpoints
 * ---------
 *   GET    /api/pricebook-groups
 *           ?sort=most_used (default) | name
 *           Returns all active groups for the tenant with child item
 *           summaries (id, name, type, qty, price/cost, taxable,
 *           sortOrder) + itemCount + totalEstimate. Order goes
 *           through `pricebookUsageService.getMostUsedGroups`.
 *
 *   POST   /api/pricebook-groups
 *           Creates a new group + its children inside one transaction.
 *           Returns the full group summary (201). Name collision →
 *           409. Cross-tenant child item id → 400.
 *
 *   PATCH  /api/pricebook-groups/:id
 *           Updates name/description/icon/color and/or replaces
 *           children. Children replacement is DELETE+INSERT inside
 *           one transaction. Cross-tenant child id → 400. Name
 *           collision → 409.
 *
 *   DELETE /api/pricebook-groups/:id
 *           Hard-delete the group + its child rows (FK cascade).
 *           Underlying pricebook items (`items` table) are NOT
 *           affected. 2026-05-07 RALPH: replaced the prior soft-
 *           archive per product brief — there is no "unarchive" UX,
 *           the soft flag was orphan state.
 *
 *   POST   /api/pricebook-groups/:id/usage
 *           Body: { target: "job"|"quote"|"invoice"|..., targetId?,
 *                   delta? }
 *           Atomically increments `usage_count` via
 *           `pricebookUsageService.recordUsage`. Called from the
 *           picker's submit handler after a successful bulk-add. Idle
 *           when the group is archived / cross-tenant — never throws.
 */
import { Router, type Response } from "express";
import { z } from "zod";
import type { AuthedRequest } from "../auth/tenantIsolation";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { requirePermission } from "../permissions";
import {
  pricebookGroupRepository,
  PricebookGroupItemNotFoundError,
  PricebookGroupNameConflictError,
  type CreatePricebookGroupInput,
  type UpdatePricebookGroupInput,
} from "../storage/pricebookGroups";
import { pricebookUsageService } from "../services/pricebookUsage";

const router = Router();

// ─── Validation schemas ────────────────────────────────────────────

const groupChildSchema = z
  .object({
    itemId: z.string().uuid(),
    // Quantity arrives as a numeric string from the canonical line-
    // item mapper. Accept either a number or a string; the storage
    // layer expects a string for the NUMERIC column.
    // Quantity arrives as a numeric string OR number. `z.preprocess`
    // coerces to a string BEFORE validation runs, so the inferred OUTPUT
    // type is plain `string` (matches the storage layer's NUMERIC column
    // expectation).
    quantity: z.preprocess(
      (v) => (typeof v === "number" ? String(v) : v),
      z
        .string()
        .refine((v) => /^-?\d+(\.\d{1,2})?$/.test(v), {
          message: "quantity must be a numeric string with up to 2 decimals",
        }),
    ),
    sortOrder: z.number().int().min(0).max(9999).optional(),
  })
  .strict();

const createGroupSchema = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(500).optional().nullable(),
    color: z.string().max(32).optional().nullable(),
    icon: z.string().max(64).optional().nullable(),
    children: z.array(groupChildSchema).max(64).default([]),
  })
  .strict();

const updateGroupSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(500).optional().nullable(),
    color: z.string().max(32).optional().nullable(),
    icon: z.string().max(64).optional().nullable(),
    children: z.array(groupChildSchema).max(64).optional(),
  })
  .strict();

const recordUsageSchema = z
  .object({
    target: z
      .enum([
        "job",
        "quote",
        "invoice",
        "job_template",
        "quote_template",
        "pm_template",
      ])
      .default("job"),
    targetId: z.string().uuid().optional().nullable(),
    delta: z.number().int().min(1).max(100).optional(),
  })
  .strict();

const listQuerySchema = z
  .object({
    sort: z.enum(["most_used", "name"]).optional(),
  })
  .strict()
  .partial();

// ─── GET / ─────────────────────────────────────────────────────────

router.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    if (!companyId) throw createError(401, "Unauthorized");
    const parsed = validateSchema(listQuerySchema, req.query);
    const groups = await pricebookUsageService.getMostUsedGroups(companyId, {
      sort: parsed.sort ?? "most_used",
    });
    res.json(groups);
  }),
);

// ─── POST / ────────────────────────────────────────────────────────

router.post(
  "/",
  requireRole(MANAGER_ROLES),
  requirePermission("pricing.edit"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const userId = req.user?.id ?? null;
    if (!companyId) throw createError(401, "Unauthorized");
    const body = validateSchema(createGroupSchema, req.body);
    try {
      // Zod's preprocess on `quantity` outputs `string` at runtime but
      // the inferred TS type is `unknown` — pricebookGroupRepository.create
      // accepts a `quantity: string`, so we cast at the call boundary.
      const created = await pricebookGroupRepository.create(
        companyId,
        userId,
        body as unknown as CreatePricebookGroupInput,
      );
      res.status(201).json(created);
    } catch (err) {
      if (err instanceof PricebookGroupItemNotFoundError) {
        throw createError(400, err.message);
      }
      if (err instanceof PricebookGroupNameConflictError) {
        throw createError(409, err.message);
      }
      throw err;
    }
  }),
);

// ─── PATCH /:id ────────────────────────────────────────────────────

router.patch(
  "/:id",
  requireRole(MANAGER_ROLES),
  requirePermission("pricing.edit"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    if (!companyId) throw createError(401, "Unauthorized");
    const body = validateSchema(updateGroupSchema, req.body);
    try {
      const updated = await pricebookGroupRepository.update(
        companyId,
        req.params.id,
        body as unknown as UpdatePricebookGroupInput,
      );
      if (!updated) throw createError(404, "Pricebook group not found");
      res.json(updated);
    } catch (err) {
      if (err instanceof PricebookGroupItemNotFoundError) {
        throw createError(400, err.message);
      }
      if (err instanceof PricebookGroupNameConflictError) {
        throw createError(409, err.message);
      }
      throw err;
    }
  }),
);

// ─── DELETE /:id ───────────────────────────────────────────────────
//
// Hard-delete the group + its child rows. The migration declares
// `pricebook_group_items.group_id ON DELETE CASCADE`, so removing
// the parent group also removes its join rows in one statement. The
// underlying pricebook items (`items` table) are NEVER touched.
//
// 2026-05-07 RALPH: this used to call `pricebookGroupRepository
// .archive(...)` which flipped `is_active = false`. Soft-archive
// produced orphan state — no UI exposed un-archive — so v1 ships a
// hard delete. The only caller is the picker rail's delete dialog.

router.delete(
  "/:id",
  requireRole(MANAGER_ROLES),
  requirePermission("pricing.edit"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    if (!companyId) throw createError(401, "Unauthorized");
    const ok = await pricebookGroupRepository.hardDelete(
      companyId,
      req.params.id,
    );
    if (!ok) throw createError(404, "Pricebook group not found");
    res.json({ ok: true });
  }),
);

// ─── POST /:id/usage ───────────────────────────────────────────────
//
// Usage tracking is advisory — a missing increment never blocks a
// bulk-add. The route accepts the event, calls the canonical service,
// and returns 204. Reads stay open (no requireRole gate) so any
// authed user can record usage from the picker.

router.post(
  "/:id/usage",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    if (!companyId) throw createError(401, "Unauthorized");
    const body = validateSchema(recordUsageSchema, req.body ?? {});
    await pricebookUsageService.recordUsage({
      companyId,
      kind: "group",
      id: req.params.id,
      // Zod's `.default("job")` is supposed to narrow `target` to the enum,
      // but a `.strict()` object can leave the inferred field optional in
      // some TS / Zod combos. Defensive `?? "job"` here matches the schema
      // default so the call site always passes a concrete enum value.
      target: body.target ?? "job",
      targetId: body.targetId ?? null,
      delta: body.delta ?? 1,
    });
    res.status(204).end();
  }),
);

export default router;
