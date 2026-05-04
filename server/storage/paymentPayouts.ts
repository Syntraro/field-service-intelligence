/**
 * Payment Payouts Repository — provider-payout lifecycle data layer
 * (PR 5, 2026-05-04).
 *
 * Pure data access for the `payment_payouts` table from
 * `migrations/2026_05_03_tenant_payment_provider_foundation.sql`. One
 * row per provider payout event (Stripe `po_...`). We MIRROR what the
 * provider tells us — Syntraro never initiates payouts.
 *
 * Provider-neutral by design — this file MUST NOT import the Stripe
 * SDK or any provider-specific surface. Provider concerns (mapping
 * Stripe payout objects → provider-neutral envelopes) live in
 * `stripeAdapter.ts`; this repo only persists the snapshots that
 * adapter normaliser returns.
 *
 * No business logic here either:
 *   * tenant scoping is enforced by the repo's `companyId` filters,
 *   * status normalisation lives in the adapter,
 *   * idempotency is anchored by the DB unique index
 *     `payment_payouts_provider_payout_id_uq` ON `(provider,
 *     provider_payout_id)` WHERE provider_payout_id IS NOT NULL.
 *
 * The application-service handler resolves the local
 * `payment_provider_accounts` row first (giving us companyId +
 * paymentProviderAccountId) and passes those into
 * `upsertFromProviderEvent`. The repo trusts the caller for tenant
 * resolution; cross-tenant safety is enforced one level up.
 */
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { paymentPayouts } from "@shared/schema";
import type {
  PaymentPayout,
  PaymentPayoutStatus,
} from "@shared/schema";
import { BaseRepository } from "./base";

/**
 * Provider-neutral input shape for `upsertFromProviderEvent`. The
 * application service composes this from a normalised webhook event
 * + a resolved local `payment_provider_accounts` row.
 *
 * Sign convention on `amount`: dollars-string (e.g. `"123.45"`),
 * always positive — payment_payouts mirrors the gross transferred-to-
 * bank amount. Failure semantics are explained via failure_* fields,
 * not negative amounts.
 */
export interface UpsertPayoutInput {
  companyId: string;
  paymentProviderAccountId: string;
  providerAccountId: string;
  provider: string;
  providerPayoutId: string;
  /** Dollars string (e.g. `"123.45"`). Always positive. */
  amount: string;
  /** ISO 4217 lowercase. */
  currency: string;
  status: PaymentPayoutStatus;
  arrivalDate: Date | null;
  destinationLast4: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  rawProviderStatus: string;
}

/** Filters accepted by `listForCompany`. */
export interface ListPayoutsFilters {
  status?: PaymentPayoutStatus;
  /** Inclusive lower bound on `arrival_date`. */
  from?: Date;
  /** Inclusive upper bound on `arrival_date`. */
  to?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Aggregates returned by `getSummaryForCompany`. Money fields are
 * dollars-strings to preserve numeric(12,2) precision through the
 * JSON boundary; the API surface forwards them verbatim.
 */
export interface PayoutSummary {
  pendingTotal: string;
  inTransitTotal: string;
  paidLast30Days: string;
  failedCount: number;
  nextArrivalDate: string | null;
}

/** Default page size for the list endpoint. PR1's payouts table is small
 *  per tenant (~one row per business day max) so 50 is generous. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export class PaymentPayoutsRepository extends BaseRepository {
  /**
   * Idempotent upsert. Inserts a row keyed on (provider,
   * provider_payout_id); on conflict, updates the lifecycle snapshot
   * + tenant attribution.
   *
   * Replay-safe by design: a Stripe webhook delivered twice for the
   * same `po_...` lands on the same row. The `companyId` /
   * `paymentProviderAccountId` are written on every upsert because
   * the caller has already verified them — we never silently change
   * tenant attribution (the FK + unique index would block that
   * structurally).
   *
   * Status updates are NOT monotonic — provider truth wins. Stripe
   * legitimately transitions `pending → in_transit → paid` and we
   * mirror each transition as the webhook arrives. PR5 spec rule:
   * "Do NOT over-enforce monotonic status if Stripe sends updated
   * status changes."
   */
  async upsertFromProviderEvent(input: UpsertPayoutInput): Promise<PaymentPayout> {
    this.assertCompanyId(input.companyId);
    if (!input.provider) {
      throw this.validationError("provider is required");
    }
    if (!input.providerPayoutId) {
      throw this.validationError("providerPayoutId is required");
    }
    if (!input.paymentProviderAccountId) {
      throw this.validationError("paymentProviderAccountId is required");
    }
    if (!input.providerAccountId) {
      throw this.validationError("providerAccountId is required");
    }

    const now = new Date();
    const insertValues = {
      companyId: input.companyId,
      paymentProviderAccountId: input.paymentProviderAccountId,
      providerAccountId: input.providerAccountId,
      provider: input.provider,
      providerPayoutId: input.providerPayoutId,
      amount: input.amount,
      currency: input.currency,
      status: input.status,
      arrivalDate: input.arrivalDate,
      destinationLast4: input.destinationLast4,
      failureCode: input.failureCode,
      failureMessage: input.failureMessage,
      rawProviderStatus: input.rawProviderStatus,
    };

    const [row] = await db
      .insert(paymentPayouts)
      .values(insertValues)
      .onConflictDoUpdate({
        // The unique index `payment_payouts_provider_payout_id_uq` is
        // PARTIAL (`WHERE provider_payout_id IS NOT NULL`). Postgres
        // requires the ON CONFLICT predicate to match the partial-index
        // predicate exactly; Drizzle exposes `targetWhere` for that.
        // Every row going through this method has a non-null
        // providerPayoutId (validated above), so the partial index is
        // always the matching constraint.
        target: [paymentPayouts.provider, paymentPayouts.providerPayoutId],
        targetWhere: sql`${paymentPayouts.providerPayoutId} IS NOT NULL`,
        set: {
          // Tenant attribution — caller already validated; included on
          // updates so a webhook arriving after an out-of-band repair
          // still lands the canonical mapping. Tenant CHANGES are
          // structurally impossible: the partial unique index ties
          // `(provider, provider_payout_id)` to one row, and the
          // `companies.id` FK + `payment_provider_accounts.id` FK
          // each point at the right tenant.
          companyId: input.companyId,
          paymentProviderAccountId: input.paymentProviderAccountId,
          providerAccountId: input.providerAccountId,
          // Lifecycle snapshot — provider truth wins.
          amount: input.amount,
          currency: input.currency,
          status: input.status,
          arrivalDate: input.arrivalDate,
          destinationLast4: input.destinationLast4,
          failureCode: input.failureCode,
          failureMessage: input.failureMessage,
          rawProviderStatus: input.rawProviderStatus,
          updatedAt: now,
        },
      })
      .returning();
    return row;
  }

  /**
   * Tenant-scoped list with optional status / arrival_date filters.
   * Sort: most recent arrival first (NULLS LAST so pending-without-
   * scheduled-date land at the bottom rather than masking real rows).
   * Tenant scope is enforced with a strict `eq(companyId)` predicate;
   * cross-tenant access is structurally impossible.
   */
  async listForCompany(
    companyId: string,
    filters: ListPayoutsFilters = {},
  ): Promise<PaymentPayout[]> {
    this.assertCompanyId(companyId);

    const limit = clampPayoutsLimit(filters.limit);
    const offset = clampPayoutsOffset(filters.offset);

    const predicates = [eq(paymentPayouts.companyId, companyId)];
    if (filters.status) {
      predicates.push(eq(paymentPayouts.status, filters.status));
    }
    if (filters.from) {
      predicates.push(gte(paymentPayouts.arrivalDate, filters.from));
    }
    if (filters.to) {
      predicates.push(lte(paymentPayouts.arrivalDate, filters.to));
    }

    return db
      .select()
      .from(paymentPayouts)
      .where(and(...predicates))
      .orderBy(
        // NULLS LAST manually because Drizzle doesn't expose nullsLast
        // here without raw SQL; descending on arrival_date naturally
        // pushes nulls last on PG.
        desc(paymentPayouts.arrivalDate),
        desc(paymentPayouts.updatedAt),
      )
      .limit(limit)
      .offset(offset);
  }

  /**
   * Aggregate summary for a tenant's payouts dashboard. Single
   * tenant-scoped query (no `await` per metric) for reasonable
   * latency at scale.
   *
   * Money rollups:
   *   * `pendingTotal`     — SUM(amount) WHERE status='pending'
   *   * `inTransitTotal`   — SUM(amount) WHERE status='in_transit'
   *   * `paidLast30Days`   — SUM(amount) WHERE status='paid'
   *                          AND arrival_date >= now() - 30 days
   *   * `failedCount`      — COUNT(*) WHERE status='failed'
   *   * `nextArrivalDate`  — MIN(arrival_date) WHERE status IN
   *                          ('pending','in_transit') AND arrival_date
   *                          IS NOT NULL
   */
  async getSummaryForCompany(companyId: string): Promise<PayoutSummary> {
    this.assertCompanyId(companyId);

    // Single SQL aggregation. Casts force the SUM expressions to
    // numeric so SUM(0 rows) returns '0.00' rather than NULL.
    const [row] = await db
      .select({
        pendingTotal: sql<string>`COALESCE(SUM(CASE WHEN ${paymentPayouts.status} = 'pending' THEN ${paymentPayouts.amount} ELSE 0 END), '0')::text`,
        inTransitTotal: sql<string>`COALESCE(SUM(CASE WHEN ${paymentPayouts.status} = 'in_transit' THEN ${paymentPayouts.amount} ELSE 0 END), '0')::text`,
        paidLast30Days: sql<string>`COALESCE(SUM(CASE WHEN ${paymentPayouts.status} = 'paid' AND ${paymentPayouts.arrivalDate} >= NOW() - INTERVAL '30 days' THEN ${paymentPayouts.amount} ELSE 0 END), '0')::text`,
        failedCount: sql<number>`COUNT(*) FILTER (WHERE ${paymentPayouts.status} = 'failed')::int`,
        nextArrivalDate: sql<string | null>`MIN(${paymentPayouts.arrivalDate}) FILTER (WHERE ${paymentPayouts.status} IN ('pending', 'in_transit') AND ${paymentPayouts.arrivalDate} IS NOT NULL)`,
      })
      .from(paymentPayouts)
      .where(eq(paymentPayouts.companyId, companyId));

    return {
      pendingTotal: normaliseMoneyString(row?.pendingTotal),
      inTransitTotal: normaliseMoneyString(row?.inTransitTotal),
      paidLast30Days: normaliseMoneyString(row?.paidLast30Days),
      failedCount: row?.failedCount ?? 0,
      nextArrivalDate: row?.nextArrivalDate
        ? new Date(row.nextArrivalDate).toISOString()
        : null,
    };
  }
}

function clampPayoutsLimit(raw: number | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function clampPayoutsOffset(raw: number | undefined): number {
  if (raw === undefined) return 0;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/** Coerce SUM(...)::text to a fixed-2-decimal dollars string. */
function normaliseMoneyString(value: string | null | undefined): string {
  if (!value) return "0.00";
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

export const paymentPayoutsRepository = new PaymentPayoutsRepository();
