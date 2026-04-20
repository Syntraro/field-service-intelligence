import { Router } from "express";
import type { Response } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { companies } from "@shared/schema";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { AuthedRequest } from "../auth/tenantIsolation";
import { storage } from "../storage/index";

/**
 * 2026-04-19 Hybrid SaaS — tenant onboarding state.
 *
 * Minimal API:
 *  - GET  /api/onboarding/state     -> derived step-completion snapshot
 *  - POST /api/onboarding/complete  -> stamps companies.onboarding_completed_at
 *
 * Timezone is the single required step. Business hours were removed from
 * required onboarding in the 2026-04-19 staged-signup sprint and are now
 * seeded silently in server/services/onboardingService.ts.
 *
 * Only the `owner` role may complete onboarding. Invitees never hit this
 * router in practice (client guard only redirects owners) but server-side
 * we enforce role anyway.
 */

const router = Router();

router.get(
  "/state",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    if (!companyId) throw createError(401, "Unauthorized");

    const company = await storage.getCompanyById(companyId);
    if (!company) throw createError(404, "Company not found");

    // Timezone — canonical source is company_settings.timezoneConfirmedAt
    // (also powers the legacy TimezoneSetupDialog for non-onboarding paths).
    const settings = (await storage.getCompanySettings(companyId)) as
      | { timezone?: string; timezoneConfirmedAt?: Date | null }
      | null;
    const timezoneDone = Boolean(settings?.timezoneConfirmedAt);

    res.json({
      completed: Boolean(company.onboardingCompletedAt),
      completedAt: company.onboardingCompletedAt ?? null,
      steps: {
        timezone: {
          done: timezoneDone,
          value: settings?.timezone ?? null,
        },
      },
    });
  }),
);

router.post(
  "/complete",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const user = req.user;
    if (!companyId || !user) throw createError(401, "Unauthorized");

    // Only the owner of this company may finalize onboarding.
    if (user.role !== "owner") {
      throw createError(403, "Only the company owner can complete onboarding");
    }

    // Blocking requirement: timezone must be confirmed before we stamp.
    // Business hours are NOT part of required onboarding — they are
    // seeded silently in onboardingService.createCompanyWithOwner and
    // are optional to edit.
    const settings = (await storage.getCompanySettings(companyId)) as
      | { timezoneConfirmedAt?: Date | null }
      | null;
    if (!settings?.timezoneConfirmedAt) {
      throw createError(400, "Please confirm your timezone to finish onboarding");
    }

    // Idempotent: if already completed, return the existing timestamp.
    const company = await storage.getCompanyById(companyId);
    if (!company) throw createError(404, "Company not found");
    if (company.onboardingCompletedAt) {
      return res.json({ completedAt: company.onboardingCompletedAt });
    }

    const [updated] = await db
      .update(companies)
      .set({ onboardingCompletedAt: new Date() })
      .where(and(eq(companies.id, companyId)))
      .returning({ onboardingCompletedAt: companies.onboardingCompletedAt });

    res.json({ completedAt: updated?.onboardingCompletedAt ?? null });
  }),
);

export default router;
