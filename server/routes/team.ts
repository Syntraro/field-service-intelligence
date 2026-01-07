import { Router, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage/index";
import { requireRole } from "../auth/requireRole";
import { RESTRICTED_MANAGER_ROLES } from "../auth/roles";
import { parsePaginationLenient, applyOffsetPagination } from "../utils/pagination";
import { paginatedCompat } from "../utils/paginatedResponse";

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

const updateTechnicianProfileSchema = z.object({
  laborCostPerHour: z.union([
    z.string().regex(/^\d+(\.\d{1,2})?$/),
    z.number().min(0).max(999.99)
  ]).transform(v => {
    const s = String(v);
    return s === "" ? null : s;
  }).nullable().optional(),
  billableRatePerHour: z.union([
    z.string().regex(/^\d+(\.\d{1,2})?$/),
    z.number().min(0).max(999.99)
  ]).transform(v => {
    const s = String(v);
    return s === "" ? null : s;
  }).nullable().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  phone: z.string().max(20).transform(v => v === "" ? null : v).nullable().optional(),
  note: z.string().max(1000).transform(v => v === "" ? null : v).nullable().optional(),
});

const setWorkingHoursSchema = z.object({
  hours: z.array(z.object({
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional().nullable(),
    endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional().nullable(),
    isWorking: z.boolean(),
  })),
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

// GET /api/team/technicians - Get technicians for assignment dropdowns
router.get("/technicians", async (req, res) => {
  try {
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
  } catch (error) {
    console.error('Get technicians error:', error);
    res.status(500).json({ error: "Failed to get technicians" });
  }
});

router.get("/", async (req, res) => {
  try {
    const { params, explicit } = parsePaginationLenient(req.query);
    
    // Fetch all members (storage already orders by fullName)
    const members = await storage.getTeamMembers(req.companyId!);
    const sanitized = members.map(m => ({
      ...m,
      password: undefined,
    }));
    
    // Apply pagination
    const offset = params.offset ?? 0;
    const { items, meta } = applyOffsetPagination(sanitized, offset, params.limit);
    
    res.json(paginatedCompat(items, meta, explicit));
  } catch (error: any) {
    if (error?.status === 400) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Get team members error:', error);
    res.status(500).json({ error: "Failed to get team members" });
  }
});

router.get("/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const member = await storage.getTeamMember(req.companyId!, userId);
    if (!member) {
      return res.status(404).json({ error: "Team member not found" });
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
  } catch (error) {
    console.error('Get team member error:', error);
    res.status(500).json({ error: "Failed to get team member" });
  }
});

router.patch("/:userId", requireRole(MANAGER_ROLES), async (req, res) => {
  try {
    const { userId } = req.params;
    const companyId = req.companyId!;
    
    const validation = updateTeamMemberSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validation.error.errors 
      });
    }

    // Last-owner safeguard when changing roleId
    if (validation.data.roleId) {
      const member = await storage.getTeamMember(companyId, userId);
      if (member && member.role === "owner") {
        // Check if the new role is owner (need to lookup by roleId)
        const { getRolesWithPermissions } = await import("../permissions");
        const allRoles = await getRolesWithPermissions();
        const newRole = allRoles.find(r => r.id === validation.data.roleId);
        
        // If changing from owner to non-owner, check safeguard
        if (newRole && newRole.name !== "owner") {
          const allMembers = await storage.getTeamMembers(companyId);
          const activeOwners = allMembers.filter(m => m.role === "owner" && m.status === "active");
          
          if (activeOwners.length <= 1) {
            return res.status(400).json({ 
              error: "Cannot demote the last active owner. Promote another user to owner first." 
            });
          }
        }
      }
    }

    const updated = await storage.updateTeamMember(companyId, userId, validation.data);
    if (!updated) {
      return res.status(404).json({ error: "Team member not found" });
    }

    res.json({ ...updated, password: undefined });
  } catch (error) {
    console.error('Update team member error:', error);
    res.status(500).json({ error: "Failed to update team member" });
  }
});

router.post("/:userId/deactivate", requireRole(MANAGER_ROLES), async (req, res) => {
  try {
    const { userId } = req.params;
    const companyId = req.companyId!;

    if (userId === req.user!.id) {
      return res.status(400).json({ error: "Cannot deactivate your own account" });
    }

    // Last-owner safeguard
    const member = await storage.getTeamMember(companyId, userId);
    if (member && member.role === "owner") {
      const allMembers = await storage.getTeamMembers(companyId);
      const activeOwners = allMembers.filter(m => m.role === "owner" && m.status === "active");
      
      if (activeOwners.length <= 1) {
        return res.status(400).json({ 
          error: "Cannot deactivate the last active owner. Promote another user to owner first." 
        });
      }
    }

    const updated = await storage.deactivateTeamMember(companyId, userId);
    if (!updated) {
      return res.status(404).json({ error: "Team member not found" });
    }

    res.json({ ...updated, password: undefined });
  } catch (error) {
    console.error('Deactivate team member error:', error);
    res.status(500).json({ error: "Failed to deactivate team member" });
  }
});

router.post("/:userId/activate", requireRole(MANAGER_ROLES), async (req, res) => {
  try {
    const { userId } = req.params;

    const member = await storage.getTeamMember(req.companyId!, userId);
    if (!member) {
      return res.status(404).json({ error: "Team member not found" });
    }

    // Set both status to active and disabled to false
    const updated = await storage.activateTeamMember(req.companyId!, userId);

    if (!updated) {
      return res.status(404).json({ error: "Team member not found" });
    }

    res.json({ ...updated, password: undefined });
  } catch (error) {
    console.error('Activate team member error:', error);
    res.status(500).json({ error: "Failed to activate team member" });
  }
});

// PATCH /api/team/:userId/role - Change user role (with last-owner safeguard)
router.patch("/:userId/role", requireRole(["owner", "admin"]), async (req, res) => {
  try {
    const { userId } = req.params;
    const companyId = req.companyId!;
    
    const validation = updateRoleSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validation.error.errors 
      });
    }
    
    const { role: newRole } = validation.data;

    const member = await storage.getTeamMember(companyId, userId);
    if (!member) {
      return res.status(404).json({ error: "Team member not found" });
    }

    // Safeguard: Cannot demote the last active owner
    if (member.role === "owner" && newRole !== "owner") {
      const allMembers = await storage.getTeamMembers(companyId);
      const activeOwners = allMembers.filter(m => m.role === "owner" && m.status === "active");
      
      if (activeOwners.length <= 1) {
        return res.status(400).json({ 
          error: "Cannot demote the last active owner. Promote another user to owner first." 
        });
      }
    }

    const updated = await storage.updateTeamMember(companyId, userId, { role: newRole });
    if (!updated) {
      return res.status(404).json({ error: "Team member not found" });
    }

    res.json({ ...updated, password: undefined });
  } catch (error) {
    console.error('Update role error:', error);
    res.status(500).json({ error: "Failed to update role" });
  }
});

// PATCH /api/team/:userId/status - Toggle active/inactive status (with last-owner safeguard)
router.patch("/:userId/status", requireRole(["owner", "admin"]), async (req, res) => {
  try {
    const { userId } = req.params;
    const companyId = req.companyId!;
    
    const validation = updateStatusSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validation.error.errors 
      });
    }
    
    const { active } = validation.data;

    if (userId === req.user!.id && !active) {
      return res.status(400).json({ error: "Cannot deactivate your own account" });
    }

    const member = await storage.getTeamMember(companyId, userId);
    if (!member) {
      return res.status(404).json({ error: "Team member not found" });
    }

    // Safeguard: Cannot deactivate the last active owner
    if (!active && member.role === "owner") {
      const allMembers = await storage.getTeamMembers(companyId);
      const activeOwners = allMembers.filter(m => m.role === "owner" && m.status === "active");
      
      if (activeOwners.length <= 1) {
        return res.status(400).json({ 
          error: "Cannot deactivate the last active owner. Promote another user to owner first." 
        });
      }
    }

    // Use dedicated methods that sync both status and disabled flag
    let updated;
    if (active) {
      updated = await storage.activateTeamMember(companyId, userId);
    } else {
      updated = await storage.deactivateTeamMember(companyId, userId);
    }
    
    if (!updated) {
      return res.status(404).json({ error: "Team member not found" });
    }

    res.json({ ...updated, password: undefined });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({ error: "Failed to update status" });
  }
});

router.put("/:userId/profile", requireRole(MANAGER_ROLES), async (req, res) => {
  try {
    const { userId } = req.params;

    const member = await storage.getTeamMember(req.companyId!, userId);
    if (!member) {
      return res.status(404).json({ error: "Team member not found" });
    }

    const validation = updateTechnicianProfileSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validation.error.errors 
      });
    }

    const profile = await storage.upsertTechnicianProfile(userId, validation.data);
    res.json(profile);
  } catch (error) {
    console.error('Update technician profile error:', error);
    res.status(500).json({ error: "Failed to update technician profile" });
  }
});

router.put("/:userId/working-hours", requireRole(MANAGER_ROLES), async (req, res) => {
  try {
    const { userId } = req.params;

    const member = await storage.getTeamMember(req.companyId!, userId);
    if (!member) {
      return res.status(404).json({ error: "Team member not found" });
    }

    const validation = setWorkingHoursSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validation.error.errors 
      });
    }

    const workingHours = await storage.setWorkingHours(userId, validation.data.hours);
    res.json(workingHours);
  } catch (error) {
    console.error('Set working hours error:', error);
    res.status(500).json({ error: "Failed to set working hours" });
  }
});

router.put("/:userId/permissions", requireRole(MANAGER_ROLES), async (req, res) => {
  try {
    const { userId } = req.params;

    const member = await storage.getTeamMember(req.companyId!, userId);
    if (!member) {
      return res.status(404).json({ error: "Team member not found" });
    }

    const validation = setPermissionOverridesSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validation.error.errors 
      });
    }

    await storage.setUserPermissionOverrides(userId, validation.data.overrides);
    const updated = await storage.getUserPermissionOverrides(userId);
    res.json(updated);
  } catch (error) {
    console.error('Set permission overrides error:', error);
    res.status(500).json({ error: "Failed to set permission overrides" });
  }
});

router.get("/:userId/effective-permissions", async (req, res) => {
  try {
    const { userId } = req.params;

    const member = await storage.getTeamMember(req.companyId!, userId);
    if (!member) {
      return res.status(404).json({ error: "Team member not found" });
    }

    const { getUserEffectivePermissions } = await import("../permissions");
    const permissionSet = await getUserEffectivePermissions(userId);
    res.json(Array.from(permissionSet));
  } catch (error) {
    console.error('Get effective permissions error:', error);
    res.status(500).json({ error: "Failed to get effective permissions" });
  }
});

export default router;