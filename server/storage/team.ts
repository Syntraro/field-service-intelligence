import { db } from "../db";
import { eq, and, isNull } from "drizzle-orm";
import {
  users,
  userIdentities,
  technicianProfiles,
  workingHours,
  userPermissionOverrides
} from "@shared/schema";
import { BaseRepository } from "./base";
import { cache, CacheKeys, CacheTTL } from "../services/cache";
// 2026-05-04 platform/tenant identity containment: every tenant-facing
// users-table read in this file composes `nonPlatformUserPredicate()`
// into its where clause so platform-role rows (whose `companyId` is a
// "parking" FK to some tenant) cannot appear in tenant team / technician
// selector / dispatch surfaces. See server/storage/tenantUserPredicate.ts
// for the full rationale.
import { nonPlatformUserPredicate } from "./tenantUserPredicate";

export class TeamRepository extends BaseRepository {
  /**
   * Create a new team member (user + email identity)
   * This is used for direct creation (not invitation-based).
   */
  async createTeamMember(
    companyId: string,
    data: {
      email: string;
      fullName: string;
      firstName?: string;
      lastName?: string;
      phone?: string | null;
      roleId?: string;
      role?: string;
      disabled?: boolean;
      passwordHash?: string; // Optional - if not provided, user must reset password
    }
  ) {
    this.assertCompanyId(companyId);

    const normalizedEmail = (data.email || "").trim().toLowerCase();

    // Use provided firstName/lastName, or parse from fullName
    let firstName: string | null = data.firstName || null;
    let lastName: string | null = data.lastName || null;
    if (!firstName && !lastName && data.fullName) {
      const parts = data.fullName.trim().split(/\s+/);
      firstName = parts[0] || null;
      lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;
    }

    return await db.transaction(async (tx) => {
      // Create user
      const [user] = await tx
        .insert(users)
        .values({
          companyId,
          email: normalizedEmail,
          fullName: data.fullName,
          firstName,
          lastName,
          phone: data.phone || null,
          roleId: data.roleId || null,
          role: data.role || "technician",
          status: data.disabled ? "deactivated" : "active",
          disabled: data.disabled || false,
          password: data.passwordHash || "!NEEDS_RESET!", // Placeholder - identity has real password
        })
        .returning();

      // Create email identity
      await tx
        .insert(userIdentities)
        .values({
          companyId,
          userId: user.id,
          provider: "email",
          identifier: normalizedEmail,
          passwordHash: data.passwordHash || null, // null = must set password
        });

      return user;
    });
  }

  /**
   * Get team members for a company
   * Includes disabled users (so admins can re-enable them)
   * Excludes soft-deleted users (deletedAt is not null)
   */
  async getTeamMembers(companyId: string) {
    return await db
      .select()
      .from(users)
      .where(and(
        eq(users.companyId, companyId),
        isNull(users.deletedAt), // Exclude soft-deleted users only
        // 2026-05-04: exclude platform-role rows. See file header.
        nonPlatformUserPredicate(),
      ))
      .orderBy(users.fullName);
  }

  /** 2026-03-31: Bulk fetch technician calendar colors for a company.
   *  Returns Map<userId, color> for all technicians with a color set. */
  async getTechnicianColors(companyId: string): Promise<Map<string, string>> {
    const rows = await db
      .select({ userId: technicianProfiles.userId, color: technicianProfiles.color })
      .from(technicianProfiles)
      .innerJoin(users, eq(users.id, technicianProfiles.userId))
      .where(and(
        eq(users.companyId, companyId),
        isNull(users.deletedAt),
        nonPlatformUserPredicate(),
      ));
    const map = new Map<string, string>();
    for (const r of rows) {
      if (r.color) map.set(r.userId, r.color);
    }
    return map;
  }

  /** 2026-04-03: Bulk fetch technician labour cost rates for a company.
   *  Returns Map<userId, laborCostPerHour> for all technicians with a rate set. */
  async getTechnicianRates(companyId: string): Promise<Map<string, string>> {
    const rows = await db
      .select({ userId: technicianProfiles.userId, laborCostPerHour: technicianProfiles.laborCostPerHour })
      .from(technicianProfiles)
      .innerJoin(users, eq(users.id, technicianProfiles.userId))
      .where(and(
        eq(users.companyId, companyId),
        isNull(users.deletedAt),
        nonPlatformUserPredicate(),
      ));
    const map = new Map<string, string>();
    for (const r of rows) {
      if (r.laborCostPerHour) map.set(r.userId, r.laborCostPerHour);
    }
    return map;
  }

  /**
   * Get single team member
   */
  async getTeamMember(companyId: string, userId: string) {
    const rows = await db
      .select()
      .from(users)
      .where(and(
        eq(users.id, userId),
        eq(users.companyId, companyId),
        // 2026-05-04: ensures detail endpoint cannot resolve a platform
        // user even via direct ID. The list endpoint already excludes
        // platform rows, but a stale link or hand-typed URL with a
        // platform user's id could otherwise pierce the boundary.
        nonPlatformUserPredicate(),
      ))
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
      email?: string; // For backward compat - use identity.updateEmailIdentity for login
      phone?: string;
      roleId?: string;
      role?: string;
      status?: string;
      useCustomSchedule?: boolean;
      isSchedulable?: boolean;
    }
  ) {
    const rows = await db
      .update(users)
      .set(patch)
      .where(and(
        eq(users.id, userId),
        eq(users.companyId, companyId),
        // 2026-05-04: tenant write paths must never touch a platform-role
        // row even if the URL is hand-crafted with a platform user's id.
        nonPlatformUserPredicate(),
      ))
      .returning();

    return rows[0] ?? null;
  }

  /**
   * Deactivate team member (soft delete)
   * Sets status to deactivated, disabled to true, and deletedAt timestamp
   */
  async deactivateTeamMember(companyId: string, userId: string) {
    const rows = await db
      .update(users)
      .set({
        status: "deactivated",
        disabled: true,
        deletedAt: new Date() // Soft delete timestamp
      })
      .where(and(
        eq(users.id, userId),
        eq(users.companyId, companyId),
        nonPlatformUserPredicate(),
      ))
      .returning();

    return rows[0] ?? null;
  }

  /**
   * Activate team member (restores soft-deleted user)
   * Sets status to active, clears disabled flag, and clears deletedAt
   */
  async activateTeamMember(companyId: string, userId: string) {
    const rows = await db
      .update(users)
      .set({
        status: "active",
        disabled: false,
        deletedAt: null // Clear soft delete timestamp
      })
      .where(and(
        eq(users.id, userId),
        eq(users.companyId, companyId),
        nonPlatformUserPredicate(),
      ))
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
      laborCostPerHour?: string | null;
      billableRatePerHour?: string | null;
      color?: string;
      phone?: string | null;
      note?: string | null;
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
   * Excludes soft-deleted users
   */
  async getTechniciansByCompanyId(companyId: string) {
    return await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.companyId, companyId),
          eq(users.disabled, false),
          isNull(users.deletedAt), // Exclude soft-deleted users
          // 2026-05-04: containment.
          nonPlatformUserPredicate(),
        )
      )
      .orderBy(users.fullName);
  }
}

export const teamRepository = new TeamRepository();