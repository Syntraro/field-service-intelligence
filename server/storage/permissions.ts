import { db } from "../db";
import { eq, sql } from "drizzle-orm";
import { roles, permissions, rolePermissions, userPermissionOverrides, users } from "@shared/schema";
// 2026-05-01 RBAC system fix: platform roles bypass tenant-scoped
// permission resolution entirely (they don't operate within a tenant's
// RBAC). Imported here so the resolver can short-circuit for them
// before requiring a tenant `role_id`.
// 2026-05-04 Phase 7: removed `isPlatformRole` import — the resolver
// short-circuit below was structurally impossible after Phase 6's
// DB CHECK constraint on `users.role`.

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
   * Get effective permissions for a user.
   *
   * 2026-05-01 RBAC system fix: removed the legacy role-id mapping
   * fallback ({ admin: "role-admin", manager: "role-manager", ... }).
   * Those hardcoded strings never matched any row in `roles` (which
   * uses `gen_random_uuid()` ids — see `shared/schema.ts:3117`), so
   * the fallback silently returned an empty permission set for every
   * user whose `users.role_id` was NULL. Symptoms in the wild
   * included owners/admins seeing affordances hidden because their
   * effective set lacked every fine permission.
   *
   * Strict resolution order under the new contract:
   *   1. Platform roles (e.g., `platform_admin`) bypass tenant RBAC
   *      entirely — middleware short-circuits at the route layer; here
   *      we return an empty set for the `/api/me/permissions` feed.
   *      They do not have a tenant `role_id` by design.
   *   2. Non-platform users MUST have a non-null `role_id`. Missing
   *      `role_id` is a misconfigured / un-backfilled user — we throw
   *      with a stable error code so the caller sees the failure
   *      instead of a silent empty set.
   *   3. Resolved permissions = role permissions ∪ grant-overrides
   *      \ revoke-overrides. An empty result is permitted (a custom
   *      role with no permissions is a valid configuration); the
   *      THROWING failure mode is reserved for the `role_id` gap.
   *
   * Migration `2026_05_01_backfill_users_role_id.sql` populates
   * `users.role_id` from `users.role` for every existing tenant user.
   * After backfill, this resolver should never reach the throw branch
   * for production traffic.
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

    // 2026-05-04 Phase 7: removed the `isPlatformRole(user.role)`
    // short-circuit. After the DB CHECK constraint on `users.role`,
    // every row in `users` has a tenant role by construction —
    // dropping the empty-set early-return here doesn't change
    // observable behavior for any existing user, and the resolver
    // is no longer authoritative for "platform identity" anyway
    // (that lives on `platform_user_roles`).

    // 2026-05-04 Phase 2 PR 3 hotfix (auth regression):
    //
    // Previously this branch THREW when `users.role_id` was NULL,
    // expecting the 2026_05_01 backfill migration to have populated
    // every row. In practice, rows created AFTER the backfill (new
    // tenants, test fixtures, recreated owners) re-introduce NULL
    // role_ids — `userRepository.createUser` does not set role_id
    // — and every authenticated request from those users 500s.
    //
    // Resilient resolution: when `role_id` is NULL but `role` is a
    // canonical tenant role string, look up `roles.id` by name match.
    // The Phase 6 DB CHECK constraint on `users.role` guarantees
    // `role` is one of the five seeded tenant roles (owner / admin /
    // manager / dispatcher / technician), so this lookup always
    // resolves. Self-heal by persisting the resolved role_id back to
    // the row so subsequent requests bypass this branch.
    //
    // Genuinely misconfigured rows (no `role` AND no `role_id`) still
    // throw — that's a real data problem the operator must fix.
    let effectiveRoleId = user.roleId;
    if (!effectiveRoleId) {
      if (!user.role) {
        throw new Error(
          `RBAC ERROR: user ${userId} has no role and no role_id. ` +
          `Assign a role through the admin UI.`
        );
      }
      const matched = await db
        .select({ id: roles.id })
        .from(roles)
        .where(sql`LOWER(${roles.name}) = LOWER(${user.role})`)
        .limit(1);
      if (matched.length === 0) {
        throw new Error(
          `RBAC ERROR: user ${userId} role="${user.role}" does not match any seeded role. ` +
          `Re-run migration 2026_05_01_backfill_users_role_id.sql or seed the missing role.`
        );
      }
      effectiveRoleId = matched[0].id;
      // Self-heal: persist resolved role_id back to the row. Best-
      // effort — if this UPDATE fails (race, transient db error),
      // the next request will simply re-resolve via the same path.
      // We do NOT await with a rejection-propagating semantic; a
      // failed self-heal must not break the current request.
      try {
        await db
          .update(users)
          .set({ roleId: effectiveRoleId })
          .where(eq(users.id, userId));
      } catch {
        // swallow — resolution proceeds with the in-memory roleId
      }
    }

    // (3) Standard resolution: role permissions merged with overrides.
    const effectivePermissions = new Set<string>();
    const rolePerms = await this.getRolePermissions(effectiveRoleId);
    rolePerms.forEach((key) => effectivePermissions.add(key));

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
