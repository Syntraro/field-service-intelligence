/**
 * maybeSyncPaymentToQbo — fire-and-forget outbound payment sync helper
 *
 * 2026-04-09: This is the canonical entry point that route handlers call
 * AFTER a successful local payment write. It is intentionally a thin wrapper
 * that:
 *
 *   1. Checks the company-level toggle `companies.qboPaymentSyncEnabled`.
 *      If false → no-op. If true → continue.
 *
 *   2. Loads QBO OAuth tokens from `qbo_connections`. If missing → log skip
 *      to console (not a hard failure; the company hasn't connected QBO).
 *
 *   3. Builds a QboSyncOrchestrator and calls `syncPayment(id, action,
 *      snapshot?)`.
 *
 *   4. Catches any throw and logs it. Never propagates errors out — this
 *      function is designed to be called via `void maybeSyncPaymentToQbo(...)`
 *      after the HTTP response has been sent, so any error here would be an
 *      unhandled rejection otherwise.
 *
 * Locked product invariants enforced here:
 *
 *   - The local payment write has ALREADY committed by the time we get here.
 *     A QBO failure cannot roll back local payment state. (Decision #6.)
 *
 *   - The toggle is the gate for BOTH automatic post-write sync (this
 *     helper) AND manual retry (the route at POST /api/qbo/sync/payment/:id).
 *     Disabled = no payment sync at all. (Decision #3.)
 *
 *   - All error/skip surfaces are written to `payments.qbo_sync_status` and
 *     `payments.qbo_sync_error` by `QboPaymentService`, NOT here. The UI
 *     reads from those columns to surface failures. (Decision #5.)
 *
 *   - This helper NEVER touches invoice financial state. Period.
 *
 * Usage from a route handler:
 *
 *   const payment = await paymentRepository.createPayment(...);
 *   res.status(201).json(payment);
 *   // Fire after the response is sent, with the snapshot for delete safety.
 *   void maybeSyncPaymentToQbo(companyId, payment.id, "create", userId);
 */

import { db } from "../../db";
import { eq, and } from "drizzle-orm";
import { companies, qboConnections, payments as paymentsTable } from "@shared/schema";
import type { Payment } from "@shared/schema";
import { createSyncOrchestrator } from "./QboSyncOrchestrator";
import type { QboTokens } from "./QboClient";

export type PaymentSyncAction = "create" | "update" | "delete";

/**
 * Fire-and-forget helper. Always returns void; never throws.
 *
 * @param companyId  - tenant company id (from req.companyId)
 * @param paymentId  - the local payment row id
 * @param action     - which QBO operation to perform
 * @param triggeredBy - optional user id (from req.user?.id) for audit
 * @param snapshot   - REQUIRED for "delete" action when the local row has
 *                     already been removed; ignored otherwise
 */
export async function maybeSyncPaymentToQbo(
  companyId: string,
  paymentId: string,
  action: PaymentSyncAction,
  triggeredBy?: string,
  snapshot?: Payment,
): Promise<void> {
  try {
    // 1. Check the company-level toggle
    const [company] = await db
      .select({
        qboEnabled: companies.qboEnabled,
        qboPaymentSyncEnabled: companies.qboPaymentSyncEnabled,
      })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);

    if (!company) {
      console.warn(`[maybeSyncPaymentToQbo] Company ${companyId} not found; skipping`);
      return;
    }

    // Both toggles must be on. qboEnabled is the master switch (configured by
    // QBO Console); qboPaymentSyncEnabled is the per-feature payment sync gate.
    if (!company.qboEnabled || !company.qboPaymentSyncEnabled) {
      // Quiet no-op when disabled — do not log per call (would be noisy).
      return;
    }

    // 2. Load QBO OAuth tokens from qbo_connections
    const [conn] = await db
      .select()
      .from(qboConnections)
      .where(eq(qboConnections.companyId, companyId))
      .limit(1);

    if (!conn) {
      // Toggle is on but the company has not actually connected to QBO.
      // Surface this as a skip on the payment row so the user knows why
      // the badge says "needs attention".
      await db
        .update(paymentsTable)
        .set({
          qboSyncStatus: "ERROR",
          qboSyncError: "QuickBooks is not connected for this company. Reconnect via QBO Console.",
        })
        .where(
          and(
            eq(paymentsTable.id, paymentId),
            eq(paymentsTable.companyId, companyId),
          ),
        );
      console.warn(`[maybeSyncPaymentToQbo] No QBO connection for company ${companyId}; payment ${paymentId} marked ERROR`);
      return;
    }

    const tokens: QboTokens = {
      accessToken: conn.accessToken,
      refreshToken: conn.refreshToken,
      realmId: conn.realmId,
      expiresAt: conn.accessTokenExpiresAt ?? new Date(0),
    };

    // 3. Build the orchestrator and call syncPayment
    const orchestrator = createSyncOrchestrator(tokens, companyId, triggeredBy);
    if (!orchestrator) {
      // QBO env vars missing — should be rare in prod but possible in dev.
      console.warn(`[maybeSyncPaymentToQbo] QBO env not configured; skipping payment ${paymentId}`);
      return;
    }

    const result = await orchestrator.syncPayment(paymentId, action, snapshot);

    // 4. The QboPaymentService has already written sync status to the
    //    payment row and logged to qbo_sync_events. Nothing more to do here.
    //    A non-success result is not a throw — it's a normal completion with
    //    `success: false`. The UI reads from payments.qbo_sync_status.
    if (!result.success) {
      console.warn(
        `[maybeSyncPaymentToQbo] Payment ${paymentId} (${action}) sync did not succeed: ${result.error || result.skipReason || "unknown"}`,
      );
    }
  } catch (err) {
    // Last-resort safety net. Should not be reached because syncPayment
    // never throws, but if a bug somehow leaks an exception out, we catch
    // it here so the unhandled rejection doesn't crash the process.
    console.error(
      `[maybeSyncPaymentToQbo] Unexpected error syncing payment ${paymentId} (${action}):`,
      err,
    );
  }
}
