import { Router, Response } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { storage } from "../storage/index";
import { requireRole } from "../auth/requireRole";
import { RESTRICTED_MANAGER_ROLES, canAssignRole, type Role, ADMIN_ROLES } from "../auth/roles";
import { parsePaginationLenient, applyOffsetPagination } from "../utils/pagination";
import { certificationExpiresAtSchema } from "../utils/certExpiresAtSchema";
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
  logAuditEvent,
} from "../services/auditService";
import { getRolesWithPermissions } from "../permissions";
import { filterSchedulableTechnicians } from "../domain/scheduling";
import { timeTrackingRepository } from "../storage/timeTracking";
import { identityRepository } from "../storage/identities";
import { requestPasswordReset } from "../services/passwordResetService";
// 2026-04-21 Phase 1 canonical policy architecture: per-tenant seat limits
// on the create path read the canonical entitlement resolver.
import { assertFeatureCapacityAuto } from "../services/entitlementEnforcement";
// 2026-04-21 Phase 1 canonical policy architecture: per-user permission
// override API. Coarse+fine gate (owner/admin role → permissions.manage).
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { permissions, userPermissionOverrides } from "@shared/schema";
import { requirePermission } from "../permissions";
import { clearPermissionCache, permissionRepository } from "../storage/permissions";
import {
  getTeamMetrics,
  getMemberMonthlyPerformance,
  getLeadConversionMetrics,
  type MetricsPeriod,
} from "../storage/teamMetrics";
import { computeEfficiencyScore } from "../lib/efficiencyScore";
import {
  technicianScheduleOverrideRepository,
  computeEffectiveScheduleRange,
} from "../storage/technicianSchedule";
import { insertTechnicianScheduleOverrideSchema } from "@shared/schema";

const router = Router();

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
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    // 2026-04-21 Phase 2: catalog lives in the DB (seeded by the
    // 2026_04_21_seed_rbac_catalog.sql migration). The runtime
    // ensureRolesAndPermissionsSeeded() helper was deleted.
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
  requireRole(RESTRICTED_MANAGER_ROLES),
  // 2026-05-04 PR 4: team.manage on create. Role-assignment paths
  // (PATCH /:userId/role, PATCH /:userId/status) intentionally NOT
  // gated here — they keep their owner/admin role gate per the
  // matrix doc; team.manage covers invite/edit/deactivate/schedule.
  requirePermission("team.manage"),
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

    // 2026-04-21 Phase 1 canonical policy architecture: enforce per-plan
    // seat caps (technician_users vs office_users) against the canonical
    // entitlement resolver. The resolver returns `isCore`/`isUnlimited`
    // so enforcement no-ops for plans that do not cap these features.
    const capacityFeatureKey =
      resolvedRole === "technician" ? "technician_users" : "office_users";
    await assertFeatureCapacityAuto(companyId, capacityFeatureKey, 1);

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

// GET /api/team/technicians - Technician projection for calendar/assignment dropdowns.
// Default behavior: canonical filterSchedulableTechnicians() — excludes disabled
// users AND users where isSchedulable=false (hidden from calendar).
// ?includeHidden=true: also include isSchedulable=false members (but still exclude
// disabled). The Schedules tab uses this so admins can edit and re-enable calendar
// visibility for members they have hidden — without this escape hatch, toggling
// "Show on calendar" off would remove the member from the Schedules UI and leave
// no way to toggle visibility back on. Does NOT filter by role or status.
router.get(
  "/technicians",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const includeHidden = req.query.includeHidden === "true";

    const members = await storage.getTeamMembers(req.companyId!);
    // 2026-03-31: Fetch canonical technician colors from technicianProfiles
    const colorMap = await storage.getTechnicianColors(req.companyId!);
    // 2026-04-03: Fetch labour cost rates for Add Time modal cost-per-hour field
    const rateMap = await storage.getTechnicianRates(req.companyId!);

    let visibleMembers: typeof members;
    if (includeHidden) {
      // Schedules-tab view: active members regardless of calendar visibility.
      visibleMembers = members.filter((m) => m.disabled !== true);
    } else {
      // Dispatch/calendar dropdowns: canonical filter with diagnostics.
      const { schedulable, excluded } = filterSchedulableTechnicians(
        members,
        "GET /api/team/technicians"
      );
      if (process.env.NODE_ENV === "development" && excluded.length > 0) {
        console.log(
          `[/api/team/technicians] Excluded ${excluded.length} technicians from dropdown:`,
          excluded.map(e => ({ id: e.user.id, name: e.user.fullName, reason: e.reason }))
        );
      }
      visibleMembers = schedulable;
    }

    const result = visibleMembers.map(m => ({
      id: m.id,
      fullName: m.fullName || `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || m.email,
      email: m.email,
      role: m.role,
      roleId: m.roleId,
      isSchedulable: m.isSchedulable,
      color: colorMap.get(m.id) ?? null,
      laborCostPerHour: rateMap.get(m.id) ?? null,
    }));

    res.json(result);
  })
);

// GET /api/team/technicians/live-state - 2026-04-10
// Dispatcher visibility projection: derived clocked_in/clocked_out + en_route /
// on_site / paused / idle for every schedulable technician. Single canonical
// projection used by the dispatch board sidebar so the office never has to
// stitch attendance + visit state on the client.
//
// Same auth model as the other technicians endpoints (read-only, all auth
// users can read; the global tenantIsolation middleware enforces companyId).
router.get(
  "/technicians/live-state",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const members = await storage.getTeamMembers(companyId);
    // Match the schedulable filter used by the existing /technicians endpoint
    // so the live-state map and the technician roster always agree on which
    // techs exist.
    const { schedulable } = filterSchedulableTechnicians(
      members,
      "GET /api/team/technicians/live-state",
    );
    const ids = schedulable.map((m) => m.id);

    const states = await timeTrackingRepository.getTechnicianLiveStates(companyId, ids);

    res.json(states);
  })
);

// GET /api/team/technicians/working-hours - Bulk working hours for all schedulable technicians
// Returns per-technician working hours (7 days each) plus company business hours as fallback.
// Used by dispatch board to determine on-shift vs off-shift grouping.
router.get(
  "/technicians/working-hours",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const members = await storage.getTeamMembers(companyId);
    const { schedulable } = filterSchedulableTechnicians(members, "GET /api/team/technicians/working-hours");

    // Fetch company business hours (fallback for techs without custom schedule)
    const companyHours = await storage.getCompanyBusinessHours(companyId);

    // Fetch working hours for all schedulable technicians in parallel
    const techHoursEntries = await Promise.all(
      schedulable.map(async (m) => {
        const hours = await storage.getWorkingHours(m.id);
        return { technicianId: m.id, useCustomSchedule: m.useCustomSchedule ?? false, hours };
      })
    );

    // Build response: per-technician schedule (custom or company default)
    const technicianSchedules = techHoursEntries.map(({ technicianId, useCustomSchedule, hours }) => {
      if (useCustomSchedule && hours.length > 0) {
        return {
          technicianId,
          source: "custom" as const,
          days: hours.map(h => ({
            dayOfWeek: h.dayOfWeek,
            isWorking: h.isWorking,
            startTime: h.startTime,
            endTime: h.endTime,
          })),
        };
      }
      // Fall back to company business hours
      return {
        technicianId,
        source: "company" as const,
        days: companyHours.map(ch => ({
          dayOfWeek: ch.dayOfWeek,
          isWorking: ch.isOpen,
          startTime: ch.startMinutes != null ? `${String(Math.floor(ch.startMinutes / 60)).padStart(2, "0")}:${String(ch.startMinutes % 60).padStart(2, "0")}` : null,
          endTime: ch.endMinutes != null ? `${String(Math.floor(ch.endMinutes / 60)).padStart(2, "0")}:${String(ch.endMinutes % 60).padStart(2, "0")}` : null,
        })),
      };
    });

    res.json({ technicianSchedules });
  })
);

// GET /api/team/metrics — Per-member operational metrics for the Team Hub.
// Returns hours, jobs completed, revenue per hour, utilization, and lead stats
// for every team member that had activity in the selected period.
// ?period=last_30_days | last_90_days | last_12_months  (default: last_30_days)
router.get(
  "/metrics",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const raw = req.query.period as string | undefined;
    const validPeriods: MetricsPeriod[] = ["last_30_days", "last_90_days", "last_12_months"];
    const period: MetricsPeriod = validPeriods.includes(raw as MetricsPeriod)
      ? (raw as MetricsPeriod)
      : "last_30_days";
    const members = await getTeamMetrics(req.companyId!, period);
    res.json({ period, members });
  })
);

// ── Team skill library routes ─────────────────────────────────────────────
// Static /skills/* routes MUST be registered before /:userId to prevent
// Express from treating "skills" as a userId parameter value.

// GET /api/team/skills — List the company skill library with member counts.
router.get(
  "/skills",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { listCompanySkills } = await import("../storage/teamSkills");
    const skills = await listCompanySkills(req.companyId!);
    res.json(skills);
  }),
);

const createSkillSchema = z.object({
  name: z.string().min(1).max(100),
  category: z.string().max(100).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  requiresCertification: z.boolean().optional(),
  hasExpiryTracking: z.boolean().optional(),
});

// POST /api/team/skills — Create a new skill in the company library.
router.post(
  "/skills",
  requireRole(RESTRICTED_MANAGER_ROLES),
  requirePermission("team.manage"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const body = validateSchema(createSkillSchema, req.body);
    const { createSkill } = await import("../storage/teamSkills");
    const skill = await createSkill(req.companyId!, body, req.user?.id);
    res.status(201).json(skill);
  }),
);

const updateSkillSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  category: z.string().max(100).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  requiresCertification: z.boolean().optional(),
  hasExpiryTracking: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

// PATCH /api/team/skills/:skillId — Edit skill metadata or active state.
router.patch(
  "/skills/:skillId",
  requireRole(RESTRICTED_MANAGER_ROLES),
  requirePermission("team.manage"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { skillId } = req.params;
    const body = validateSchema(updateSkillSchema, req.body);
    const { updateSkill } = await import("../storage/teamSkills");
    const skill = await updateSkill(req.companyId!, skillId, body, req.user?.id);
    res.json(skill);
  }),
);

// DELETE /api/team/skills/:skillId — Hard-delete if unused; rejects if active members assigned.
router.delete(
  "/skills/:skillId",
  requireRole(RESTRICTED_MANAGER_ROLES),
  requirePermission("team.manage"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { skillId } = req.params;
    const { deleteSkill } = await import("../storage/teamSkills");
    await deleteSkill(req.companyId!, skillId);
    res.status(204).end();
  }),
);

// GET /api/team/capacity-forecast — Workforce capacity + weekly tracking per member.
// Static route — must remain before /:userId.
router.get(
  "/capacity-forecast",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { getTeamCapacityForecast } = await import("../storage/capacityForecast");
    const data = await getTeamCapacityForecast(req.companyId!);
    res.json(data);
  }),
);

// GET /api/team/pm-forecast — Pending PM instance demand (count + estimated hours).
// Static route — must remain before /:userId.
router.get(
  "/pm-forecast",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { getPmForecast } = await import("../storage/capacityForecast");
    const data = await getPmForecast(req.companyId!);
    res.json(data);
  }),
);

// GET /api/team/skill-analytics — Phase 6: team skill coverage, expiry warnings, gaps.
// Static route — must remain before /:userId to avoid Express param capture.
router.get(
  "/skill-analytics",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { getSkillAnalytics } = await import("../storage/assignmentCandidates");
    const analytics = await getSkillAnalytics(req.companyId!);
    res.json(analytics);
  }),
);

// GET /api/team/technicians/skill-match — filter schedulable techs by skill.
// ?skillId=<uuid>
// Returns active, schedulable members who have the skill assigned.
// Static route under /technicians/* — already before /:userId.
router.get(
  "/technicians/skill-match",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const skillId = req.query.skillId as string | undefined;
    if (!skillId) throw createError(400, "skillId query parameter is required");
    const { getTechniciansBySkill } = await import("../storage/assignmentCandidates");
    const techs = await getTechniciansBySkill(req.companyId!, skillId);
    res.json(techs);
  }),
);

// GET /api/team - List all team members with pagination
// 2026-05-04 PR 4: `team.view` gate added. Per ACCESS_CONTROL_MATRIX.md,
// dispatchers and technicians do not have this permission by default
// — they should not see the full team roster (separate from the
// `/technicians` endpoints below, which remain operationally open
// for assignment/scheduling).
router.get(
  "/",
  requirePermission("team.view"),
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

// GET /api/team/:userId/workload-breakdown — Billable/Drive/General breakdown from time_entries.
// ?window=today|this_week|last_30_days
router.get(
  "/:userId/workload-breakdown",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId } = req.params;
    const member = await storage.getTeamMember(req.companyId!, userId);
    if (!member) throw createError(404, "Team member not found");

    const raw = req.query.window as string | undefined;
    const valid = ["today", "this_week", "last_30_days"] as const;
    const window = valid.includes(raw as typeof valid[number]) ? (raw as typeof valid[number]) : "last_30_days";

    const { getMemberWorkloadBreakdown } = await import("../storage/capacityForecast");
    const data = await getMemberWorkloadBreakdown(req.companyId!, userId, window);
    res.json(data);
  }),
);

// GET /api/team/:userId/performance — 12-month monthly trend for the Performance tab.
// Returns monthly breakdowns (hours, jobs, revenue, avg rev/hr) for charting,
// plus aggregate metrics for the same period in a single round trip.
router.get(
  "/:userId/performance",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId } = req.params;
    const member = await storage.getTeamMember(req.companyId!, userId);
    if (!member) throw createError(404, "Team member not found");

    const raw = req.query.period as string | undefined;
    const validPeriods: MetricsPeriod[] = ["last_30_days", "last_90_days", "last_12_months"];
    const period: MetricsPeriod = validPeriods.includes(raw as MetricsPeriod)
      ? (raw as MetricsPeriod)
      : "last_30_days";

    const [monthlyTrend, allMetrics, leadConversion] = await Promise.all([
      getMemberMonthlyPerformance(req.companyId!, userId),
      getTeamMetrics(req.companyId!, period),
      getLeadConversionMetrics(req.companyId!, userId),
    ]);

    const memberMetrics = allMetrics.find((m) => m.userId === userId) ?? {
      userId,
      hoursWorked: 0,
      scheduledHoursInPeriod: 0,
      utilizationPct: null,
      jobsCompleted: 0,
      allocatedRevenue: 0,
      avgRevPerHour: null,
      leadsGenerated: 0,
      leadRevenue: 0,
    };

    const days =
      period === "last_30_days" ? 30 : period === "last_90_days" ? 90 : 365;
    const periodWeeks = days / 7;
    const efficiencyScore = computeEfficiencyScore(memberMetrics, allMetrics, periodWeeks);

    res.json({ period, metrics: memberMetrics, monthlyTrend, efficiencyScore, leadConversion });
  })
);

// GET /api/team/:userId - Get single team member with full details
router.get(
  "/:userId",
  requirePermission("team.view"),
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

/**
 * GET /api/team/:userId/effective-permissions
 *
 * Phase 2 PR 3 (2026-05-04): read-only "what can this user actually
 * access" view for the Roles & Access tab. Pure read; no auth changes.
 *
 * Resolution path is the SAME path `requirePermission(...)` uses at
 * the route layer — `permissionRepository.getUserEffectivePermissions`.
 * We do NOT reimplement permission logic here. The breakdown
 * (`inheritedFromRole`, `grantedByOverride`, `revokedByOverride`) is
 * pulled from the same primitives the resolver consumes:
 *
 *   inheritedFromRole = permissionRepository.getRolePermissions(roleId)
 *   overrides         = permissionRepository.getUserPermissionOverrides(userId)
 *   effective         = the resolver's final Set (role ∪ grants \ revokes)
 *
 * Tenant scoping: `storage.getTeamMember(companyId, userId)` returns
 * null for any user not in the caller's company → 404. No explicit
 * role gate, matching the existing `GET /api/team` and
 * `GET /api/team/:userId` read access semantics.
 */
router.get(
  "/:userId/effective-permissions",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId } = req.params;
    const companyId = req.companyId!;

    // Tenant gate. `getTeamMember` already filters by companyId and
    // returns null for cross-tenant lookups — same shape as the
    // sibling endpoints above, no leak.
    const member = await storage.getTeamMember(companyId, userId);
    if (!member) {
      throw createError(404, "Team member not found");
    }

    // Reuse the canonical resolver. This is the same call
    // requirePermission(...) makes per request, so the `effective`
    // list is exactly what the gates use.
    const effectiveSet = await permissionRepository.getUserEffectivePermissions(userId);

    // Inherited from role: the role's permission keys, before per-user
    // overrides are applied. Empty when the user has no roleId (the
    // resolver self-heals NULL roleId via `users.role` string lookup;
    // the persisted roleId is what we read here).
    let inheritedFromRole: string[] = [];
    if (member.roleId) {
      inheritedFromRole = await permissionRepository.getRolePermissions(
        member.roleId,
      );
    }

    // Per-user overrides: split into grant / revoke buckets. The
    // resolver applies grants AFTER role merge and revokes AFTER
    // grants, but the bucket UI just needs the raw split.
    const rawOverrides = await permissionRepository.getUserPermissionOverrides(
      userId,
    );
    const grantedByOverride: string[] = [];
    const revokedByOverride: string[] = [];
    for (const o of rawOverrides) {
      if (o.override === "grant") grantedByOverride.push(o.key);
      else if (o.override === "revoke") revokedByOverride.push(o.key);
    }

    // Stable sort everywhere so consumers get deterministic output
    // (UI grouping, snapshot tests).
    res.json({
      userId,
      role: member.role,
      roleId: member.roleId ?? null,
      effective: Array.from(effectiveSet).sort(),
      inheritedFromRole: inheritedFromRole.slice().sort(),
      grantedByOverride: grantedByOverride.slice().sort(),
      revokedByOverride: revokedByOverride.slice().sort(),
    });
  })
);

// PATCH /api/team/:userId - Update team member basic info
router.patch(
  "/:userId",
  requireRole(RESTRICTED_MANAGER_ROLES),
  requirePermission("team.manage"),
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
  requireRole(RESTRICTED_MANAGER_ROLES),
  requirePermission("team.manage"),
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
  requireRole(RESTRICTED_MANAGER_ROLES),
  requirePermission("team.manage"),
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
  requireRole(RESTRICTED_MANAGER_ROLES),
  requirePermission("team.manage"),
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
  requireRole(RESTRICTED_MANAGER_ROLES),
  requirePermission("team.manage"),
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

// ========================================
// SCHEDULE OVERRIDES (2026-05-17 Phase 2)
// ========================================
// Date-specific Working / Not Working overrides. Sits between time-off
// (layer 1) and weekly working_hours (layer 3) in the effective-schedule
// precedence stack.

// GET /api/team/:userId/schedule/overrides?start=YYYY-MM-DD&end=YYYY-MM-DD
router.get(
  "/:userId/schedule/overrides",
  requireRole(RESTRICTED_MANAGER_ROLES),
  requirePermission("team.manage"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId } = req.params;

    const member = await storage.getTeamMember(req.companyId!, userId);
    if (!member) throw createError(404, "Team member not found");

    const { start, end } = req.query as { start?: string; end?: string };
    if (!start || !end) throw createError(400, "Query params start and end (YYYY-MM-DD) are required");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      throw createError(400, "start and end must be YYYY-MM-DD");
    }
    if (end < start) throw createError(400, "end must be >= start");

    const overrides = await technicianScheduleOverrideRepository.listOverridesForRange(
      req.companyId!,
      userId,
      start,
      end,
    );
    res.json({ overrides });
  }),
);

// POST /api/team/:userId/schedule/overrides
// Upsert: creates or updates the active override for the given date.
router.post(
  "/:userId/schedule/overrides",
  requireRole(RESTRICTED_MANAGER_ROLES),
  requirePermission("team.manage"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId } = req.params;

    const member = await storage.getTeamMember(req.companyId!, userId);
    if (!member) throw createError(404, "Team member not found");

    const input = validateSchema(insertTechnicianScheduleOverrideSchema, req.body);

    const override = await technicianScheduleOverrideRepository.upsertOverride(
      req.companyId!,
      {
        technicianUserId: userId,
        overrideDate: input.overrideDate,
        isWorking: input.isWorking,
        note: input.note ?? null,
        createdByUserId: req.user!.id,
      },
    );

    res.status(200).json({ override });
  }),
);

// DELETE /api/team/:userId/schedule/overrides/:overrideId
router.delete(
  "/:userId/schedule/overrides/:overrideId",
  requireRole(RESTRICTED_MANAGER_ROLES),
  requirePermission("team.manage"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId, overrideId } = req.params;

    const member = await storage.getTeamMember(req.companyId!, userId);
    if (!member) throw createError(404, "Team member not found");

    const existing = await technicianScheduleOverrideRepository.findById(
      req.companyId!,
      overrideId,
    );
    if (!existing) throw createError(404, "Override not found");
    // Verify override belongs to the requested technician (cross-user guard)
    if (existing.technicianUserId !== userId) throw createError(404, "Override not found");

    await technicianScheduleOverrideRepository.archiveOverride(req.companyId!, overrideId);
    res.status(204).send();
  }),
);

// GET /api/team/:userId/schedule/effective?start=YYYY-MM-DD&end=YYYY-MM-DD
// Returns the effective working state for every date in the range, applying
// the 4-layer precedence: time_off → date_override → weekly_default → company_default.
// Used by the Phase 3 calendar grid in the Team Hub Schedule tab.
router.get(
  "/:userId/schedule/effective",
  requireRole(RESTRICTED_MANAGER_ROLES),
  requirePermission("team.manage"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId } = req.params;
    const companyId = req.companyId!;

    const member = await storage.getTeamMember(companyId, userId);
    if (!member) throw createError(404, "Team member not found");

    const { start, end } = req.query as { start?: string; end?: string };
    if (!start || !end) throw createError(400, "Query params start and end (YYYY-MM-DD) are required");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      throw createError(400, "start and end must be YYYY-MM-DD");
    }
    if (end < start) throw createError(400, "end must be >= start");

    const [companySettings, companyHours, workingHours] = await Promise.all([
      storage.getCompanySettings(companyId),
      storage.getCompanyBusinessHours(companyId),
      storage.getWorkingHours(userId),
    ]);

    const timezone = companySettings?.timezone ?? "America/Toronto";
    const companyDefaultHours = companyHours.map((ch) => ({
      dayOfWeek: ch.dayOfWeek,
      isOpen: ch.isOpen,
    }));

    const days = await computeEffectiveScheduleRange(
      companyId,
      userId,
      start,
      end,
      timezone,
      {
        weeklyHours: workingHours.map((h) => ({ dayOfWeek: h.dayOfWeek, isWorking: h.isWorking })),
        useCustomSchedule: member.useCustomSchedule ?? false,
        companyDefaultHours,
      },
    );

    res.json({ days });
  }),
);

// PUT /api/team/:userId/permissions - Set permission overrides
// 2026-05-04 PR 4: legacy bulk-override endpoint. Permission editing
// is intentionally NOT under team.manage — it stays under
// permissions.manage to mirror the canonical PATCH endpoint below.
// Brings the legacy PUT in line with the two-layer model.
router.put(
  "/:userId/permissions",
  requireRole(RESTRICTED_MANAGER_ROLES),
  requirePermission("permissions.manage"),
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
  requireRole(RESTRICTED_MANAGER_ROLES),
  requirePermission("team.manage"),
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
  requireRole(RESTRICTED_MANAGER_ROLES),
  requirePermission("team.manage"),
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
 * POST /api/team/:userId/send-password-reset (2026-04-15)
 *
 * Admin-triggered password reset that routes through the canonical
 * self-service reset flow: we resolve the member's primary email and
 * delegate to `requestPasswordReset`, which issues a one-shot token and
 * emails the reset link. The admin does not see or set the password;
 * the user chooses it via the emailed link, same as the public flow.
 *
 * This replaces the legacy "admin sets password directly" UX that the
 * Admin page's reset button was pointing at a nonexistent endpoint.
 */
router.post(
  "/:userId/send-password-reset",
  requireRole(RESTRICTED_MANAGER_ROLES),
  requirePermission("team.manage"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId } = req.params;
    const companyId = req.companyId!;
    const actorUserId = req.user!.id;

    const member = await storage.getTeamMember(companyId, userId);
    if (!member) {
      throw createError(404, "Team member not found");
    }

    const email = await identityRepository.getPrimaryEmailForUser(companyId, userId);
    if (!email) {
      throw createError(400, "This user has no email identity on file — a reset link cannot be sent.");
    }

    const ip =
      (Array.isArray(req.headers["x-forwarded-for"])
        ? req.headers["x-forwarded-for"][0]
        : req.headers["x-forwarded-for"]?.split(",")[0]?.trim()) ||
      req.ip ||
      null;
    const origin = req.get("origin") || null;

    await requestPasswordReset({ email, requestIp: ip, requestOrigin: origin });

    // Reuse the existing password-reset audit event so there is a single
    // record type for "a reset happened" across the manual and email flows.
    await logPasswordReset(req, companyId, actorUserId, userId);

    res.json({
      success: true,
      message: "A password reset email has been sent to the user.",
    });
  }),
);

/**
 * PATCH /api/team/:userId/permissions
 *
 * 2026-04-21 Phase 1 canonical policy architecture: per-user permission
 * override write path.
 *
 * Body: { permissionKey: string, action: "grant" | "revoke" | "inherit" }
 *   - "grant"   → upsert user_permission_overrides row with override="grant"
 *   - "revoke"  → upsert user_permission_overrides row with override="revoke"
 *   - "inherit" → DELETE override row (user inherits role permission again)
 *
 * Two-layer gate:
 *   - Coarse: requireRole(ADMIN_ROLES) — owner / admin only.
 *   - Fine:   requirePermission("permissions.manage") — REVOKING this from
 *             an admin blocks this write without disabling any other admin
 *             capability (principle of least privilege for permission
 *             administration).
 *
 * Self-write block: an admin cannot edit their OWN overrides. Anti-lockout
 * guard — otherwise a revoke of `permissions.manage` becomes irreversible
 * without DB access.
 *
 * Invalidates the per-user permission cache so the next request reflects
 * the new effective set.
 */
const patchUserPermissionSchema = z.object({
  permissionKey: z.string().min(1),
  action: z.enum(["grant", "revoke", "inherit"]),
});

router.patch(
  "/:userId/permissions",
  requireRole(ADMIN_ROLES),
  requirePermission("permissions.manage"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId } = req.params;
    const companyId = req.companyId!;
    const actorUserId = req.user!.id;

    if (userId === actorUserId) {
      throw createError(
        400,
        "You cannot edit your own permission overrides. Ask another admin to change your permissions.",
      );
    }

    const { permissionKey, action } = validateSchema(patchUserPermissionSchema, req.body);

    // Tenant scope: target user must belong to the same company.
    const member = await storage.getTeamMember(companyId, userId);
    if (!member) {
      throw createError(404, "Team member not found");
    }

    // Resolve permission ID from the canonical key.
    const [perm] = await db
      .select({ id: permissions.id })
      .from(permissions)
      .where(eq(permissions.key, permissionKey))
      .limit(1);
    if (!perm) {
      throw createError(400, `Unknown permission: '${permissionKey}'`);
    }

    if (action === "inherit") {
      await db
        .delete(userPermissionOverrides)
        .where(
          and(
            eq(userPermissionOverrides.userId, userId),
            eq(userPermissionOverrides.permissionId, perm.id),
          ),
        );
    } else {
      // Upsert: delete any existing row, then insert the new one. Simple
      // and consistent with the rest of the override table; no unique
      // index exists for ON CONFLICT here.
      await db
        .delete(userPermissionOverrides)
        .where(
          and(
            eq(userPermissionOverrides.userId, userId),
            eq(userPermissionOverrides.permissionId, perm.id),
          ),
        );
      await db.insert(userPermissionOverrides).values({
        userId,
        permissionId: perm.id,
        override: action, // "grant" | "revoke"
      });
    }

    // 2026-04-26 — Audit row for the privileged override write. Mirrors
    // the audit pattern used by the role-change route (logRoleChanged).
    // Non-blocking: auditService swallows DB errors internally so the
    // caller never sees a partial-write situation here.
    await logAuditEvent({
      companyId,
      actorUserId,
      targetUserId: userId,
      action: "PERMISSION_OVERRIDE_CHANGED",
      metadata: { permissionKey, action },
      req,
    });

    // Evict the in-memory effective-permission cache for this user so the
    // next requirePermission() read sees the change immediately.
    clearPermissionCache(userId);

    res.json({
      userId,
      permissionKey,
      action,
    });
  }),
);

/**
 * GET /api/team/:userId/identities
 * Get all login identities for a user
 */
router.get(
  "/:userId/identities",
  requireRole(RESTRICTED_MANAGER_ROLES),
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

// ============================================================================
// Technician Calendar Tokens — Phase 1 (2026-04-23)
// ============================================================================
//
// Per-technician private ICS feed tokens, managed by owners/admins/managers
// on the Team member detail page. The public read endpoint lives at
// /calendar/technician/:token.ics (mounted outside /api in
// server/routes/index.ts). These endpoints only manage the token itself.

function buildFeedUrl(req: AuthedRequest, token: string): string {
  // Prefer the request's own origin — reverse proxies are trusted because
  // `app.set('trust proxy', ...)` is already on in the shell. Fall back to
  // a relative path if origin resolution ever fails.
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  const host = (req.headers["x-forwarded-host"] as string) || req.get("host");
  if (!host) return `/calendar/technician/${token}.ics`;
  return `${proto}://${host}/calendar/technician/${token}.ics`;
}

/**
 * GET /api/team/:userId/calendar-token
 * Returns the current token row (if any). Never returns a disabled token's
 * feed URL — the UI uses `isActive` to decide whether to show the URL.
 */
router.get(
  "/:userId/calendar-token",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId } = req.params;
    const companyId = req.companyId!;
    const { technicianCalendarTokenRepository } = await import("../storage/technicianCalendarTokens");

    const member = await storage.getTeamMember(companyId, userId);
    if (!member) throw createError(404, "Team member not found");

    const row = await technicianCalendarTokenRepository.getByUserId(companyId, userId);
    if (!row) {
      res.json({ token: null, isActive: false, feedUrl: null, lastAccessedAt: null });
      return;
    }
    res.json({
      token: row.token,
      isActive: row.isActive,
      feedUrl: row.isActive ? buildFeedUrl(req, row.token) : null,
      lastAccessedAt: row.lastAccessedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }),
);

/**
 * POST /api/team/:userId/calendar-token
 * Idempotent "make sure there is a token". Creates a fresh row if none
 * exists; otherwise returns the existing one unchanged.
 */
router.post(
  "/:userId/calendar-token",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId } = req.params;
    const companyId = req.companyId!;
    const { technicianCalendarTokenRepository } = await import("../storage/technicianCalendarTokens");

    const member = await storage.getTeamMember(companyId, userId);
    if (!member) throw createError(404, "Team member not found");

    const row = await technicianCalendarTokenRepository.ensureToken(companyId, userId);
    res.json({
      token: row.token,
      isActive: row.isActive,
      feedUrl: row.isActive ? buildFeedUrl(req, row.token) : null,
      lastAccessedAt: row.lastAccessedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }),
);

/**
 * POST /api/team/:userId/calendar-token/rotate
 * Regenerate the token. Immediately invalidates any existing subscription
 * URL. Also re-activates the row if it was disabled — the operator's
 * intent when pressing "Regenerate" is "I want a new working link".
 */
router.post(
  "/:userId/calendar-token/rotate",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId } = req.params;
    const companyId = req.companyId!;
    const { technicianCalendarTokenRepository } = await import("../storage/technicianCalendarTokens");

    const member = await storage.getTeamMember(companyId, userId);
    if (!member) throw createError(404, "Team member not found");

    const row = await technicianCalendarTokenRepository.rotateToken(companyId, userId);
    res.json({
      token: row.token,
      isActive: row.isActive,
      feedUrl: row.isActive ? buildFeedUrl(req, row.token) : null,
      lastAccessedAt: row.lastAccessedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }),
);

/**
 * POST /api/team/:userId/calendar-token/disable
 * Flip is_active → false. The token string is preserved so re-enabling
 * restores the same URL. Rotation remains the "new URL" path.
 */
router.post(
  "/:userId/calendar-token/disable",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId } = req.params;
    const companyId = req.companyId!;
    const { technicianCalendarTokenRepository } = await import("../storage/technicianCalendarTokens");

    const member = await storage.getTeamMember(companyId, userId);
    if (!member) throw createError(404, "Team member not found");

    const row = await technicianCalendarTokenRepository.setActive(companyId, userId, false);
    if (!row) throw createError(404, "No calendar token exists for this member");
    res.json({
      token: row.token,
      isActive: row.isActive,
      feedUrl: null,
      lastAccessedAt: row.lastAccessedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }),
);

/**
 * POST /api/team/:userId/calendar-token/enable
 * Flip is_active → true without changing the token string. Lets operators
 * toggle visibility without rotating the subscription URL.
 */
router.post(
  "/:userId/calendar-token/enable",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId } = req.params;
    const companyId = req.companyId!;
    const { technicianCalendarTokenRepository } = await import("../storage/technicianCalendarTokens");

    const member = await storage.getTeamMember(companyId, userId);
    if (!member) throw createError(404, "Team member not found");

    const row = await technicianCalendarTokenRepository.setActive(companyId, userId, true);
    if (!row) throw createError(404, "No calendar token exists for this member");
    res.json({
      token: row.token,
      isActive: row.isActive,
      feedUrl: row.isActive ? buildFeedUrl(req, row.token) : null,
      lastAccessedAt: row.lastAccessedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }),
);

// ── Member skill assignment routes ────────────────────────────────────────

// GET /api/team/:userId/skills — Member's assigned skills with expiry status.
router.get(
  "/:userId/skills",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId } = req.params;
    const companyId = req.companyId!;
    const member = await storage.getTeamMember(companyId, userId);
    if (!member) throw createError(404, "Team member not found");
    const { listMemberSkills } = await import("../storage/teamSkills");
    const skills = await listMemberSkills(companyId, userId);
    res.json(skills);
  }),
);

const assignSkillSchema = z.object({
  skillId: z.string().uuid(),
  certificationName: z.string().max(200).nullable().optional(),
  certificationExpiresAt: certificationExpiresAtSchema,
  notes: z.string().max(1000).nullable().optional(),
});

// POST /api/team/:userId/skills — Assign a library skill to this member.
router.post(
  "/:userId/skills",
  requireRole(RESTRICTED_MANAGER_ROLES),
  requirePermission("team.manage"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId } = req.params;
    const companyId = req.companyId!;
    const member = await storage.getTeamMember(companyId, userId);
    if (!member) throw createError(404, "Team member not found");
    const body = validateSchema(assignSkillSchema, req.body);
    const { assignSkill } = await import("../storage/teamSkills");
    const row = await assignSkill(companyId, userId, body, req.user?.id);
    res.status(201).json(row);
  }),
);

const updateMemberSkillSchema = z.object({
  certificationName: z.string().max(200).nullable().optional(),
  certificationExpiresAt: certificationExpiresAtSchema,
  notes: z.string().max(1000).nullable().optional(),
  isActive: z.boolean().optional(),
});

// PATCH /api/team/:userId/skills/:memberSkillId — Edit assignment details.
router.patch(
  "/:userId/skills/:memberSkillId",
  requireRole(RESTRICTED_MANAGER_ROLES),
  requirePermission("team.manage"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId, memberSkillId } = req.params;
    const companyId = req.companyId!;
    const member = await storage.getTeamMember(companyId, userId);
    if (!member) throw createError(404, "Team member not found");
    const body = validateSchema(updateMemberSkillSchema, req.body);
    const { updateMemberSkill } = await import("../storage/teamSkills");
    const row = await updateMemberSkill(companyId, memberSkillId, body, req.user?.id);
    res.json(row);
  }),
);

// DELETE /api/team/:userId/skills/:memberSkillId — Remove assignment (hard delete).
router.delete(
  "/:userId/skills/:memberSkillId",
  requireRole(RESTRICTED_MANAGER_ROLES),
  requirePermission("team.manage"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId, memberSkillId } = req.params;
    const companyId = req.companyId!;
    const member = await storage.getTeamMember(companyId, userId);
    if (!member) throw createError(404, "Team member not found");
    const { removeMemberSkill } = await import("../storage/teamSkills");
    await removeMemberSkill(companyId, memberSkillId);
    res.status(204).end();
  }),
);

export default router;
