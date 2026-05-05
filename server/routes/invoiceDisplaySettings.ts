/**
 * Invoice Display Settings route (2026-05-05)
 *
 * Tenant-level visibility policy for customer-facing invoice surfaces
 * (PDF, email, client portal). Reads/writes the canonical columns on
 * `company_settings` added by migration `2026_05_05_invoice_display_settings.sql`.
 *
 * Why a dedicated route (vs. shoehorning into `/api/company-settings`):
 *   * The settings page UI is built around this slice — separate
 *     endpoint means the page only loads / saves the fields it needs.
 *   * Validation surface is tight: 17 booleans + one bounded text
 *     field, no need to mix with regional-format / timezone keys.
 *   * The umbrella `/api/company-settings` route also accepts these
 *     keys (PREFERENCE_KEYS in `storage/company.ts`) so existing
 *     bulk-save callers keep working — this route is purely additive.
 */
import { Router } from "express";
import type { Response } from "express";
import { z } from "zod";
import { storage } from "../storage/index";
import { requireRole } from "../auth/requireRole";
import { RESTRICTED_MANAGER_ROLES } from "../auth/roles";
import { requirePermission } from "../permissions";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { AuthedRequest } from "../auth/tenantIsolation";
import {
  DEFAULT_TENANT_INVOICE_DISPLAY_SETTINGS,
  type TenantInvoiceDisplaySettings,
} from "@shared/invoiceDisplayPolicy";

const router = Router();

// Bounded enough to avoid abusive PDF-blowing payloads, generous
// enough for legitimate multi-paragraph payment-instruction blocks.
const CLIENT_MESSAGE_MAX_LENGTH = 2000;

const updateInvoiceDisplaySettingsSchema = z.object({
  invoiceShowLogo: z.boolean().optional(),
  invoiceShowCompanyAddress: z.boolean().optional(),
  invoiceShowCompanyPhone: z.boolean().optional(),
  invoiceShowCompanyEmail: z.boolean().optional(),
  invoiceShowCompanyWebsite: z.boolean().optional(),
  invoiceShowTaxNumber: z.boolean().optional(),
  invoiceShowBillingAddress: z.boolean().optional(),
  invoiceShowServiceAddress: z.boolean().optional(),
  invoiceShowLocationName: z.boolean().optional(),
  invoiceShowJobNumber: z.boolean().optional(),
  invoiceShowSummary: z.boolean().optional(),
  invoiceShowJobDescription: z.boolean().optional(),
  invoiceShowClientMessage: z.boolean().optional(),
  invoiceDefaultClientMessage: z
    .string()
    .max(CLIENT_MESSAGE_MAX_LENGTH)
    .nullable()
    .optional(),
  invoiceShowLineItems: z.boolean().optional(),
  invoiceShowQuantities: z.boolean().optional(),
  invoiceShowUnitPrices: z.boolean().optional(),
  invoiceShowLineTotals: z.boolean().optional(),
});

const SETTING_KEYS = [
  "invoiceShowLogo",
  "invoiceShowCompanyAddress",
  "invoiceShowCompanyPhone",
  "invoiceShowCompanyEmail",
  "invoiceShowCompanyWebsite",
  "invoiceShowTaxNumber",
  "invoiceShowBillingAddress",
  "invoiceShowServiceAddress",
  "invoiceShowLocationName",
  "invoiceShowJobNumber",
  "invoiceShowSummary",
  "invoiceShowJobDescription",
  "invoiceShowClientMessage",
  "invoiceDefaultClientMessage",
  "invoiceShowLineItems",
  "invoiceShowQuantities",
  "invoiceShowUnitPrices",
  "invoiceShowLineTotals",
] as const;

type SettingKey = (typeof SETTING_KEYS)[number];

/**
 * Build the response. Pre-migration rows / null fields fall back to
 * the schema defaults so the UI always has a populated form.
 */
async function buildResponse(companyId: string): Promise<TenantInvoiceDisplaySettings> {
  const settings = await storage.getCompanySettings(companyId);
  const out: Record<string, unknown> = {};
  const D = DEFAULT_TENANT_INVOICE_DISPLAY_SETTINGS;
  for (const key of SETTING_KEYS) {
    const raw = (settings as Record<string, unknown> | null)?.[key];
    if (raw === undefined || raw === null) {
      // For the text field, hand back null (matches the column's nullable shape)
      out[key] = key === "invoiceDefaultClientMessage" ? null : (D as Record<string, unknown>)[key];
    } else {
      out[key] = raw;
    }
  }
  return out as TenantInvoiceDisplaySettings;
}

router.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    if (!companyId) throw createError(401, "Unauthorized");
    res.json(await buildResponse(companyId));
  }),
);

router.put(
  "/",
  requireRole(RESTRICTED_MANAGER_ROLES),
  requirePermission("settings.manage"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const userId = req.user?.id;
    if (!companyId || !userId) throw createError(401, "Unauthorized");

    const validation = updateInvoiceDisplaySettingsSchema.safeParse(req.body);
    if (!validation.success) {
      const errors = validation.error.errors
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join(", ");
      throw createError(400, `Validation failed: ${errors}`);
    }

    const data = validation.data;
    const update: Record<string, unknown> = {};
    for (const key of SETTING_KEYS) {
      if (data[key as SettingKey] !== undefined) {
        // Normalize empty string -> null on the text field so the
        // prefill resolver treats "blank" and "unset" the same.
        if (key === "invoiceDefaultClientMessage") {
          const v = data.invoiceDefaultClientMessage;
          update[key] = typeof v === "string" && v.trim().length === 0 ? null : v;
        } else {
          update[key] = data[key as SettingKey];
        }
      }
    }

    if (Object.keys(update).length > 0) {
      await storage.upsertCompanySettings(companyId, userId, update);
    }

    res.json(await buildResponse(companyId));
  }),
);

export default router;
