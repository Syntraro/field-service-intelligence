/**
 * Subscription Lifecycle Service — Phase 1 canonical subscription-state writer.
 *
 * 2026-04-21: Sole writer of `companies.subscriptionStatus` from now on.
 * Every writer (signup, admin PATCH, trial-expire worker, future Stripe
 * webhook) goes through `transition()`. Direct `db.update(companies).set({
 * subscriptionStatus })` is an architecture violation.
 *
 * Responsibilities:
 *   1. Validate the requested state transition (reject illegal moves early).
 *   2. Write the canonical state on the `companies` row.
 *   3. Append a `subscription_events` audit row.
 *   4. Invalidate the entitlement resolver cache for the affected tenant.
 *
 * Non-goals for Phase 1:
 *   - Does NOT touch `tenant_subscriptions` (billing-cycle ledger — separate
 *     concern; see subscriptionBilling.ts).
 *   - Does NOT emit dispatch SSE (feature gates read through a 60s cache; the
 *     resolver invalidate is the correct propagation path).
 *   - Does NOT fire email / webhook side effects — those land in Phase 2.
 */

import { db } from "../db";
import { eq, desc, and } from "drizzle-orm";
import { companies, tenantSubscriptions, subscriptionEvents } from "@shared/schema";
import { entitlementService } from "./entitlementService";
import { createError } from "../middleware/errorHandler";

// ============================================================================
// Canonical runtime subscription states
// ============================================================================
//
// `companies.subscriptionStatus` is a free-text column historically, but the
// runtime entitlement gate (`computeEntitlement` in storage/subscriptions.ts)
// only recognizes these values. Admin PATCH schema at `admin.ts:610` matches.
// Keep this list in sync with both.

export const SUBSCRIPTION_STATES = [
  "trial",
  "active",
  "past_due",
  "cancelled",
  "paused",
] as const;

export type SubscriptionState = typeof SUBSCRIPTION_STATES[number];

// ============================================================================
// Transition validation
// ============================================================================
//
// Allowed transitions. `*` = from any state.
// Rules are deliberately permissive so the Phase 1 migration of existing
// writers does not reject historical edge cases; tighten in Phase 2+ after
// Stripe integration lands and the states get semantic contracts.
const ALLOWED_TRANSITIONS: Record<string, readonly SubscriptionState[]> = {
  // From trial: upgrade to paid, or expire to past_due/cancelled.
  trial: ["trial", "active", "past_due", "cancelled", "paused"],
  // From active: can pause, go past_due, or cancel. Moving back to trial is
  // an admin-override edge case; allowed.
  active: ["active", "past_due", "cancelled", "paused", "trial"],
  past_due: ["past_due", "active", "cancelled", "paused"],
  cancelled: ["cancelled", "active", "trial"],
  paused: ["paused", "active", "cancelled", "trial"],
};

function isValidTransition(from: string | null | undefined, to: SubscriptionState): boolean {
  if (!from) return true; // null/undefined (new tenant) → anything
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed) return true; // unknown historical state → permissive
  return allowed.includes(to);
}

// ============================================================================
// Transition intent
// ============================================================================

export interface TransitionIntent {
  companyId: string;
  /** Target runtime state. */
  to: SubscriptionState;
  /** Optional new trialEndsAt (used on trial creation/extension). */
  trialEndsAt?: Date | null;
  /** Human-readable reason; stored on the audit event. */
  reason?: string;
  /** Actor performing the transition — user id where known. */
  actorUserId?: string;
  /** Context source — "signup" | "admin_patch" | "worker_trial_expire" | "stripe_webhook" | etc. */
  source: string;
  /** Free-form metadata stashed on the audit row. */
  metadata?: Record<string, unknown>;
}

export interface TransitionResult {
  companyId: string;
  from: string | null;
  to: SubscriptionState;
  trialEndsAt: Date | null;
  eventId: string | null;
}

// ============================================================================
// transition()
// ============================================================================

/**
 * Apply a subscription-state transition. Validates, writes, audits, invalidates.
 *
 * Idempotency: if `to === from` AND `trialEndsAt` is unchanged, the call is a
 * no-op (no row write, no event row) — safe to call defensively.
 *
 * Callers must not write `companies.subscriptionStatus` directly. The
 * architecture rule is enforced by code review + the dedicated audit event.
 */
export async function transition(intent: TransitionIntent): Promise<TransitionResult> {
  const { companyId, to, trialEndsAt, reason, actorUserId, source, metadata } = intent;

  // Load current state.
  const [current] = await db
    .select({
      id: companies.id,
      subscriptionStatus: companies.subscriptionStatus,
      trialEndsAt: companies.trialEndsAt,
    })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  if (!current) {
    throw createError(404, `Company not found: ${companyId}`);
  }

  const fromState = current.subscriptionStatus;
  const trialChanged = trialEndsAt !== undefined && !datesEqual(current.trialEndsAt, trialEndsAt);
  const statusChanged = fromState !== to;

  if (!statusChanged && !trialChanged) {
    // No-op: idempotent call.
    return {
      companyId,
      from: fromState,
      to,
      trialEndsAt: current.trialEndsAt,
      eventId: null,
    };
  }

  if (statusChanged && !isValidTransition(fromState, to)) {
    const err: any = createError(
      400,
      `Illegal subscription-state transition: ${fromState ?? "null"} → ${to}`,
      "INVALID_SUBSCRIPTION_TRANSITION",
    );
    err.from = fromState;
    err.to = to;
    throw err;
  }

  // Perform the write.
  const updates: Record<string, unknown> = { subscriptionStatus: to };
  if (trialEndsAt !== undefined) updates.trialEndsAt = trialEndsAt;

  await db.update(companies).set(updates).where(eq(companies.id, companyId));

  // Append an audit event. tenant_subscriptions rows may not exist for
  // trial-only tenants; to record the transition we need a subscriptionId
  // for the event row (NOT NULL FK). Attach to the most recent tenant
  // subscription row if one exists; otherwise fall back to creating a
  // companyId-only audit row via the null-safe path below.
  const [ts] = await db
    .select({ id: tenantSubscriptions.id })
    .from(tenantSubscriptions)
    .where(eq(tenantSubscriptions.companyId, companyId))
    .orderBy(desc(tenantSubscriptions.createdAt))
    .limit(1);

  let eventId: string | null = null;
  if (ts?.id) {
    const [inserted] = await db
      .insert(subscriptionEvents)
      .values({
        subscriptionId: ts.id,
        companyId,
        type: "status_changed",
        termEndDate: null,
        metadata: {
          from: fromState,
          to,
          trialEndsAt: trialEndsAt !== undefined
            ? trialEndsAt?.toISOString() ?? null
            : current.trialEndsAt?.toISOString() ?? null,
          reason: reason ?? null,
          actorUserId: actorUserId ?? null,
          source,
          ...(metadata ?? {}),
        },
      })
      .returning({ id: subscriptionEvents.id });
    eventId = inserted?.id ?? null;
  }
  // If no tenant_subscriptions row exists yet, the transition still lands on
  // companies. The lack of an event row is acceptable for Phase 1 — it is
  // recorded in the general audit log by the calling route (admin PATCH) or
  // by the signup handler. Phase 2 adds a companyId-keyed audit table that
  // does not require an FK to tenant_subscriptions.

  // Invalidate the entitlement resolver cache for this tenant so the next
  // feature gate read sees the new state immediately.
  entitlementService.invalidateEntitlementsCache(companyId);

  return {
    companyId,
    from: fromState,
    to,
    trialEndsAt: trialEndsAt !== undefined ? trialEndsAt : current.trialEndsAt,
    eventId,
  };
}

/**
 * Emit a `trial_expired` audit event the FIRST time a tenant's trial crosses
 * `trialEndsAt` into the past. Idempotent: the `subscription_events`
 * idempotency index (subscriptionId, type, termEndDate) prevents duplicates
 * for the same trialEndsAt.
 *
 * Used by the daily trial-expire worker (see services/trialExpireWorker.ts).
 *
 * Does NOT change `companies.subscriptionStatus` — trial expiration stays
 * compute-on-read at the entitlement gate. The event exists only as an
 * audit + notification trigger surface.
 */
export async function emitTrialExpiredEvent(params: {
  companyId: string;
  trialEndsAt: Date;
}): Promise<{ eventId: string | null; alreadyEmitted: boolean }> {
  const { companyId, trialEndsAt } = params;

  const [ts] = await db
    .select({ id: tenantSubscriptions.id })
    .from(tenantSubscriptions)
    .where(eq(tenantSubscriptions.companyId, companyId))
    .orderBy(desc(tenantSubscriptions.createdAt))
    .limit(1);

  if (!ts?.id) {
    // No tenant_subscriptions row — cannot write an event (FK NOT NULL).
    // Phase 2 introduces a companyId-keyed audit path; until then we return
    // a no-op result so the worker can still report progress.
    return { eventId: null, alreadyEmitted: false };
  }

  // Check for existing event (idempotency guard). The unique index already
  // enforces this at the DB level, but we do an explicit read to return
  // `alreadyEmitted` for the worker's summary.
  const [existing] = await db
    .select({ id: subscriptionEvents.id })
    .from(subscriptionEvents)
    .where(
      and(
        eq(subscriptionEvents.subscriptionId, ts.id),
        eq(subscriptionEvents.type, "trial_expired"),
      ),
    )
    .limit(1);

  if (existing) {
    return { eventId: existing.id, alreadyEmitted: true };
  }

  try {
    const [inserted] = await db
      .insert(subscriptionEvents)
      .values({
        subscriptionId: ts.id,
        companyId,
        type: "trial_expired",
        termEndDate: trialEndsAt,
        metadata: {
          trialEndsAt: trialEndsAt.toISOString(),
          detectedAt: new Date().toISOString(),
        },
      })
      .returning({ id: subscriptionEvents.id });
    return { eventId: inserted?.id ?? null, alreadyEmitted: false };
  } catch (err: any) {
    // Race: another worker instance beat us. Treat as alreadyEmitted.
    if (err?.code === "23505") {
      return { eventId: null, alreadyEmitted: true };
    }
    throw err;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function datesEqual(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a.getTime() === b.getTime();
}

// ============================================================================
// Exports
// ============================================================================

export const subscriptionLifecycleService = {
  transition,
  emitTrialExpiredEvent,
  SUBSCRIPTION_STATES,
};
