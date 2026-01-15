/**
 * QBO Sync Routes - Explicit endpoints for triggering QBO sync operations
 *
 * All routes:
 * - Require authentication
 * - Restricted to OWNER/ADMIN roles only
 * - Use QboSyncOrchestrator for all sync operations
 * - Are thin wrappers that call orchestrator and return results
 *
 * No business logic in routes - all logic is in the orchestrator.
 */

import { Router, Request, Response } from "express";
import crypto from "crypto";
import { requireRole } from "../auth/requireRole";
import { ADMIN_ROLES } from "../auth/roles";
import { asyncHandler } from "../middleware/errorHandler";
import { AuthedRequest } from "../auth/tenantIsolation";
import { createSyncOrchestrator, QboClient, createReconciliationService, createPreflightService } from "../services/qbo";
import type { QboTokens } from "../services/qbo";
import { db } from "../db";
import { customerCompanies, invoices, qboSyncEvents, companies, qboMappingConfigSchema, qboSyncQueue, qboQueueEntityTypeEnum, qboQueueActionEnum, qboEnvironmentEnum } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { QboItemMapper, parseQboMappingConfig, createQueueProcessor, getQueueJobs, getQueueStats, createItemServiceFromTokens } from "../services/qbo";
import { items } from "@shared/schema";
import { z } from "zod";

const router = Router();

/**
 * Generate a unique syncRunId for correlating events in a single admin-triggered operation
 */
function generateSyncRunId(): string {
  return `run_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

/**
 * Helper to get QBO tokens from company settings
 * In a real implementation, this would fetch from database
 * For now, returns null if not configured
 */
async function getQboTokensForCompany(companyId: string): Promise<QboTokens | null> {
  // TODO: Implement token retrieval from company settings/storage
  // This is a placeholder - tokens should be stored per-company after OAuth flow
  const accessToken = process.env.QBO_ACCESS_TOKEN;
  const refreshToken = process.env.QBO_REFRESH_TOKEN;
  const realmId = process.env.QBO_REALM_ID;

  if (!accessToken || !refreshToken || !realmId) {
    return null;
  }

  return {
    accessToken,
    refreshToken,
    realmId,
    expiresAt: new Date(Date.now() + 3600 * 1000), // 1 hour from now (placeholder)
  };
}

/**
 * POST /api/qbo/sync/customer-company/:id
 * Sync a single CustomerCompany to QBO
 */
router.post(
  "/sync/customer-company/:id",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { id } = req.params;
    const companyId = req.companyId;
    const userId = req.user?.id;

    // Get QBO tokens
    const tokens = await getQboTokensForCompany(companyId);
    if (!tokens) {
      return res.status(503).json({
        success: false,
        error: "QBO integration not configured for this company",
      });
    }

    // Create orchestrator and sync
    const syncRunId = generateSyncRunId();
    const orchestrator = createSyncOrchestrator(tokens, companyId, userId, syncRunId);
    if (!orchestrator) {
      return res.status(503).json({
        success: false,
        error: "QBO integration not available",
      });
    }

    const result = await orchestrator.syncCustomerCompany(id);
    res.json({ ...result, syncRunId });
  })
);

/**
 * POST /api/qbo/sync/client-location/:id
 * Sync a single ClientLocation to QBO
 */
router.post(
  "/sync/client-location/:id",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { id } = req.params;
    const companyId = req.companyId;
    const userId = req.user?.id;

    // Get QBO tokens
    const tokens = await getQboTokensForCompany(companyId);
    if (!tokens) {
      return res.status(503).json({
        success: false,
        error: "QBO integration not configured for this company",
      });
    }

    // Create orchestrator and sync
    const syncRunId = generateSyncRunId();
    const orchestrator = createSyncOrchestrator(tokens, companyId, userId, syncRunId);
    if (!orchestrator) {
      return res.status(503).json({
        success: false,
        error: "QBO integration not available",
      });
    }

    const result = await orchestrator.syncClientLocation(id);
    res.json({ ...result, syncRunId });
  })
);

/**
 * POST /api/qbo/sync/invoice/:id
 * Sync a single Invoice to QBO (without dependencies)
 */
router.post(
  "/sync/invoice/:id",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { id } = req.params;
    const companyId = req.companyId;
    const userId = req.user?.id;

    // Get QBO tokens
    const tokens = await getQboTokensForCompany(companyId);
    if (!tokens) {
      return res.status(503).json({
        success: false,
        error: "QBO integration not configured for this company",
      });
    }

    // Create orchestrator and sync
    const syncRunId = generateSyncRunId();
    const orchestrator = createSyncOrchestrator(tokens, companyId, userId, syncRunId);
    if (!orchestrator) {
      return res.status(503).json({
        success: false,
        error: "QBO integration not available",
      });
    }

    const result = await orchestrator.syncInvoice(id);
    res.json({ ...result, syncRunId });
  })
);

/**
 * POST /api/qbo/sync/invoice-with-deps/:id
 * Sync an Invoice with all its dependencies (CustomerCompany, ClientLocation)
 * Enforces correct sync order: CustomerCompany → ClientLocation → Invoice
 */
router.post(
  "/sync/invoice-with-deps/:id",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { id } = req.params;
    const companyId = req.companyId;
    const userId = req.user?.id;

    // Get QBO tokens
    const tokens = await getQboTokensForCompany(companyId);
    if (!tokens) {
      return res.status(503).json({
        success: false,
        error: "QBO integration not configured for this company",
      });
    }

    // Create orchestrator and sync
    const syncRunId = generateSyncRunId();
    const orchestrator = createSyncOrchestrator(tokens, companyId, userId, syncRunId);
    if (!orchestrator) {
      return res.status(503).json({
        success: false,
        error: "QBO integration not available",
      });
    }

    const result = await orchestrator.syncInvoiceWithDependencies(id);
    res.json({ ...result, syncRunId });
  })
);

// ============================================================
// RECONCILIATION ROUTES
// ============================================================

/**
 * Helper to create QBO client from tokens
 */
function createQboClient(tokens: QboTokens): QboClient | null {
  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const environment = (process.env.QBO_ENVIRONMENT as "sandbox" | "production") || "sandbox";

  if (!clientId || !clientSecret) {
    return null;
  }

  return new QboClient({ clientId, clientSecret, environment }, tokens);
}

/**
 * POST /api/qbo/reconcile/invoice/:id
 * Dry run reconciliation - compares local and QBO invoice/payment state
 * Returns differences without making any changes
 */
router.post(
  "/reconcile/invoice/:id",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { id } = req.params;
    const companyId = req.companyId;
    const userId = req.user?.id;

    // Get QBO tokens
    const tokens = await getQboTokensForCompany(companyId);
    if (!tokens) {
      return res.status(503).json({
        success: false,
        error: "QBO integration not configured for this company",
      });
    }

    // Create QBO client
    const client = createQboClient(tokens);
    if (!client) {
      return res.status(503).json({
        success: false,
        error: "QBO integration not available",
      });
    }

    // Create reconciliation service and run dry run
    const reconciliationService = createReconciliationService(client, companyId, userId);
    const result = await reconciliationService.reconcileDryRun(id);
    res.json(result);
  })
);

/**
 * POST /api/qbo/reconcile/invoice/:id/apply
 * Apply reconciliation - creates local payment records for QBO payments
 * Only creates payments that don't exist locally
 */
router.post(
  "/reconcile/invoice/:id/apply",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { id } = req.params;
    const companyId = req.companyId;
    const userId = req.user?.id;

    // Get QBO tokens
    const tokens = await getQboTokensForCompany(companyId);
    if (!tokens) {
      return res.status(503).json({
        success: false,
        error: "QBO integration not configured for this company",
      });
    }

    // Create QBO client
    const client = createQboClient(tokens);
    if (!client) {
      return res.status(503).json({
        success: false,
        error: "QBO integration not available",
      });
    }

    // Create reconciliation service and apply
    const reconciliationService = createReconciliationService(client, companyId, userId);
    const result = await reconciliationService.reconcileApply(id);
    res.json(result);
  })
);

// ============================================================
// STATUS & EVENTS ROUTES (READ-ONLY)
// ============================================================

/**
 * GET /api/qbo/status
 * Returns sync status dashboard data
 * - Counts of customer_companies and invoices by qboSyncStatus
 * - Last 10 failed qbo_sync_events
 * - Mapping configuration status
 */
router.get(
  "/status",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;

    // Fetch company's QBO mapping config
    const [company] = await db
      .select({ qboMappingConfig: companies.qboMappingConfig })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);

    const mappingConfig = parseQboMappingConfig(company?.qboMappingConfig);
    const mappingStatus = QboItemMapper.checkConfigStatus(mappingConfig);

    // Count customer_companies by qboSyncStatus
    const customerStatusCounts = await db
      .select({
        status: customerCompanies.qboSyncStatus,
        count: sql<number>`count(*)::int`,
      })
      .from(customerCompanies)
      .where(eq(customerCompanies.companyId, companyId))
      .groupBy(customerCompanies.qboSyncStatus);

    // Count invoices by qboSyncStatus
    const invoiceStatusCounts = await db
      .select({
        status: invoices.qboSyncStatus,
        count: sql<number>`count(*)::int`,
      })
      .from(invoices)
      .where(eq(invoices.companyId, companyId))
      .groupBy(invoices.qboSyncStatus);

    // Get last 10 failed sync events
    const recentFailures = await db
      .select({
        id: qboSyncEvents.id,
        eventType: qboSyncEvents.eventType,
        result: qboSyncEvents.result,
        customerCompanyId: qboSyncEvents.customerCompanyId,
        clientLocationId: qboSyncEvents.clientLocationId,
        invoiceId: qboSyncEvents.invoiceId,
        qboEntityId: qboSyncEvents.qboEntityId,
        errorMessage: qboSyncEvents.errorMessage,
        errorCode: qboSyncEvents.errorCode,
        durationMs: qboSyncEvents.durationMs,
        createdAt: qboSyncEvents.createdAt,
      })
      .from(qboSyncEvents)
      .where(
        and(
          eq(qboSyncEvents.companyId, companyId),
          eq(qboSyncEvents.result, "FAILURE")
        )
      )
      .orderBy(desc(qboSyncEvents.createdAt))
      .limit(10);

    // Build status summary with defaults for missing statuses
    const statusValues = ["NOT_SYNCED", "SYNCED", "PENDING", "ERROR"] as const;

    const customerCounts = Object.fromEntries(
      statusValues.map(s => [s, customerStatusCounts.find(c => c.status === s)?.count ?? 0])
    );
    const invoiceCounts = Object.fromEntries(
      statusValues.map(s => [s, invoiceStatusCounts.find(c => c.status === s)?.count ?? 0])
    );

    res.json({
      customerCompanies: customerCounts,
      invoices: invoiceCounts,
      recentFailures,
      mappingStatus,
    });
  })
);

/**
 * GET /api/qbo/mapping-config
 * Returns the company's QBO item/tax mapping configuration
 */
router.get(
  "/mapping-config",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;

    const [company] = await db
      .select({ qboMappingConfig: companies.qboMappingConfig })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);

    const config = parseQboMappingConfig(company?.qboMappingConfig);
    const status = QboItemMapper.checkConfigStatus(config);

    res.json({
      config: config || {},
      status,
    });
  })
);

/**
 * PUT /api/qbo/mapping-config
 * Updates the company's QBO item/tax mapping configuration
 */
router.put(
  "/mapping-config",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;

    // Validate the config
    const parseResult = qboMappingConfigSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: "Invalid mapping configuration",
        details: parseResult.error.flatten(),
      });
    }

    // Update the company's config
    await db
      .update(companies)
      .set({ qboMappingConfig: parseResult.data })
      .where(eq(companies.id, companyId));

    const status = QboItemMapper.checkConfigStatus(parseResult.data);

    res.json({
      success: true,
      config: parseResult.data,
      status,
    });
  })
);

// ============================================================
// PREFLIGHT & GO-LIVE ROUTES
// ============================================================

/**
 * GET /api/qbo/preflight
 * Run preflight checks for QBO integration
 * Returns: qboEnabled, tokensConfigured, mappingStatus, connectivityCheck, queueStats, readyToSync
 */
router.get(
  "/preflight",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const userId = req.user?.id;

    // Get QBO tokens (may be null)
    const tokens = await getQboTokensForCompany(companyId);

    const preflightService = createPreflightService(companyId, userId);
    const result = await preflightService.runPreflight(tokens);

    res.json(result);
  })
);

const enableSchema = z.object({
  enabled: z.boolean(),
  environment: z.enum(qboEnvironmentEnum).optional(),
});

/**
 * PUT /api/qbo/enabled
 * Enable or disable QBO sync for company
 * Only allows enabling if preflight passes
 */
router.put(
  "/enabled",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const userId = req.user?.id;

    // Validate request body
    const parseResult = enableSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: "Invalid request body",
        details: parseResult.error.flatten(),
      });
    }

    const { enabled, environment } = parseResult.data;

    // Get QBO tokens (needed for preflight if enabling)
    const tokens = await getQboTokensForCompany(companyId);

    const preflightService = createPreflightService(companyId, userId);
    const result = await preflightService.setEnabled(enabled, environment, tokens);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  })
);

/**
 * POST /api/qbo/dry-run/invoice/:id
 * Dry-run invoice sync - builds payload, validates, but does NOT call QBO
 * Returns redacted payload preview
 */
router.post(
  "/dry-run/invoice/:id",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { id } = req.params;
    const companyId = req.companyId;
    const userId = req.user?.id;

    const preflightService = createPreflightService(companyId, userId);
    const result = await preflightService.dryRunInvoiceSync(id);

    res.json(result);
  })
);

/**
 * POST /api/qbo/dry-run/queue/process
 * Dry-run queue processing - returns what would be processed without actually syncing
 */
router.post(
  "/dry-run/queue/process",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 100);

    // Get queue stats and jobs that would be processed
    const stats = await getQueueStats(companyId);
    const jobs = await getQueueJobs(companyId, { status: "QUEUED", limit });

    // Also get failed jobs that are retriable
    const failedJobs = await getQueueJobs(companyId, { status: "FAILED", limit });
    const retriableJobs = failedJobs.filter(j => j.attempts < j.maxAttempts);

    res.json({
      dryRun: true,
      wouldProcess: {
        queued: jobs.length,
        retriable: retriableJobs.length,
        total: jobs.length + retriableJobs.length,
      },
      queuedJobs: jobs.map(j => ({
        id: j.id,
        entityType: j.entityType,
        entityId: j.entityId,
        action: j.action,
        attempts: j.attempts,
        maxAttempts: j.maxAttempts,
      })),
      retriableJobs: retriableJobs.map(j => ({
        id: j.id,
        entityType: j.entityType,
        entityId: j.entityId,
        action: j.action,
        attempts: j.attempts,
        maxAttempts: j.maxAttempts,
        lastError: j.lastError,
      })),
      stats,
    });
  })
);

/**
 * POST /api/qbo/connectivity-test
 * Test QBO API connectivity (simple read-only query)
 */
router.post(
  "/connectivity-test",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const userId = req.user?.id;

    // Get QBO tokens
    const tokens = await getQboTokensForCompany(companyId);
    if (!tokens) {
      return res.status(503).json({
        success: false,
        error: "QBO tokens not configured",
      });
    }

    const preflightService = createPreflightService(companyId, userId);
    const preflight = await preflightService.runPreflight(tokens);

    res.json({
      success: preflight.connectivityCheck.success,
      latencyMs: preflight.connectivityCheck.latencyMs,
      error: preflight.connectivityCheck.error,
    });
  })
);

/**
 * GET /api/qbo/events
 * Returns recent qbo_sync_events with filtering
 * Query params: limit (default 50), entityType, result
 * IMPORTANT: Never returns OAuth tokens or request payloads with sensitive data
 */
router.get(
  "/events",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
    const entityType = req.query.entityType as string | undefined;
    const resultFilter = req.query.result as string | undefined;

    // Build where conditions
    const conditions = [eq(qboSyncEvents.companyId, companyId)];

    if (entityType) {
      conditions.push(eq(qboSyncEvents.eventType, entityType));
    }

    if (resultFilter) {
      conditions.push(eq(qboSyncEvents.result, resultFilter));
    }

    const events = await db
      .select({
        id: qboSyncEvents.id,
        eventType: qboSyncEvents.eventType,
        result: qboSyncEvents.result,
        customerCompanyId: qboSyncEvents.customerCompanyId,
        clientLocationId: qboSyncEvents.clientLocationId,
        invoiceId: qboSyncEvents.invoiceId,
        qboEntityId: qboSyncEvents.qboEntityId,
        qboSyncToken: qboSyncEvents.qboSyncToken,
        errorMessage: qboSyncEvents.errorMessage,
        errorCode: qboSyncEvents.errorCode,
        durationMs: qboSyncEvents.durationMs,
        triggeredBy: qboSyncEvents.triggeredBy,
        createdAt: qboSyncEvents.createdAt,
        // Note: requestPayload and responsePayload are intentionally excluded
        // to prevent potential token/sensitive data exposure
      })
      .from(qboSyncEvents)
      .where(and(...conditions))
      .orderBy(desc(qboSyncEvents.createdAt))
      .limit(limit);

    res.json({ events, limit });
  })
);

// ============================================================
// QUEUE MANAGEMENT ROUTES
// ============================================================

const enqueueSchema = z.object({
  entityType: z.enum(qboQueueEntityTypeEnum),
  entityId: z.string().min(1),
  action: z.enum(qboQueueActionEnum),
  maxAttempts: z.number().int().min(1).max(10).optional(),
});

/**
 * POST /api/qbo/queue/enqueue
 * Add a new job to the sync queue
 */
router.post(
  "/queue/enqueue",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const userId = req.user?.id;

    // Validate request body
    const parseResult = enqueueSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: "Invalid request body",
        details: parseResult.error.flatten(),
      });
    }

    const { entityType, entityId, action, maxAttempts } = parseResult.data;

    // Get QBO tokens
    const tokens = await getQboTokensForCompany(companyId);
    if (!tokens) {
      return res.status(503).json({
        success: false,
        error: "QBO integration not configured for this company",
      });
    }

    const syncRunId = generateSyncRunId();
    const processor = createQueueProcessor(companyId, tokens, userId, syncRunId);
    const result = await processor.enqueue(entityType, entityId, action, maxAttempts ?? 3);

    if (result.success) {
      res.status(201).json({ ...result, syncRunId });
    } else {
      res.status(400).json(result);
    }
  })
);

/**
 * POST /api/qbo/queue/process
 * Process eligible jobs in the queue (admin-triggered)
 */
router.post(
  "/queue/process",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const userId = req.user?.id;
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 100);

    // Get QBO tokens
    const tokens = await getQboTokensForCompany(companyId);
    if (!tokens) {
      return res.status(503).json({
        success: false,
        error: "QBO integration not configured for this company",
      });
    }

    const syncRunId = generateSyncRunId();
    const processor = createQueueProcessor(companyId, tokens, userId, syncRunId);
    const result = await processor.processQueue(limit);

    res.json({ ...result, syncRunId });
  })
);

/**
 * GET /api/qbo/queue
 * Get queue jobs with optional filtering
 */
router.get(
  "/queue",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const status = req.query.status as string | undefined;
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);

    const jobs = await getQueueJobs(companyId, { status, limit });
    const stats = await getQueueStats(companyId);

    res.json({ jobs, stats, limit });
  })
);

/**
 * POST /api/qbo/queue/:id/replay
 * Replay a specific failed job
 */
router.post(
  "/queue/:id/replay",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const userId = req.user?.id;
    const { id } = req.params;

    // Get QBO tokens
    const tokens = await getQboTokensForCompany(companyId);
    if (!tokens) {
      return res.status(503).json({
        success: false,
        error: "QBO integration not configured for this company",
      });
    }

    const syncRunId = generateSyncRunId();
    const processor = createQueueProcessor(companyId, tokens, userId, syncRunId);
    const result = await processor.replayJob(id);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: "Job not found",
      });
    }

    res.json(result);
  })
);

/**
 * DELETE /api/qbo/queue/:id
 * Remove a job from the queue (only if QUEUED or FAILED)
 */
router.delete(
  "/queue/:id",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const { id } = req.params;

    // Verify job exists and belongs to company
    const [job] = await db
      .select()
      .from(qboSyncQueue)
      .where(
        and(
          eq(qboSyncQueue.id, id),
          eq(qboSyncQueue.companyId, companyId)
        )
      )
      .limit(1);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: "Job not found",
      });
    }

    if (job.status === "RUNNING") {
      return res.status(400).json({
        success: false,
        error: "Cannot delete a running job",
      });
    }

    await db
      .delete(qboSyncQueue)
      .where(eq(qboSyncQueue.id, id));

    res.json({ success: true, deletedJobId: id });
  })
);

// ============================================================
// WEBHOOK ROUTES
// ============================================================

import { createWebhookService } from "../services/qbo";
import type { IntuitWebhookPayload } from "../services/qbo";
import { qboWebhookEvents } from "@shared/schema";

/**
 * POST /api/qbo/webhook
 * PUBLIC ENDPOINT - receives webhooks from Intuit
 * Verifies signature and stores events for later processing
 */
router.post(
  "/webhook",
  // NO AUTH - this is a public endpoint for Intuit webhooks
  asyncHandler(async (req: Request, res: Response) => {
    // Get raw body for signature verification
    const rawBody = JSON.stringify(req.body);
    const signature = req.headers["intuit-signature"] as string;

    if (!signature) {
      return res.status(401).json({
        success: false,
        error: "Missing Intuit-Signature header",
      });
    }

    const webhookService = createWebhookService();
    const payload = req.body as IntuitWebhookPayload;

    const result = await webhookService.receiveWebhook(payload, rawBody, signature);

    // Always return 200 to Intuit to acknowledge receipt
    // Even if verification fails, we store the event as REJECTED
    res.status(200).json({
      received: true,
      eventsStored: result.eventsReceived,
    });
  })
);

/**
 * POST /api/qbo/webhook/process
 * Admin endpoint to process verified webhook events
 */
router.post(
  "/webhook/process",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const userId = req.user?.id;
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);

    const processedRunId = generateSyncRunId();
    const webhookService = createWebhookService();
    const result = await webhookService.processWebhookEvents(companyId, limit, userId, processedRunId);

    res.json({ ...result, processedRunId });
  })
);

/**
 * GET /api/qbo/webhooks
 * Returns recent webhook events with filtering
 */
router.get(
  "/webhooks",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const status = req.query.status as string | undefined;
    const entityType = req.query.entityType as string | undefined;
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);

    const webhookService = createWebhookService();
    const events = await webhookService.getWebhookEvents(companyId, { status, entityType, limit });

    // Redact sensitive info from response
    const safeEvents = events.map(e => ({
      id: e.id,
      realmId: e.realmId,
      qboEntityType: e.qboEntityType,
      qboEntityId: e.qboEntityId,
      operation: e.operation,
      status: e.status,
      actionTaken: e.actionTaken,
      relatedInvoiceId: e.relatedInvoiceId,
      queueJobId: e.queueJobId,
      verificationError: e.verificationError,
      processingError: e.processingError,
      receivedAt: e.receivedAt,
      processedAt: e.processedAt,
      // Exclude eventPayload from response for security
    }));

    res.json({ events: safeEvents, limit });
  })
);

/**
 * GET /api/qbo/drift-alerts
 * Returns invoices that have drift alerts (QBO changes not reflected locally)
 */
router.get(
  "/drift-alerts",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;

    const webhookService = createWebhookService();
    const alerts = await webhookService.getDriftAlerts(companyId);

    res.json({ alerts });
  })
);

/**
 * POST /api/qbo/drift-alerts/:eventId/reconcile
 * Enqueue a reconcile job for a drift alert
 */
router.post(
  "/drift-alerts/:eventId/reconcile",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const userId = req.user?.id;
    const { eventId } = req.params;

    // Get the webhook event
    const [event] = await db
      .select()
      .from(qboWebhookEvents)
      .where(
        and(
          eq(qboWebhookEvents.id, eventId),
          eq(qboWebhookEvents.companyId, companyId)
        )
      )
      .limit(1);

    if (!event) {
      return res.status(404).json({
        success: false,
        error: "Webhook event not found",
      });
    }

    if (!event.relatedInvoiceId) {
      return res.status(400).json({
        success: false,
        error: "No related invoice for this event",
      });
    }

    // Enqueue reconcile job
    const [job] = await db
      .insert(qboSyncQueue)
      .values({
        companyId,
        entityType: "INVOICE",
        entityId: event.relatedInvoiceId,
        action: "RECONCILE",
        status: "QUEUED",
        enqueuedBy: userId,
      })
      .returning();

    // Update webhook event
    await db
      .update(qboWebhookEvents)
      .set({
        queueJobId: job.id,
      })
      .where(eq(qboWebhookEvents.id, eventId));

    res.json({
      success: true,
      jobId: job.id,
      invoiceId: event.relatedInvoiceId,
    });
  })
);

// ============================================================================
// RUN AGGREGATION ENDPOINTS
// ============================================================================

/**
 * GET /api/qbo/runs - Get recent sync runs aggregated by syncRunId
 * Returns runs with counts of events, queue jobs, and webhook events
 */
router.get(
  "/runs",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.user!.companyId;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    // Get recent runs from sync events
    const syncEventRuns = await db
      .select({
        syncRunId: qboSyncEvents.syncRunId,
        minCreatedAt: sql<string>`MIN(${qboSyncEvents.createdAt})`.as("min_created_at"),
        maxCreatedAt: sql<string>`MAX(${qboSyncEvents.createdAt})`.as("max_created_at"),
        eventCount: sql<number>`COUNT(*)::int`.as("event_count"),
        successCount: sql<number>`COUNT(*) FILTER (WHERE ${qboSyncEvents.result} = 'SUCCESS')::int`.as("success_count"),
        failureCount: sql<number>`COUNT(*) FILTER (WHERE ${qboSyncEvents.result} = 'FAILURE')::int`.as("failure_count"),
      })
      .from(qboSyncEvents)
      .where(and(
        eq(qboSyncEvents.companyId, companyId),
        sql`${qboSyncEvents.syncRunId} IS NOT NULL`
      ))
      .groupBy(qboSyncEvents.syncRunId)
      .orderBy(sql`MAX(${qboSyncEvents.createdAt}) DESC`)
      .limit(limit);

    // Get queue job counts by run
    const queueJobRuns = await db
      .select({
        syncRunId: qboSyncQueue.syncRunId,
        queueJobCount: sql<number>`COUNT(*)::int`.as("queue_job_count"),
        queueSuccessCount: sql<number>`COUNT(*) FILTER (WHERE ${qboSyncQueue.status} = 'SUCCESS')::int`.as("queue_success_count"),
        queueFailedCount: sql<number>`COUNT(*) FILTER (WHERE ${qboSyncQueue.status} = 'FAILED')::int`.as("queue_failed_count"),
      })
      .from(qboSyncQueue)
      .where(and(
        eq(qboSyncQueue.companyId, companyId),
        sql`${qboSyncQueue.syncRunId} IS NOT NULL`
      ))
      .groupBy(qboSyncQueue.syncRunId);

    // Get webhook events by processedRunId
    const webhookRuns = await db
      .select({
        processedRunId: qboWebhookEvents.processedRunId,
        webhookEventCount: sql<number>`COUNT(*)::int`.as("webhook_event_count"),
        webhookProcessedCount: sql<number>`COUNT(*) FILTER (WHERE ${qboWebhookEvents.status} = 'PROCESSED')::int`.as("webhook_processed_count"),
      })
      .from(qboWebhookEvents)
      .where(and(
        eq(qboWebhookEvents.companyId, companyId),
        sql`${qboWebhookEvents.processedRunId} IS NOT NULL`
      ))
      .groupBy(qboWebhookEvents.processedRunId);

    // Merge results by syncRunId
    const runMap = new Map<string, {
      syncRunId: string;
      startedAt: string;
      completedAt: string;
      eventCount: number;
      successCount: number;
      failureCount: number;
      queueJobCount: number;
      queueSuccessCount: number;
      queueFailedCount: number;
      webhookEventCount: number;
      webhookProcessedCount: number;
    }>();

    for (const run of syncEventRuns) {
      if (run.syncRunId) {
        runMap.set(run.syncRunId, {
          syncRunId: run.syncRunId,
          startedAt: run.minCreatedAt,
          completedAt: run.maxCreatedAt,
          eventCount: run.eventCount,
          successCount: run.successCount,
          failureCount: run.failureCount,
          queueJobCount: 0,
          queueSuccessCount: 0,
          queueFailedCount: 0,
          webhookEventCount: 0,
          webhookProcessedCount: 0,
        });
      }
    }

    for (const qj of queueJobRuns) {
      if (qj.syncRunId && runMap.has(qj.syncRunId)) {
        const run = runMap.get(qj.syncRunId)!;
        run.queueJobCount = qj.queueJobCount;
        run.queueSuccessCount = qj.queueSuccessCount;
        run.queueFailedCount = qj.queueFailedCount;
      } else if (qj.syncRunId) {
        // Run only has queue jobs, no sync events
        runMap.set(qj.syncRunId, {
          syncRunId: qj.syncRunId,
          startedAt: "",
          completedAt: "",
          eventCount: 0,
          successCount: 0,
          failureCount: 0,
          queueJobCount: qj.queueJobCount,
          queueSuccessCount: qj.queueSuccessCount,
          queueFailedCount: qj.queueFailedCount,
          webhookEventCount: 0,
          webhookProcessedCount: 0,
        });
      }
    }

    for (const wh of webhookRuns) {
      if (wh.processedRunId && runMap.has(wh.processedRunId)) {
        const run = runMap.get(wh.processedRunId)!;
        run.webhookEventCount = wh.webhookEventCount;
        run.webhookProcessedCount = wh.webhookProcessedCount;
      } else if (wh.processedRunId) {
        // Run only has webhook events
        runMap.set(wh.processedRunId, {
          syncRunId: wh.processedRunId,
          startedAt: "",
          completedAt: "",
          eventCount: 0,
          successCount: 0,
          failureCount: 0,
          queueJobCount: 0,
          queueSuccessCount: 0,
          queueFailedCount: 0,
          webhookEventCount: wh.webhookEventCount,
          webhookProcessedCount: wh.webhookProcessedCount,
        });
      }
    }

    // Convert to array and sort by most recent
    const runs = Array.from(runMap.values())
      .sort((a, b) => (b.completedAt || b.syncRunId).localeCompare(a.completedAt || a.syncRunId))
      .slice(0, limit);

    res.json({
      success: true,
      runs,
      count: runs.length,
    });
  })
);

/**
 * GET /api/qbo/runs/:syncRunId - Get details for a specific sync run
 * Returns all events, queue jobs, and webhook events for the run
 */
router.get(
  "/runs/:syncRunId",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.user!.companyId;
    const { syncRunId } = req.params;

    // Get sync events for this run
    const events = await db
      .select()
      .from(qboSyncEvents)
      .where(and(
        eq(qboSyncEvents.companyId, companyId),
        eq(qboSyncEvents.syncRunId, syncRunId)
      ))
      .orderBy(qboSyncEvents.createdAt);

    // Get queue jobs for this run
    const queueJobs = await db
      .select()
      .from(qboSyncQueue)
      .where(and(
        eq(qboSyncQueue.companyId, companyId),
        eq(qboSyncQueue.syncRunId, syncRunId)
      ))
      .orderBy(qboSyncQueue.createdAt);

    // Get webhook events for this run
    const webhookEvents = await db
      .select()
      .from(qboWebhookEvents)
      .where(and(
        eq(qboWebhookEvents.companyId, companyId),
        eq(qboWebhookEvents.processedRunId, syncRunId)
      ))
      .orderBy(qboWebhookEvents.receivedAt);

    // Aggregate stats
    const stats = {
      totalEvents: events.length,
      successEvents: events.filter(e => e.result === "SUCCESS").length,
      failureEvents: events.filter(e => e.result === "FAILURE").length,
      totalQueueJobs: queueJobs.length,
      successQueueJobs: queueJobs.filter(j => j.status === "SUCCESS").length,
      failedQueueJobs: queueJobs.filter(j => j.status === "FAILED").length,
      totalWebhookEvents: webhookEvents.length,
      processedWebhookEvents: webhookEvents.filter(w => w.status === "PROCESSED").length,
    };

    res.json({
      success: true,
      syncRunId,
      stats,
      events,
      queueJobs,
      webhookEvents,
    });
  })
);

// ============================================================================
// QBO ITEM SYNC ROUTES (Admin-only, explicit sync)
// ============================================================================

/**
 * GET /api/qbo/items
 * List items from QBO with optional search
 */
router.get(
  "/items",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const userId = req.user?.id;
    const query = (req.query.q as string) || undefined;
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

    const tokens = await getQboTokensForCompany(companyId);
    if (!tokens) {
      return res.status(503).json({
        success: false,
        error: "QBO integration not configured for this company",
      });
    }

    const syncRunId = generateSyncRunId();
    const itemService = createItemServiceFromTokens(tokens, companyId, userId, syncRunId);
    if (!itemService) {
      return res.status(503).json({
        success: false,
        error: "QBO integration not available",
      });
    }

    const result = await itemService.listQboItems({ query, limit, offset });
    res.json({ ...result, syncRunId });
  })
);

/**
 * GET /api/qbo/items/local
 * List local items with their QBO sync status
 */
router.get(
  "/items/local",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const userId = req.user?.id;
    const syncStatus = (req.query.syncStatus as string) || undefined;
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

    const tokens = await getQboTokensForCompany(companyId);
    if (!tokens) {
      return res.status(503).json({
        success: false,
        error: "QBO integration not configured for this company",
      });
    }

    const itemService = createItemServiceFromTokens(tokens, companyId, userId);
    if (!itemService) {
      return res.status(503).json({
        success: false,
        error: "QBO integration not available",
      });
    }

    const localItems = await itemService.getLocalItemsWithSyncStatus({ syncStatus, limit, offset });
    res.json({ success: true, items: localItems, count: localItems.length });
  })
);

/**
 * POST /api/qbo/items/link
 * Link a local item to an existing QBO item (no QBO API call)
 */
router.post(
  "/items/link",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const userId = req.user?.id;

    const linkSchema = z.object({
      itemId: z.string().min(1),
      qboItemId: z.string().min(1),
    });

    const { itemId, qboItemId } = linkSchema.parse(req.body);

    const tokens = await getQboTokensForCompany(companyId);
    if (!tokens) {
      return res.status(503).json({
        success: false,
        error: "QBO integration not configured for this company",
      });
    }

    const syncRunId = generateSyncRunId();
    const itemService = createItemServiceFromTokens(tokens, companyId, userId, syncRunId);
    if (!itemService) {
      return res.status(503).json({
        success: false,
        error: "QBO integration not available",
      });
    }

    const result = await itemService.linkLocalItemToQboItem(itemId, qboItemId);
    res.json({ ...result, syncRunId });
  })
);

/**
 * POST /api/qbo/items/create/:itemId
 * Create a QBO item from a local item
 */
router.post(
  "/items/create/:itemId",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const userId = req.user?.id;
    const { itemId } = req.params;

    const tokens = await getQboTokensForCompany(companyId);
    if (!tokens) {
      return res.status(503).json({
        success: false,
        error: "QBO integration not configured for this company",
      });
    }

    const syncRunId = generateSyncRunId();
    const itemService = createItemServiceFromTokens(tokens, companyId, userId, syncRunId);
    if (!itemService) {
      return res.status(503).json({
        success: false,
        error: "QBO integration not available",
      });
    }

    const result = await itemService.createQboItemFromLocalItem(itemId);
    res.json({ ...result, syncRunId });
  })
);

/**
 * POST /api/qbo/items/bulk-create
 * Enqueue bulk item creation (adds items to queue for processing)
 */
router.post(
  "/items/bulk-create",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const userId = req.user?.id;

    const bulkSchema = z.object({
      itemIds: z.array(z.string().min(1)).min(1).max(100),
    });

    const { itemIds } = bulkSchema.parse(req.body);

    // Verify items exist and belong to company
    const existingItems = await db
      .select({ id: items.id, qboItemId: items.qboItemId })
      .from(items)
      .where(and(
        eq(items.companyId, companyId),
        sql`${items.id} = ANY(${itemIds})`
      ));

    const existingIds = new Set(existingItems.map(i => i.id));
    const alreadySyncedIds = existingItems.filter(i => i.qboItemId).map(i => i.id);
    const missingIds = itemIds.filter(id => !existingIds.has(id));

    if (missingIds.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Items not found: ${missingIds.join(", ")}`,
      });
    }

    // Filter out already synced items
    const idsToEnqueue = itemIds.filter(id => !alreadySyncedIds.includes(id));

    if (idsToEnqueue.length === 0) {
      return res.json({
        success: true,
        message: "All items are already synced to QBO",
        enqueuedCount: 0,
        alreadySyncedCount: alreadySyncedIds.length,
      });
    }

    // Enqueue jobs for each item
    const syncRunId = generateSyncRunId();
    const jobs = await db
      .insert(qboSyncQueue)
      .values(idsToEnqueue.map(itemId => ({
        companyId,
        entityType: "ITEM" as const,
        entityId: itemId,
        action: "CREATE" as const,
        status: "QUEUED" as const,
        enqueuedBy: userId,
        syncRunId,
      })))
      .returning({ id: qboSyncQueue.id, entityId: qboSyncQueue.entityId });

    res.json({
      success: true,
      enqueuedCount: jobs.length,
      alreadySyncedCount: alreadySyncedIds.length,
      syncRunId,
      jobs,
    });
  })
);

export default router;
