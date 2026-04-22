import { Router, Response } from "express";
import { z } from "zod";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { roles, permissions, rolePermissions } from "@shared/schema";
import { requireRole } from "../auth/requireRole";
import { ADMIN_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";
import { clearPermissionCache } from "../storage/permissions";
// 2026-04-21 Phase 1 canonical policy architecture: fine-grained
// permissions.manage gate sits BEHIND the existing ADMIN_ROLES coarse gate.
// Two-layer contract: coarse role-based role gate + fine DB-backed check.
import { requirePermission } from "../permissions";

const router = Router();

// ========================================
// DISPLAY METADATA
// ========================================
// 2026-04-21 Phase 2: The permission catalog + default role → permission
// mappings used to live here as `PERMISSION_CATALOG` + `DEFAULT_ROLES`
// constants that an on-demand runtime seeder
// (`ensureRolesAndPermissionsSeeded`) wrote into the DB. Phase 1 moved
// seeding to the canonical `2026_04_21_seed_rbac_catalog.sql` migration.
// Phase 2 deletes the runtime constants + seeder entirely — the DB tables
// are now the only source of truth for role / permission data. Only
// display-layer metadata (human-readable role labels and sort order for
// the roles list page) remains here, because it is UI chrome, not policy.

const ROLE_DISPLAY_NAMES: Record<string, string> = {
  owner: "Owner",
  admin: "Administrator",
  manager: "Manager",
  dispatcher: "Dispatcher",
  technician: "Technician",
  custom: "Custom",
};

const ROLE_HIERARCHY: Record<string, number> = {
  owner: 1,
  admin: 2,
  manager: 3,
  dispatcher: 4,
  technician: 5,
  custom: 10,
};

// ========================================
// VALIDATION SCHEMAS
// ========================================

const createRoleSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  displayName: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

const updateRolePermissionsSchema = z.object({
  permissions: z.array(z.string()),
});

// ========================================
// ROUTES
// ========================================

/**
 * GET /api/roles
 * List all roles with display info
 */
router.get(
  "/",
  asyncHandler(async (_req: AuthedRequest, res: Response) => {
    const allRoles = await db.select().from(roles);

    const result = allRoles.map(role => ({
      id: role.id,
      name: role.name,
      displayName: ROLE_DISPLAY_NAMES[role.name] || role.name,
      description: role.description,
      hierarchy: ROLE_HIERARCHY[role.name] ?? 99,
      isSystemRole: role.isSystemRole,
    }));

    result.sort((a, b) => a.hierarchy - b.hierarchy);

    res.json(result);
  })
);

// Separate permissions router (mounted at /api/permissions)
export const permissionsRouter = Router();

/**
 * GET /api/permissions
 * List all permissions (grouped by category)
 */
permissionsRouter.get(
  "/",
  asyncHandler(async (_req: AuthedRequest, res: Response) => {
    const allPermissions = await db.select().from(permissions);

    // Map to frontend expected shape
    const result = allPermissions.map(p => ({
      id: p.id,
      name: p.key,         // Frontend expects 'name', schema uses 'key'
      displayName: p.label, // Frontend expects 'displayName', schema uses 'label'
      description: p.description,
      category: p.group,   // Frontend expects 'category', schema uses 'group'
    }));

    res.json(result);
  })
);

/**
 * GET /api/roles/:roleId/permissions
 * Get permission keys for a specific role
 */
router.get(
  "/:roleId/permissions",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { roleId } = req.params;

    const rolePerms = await db
      .select({ key: permissions.key })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(rolePermissions.roleId, roleId));

    res.json(rolePerms.map(rp => rp.key));
  })
);

/**
 * POST /api/roles
 * Create a new custom role
 *
 * 2026-04-21 Phase 1: Two-layer gate.
 *   - Coarse: requireRole(ADMIN_ROLES) — only owners/admins.
 *   - Fine:   requirePermission("permissions.manage") — the canonical
 *             permission for "can edit who has what permission". An admin
 *             whose `permissions.manage` is REVOKED via an override gets
 *             stopped here without affecting any other admin capability.
 */
router.post(
  "/",
  requireRole(ADMIN_ROLES),
  requirePermission("permissions.manage"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const data = validateSchema(createRoleSchema, req.body);

    const name = data.name || data.displayName.toLowerCase().replace(/\s+/g, "_");

    const existing = await db.select().from(roles).where(eq(roles.name, name)).limit(1);
    if (existing.length > 0) {
      throw createError(400, "A role with this name already exists");
    }

    const [newRole] = await db.insert(roles).values({
      name,
      description: data.description || null,
      isSystemRole: false,
    }).returning();

    res.status(201).json({
      id: newRole.id,
      name: newRole.name,
      displayName: data.displayName,
      description: newRole.description,
      hierarchy: ROLE_HIERARCHY[newRole.name] ?? 99,
      isSystemRole: false,
    });
  })
);

/**
 * PUT /api/roles/:roleId/permissions
 * Update permissions for a role
 *
 * 2026-04-21 Phase 1: Two-layer gate (see POST /api/roles).
 */
router.put(
  "/:roleId/permissions",
  requireRole(ADMIN_ROLES),
  requirePermission("permissions.manage"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { roleId } = req.params;
    const data = validateSchema(updateRolePermissionsSchema, req.body);

    const [role] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
    if (!role) {
      throw createError(404, "Role not found");
    }

    // System roles (except 'custom') cannot be edited
    if (role.isSystemRole && role.name !== "custom") {
      throw createError(403, "System roles cannot be modified");
    }

    const allPermissions = await db.select().from(permissions);
    const permissionIdByKey = new Map(allPermissions.map(p => [p.key, p.id]));

    const permissionIds = data.permissions
      .map(key => permissionIdByKey.get(key))
      .filter(Boolean) as string[];

    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));

    if (permissionIds.length > 0) {
      await db.insert(rolePermissions).values(
        permissionIds.map(permissionId => ({ roleId, permissionId }))
      );
    }

    clearPermissionCache();

    res.json({ success: true, permissionCount: permissionIds.length });
  })
);

/**
 * DELETE /api/roles/:roleId
 * Delete a custom role
 *
 * 2026-04-21 Phase 1: Two-layer gate (see POST /api/roles).
 */
router.delete(
  "/:roleId",
  requireRole(ADMIN_ROLES),
  requirePermission("permissions.manage"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { roleId } = req.params;

    const [role] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
    if (!role) {
      throw createError(404, "Role not found");
    }

    if (role.isSystemRole) {
      throw createError(403, "System roles cannot be deleted");
    }

    await db.delete(roles).where(eq(roles.id, roleId));

    clearPermissionCache();

    res.json({ success: true });
  })
);

export default router;
