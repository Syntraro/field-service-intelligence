/**
 * Company Tax Registrations — route (2026-05-03).
 *
 * Tenant-level multi-row tax registration identity for customer-facing
 * invoices. Two endpoints:
 *
 *   GET  /api/company-tax-registrations
 *     → { registrations: Array<{ id, label, number, sortOrder }> }
 *
 *   PUT  /api/company-tax-registrations
 *     body: { registrations: Array<{ label?, number }> }
 *     → { registrations: <same shape as GET, post-write> }
 *
 * Replace-all semantic on PUT: every existing row for the tenant is
 * deleted and the supplied list is inserted with sort_order = 0..N-1
 * in input order. Empty input list → no rows for the tenant (PDF
 * renders no tax-registration lines, matching the existing-tenant
 * default).
 *
 * `requireAuth` + `ensureTenantContext` are applied globally in
 * `routes/index.ts`, so this router only needs to gate write access
 * via `requireRole`.
 */

import { Router } from "express";
import type { Response } from "express";
import { z } from "zod";
import { requireRole } from "../auth/requireRole";
import { RESTRICTED_MANAGER_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { AuthedRequest } from "../auth/tenantIsolation";
import { companyTaxRegistrationRepository } from "../storage/companyTaxRegistrations";

const router = Router();

// Each row: optional label, required (non-blank after trim) number.
// Length caps mirror the legacy single-pair schema (50 / 100).
// Format is intentionally NOT constrained — international
// registration formats vary widely (CRA business numbers, UK VAT,
// US EIN, AU ABN, etc.).
const tenantTaxRegistrationItemSchema = z.object({
  label: z.string().max(50).optional().nullable(),
  number: z.string().min(1, "Tax ID number is required").max(100),
});

// Per-PUT cap. Keeps the replace-all transaction tiny and prevents
// pathological payloads. Real-world tenants will use 1–3 entries.
const MAX_TAX_REGISTRATIONS_PER_TENANT = 10;

const replaceTaxRegistrationsSchema = z.object({
  registrations: z
    .array(tenantTaxRegistrationItemSchema)
    .max(
      MAX_TAX_REGISTRATIONS_PER_TENANT,
      `At most ${MAX_TAX_REGISTRATIONS_PER_TENANT} tax registrations`,
    ),
});

router.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    if (!companyId) throw createError(401, "Unauthorized");

    const registrations = await companyTaxRegistrationRepository.list(companyId);
    res.json({ registrations });
  }),
);

router.put(
  "/",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    if (!companyId) throw createError(401, "Unauthorized");

    const validation = replaceTaxRegistrationsSchema.safeParse(req.body);
    if (!validation.success) {
      const errors = validation.error.errors
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join(", ");
      throw createError(400, `Validation failed: ${errors}`);
    }

    const registrations = await companyTaxRegistrationRepository.replace(
      companyId,
      validation.data.registrations,
    );
    res.json({ registrations });
  }),
);

export default router;
