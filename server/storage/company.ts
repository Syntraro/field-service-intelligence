import { db } from "../db";
import { eq } from "drizzle-orm";
import { companies, companySettings } from "@shared/schema";
import { BaseRepository } from "./base";
import { cache, CacheKeys, CacheTTL } from "../services/cache";
import { DEFAULT_TIMEZONE, isValidTimezone } from "../domain/scheduling";

export class CompanyRepository extends BaseRepository {
  /**
   * Get company settings (with caching)
   */
  async getCompanySettings(companyId: string) {
    // Try cache first
    const cacheKey = CacheKeys.companySettings(companyId);
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Cache miss - query database
    const rows = await db
      .select()
      .from(companySettings)
      .where(eq(companySettings.companyId, companyId))
      .limit(1);

    const result = rows[0] ?? null;

    // Cache for 30 minutes (settings rarely change)
    cache.set(cacheKey, result, CacheTTL.LONG);

    return result;
  }

  /**
   * Upsert company settings (invalidates cache).
   *
   * Canonical source of truth for the tenant's display name is
   * `company_settings.companyName`. Historically, `companies.name` was
   * written at signup-time and never updated afterwards, which caused
   * drift (legacy rows held email-derived placeholders like
   * "<email>'s Company" while settings held the real name).
   *
   * 2026-04-16 write-through: whenever the settings payload includes a
   * non-empty `companyName`, mirror the change to `companies.name` in the
   * same transaction so the two stay aligned. Platform Ops queries can
   * then read either column with confidence.
   */
  async upsertCompanySettings(companyId: string, userId: string, settings: any) {
    const existing = await this.getCompanySettings(companyId);

    const result = await db.transaction(async (tx) => {
      let row;
      if (existing) {
        const [updated] = await tx
          .update(companySettings)
          .set({ ...settings, updatedAt: new Date().toISOString() })
          .where(eq(companySettings.companyId, companyId))
          .returning();
        row = updated;
      } else {
        const [created] = await tx
          .insert(companySettings)
          .values({
            companyId,
            userId,
            ...settings,
          })
          .returning();
        row = created;
      }

      // Write-through to companies.name. Only fires when the caller
      // explicitly sent a non-empty companyName — preserves existing
      // companies.name when the settings update is about other fields.
      const nextName = typeof settings?.companyName === "string"
        ? settings.companyName.trim()
        : null;
      if (nextName) {
        await tx
          .update(companies)
          .set({ name: nextName })
          .where(eq(companies.id, companyId));
      }

      return row;
    });

    // CRITICAL: Invalidate cache after update
    cache.delete(CacheKeys.companySettings(companyId));

    return result;
  }

  /**
   * Get company timezone for scheduling operations.
   * Returns DEFAULT_TIMEZONE if not set or invalid.
   *
   * @param companyId - Company ID
   * @returns IANA timezone string (e.g., "America/Toronto")
   */
  async getCompanyTimezone(companyId: string): Promise<string> {
    const settings = await this.getCompanySettings(companyId);
    const timezone = (settings as { timezone?: string } | null)?.timezone;

    // Validate and return timezone, fallback to default
    if (timezone && isValidTimezone(timezone)) {
      return timezone;
    }

    return DEFAULT_TIMEZONE;
  }

  /**
   * Get impersonation status (placeholder for now)
   */
  async getImpersonationStatus(companyId: string, userId: string) {
    // This would check if the user is currently being impersonated
    // For now, return a default response
    return {
      isImpersonating: false,
      platformAdminId: null,
      targetUserId: null,
    };
  }
}

export const companyRepository = new CompanyRepository();