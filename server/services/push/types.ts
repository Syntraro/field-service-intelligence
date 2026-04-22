/**
 * Push Delivery — shared types (2026-04-21 Phase 1)
 *
 * Channel-agnostic interface layer. Phase 1 ships exactly one implementation
 * (WebPushAdapter for browser PWAs). Phase 3 will add APNS/FCM adapters
 * behind this same interface without any change to the notification service
 * or any call site that already uses the adapter.
 *
 * Contract:
 *   - `deliver()` is responsible for one target; fan-out happens in
 *     pushDeliveryService.dispatchToUser.
 *   - `deliver()` never throws. Errors are returned as DeliveryResult.
 *   - If the provider signals "this endpoint is dead" (HTTP 404/410 for
 *     web-push, invalid-token callbacks for APNS/FCM later), the adapter
 *     returns `{ ok: false, revoke: true, ... }`. The service layer then
 *     soft-revokes the target in notification_targets.
 */

import type { NotificationTarget } from "@shared/schema";

// ---------------------------------------------------------------------------
// Canonical payload shape
// ---------------------------------------------------------------------------

/**
 * Internal payload produced by notificationService.emit* methods.
 * Adapters are responsible for projecting this into their wire format
 * (web-push JSON, APNS aps dict, FCM data message, etc.).
 */
export interface PushPayload {
  /** Short title shown in the system notification tray. */
  title: string;
  /** Body text shown under the title. */
  body: string;
  /** Canonical notification type (mirrors notificationTypeEnum). */
  type: string;
  /**
   * Arbitrary structured data carried to the service worker / native
   * notification-click handler. MUST include the fields needed to open
   * the right deep-link.
   */
  data: {
    linkUrl: string;
    entityType?: string;
    entityId?: string;
    [k: string]: unknown;
  };
  /**
   * Optional collapse/tag key — when present, the OS replaces any
   * existing notification with the same tag instead of stacking.
   * Used today for re-assignment cases so a visit doesn't spawn two
   * notifications in the tray.
   */
  tag?: string;
}

// ---------------------------------------------------------------------------
// Delivery result
// ---------------------------------------------------------------------------

export interface DeliveryResult {
  /** Whether the provider accepted the push. */
  ok: boolean;
  /** When true, the caller (service layer) should revoke this target. */
  revoke?: boolean;
  /** Optional diagnostic message — safe to log, never surfaced to end users. */
  error?: string;
  /** Provider-specific status code (HTTP status for web-push). */
  statusCode?: number;
}

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

export interface DeliveryAdapter {
  /**
   * Provider this adapter handles. The service layer picks adapters by
   * matching on target.provider, so this must exactly equal the string
   * stored in notification_targets.provider.
   */
  readonly provider: "webpush" | "apns" | "fcm";

  /**
   * Send a single push. MUST NOT throw. Map all errors into DeliveryResult.
   * When the provider indicates the endpoint is permanently invalid
   * (web-push 404/410, APNS BadDeviceToken, FCM UNREGISTERED), set
   * `revoke: true` so the caller can clean up.
   */
  deliver(payload: PushPayload, target: NotificationTarget): Promise<DeliveryResult>;
}
