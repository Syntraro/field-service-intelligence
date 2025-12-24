import { Router, Request, Response } from "express";
import { storage } from "../storage/index";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const members = await storage.getTeamMembers(req.companyId);
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
    const member = await storage.getTeamMember(req.companyId, userId);
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

router.patch("/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { firstName, lastName, fullName, phone, roleId, status, useCustomSchedule } = req.body;

    const updated = await storage.updateTeamMember(req.companyId, userId, {
      firstName,
      lastName,
      fullName,
      phone,
      roleId,
      status,
      useCustomSchedule,
    });

    if (!updated) {
      return res.status(404).json({ error: "Team member not found" });
    }

    res.json({ ...updated, password: undefined });
  } catch (error) {
    console.error('Update team member error:', error);
    res.status(500).json({ error: "Failed to update team member" });
  }
});

router.post("/:userId/deactivate", async (req, res) => {
  try {
    const { userId } = req.params;

    if (userId === req.user!.id) {
      return res.status(400).json({ error: "Cannot deactivate your own account" });
    }

    const updated = await storage.deactivateTeamMember(req.companyId, userId);
    if (!updated) {
      return res.status(404).json({ error: "Team member not found" });
    }

    res.json({ ...updated, password: undefined });
  } catch (error) {
    console.error('Deactivate team member error:', error);
    res.status(500).json({ error: "Failed to deactivate team member" });
  }
});

router.post("/:userId/activate", async (req, res) => {
  try {
    const { userId } = req.params;

    const member = await storage.getTeamMember(req.companyId, userId);
    if (!member) {
      return res.status(404).json({ error: "Team member not found" });
    }

    const updated = await storage.updateTeamMember(req.companyId, userId, {
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

router.put("/:userId/profile", async (req, res) => {
  try {
    const { userId } = req.params;

    const member = await storage.getTeamMember(req.companyId, userId);
    if (!member) {
      return res.status(404).json({ error: "Team member not found" });
    }

    const { laborCostPerHour, billableRatePerHour, color, phone, note } = req.body;

    const profile = await storage.upsertTechnicianProfile(userId, {
      laborCostPerHour,
      billableRatePerHour,
      color,
      phone,
      note,
    });

    res.json(profile);
  } catch (error) {
    console.error('Update technician profile error:', error);
    res.status(500).json({ error: "Failed to update technician profile" });
  }
});

router.put("/:userId/working-hours", async (req, res) => {
  try {
    const { userId } = req.params;

    const member = await storage.getTeamMember(req.companyId, userId);
    if (!member) {
      return res.status(404).json({ error: "Team member not found" });
    }

    const { hours } = req.body;
    if (!Array.isArray(hours)) {
      return res.status(400).json({ error: "hours must be an array" });
    }

    const workingHours = await storage.setWorkingHours(userId, hours);
    res.json(workingHours);
  } catch (error) {
    console.error('Set working hours error:', error);
    res.status(500).json({ error: "Failed to set working hours" });
  }
});

router.put("/:userId/permissions", async (req, res) => {
  try {
    const { userId } = req.params;

    const member = await storage.getTeamMember(req.companyId, userId);
    if (!member) {
      return res.status(404).json({ error: "Team member not found" });
    }

    const { overrides } = req.body;
    if (!Array.isArray(overrides)) {
      return res.status(400).json({ error: "overrides must be an array" });
    }

    await storage.setUserPermissionOverrides(userId, overrides);
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

    const member = await storage.getTeamMember(req.companyId, userId);
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