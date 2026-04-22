/**
 * Push Delivery Service (2026-04-21 Phase 1)
 *
 * Thin façade that takes a canonical PushPayload + a recipient userId and
 * fans it out to every non-revoked target that user has registered.
 *
 * Responsibilities:
 *   - Look up live targets via notificationTargetsRepository
 *   - Dispatch to the adapter matching target.provider
 *   - Soft-revoke targets the adapter flags as stale (404/410)
 *   - Touch lastSeenAt on successful delivery
 *   - Never throw. Push is best-effort; assignment requests must not fail
 *     because a push service had a bad minute.
 *
 * NOT responsible for:
 *   - Creating the canonical `notifications` row — that's the caller's
 *     job (notificationService.emit*). Split by design so the persistent
 *     user-inbox record exists even when every device is offline.
 *   - Recipient resolution — the caller knows who to notify. This service
 *     just takes a userId and dispatches.
 */

import { notificationTargetsRepository } from "../storage/notificationTargets";
import type { NotificationTarget } from "@shared/schema";
import type { DeliveryAdapter, DeliveryResult, PushPayload } from "./push/types";
import { webPushAdapter, isWebPushConfigured } from "./push/webPushAdapter";

// ---------------------------------------------------------------------------
// Adapter registry
// ---------------------------------------------------------------------------

/**
 * Provider → adapter. Phase 1 has exactly one entry. Adding APNS/FCM
 * in Phase 3 is a pure registry addition — no service-layer change.
 */
const adapters: Record<string, DeliveryAdapter> = {
  webpush: webPushAdapter,
};

// ---------------------------------------------------------------------------
// Fan-out
// ---------------------------------------------------------------------------

export interface DispatchSummary {
  attempted: number;
  delivered: number;
  revoked: number;
  errors: number;
  skipped: number;
}

/**
 * Send `payload` to every live target for `userId`. Runs all adapter
 * deliveries in parallel; per-target failures are isolated.
 */
async function dispatchToUser(
  tenantId: string,
  userId: string,
  payload: PushPayload,
): Promise<DispatchSummary> {
  const summary: DispatchSummary = {
    attempted: 0,
    delivered: 0,
    revoked: 0,
    errors: 0,
    skipped: 0,
  };

  // Short-circuit: if no push provider is configured at all, don't even
  // hit the DB. This is the normal state for dev / CI without VAPID keys.
  if (!isWebPushConfigured()) {
    return summary;
  }

  let targets: NotificationTarget[];
  try {
    targets = await notificationTargetsRepository.listLiveTargetsForUser(tenantId, userId);
  } catch (err) {
    console.error("[pushDeliveryService] Failed to load targets", { tenantId, userId, err });
    return summary;
  }

  if (targets.length === 0) {
    return summary;
  }

  summary.attempted = targets.length;

  const results = await Promise.allSettled(
    targets.map(async (target) => {
      const adapter = adapters[target.provider];
      if (!adapter) {
        // Provider from a future phase (apns/fcm) but no adapter wired yet.
        // Skip gracefully — never block Phase 1 delivery on Phase 3 gaps.
        return { target, result: { ok: false, error: "no_adapter_for_provider" } as DeliveryResult, skipped: true };
      }
      const result = await adapter.deliver(payload, target);
      return { target, result, skipped: false };
    }),
  );

  for (const settled of results) {
    if (settled.status !== "fulfilled") {
      summary.errors++;
      continue;
    }
    const { target, result, skipped } = settled.value;
    if (skipped) {
      summary.skipped++;
      continue;
    }
    if (result.ok) {
      summary.delivered++;
      // Best-effort — a failed markDelivered should never bubble up.
      notificationTargetsRepository
        .markDelivered(target.id)
        .catch((err) => console.error("[pushDeliveryService] markDelivered failed", err));
      continue;
    }
    if (result.revoke) {
      summary.revoked++;
      notificationTargetsRepository
        .revokeTargetByEndpoint(target.endpoint)
        .catch((err) => console.error("[pushDeliveryService] revokeTargetByEndpoint failed", err));
      continue;
    }
    summary.errors++;
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Exported service
// ---------------------------------------------------------------------------

export const pushDeliveryService = {
  dispatchToUser,
};
