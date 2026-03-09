/**
 * Admin Routes - Tenant Health Dashboard & Support Mode
 *
 * Owner-only admin area for platform-wide tenant health monitoring
 * and support mode impersonation.
 */

import { Router, Response } from "express";
import { z } from "zod";
import { requireRole } from "../auth/requireRole";
import { OWNER_ONLY } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { adminRepository } from "../storage/admin";
import { adminQboRepository } from "../storage/adminQbo";
import { tenantFeaturesRepository } from "../storage/tenantFeatures";
import { customerCompanyRepository } from "../storage/customerCompanies";
import { impersonationService } from "../impersonationService";
import { userRepository } from "../storage/users";
import { auditService } from "../auditService";
import { updateTenantFeaturesSchema } from "@shared/schema";
import type { AuthedRequest } from "../auth/tenantIsolation";
import { invalidateCompanyCache } from "../services/cache";
import { runTimeAlertsForCompany, runTimeAlertsWorker, getAlertThresholds, runWeeklyDigestWorker } from "../services/timeAlertsWorker";

// ============================================================================
// Security: Confirmation Token
// ============================================================================

const REPLAY_CONFIRM_TOKEN = "REPLAY";

// ============================================================================
// Security: Data Masking Utilities
// ============================================================================

/**
 * Mask sensitive identifiers for admin display
 * Shows first 4 and last 4 characters with asterisks in between
 */
function maskId(id: string | null | undefined): string | null {
  if (!id) return null;
  if (id.length <= 8) return "****" + id.slice(-4);
  return id.slice(0, 4) + "****" + id.slice(-4);
}

/**
 * Mask QBO Realm ID for display
 */
function maskRealmId(realmId: string | null | undefined): string | null {
  if (!realmId) return null;
  if (realmId.length <= 6) return "****";
  return realmId.slice(0, 3) + "****" + realmId.slice(-3);
}

const router = Router();

// ============================================================================
// Middleware: Owner-Only Access
// ============================================================================

// All admin routes require owner role
router.use(requireRole(OWNER_ONLY));

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /api/admin/tenants
 * List all tenants with health metrics summary
 *
 * Returns account-level metrics per tenant (no operational data):
 * - Company info (name, subscription status, created)
 * - Owner contact (email, name)
 * - User counts (total, last login)
 * - QBO integration status (connected, last sync, failed count, queue size)
 */
router.get(
  "/tenants",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const tenants = await adminRepository.getTenantHealthList();
    res.json({ tenants });
  })
);

/**
 * GET /api/admin/tenants/:companyId
 * Get detailed account metrics for a specific tenant
 *
 * Returns:
 * - All account summary metrics
 * - Recent sync errors (last 10)
 * - Recent users (last 10 by activity)
 */
router.get(
  "/tenants/:companyId",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req.params;

    const tenant = await adminRepository.getTenantDetail(companyId);
    if (!tenant) {
      throw createError(404, "Tenant not found");
    }

    res.json(tenant);
  })
);

// ============================================================================
// Impersonation Routes (Support Mode)
// ============================================================================

const impersonateSchema = z.object({
  targetUserId: z.string().uuid("Invalid target user ID"),
  reason: z.string().min(1, "Reason is required").max(500).optional(),
});

/**
 * POST /api/admin/impersonate
 * Start impersonation session for a target user
 *
 * Security:
 * - Owner-only access
 * - Target user must exist
 * - Cannot impersonate yourself
 * - Audit logged
 * - Session expires after 60 minutes
 * - Stored in DB with httpOnly cookie
 */
router.post(
  "/impersonate",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const owner = req.user!;
    const data = validateSchema(impersonateSchema, req.body);

    // Cannot impersonate yourself
    if (data.targetUserId === owner.id) {
      throw createError(400, "Cannot impersonate yourself");
    }

    // Check if already impersonating
    const existingSession = await impersonationService.getActiveImpersonation(req);
    if (existingSession) {
      throw createError(400, "Already in an impersonation session. Stop current session first.");
    }

    // Get target user
    const targetUser = await userRepository.getUser(data.targetUserId);
    if (!targetUser) {
      throw createError(404, "Target user not found");
    }

    // Cannot impersonate another owner
    if (targetUser.role === "owner") {
      throw createError(403, "Cannot impersonate another owner");
    }

    // Start impersonation session (sets httpOnly cookie)
    const session = await impersonationService.startImpersonation(
      req,
      res,
      owner.id,
      owner.email || "unknown",
      targetUser.id,
      targetUser.companyId,
      data.reason || "Admin support session"
    );

    res.json({
      success: true,
      sessionId: session.id,
      targetUser: {
        id: targetUser.id,
        email: targetUser.email,
        fullName: targetUser.fullName,
        role: targetUser.role,
        companyId: targetUser.companyId,
      },
      expiresAt: session.expiresAt.getTime(),
    });
  })
);

/**
 * POST /api/admin/impersonate/stop
 * End current impersonation session (clears httpOnly cookie)
 */
router.post(
  "/impersonate/stop",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    // Use realUser (the owner) when impersonating, otherwise use user
    const owner = (req as any).isImpersonating ? (req as any).realUser : req.user!;

    // Check for active session
    const session = await impersonationService.getActiveImpersonation(req);
    if (!session) {
      // No active session is fine - just return success
      res.json({ success: true, message: "No active impersonation session" });
      return;
    }

    // Stop the session (clears cookie)
    await impersonationService.stopImpersonation(req, res, owner.id, owner.email || "unknown");

    res.json({ success: true, message: "Impersonation session ended" });
  })
);

/**
 * GET /api/admin/impersonate/status
 * Get current impersonation status
 */
router.get(
  "/impersonate/status",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    // Use realUser (the owner) when impersonating, otherwise use user
    const owner = (req as any).isImpersonating ? (req as any).realUser : req.user!;

    // Check and validate session (handles expiration, clears cookie if invalid)
    const session = await impersonationService.checkImpersonation(req, res);

    if (!session) {
      res.json({
        isImpersonating: false,
        session: null,
      });
      return;
    }

    // Get target user details
    const targetUser = await userRepository.getUser(session.targetUserId);
    const company = await userRepository.getCompanyById(session.companyId);

    res.json({
      isImpersonating: true,
      session: {
        sessionId: session.id,
        targetUserId: session.targetUserId,
        targetUserEmail: targetUser?.email,
        targetUserName: targetUser?.fullName,
        targetCompanyId: session.companyId,
        targetCompanyName: company?.name,
        ownerEmail: owner?.email,
        reason: session.reason,
        startedAt: session.createdAt.getTime(),
        expiresAt: session.expiresAt.getTime(),
        remainingTime: await impersonationService.getRemainingTime(req),
        idleTimeRemaining: await impersonationService.getIdleTimeRemaining(req),
      },
    });
  })
);

// ============================================================================
// QBO Oversight Routes (Cross-Tenant Monitoring)
// ============================================================================

/**
 * GET /api/admin/qbo/overview
 * Cross-tenant QBO overview dashboard
 *
 * Returns:
 * - Total/enabled/connected companies
 * - Queue depth and failed count aggregates
 * - Recent failures across all tenants
 * - Per-company QBO status summary (with masked sensitive IDs)
 */
router.get(
  "/qbo/overview",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const overview = await adminQboRepository.getOverview();

    // Apply data masking to sensitive fields
    const maskedOverview = {
      ...overview,
      companies: overview.companies.map((c) => ({
        ...c,
        qboRealmId: maskRealmId(c.qboRealmId),
      })),
      recentFailures: overview.recentFailures.map((f) => ({
        ...f,
        entityId: maskId(f.entityId),
      })),
    };

    res.json(maskedOverview);
  })
);

/**
 * GET /api/admin/qbo/runs
 * List recent sync runs across all tenants
 *
 * Query params:
 * - limit: Max results (default 50, max 100)
 */
router.get(
  "/qbo/runs",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 100);
    const runs = await adminQboRepository.getRuns({ limit });
    res.json({ runs, count: runs.length });
  })
);

/**
 * GET /api/admin/qbo/runs/:runId
 * Get details for a specific sync run
 */
router.get(
  "/qbo/runs/:runId",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { runId } = req.params;
    const runDetail = await adminQboRepository.getRunDetail(runId);

    if (!runDetail) {
      throw createError(404, "Sync run not found");
    }

    res.json(runDetail);
  })
);

/**
 * GET /api/admin/qbo/queue
 * Get queue jobs across all tenants
 *
 * Query params:
 * - status: "failed" | "pending" | "all" (default "all")
 * - companyId: Filter by company (optional)
 * - limit: Max results (default 50, max 200)
 */
router.get(
  "/qbo/queue",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const status = (req.query.status as "failed" | "pending" | "all") || "all";
    const companyId = req.query.companyId as string | undefined;
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);

    const jobs = await adminQboRepository.getQueueJobs({ status, companyId, limit });
    res.json({ jobs, count: jobs.length });
  })
);

// Validation schema for replay actions
const replayConfirmSchema = z.object({
  confirmToken: z.literal(REPLAY_CONFIRM_TOKEN, {
    errorMap: () => ({ message: `confirmToken must be "${REPLAY_CONFIRM_TOKEN}"` }),
  }),
});

const replayFailedSchema = z.object({
  confirmToken: z.literal(REPLAY_CONFIRM_TOKEN, {
    errorMap: () => ({ message: `confirmToken must be "${REPLAY_CONFIRM_TOKEN}"` }),
  }),
  companyId: z.string().uuid().optional(),
});

/**
 * GET /api/admin/qbo/queue/failed-count
 * Get count of failed jobs for confirmation dialog
 *
 * Query params:
 * - companyId: Filter by company (optional)
 */
router.get(
  "/qbo/queue/failed-count",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.query.companyId as string | undefined;
    const count = await adminQboRepository.getFailedJobsCount(companyId);
    res.json({ count, companyId: companyId || null });
  })
);

/**
 * POST /api/admin/qbo/queue/:id/replay
 * Reset a failed job to QUEUED for replay
 *
 * Security:
 * - Requires confirmToken: "REPLAY" in body
 * - Audit logged with full job details
 */
router.post(
  "/qbo/queue/:id/replay",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const owner = (req as any).isImpersonating ? (req as any).realUser : req.user!;
    const { id } = req.params;

    // Validate confirmation token
    validateSchema(replayConfirmSchema, req.body);

    const result = await adminQboRepository.resetJobForReplay(id);

    if (!result.success) {
      throw createError(400, result.error || "Failed to reset job");
    }

    // Audit log the replay action
    await auditService.logQboReplayOne(
      owner.id,
      owner.email || "unknown",
      id,
      result.job!.companyId,
      result.job!.entityType,
      result.job!.entityId,
      result.previousStatus || "UNKNOWN",
      req
    );

    res.json(result);
  })
);

/**
 * POST /api/admin/qbo/queue/replay-failed
 * Reset all failed jobs to QUEUED for replay
 *
 * Security:
 * - Requires confirmToken: "REPLAY" in body
 * - Audit logged with affected job count and company IDs
 *
 * Body:
 * - confirmToken: "REPLAY" (required)
 * - companyId: Filter by company (optional)
 */
router.post(
  "/qbo/queue/replay-failed",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const owner = (req as any).isImpersonating ? (req as any).realUser : req.user!;

    // Validate confirmation token
    const data = validateSchema(replayFailedSchema, req.body);
    const companyId = data.companyId;

    const result = await adminQboRepository.resetAllFailedForReplay(companyId);

    // Audit log the bulk replay action
    await auditService.logQboReplayAllFailed(
      owner.id,
      owner.email || "unknown",
      result.count,
      result.affectedCompanyIds,
      companyId,
      req
    );

    res.json(result);
  })
);

/**
 * GET /api/admin/qbo/mappings/summary
 * Get mapping summary per company
 *
 * Returns per-company counts of:
 * - customerCompanies: total, synced, pending, error
 * - clientLocations: total, synced, pending, error
 * - invoices: total, synced, pending, error
 */
router.get(
  "/qbo/mappings/summary",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const summary = await adminQboRepository.getMappingSummary();
    res.json({ companies: summary, count: summary.length });
  })
);

// ============================================================================
// Billing & Features Routes (Tenant Configuration)
// ============================================================================

/**
 * GET /api/admin/tenants/:companyId/billing-features
 * Get billing and features configuration for a specific tenant
 *
 * Returns:
 * - Billing info (subscription status, plan, trial dates, etc.)
 * - Feature flags (quotesEnabled, invoicesEnabled, etc.)
 */
router.get(
  "/tenants/:companyId/billing-features",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req.params;

    const data = await tenantFeaturesRepository.getFeaturesWithBilling(companyId);
    if (!data) {
      throw createError(404, "Tenant not found");
    }

    res.json(data);
  })
);

/**
 * PATCH /api/admin/tenants/:companyId/features
 * Update feature flags for a specific tenant
 *
 * Body: Partial update of feature flags
 * - quotesEnabled?: boolean
 * - invoicesEnabled?: boolean
 * - calendarEnabled?: boolean
 * - qboEnabled?: boolean
 * - routeOptimizationEnabled?: boolean
 * - multiTechEnabled?: boolean
 */
router.patch(
  "/tenants/:companyId/features",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req.params;
    const owner = (req as any).isImpersonating ? (req as any).realUser : req.user!;

    // Validate request body
    const updates = validateSchema(updateTenantFeaturesSchema, req.body);

    // Check tenant exists
    const existing = await tenantFeaturesRepository.getBilling(companyId);
    if (!existing) {
      throw createError(404, "Tenant not found");
    }

    // Update features
    const updated = await tenantFeaturesRepository.updateFeatures(companyId, updates);

    // Audit log the change
    await auditService.log({
      platformAdminId: owner.id,
      platformAdminEmail: owner.email || "unknown",
      action: "company_status_change",
      targetCompanyId: companyId,
      req,
      details: {
        changeType: "features_update",
        updates,
      },
    });

    res.json({ success: true, features: updated });
  })
);

// Billing update schema
const updateBillingSchema = z.object({
  subscriptionStatus: z.enum(["trial", "active", "past_due", "cancelled", "paused"]).optional(),
  subscriptionPlan: z.string().nullable().optional(),
  billingInterval: z.enum(["monthly", "annual"]).nullable().optional(),
  trialEndsAt: z.string().datetime().nullable().optional(),
  currentPeriodEnd: z.string().datetime().nullable().optional(),
  cancelAtPeriodEnd: z.boolean().optional(),
});

/**
 * PATCH /api/admin/tenants/:companyId/billing
 * Update billing configuration for a specific tenant
 *
 * Note: This does NOT update Stripe IDs - those are managed by Stripe webhooks
 *
 * Body: Partial update of billing fields
 * - subscriptionStatus?: "trial" | "active" | "past_due" | "cancelled" | "paused"
 * - subscriptionPlan?: string | null
 * - billingInterval?: "monthly" | "annual" | null
 * - trialEndsAt?: ISO date string | null
 * - currentPeriodEnd?: ISO date string | null
 * - cancelAtPeriodEnd?: boolean
 */
router.patch(
  "/tenants/:companyId/billing",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req.params;
    const owner = (req as any).isImpersonating ? (req as any).realUser : req.user!;

    // Validate request body
    const data = validateSchema(updateBillingSchema, req.body);

    // Check tenant exists
    const existing = await tenantFeaturesRepository.getBilling(companyId);
    if (!existing) {
      throw createError(404, "Tenant not found");
    }

    // Convert datetime strings to Date objects
    const updates: Parameters<typeof tenantFeaturesRepository.updateBilling>[1] = {
      ...(data.subscriptionStatus !== undefined && { subscriptionStatus: data.subscriptionStatus }),
      ...(data.subscriptionPlan !== undefined && { subscriptionPlan: data.subscriptionPlan }),
      ...(data.billingInterval !== undefined && { billingInterval: data.billingInterval }),
      ...(data.trialEndsAt !== undefined && {
        trialEndsAt: data.trialEndsAt ? new Date(data.trialEndsAt) : null
      }),
      ...(data.currentPeriodEnd !== undefined && {
        currentPeriodEnd: data.currentPeriodEnd ? new Date(data.currentPeriodEnd) : null
      }),
      ...(data.cancelAtPeriodEnd !== undefined && { cancelAtPeriodEnd: data.cancelAtPeriodEnd }),
    };

    // Update billing
    const updated = await tenantFeaturesRepository.updateBilling(companyId, updates);

    // Invalidate subscription cache so limit checks use fresh plan data immediately
    invalidateCompanyCache(companyId);

    // Audit log the change (special handling for trial adjustments)
    if (data.trialEndsAt !== undefined || data.subscriptionStatus === "trial") {
      await auditService.logTrialAdjustment(
        owner.id,
        owner.email || "unknown",
        companyId,
        {
          changeType: "billing_update",
          previousStatus: existing.subscriptionStatus,
          updates: data,
        },
        req
      );
    } else {
      await auditService.logBillingAdjustment(
        owner.id,
        owner.email || "unknown",
        companyId,
        {
          changeType: "billing_update",
          previousStatus: existing.subscriptionStatus,
          updates: data,
        },
        req
      );
    }

    res.json({ success: true, billing: updated });
  })
);

// ============================================================================
// Time Alerts Worker Routes
// ============================================================================

/**
 * POST /api/admin/run-time-alerts
 * Manually trigger time alerts worker for the current user's company
 *
 * Query params:
 * - allCompanies: "true" to run for all companies (owner-only)
 * - date: Override date for daily checks (YYYY-MM-DD format)
 * - runDigest: "true" to also run weekly digest
 *
 * Security:
 * - Owner-only access
 * - Audit logged
 */
router.post(
  "/run-time-alerts",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const owner = (req as any).isImpersonating ? (req as any).realUser : req.user!;
    const runAllCompanies = req.query.allCompanies === "true";
    const dateOverride = req.query.date as string | undefined;
    const runDigest = req.query.runDigest === "true";

    // Validate date format if provided
    if (dateOverride && !/^\d{4}-\d{2}-\d{2}$/.test(dateOverride)) {
      throw createError(400, "Invalid date format. Use YYYY-MM-DD.");
    }

    // Audit log the trigger
    await auditService.log({
      platformAdminId: owner.id,
      platformAdminEmail: owner.email || "unknown",
      action: "time_alerts_worker_triggered" as any,
      targetCompanyId: runAllCompanies ? undefined : owner.companyId,
      req,
      details: {
        allCompanies: runAllCompanies,
        dateOverride: dateOverride || null,
        runDigest,
      },
    });

    let result;
    if (runAllCompanies) {
      result = await runTimeAlertsWorker({ dateOverride, runDigest });
    } else {
      result = await runTimeAlertsForCompany(owner.companyId, { dateOverride, runDigest });
    }

    res.json({
      success: true,
      mode: runAllCompanies ? "all_companies" : "single_company",
      companyId: runAllCompanies ? null : owner.companyId,
      dateChecked: dateOverride || "yesterday",
      runDigest,
      result,
    });
  })
);

/**
 * POST /api/admin/run-weekly-digest
 * Manually trigger weekly digest worker for all companies
 *
 * Security:
 * - Owner-only access
 * - Audit logged
 */
router.post(
  "/run-weekly-digest",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const owner = (req as any).isImpersonating ? (req as any).realUser : req.user!;

    // Audit log the trigger
    await auditService.log({
      platformAdminId: owner.id,
      platformAdminEmail: owner.email || "unknown",
      action: "weekly_digest_worker_triggered" as any,
      req,
      details: {},
    });

    const result = await runWeeklyDigestWorker();

    res.json({
      success: true,
      result,
    });
  })
);

/**
 * GET /api/admin/time-alerts/thresholds
 * Get current alert thresholds for documentation
 */
router.get(
  "/time-alerts/thresholds",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req.user!;
    const thresholds = await getAlertThresholds(companyId);
    res.json({ thresholds });
  })
);

// ============================================================================
// Orphan Location Management
// ============================================================================

/**
 * GET /api/admin/orphan-locations
 * Get all orphan locations (locations without parentCompanyId) for the current tenant
 *
 * Returns locations with suggested matches based on exact company name match
 * Note: This uses the owner's companyId, not cross-tenant. For support mode,
 * the impersonated user's companyId is used automatically.
 */
router.get(
  "/orphan-locations",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req;
    if (!companyId) {
      throw createError(401, "Missing company context");
    }

    const orphans = await customerCompanyRepository.getOrphanLocations(companyId);

    res.json({
      orphans,
      count: orphans.length,
      // Summary stats
      withSuggestions: orphans.filter(o => o.suggestedCustomerCompanyId).length,
      withoutSuggestions: orphans.filter(o => !o.suggestedCustomerCompanyId).length,
    });
  })
);

/**
 * GET /api/admin/orphan-locations/count
 * Get count of orphan locations (for dashboard badge)
 */
router.get(
  "/orphan-locations/count",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req;
    if (!companyId) {
      throw createError(401, "Missing company context");
    }

    const count = await customerCompanyRepository.getOrphanLocationCount(companyId);
    res.json({ count });
  })
);

// ============================================================================
// Data Visibility Diagnostics (Regression Detection) - PERMANENT
// ============================================================================

/**
 * GET /api/admin/diagnostics/visibility
 * Returns comprehensive counts to verify data visibility (detect regressions where data exists but isn't shown)
 *
 * Compares:
 * - Total records in DB for this tenant
 * - Records after each filter
 * - Records returned by actual storage methods (same ones routes use)
 *
 * If storage method returns fewer than expected, there may be a filter regression.
 */
router.get(
  "/diagnostics/visibility",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req;
    if (!companyId) {
      throw createError(401, "Missing company context");
    }

    const { db } = await import("../db");
    const { invoices, clients, customerCompanies } = await import("@shared/schema");
    const { eq, sql } = await import("drizzle-orm");
    const { storage } = await import("../storage/index");

    // =========================================================================
    // INVOICES - DB counts
    // =========================================================================
    const [invoiceTotalResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(invoices)
      .where(eq(invoices.companyId, companyId));

    const [invoiceIsActiveTrueResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(invoices)
      .where(sql`${invoices.companyId} = ${companyId} AND ${invoices.isActive} = true`);

    const [invoiceIsActiveNullResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(invoices)
      .where(sql`${invoices.companyId} = ${companyId} AND ${invoices.isActive} IS NULL`);

    const [invoiceIsActiveFalseResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(invoices)
      .where(sql`${invoices.companyId} = ${companyId} AND ${invoices.isActive} = false`);

    const [invoiceDeletedAtNotNullResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(invoices)
      .where(sql`${invoices.companyId} = ${companyId} AND ${invoices.deletedAt} IS NOT NULL`);

    // Sample invoices (up to 5)
    const sampleInvoices = await db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        status: invoices.status,
        isActive: invoices.isActive,
        deletedAt: invoices.deletedAt,
      })
      .from(invoices)
      .where(eq(invoices.companyId, companyId))
      .limit(5);

    // CALL ACTUAL STORAGE METHOD (same one the route uses)
    const storageInvoiceResult = await storage.getInvoices(companyId, { limit: 1000, offset: 0 });

    // =========================================================================
    // LOCATIONS - DB counts
    // =========================================================================
    const [locationTotalResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(clients)
      .where(eq(clients.companyId, companyId));

    const [locationInactiveTrueResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(clients)
      .where(sql`${clients.companyId} = ${companyId} AND ${clients.inactive} = true`);

    const [locationInactiveNullResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(clients)
      .where(sql`${clients.companyId} = ${companyId} AND ${clients.inactive} IS NULL`);

    const [locationInactiveFalseResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(clients)
      .where(sql`${clients.companyId} = ${companyId} AND ${clients.inactive} = false`);

    const [locationDeletedAtNotNullResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(clients)
      .where(sql`${clients.companyId} = ${companyId} AND ${clients.deletedAt} IS NOT NULL`);

    const [locationLinkedResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(clients)
      .where(sql`${clients.companyId} = ${companyId} AND ${clients.parentCompanyId} IS NOT NULL`);

    const [locationOrphanResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(clients)
      .where(sql`${clients.companyId} = ${companyId} AND ${clients.parentCompanyId} IS NULL`);

    // Sample locations (up to 10)
    const sampleLocations = await db
      .select({
        id: clients.id,
        companyName: clients.companyName,
        location: clients.location,
        address: clients.address,
        city: clients.city,
        parentCompanyId: clients.parentCompanyId,
        inactive: clients.inactive,
        deletedAt: clients.deletedAt,
      })
      .from(clients)
      .where(eq(clients.companyId, companyId))
      .limit(10);

    // CALL ACTUAL STORAGE METHOD for locations (getAllClients)
    const storageClientsResult = await storage.getAllClients(companyId);

    // =========================================================================
    // CUSTOMER COMPANIES - DB counts
    // =========================================================================
    const [customerCompanyTotalResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(customerCompanies)
      .where(eq(customerCompanies.companyId, companyId));

    const [customerCompanyDeletedResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(customerCompanies)
      .where(sql`${customerCompanies.companyId} = ${companyId} AND ${customerCompanies.deletedAt} IS NOT NULL`);

    // =========================================================================
    // Health checks
    // =========================================================================
    const totalInDb = Number(invoiceTotalResult.count);
    const returnedByStorage = storageInvoiceResult.items.length;
    const expectedExclusions = Number(invoiceIsActiveFalseResult.count) + Number(invoiceDeletedAtNotNullResult.count);

    const locationTotalInDb = Number(locationTotalResult.count);
    const locationReturnedByStorage = storageClientsResult.length;
    const locationExpectedExclusions = Number(locationInactiveTrueResult.count) + Number(locationDeletedAtNotNullResult.count);

    res.json({
      companyId,
      invoices: {
        totalInDb,
        isActiveTrueCount: Number(invoiceIsActiveTrueResult.count),
        isActiveNullCount: Number(invoiceIsActiveNullResult.count),
        isActiveFalseCount: Number(invoiceIsActiveFalseResult.count),
        deletedAtNotNullCount: Number(invoiceDeletedAtNotNullResult.count),
        returnedByStorageGetInvoices: returnedByStorage,
        expectedAfterExclusions: totalInDb - expectedExclusions,
        sampleIds: sampleInvoices.map(i => ({
          id: i.id,
          invoiceNumber: i.invoiceNumber,
          status: i.status,
          isActive: i.isActive,
          deletedAt: i.deletedAt,
        })),
      },
      locations: {
        totalInDb: locationTotalInDb,
        inactiveTrueCount: Number(locationInactiveTrueResult.count),
        inactiveNullCount: Number(locationInactiveNullResult.count),
        inactiveFalseCount: Number(locationInactiveFalseResult.count),
        deletedAtNotNullCount: Number(locationDeletedAtNotNullResult.count),
        linkedCount: Number(locationLinkedResult.count),
        orphanCount: Number(locationOrphanResult.count),
        returnedByStorageGetAllClients: locationReturnedByStorage,
        expectedAfterExclusions: locationTotalInDb - locationExpectedExclusions,
        sample: sampleLocations,
      },
      customerCompanies: {
        totalInDb: Number(customerCompanyTotalResult.count),
        softDeleted: Number(customerCompanyDeletedResult.count),
      },
      healthCheck: {
        invoicesOk: returnedByStorage >= totalInDb - expectedExclusions,
        invoicesMismatch: returnedByStorage < totalInDb - expectedExclusions
          ? `REGRESSION: DB has ${totalInDb - expectedExclusions} visible invoices but storage returns ${returnedByStorage}`
          : null,
        locationsOk: locationReturnedByStorage >= locationTotalInDb - locationExpectedExclusions,
        locationsMismatch: locationReturnedByStorage < locationTotalInDb - locationExpectedExclusions
          ? `REGRESSION: DB has ${locationTotalInDb - locationExpectedExclusions} visible locations but storage returns ${locationReturnedByStorage}`
          : null,
      },
    });
  })
);

// ============================================================================
// Scheduling Health Endpoint (Canonical Scheduling Model Checks)
// ============================================================================

/**
 * GET /api/admin/scheduling-health
 * Run scheduling sanity checks and return counts + samples
 *
 * CANONICAL SCHEDULING MODEL: A job is scheduled if scheduledStart IS NOT NULL.
 * isAllDay is a DISPLAY flag only - all-day events MUST have scheduledStart set to midnight.
 *
 * Returns aggregated health status for scheduling data integrity:
 * - A) Legacy status values
 * - B) Terminal jobs with schedule
 * - C) Invalid openSubStatus
 * - D) All-day normalization violations
 * - E) Missing scheduledEnd
 * - F) Invalid time range
 * - G) NULL version on scheduled jobs
 * - H) Invalid version < 1
 */
router.get(
  "/scheduling-health",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");

    const MAX_SAMPLES = 20;

    // Define all checks - Normalized 4-status model: open, completed, invoiced, archived
    const validStatuses = "'open', 'completed', 'invoiced', 'archived'";
    const terminalStatuses = "'invoiced', 'archived'";

    const checks = [
      {
        code: "A",
        name: "Legacy status values",
        description: "Jobs with status NOT IN normalized values (open, completed, invoiced, archived)",
        query: `
          SELECT id, job_number, status, scheduled_start, scheduled_end, is_all_day
          FROM jobs
          WHERE deleted_at IS NULL
            AND status NOT IN (${validStatuses})
          LIMIT ${MAX_SAMPLES}
        `,
        countQuery: `
          SELECT count(*) as count
          FROM jobs
          WHERE deleted_at IS NULL
            AND status NOT IN (${validStatuses})
        `,
      },
      {
        code: "B",
        name: "Terminal jobs with schedule",
        description: "Jobs with terminal status but still have schedule fields set",
        query: `
          SELECT id, job_number, status, scheduled_start, scheduled_end, is_all_day
          FROM jobs
          WHERE deleted_at IS NULL
            AND status IN (${terminalStatuses})
            AND (scheduled_start IS NOT NULL OR scheduled_end IS NOT NULL OR is_all_day = true)
          LIMIT ${MAX_SAMPLES}
        `,
        countQuery: `
          SELECT count(*) as count
          FROM jobs
          WHERE deleted_at IS NULL
            AND status IN (${terminalStatuses})
            AND (scheduled_start IS NOT NULL OR scheduled_end IS NOT NULL OR is_all_day = true)
        `,
      },
      {
        code: "C",
        name: "Invalid openSubStatus",
        description: "Jobs with openSubStatus set but status != 'open'",
        query: `
          SELECT id, job_number, status, open_sub_status, scheduled_start, is_all_day
          FROM jobs
          WHERE deleted_at IS NULL
            AND open_sub_status IS NOT NULL
            AND status != 'open'
          LIMIT ${MAX_SAMPLES}
        `,
        countQuery: `
          SELECT count(*) as count
          FROM jobs
          WHERE deleted_at IS NULL
            AND open_sub_status IS NOT NULL
            AND status != 'open'
        `,
      },
      {
        code: "D",
        name: "All-day without scheduledStart (CANONICAL VIOLATION)",
        description: "All-day events must have scheduledStart set to midnight (canonical scheduling model)",
        query: `
          SELECT id, job_number, status, scheduled_start, scheduled_end, is_all_day
          FROM jobs
          WHERE deleted_at IS NULL
            AND is_all_day = true
            AND scheduled_start IS NULL
          LIMIT ${MAX_SAMPLES}
        `,
        countQuery: `
          SELECT count(*) as count
          FROM jobs
          WHERE deleted_at IS NULL
            AND is_all_day = true
            AND scheduled_start IS NULL
        `,
      },
      {
        code: "D2",
        name: "All-day normalization violations",
        description: "All-day events with incorrect start/end times (should be midnight to 23:59:59)",
        query: `
          SELECT id, job_number, status, scheduled_start, scheduled_end, is_all_day
          FROM jobs
          WHERE deleted_at IS NULL
            AND is_all_day = true
            AND scheduled_start IS NOT NULL
            AND (
              EXTRACT(HOUR FROM scheduled_start) != 0
              OR EXTRACT(MINUTE FROM scheduled_start) != 0
              OR scheduled_end IS NULL
            )
          LIMIT ${MAX_SAMPLES}
        `,
        countQuery: `
          SELECT count(*) as count
          FROM jobs
          WHERE deleted_at IS NULL
            AND is_all_day = true
            AND scheduled_start IS NOT NULL
            AND (
              EXTRACT(HOUR FROM scheduled_start) != 0
              OR EXTRACT(MINUTE FROM scheduled_start) != 0
              OR scheduled_end IS NULL
            )
        `,
      },
      {
        code: "E",
        name: "Missing scheduledEnd",
        description: "Jobs with scheduledStart but no scheduledEnd",
        query: `
          SELECT id, job_number, status, scheduled_start, scheduled_end, is_all_day
          FROM jobs
          WHERE deleted_at IS NULL
            AND scheduled_start IS NOT NULL
            AND scheduled_end IS NULL
          LIMIT ${MAX_SAMPLES}
        `,
        countQuery: `
          SELECT count(*) as count
          FROM jobs
          WHERE deleted_at IS NULL
            AND scheduled_start IS NOT NULL
            AND scheduled_end IS NULL
        `,
      },
      {
        code: "F",
        name: "Invalid time range (end <= start)",
        description: "Jobs where scheduledEnd is not after scheduledStart",
        query: `
          SELECT id, job_number, status, scheduled_start, scheduled_end, is_all_day
          FROM jobs
          WHERE deleted_at IS NULL
            AND scheduled_start IS NOT NULL
            AND scheduled_end IS NOT NULL
            AND scheduled_end <= scheduled_start
          LIMIT ${MAX_SAMPLES}
        `,
        countQuery: `
          SELECT count(*) as count
          FROM jobs
          WHERE deleted_at IS NULL
            AND scheduled_start IS NOT NULL
            AND scheduled_end IS NOT NULL
            AND scheduled_end <= scheduled_start
        `,
      },
      {
        code: "G",
        name: "NULL version on scheduled jobs",
        description: "Scheduled jobs with NULL version (canonical: scheduledStart IS NOT NULL)",
        query: `
          SELECT id, job_number, status, scheduled_start, version
          FROM jobs
          WHERE deleted_at IS NULL
            AND scheduled_start IS NOT NULL
            AND version IS NULL
          LIMIT ${MAX_SAMPLES}
        `,
        countQuery: `
          SELECT count(*) as count
          FROM jobs
          WHERE deleted_at IS NULL
            AND scheduled_start IS NOT NULL
            AND version IS NULL
        `,
      },
      {
        code: "H",
        name: "Invalid version (< 1)",
        description: "Jobs with version < 1",
        query: `
          SELECT id, job_number, status, version
          FROM jobs
          WHERE deleted_at IS NULL
            AND version IS NOT NULL
            AND version < 1
          LIMIT ${MAX_SAMPLES}
        `,
        countQuery: `
          SELECT count(*) as count
          FROM jobs
          WHERE deleted_at IS NULL
            AND version IS NOT NULL
            AND version < 1
        `,
      },
    ];

    // Run all checks
    const results = [];
    let totalViolations = 0;

    for (const check of checks) {
      const countRows = await db.execute(sql.raw(check.countQuery)) as unknown as { count: string }[];
      const count = Number(countRows[0]?.count || 0);
      totalViolations += count;

      let samples: any[] = [];
      if (count > 0) {
        samples = await db.execute(sql.raw(check.query)) as unknown as any[];
      }

      results.push({
        code: check.code,
        name: check.name,
        description: check.description,
        count,
        passed: count === 0,
        sampleIds: samples.map((r: any) => ({
          id: r.id,
          jobNumber: r.job_number,
          status: r.status,
        })),
      });
    }

    res.json({
      timestamp: new Date().toISOString(),
      summary: {
        totalChecks: checks.length,
        passed: results.filter((r) => r.passed).length,
        failed: results.filter((r) => !r.passed).length,
        totalViolations,
        status: totalViolations === 0 ? "HEALTHY" : "VIOLATIONS_FOUND",
      },
      checks: results,
    });
  })
);

// ============================================================================
// Guardrail Tests - Regression Prevention (PERMANENT)
// ============================================================================

/**
 * GET /api/admin/diagnostics/guardrails
 * Runs automated checks to detect data visibility regressions.
 * Returns PASS/FAIL for each test with details.
 *
 * Tests:
 * 1. Invoice visibility: If DB has invoices, route must return invoices
 * 2. Location consistency: orphan + linked = total (accounting for soft-deleted)
 */
router.get(
  "/diagnostics/guardrails",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req;
    if (!companyId) {
      throw createError(401, "Missing company context");
    }

    const { db } = await import("../db");
    const { invoices, clients } = await import("@shared/schema");
    const { eq, sql } = await import("drizzle-orm");
    const { storage } = await import("../storage/index");

    const tests: Array<{
      name: string;
      passed: boolean;
      expected: string;
      actual: string;
      severity: "critical" | "warning";
    }> = [];

    // =========================================================================
    // Test 1: Invoice visibility - if DB has invoices with isActive=true|NULL,
    // storage method must return at least one
    // =========================================================================
    const [invoiceTotalResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(invoices)
      .where(sql`${invoices.companyId} = ${companyId} AND (${invoices.isActive} = true OR ${invoices.isActive} IS NULL)`);

    const visibleInvoicesInDb = Number(invoiceTotalResult.count);
    const storageInvoiceResult = await storage.getInvoices(companyId, { limit: 1, offset: 0 });
    const storageReturnsInvoices = storageInvoiceResult.items.length > 0;

    tests.push({
      name: "Invoice visibility",
      passed: visibleInvoicesInDb === 0 || storageReturnsInvoices,
      expected: visibleInvoicesInDb > 0 ? "At least 1 invoice returned" : "No invoices expected (DB has 0)",
      actual: storageReturnsInvoices ? `${storageInvoiceResult.items.length} invoice(s) returned` : "0 invoices returned",
      severity: "critical",
    });

    // =========================================================================
    // Test 2: Location count consistency - orphan + linked should equal total
    // (excluding soft-deleted if your schema uses deletedAt)
    // =========================================================================
    const [locationTotalResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(clients)
      .where(eq(clients.companyId, companyId));

    const [locationLinkedResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(clients)
      .where(sql`${clients.companyId} = ${companyId} AND ${clients.parentCompanyId} IS NOT NULL`);

    const [locationOrphanResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(clients)
      .where(sql`${clients.companyId} = ${companyId} AND ${clients.parentCompanyId} IS NULL`);

    const totalLocations = Number(locationTotalResult.count);
    const linkedLocations = Number(locationLinkedResult.count);
    const orphanLocations = Number(locationOrphanResult.count);
    const accountedFor = linkedLocations + orphanLocations;

    tests.push({
      name: "Location count consistency",
      passed: accountedFor === totalLocations,
      expected: `linked (${linkedLocations}) + orphan (${orphanLocations}) = total (${totalLocations})`,
      actual: `${accountedFor} = ${totalLocations}`,
      severity: "warning",
    });

    // =========================================================================
    // Test 3: Storage getAllClients returns locations when DB has them
    // =========================================================================
    const storageClientsResult = await storage.getAllClients(companyId);

    tests.push({
      name: "Location visibility via getAllClients",
      passed: totalLocations === 0 || storageClientsResult.length > 0,
      expected: totalLocations > 0 ? "At least 1 location returned" : "No locations expected (DB has 0)",
      actual: `${storageClientsResult.length} location(s) returned`,
      severity: "critical",
    });

    // =========================================================================
    // Summary
    // =========================================================================
    const failedTests = tests.filter(t => !t.passed);
    const criticalFailures = failedTests.filter(t => t.severity === "critical");

    res.json({
      companyId,
      timestamp: new Date().toISOString(),
      summary: {
        total: tests.length,
        passed: tests.filter(t => t.passed).length,
        failed: failedTests.length,
        criticalFailures: criticalFailures.length,
        status: criticalFailures.length > 0 ? "CRITICAL_FAILURE" : failedTests.length > 0 ? "WARNING" : "PASS",
      },
      tests,
    });
  })
);

export default router;
