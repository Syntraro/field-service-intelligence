import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { 
  users, 
  technicianProfiles, 
  workingHours, 
  userPermissionOverrides 
} from "@shared/schema";
import { BaseRepository } from "./base";
import { cache, CacheKeys, CacheTTL } from "../services/cache";

export class TeamRepository extends BaseRepository {
  /**
   * Get team members for a company
   */
  async getTeamMembers(companyId: string) {
    return await db
      .select()
      .from(users)
      .where(and(eq(users.companyId, companyId), eq(users.disabled, false)))
      .orderBy(users.fullName);
  }

  /**
   * Get single team member
   */
  async getTeamMember(companyId: string, userId: string) {
    const rows = await db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), eq(users.companyId, companyId)))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Update team member
   */
  async updateTeamMember(
    companyId: string,
    userId: string,
    patch: {
      firstName?: string;
      lastName?: string;
      fullName?: string;
      phone?: string;
      roleId?: string;
      role?: string;
      status?: string;
      useCustomSchedule?: boolean;
    }
  ) {
    const rows = await db
      .update(users)
      .set(patch)
      .where(and(eq(users.id, userId), eq(users.companyId, companyId)))
      .returning();

    return rows[0] ?? null;
  }

  /**
   * Deactivate team member
   */
  async deactivateTeamMember(companyId: string, userId: string) {
    const rows = await db
      .update(users)
      .set({ status: "deactivated", disabled: true })
      .where(and(eq(users.id, userId), eq(users.companyId, companyId)))
      .returning();

    return rows[0] ?? null;
  }

  /**
   * Activate team member (sets status to active and clears disabled flag)
   */
  async activateTeamMember(companyId: string, userId: string) {
    const rows = await db
      .update(users)
      .set({ status: "active", disabled: false })
      .where(and(eq(users.id, userId), eq(users.companyId, companyId)))
      .returning();

    return rows[0] ?? null;
  }

  /**
   * Get technician profile
   */
  async getTechnicianProfile(userId: string) {
    const rows = await db
      .select()
      .from(technicianProfiles)
      .where(eq(technicianProfiles.userId, userId))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Upsert technician profile
   */
  async upsertTechnicianProfile(
    userId: string,
    profileData: {
      laborCostPerHour?: string;
      billableRatePerHour?: string;
      color?: string;
      phone?: string;
      note?: string;
    }
  ) {
    // Try to update first
    const existing = await this.getTechnicianProfile(userId);

    if (existing) {
      const rows = await db
        .update(technicianProfiles)
        .set({ ...profileData, updatedAt: new Date() })
        .where(eq(technicianProfiles.userId, userId))
        .returning();
      return rows[0];
    } else {
      const rows = await db
        .insert(technicianProfiles)
        .values({ userId, ...profileData })
        .returning();
      return rows[0];
    }
  }

  /**
   * Get working hours for a user
   */
  async getWorkingHours(userId: string) {
    return await db
      .select()
      .from(workingHours)
      .where(eq(workingHours.userId, userId))
      .orderBy(workingHours.dayOfWeek);
  }

  /**
   * Set working hours (replace all)
   */
  async setWorkingHours(
    userId: string,
    hours: Array<{
      dayOfWeek: number;
      startTime?: string | null;
      endTime?: string | null;
      isWorking: boolean;
    }>
  ) {
    return await db.transaction(async (tx) => {
      // Delete existing
      await tx.delete(workingHours).where(eq(workingHours.userId, userId));

      // Insert new
      if (hours.length > 0) {
        await tx.insert(workingHours).values(
          hours.map((h) => ({
            userId,
            dayOfWeek: h.dayOfWeek,
            startTime: h.startTime,
            endTime: h.endTime,
            isWorking: h.isWorking,
          }))
        );
      }

      return await tx
        .select()
        .from(workingHours)
        .where(eq(workingHours.userId, userId))
        .orderBy(workingHours.dayOfWeek);
    });
  }

  /**
   * Get user permission overrides (with caching)
   */
  async getUserPermissionOverrides(userId: string) {
    // Try cache first (permissions checked on every request!)
    const cacheKey = CacheKeys.userPermissions(userId);
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Cache miss - query database
    const result = await db
      .select()
      .from(userPermissionOverrides)
      .where(eq(userPermissionOverrides.userId, userId));

    // Cache for 5 minutes
    cache.set(cacheKey, result, CacheTTL.MEDIUM);

    return result;
  }

  /**
   * Set user permission overrides (replace all) - invalidates cache
   */
  async setUserPermissionOverrides(
    userId: string,
    overrides: Array<{ permissionId: string; override: "grant" | "revoke" }>
  ) {
    const result = await db.transaction(async (tx) => {
      // Delete existing
      await tx
        .delete(userPermissionOverrides)
        .where(eq(userPermissionOverrides.userId, userId));

      // Insert new
      if (overrides.length > 0) {
        await tx.insert(userPermissionOverrides).values(
          overrides.map((o) => ({
            userId,
            permissionId: o.permissionId,
            override: o.override,
          }))
        );
      }

      return await tx
        .select()
        .from(userPermissionOverrides)
        .where(eq(userPermissionOverrides.userId, userId));
    });

    // CRITICAL: Invalidate cache after update
    cache.delete(CacheKeys.userPermissions(userId));

    return result;
  }

  /**
   * Get technicians by company ID
   */
  async getTechniciansByCompanyId(companyId: string) {
    return await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.companyId, companyId),
          eq(users.disabled, false)
        )
      )
      .orderBy(users.fullName);
  }
}

export const teamRepository = new TeamRepository();