/**
 * QboQueueProcessor - Admin-triggered queue processor for QBO sync operations
 *
 * Handles:
 * - Processing queued sync jobs
 * - Retry logic with exponential backoff
 * - Distinction between transient and validation failures
 *
 * RULES:
 * - No auto-processing: processQueue() must be explicitly called
 * - No cron jobs or background automation
 * - Admin-only access via routes
 * - Enforces companyId isolation
 */

import { db } from "../../db";
import { qboSyncQueue } from "@shared/schema";
import { eq, and, or, lte, sql } from "drizzle-orm";
import type { QboSyncQueue, QboQueueEntityType, QboQueueAction } from "@shared/schema";
import { QboSyncOrchestrator, createSyncOrchestrator } from "./QboSyncOrchestrator";
import { QboReconciliationService, createReconciliationService } from "./QboReconciliationService";
import { QboItemService } from "./QboItemService";
import { QboClient } from "./QboClient";
import type { QboTokens } from "./QboClient";

// ============================================================
// TYPES
// ============================================================

export interface QueueJobResult {
  jobId: string;
  entityType: string;
  entityId: string;
  action: string;
  success: boolean;
  qboEntityId?: string;
  error?: string;
  errorCode?: string;
  errorCategory?: "auth" | "rate_limit" | "validation" | "mapping" | "conflict" | "server" | "network" | "unknown";
  willRetry: boolean;
  attempts: number;
  maxAttempts: number;
  nextRetryAt?: string; // ISO timestamp if willRetry
}

export interface ProcessQueueResult {
  processed: number;
  succeeded: number;
  failed: number;
  willRetry: number;
  jobs: QueueJobResult[];
}

export interface EnqueueResult {
  success: boolean;
  jobId?: string;
  error?: string;
}

// Errors that indicate validation/preflight failures - no point retrying
const VALIDATION_ERROR_PATTERNS = [
  /Invoice sync blocked/i,
  /Draft invoices cannot/i,
  /not found/i,
  /No QBO Customer ID/i,
  /must be synced/i,
  /required for QBO sync/i,
  /Inactive.*cannot be synced/i,
  /Deleted.*cannot be synced/i,
];

function isValidationError(error: string): boolean {
  return VALIDATION_ERROR_PATTERNS.some(pattern => pattern.test(error));
}

// ============================================================
// SERVICE CLASS
// ============================================================

export class QboQueueProcessor {
  private companyId: string;
  private tokens: QboTokens;
  private triggeredBy: string | undefined;
  private syncRunId: string | undefined;

  constructor(companyId: string, tokens: QboTokens, triggeredBy?: string, syncRunId?: string) {
    this.companyId = companyId;
    this.tokens = tokens;
    this.triggeredBy = triggeredBy;
    this.syncRunId = syncRunId;
  }

  /**
   * Enqueue a new sync job
   */
  async enqueue(
    entityType: QboQueueEntityType,
    entityId: string,
    action: QboQueueAction,
    maxAttempts: number = 3
  ): Promise<EnqueueResult> {
    try {
      // Check for existing queued/running job for same entity+action
      const [existing] = await db
        .select()
        .from(qboSyncQueue)
        .where(
          and(
            eq(qboSyncQueue.companyId, this.companyId),
            eq(qboSyncQueue.entityType, entityType),
            eq(qboSyncQueue.entityId, entityId),
            eq(qboSyncQueue.action, action),
            or(
              eq(qboSyncQueue.status, "QUEUED"),
              eq(qboSyncQueue.status, "RUNNING")
            )
          )
        )
        .limit(1);

      if (existing) {
        return {
          success: false,
          error: `Job already queued or running for ${entityType}:${entityId} (${action})`,
          jobId: existing.id,
        };
      }

      const [job] = await db
        .insert(qboSyncQueue)
        .values({
          companyId: this.companyId,
          entityType,
          entityId,
          action,
          status: "QUEUED",
          attempts: 0,
          maxAttempts,
          nextRunAt: new Date(),
          enqueuedBy: this.triggeredBy,
          syncRunId: this.syncRunId,
        })
        .returning();

      return { success: true, jobId: job.id };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Process eligible jobs in the queue
   * Picks jobs where: nextRunAt <= now AND (status = QUEUED OR (status = FAILED AND attempts < maxAttempts))
   */
  async processQueue(limit: number = 20): Promise<ProcessQueueResult> {
    const now = new Date();
    const results: QueueJobResult[] = [];

    // Find eligible jobs
    const eligibleJobs = await db
      .select()
      .from(qboSyncQueue)
      .where(
        and(
          eq(qboSyncQueue.companyId, this.companyId),
          lte(qboSyncQueue.nextRunAt, now),
          or(
            eq(qboSyncQueue.status, "QUEUED"),
            and(
              eq(qboSyncQueue.status, "FAILED"),
              sql`${qboSyncQueue.attempts} < ${qboSyncQueue.maxAttempts}`
            )
          )
        )
      )
      .orderBy(qboSyncQueue.nextRunAt)
      .limit(limit);

    for (const job of eligibleJobs) {
      const result = await this.processJob(job);
      results.push(result);
    }

    return {
      processed: results.length,
      succeeded: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      willRetry: results.filter(r => r.willRetry).length,
      jobs: results,
    };
  }

  /**
   * Replay a specific failed job
   */
  async replayJob(jobId: string): Promise<QueueJobResult | null> {
    const [job] = await db
      .select()
      .from(qboSyncQueue)
      .where(
        and(
          eq(qboSyncQueue.id, jobId),
          eq(qboSyncQueue.companyId, this.companyId)
        )
      )
      .limit(1);

    if (!job) {
      return null;
    }

    // Reset job to QUEUED for replay
    await db
      .update(qboSyncQueue)
      .set({
        status: "QUEUED",
        nextRunAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(qboSyncQueue.id, jobId));

    // Refetch and process
    const [updatedJob] = await db
      .select()
      .from(qboSyncQueue)
      .where(eq(qboSyncQueue.id, jobId))
      .limit(1);

    return this.processJob(updatedJob);
  }

  /**
   * Process a single job
   */
  private async processJob(job: QboSyncQueue): Promise<QueueJobResult> {
    const startAttempts = job.attempts;

    // Mark as RUNNING
    await db
      .update(qboSyncQueue)
      .set({
        status: "RUNNING",
        attempts: job.attempts + 1,
        updatedAt: new Date(),
      })
      .where(eq(qboSyncQueue.id, job.id));

    try {
      const result = await this.executeJob(job);

      if (result.success) {
        // SUCCESS - mark completed
        await db
          .update(qboSyncQueue)
          .set({
            status: "SUCCESS",
            qboEntityId: result.qboEntityId,
            lastError: null,
            lastErrorCode: null,
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(qboSyncQueue.id, job.id));

        return {
          jobId: job.id,
          entityType: job.entityType,
          entityId: job.entityId,
          action: job.action,
          success: true,
          qboEntityId: result.qboEntityId,
          willRetry: false,
          attempts: startAttempts + 1,
          maxAttempts: job.maxAttempts,
        };
      } else {
        // FAILED - determine if retryable using structured error info
        const error = result.error || "Unknown error";
        const isValidation = isValidationError(error);
        // Use structured retryable flag if available, fall back to validation check
        const isRetryable = result.retryable !== undefined ? result.retryable : !isValidation;
        const currentAttempts = startAttempts + 1;
        const canRetry = isRetryable && currentAttempts < job.maxAttempts;

        // Calculate next run time - use Retry-After if provided (rate limits), else exponential backoff
        let backoffSeconds: number;
        if (result.retryAfterSeconds && result.retryAfterSeconds > 0) {
          // Use server-provided Retry-After (rate limiting)
          backoffSeconds = result.retryAfterSeconds;
        } else {
          // Exponential backoff: 1min, 4min, 9min, etc.
          const backoffMinutes = Math.pow(currentAttempts, 2);
          backoffSeconds = backoffMinutes * 60;
        }
        const nextRunAt = new Date(Date.now() + backoffSeconds * 1000);

        await db
          .update(qboSyncQueue)
          .set({
            status: "FAILED",
            lastError: error,
            lastErrorCode: result.errorCode,
            nextRunAt: canRetry ? nextRunAt : job.nextRunAt,
            // If not retryable, set attempts to max to prevent retries
            attempts: !isRetryable ? job.maxAttempts : currentAttempts,
            updatedAt: new Date(),
          })
          .where(eq(qboSyncQueue.id, job.id));

        return {
          jobId: job.id,
          entityType: job.entityType,
          entityId: job.entityId,
          action: job.action,
          success: false,
          error,
          errorCode: result.errorCode,
          errorCategory: result.errorCategory,
          willRetry: canRetry,
          attempts: !isRetryable ? job.maxAttempts : currentAttempts,
          maxAttempts: job.maxAttempts,
          nextRetryAt: canRetry ? nextRunAt.toISOString() : undefined,
        };
      }
    } catch (err) {
      // Unexpected error - treat as transient (retryable)
      const error = err instanceof Error ? err.message : String(err);
      const currentAttempts = startAttempts + 1;
      const canRetry = currentAttempts < job.maxAttempts;

      const backoffMinutes = Math.pow(currentAttempts, 2);
      const nextRunAt = new Date(Date.now() + backoffMinutes * 60 * 1000);

      await db
        .update(qboSyncQueue)
        .set({
          status: "FAILED",
          lastError: error,
          nextRunAt: canRetry ? nextRunAt : job.nextRunAt,
          updatedAt: new Date(),
        })
        .where(eq(qboSyncQueue.id, job.id));

      return {
        jobId: job.id,
        entityType: job.entityType,
        entityId: job.entityId,
        action: job.action,
        success: false,
        error,
        errorCategory: "unknown" as const,
        willRetry: canRetry,
        attempts: currentAttempts,
        maxAttempts: job.maxAttempts,
        nextRetryAt: canRetry ? nextRunAt.toISOString() : undefined,
      };
    }
  }

  /**
   * Execute the actual sync/reconcile operation
   */
  private async executeJob(job: QboSyncQueue): Promise<{
    success: boolean;
    qboEntityId?: string;
    error?: string;
    errorCode?: string;
    errorCategory?: "auth" | "rate_limit" | "validation" | "mapping" | "conflict" | "server" | "network" | "unknown";
    retryAfterSeconds?: number;
    retryable?: boolean;
  }> {
    const { entityType, entityId, action } = job;

    // Handle reconciliation actions
    if (action === "RECONCILE" || action === "RECONCILE_APPLY") {
      if (entityType !== "INVOICE") {
        return { success: false, error: "Reconciliation only supported for invoices" };
      }

      const client = this.createQboClient();
      if (!client) {
        return { success: false, error: "QBO client not configured" };
      }

      const reconciliationService = createReconciliationService(client, this.companyId, this.triggeredBy);

      if (action === "RECONCILE") {
        const result = await reconciliationService.reconcileDryRun(entityId);
        if (result.success) {
          return { success: true, qboEntityId: result.data?.qboInvoiceId };
        }
        return { success: false, error: result.error || result.skipReason };
      } else {
        const result = await reconciliationService.reconcileApply(entityId);
        if (result.success) {
          return { success: true };
        }
        return { success: false, error: result.errors?.join("; ") || result.skipReason };
      }
    }

    // Handle sync actions via orchestrator
    const orchestrator = createSyncOrchestrator(this.tokens, this.companyId, this.triggeredBy, this.syncRunId);
    if (!orchestrator) {
      return { success: false, error: "QBO sync not configured" };
    }

    switch (entityType) {
      case "CUSTOMER_COMPANY": {
        const result = await orchestrator.syncCustomerCompany(entityId);
        if (result.success) {
          return { success: true, qboEntityId: result.qboId };
        }
        return { success: false, error: result.error || result.skipReason };
      }

      case "CLIENT_LOCATION": {
        const result = await orchestrator.syncClientLocation(entityId);
        if (result.success) {
          return { success: true, qboEntityId: result.qboId };
        }
        return { success: false, error: result.error || result.skipReason };
      }

      case "INVOICE": {
        if (action === "SYNC_WITH_DEPS") {
          const result = await orchestrator.syncInvoiceWithDependencies(entityId);
          if (result.overallSuccess) {
            return { success: true, qboEntityId: result.invoice?.qboId };
          }
          return { success: false, error: result.errors.join("; ") || result.invoice?.error };
        } else {
          const result = await orchestrator.syncInvoice(entityId);
          if (result.success) {
            return { success: true, qboEntityId: result.qboId };
          }
          return { success: false, error: result.error || result.skipReason };
        }
      }

      case "ITEM": {
        // Create QBO item from local item
        const client = this.createQboClient();
        if (!client) {
          return { success: false, error: "QBO client not configured" };
        }
        const itemService = new QboItemService(client, this.companyId, this.triggeredBy, this.syncRunId);
        const result = await itemService.createQboItemFromLocalItem(entityId);
        if (result.success) {
          return { success: true, qboEntityId: result.qboItemId };
        }
        return { success: false, error: result.error };
      }

      default:
        return { success: false, error: `Unknown entity type: ${entityType}` };
    }
  }

  /**
   * Create QBO client from tokens
   */
  private createQboClient(): QboClient | null {
    const clientId = process.env.QBO_CLIENT_ID;
    const clientSecret = process.env.QBO_CLIENT_SECRET;
    const environment = (process.env.QBO_ENVIRONMENT as "sandbox" | "production") || "sandbox";

    if (!clientId || !clientSecret) {
      return null;
    }

    return new QboClient({ clientId, clientSecret, environment }, this.tokens);
  }
}

// ============================================================
// FACTORY FUNCTION
// ============================================================

export function createQueueProcessor(
  companyId: string,
  tokens: QboTokens,
  triggeredBy?: string,
  syncRunId?: string
): QboQueueProcessor {
  return new QboQueueProcessor(companyId, tokens, triggeredBy, syncRunId);
}

// ============================================================
// QUEUE QUERY HELPERS
// ============================================================

export async function getQueueJobs(
  companyId: string,
  options: {
    status?: string;
    limit?: number;
  } = {}
): Promise<QboSyncQueue[]> {
  const { status, limit = 50 } = options;

  const conditions = [eq(qboSyncQueue.companyId, companyId)];
  if (status) {
    conditions.push(eq(qboSyncQueue.status, status));
  }

  return db
    .select()
    .from(qboSyncQueue)
    .where(and(...conditions))
    .orderBy(sql`${qboSyncQueue.createdAt} DESC`)
    .limit(limit);
}

export async function getQueueStats(companyId: string): Promise<{
  queued: number;
  running: number;
  failed: number;
  succeeded: number;
  retriable: number;
}> {
  const jobs = await db
    .select({
      status: qboSyncQueue.status,
      attempts: qboSyncQueue.attempts,
      maxAttempts: qboSyncQueue.maxAttempts,
    })
    .from(qboSyncQueue)
    .where(eq(qboSyncQueue.companyId, companyId));

  return {
    queued: jobs.filter(j => j.status === "QUEUED").length,
    running: jobs.filter(j => j.status === "RUNNING").length,
    failed: jobs.filter(j => j.status === "FAILED").length,
    succeeded: jobs.filter(j => j.status === "SUCCESS").length,
    retriable: jobs.filter(j => j.status === "FAILED" && j.attempts < j.maxAttempts).length,
  };
}
