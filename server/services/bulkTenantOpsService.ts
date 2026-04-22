/**
 * Bulk Tenant Operations Service — SaaS Admin Phase A6.1.
 *
 * 2026-04-22: server-side orchestrator for multi-tenant operator actions.
 * Thin batcher over the canonical writers — every action for every tenant
 * goes through the exact same service call a single-tenant write would use.
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
 * Per tenant the operation runs under a try/catch so one failing tenant
 * never takes down the rest of the batch. Every success writes a canonical
 * `platformAuditService.log` entry with `action = bulk_<op>` and the
 * target tenant id so the per-tenant audit trail stays intact and
 * surfaces on the Phase A1 tenant timeline unchanged.
 *
 * Architecture rules:
 *   - No new writers. Every mutation delegates to a canonical writer.
 *   - No new tables.
 *   - Fail-soft per tenant; return a discriminated result per row.
 *   - Validation (plan exists, feature exists) runs ONCE before the loop.
 */

import type { Request } from "express";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { companies } from "@shared/schema";
import { subscriptionLifecycleService } from "./subscriptionLifecycleService";
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

export interface BulkItemResult {
  tenantId: string;
  status: "ok" | "error";
  message?: string;
  error?: string;
}

export interface BulkResult {
  action: BulkAction;
  total: number;
  succeeded: number;
  failed: number;
  results: BulkItemResult[];
}

// ============================================================================
// Internal helpers
// ============================================================================

const MS_PER_DAY = 24 * 60 * 60 * 1000;

async function writeAudit(
  action: string,
  actor: BulkActor,
  tenantId: string,
  req: Request,
  details: Record<string, unknown>,
): Promise<void> {
  await platformAuditService.log({
    platformAdminId: actor.id,
    platformAdminEmail: actor.email,
    action: action as any,
    targetCompanyId: tenantId,
    req,
    details,
  });
}

async function errorResult(tenantId: string, err: unknown): Promise<BulkItemResult> {
  const msg = err instanceof Error ? err.message : "Unknown error";
  return { tenantId, status: "error", error: msg };
}

// ============================================================================
// Individual actions
// ============================================================================

async function doExtendTrial(
  req: BulkRequest & { action: "extend_trial" },
): Promise<BulkItemResult[]> {
  const { tenantIds, params, actor } = req;
  const now = new Date();
  const results: BulkItemResult[] = [];

  for (const tenantId of tenantIds) {
    try {
      const billing = await billingRepository.getBilling(tenantId);
      if (!billing) {
        results.push({ tenantId, status: "error", error: "Tenant not found" });
        continue;
      }
      // Base = current trialEndsAt if in the future, else now.
      const base =
        billing.trialEndsAt && billing.trialEndsAt.getTime() > now.getTime()
          ? billing.trialEndsAt
          : now;
      const newEnd = new Date(base.getTime() + params.extendDays * MS_PER_DAY);

      const result = await subscriptionLifecycleService.transition({
        companyId: tenantId,
        to: billing.subscriptionStatus as any,
        trialEndsAt: newEnd,
        source: "bulk_extend_trial",
        actorUserId: actor.id,
        reason: `Bulk trial extension +${params.extendDays}d`,
      });

      await writeAudit("bulk_extend_trial", actor, tenantId, req.req, {
        extendDays: params.extendDays,
        previousTrialEndsAt: billing.trialEndsAt?.toISOString() ?? null,
        newTrialEndsAt: newEnd.toISOString(),
        lifecycleEventId: result.eventId,
      });

      results.push({
        tenantId,
        status: "ok",
        message: `Trial extended to ${newEnd.toISOString().slice(0, 10)}`,
      });
    } catch (err) {
      results.push(await errorResult(tenantId, err));
    }
  }

  return results;
}

async function doAssignPlan(
  req: BulkRequest & { action: "assign_plan" },
): Promise<BulkItemResult[]> {
  const { tenantIds, params, actor } = req;
  const results: BulkItemResult[] = [];

  // One plan-name validation up front — same guard as the single-tenant path.
  const plan = await entitlementStorage.getPlanByName(params.planName);
  if (!plan) {
    throw createError(400, `Unknown subscription plan: '${params.planName}'`);
  }

  for (const tenantId of tenantIds) {
    try {
      const before = await billingRepository.getBilling(tenantId);
      if (!before) {
        results.push({ tenantId, status: "error", error: "Tenant not found" });
        continue;
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

      await writeAudit("bulk_assign_plan", actor, tenantId, req.req, {
        previousPlan: before.subscriptionPlan,
        newPlan: params.planName,
      });

      results.push({
        tenantId,
        status: "ok",
        message: `Assigned to ${params.planName}, status → active`,
      });
    } catch (err) {
      results.push(await errorResult(tenantId, err));
    }
  }

  return results;
}

async function doStatusTransition(
  req:
    | (BulkRequest & { action: "pause_subscription" })
    | (BulkRequest & { action: "reactivate_subscription" }),
): Promise<BulkItemResult[]> {
  const { tenantIds, params, actor } = req;
  const target: "paused" | "active" =
    req.action === "pause_subscription" ? "paused" : "active";
  const source =
    req.action === "pause_subscription" ? "bulk_pause" : "bulk_reactivate";
  const results: BulkItemResult[] = [];

  for (const tenantId of tenantIds) {
    try {
      const result = await subscriptionLifecycleService.transition({
        companyId: tenantId,
        to: target,
        source,
        actorUserId: actor.id,
        reason: params.reason ?? `Bulk ${target}`,
      });

      await writeAudit(source, actor, tenantId, req.req, {
        to: target,
        from: result.from,
        lifecycleEventId: result.eventId,
        reason: params.reason ?? null,
      });

      results.push({
        tenantId,
        status: "ok",
        message: `Status → ${target}${result.from ? ` (from ${result.from})` : ""}`,
      });
    } catch (err) {
      results.push(await errorResult(tenantId, err));
    }
  }

  return results;
}

async function doAddOverride(
  req: BulkRequest & { action: "add_override" },
): Promise<BulkItemResult[]> {
  const { tenantIds, params, actor } = req;
  const results: BulkItemResult[] = [];

  const feature = await entitlementStorage.getFeatureByKey(params.featureKey);
  if (!feature) {
    throw createError(400, `Unknown feature key: '${params.featureKey}'`);
  }
  // Guardrail parity with the single-tenant route: cannot disable core features.
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

  for (const tenantId of tenantIds) {
    try {
      // Confirm tenant exists before writing the override (FK would catch it
      // too, but a clean error is nicer).
      const [tenantRow] = await db
        .select({ id: companies.id })
        .from(companies)
        .where(eq(companies.id, tenantId))
        .limit(1);
      if (!tenantRow) {
        results.push({ tenantId, status: "error", error: "Tenant not found" });
        continue;
      }

      const patch: {
        enabled?: boolean | null;
        limitValue?: number | null;
        reason?: string | null;
      } = {
        reason: params.reason ?? null,
      };
      if (params.enabled !== undefined) patch.enabled = params.enabled;
      if (params.limitProvided) patch.limitValue = params.limitValue ?? null;

      await entitlementStorage.upsertOverride(tenantId, feature.id, patch as any);
      entitlementService.invalidateEntitlementsCache(tenantId);

      await writeAudit("bulk_override_upsert", actor, tenantId, req.req, {
        featureKey: params.featureKey,
        featureId: feature.id,
        enabled: params.enabled ?? null,
        limitValue: params.limitProvided ? (params.limitValue ?? null) : undefined,
        reason: params.reason ?? null,
      });

      results.push({
        tenantId,
        status: "ok",
        message: `Override set on ${params.featureKey}`,
      });
    } catch (err) {
      results.push(await errorResult(tenantId, err));
    }
  }

  return results;
}

async function doRemoveOverride(
  req: BulkRequest & { action: "remove_override" },
): Promise<BulkItemResult[]> {
  const { tenantIds, params, actor } = req;
  const results: BulkItemResult[] = [];

  const feature = await entitlementStorage.getFeatureByKey(params.featureKey);
  if (!feature) {
    throw createError(400, `Unknown feature key: '${params.featureKey}'`);
  }

  for (const tenantId of tenantIds) {
    try {
      const removed = await entitlementStorage.deleteOverride(tenantId, feature.id);
      entitlementService.invalidateEntitlementsCache(tenantId);

      await writeAudit("bulk_override_remove", actor, tenantId, req.req, {
        featureKey: params.featureKey,
        featureId: feature.id,
        removed: removed !== null,
      });

      results.push({
        tenantId,
        status: "ok",
        message: removed
          ? `Override removed on ${params.featureKey}`
          : `No override present on ${params.featureKey}`,
      });
    } catch (err) {
      results.push(await errorResult(tenantId, err));
    }
  }

  return results;
}

// ============================================================================
// Public: run
// ============================================================================

export async function run(req: BulkRequest): Promise<BulkResult> {
  if (!Array.isArray(req.tenantIds) || req.tenantIds.length === 0) {
    throw createError(400, "tenantIds required");
  }

  let results: BulkItemResult[];
  switch (req.action) {
    case "extend_trial":
      results = await doExtendTrial(req);
      break;
    case "assign_plan":
      results = await doAssignPlan(req);
      break;
    case "pause_subscription":
    case "reactivate_subscription":
      results = await doStatusTransition(req);
      break;
    case "add_override":
      results = await doAddOverride(req);
      break;
    case "remove_override":
      results = await doRemoveOverride(req);
      break;
  }

  const succeeded = results.filter((r) => r.status === "ok").length;
  const failed = results.length - succeeded;

  return {
    action: req.action,
    total: results.length,
    succeeded,
    failed,
    results,
  };
}

export const bulkTenantOpsService = { run };
