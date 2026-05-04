/**
 * Admin Routes — Tenant-Owner Operational Tools (post 2026-05-03 lockdown)
 *
 * 2026-05-03 SECURITY LOCKDOWN — Cross-tenant boundary fix:
 *
 *   The legacy `/api/admin/*` surface used to host both (a) genuinely
 *   tenant-scoped owner tools (bulk archived-job cleanup, orphan locations,
 *   diagnostics, single-tenant time-alerts trigger, impersonation
 *   bootstrap) AND (b) cross-tenant *platform* dashboards (tenant list,
 *   QBO oversight aggregator, weekly digest worker, time-alerts worker
 *   `allCompanies=true`). Both groups were gated only on the tenant role
 *   `owner` (`OWNER_ONLY`). That meant any tenant owner could read the
 *   complete cross-tenant tenant catalog, owner emails, and QBO sync
 *   queue across the SaaS — and replay another tenant's QBO jobs.
 *
 *   Cross-tenant routes have been DELETED from this router. The canonical
 *   home for cross-tenant platform-admin operations is `/api/platform/*`,
 *   which authenticates via the separate `psid` session and gates by
 *   capability (`requirePlatformSession` + `requireCapability`). The
 *   tenant cookie cannot reach `/api/platform/*`.
 *
 *   What remains here is genuinely tenant-scoped: every handler reads
 *   `req.companyId` (or rejects cross-tenant id parameters) and operates
 *   only on data owned by the caller's own tenant. Each route keeps the
 *   `requireRole(OWNER_ONLY)` gate. The router-wide `router.use(requireRole(...))`
 *   has been replaced with explicit per-route gates so future maintainers
 *   cannot silently hang a cross-tenant handler off this file by appending
 *   to the bottom.
 *
 *   Removed routes (never reintroduce on a tenant-auth surface):
 *     - GET    /tenants                          (cross-tenant company list)
 *     - GET    /qbo/overview                     (cross-tenant QBO summary)
 *     - GET    /qbo/runs                         (cross-tenant QBO runs)
 *     - GET    /qbo/runs/:runId                  (cross-tenant QBO run detail)
 *     - GET    /qbo/queue                        (cross-tenant QBO queue)
 *     - GET    /qbo/queue/failed-count           (cross-tenant)
 *     - GET    /qbo/mappings/summary             (cross-tenant)
 *     - POST   /qbo/queue/:id/replay             (cross-tenant write)
 *     - POST   /qbo/queue/replay-failed          (cross-tenant write)
 *     - POST   /run-weekly-digest                (cross-tenant write)
 *     - The `?allCompanies=true` branch of POST /run-time-alerts
 *
 *   If platform operators still need any of those views, build them under
 *   `/api/platform/*` with the appropriate capability gate.
 */

import { Router, Response } from "express";
import { z } from "zod";
import { requireRole } from "../auth/requireRole";
// 2026-05-04 Phase 7: dropped `isPlatformRole` from this import — the
// only consumer (the impersonation gate ~line 269) was removed once
// Phase 6's CHECK constraint made the check structurally impossible.
import { OWNER_ONLY } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { adminRepository } from "../storage/admin";
import { customerCompanyRepository } from "../storage/customerCompanies";
import { impersonationService } from "../impersonationService";
import { userRepository } from "../storage/users";
import type { AuthedRequest } from "../auth/tenantIsolation";
import { runTimeAlertsForCompany, getAlertThresholds } from "../services/timeAlertsWorker";
// 2026-04-09: Bulk archived-job cleanup tool (tenant owner only).
import {
  previewBulkCleanup,
  runBulkCleanup,
  isBulkCleanupWarning,
} from "../services/bulkJobCleanupService";

// ============================================================================
// Security: Confirmation Token (impersonation only — see legacy use below)
// ============================================================================

const router = Router();

// 2026-05-03 lockdown: NO router-wide `requireRole` gate. Every handler in this
// file MUST attach its own `requireRole(OWNER_ONLY)` (or stricter) so a future
// edit cannot accidentally inherit auth from the top of the file. If you find
// yourself wanting cross-tenant data, build the route under
// `/api/platform/*`, not here.

// ============================================================================
// Bulk Archived-Job Cleanup
// ============================================================================
//
// Two-step admin tool for permanently deleting archived jobs in batches.
// Reuses the canonical jobRepository.deleteJob path — no shortcut SQL.
//
//   POST /api/admin/jobs/bulk-cleanup/preview
//        → returns counts, sample, and whether a warning is required.
//
//   POST /api/admin/jobs/bulk-cleanup/run
//        → executes in batches; refuses to proceed if invoice-linked archived
//          jobs are present and `confirmed !== true`.
//
// Tenant scope: req.companyId from the authenticated owner. Cross-tenant
// cleanup is intentionally not supported.

const bulkCleanupFiltersSchema = z.object({
  archivedOnly: z.literal(true),
  olderThanDays: z.number().int().positive().max(3650).nullable().optional(),
  includeInvoiceLinked: z.boolean().nullable().optional(),
  limit: z.number().int().positive().max(1000).nullable().optional(),
}).strict();

const bulkCleanupRunSchema = z.object({
  filters: bulkCleanupFiltersSchema,
  confirmed: z.boolean().optional().default(false),
}).strict();

router.post(
  "/jobs/bulk-cleanup/preview",
  requireRole(OWNER_ONLY),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const filters = validateSchema(bulkCleanupFiltersSchema, req.body?.filters ?? req.body);
    const preview = await previewBulkCleanup(companyId, filters);
    res.json(preview);
  })
);

router.post(
  "/jobs/bulk-cleanup/run",
  requireRole(OWNER_ONLY),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { filters, confirmed } = validateSchema(bulkCleanupRunSchema, req.body);

    const result = await runBulkCleanup(companyId, filters, { confirmed: confirmed === true });

    if (isBulkCleanupWarning(result)) {
      // Caller did not pass confirmed=true and invoice-linked jobs are present.
      // Surface a 409 so the UI can show the warning dialog and re-call with
      // confirmed=true after the user acknowledges.
      return res.status(409).json(result);
    }

    res.json(result);
  })
);

// ============================================================================
// Tenant Detail (own tenant only)
// ============================================================================

/**
 * GET /api/admin/tenants/:companyId
 * Detailed account metrics for the caller's OWN tenant.
 *
 * 2026-04-26 cross-tenant guard preserved: rejects any `:companyId` other
 * than `req.companyId`. Cross-tenant reads must use
 * `/api/platform/tenants/*`, which is psid-gated and capability-gated.
 *
 * 2026-05-03: this is the SOLE remaining `/api/admin/tenants*` route. The
 * unscoped list endpoint (`GET /api/admin/tenants`) was removed — it
 * exposed cross-tenant company data to any tenant owner.
 */
router.get(
  "/tenants/:companyId",
  requireRole(OWNER_ONLY),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req.params;

    if (companyId !== req.companyId) {
      throw createError(
        403,
        "Cross-tenant access forbidden — tenant detail is scoped to your own tenant. Cross-tenant reads use /api/platform/tenants/* (platform-capability gated).",
      );
    }

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
 * Start impersonation session for a target user inside the OWN tenant.
 *
 * 2026-05-03 (follow-up): tenant boundary hardening. The previous version
 * called `userRepository.getUser(targetUserId)` which is unscoped, then
 * proceeded to start a session with `targetUser.companyId` regardless of
 * the operator's tenant. A tenant owner could therefore (a) impersonate a
 * non-owner user in another tenant, and (b) probe whether arbitrary user
 * UUIDs existed in the SaaS via the 404-vs-500 timing.
 *
 * Hardened contract:
 *   1. Lookup uses `getUserByCompany(req.companyId, targetUserId)`, which
 *      returns null for both "no such user" and "user in another tenant".
 *      We translate either case into a uniform `404 Target user not found`
 *      so cross-tenant existence cannot be inferred.
 *   2. Disabled, soft-deleted, and non-active-status users also resolve
 *      to the same `404` — for the same reason (no probing of account
 *      state across the SaaS).
 *   3. Platform roles (platform_admin / platform_support / platform_billing
 *      / platform_readonly_audit) cannot be impersonated through the
 *      tenant surface even if they happen to share a companyId. They are
 *      rejected with `403`.
 *   4. Other tenant `owner` users remain rejected with `403` (preserved).
 *   5. Self-impersonation rejected with `400` (preserved).
 *
 * Cross-tenant impersonation must never start. The session row is written
 * with `targetCompanyId = req.companyId`, not `targetUser.companyId` — by
 * this point the two are equal anyway, but the explicit form makes the
 * tenant boundary impossible to drift past in a future refactor.
 */
router.post(
  "/impersonate",
  requireRole(OWNER_ONLY),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const owner = req.user!;
    const operatorCompanyId = req.companyId;
    if (!operatorCompanyId) {
      // requireRole(OWNER_ONLY) ran upstream so req.user must be present;
      // companyId being absent would mean the tenant context middleware
      // mis-fired. Treat as 401 so the caller re-authenticates.
      throw createError(401, "Missing tenant context");
    }

    const data = validateSchema(impersonateSchema, req.body);

    if (data.targetUserId === owner.id) {
      throw createError(400, "Cannot impersonate yourself");
    }

    const existingSession = await impersonationService.getActiveImpersonation(req);
    if (existingSession) {
      throw createError(400, "Already in an impersonation session. Stop current session first.");
    }

    // Tenant-scoped lookup. Returns null for cross-tenant ids — the
    // 404 below is identical to "no such user" so other tenants'
    // ids are not enumerable.
    const targetUser = await userRepository.getUserByCompany(operatorCompanyId, data.targetUserId);
    if (!targetUser) {
      throw createError(404, "Target user not found");
    }

    // Defense-in-depth even though getUserByCompany already enforced this.
    if (targetUser.companyId !== operatorCompanyId) {
      throw createError(404, "Target user not found");
    }

    // Soft-deleted / disabled / non-active accounts are not impersonatable.
    // 404 (not 403) is intentional — same surface as "doesn't exist" so the
    // operator can't probe account state.
    if (
      targetUser.deletedAt !== null ||
      targetUser.disabled === true ||
      targetUser.status !== "active"
    ) {
      throw createError(404, "Target user not found");
    }

    // 2026-05-04 Phase 7: removed the `isPlatformRole(targetUser.role)`
    // gate. `targetUser` is fetched from `users`; after Phase 6's DB
    // CHECK constraint, `users.role` cannot hold a platform string,
    // so the gate was dead code. Platform admins exist exclusively
    // in `platform_users` and were never reachable via this endpoint
    // even before Phase 6 in normal operation.

    if (targetUser.role === "owner") {
      throw createError(403, "Cannot impersonate another owner");
    }

    const session = await impersonationService.startImpersonation(
      req,
      res,
      owner.id,
      owner.email || "unknown",
      targetUser.id,
      // Pinned to the operator's tenant. If a future refactor of
      // getUserByCompany ever leaks a cross-tenant row, the session is
      // still bound to the operator's own tenant — never the target's.
      operatorCompanyId,
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

router.post(
  "/impersonate/stop",
  requireRole(OWNER_ONLY),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const owner = (req as any).isImpersonating ? (req as any).realUser : req.user!;

    const session = await impersonationService.getActiveImpersonation(req);
    if (!session) {
      res.json({ success: true, message: "No active impersonation session" });
      return;
    }

    await impersonationService.stopImpersonation(req, res, owner.id, owner.email || "unknown");

    res.json({ success: true, message: "Impersonation session ended" });
  })
);

router.get(
  "/impersonate/status",
  requireRole(OWNER_ONLY),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const owner = (req as any).isImpersonating ? (req as any).realUser : req.user!;

    const session = await impersonationService.checkImpersonation(req, res);

    if (!session) {
      res.json({
        isImpersonating: false,
        session: null,
      });
      return;
    }

    const targetUser = session.targetUserId
      ? await userRepository.getUser(session.targetUserId)
      : null;
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
// Time Alerts Worker — TENANT SCOPE ONLY
// ============================================================================

/**
 * POST /api/admin/run-time-alerts
 * Manually trigger the time-alerts worker for the caller's OWN tenant.
 *
 * 2026-05-03 lockdown: the prior `?allCompanies=true` branch invoked
 * `runTimeAlertsWorker()` against EVERY tenant in the SaaS while gated
 * only on tenant role `owner`. That branch and its query parameter have
 * been removed. Cross-tenant worker triggers are an `/api/platform/*`
 * concern, not a tenant-app concern.
 *
 * Query params:
 *   - date: Override date for daily checks (YYYY-MM-DD format)
 *   - runDigest: "true" to also run weekly digest for THIS tenant
 */
router.post(
  "/run-time-alerts",
  requireRole(OWNER_ONLY),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const owner = (req as any).isImpersonating ? (req as any).realUser : req.user!;
    const dateOverride = req.query.date as string | undefined;
    const runDigest = req.query.runDigest === "true";

    if (dateOverride && !/^\d{4}-\d{2}-\d{2}$/.test(dateOverride)) {
      throw createError(400, "Invalid date format. Use YYYY-MM-DD.");
    }

    const result = await runTimeAlertsForCompany(owner.companyId, { dateOverride, runDigest });

    res.json({
      success: true,
      mode: "single_company",
      companyId: owner.companyId,
      dateChecked: dateOverride || "yesterday",
      runDigest,
      result,
    });
  })
);

router.get(
  "/time-alerts/thresholds",
  requireRole(OWNER_ONLY),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req.user!;
    const thresholds = await getAlertThresholds(companyId);
    res.json({ thresholds });
  })
);

// ============================================================================
// Orphan Location Management (tenant-scoped)
// ============================================================================

router.get(
  "/orphan-locations",
  requireRole(OWNER_ONLY),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req;
    if (!companyId) {
      throw createError(401, "Missing company context");
    }

    const orphans = await customerCompanyRepository.getOrphanLocations(companyId);

    res.json({
      orphans,
      count: orphans.length,
      withSuggestions: orphans.filter(o => o.suggestedCustomerCompanyId).length,
      withoutSuggestions: orphans.filter(o => !o.suggestedCustomerCompanyId).length,
    });
  })
);

router.get(
  "/orphan-locations/count",
  requireRole(OWNER_ONLY),
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
// Data Visibility Diagnostics (tenant-scoped, regression detection)
// ============================================================================

router.get(
  "/diagnostics/visibility",
  requireRole(OWNER_ONLY),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req;
    if (!companyId) {
      throw createError(401, "Missing company context");
    }

    const { db } = await import("../db");
    const { invoices, clients, customerCompanies } = await import("@shared/schema");
    const { eq, sql } = await import("drizzle-orm");
    const { storage } = await import("../storage/index");
    const { locationDisplayNameExpr } = await import("../lib/queryHelpers");

    const [invoiceTotalResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(invoices)
      .where(eq(invoices.companyId, companyId));

    const invoiceStatusBreakdown = await db
      .select({
        status: invoices.status,
        count: sql<number>`count(*)::int`,
      })
      .from(invoices)
      .where(eq(invoices.companyId, companyId))
      .groupBy(invoices.status);

    const sampleInvoices = await db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        status: invoices.status,
      })
      .from(invoices)
      .where(eq(invoices.companyId, companyId))
      .limit(5);

    const storageInvoiceResult = await storage.getInvoices(companyId, { limit: 1000, offset: 0 });

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

    const sampleLocations = await db
      .select({
        id: clients.id,
        companyName: locationDisplayNameExpr,
        location: clients.location,
        address: clients.address,
        city: clients.city,
        parentCompanyId: clients.parentCompanyId,
        inactive: clients.inactive,
        deletedAt: clients.deletedAt,
      })
      .from(clients)
      .leftJoin(customerCompanies, eq(clients.parentCompanyId, customerCompanies.id))
      .where(eq(clients.companyId, companyId))
      .limit(10);

    const storageClientsResult = await storage.getAllClients(companyId);

    const [customerCompanyTotalResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(customerCompanies)
      .where(eq(customerCompanies.companyId, companyId));

    const [customerCompanyDeletedResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(customerCompanies)
      .where(sql`${customerCompanies.companyId} = ${companyId} AND ${customerCompanies.deletedAt} IS NOT NULL`);

    const totalInDb = Number(invoiceTotalResult.count);
    const returnedByStorage = storageInvoiceResult.items.length;
    const expectedExclusions = 0;

    const locationTotalInDb = Number(locationTotalResult.count);
    const locationReturnedByStorage = storageClientsResult.length;
    const locationExpectedExclusions = Number(locationInactiveTrueResult.count) + Number(locationDeletedAtNotNullResult.count);

    res.json({
      companyId,
      invoices: {
        totalInDb,
        statusBreakdown: invoiceStatusBreakdown.map(r => ({ status: r.status, count: Number(r.count) })),
        returnedByStorageGetInvoices: returnedByStorage,
        expectedAfterExclusions: totalInDb,
        sampleIds: sampleInvoices.map(i => ({
          id: i.id,
          invoiceNumber: i.invoiceNumber,
          status: i.status,
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
// Scheduling Health Endpoint (tenant-scoped)
// ============================================================================

/**
 * GET /api/admin/scheduling-health
 *
 * 2026-05-03 lockdown: previously selected from `jobs` with NO companyId
 * filter (cross-tenant data leak — returned IDs/job_numbers/statuses for
 * EVERY tenant's jobs). Now scoped to `req.companyId`.
 */
router.get(
  "/scheduling-health",
  requireRole(OWNER_ONLY),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req;
    if (!companyId) {
      throw createError(401, "Missing company context");
    }

    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");

    const MAX_SAMPLES = 20;

    const validStatuses = "'open', 'completed', 'invoiced', 'archived'";
    const terminalStatuses = "'invoiced', 'archived'";

    // 2026-05-03: every check now filters by company_id. Without that filter
    // a tenant owner could read job IDs/statuses across the entire SaaS.
    const tenantPredicate = sql`company_id = ${companyId}`;

    const checks = [
      {
        code: "A",
        name: "Legacy status values",
        description: "Jobs with status NOT IN normalized values (open, completed, invoiced, archived)",
        countSql: sql`SELECT count(*) as count FROM jobs WHERE ${tenantPredicate} AND deleted_at IS NULL AND status NOT IN (${sql.raw(validStatuses)})`,
        sampleSql: sql`SELECT id, job_number, status, scheduled_start, scheduled_end, is_all_day FROM jobs WHERE ${tenantPredicate} AND deleted_at IS NULL AND status NOT IN (${sql.raw(validStatuses)}) LIMIT ${MAX_SAMPLES}`,
      },
      {
        code: "B",
        name: "Terminal jobs with schedule",
        description: "Jobs with terminal status but still have schedule fields set",
        countSql: sql`SELECT count(*) as count FROM jobs WHERE ${tenantPredicate} AND deleted_at IS NULL AND status IN (${sql.raw(terminalStatuses)}) AND (scheduled_start IS NOT NULL OR scheduled_end IS NOT NULL OR is_all_day = true)`,
        sampleSql: sql`SELECT id, job_number, status, scheduled_start, scheduled_end, is_all_day FROM jobs WHERE ${tenantPredicate} AND deleted_at IS NULL AND status IN (${sql.raw(terminalStatuses)}) AND (scheduled_start IS NOT NULL OR scheduled_end IS NOT NULL OR is_all_day = true) LIMIT ${MAX_SAMPLES}`,
      },
      {
        code: "C",
        name: "Invalid openSubStatus",
        description: "Jobs with openSubStatus set but status != 'open'",
        countSql: sql`SELECT count(*) as count FROM jobs WHERE ${tenantPredicate} AND deleted_at IS NULL AND open_sub_status IS NOT NULL AND status != 'open'`,
        sampleSql: sql`SELECT id, job_number, status, open_sub_status, scheduled_start, is_all_day FROM jobs WHERE ${tenantPredicate} AND deleted_at IS NULL AND open_sub_status IS NOT NULL AND status != 'open' LIMIT ${MAX_SAMPLES}`,
      },
      {
        code: "D",
        name: "All-day without scheduledStart (CANONICAL VIOLATION)",
        description: "All-day events must have scheduledStart set to midnight",
        countSql: sql`SELECT count(*) as count FROM jobs WHERE ${tenantPredicate} AND deleted_at IS NULL AND is_all_day = true AND scheduled_start IS NULL`,
        sampleSql: sql`SELECT id, job_number, status, scheduled_start, scheduled_end, is_all_day FROM jobs WHERE ${tenantPredicate} AND deleted_at IS NULL AND is_all_day = true AND scheduled_start IS NULL LIMIT ${MAX_SAMPLES}`,
      },
      {
        code: "D2",
        name: "All-day normalization violations",
        description: "All-day events with incorrect start/end times",
        countSql: sql`SELECT count(*) as count FROM jobs WHERE ${tenantPredicate} AND deleted_at IS NULL AND is_all_day = true AND scheduled_start IS NOT NULL AND (EXTRACT(HOUR FROM scheduled_start) != 0 OR EXTRACT(MINUTE FROM scheduled_start) != 0 OR scheduled_end IS NULL)`,
        sampleSql: sql`SELECT id, job_number, status, scheduled_start, scheduled_end, is_all_day FROM jobs WHERE ${tenantPredicate} AND deleted_at IS NULL AND is_all_day = true AND scheduled_start IS NOT NULL AND (EXTRACT(HOUR FROM scheduled_start) != 0 OR EXTRACT(MINUTE FROM scheduled_start) != 0 OR scheduled_end IS NULL) LIMIT ${MAX_SAMPLES}`,
      },
      {
        code: "E",
        name: "Missing scheduledEnd",
        description: "Jobs with scheduledStart but no scheduledEnd",
        countSql: sql`SELECT count(*) as count FROM jobs WHERE ${tenantPredicate} AND deleted_at IS NULL AND scheduled_start IS NOT NULL AND scheduled_end IS NULL`,
        sampleSql: sql`SELECT id, job_number, status, scheduled_start, scheduled_end, is_all_day FROM jobs WHERE ${tenantPredicate} AND deleted_at IS NULL AND scheduled_start IS NOT NULL AND scheduled_end IS NULL LIMIT ${MAX_SAMPLES}`,
      },
      {
        code: "F",
        name: "Invalid time range (end <= start)",
        description: "Jobs where scheduledEnd is not after scheduledStart",
        countSql: sql`SELECT count(*) as count FROM jobs WHERE ${tenantPredicate} AND deleted_at IS NULL AND scheduled_start IS NOT NULL AND scheduled_end IS NOT NULL AND scheduled_end <= scheduled_start`,
        sampleSql: sql`SELECT id, job_number, status, scheduled_start, scheduled_end, is_all_day FROM jobs WHERE ${tenantPredicate} AND deleted_at IS NULL AND scheduled_start IS NOT NULL AND scheduled_end IS NOT NULL AND scheduled_end <= scheduled_start LIMIT ${MAX_SAMPLES}`,
      },
      {
        code: "G",
        name: "NULL version on scheduled jobs",
        description: "Scheduled jobs with NULL version",
        countSql: sql`SELECT count(*) as count FROM jobs WHERE ${tenantPredicate} AND deleted_at IS NULL AND scheduled_start IS NOT NULL AND version IS NULL`,
        sampleSql: sql`SELECT id, job_number, status, scheduled_start, version FROM jobs WHERE ${tenantPredicate} AND deleted_at IS NULL AND scheduled_start IS NOT NULL AND version IS NULL LIMIT ${MAX_SAMPLES}`,
      },
      {
        code: "H",
        name: "Invalid version (< 1)",
        description: "Jobs with version < 1",
        countSql: sql`SELECT count(*) as count FROM jobs WHERE ${tenantPredicate} AND deleted_at IS NULL AND version IS NOT NULL AND version < 1`,
        sampleSql: sql`SELECT id, job_number, status, version FROM jobs WHERE ${tenantPredicate} AND deleted_at IS NULL AND version IS NOT NULL AND version < 1 LIMIT ${MAX_SAMPLES}`,
      },
    ];

    const results = [];
    let totalViolations = 0;

    for (const check of checks) {
      const countRows = await db.execute(check.countSql) as unknown as { count: string }[];
      const count = Number(countRows[0]?.count || 0);
      totalViolations += count;

      let samples: any[] = [];
      if (count > 0) {
        samples = await db.execute(check.sampleSql) as unknown as any[];
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
// Guardrail Tests — tenant-scoped regression detection
// ============================================================================

router.get(
  "/diagnostics/guardrails",
  requireRole(OWNER_ONLY),
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

    const [invoiceTotalResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(invoices)
      .where(eq(invoices.companyId, companyId));

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

    const storageClientsResult = await storage.getAllClients(companyId);

    tests.push({
      name: "Location visibility via getAllClients",
      passed: totalLocations === 0 || storageClientsResult.length > 0,
      expected: totalLocations > 0 ? "At least 1 location returned" : "No locations expected (DB has 0)",
      actual: `${storageClientsResult.length} location(s) returned`,
      severity: "critical",
    });

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

// ============================================================================
// Removed-route catch-alls (defense-in-depth)
// ============================================================================
//
// 2026-05-03 lockdown: explicit 410 Gone responses for the cross-tenant
// endpoints that used to live on this router. If anything in the codebase
// still constructs URLs to these paths it will get a clean rejection
// pointing to the canonical platform surface, not silent success.

router.all("/tenants", (_req, res) =>
  res.status(410).json({
    error: "Gone",
    code: "ADMIN_CROSS_TENANT_ROUTE_RETIRED",
    message:
      "GET /api/admin/tenants was removed (2026-05-03) — it leaked cross-tenant data to tenant owners. Cross-tenant tenant lists live at /api/platform/tenants (psid + tenant:read).",
  })
);

router.all(/^\/qbo(\/.*)?$/, (_req, res) =>
  res.status(410).json({
    error: "Gone",
    code: "ADMIN_CROSS_TENANT_ROUTE_RETIRED",
    message:
      "/api/admin/qbo/* routes were removed (2026-05-03) — they leaked cross-tenant QBO data to tenant owners. Platform QBO oversight belongs under /api/platform/* with the appropriate capability.",
  })
);

router.all("/run-weekly-digest", (_req, res) =>
  res.status(410).json({
    error: "Gone",
    code: "ADMIN_CROSS_TENANT_ROUTE_RETIRED",
    message:
      "POST /api/admin/run-weekly-digest was removed (2026-05-03) — it ran cross-tenant under tenant auth.",
  })
);

export default router;
