import { Router, Response } from "express";
import { z } from "zod";
import { db } from "../db";
import { eq, and, inArray } from "drizzle-orm";
import { roles, permissions, rolePermissions } from "@shared/schema";
import { requireRole } from "../auth/requireRole";
import { ADMIN_ROLES, RESTRICTED_MANAGER_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";
import { clearPermissionCache } from "../storage/permissions";

const router = Router();

// ========================================
// PERMISSION CATALOG (Stable Keys)
// ========================================

const PERMISSION_CATALOG = [
  // Schedule
  { key: "schedule.own.view", group: "schedule", label: "View Own Schedule", description: "View your assigned jobs and schedule" },
  { key: "schedule.own.complete", group: "schedule", label: "Complete Own Jobs", description: "Mark your assigned jobs as complete" },
  { key: "schedule.own.edit", group: "schedule", label: "Edit Own Schedule", description: "Modify your own scheduled jobs" },
  { key: "schedule.all.view", group: "schedule", label: "View All Schedules", description: "View all technicians' schedules" },
  { key: "schedule.all.edit", group: "schedule", label: "Edit All Schedules", description: "Modify any technician's schedule" },
  { key: "schedule.all.delete", group: "schedule", label: "Delete Scheduled Jobs", description: "Remove jobs from the schedule" },

  // Time Tracking
  { key: "time.own.edit", group: "time", label: "Edit Own Time", description: "Track and edit your own time entries" },
  { key: "time.all.view", group: "time", label: "View All Time", description: "View all team members' time entries" },
  { key: "time.all.edit", group: "time", label: "Edit All Time", description: "Edit any team member's time entries" },
  { key: "time.approve", group: "time", label: "Approve Timesheets", description: "Approve submitted timesheets" },

  // Notes
  { key: "notes.jobs.view", group: "notes", label: "View Job Notes", description: "View notes on jobs you're assigned to" },
  { key: "notes.all.view", group: "notes", label: "View All Notes", description: "View all notes across jobs and clients" },
  { key: "notes.all.edit", group: "notes", label: "Edit All Notes", description: "Create and edit notes on any job or client" },
  { key: "notes.all.delete", group: "notes", label: "Delete Notes", description: "Delete any notes" },

  // Expenses
  { key: "expenses.own.edit", group: "expenses", label: "Edit Own Expenses", description: "Submit and edit your own expenses" },
  { key: "expenses.all.view", group: "expenses", label: "View All Expenses", description: "View all team expenses" },
  { key: "expenses.all.edit", group: "expenses", label: "Edit All Expenses", description: "Edit any team member's expenses" },
  { key: "expenses.approve", group: "expenses", label: "Approve Expenses", description: "Approve submitted expenses" },

  // Clients
  { key: "clients.view.basic", group: "clients", label: "View Client Basics", description: "View client names and addresses" },
  { key: "clients.view.full", group: "clients", label: "View Full Client Info", description: "View complete client details including contacts" },
  { key: "clients.edit", group: "clients", label: "Edit Clients", description: "Create and modify client information" },
  { key: "clients.delete", group: "clients", label: "Delete Clients", description: "Delete client records" },

  // Work (Quotes, Jobs, Invoices)
  { key: "quotes.view", group: "work", label: "View Quotes", description: "View quote details" },
  { key: "quotes.edit", group: "work", label: "Edit Quotes", description: "Create and modify quotes" },
  { key: "quotes.approve", group: "work", label: "Approve Quotes", description: "Approve quotes for sending" },
  { key: "jobs.view", group: "work", label: "View Jobs", description: "View job details" },
  { key: "jobs.edit", group: "work", label: "Edit Jobs", description: "Create and modify jobs" },
  { key: "jobs.delete", group: "work", label: "Delete Jobs", description: "Delete job records" },
  { key: "invoices.view", group: "work", label: "View Invoices", description: "View invoice details" },
  { key: "invoices.edit", group: "work", label: "Edit Invoices", description: "Create and modify invoices" },
  { key: "invoices.send", group: "work", label: "Send Invoices", description: "Send invoices to clients" },

  // Pricing & Costing
  { key: "pricing.view", group: "pricing", label: "View Pricing", description: "View item and service pricing" },
  { key: "pricing.edit", group: "pricing", label: "Edit Pricing", description: "Modify item and service pricing" },
  { key: "job_costing.view", group: "pricing", label: "View Job Costing", description: "View job cost breakdowns and profitability" },

  // Payments
  { key: "payments.view", group: "payments", label: "View Payments", description: "View payment records" },
  { key: "payments.collect", group: "payments", label: "Collect Payments", description: "Record and collect payments" },
  { key: "payments.refund", group: "payments", label: "Process Refunds", description: "Process payment refunds" },

  // Reports
  { key: "reports.view.basic", group: "reports", label: "View Basic Reports", description: "View operational reports" },
  { key: "reports.view.financial", group: "reports", label: "View Financial Reports", description: "View financial and revenue reports" },

  // Admin
  { key: "team.view", group: "admin", label: "View Team", description: "View team member list" },
  { key: "team.manage", group: "admin", label: "Manage Team", description: "Add, edit, and remove team members" },
  { key: "roles.manage", group: "admin", label: "Manage Roles", description: "Create and modify roles and permissions" },
  { key: "settings.manage", group: "admin", label: "Manage Settings", description: "Modify company settings" },
  { key: "integrations.manage", group: "admin", label: "Manage Integrations", description: "Configure third-party integrations" },
];

// ========================================
// DEFAULT ROLE DEFINITIONS
// ========================================

const DEFAULT_ROLES = [
  {
    name: "owner",
    description: "Full system access with all permissions",
    isSystemRole: true,
    hierarchy: 1,
    permissions: PERMISSION_CATALOG.map(p => p.key), // All permissions
  },
  {
    name: "admin",
    description: "Administrative access to manage team and settings",
    isSystemRole: true,
    hierarchy: 2,
    permissions: PERMISSION_CATALOG.map(p => p.key), // All permissions
  },
  {
    name: "manager",
    description: "Manage jobs, clients, invoices, and view reports",
    isSystemRole: true,
    hierarchy: 3,
    permissions: [
      "schedule.own.view", "schedule.own.complete", "schedule.own.edit",
      "schedule.all.view", "schedule.all.edit",
      "time.own.edit", "time.all.view", "time.all.edit", "time.approve",
      "notes.jobs.view", "notes.all.view", "notes.all.edit",
      "expenses.own.edit", "expenses.all.view", "expenses.all.edit", "expenses.approve",
      "clients.view.basic", "clients.view.full", "clients.edit",
      "quotes.view", "quotes.edit", "quotes.approve",
      "jobs.view", "jobs.edit",
      "invoices.view", "invoices.edit", "invoices.send",
      "pricing.view", "job_costing.view",
      "payments.view", "payments.collect",
      "reports.view.basic", "reports.view.financial",
      "team.view",
    ],
  },
  {
    name: "dispatcher",
    description: "Schedule jobs and manage daily operations",
    isSystemRole: true,
    hierarchy: 4,
    permissions: [
      "schedule.own.view", "schedule.own.complete", "schedule.own.edit",
      "schedule.all.view", "schedule.all.edit",
      "time.own.edit", "time.all.view",
      "notes.jobs.view", "notes.all.view", "notes.all.edit",
      "expenses.own.edit",
      "clients.view.basic", "clients.view.full", "clients.edit",
      "quotes.view",
      "jobs.view", "jobs.edit",
      "invoices.view",
      "team.view",
    ],
  },
  {
    name: "technician",
    description: "Field work with limited administrative access",
    isSystemRole: true,
    hierarchy: 5,
    permissions: [
      "schedule.own.view", "schedule.own.complete",
      "time.own.edit",
      "notes.jobs.view",
      "expenses.own.edit",
      "clients.view.basic",
      "jobs.view",
    ],
  },
  {
    name: "custom",
    description: "Custom role with configurable permissions",
    isSystemRole: false,
    hierarchy: 10,
    permissions: [], // Starts with no permissions
  },
];

const ROLE_DISPLAY_NAMES: Record<string, string> = {
  owner: "Owner",
  admin: "Administrator",
  manager: "Manager",
  dispatcher: "Dispatcher",
  technician: "Technician",
  custom: "Custom",
};

// ========================================
// SEEDING LOGIC (Idempotent)
// ========================================

let seedingPromise: Promise<void> | null = null;

async function ensureRolesAndPermissionsSeeded(): Promise<void> {
  // Prevent concurrent seeding
  if (seedingPromise) {
    return seedingPromise;
  }

  seedingPromise = (async () => {
    try {
      // Check if permissions exist
      const existingPermissions = await db.select().from(permissions).limit(1);

      if (existingPermissions.length === 0) {
        // Seed permissions
        console.log("[Roles] Seeding permission catalog...");
        await db.insert(permissions).values(
          PERMISSION_CATALOG.map(p => ({
            key: p.key,
            group: p.group,
            label: p.label,
            description: p.description,
          }))
        );
      }

      // Check if roles exist
      const existingRoles = await db.select().from(roles).limit(1);

      if (existingRoles.length === 0) {
        console.log("[Roles] Seeding default roles...");

        // Get all permissions for mapping
        const allPermissions = await db.select().from(permissions);
        const permissionIdByKey = new Map(allPermissions.map(p => [p.key, p.id]));

        // Seed roles
        for (const roleDef of DEFAULT_ROLES) {
          // Insert role
          const [insertedRole] = await db.insert(roles).values({
            name: roleDef.name,
            description: roleDef.description,
            isSystemRole: roleDef.isSystemRole,
          }).returning();

          // Insert role-permission mappings
          if (roleDef.permissions.length > 0) {
            const rolePermissionValues = roleDef.permissions
              .map(permKey => {
                const permId = permissionIdByKey.get(permKey);
                return permId ? { roleId: insertedRole.id, permissionId: permId } : null;
              })
              .filter(Boolean) as Array<{ roleId: string; permissionId: string }>;

            if (rolePermissionValues.length > 0) {
              await db.insert(rolePermissions).values(rolePermissionValues);
            }
          }
        }

        console.log("[Roles] Seeding complete.");
      }
    } finally {
      seedingPromise = null;
    }
  })();

  return seedingPromise;
}

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
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    // Ensure seeding is done
    await ensureRolesAndPermissionsSeeded();

    const allRoles = await db.select().from(roles);

    // Map to frontend expected shape
    const result = allRoles.map(role => ({
      id: role.id,
      name: role.name,
      displayName: ROLE_DISPLAY_NAMES[role.name] || role.name,
      description: role.description,
      hierarchy: DEFAULT_ROLES.find(r => r.name === role.name)?.hierarchy || 99,
      isSystemRole: role.isSystemRole,
    }));

    // Sort by hierarchy
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
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    // Ensure seeding is done
    await ensureRolesAndPermissionsSeeded();

    const allPermissions = await db.select().from(permissions);

    // Map to frontend expected shape
    const result = allPermissions.map(p => ({
      id: p.id,
      name: p.key,  // Frontend expects 'name', schema uses 'key'
      displayName: p.label,  // Frontend expects 'displayName', schema uses 'label'
      description: p.description,
      category: p.group,  // Frontend expects 'category', schema uses 'group'
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

    // Ensure seeding is done
    await ensureRolesAndPermissionsSeeded();

    // Get role permissions
    const rolePerms = await db
      .select({ key: permissions.key })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(rolePermissions.roleId, roleId));

    // Return array of permission keys (mapped to 'name' for frontend)
    res.json(rolePerms.map(rp => rp.key));
  })
);

/**
 * POST /api/roles
 * Create a new custom role
 */
router.post(
  "/",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const data = validateSchema(createRoleSchema, req.body);

    // Generate internal name from displayName if not provided
    const name = data.name || data.displayName.toLowerCase().replace(/\s+/g, "_");

    // Check if role name already exists
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
      hierarchy: 99,
      isSystemRole: false,
    });
  })
);

/**
 * PUT /api/roles/:roleId/permissions
 * Update permissions for a role
 */
router.put(
  "/:roleId/permissions",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { roleId } = req.params;
    const data = validateSchema(updateRolePermissionsSchema, req.body);

    // Verify role exists and is editable
    const [role] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
    if (!role) {
      throw createError(404, "Role not found");
    }

    // System roles (except 'custom') cannot be edited
    if (role.isSystemRole && role.name !== "custom") {
      throw createError(403, "System roles cannot be modified");
    }

    // Get permission IDs for the provided keys
    const allPermissions = await db.select().from(permissions);
    const permissionIdByKey = new Map(allPermissions.map(p => [p.key, p.id]));

    const permissionIds = data.permissions
      .map(key => permissionIdByKey.get(key))
      .filter(Boolean) as string[];

    // Delete existing role permissions
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));

    // Insert new role permissions
    if (permissionIds.length > 0) {
      await db.insert(rolePermissions).values(
        permissionIds.map(permissionId => ({ roleId, permissionId }))
      );
    }

    // Clear permission cache for all users with this role
    clearPermissionCache();

    res.json({ success: true, permissionCount: permissionIds.length });
  })
);

/**
 * DELETE /api/roles/:roleId
 * Delete a custom role
 */
router.delete(
  "/:roleId",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { roleId } = req.params;

    // Verify role exists
    const [role] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
    if (!role) {
      throw createError(404, "Role not found");
    }

    // Cannot delete system roles
    if (role.isSystemRole) {
      throw createError(403, "System roles cannot be deleted");
    }

    // Delete role (cascade will remove role_permissions)
    await db.delete(roles).where(eq(roles.id, roleId));

    // Clear permission cache
    clearPermissionCache();

    res.json({ success: true });
  })
);

// Export seeding function for use in other routes
export { ensureRolesAndPermissionsSeeded };

export default router;
