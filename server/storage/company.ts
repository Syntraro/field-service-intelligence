import { db } from "../db";
import { eq } from "drizzle-orm";
import { companySettings } from "@shared/schema";
import { BaseRepository } from "./base";
import { cache, CacheKeys, CacheTTL } from "../services/cache";

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
   * Upsert company settings (invalidates cache)
   */
  async upsertCompanySettings(companyId: string, settings: any) {
    const existing = await this.getCompanySettings(companyId);

    let result;
    if (existing) {
      const [updated] = await db
        .update(companySettings)
        .set({ ...settings, updatedAt: new Date().toISOString() })
        .where(eq(companySettings.companyId, companyId))
        .returning();

      result = updated;
    } else {
      const [created] = await db
        .insert(companySettings)
        .values({
          companyId,
          userId: companyId, // TODO: Pass actual userId
          ...settings,
        })
        .returning();

      result = created;
    }

    // CRITICAL: Invalidate cache after update
    cache.delete(CacheKeys.companySettings(companyId));

    return result;
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