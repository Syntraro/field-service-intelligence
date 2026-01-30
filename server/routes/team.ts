import { Router, Response } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { storage } from "../storage/index";
import { requireRole } from "../auth/requireRole";
import { RESTRICTED_MANAGER_ROLES, canAssignRole, type Role, ADMIN_ROLES } from "../auth/roles";
import { parsePaginationLenient, applyOffsetPagination } from "../utils/pagination";
import { paginatedCompat } from "../utils/paginatedResponse";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import {
  assertLastOwnerProtection,
  assertLastAdminProtection,
  assertNoSelfLockout,
} from "../guards/ownershipGuards";
import { AuthedRequest } from "../auth/tenantIsolation";
import {
  logTeamMemberCreated,
  logEmailChanged,
  logPasswordReset,
  logRoleChanged,
  logUserEnabled,
  logUserDisabled,
} from "../services/auditService";
import { getRolesWithPermissions } from "../permissions";
import { ensureRolesAndPermissionsSeeded } from "./roles";
import { filterSchedulableTechnicians } from "../domain/scheduling";

const router = Router();

const MANAGER_ROLES = RESTRICTED_MANAGER_ROLES;

// ========================================
// VALIDATION SCHEMAS
// ========================================

// Schema for optional roleId that accepts empty string and converts to undefined
const optionalUuidSchema = z.string()
  .transform((val) => (val === "" ? undefined : val))
  .pipe(z.string().uuid().optional())
  .optional();

const updateTeamMemberSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  fullName: z.string().min(1).max(200).optional(),
  phone: z.string().max(20).optional(),
  roleId: optionalUuidSchema,
  status: z.enum(["active", "inactive"]).optional(),
  useCustomSchedule: z.boolean().optional(),
  isSchedulable: z.boolean().optional(),
});

const moneyStringSchema = z.union([
  z.string().regex(/^\d+(\.\d{1,2})?$/),
  z.number().min(0).max(999.99),
  z.literal(""),
  z.null(),
]).transform((val): string | null => {
  if (val === "" || val === null || val === undefined) return null;
  return String(val);
}).optional();

const updateTechnicianProfileSchema = z.object({
  laborCostPerHour: moneyStringSchema,
  billableRatePerHour: moneyStringSchema,
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  phone: z.string().max(20).transform(v => v === "" ? null : v).nullable().optional(),
  note: z.string().max(1000).transform(v => v === "" ? null : v).nullable().optional(),
});

const workingHourEntrySchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional().nullable(),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional().nullable(),
  isWorking: z.boolean(),
}).refine(
  (data) => {
    // If working, both start and end times must be provided and end > start
    if (data.isWorking) {
      if (!data.startTime || !data.endTime) {
        return false; // Working days require both times
      }
      // Compare times as strings (HH:MM format sorts correctly)
      return data.endTime > data.startTime;
    }
    return true;
  },
  { message: "Working days require valid start and end times, with end time after start time" }
);

const setWorkingHoursSchema = z.object({
  hours: z.array(workingHourEntrySchema).refine(
    (hours) => {
      // Check for duplicate dayOfWeek entries
      const days = hours.map((h) => h.dayOfWeek);
      return new Set(days).size === days.length;
    },
    { message: "Duplicate days of week are not allowed" }
  ),
});

const setPermissionOverridesSchema = z.object({
  overrides: z.array(z.object({
    permissionId: z.string().min(1),
    override: z.enum(["grant", "revoke"]),
  })),
});

const updateRoleSchema = z.object({
  role: z.enum(["owner", "admin", "manager", "dispatcher", "technician"]),
});

const updateStatusSchema = z.object({
  active: z.boolean(),
});

// ========================================
// CREATE TEAM MEMBER SCHEMA
// ========================================

const createTeamMemberSchema = z.object({
  fullName: z.string().min(1, "Full name is required").max(200),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  email: z.string().email("Valid email is required").transform(e => e.trim().toLowerCase()),
  phone: z.string().max(20).optional().nullable(),
  roleId: optionalUuidSchema,
  role: z.string().optional(),
  disabled: z.boolean().optional().default(false),
});

// ========================================
// ROUTES
// ========================================

// Role hierarchy for sorting (lower = more privileged)
const ROLE_HIERARCHY: Record<string, number> = {
  owner: 1,
  admin: 2,
  manager: 3,
  dispatcher: 4,
  technician: 5,
};

// Display names for roles
const ROLE_DISPLAY_NAMES: Record<string, string> = {
  owner: "Owner",
  admin: "Administrator",
  manager: "Manager",
  dispatcher: "Dispatcher",
  technician: "Technician",
};

/**
 * GET /api/team/roles
 * Get all available roles for team management
 * Tenant-scoped, admin/manager only
 */
router.get(
  "/roles",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    // Ensure roles and permissions are seeded
    await ensureRolesAndPermissionsSeeded();

    const rolesWithPermissions = await getRolesWithPermissions();

    // Return stable shape: { id, name, displayName, hierarchy }
    const roles = rolesWithPermissions.map((r) => ({
      id: r.id,
      name: r.name,
      displayName: ROLE_DISPLAY_NAMES[r.name] || r.name,
      hierarchy: ROLE_HIERARCHY[r.name] || 99,
    }));

    // Sort by hierarchy (most privileged first)
    roles.sort((a, b) => a.hierarchy - b.hierarchy);

    res.json(roles);
  })
);

/**
 * POST /api/team
 * Create a new team member directly (without invitation)
 * Creates user record + email identity
 */
router.post(
  "/",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const actorUserId = req.user!.id;
    const data = validateSchema(createTeamMemberSchema, req.body);

    // Check global email availability
    const globalCheck = await storage.isEmailGloballyAvailable(data.email);
    if (!globalCheck.available) {
      throw createError(400,
        "This email is already in use. Each email can only belong to one company. " +
        "If this person works for multiple companies, they must use a different email."
      );
    }

    // Resolve roleId to role name (for legacy role field)
    let resolvedRole = data.role || "technician";
    if (data.roleId) {
      const { getRolesWithPermissions } = await import("../permissions");
      const allRoles = await getRolesWithPermissions();
      const selectedRole = allRoles.find(r => r.id === data.roleId);
      if (!selectedRole) {
        throw createError(400, `Invalid roleId: ${data.roleId}. Role not found.`);
      }
      // Map role name to legacy role field (admin/owner/manager/dispatcher/technician)
      resolvedRole = selectedRole.name;
    }

    // Create the team member
    const user = await storage.createTeamMember(companyId, {
      email: data.email,
      fullName: data.fullName,
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone,
      roleId: data.roleId,
      role: resolvedRole,
      disabled: data.disabled,
    });

    // Audit log
    await logTeamMemberCreated(req, companyId, actorUserId, user.id, {
      email: data.email,
      fullName: data.fullName,
      role: resolvedRole,
    });

    res.status(201).json({
      ...user,
      password: undefined,
      message: "Team member created. They will need to reset their password to log in.",
    });
  })
);

// GET /api/team/technicians - Get schedulable users for calendar/assignment dropdowns
// Uses canonical isTechnicianSchedulable() from domain layer
// Does NOT filter by role or status - schedulability is an explicit per-user setting
router.get(
  "/technicians",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const members = await storage.getTeamMembers(req.companyId!);

    // Use canonical filter with diagnostics
    const { schedulable, excluded } = filterSchedulableTechnicians(
      members,
      "GET /api/team/technicians"
    );

    // Log excluded count in development
    if (process.env.NODE_ENV === "development" && excluded.length > 0) {
      console.log(
        `[/api/team/technicians] Excluded ${excluded.length} technicians from dropdown:`,
        excluded.map(e => ({ id: e.user.id, name: e.user.fullName, reason: e.reason }))
      );
    }

    const result = schedulable.map(m => ({
      id: m.id,
      fullName: m.fullName || `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || m.email,
      email: m.email,
      role: m.role,
      roleId: m.roleId,
      // Include schedulability info for client-side diagnostics
      isSchedulable: m.isSchedulable,
    }));

    res.json(result);
  })
);

// GET /api/team - List all team members with pagination
router.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { params, explicit } = parsePaginationLenient(req.query);

    const members = await storage.getTeamMembers(req.companyId!);
    const sanitized = members.map(m => ({
      ...m,
      password: undefined,
    }));

    const offset = params.offset ?? 0;
    const { items, meta } = applyOffsetPagination(sanitized, offset, params.limit);

    res.json(paginatedCompat(items, meta, explicit));
  })
);

// GET /api/team/:userId - Get single team member with full details
router.get(
  "/:userId",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId } = req.params;
    const member = await storage.getTeamMember(req.companyId!, userId);

    if (!member) {
      throw createError(404, "Team member not found");
    }

    const [profile, workingHours, permissionOverrides] = await Promise.all([
      storage.getTechnicianProfile(userId),
      storage.getWorkingHours(userId),
      storage.getUserPermissionOverrides(userId),
    ]);

    res.json({
      ...member,
      password: undefined,
      profile,
      workingHours,
      permissionOverrides,
    });
  })
);

// PATCH /api/team/:userId - Update team member basic info
router.patch(
  "/:userId",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId } = req.params;
    const companyId = req.companyId!;

    const data = validateSchema(updateTeamMemberSchema, req.body);

    // Build update payload
    const updatePayload: Record<string, any> = { ...data };

    // Resolve roleId to role name and validate
    if (data.roleId) {
      const { getRolesWithPermissions } = await import("../permissions");
      const allRoles = await getRolesWithPermissions();
      const newRole = allRoles.find(r => r.id === data.roleId);

      if (!newRole) {
        throw createError(400, `Invalid roleId: ${data.roleId}. Role not found.`);
      }

      // Last-owner safeguard when changing from owner to non-owner
      const member = await storage.getTeamMember(companyId, userId);
      if (member && member.role === "owner" && newRole.name !== "owner") {
        await assertLastOwnerProtection(companyId, userId, "demote");
      }

      // Set the legacy role field from the roleId lookup
      updatePayload.role = newRole.name;
    }

    // Compute fullName from firstName/lastName if both provided but not fullName
    if ((data.firstName || data.lastName) && !data.fullName) {
      updatePayload.fullName = `${data.firstName || ""} ${data.lastName || ""}`.trim() || null;
    }

    const updated = await storage.updateTeamMember(companyId, userId, updatePayload);
    if (!updated) {
      throw createError(404, "Team member not found");
    }

    res.json({ ...updated, password: undefined });
  })
);

// POST /api/team/:userId/deactivate - Deactivate team member
router.post(
  "/:userId/deactivate",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId } = req.params;
    const companyId = req.companyId!;
    const actorUserId = req.user!.id;

    // Self-lockout protection
    assertNoSelfLockout(actorUserId, userId, "disable");

    const member = await storage.getTeamMember(companyId, userId);
    if (!member) {
      throw createError(404, "Team member not found");
    }

    // Last-owner safeguard
    if (member.role === "owner") {
      await assertLastOwnerProtection(companyId, userId, "deactivate");
    }

    // Last-admin safeguard
    if (member.role === "admin") {
      await assertLastAdminProtection(companyId, userId, "deactivate");
    }

    const updated = await storage.deactivateTeamMember(companyId, userId);
    if (!updated) {
      throw createError(404, "Team member not found");
    }

    // Audit log
    await logUserDisabled(req, companyId, actorUserId, userId);

    res.json({ ...updated, password: undefined });
  })
);

// POST /api/team/:userId/activate - Activate team member
router.post(
  "/:userId/activate",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId } = req.params;
    const companyId = req.companyId!;
    const actorUserId = req.user!.id;

    const member = await storage.getTeamMember(companyId, userId);
    if (!member) {
      throw createError(404, "Team member not found");
    }

    const updated = await storage.activateTeamMember(companyId, userId);
    if (!updated) {
      throw createError(404, "Team member not found");
    }

    // Audit log
    await logUserEnabled(req, companyId, actorUserId, userId);

    res.json({ ...updated, password: undefined });
  })
);

// PATCH /api/team/:userId/role - Change user role (with last-owner safeguard)
// Phase A Security Fix: Enforce role hierarchy to prevent privilege escalation
router.patch(
  "/:userId/role",
  requireRole(["owner", "admin"]),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId } = req.params;
    const companyId = req.companyId!;
    const actorUserId = req.user!.id;
    const changerRole = req.user!.role as Role;

    const { role: newRole } = validateSchema(updateRoleSchema, req.body);

    // Self-demotion protection
    if (actorUserId === userId && changerRole !== newRole) {
      assertNoSelfLockout(actorUserId, userId, "demote");
    }

    // Phase A Security Fix: Enforce role hierarchy
    if (!canAssignRole(changerRole, newRole as Role)) {
      throw createError(403, `Insufficient permissions to assign role: ${newRole}`);
    }

    const member = await storage.getTeamMember(companyId, userId);
    if (!member) {
      throw createError(404, "Team member not found");
    }

    const oldRole = member.role;

    // Safeguard: Cannot demote the last active owner
    if (member.role === "owner" && newRole !== "owner") {
      await assertLastOwnerProtection(companyId, userId, "demote");
    }

    // Safeguard: Cannot demote the last active admin
    if (member.role === "admin" && newRole !== "admin" && newRole !== "owner") {
      await assertLastAdminProtection(companyId, userId, "demote");
    }

    const updated = await storage.updateTeamMember(companyId, userId, { role: newRole });
    if (!updated) {
      throw createError(404, "Team member not found");
    }

    // Audit log
    await logRoleChanged(req, companyId, actorUserId, userId, {
      oldRole,
      newRole,
    });

    res.json({ ...updated, password: undefined });
  })
);

// PATCH /api/team/:userId/status - Toggle active/inactive status (with last-owner safeguard)
router.patch(
  "/:userId/status",
  requireRole(["owner", "admin"]),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId } = req.params;
    const companyId = req.companyId!;

    const { active } = validateSchema(updateStatusSchema, req.body);

    if (userId === req.user!.id && !active) {
      throw createError(400, "Cannot deactivate your own account");
    }

    const member = await storage.getTeamMember(companyId, userId);
    if (!member) {
      throw createError(404, "Team member not found");
    }

    // Safeguard: Cannot deactivate the last active owner
    if (!active && member.role === "owner") {
      await assertLastOwnerProtection(companyId, userId, "deactivate");
    }

    // Use dedicated methods that sync both status and disabled flag
    const updated = active
      ? await storage.activateTeamMember(companyId, userId)
      : await storage.deactivateTeamMember(companyId, userId);

    if (!updated) {
      throw createError(404, "Team member not found");
    }

    res.json({ ...updated, password: undefined });
  })
);

// PUT /api/team/:userId/profile - Update technician profile
router.put(
  "/:userId/profile",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId } = req.params;

    const member = await storage.getTeamMember(req.companyId!, userId);
    if (!member) {
      throw createError(404, "Team member not found");
    }

    const data = validateSchema(updateTechnicianProfileSchema, req.body);
    // Convert numeric fields to strings for storage
    const profileData = {
      ...data,
      laborCostPerHour: data.laborCostPerHour != null ? String(data.laborCostPerHour) : data.laborCostPerHour,
      billableRatePerHour: data.billableRatePerHour != null ? String(data.billableRatePerHour) : data.billableRatePerHour,
    };
    const profile = await storage.upsertTechnicianProfile(userId, profileData);

    res.json(profile);
  })
);

// PUT /api/team/:userId/working-hours - Set working hours
router.put(
  "/:userId/working-hours",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId } = req.params;

    const member = await storage.getTeamMember(req.companyId!, userId);
    if (!member) {
      throw createError(404, "Team member not found");
    }

    const { hours } = validateSchema(setWorkingHoursSchema, req.body);
    const workingHours = await storage.setWorkingHours(userId, hours);

    res.json(workingHours);
  })
);

// PUT /api/team/:userId/permissions - Set permission overrides
router.put(
  "/:userId/permissions",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId } = req.params;

    const member = await storage.getTeamMember(req.companyId!, userId);
    if (!member) {
      throw createError(404, "Team member not found");
    }

    const { overrides } = validateSchema(setPermissionOverridesSchema, req.body);
    await storage.setUserPermissionOverrides(userId, overrides);
    const updated = await storage.getUserPermissionOverrides(userId);

    res.json(updated);
  })
);

// GET /api/team/:userId/effective-permissions - Get user's effective permissions
router.get(
  "/:userId/effective-permissions",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId } = req.params;

    const member = await storage.getTeamMember(req.companyId!, userId);
    if (!member) {
      throw createError(404, "Team member not found");
    }

    const { getUserEffectivePermissions } = await import("../permissions");
    const permissionSet = await getUserEffectivePermissions(userId);

    res.json(Array.from(permissionSet));
  })
);

// ========================================
// EMAIL IDENTITY MANAGEMENT
// ========================================

const updateEmailSchema = z.object({
  email: z.string().email().transform(e => e.trim().toLowerCase()),
});

const updatePasswordSchema = z.object({
  password: z.string().min(10, "Password must be at least 10 characters"),
});

/**
 * PUT /api/team/:userId/email
 * Update user's login email (via user_identities)
 * Also mirrors to users.email for backward compatibility
 *
 * POLICY: Each email can only belong to one company globally.
 */
router.put(
  "/:userId/email",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId } = req.params;
    const companyId = req.companyId!;
    const actorUserId = req.user!.id;

    const { email: newEmail } = validateSchema(updateEmailSchema, req.body);

    // Check if user exists
    const member = await storage.getTeamMember(companyId, userId);
    if (!member) {
      throw createError(404, "Team member not found");
    }

    const oldEmail = member.email;

    // Check global email availability (not just within company)
    const globalCheck = await storage.isEmailGloballyAvailable(newEmail, userId);
    if (!globalCheck.available) {
      throw createError(400,
        "This email is already in use. Each email can only belong to one company. " +
        "If this person works for multiple companies, they must use a different email."
      );
    }

    // Update the email identity
    const updatedIdentity = await storage.updateEmailIdentity(companyId, userId, newEmail, {
      setVerified: true, // Admin-set emails are trusted
    });

    if (!updatedIdentity) {
      throw createError(500, "Failed to update email identity");
    }

    // Mirror to users.email for backward compatibility
    await storage.updateTeamMember(companyId, userId, { email: newEmail } as any);

    // Invalidate all existing sessions for this user
    await storage.incrementTokenVersion(userId);

    // Audit log
    await logEmailChanged(req, companyId, actorUserId, userId, {
      oldEmail,
      newEmail,
    });

    res.json({
      success: true,
      email: newEmail,
      message: "Email updated successfully. User will need to log in again.",
    });
  })
);

/**
 * PUT /api/team/:userId/password
 * Reset/change user's password (admin operation)
 * Invalidates all existing sessions for the user.
 */
router.put(
  "/:userId/password",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId } = req.params;
    const companyId = req.companyId!;
    const actorUserId = req.user!.id;

    const { password } = validateSchema(updatePasswordSchema, req.body);

    // Check if user exists
    const member = await storage.getTeamMember(companyId, userId);
    if (!member) {
      throw createError(404, "Team member not found");
    }

    // Hash the new password
    const passwordHash = await bcrypt.hash(password, 10);

    // Update the password on identity
    const updatedIdentity = await storage.setEmailPassword(companyId, userId, passwordHash, true);

    if (!updatedIdentity) {
      throw createError(500, "Failed to update password");
    }

    // Invalidate all existing sessions for this user
    await storage.incrementTokenVersion(userId);

    // Audit log
    await logPasswordReset(req, companyId, actorUserId, userId);

    res.json({
      success: true,
      message: "Password updated successfully. User will need to log in again.",
    });
  })
);

/**
 * GET /api/team/:userId/identities
 * Get all login identities for a user
 */
router.get(
  "/:userId/identities",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId } = req.params;
    const companyId = req.companyId!;

    const member = await storage.getTeamMember(companyId, userId);
    if (!member) {
      throw createError(404, "Team member not found");
    }

    const identities = await storage.getUserIdentities(companyId, userId);

    // Don't expose password hashes
    const safeIdentities = identities.map(i => ({
      id: i.id,
      provider: i.provider,
      identifier: i.identifier,
      verified: !!i.verifiedAt,
      verifiedAt: i.verifiedAt,
      createdAt: i.createdAt,
    }));

    res.json(safeIdentities);
  })
);

export default router;
