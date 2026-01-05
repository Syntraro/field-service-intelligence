import { Router, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage/index";
import { requireRole } from "../auth/requireRole";

const router = Router();

const MANAGER_ROLES = ["owner", "admin", "manager"];

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

router.get("/", async (req, res) => {
  try {
    const members = await storage.getTeamMembers(req.companyId!);
    const sanitized = members.map(m => ({
      ...m,
      password: undefined,
    }));
    res.json(sanitized);
  } catch (error) {
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
    
    const validation = updateTeamMemberSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validation.error.errors 
      });
    }

    const updated = await storage.updateTeamMember(req.companyId!, userId, validation.data);
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

    if (userId === req.user!.id) {
      return res.status(400).json({ error: "Cannot deactivate your own account" });
    }

    const updated = await storage.deactivateTeamMember(req.companyId!, userId);
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

    const updated = await storage.updateTeamMember(req.companyId!, userId, {
      status: 'active'
    });

    if (!updated) {
      return res.status(404).json({ error: "Team member not found" });
    }

    res.json({ ...updated, password: undefined });
  } catch (error) {
    console.error('Activate team member error:', error);
    res.status(500).json({ error: "Failed to activate team member" });
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