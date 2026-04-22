import { Router } from "express";
import type { Response } from "express";
import { storage } from "../storage/index";
import { companyRepository } from "../storage/company";
import { z } from "zod";
import { postalCodeSchema } from "@shared/schema";
import { requireRole } from "../auth/requireRole";
import { RESTRICTED_MANAGER_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { AuthedRequest } from "../auth/tenantIsolation";

// Note: requireAuth and ensureTenantContext middleware already applied globally in routes/index.ts
const router = Router();

// ========================================
// VALIDATION SCHEMAS
// ========================================

// 2026-04-19 Profile consolidation (Phase 1): the umbrella request schema
// accepts both profile keys (routed to `companies`) and preference keys
// (routed to `company_settings`). The handler partitions them; this
// schema only enforces shape/length/format on every accepted field.
//
// Removed silent-drop fields (`currency`, `defaultTaxRate`, `businessHours`,
// `invoiceSettings.{showCompanyLogo,footer}`) — they had no DB column and
// were never persisted. The frontend does not send them today.
const updateCompanySettingsSchema = z.object({
  // Profile keys → companies
  companyName: z.string().min(1).max(200).optional(),
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  provinceState: z.string().max(100).optional(),
  postalCode: postalCodeSchema,
  email: z.string().email().max(255).optional().or(z.literal("")),
  phone: z.string().max(30).optional(),
  // Preference keys → company_settings
  timezone: z.string().max(100).optional(),
  calendarStartHour: z.number().int().min(0).max(23).optional(),
  dateFormat: z.enum(["MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD"]).optional(),
  timeFormat: z.enum(["12h", "24h"]).optional(),
  weekStartsOn: z.enum(["monday", "sunday"]).optional(),
  // invoice payment terms default — kept here for backward-compat with the
  // existing `invoiceSettings.defaultTermsDays` shape used by TaxBillingRulesPage
  invoiceSettings: z.object({
    defaultTermsDays: z.number().int().min(0).max(365).optional(),
  }).optional(),
  defaultPaymentTermsDays: z.number().int().min(0).max(365).optional(),
  // 2026-04-21 Phase 3: invoice reminder cadence (moved from the legacy
  // tenant_features table — functional config, not policy).
  invoiceRemindersEnabled: z.boolean().optional(),
  invoiceReminderFirstDelayDays: z.number().int().min(1).max(90).optional(),
  invoiceReminderRepeatEveryDays: z.number().int().min(1).max(90).optional(),
});

const PROFILE_KEYS = [
  "companyName",
  "address",
  "city",
  "provinceState",
  "postalCode",
  "email",
  "phone",
] as const;

const PREFERENCE_KEYS = [
  "timezone",
  "calendarStartHour",
  "dateFormat",
  "timeFormat",
  "weekStartsOn",
  "defaultPaymentTermsDays",
  "timezoneConfirmedAt",
  // 2026-04-21 Phase 3: invoice reminder cadence lives here now.
  "invoiceRemindersEnabled",
  "invoiceReminderFirstDelayDays",
  "invoiceReminderRepeatEveryDays",
] as const;

type ProfileKey = (typeof PROFILE_KEYS)[number];
type PreferenceKey = (typeof PREFERENCE_KEYS)[number];

/**
 * Build the merged response shape that both GET and PUT/POST return.
 *
 * Profile fields come from `companies` (canonical owner as of 2026-04-19);
 * preferences come from `company_settings`. Older clients that read
 * `companyName`, `address`, etc. off the response see no change in the
 * field names or location — the handler stitches the two sources together.
 */
async function buildSettingsResponse(companyId: string) {
  const [profile, settings] = await Promise.all([
    companyRepository.getCompanyProfile(companyId),
    storage.getCompanySettings(companyId),
  ]);

  const prefs: Record<string, unknown> = {};
  if (settings && typeof settings === "object") {
    for (const key of PREFERENCE_KEYS) {
      if (key in (settings as Record<string, unknown>)) {
        prefs[key] = (settings as Record<string, unknown>)[key];
      }
    }
  }

  return {
    ...prefs,
    ...(profile ?? {}),
    timezoneConfirmed: Boolean((settings as { timezoneConfirmedAt?: unknown } | null)?.timezoneConfirmedAt),
  };
}

router.get("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  if (!companyId) throw createError(401, "Unauthorized");
  res.json(await buildSettingsResponse(companyId));
}));

// Handler for both PUT and POST (upsert)
const handleUpsertSettings = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const userId = req.user?.id;
  if (!companyId || !userId) throw createError(401, "Unauthorized");

  const validation = updateCompanySettingsSchema.safeParse(req.body);
  if (!validation.success) {
    const errors = validation.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw createError(400, `Validation failed: ${errors}`);
  }

  const data = validation.data ?? {};

  // Partition payload by canonical owner.
  const profileUpdate: Record<string, unknown> = {};
  for (const key of PROFILE_KEYS) {
    if (data[key as ProfileKey] !== undefined) {
      profileUpdate[key] = data[key as ProfileKey];
    }
  }

  const prefUpdate: Record<string, unknown> = {};
  for (const key of PREFERENCE_KEYS) {
    if ((data as Record<string, unknown>)[key] !== undefined) {
      prefUpdate[key] = (data as Record<string, unknown>)[key];
    }
  }
  // Backward-compat: TaxBillingRulesPage still posts the legacy nested
  // `invoiceSettings.defaultTermsDays` shape — flatten it onto the
  // canonical preference key.
  if (data.invoiceSettings?.defaultTermsDays !== undefined && prefUpdate.defaultPaymentTermsDays === undefined) {
    prefUpdate.defaultPaymentTermsDays = data.invoiceSettings.defaultTermsDays;
  }
  // Auto-stamp timezoneConfirmedAt when timezone is explicitly set.
  if (prefUpdate.timezone) {
    prefUpdate.timezoneConfirmedAt = new Date();
  }

  const writes: Promise<unknown>[] = [];
  if (Object.keys(profileUpdate).length > 0) {
    writes.push(companyRepository.updateCompanyProfile(companyId, profileUpdate));
  }
  if (Object.keys(prefUpdate).length > 0) {
    writes.push(storage.upsertCompanySettings(companyId, userId, prefUpdate));
  }
  await Promise.all(writes);

  res.json(await buildSettingsResponse(companyId));
});

router.put("/", requireRole(RESTRICTED_MANAGER_ROLES), handleUpsertSettings);
router.post("/", requireRole(RESTRICTED_MANAGER_ROLES), handleUpsertSettings);

export default router;
