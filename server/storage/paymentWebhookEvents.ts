/**
 * Payment Webhook Events repository (Payment Ops PR1, 2026-04-22).
 *
 * Persistent diagnostic log for inbound provider webhook deliveries.
 * Sidecar of the canonical `payments` ledger — never the source of
 * truth for money state, only a queryable record of what we saw and
 * what we decided.
 *
 * Writes are best-effort. `safeRecord` wraps the real insert so a
 * log-write failure never propagates back up the webhook decision
 * path — losing the log entry is OK; ACK-ing a real payment event
 * as 200 when it actually failed would not be.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  paymentWebhookEvents,
  type PaymentWebhookEventKind,
  type PaymentWebhookEventOutcome,
} from "@shared/schema";

/**
 * Allowlist of metadata keys we are willing to persist on the log row.
 * Every value we currently put on a Stripe PaymentIntent's metadata is
 * covered here. Anything else — especially anything originating from
 * the provider's own payload — is stripped.
 *
 * Defense-in-depth: even though today we control every metadata key
 * we write, a future caller could add `customerEmail` or similar and
 * not realize it ends up on the log table. The allowlist stops that
 * at the logger boundary without code review.
 */
const METADATA_ALLOWLIST = new Set<string>([
  "companyId",
  "invoiceId",
  "invoiceNumber",
  "prospectivePaymentId",
  "refundLedgerId",
  "source",
  // 2026-05-06 PR3 — Collect Payment dialog multi-invoice card path.
  // These fields are needed on the persisted log row so an operator
  // triaging a "config_error" / sum-mismatch event can navigate from
  // the Payments dashboard banner straight to the Stripe charge + the
  // affected customer + the affected invoice set without an extra
  // psql round-trip.
  "customerCompanyId",
  "multiInvoiceMode",
  "carrierInvoiceId",
  "paymentProviderAccountId",
]);

export function redactMetadataForLog(
  raw: Record<string, unknown> | null | undefined,
): Record<string, string> | null {
  if (!raw) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!METADATA_ALLOWLIST.has(key)) continue;
    if (typeof value === "string") out[key] = value;
    else if (typeof value === "number" || typeof value === "boolean") {
      out[key] = String(value);
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Build the natural dedupe key for this event. Returns null for events
 * that have no stable identifier (signature failures) so the storage
 * layer skips its uniqueness guard and each row is new.
 */
export function buildDedupeKey(parts: {
  providerId: string;
  providerEventId: string | null | undefined;
  providerRefundId?: string | null;
}): string | null {
  if (!parts.providerEventId) return null;
  if (parts.providerRefundId) {
    return `${parts.providerId}:${parts.providerEventId}:${parts.providerRefundId}`;
  }
  return `${parts.providerId}:${parts.providerEventId}`;
}

export interface RecordWebhookEventInput {
  providerId: string;
  providerEventId?: string | null;
  eventType?: string | null;
  eventKind: PaymentWebhookEventKind;
  outcome: PaymentWebhookEventOutcome;
  httpStatus: number;
  companyId?: string | null;
  invoiceId?: string | null;
  parentPaymentId?: string | null;
  providerPaymentId?: string | null;
  providerRefundId?: string | null;
  amountCents?: number | null;
  errorMessage?: string | null;
  /** Pre-redacted metadata. Prefer callers use `redactMetadataForLog`
   *  before passing — but we run it again here defensively. */
  rawMetadata?: Record<string, unknown> | null;
  dedupeKey?: string | null;
}

/**
 * UPSERT on `dedupe_key`. Replays (redeliveries of the same natural
 * event) increment `attempts` and refresh `outcome` + `http_status` +
 * `error_message` + `processed_at` so the operator table always shows
 * the most recent decision for the same event.
 *
 * Signature-failure rows pass `dedupeKey=null` and are therefore
 * always inserted as new rows (there is no stable identifier to
 * dedupe against pre-verification).
 */
export async function recordPaymentWebhookEvent(
  input: RecordWebhookEventInput,
): Promise<void> {
  const values = {
    providerId: input.providerId,
    providerEventId: input.providerEventId ?? null,
    eventType: input.eventType ?? null,
    eventKind: input.eventKind,
    outcome: input.outcome,
    httpStatus: input.httpStatus,
    companyId: input.companyId ?? null,
    invoiceId: input.invoiceId ?? null,
    parentPaymentId: input.parentPaymentId ?? null,
    providerPaymentId: input.providerPaymentId ?? null,
    providerRefundId: input.providerRefundId ?? null,
    amountCents: input.amountCents ?? null,
    errorMessage: input.errorMessage ?? null,
    rawMetadata: redactMetadataForLog(input.rawMetadata ?? null),
    dedupeKey: input.dedupeKey ?? null,
    processedAt: new Date(),
  };

  if (!values.dedupeKey) {
    await db.insert(paymentWebhookEvents).values(values);
    return;
  }

  // 2026-05-06 PR4 — `payment_webhook_events.dedupe_key` is a PARTIAL
  // unique index (`WHERE dedupe_key IS NOT NULL`). The previous
  // `onConflictDoUpdate({ target })` form silently failed in Postgres
  // with "there is no unique or exclusion constraint matching the
  // ON CONFLICT specification" because partial indexes need an
  // explicit predicate match. The `safeRecord` wrapper swallowed the
  // error so deliveries appeared to log fine while in fact every
  // dedupeKey-bearing row was being lost. Adding `targetWhere` makes
  // Postgres recognize the partial index and the upsert lands.
  await db
    .insert(paymentWebhookEvents)
    .values(values)
    .onConflictDoUpdate({
      target: paymentWebhookEvents.dedupeKey,
      targetWhere: sql`dedupe_key IS NOT NULL`,
      set: {
        outcome: values.outcome,
        httpStatus: values.httpStatus,
        errorMessage: values.errorMessage,
        processedAt: values.processedAt,
        // Carry the latest observed tenant context in case the first
        // delivery couldn't resolve it but the retry can.
        companyId: values.companyId,
        invoiceId: values.invoiceId,
        parentPaymentId: values.parentPaymentId,
        attempts: sql`${paymentWebhookEvents.attempts} + 1`,
      },
    });
}

/**
 * Fire-and-forget wrapper around `recordPaymentWebhookEvent`. Never
 * throws — the log table is a diagnostic surface, not a correctness
 * dependency. A DB blip on the log path must not turn a successful
 * webhook decision into a 500.
 *
 * Logs a `[payments-webhook] log_write_failed` line on failure so
 * operators can correlate if they ever notice events missing from
 * the ops dashboard.
 */
export async function safeRecordPaymentWebhookEvent(
  input: RecordWebhookEventInput,
): Promise<void> {
  try {
    await recordPaymentWebhookEvent(input);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      "[payments-webhook] log_write_failed",
      JSON.stringify({
        kind: "log_write_failed",
        providerId: input.providerId,
        eventKind: input.eventKind,
        providerEventId: input.providerEventId ?? null,
        outcome: input.outcome,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

// 2026-04-22 Rollback: read helpers (list + getById) removed along
// with the platform ops routes. The table is now a write-only error
// log — operators query it directly via psql / BI tools when they
// need to look at historical webhook errors. If an in-app read
// surface returns later, reintroduce list/get then.

// ============================================================================
// 2026-05-04 PR8 — Tenant-scoped anomaly summary.
// ============================================================================
//
// Single read helper that powers the Payments dashboard's "events
// requiring attention" banner. NOT a full ops drilldown — that would
// surface the row contents (potentially sensitive) and is deferred to
// a platform-side console. This helper returns COUNTS ONLY:
//   - total anomalies in the window
//   - per-event-kind breakdown
//
// "Anomaly" = `outcome IN ('config_error', 'transient_failure')`. Both
// surface ops attention items: config_error means the webhook landed
// but our local state was inconsistent (e.g. unknown connected
// account); transient_failure means we 500'd back to Stripe and
// they're retrying. Replays / accepted / ignored are NOT anomalies.
//
// Tenant scoping: required `companyId` filter. Cross-tenant counts
// would leak operational signal (volume of disputes, payout failures,
// etc.) so the helper refuses to run without one.

export interface TenantWebhookAnomalySummary {
  /** Window width — typically 7 or 30 days. */
  windowDays: number;
  /** Total anomaly count across all event kinds. */
  total: number;
  /** Per-event-kind breakdown. Keys are stable enum values (e.g.
   *  `payment_succeeded`, `payout_created`, `dispute_updated`). Only
   *  kinds with > 0 hits in the window appear. */
  byKind: Record<string, number>;
}

/**
 * Count config-error + transient-failure rows in `paymentWebhookEvents`
 * for a tenant within the given window. Designed to be cheap — single
 * GROUP BY on `(eventKind)` filtered by `(companyId, outcome,
 * receivedAt >= now() - INTERVAL)`. Indexes
 * `payment_webhook_events_company_received_idx` (PR1) +
 * `payment_webhook_events_outcome_received_idx` (PR1) cover the
 * predicate.
 *
 * Returns zero counts (`total: 0`, `byKind: {}`) when the tenant has
 * no anomalies — the dashboard hides the banner in that case.
 */
export async function getTenantWebhookAnomalySummary(
  companyId: string,
  windowDays: number,
): Promise<TenantWebhookAnomalySummary> {
  if (!companyId) {
    throw new Error("companyId is required for tenant anomaly summary");
  }
  if (
    !Number.isFinite(windowDays) ||
    windowDays <= 0 ||
    windowDays > 365
  ) {
    throw new Error("windowDays must be a positive integer ≤ 365");
  }
  const rows = await db.execute<{ event_kind: string; count: number }>(sql`
    SELECT
      ${paymentWebhookEvents.eventKind} AS event_kind,
      COUNT(*)::int AS count
    FROM ${paymentWebhookEvents}
    WHERE
      ${paymentWebhookEvents.companyId} = ${companyId}
      AND ${paymentWebhookEvents.outcome} IN ('config_error', 'transient_failure')
      AND ${paymentWebhookEvents.receivedAt} >= NOW() - (${windowDays} || ' days')::interval
    GROUP BY ${paymentWebhookEvents.eventKind}
  `);

  const byKind: Record<string, number> = {};
  let total = 0;
  for (const row of rows.rows as { event_kind: string; count: number }[]) {
    byKind[row.event_kind] = row.count;
    total += row.count;
  }
  return { windowDays, total, byKind };
}
