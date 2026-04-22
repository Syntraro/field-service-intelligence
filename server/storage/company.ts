import { db } from "../db";
import { eq } from "drizzle-orm";
import { companies, companySettings } from "@shared/schema";
import { BaseRepository } from "./base";
import { cache, CacheKeys, CacheTTL } from "../services/cache";
import { DEFAULT_TIMEZONE, isValidTimezone } from "../domain/scheduling";

// 2026-04-19 Profile consolidation (Phase 1): canonical owner of profile
// fields is now `companies`. `company_settings` keeps preferences only.
// The seven keys below are what `upsertCompanySettings` is allowed to write
// — anything else is dropped server-side so callers can't reintroduce drift.
const PREFERENCE_KEYS = new Set([
  "timezone",
  "timezoneConfirmedAt",
  "dateFormat",
  "timeFormat",
  "weekStartsOn",
  "calendarStartHour",
  "defaultPaymentTermsDays",
  // 2026-04-21 Phase 3: invoice reminder cadence moved here from the legacy
  // tenant_features table. These are tenant configuration, not policy.
  "invoiceRemindersEnabled",
  "invoiceReminderFirstDelayDays",
  "invoiceReminderRepeatEveryDays",
]);

export interface CompanyProfile {
  companyName: string;
  address: string | null;
  city: string | null;
  provinceState: string | null;
  postalCode: string | null;
  email: string | null;
  phone: string | null;
}

export interface UpdateCompanyProfileInput {
  companyName?: string;
  address?: string | null;
  city?: string | null;
  provinceState?: string | null;
  postalCode?: string | null;
  email?: string | null;
  phone?: string | null;
}

export class CompanyRepository extends BaseRepository {
  /**
   * Get company profile (name + contact fields) from the canonical
   * `companies` row. Returned shape uses `companyName` (not `name`) to keep
   * the existing `/api/company-settings` API contract stable for the
   * frontend after the 2026-04-19 split.
   */
  async getCompanyProfile(companyId: string): Promise<CompanyProfile | null> {
    const rows = await db
      .select({
        name: companies.name,
        address: companies.address,
        city: companies.city,
        provinceState: companies.provinceState,
        postalCode: companies.postalCode,
        email: companies.email,
        phone: companies.phone,
      })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    return {
      companyName: row.name,
      address: row.address ?? null,
      city: row.city ?? null,
      provinceState: row.provinceState ?? null,
      postalCode: row.postalCode ?? null,
      email: row.email ?? null,
      phone: row.phone ?? null,
    };
  }

  /**
   * Update the canonical `companies` profile fields. Translates the
   * external `companyName` key onto `companies.name`. Empty/whitespace
   * input on `companyName` is rejected (column is NOT NULL); for the
   * other fields, an empty string is normalized to NULL.
   */
  async updateCompanyProfile(
    companyId: string,
    input: UpdateCompanyProfileInput,
  ): Promise<CompanyProfile | null> {
    const updates: Record<string, unknown> = {};

    if (input.companyName !== undefined) {
      const trimmed = (input.companyName ?? "").trim();
      if (trimmed.length === 0) {
        // companies.name is NOT NULL — refuse rather than corrupt the row.
        throw new Error("companyName cannot be empty");
      }
      updates.name = trimmed;
    }

    const optionalKeys: Array<keyof UpdateCompanyProfileInput> = [
      "address", "city", "provinceState", "postalCode", "email", "phone",
    ];
    for (const key of optionalKeys) {
      if (input[key] !== undefined) {
        const raw = input[key];
        const next =
          typeof raw === "string" && raw.trim().length === 0 ? null : raw;
        updates[key] = next;
      }
    }

    if (Object.keys(updates).length === 0) {
      return this.getCompanyProfile(companyId);
    }

    await db
      .update(companies)
      .set(updates)
      .where(eq(companies.id, companyId));

    return this.getCompanyProfile(companyId);
  }

  /**
   * Get company settings (with caching).
   *
   * 2026-04-19 (Phase 1): the row may still physically contain duplicated
   * profile columns until the Phase 2 migration drops them. Callers must
   * read profile fields via `getCompanyProfile` and treat this row as
   * preferences-only.
   */
  async getCompanySettings(companyId: string): Promise<typeof companySettings.$inferSelect | null> {
    const cacheKey = CacheKeys.companySettings(companyId);
    // 2026-04-22 bug fix: `cache.get` returns `null` for BOTH cache-miss and
    // explicit-null-cached. The prior `cached !== undefined` check therefore
    // short-circuited every cold-cache call to `null`, so the DB query was
    // never reached. Effect: GET /api/company-settings omitted `timezone` /
    // `timezoneConfirmedAt` from the response (null settings → loop skipped
    // in the route's `buildSettingsResponse`), which made the TimezoneSetup
    // dialog show for already-onboarded tenants. PUT then also failed: the
    // upsert below re-read null from the same broken path, took the INSERT
    // branch, and hit `company_settings_company_id_unique`. Fix: treat null
    // from cache as a miss (matching the `if (cached)` pattern used by the
    // other `cache.get` caller in storage/team.ts) and only cache non-null
    // reads. Rare callers with a genuinely empty settings row pay one DB
    // round-trip per call — acceptable; onboarding seeds the row.
    const cached = cache.get<typeof companySettings.$inferSelect>(cacheKey);
    if (cached) {
      return cached;
    }

    const rows = await db
      .select()
      .from(companySettings)
      .where(eq(companySettings.companyId, companyId))
      .limit(1);

    const result = rows[0] ?? null;
    if (result) {
      cache.set(cacheKey, result, CacheTTL.LONG);
    }
    return result;
  }

  /**
   * Upsert company **preferences** (timezone, regional formats, calendar
   * start hour, default payment terms). 2026-04-19 (Phase 1): all profile
   * keys (companyName, address, city, provinceState, postalCode, email,
   * phone) are filtered out here — they belong on `companies`. The route
   * layer is responsible for routing those keys to `updateCompanyProfile`.
   *
   * The 2026-04-16 write-through to `companies.name` has been removed:
   * with `companies` now canonical, there is nothing to mirror back.
   */
  async upsertCompanySettings(companyId: string, userId: string, settings: any) {
    const filtered: Record<string, unknown> = {};
    if (settings && typeof settings === "object") {
      for (const [key, value] of Object.entries(settings)) {
        if (PREFERENCE_KEYS.has(key)) {
          filtered[key] = value;
        }
      }
    }

    const existing = await this.getCompanySettings(companyId);

    let row;
    if (existing) {
      // No-op update if no preference keys were sent — still touch
      // updatedAt to surface "settings save" semantics in the route's
      // response shape.
      const [updated] = await db
        .update(companySettings)
        .set({ ...filtered, updatedAt: new Date().toISOString() })
        .where(eq(companySettings.companyId, companyId))
        .returning();
      row = updated;
    } else {
      const [created] = await db
        .insert(companySettings)
        .values({
          companyId,
          userId,
          ...filtered,
        })
        .returning();
      row = created;
    }

    cache.delete(CacheKeys.companySettings(companyId));
    return row;
  }

  /**
   * Get company timezone for scheduling operations.
   * Returns DEFAULT_TIMEZONE if not set or invalid.
   */
  async getCompanyTimezone(companyId: string): Promise<string> {
    const settings = await this.getCompanySettings(companyId);
    const timezone = (settings as { timezone?: string } | null)?.timezone;

    if (timezone && isValidTimezone(timezone)) {
      return timezone;
    }

    return DEFAULT_TIMEZONE;
  }

  /**
   * Get impersonation status (placeholder for now)
   */
  async getImpersonationStatus(companyId: string, userId: string) {
    return {
      isImpersonating: false,
      platformAdminId: null,
      targetUserId: null,
    };
  }
}

export const companyRepository = new CompanyRepository();
