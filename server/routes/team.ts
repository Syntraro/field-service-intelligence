import { Router, Response } from "express";
import { z } from "zod";
import { storage } from "../storage/index";
import { requireRole } from "../auth/requireRole";
import { RESTRICTED_MANAGER_ROLES } from "../auth/roles";
import { parsePaginationLenient, applyOffsetPagination } from "../utils/pagination";
import { paginatedCompat } from "../utils/paginatedResponse";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { assertLastOwnerProtection } from "../guards/ownershipGuards";
import { AuthedRequest } from "../auth/tenantIsolation";

const router = Router();

const MANAGER_ROLES = RESTRICTED_MANAGER_ROLES;

// ========================================
// VALIDATION SCHEMAS
// ========================================

const updateTeamMemberSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  fullName: z.string().min(1).max(200).optional(),
  phone: z.string().max(20).optional(),
  roleId: z.string().uuid().optional(),
  status: z.enum(["active", "inactive"]).optional(),
  useCustomSchedule: z.boolean().optional(),
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
// ROUTES
// ========================================

// GET /api/team/technicians - Get technicians for assignment dropdowns
router.get(
  "/technicians",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const members = await storage.getTeamMembers(req.companyId!);
    const technicians = members
      .filter(m => m.status === "active")
      .map(m => ({
        id: m.id,
        fullName: m.fullName || `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || m.email,
        email: m.email,
        role: m.role,
      }));

    res.json(technicians);
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

    // Last-owner safeguard when changing roleId
    if (data.roleId) {
      const member = await storage.getTeamMember(companyId, userId);
      if (member && member.role === "owner") {
        const { getRolesWithPermissions } = await import("../permissions");
        const allRoles = await getRolesWithPermissions();
        const newRole = allRoles.find(r => r.id === data.roleId);

        if (newRole && newRole.name !== "owner") {
          await assertLastOwnerProtection(companyId, userId, "demote");
        }
      }
    }

    const updated = await storage.updateTeamMember(companyId, userId, data);
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

    if (userId === req.user!.id) {
      throw createError(400, "Cannot deactivate your own account");
    }

    // Last-owner safeguard
    const member = await storage.getTeamMember(companyId, userId);
    if (member?.role === "owner") {
      await assertLastOwnerProtection(companyId, userId, "deactivate");
    }

    const updated = await storage.deactivateTeamMember(companyId, userId);
    if (!updated) {
      throw createError(404, "Team member not found");
    }

    res.json({ ...updated, password: undefined });
  })
);

// POST /api/team/:userId/activate - Activate team member
router.post(
  "/:userId/activate",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId } = req.params;

    const member = await storage.getTeamMember(req.companyId!, userId);
    if (!member) {
      throw createError(404, "Team member not found");
    }

    const updated = await storage.activateTeamMember(req.companyId!, userId);
    if (!updated) {
      throw createError(404, "Team member not found");
    }

    res.json({ ...updated, password: undefined });
  })
);

// PATCH /api/team/:userId/role - Change user role (with last-owner safeguard)
router.patch(
  "/:userId/role",
  requireRole(["owner", "admin"]),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId } = req.params;
    const companyId = req.companyId!;

    const { role: newRole } = validateSchema(updateRoleSchema, req.body);

    const member = await storage.getTeamMember(companyId, userId);
    if (!member) {
      throw createError(404, "Team member not found");
    }

    // Safeguard: Cannot demote the last active owner
    if (member.role === "owner" && newRole !== "owner") {
      await assertLastOwnerProtection(companyId, userId, "demote");
    }

    const updated = await storage.updateTeamMember(companyId, userId, { role: newRole });
    if (!updated) {
      throw createError(404, "Team member not found");
    }

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

export default router;
