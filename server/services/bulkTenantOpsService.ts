/**
 * Bulk Tenant Operations Service — SaaS Admin Phase A6.1 / A6.2.
 *
 * 2026-04-22 A6.1: server-side orchestrator for multi-tenant operator
 * actions. Thin batcher over the canonical writers — every action for
 * every tenant goes through the exact same service call a single-tenant
 * write would use. Per-tenant success/failure surfaces so partial
 * failures are never hidden.
 *
 * 2026-04-22 A6.2 upgrades:
 *   - Dry-run mode: preflight checks + predicate evaluation only, zero
 *     writes, zero audit rows. Returns `would_ok` / `would_error` per
 *     tenant so operators can preview blast radius before committing.
 *   - Bounded concurrency: per-tenant operations run in a worker pool
 *     (CONCURRENCY = 10). Serial loops on ≤50 tenants are effectively
 *     free; 200-tenant batches finish in ~1/10th the wall time.
 *
 *   Extend trial             → subscriptionLifecycleService.transition
 *                               ({ to: currentStatus, trialEndsAt })
 *   Assign plan              → billingRepository.updateBilling({ subscriptionPlan })
 *                               + subscriptionLifecycleService.transition
 *                               ({ to: "active" })
 *   Pause subscription       → subscriptionLifecycleService.transition
 *                               ({ to: "paused" })
 *   Reactivate subscription  → subscriptionLifecycleService.transition
 *                               ({ to: "active" })
 *   Add entitlement override → entitlementStorage.upsertOverride
 *                               (+ invalidate resolver cache)
 *   Remove entitlement override → entitlementStorage.deleteOverride
 *                                   (+ invalidate resolver cache)
 *
 * Architecture rules:
 *   - No new writers. Every mutation delegates to a canonical writer.
 *   - No new tables.
 *   - Dry-run uses canonical read helpers + the exported
 *     `isValidTransition` predicate from the lifecycle service so
 *     preview results cannot drift from live execution.
 *   - Fail-soft per tenant — one failure never poisons the batch.
 *   - Validation (plan exists, feature exists) runs ONCE before the
 *     per-tenant loop.
 */

import type { Request } from "express";
import { randomUUID } from "crypto";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { companies } from "@shared/schema";
import {
  subscriptionLifecycleService,
  type SubscriptionState,
} from "./subscriptionLifecycleService";
import { billingRepository } from "../storage/billing";
import { entitlementStorage } from "../storage/entitlements";
import { entitlementService } from "./entitlementService";
import { platformAuditService } from "./platformAuditService";
import { createError } from "../middleware/errorHandler";

// ============================================================================
// Public types
// ============================================================================

export type BulkAction =
  | "extend_trial"
  | "assign_plan"
  | "pause_subscription"
  | "reactivate_subscription"
  | "add_override"
  | "remove_override";

export interface BulkActor {
  id: string;
  email: string;
}

export interface BulkRequestBase {
  action: BulkAction;
  tenantIds: string[];
  actor: BulkActor;
  req: Request;
  /** A6.2: when true, perform preflight predicate checks only; no writes. */
  dryRun?: boolean;
}

export interface BulkExtendTrialParams { extendDays: 7 | 14 }
export interface BulkAssignPlanParams { planName: string }
export interface BulkPauseParams { reason?: string | null }
export interface BulkReactivateParams { reason?: string | null }
export interface BulkAddOverrideParams {
  featureKey: string;
  enabled?: boolean | null;
  limitValue?: number | null;
  /**
   * Whether the request is passing `limitValue` explicitly. Matches the
   * single-tenant upsert contract — an explicit `null` means "unlimited",
   * an absent key means "inherit from plan".
   */
  limitProvided: boolean;
  reason?: string | null;
}
export interface BulkRemoveOverrideParams { featureKey: string }

export type BulkRequest =
  | (BulkRequestBase & { action: "extend_trial"; params: BulkExtendTrialParams })
  | (BulkRequestBase & { action: "assign_plan"; params: BulkAssignPlanParams })
  | (BulkRequestBase & { action: "pause_subscription"; params: BulkPauseParams })
  | (BulkRequestBase & { action: "reactivate_subscription"; params: BulkReactivateParams })
  | (BulkRequestBase & { action: "add_override"; params: BulkAddOverrideParams })
  | (BulkRequestBase & { action: "remove_override"; params: BulkRemoveOverrideParams });

/**
 * A6.2: results can now take two shapes depending on execution mode.
 *   - Live:    status ∈ { "ok", "error" }        (with message / error)
 *   - Dry-run: status ∈ { "would_ok", "would_error" } (with reason)
 *
 * Discriminate on status in the UI; the live-vs-preview split is mirrored
 * at the bulk-result level by `dryRun: boolean`.
 */
export type BulkItemStatus = "ok" | "error" | "would_ok" | "would_error";

export interface BulkItemResult {
  tenantId: string;
  status: BulkItemStatus;
  /** Present for `ok` (success detail) and `would_ok` (expected outcome). */
  message?: string;
  /** Present for `error` (live failure) and `would_error` (preview reason). */
  error?: string;
}

export interface BulkResult {
  action: BulkAction;
  dryRun: boolean;
  /**
   * A6.3 traceability: a single uuid correlates every per-tenant audit row
   * from the same bulk run. Present only for LIVE runs (dry-runs don't
   * write audit rows). Used by `/platform/bulk-runs` history + retry.
   */
  runId: string | null;
  total: number;
  /** Count of ok / would_ok rows. */
  succeeded: number;
  /** Count of error / would_error rows. */
  failed: number;
  results: BulkItemResult[];
}

// ============================================================================
// Internal helpers
// ============================================================================

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const CONCURRENCY = 10;

/**
 * Bounded parallelism — N worker coroutines pull from a shared index.
 * Preserves input order in the returned array. No external deps.
 */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runnerCount = Math.min(limit, items.length);
  const runners = Array.from({ length: runnerCount }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * A6.3 traceability: every live per-tenant outcome (ok AND error) is
 * audited with a uniform envelope — runId, action, actor, status,
 * message/error, and the original params. `/platform/bulk-runs` reads
 * these rows; retry pulls `params` from them.
 *
 * Swallows audit write failures so a flaky audit infrastructure cannot
 * break the bulk run itself. The canonical writer already succeeded by
 * the time this runs.
 */
async function writeBulkAudit(args: {
  action: string;
  actor: BulkActor;
  tenantId: string;
  req: Request;
  runId: string;
  status: "ok" | "error";
  params: Record<string, unknown>;
  message?: string;
  error?: string;
  extra?: Record<string, unknown>;
}): Promise<void> {
  const { action, actor, tenantId, req, runId, status, params, message, error, extra } = args;
  try {
    await platformAuditService.log({
      platformAdminId: actor.id,
      platformAdminEmail: actor.email,
      action: action as any,
      targetCompanyId: tenantId,
      req,
      details: {
        runId,
        status,
        action,
        params,
        message: message ?? null,
        error: error ?? null,
        ...(extra ?? {}),
      },
    });
  } catch (auditErr) {
    console.error(
      `[bulkTenantOpsService] audit write failed for runId=${runId} tenant=${tenantId}:`,
      auditErr,
    );
  }
}

function wouldOk(tenantId: string, message: string): BulkItemResult {
  return { tenantId, status: "would_ok", message };
}
function wouldError(tenantId: string, reason: string): BulkItemResult {
  return { tenantId, status: "would_error", error: reason };
}
function liveError(tenantId: string, err: unknown): BulkItemResult {
  const msg = err instanceof Error ? err.message : "Unknown error";
  return { tenantId, status: "error", error: msg };
}

// ============================================================================
// Action handlers — each returns BulkItemResult per tenant.
// Each handler respects `dryRun`: preflight reads + predicate checks only,
// no writes, no audit rows.
// ============================================================================

async function handleExtendTrial(
  req: BulkRequest & { action: "extend_trial" },
): Promise<BulkItemResult[]> {
  const { tenantIds, params, actor, dryRun } = req;
  const now = new Date();

  return runWithConcurrency(tenantIds, CONCURRENCY, async (tenantId) => {
    try {
      const billing = await billingRepository.getBilling(tenantId);
      if (!billing) {
        return dryRun
          ? wouldError(tenantId, "Tenant not found")
          : { tenantId, status: "error", error: "Tenant not found" };
      }
      const base =
        billing.trialEndsAt && billing.trialEndsAt.getTime() > now.getTime()
          ? billing.trialEndsAt
          : now;
      const newEnd = new Date(base.getTime() + params.extendDays * MS_PER_DAY);

      if (dryRun) {
        return wouldOk(
          tenantId,
          `Would extend trial to ${newEnd.toISOString().slice(0, 10)}`,
        );
      }

      await subscriptionLifecycleService.transition({
        companyId: tenantId,
        to: billing.subscriptionStatus as SubscriptionState,
        trialEndsAt: newEnd,
        source: "bulk_extend_trial",
        actorUserId: actor.id,
        reason: `Bulk trial extension +${params.extendDays}d`,
      });

      return {
        tenantId,
        status: "ok",
        message: `Trial extended to ${newEnd.toISOString().slice(0, 10)}`,
      };
    } catch (err) {
      return liveError(tenantId, err);
    }
  });
}

async function handleAssignPlan(
  req: BulkRequest & { action: "assign_plan" },
): Promise<BulkItemResult[]> {
  const { tenantIds, params, actor, dryRun } = req;

  // One plan-name validation up front — same guard as single-tenant.
  // Thrown, because an unknown plan name is a request-level error regardless
  // of dryRun.
  const plan = await entitlementStorage.getPlanByName(params.planName);
  if (!plan) {
    throw createError(400, `Unknown subscription plan: '${params.planName}'`);
  }

  return runWithConcurrency(tenantIds, CONCURRENCY, async (tenantId) => {
    try {
      const before = await billingRepository.getBilling(tenantId);
      if (!before) {
        return dryRun
          ? wouldError(tenantId, "Tenant not found")
          : { tenantId, status: "error", error: "Tenant not found" };
      }

      // Lifecycle preflight: trial / active / past_due / cancelled / paused
      // → active is always legal per ALLOWED_TRANSITIONS, but defensively
      // check so the dry-run and live runs cannot drift.
      if (!subscriptionLifecycleService.isValidTransition(before.subscriptionStatus, "active")) {
        const reason = `Illegal transition ${before.subscriptionStatus} → active`;
        return dryRun
          ? wouldError(tenantId, reason)
          : { tenantId, status: "error", error: reason };
      }

      if (dryRun) {
        return wouldOk(
          tenantId,
          `Would assign ${params.planName} + activate (from ${before.subscriptionStatus})`,
        );
      }

      await billingRepository.updateBilling(tenantId, {
        subscriptionPlan: params.planName,
      });

      await subscriptionLifecycleService.transition({
        companyId: tenantId,
        to: "active",
        source: "bulk_assign_plan",
        actorUserId: actor.id,
        reason: `Bulk plan assignment → ${params.planName}`,
      });

      return {
        tenantId,
        status: "ok",
        message: `Assigned to ${params.planName}, status → active`,
      };
    } catch (err) {
      return liveError(tenantId, err);
    }
  });
}

async function handleStatusTransition(
  req:
    | (BulkRequest & { action: "pause_subscription" })
    | (BulkRequest & { action: "reactivate_subscription" }),
): Promise<BulkItemResult[]> {
  const { tenantIds, params, actor, dryRun } = req;
  const target: "paused" | "active" =
    req.action === "pause_subscription" ? "paused" : "active";
  const source =
    req.action === "pause_subscription" ? "bulk_pause" : "bulk_reactivate";

  return runWithConcurrency(tenantIds, CONCURRENCY, async (tenantId) => {
    try {
      const billing = await billingRepository.getBilling(tenantId);
      if (!billing) {
        return dryRun
          ? wouldError(tenantId, "Tenant not found")
          : { tenantId, status: "error", error: "Tenant not found" };
      }

      if (!subscriptionLifecycleService.isValidTransition(billing.subscriptionStatus, target)) {
        const reason = `Illegal transition ${billing.subscriptionStatus} → ${target}`;
        return dryRun
          ? wouldError(tenantId, reason)
          : { tenantId, status: "error", error: reason };
      }

      if (dryRun) {
        return wouldOk(
          tenantId,
          billing.subscriptionStatus === target
            ? `Already ${target} (no-op)`
            : `Would transition ${billing.subscriptionStatus} → ${target}`,
        );
      }

      const result = await subscriptionLifecycleService.transition({
        companyId: tenantId,
        to: target,
        source,
        actorUserId: actor.id,
        reason: params.reason ?? `Bulk ${target}`,
      });

      return {
        tenantId,
        status: "ok",
        message: `Status → ${target}${result.from ? ` (from ${result.from})` : ""}`,
      };
    } catch (err) {
      return liveError(tenantId, err);
    }
  });
}

async function handleAddOverride(
  req: BulkRequest & { action: "add_override" },
): Promise<BulkItemResult[]> {
  const { tenantIds, params, actor, dryRun } = req;

  const feature = await entitlementStorage.getFeatureByKey(params.featureKey);
  if (!feature) {
    throw createError(400, `Unknown feature key: '${params.featureKey}'`);
  }
  if (feature.isCore && params.enabled === false) {
    throw createError(
      400,
      `Cannot disable core feature '${params.featureKey}' via override`,
    );
  }
  if (params.enabled === undefined && !params.limitProvided) {
    throw createError(
      400,
      "Override must set at least one of `enabled` or `limitValue`",
    );
  }

  return runWithConcurrency(tenantIds, CONCURRENCY, async (tenantId) => {
    try {
      // Confirm tenant exists before writing the override (FK would catch it
      // too, but a clean error is nicer in the result set).
      const [tenantRow] = await db
        .select({ id: companies.id })
        .from(companies)
        .where(eq(companies.id, tenantId))
        .limit(1);
      if (!tenantRow) {
        return dryRun
          ? wouldError(tenantId, "Tenant not found")
          : { tenantId, status: "error", error: "Tenant not found" };
      }

      if (dryRun) {
        const parts: string[] = [];
        if (params.enabled !== undefined) parts.push(`enabled=${params.enabled}`);
        if (params.limitProvided) {
          parts.push(`limit=${params.limitValue === null ? "unlimited" : params.limitValue}`);
        }
        return wouldOk(
          tenantId,
          `Would upsert override on ${params.featureKey} (${parts.join(", ") || "no effect"})`,
        );
      }

      const patch: {
        enabled?: boolean | null;
        limitValue?: number | null;
        reason?: string | null;
      } = { reason: params.reason ?? null };
      if (params.enabled !== undefined) patch.enabled = params.enabled;
      if (params.limitProvided) patch.limitValue = params.limitValue ?? null;

      await entitlementStorage.upsertOverride(tenantId, feature.id, patch as any);
      entitlementService.invalidateEntitlementsCache(tenantId);

      return {
        tenantId,
        status: "ok",
        message: `Override set on ${params.featureKey}`,
      };
    } catch (err) {
      return liveError(tenantId, err);
    }
  });
}

async function handleRemoveOverride(
  req: BulkRequest & { action: "remove_override" },
): Promise<BulkItemResult[]> {
  const { tenantIds, params, actor, dryRun } = req;

  const feature = await entitlementStorage.getFeatureByKey(params.featureKey);
  if (!feature) {
    throw createError(400, `Unknown feature key: '${params.featureKey}'`);
  }

  return runWithConcurrency(tenantIds, CONCURRENCY, async (tenantId) => {
    try {
      if (dryRun) {
        // Preview: look up whether an override currently exists so the
        // operator can see which tenants are no-ops.
        const overrides = await entitlementStorage.listOverrides(tenantId);
        const hasOverride = overrides.some((o) => o.featureId === feature.id);
        return wouldOk(
          tenantId,
          hasOverride
            ? `Would remove override on ${params.featureKey}`
            : `No override present on ${params.featureKey} (no-op)`,
        );
      }

      const removed = await entitlementStorage.deleteOverride(tenantId, feature.id);
      entitlementService.invalidateEntitlementsCache(tenantId);

      return {
        tenantId,
        status: "ok",
        message: removed
          ? `Override removed on ${params.featureKey}`
          : `No override present on ${params.featureKey}`,
      };
    } catch (err) {
      return liveError(tenantId, err);
    }
  });
}

// ============================================================================
// Audit-action mapping — each bulk action maps to a stable audit `action`
// string so `/platform/bulk-runs` reads can distinguish action type from
// the audit_logs.action column without parsing the JSON details.
// ============================================================================

const AUDIT_ACTION: Record<BulkAction, string> = {
  extend_trial: "bulk_extend_trial",
  assign_plan: "bulk_assign_plan",
  pause_subscription: "bulk_pause",
  reactivate_subscription: "bulk_reactivate",
  add_override: "bulk_override_upsert",
  remove_override: "bulk_override_remove",
};

// ============================================================================
// Public: run
// ============================================================================

export async function run(req: BulkRequest): Promise<BulkResult> {
  if (!Array.isArray(req.tenantIds) || req.tenantIds.length === 0) {
    throw createError(400, "tenantIds required");
  }

  const dryRun = !!req.dryRun;
  // A6.3 traceability: every LIVE bulk execution gets one runId. All
  // per-tenant audit rows share it so the history reader can group.
  const runId: string | null = dryRun ? null : randomUUID();

  let results: BulkItemResult[];
  switch (req.action) {
    case "extend_trial":
      results = await handleExtendTrial(req);
      break;
    case "assign_plan":
      results = await handleAssignPlan(req);
      break;
    case "pause_subscription":
    case "reactivate_subscription":
      results = await handleStatusTransition(req);
      break;
    case "add_override":
      results = await handleAddOverride(req);
      break;
    case "remove_override":
      results = await handleRemoveOverride(req);
      break;
  }

  // A6.3: emit one platform audit row per LIVE outcome (ok AND error).
  // Canonical details include runId + action + params + status + message/error
  // so `/platform/bulk-runs` can reconstruct history and retry from a run's
  // failed tenants alone. Dry-run never audits.
  if (!dryRun && runId) {
    const auditAction = AUDIT_ACTION[req.action];
    const paramsSnapshot = req.params as unknown as Record<string, unknown>;
    await runWithConcurrency(results, CONCURRENCY, async (r) => {
      if (r.status !== "ok" && r.status !== "error") return;
      await writeBulkAudit({
        action: auditAction,
        actor: req.actor,
        tenantId: r.tenantId,
        req: req.req,
        runId,
        status: r.status,
        params: paramsSnapshot,
        message: r.message,
        error: r.error,
      });
    });
  }
  const succeeded = results.filter(
    (r) => r.status === "ok" || r.status === "would_ok",
  ).length;
  const failed = results.length - succeeded;

  return {
    action: req.action,
    dryRun,
    runId,
    total: results.length,
    succeeded,
    failed,
    results,
  };
}

export const bulkTenantOpsService = { run };
