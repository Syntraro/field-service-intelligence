import { db } from "../db";
import { eq } from "drizzle-orm";
import { roles, permissions, rolePermissions, userPermissionOverrides, users } from "@shared/schema";

/**
 * Permission Repository
 *
 * NOTE: Permissions are GLOBAL (not tenant-scoped) in this system.
 * Roles and permissions are shared across all tenants.
 * User-specific overrides are tied to user IDs.
 *
 * This repository centralizes all permission-related queries
 * for consistent caching and query patterns.
 */

// Cache for user permissions (per-request caching)
const permissionCache = new Map<string, Set<string>>();

/**
 * Clear permission cache
 * Call this on user/permission updates
 */
export function clearPermissionCache(userId?: string): void {
  if (userId) {
    permissionCache.delete(userId);
  } else {
    permissionCache.clear();
  }
}

export class PermissionRepository {
  // ========================================
  // USER PERMISSION QUERIES
  // ========================================

  /**
   * Get user by ID (for permission lookup)
   */
  async getUser(userId: string) {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    return user ?? null;
  }

  /**
   * Get role permissions by role ID
   */
  async getRolePermissions(roleId: string): Promise<string[]> {
    const rolePerms = await db
      .select({ key: permissions.key })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(rolePermissions.roleId, roleId));

    return rolePerms.map((rp) => rp.key);
  }

  /**
   * Get user permission overrides
   */
  async getUserPermissionOverrides(
    userId: string
  ): Promise<Array<{ key: string; override: string }>> {
    const overrides = await db
      .select({
        key: permissions.key,
        override: userPermissionOverrides.override,
      })
      .from(userPermissionOverrides)
      .innerJoin(
        permissions,
        eq(userPermissionOverrides.permissionId, permissions.id)
      )
      .where(eq(userPermissionOverrides.userId, userId));

    return overrides;
  }

  /**
   * Get effective permissions for a user
   * Combines role permissions with user-specific overrides
   */
  async getUserEffectivePermissions(userId: string): Promise<Set<string>> {
    // Check cache first
    if (permissionCache.has(userId)) {
      return permissionCache.get(userId)!;
    }

    // Get user with role
    const user = await this.getUser(userId);
    if (!user) {
      return new Set();
    }

    const effectivePermissions = new Set<string>();

    // Get role permissions if user has a roleId
    if (user.roleId) {
      const rolePerms = await this.getRolePermissions(user.roleId);
      rolePerms.forEach((key) => effectivePermissions.add(key));
    } else {
      // Fallback: map legacy role field to new role
      const legacyRoleMapping: Record<string, string> = {
        admin: "role-admin",
        owner: "role-admin",
        manager: "role-manager",
        technician: "role-technician",
      };

      const mappedRoleId = legacyRoleMapping[user.role] || "role-technician";
      const rolePerms = await this.getRolePermissions(mappedRoleId);
      rolePerms.forEach((key) => effectivePermissions.add(key));
    }

    // Apply user-specific overrides
    const overrides = await this.getUserPermissionOverrides(userId);
    overrides.forEach(({ key, override }) => {
      if (override === "grant") {
        effectivePermissions.add(key);
      } else if (override === "revoke") {
        effectivePermissions.delete(key);
      }
    });

    // Cache the result
    permissionCache.set(userId, effectivePermissions);

    return effectivePermissions;
  }

  /**
   * Check if user has a specific permission
   */
  async userHasPermission(
    userId: string,
    permissionKey: string
  ): Promise<boolean> {
    const perms = await this.getUserEffectivePermissions(userId);
    return perms.has(permissionKey);
  }

  // ========================================
  // ROLE & PERMISSION QUERIES (for UI)
  // ========================================

  /**
   * Get all roles
   */
  async getAllRoles() {
    return await db.select().from(roles);
  }

  /**
   * Get all permissions
   */
  async getAllPermissions() {
    return await db.select().from(permissions);
  }

  /**
   * Get all role-permission mappings
   */
  async getAllRolePermissions() {
    return await db.select().from(rolePermissions);
  }

  /**
   * Get all roles with their permissions (for UI display)
   */
  async getRolesWithPermissions() {
    const [allRoles, allPermissions, rolePermissionMappings] = await Promise.all([
      this.getAllRoles(),
      this.getAllPermissions(),
      this.getAllRolePermissions(),
    ]);

    // Build permission lookup
    const permissionMap = new Map(allPermissions.map((p) => [p.id, p]));

    // Build role with permissions
    const rolesWithPerms = allRoles.map((role) => {
      const rolePerms = rolePermissionMappings
        .filter((rp) => rp.roleId === role.id)
        .map((rp) => permissionMap.get(rp.permissionId))
        .filter(Boolean);

      // Group permissions by group
      const groupedPermissions: Record<string, typeof allPermissions> = {};
      rolePerms.forEach((perm) => {
        if (perm) {
          if (!groupedPermissions[perm.group]) {
            groupedPermissions[perm.group] = [];
          }
          groupedPermissions[perm.group].push(perm);
        }
      });

      return {
        ...role,
        permissions: rolePerms,
        permissionsByGroup: groupedPermissions,
        permissionKeys: rolePerms.map((p) => p?.key).filter(Boolean) as string[],
      };
    });

    return rolesWithPerms;
  }

  /**
   * Get all permissions grouped by group
   */
  async getPermissionsGrouped() {
    const allPermissions = await this.getAllPermissions();

    const grouped: Record<string, typeof allPermissions> = {};
    allPermissions.forEach((perm) => {
      if (!grouped[perm.group]) {
        grouped[perm.group] = [];
      }
      grouped[perm.group].push(perm);
    });

    return {
      all: allPermissions,
      grouped,
    };
  }
}

export const permissionRepository = new PermissionRepository();
