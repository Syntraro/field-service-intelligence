/**
 * Trial Expire Worker — Phase 1 canonical policy architecture.
 *
 * 2026-04-21: Daily scan. For every company whose `trialEndsAt` has passed
 * AND whose `subscriptionStatus` is still `"trial"`, emits a one-shot
 * `trial_expired` audit event on `subscription_events`.
 *
 * Does NOT change `companies.subscriptionStatus`. Trial expiration stays
 * compute-on-read at the entitlement gate (`computeEntitlement` in
 * `storage/subscriptions.ts`). This worker exists so support/ops has an
 * explicit audit trail of when each tenant crossed the threshold, and so
 * Phase 2 can hang notification side effects off a known event.
 *
 * Idempotency: `subscriptionLifecycleService.emitTrialExpiredEvent()` uses
 * the existing `subscription_events` idempotency index; re-running the
 * worker is safe.
 *
 * Tenants without a `tenant_subscriptions` row silently no-op (the Phase 1
 * audit model requires one for the FK). Phase 2 introduces a companyId-
 * keyed audit path.
 */

import { db } from "../db";
import { and, eq, isNotNull, lt } from "drizzle-orm";
import { companies } from "@shared/schema";
import { subscriptionLifecycleService } from "./subscriptionLifecycleService";

const STARTUP_DELAY_MS = 45 * 1000; // Offset from subscriptionWorker (30s) so they don't collide.
const INTERVAL_MS = 24 * 60 * 60 * 1000; // Daily.

let startupTimeout: NodeJS.Timeout | null = null;
let intervalHandle: NodeJS.Timeout | null = null;

export interface TrialExpireWorkerResult {
  scanned: number;
  emitted: number;
  alreadyEmitted: number;
  noSubscriptionRow: number;
  errors: number;
}

/** One pass over the company table. Exported for manual triggers + tests. */
export async function runTrialExpireWorker(): Promise<TrialExpireWorkerResult> {
  const started = Date.now();
  const now = new Date();

  const rows = await db
    .select({
      id: companies.id,
      trialEndsAt: companies.trialEndsAt,
    })
    .from(companies)
    .where(
      and(
        eq(companies.subscriptionStatus, "trial"),
        isNotNull(companies.trialEndsAt),
        lt(companies.trialEndsAt, now),
      ),
    );

  const result: TrialExpireWorkerResult = {
    scanned: rows.length,
    emitted: 0,
    alreadyEmitted: 0,
    noSubscriptionRow: 0,
    errors: 0,
  };

  for (const row of rows) {
    if (!row.trialEndsAt) continue;
    try {
      const r = await subscriptionLifecycleService.emitTrialExpiredEvent({
        companyId: row.id,
        trialEndsAt: row.trialEndsAt,
      });
      if (r.alreadyEmitted) result.alreadyEmitted++;
      else if (r.eventId) result.emitted++;
      else result.noSubscriptionRow++;
    } catch (err) {
      console.error(`[TrialExpireWorker] Failed for company ${row.id}:`, err);
      result.errors++;
    }
  }

  console.log(
    `[TrialExpireWorker] Completed in ${Date.now() - started}ms: ` +
    `scanned=${result.scanned} emitted=${result.emitted} ` +
    `alreadyEmitted=${result.alreadyEmitted} noSub=${result.noSubscriptionRow} ` +
    `errors=${result.errors}`,
  );
  return result;
}

/** Start the daily scheduler. Safe to call once at bootstrap. */
export function startTrialExpireWorker(): void {
  console.log(
    `[TrialExpireWorker] Scheduler active: startup in ${STARTUP_DELAY_MS / 1000}s, ` +
    `interval every ${INTERVAL_MS / 3600000}h`,
  );
  startupTimeout = setTimeout(() => {
    runTrialExpireWorker().catch((err) =>
      console.error("[TrialExpireWorker] Startup run failed:", err),
    );
  }, STARTUP_DELAY_MS);
  startupTimeout.unref();

  intervalHandle = setInterval(() => {
    runTrialExpireWorker().catch((err) =>
      console.error("[TrialExpireWorker] Scheduled run failed:", err),
    );
  }, INTERVAL_MS);
  intervalHandle.unref();
}

export function stopTrialExpireWorker(): void {
  if (startupTimeout) {
    clearTimeout(startupTimeout);
    startupTimeout = null;
  }
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
