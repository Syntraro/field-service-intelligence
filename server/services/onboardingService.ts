import { db } from "../db";
import {
  companies,
  users,
  userIdentities,
  companySettings,
  companyBusinessHours,
} from "@shared/schema";
import type { User, Company } from "@shared/schema";
import { createError } from "../middleware/errorHandler";

/**
 * Hybrid SaaS onboarding — public self-serve path.
 *
 * Owns the single transactional creation of:
 *   companies row
 *    ->  users row (owner)
 *    ->  user_identities row (email)
 *    ->  company_settings row (preferences only — timezone, regional
 *        formats, calendar start hour. Profile fields live on `companies`
 *        per the 2026-04-19 consolidation; see server/storage/company.ts)
 *
 * Kept out of the existing repositories on purpose: those repos write with
 * the module-level db client and are used by both invite and admin paths.
 * Wrapping all inserts in one `db.transaction` here is the surgical way
 * to satisfy "single transaction for company + owner + membership" without
 * forking the invite flow or adding a parallel createUser path.
 */

/** 2026-04-19 Hybrid SaaS: trial length for new self-serve tenants. */
export const TRIAL_DAYS = 14;

export interface CreateCompanyWithOwnerInput {
  companyName?: string;   // 2026-04-19: optional on public signup
  companyPhone?: string;  // 2026-04-19: optional on public signup
  firstName: string;
  lastName: string;
  email: string;          // must be already lowercased / trimmed by caller
  passwordHash: string;   // bcrypt hash
}

export interface CreateCompanyWithOwnerResult {
  user: User;
  company: Company;
}

/**
 * Fallback display name when the owner doesn't provide a business name
 * on public signup. Format: "<First> <Last>" (e.g. "John Smith").
 * Belt-and-suspenders only — upstream requires firstName + lastName.
 */
function deriveCompanyDisplayName(firstName: string, lastName: string): string {
  const fn = firstName.trim();
  const ln = lastName.trim();
  const combined = [fn, ln].filter(Boolean).join(" ");
  return combined || "My Business";
}

export async function createCompanyWithOwner(
  input: CreateCompanyWithOwnerInput,
): Promise<CreateCompanyWithOwnerResult> {
  const { companyName, companyPhone, firstName, lastName, email, passwordHash } = input;

  const resolvedName = companyName?.trim() || deriveCompanyDisplayName(firstName, lastName);
  const resolvedPhone = companyPhone?.trim() || null;

  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  try {
    return await db.transaction(async (tx) => {
      const [company] = await tx
        .insert(companies)
        .values({
          name: resolvedName,
          phone: resolvedPhone,
          subscriptionStatus: "trial",
          // 2026-04-19 trial provisioning fix: write the canonical plan
          // identifier explicitly so `subscriptionRepository.getSubscriptionUsage`
          // resolves it via the primary path (`companies.subscription_plan`
          // → `subscription_plans.name`). The previous implementation
          // relied on a silent resolver fallback that broke the moment
          // the seeded `subscription_plans` row was missing — see the
          // accompanying reseed + backfill migrations.
          subscriptionPlan: "trial",
          trialEndsAt,
        })
        .returning();

      const [user] = await tx
        .insert(users)
        .values({
          companyId: company.id,
          email,
          password: passwordHash,
          role: "owner",
          firstName,
          lastName,
          status: "active",
        })
        .returning();

      await tx.insert(userIdentities).values({
        companyId: company.id,
        userId: user.id,
        provider: "email",
        identifier: email,
        passwordHash,
        verifiedAt: new Date(),
      });

      // 2026-04-19 Profile consolidation: `companies` is canonical for
      // name/phone/email/address — no profile fields are seeded into
      // `company_settings` anymore. We still insert a settings row so the
      // schema-level preference defaults (timezone, dateFormat, timeFormat,
      // weekStartsOn, calendarStartHour, defaultPaymentTermsDays) materialize
      // for the new tenant on first GET /api/company-settings.
      await tx.insert(companySettings).values({
        companyId: company.id,
        userId: user.id,
      });

      // 2026-04-19 staged onboarding: silently seed default business
      // hours (Mon–Fri 08:00–17:00, Sat/Sun closed). Business hours are
      // NOT part of required onboarding anymore — the owner can edit
      // them later in Settings. Plain insert is safe here because this
      // is the only creation path for the company row and no other
      // writer can have inserted for this companyId inside this tx.
      // Callers other than public signup MUST NOT use this service
      // without reviewing this seed (it is public-signup-only today).
      const OPEN_START = 8 * 60;   // 08:00
      const OPEN_END = 17 * 60;    // 17:00
      await tx.insert(companyBusinessHours).values([
        { companyId: company.id, dayOfWeek: 0, isOpen: false, startMinutes: null, endMinutes: null },
        { companyId: company.id, dayOfWeek: 1, isOpen: true,  startMinutes: OPEN_START, endMinutes: OPEN_END },
        { companyId: company.id, dayOfWeek: 2, isOpen: true,  startMinutes: OPEN_START, endMinutes: OPEN_END },
        { companyId: company.id, dayOfWeek: 3, isOpen: true,  startMinutes: OPEN_START, endMinutes: OPEN_END },
        { companyId: company.id, dayOfWeek: 4, isOpen: true,  startMinutes: OPEN_START, endMinutes: OPEN_END },
        { companyId: company.id, dayOfWeek: 5, isOpen: true,  startMinutes: OPEN_START, endMinutes: OPEN_END },
        { companyId: company.id, dayOfWeek: 6, isOpen: false, startMinutes: null, endMinutes: null },
      ]);

      return { user, company };
    });
  } catch (err: any) {
    // Postgres unique_violation (race on users.email or user_identities index).
    // Collapse to the same 400 the pre-check raises so the client sees one error.
    if (err?.code === "23505") {
      throw createError(
        400,
        "This email is already in use. Each email can only belong to one company.",
      );
    }
    throw err;
  }
}
