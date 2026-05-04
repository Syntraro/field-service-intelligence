/**
 * Payment Disputes Repository — provider-dispute lifecycle data layer
 * (PR 6, 2026-05-04).
 *
 * Pure data access for the `payment_disputes` table from
 * `migrations/2026_05_03_tenant_payment_provider_foundation.sql`. One
 * row per provider dispute event (Stripe `dp_...`). We MIRROR what
 * the provider tells us — Syntraro never opens disputes itself; this
 * PR also does not submit evidence (deferred to a later PR).
 *
 * Provider-neutral by design — this file MUST NOT import the Stripe
 * SDK or any provider-specific surface. Provider concerns (mapping
 * Stripe dispute objects → provider-neutral envelopes) live in
 * `stripeAdapter.ts`; this repo only persists the snapshots that
 * adapter normaliser returns.
 *
 * No business logic here either:
 *   * tenant scoping is enforced by the repo's `companyId` filters,
 *   * status normalisation lives in the adapter,
 *   * payment / invoice linking is done by the application service
 *     (it has the resolver context to safely match `provider_payment_id`
 *     against `payments.reference` within the right tenant scope),
 *   * idempotency is anchored by the DB unique index
 *     `payment_disputes_provider_dispute_id_uq` ON `(provider,
 *     provider_dispute_id)` WHERE provider_dispute_id IS NOT NULL.
 */
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { paymentDisputes } from "@shared/schema";
import type {
  PaymentDispute,
  PaymentDisputeStatus,
} from "@shared/schema";
import { BaseRepository } from "./base";

/**
 * Provider-neutral input shape for `upsertFromProviderEvent`. The
 * application service composes this from a normalised webhook event
 * + a resolved local `payment_provider_accounts` row + an optional
 * `payments` row when the disputed charge id matched.
 *
 * `paymentId` and `invoiceId` are nullable: out-of-order webhooks
 * (dispute lands before the charge's local payment row) are still
 * persisted with null FKs and a `payment_dispute_payment_not_found`
 * ops anomaly. A future backfill job can wire the FK once the local
 * row is created.
 */
export interface UpsertDisputeInput {
  companyId: string;
  paymentProviderAccountId: string;
  providerAccountId: string;
  provider: string;
  providerDisputeId: string;
  /** Stripe `ch_...`. Always populated by the adapter normaliser. */
  providerPaymentId: string;
  /** Local payment row id if a `payments.reference` match was found
   *  in the same tenant; null otherwise. */
  paymentId: string | null;
  /** Invoice id from the matched payment; null when no payment matched
   *  OR when the matched payment has no associated invoice (legacy
   *  multi-invoice rows have invoiceId=NULL on the row + use
   *  payment_allocations). */
  invoiceId: string | null;
  /** Dollars string (e.g. `"123.45"`). Always positive. */
  amount: string;
  /** ISO 4217 lowercase. */
  currency: string;
  status: PaymentDisputeStatus;
  reason: string | null;
  evidenceDueBy: Date | null;
  rawProviderStatus: string;
}

/** Filters accepted by `listForCompany`. */
export interface ListDisputesFilters {
  status?: PaymentDisputeStatus;
  /** Inclusive lower bound on `created_at`. */
  from?: Date;
  /** Inclusive upper bound on `created_at`. */
  to?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Aggregates returned by `getSummaryForCompany`. Money fields are
 * dollars-strings to preserve numeric(12,2) precision through the
 * JSON boundary; the API surface forwards them verbatim.
 */
export interface DisputeSummary {
  needsResponseCount: number;
  underReviewCount: number;
  wonCount: number;
  lostCount: number;
  /** SUM(amount) WHERE status IN ('needs_response', 'under_review',
   *  'warning_needs_response', 'warning_under_review'). The "open"
   *  bucket — money still at risk. */
  totalOpenAmount: string;
  /** Earliest `evidence_due_by` across actionable disputes
   *  (status='needs_response'). Null when none open. */
  nextEvidenceDueBy: string | null;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export class PaymentDisputesRepository extends BaseRepository {
  /**
   * Idempotent upsert. Inserts a row keyed on (provider,
   * provider_dispute_id); on conflict, updates the lifecycle snapshot
   * + tenant + payment/invoice attribution.
   *
   * Replay-safe by design: a Stripe webhook delivered twice for the
   * same `dp_...` lands on the same row. The `companyId` /
   * `paymentProviderAccountId` are written on every upsert because
   * the caller has already verified them; tenant CHANGES are
   * structurally impossible (the partial unique index ties
   * `(provider, provider_dispute_id)` to one row).
   *
   * Status updates are NOT monotonic — provider truth wins. Stripe
   * legitimately transitions `needs_response → under_review → won/lost`
   * and we mirror each transition as the webhook arrives. PR6 spec
   * rule: "Do NOT over-enforce final-state monotonicity. Provider
   * truth wins."
   */
  async upsertFromProviderEvent(
    input: UpsertDisputeInput,
  ): Promise<PaymentDispute> {
    this.assertCompanyId(input.companyId);
    if (!input.provider) {
      throw this.validationError("provider is required");
    }
    if (!input.providerDisputeId) {
      throw this.validationError("providerDisputeId is required");
    }
    if (!input.paymentProviderAccountId) {
      throw this.validationError("paymentProviderAccountId is required");
    }
    if (!input.providerAccountId) {
      throw this.validationError("providerAccountId is required");
    }
    if (!input.providerPaymentId) {
      throw this.validationError("providerPaymentId is required");
    }

    const now = new Date();
    const insertValues = {
      companyId: input.companyId,
      paymentProviderAccountId: input.paymentProviderAccountId,
      providerAccountId: input.providerAccountId,
      provider: input.provider,
      providerDisputeId: input.providerDisputeId,
      providerPaymentId: input.providerPaymentId,
      paymentId: input.paymentId,
      invoiceId: input.invoiceId,
      amount: input.amount,
      currency: input.currency,
      status: input.status,
      reason: input.reason,
      evidenceDueBy: input.evidenceDueBy,
      rawProviderStatus: input.rawProviderStatus,
    };

    const [row] = await db
      .insert(paymentDisputes)
      .values(insertValues)
      .onConflictDoUpdate({
        // Partial unique index `payment_disputes_provider_dispute_id_uq`
        // (PR1) — Postgres requires the partial-index predicate to be
        // matched explicitly via Drizzle `targetWhere`.
        target: [paymentDisputes.provider, paymentDisputes.providerDisputeId],
        targetWhere: sql`${paymentDisputes.providerDisputeId} IS NOT NULL`,
        set: {
          // Tenant attribution — caller already validated.
          companyId: input.companyId,
          paymentProviderAccountId: input.paymentProviderAccountId,
          providerAccountId: input.providerAccountId,
          // Payment / invoice linking — overwrite on every upsert so
          // out-of-order events that initially landed with null FKs
          // backfill cleanly when the matching payment exists by the
          // time a follow-up `dispute.updated` arrives.
          paymentId: input.paymentId,
          invoiceId: input.invoiceId,
          // Lifecycle snapshot — provider truth wins.
          providerPaymentId: input.providerPaymentId,
          amount: input.amount,
          currency: input.currency,
          status: input.status,
          reason: input.reason,
          evidenceDueBy: input.evidenceDueBy,
          rawProviderStatus: input.rawProviderStatus,
          updatedAt: now,
        },
      })
      .returning();
    return row;
  }

  /**
   * Tenant-scoped list with optional status / created_at filters.
   * Sort: most recent first. Tenant scope is enforced with a strict
   * `eq(companyId)` predicate; cross-tenant access is structurally
   * impossible.
   *
   * Why created_at and not evidence_due_by: disputes don't always
   * have an evidence due-by (warnings, closed disputes), so sorting
   * by it would push half the rows to the bottom. created_at is the
   * monotonic anchor every row carries.
   */
  async listForCompany(
    companyId: string,
    filters: ListDisputesFilters = {},
  ): Promise<PaymentDispute[]> {
    this.assertCompanyId(companyId);

    const limit = clampDisputesLimit(filters.limit);
    const offset = clampDisputesOffset(filters.offset);

    const predicates = [eq(paymentDisputes.companyId, companyId)];
    if (filters.status) {
      predicates.push(eq(paymentDisputes.status, filters.status));
    }
    if (filters.from) {
      predicates.push(gte(paymentDisputes.createdAt, filters.from));
    }
    if (filters.to) {
      predicates.push(lte(paymentDisputes.createdAt, filters.to));
    }

    return db
      .select()
      .from(paymentDisputes)
      .where(and(...predicates))
      .orderBy(desc(paymentDisputes.createdAt), desc(paymentDisputes.updatedAt))
      .limit(limit)
      .offset(offset);
  }

  /**
   * Aggregate summary for a tenant's disputes dashboard. Single
   * tenant-scoped query.
   *
   * Status buckets:
   *   * needsResponseCount  — operator action required (evidence)
   *   * underReviewCount    — evidence submitted, provider deciding
   *   * wonCount            — terminal positive
   *   * lostCount           — terminal negative
   *   * totalOpenAmount     — SUM(amount) on every status that's
   *                           still in flight (regular + warning, but
   *                           not closed/won/lost).
   *   * nextEvidenceDueBy   — MIN(evidence_due_by) on rows where the
   *                           operator must act (status='needs_response'
   *                           AND evidence_due_by IS NOT NULL).
   */
  async getSummaryForCompany(companyId: string): Promise<DisputeSummary> {
    this.assertCompanyId(companyId);

    const [row] = await db
      .select({
        needsResponseCount: sql<number>`COUNT(*) FILTER (WHERE ${paymentDisputes.status} = 'needs_response')::int`,
        underReviewCount: sql<number>`COUNT(*) FILTER (WHERE ${paymentDisputes.status} = 'under_review')::int`,
        wonCount: sql<number>`COUNT(*) FILTER (WHERE ${paymentDisputes.status} = 'won')::int`,
        lostCount: sql<number>`COUNT(*) FILTER (WHERE ${paymentDisputes.status} = 'lost')::int`,
        totalOpenAmount: sql<string>`COALESCE(SUM(CASE WHEN ${paymentDisputes.status} IN ('needs_response', 'under_review', 'warning_needs_response', 'warning_under_review') THEN ${paymentDisputes.amount} ELSE 0 END), '0')::text`,
        nextEvidenceDueBy: sql<string | null>`MIN(${paymentDisputes.evidenceDueBy}) FILTER (WHERE ${paymentDisputes.status} = 'needs_response' AND ${paymentDisputes.evidenceDueBy} IS NOT NULL)`,
      })
      .from(paymentDisputes)
      .where(eq(paymentDisputes.companyId, companyId));

    return {
      needsResponseCount: row?.needsResponseCount ?? 0,
      underReviewCount: row?.underReviewCount ?? 0,
      wonCount: row?.wonCount ?? 0,
      lostCount: row?.lostCount ?? 0,
      totalOpenAmount: normaliseMoneyString(row?.totalOpenAmount),
      nextEvidenceDueBy: row?.nextEvidenceDueBy
        ? new Date(row.nextEvidenceDueBy).toISOString()
        : null,
    };
  }
}

function clampDisputesLimit(raw: number | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function clampDisputesOffset(raw: number | undefined): number {
  if (raw === undefined) return 0;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function normaliseMoneyString(value: string | null | undefined): string {
  if (!value) return "0.00";
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

export const paymentDisputesRepository = new PaymentDisputesRepository();
