/**
 * Payment Methods Repository — saved-card data layer (PR A, 2026-05-03).
 *
 * Pure data access surface for the `payment_methods` junction-style
 * table introduced by `migrations/2026_05_03_payment_methods.sql`. One
 * row per saved card, tenant + customer-company scoped.
 *
 * Provider-neutral by design — this file MUST NOT import the Stripe SDK
 * or any other provider-specific surface. Provider concerns (creating
 * customers, attaching payment methods, detaching them at the provider)
 * live behind the `PaymentProvider` interface and its adapters; this
 * repo only persists / reads the metadata those adapters return.
 *
 * No business logic here either:
 *   - no consent-text validation (route layer)
 *   - no card-expiry checks (caller / UI)
 *   - no provider lifecycle calls (service layer)
 *   - no event emission (service layer)
 *
 * Idempotency anchor: the unique index
 *   (company_id, provider_source, provider_payment_method_id)
 * is the canonical "webhook replay → no duplicate row" contract — same
 * SQLSTATE 23505 path PR 1 established. Callers handle the error class
 * via the application-service classifier; this repo just lets the DB
 * surface the violation.
 */
import { db } from "../db";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { paymentMethods } from "@shared/schema";
import type {
  InsertSavedPaymentMethod,
  SavedPaymentMethod,
} from "@shared/schema";
import { BaseRepository } from "./base";

/** Caller-supplied row shape. Tenant + customer-company are validated here. */
export interface CreatePaymentMethodInput
  extends Omit<InsertSavedPaymentMethod, "isDefault"> {
  /** Optional — defaults false. Set true for the first saved card on a
   *  customer-company OR via an explicit "Set as default" action; the
   *  partial unique index `payment_methods_one_default_per_customer`
   *  enforces at-most-one active default. */
  isDefault?: boolean;
}

export class PaymentMethodsRepository extends BaseRepository {
  /**
   * Insert one saved-payment-method row.
   *
   * Tx-aware: pass the transaction handle from the caller so the insert
   * is part of the same atomic unit that resolved the provider customer.
   *
   * Tenant + customer-company are taken from `data.companyId` /
   * `data.customerCompanyId` and validated. Provider-issued tokens
   * (`providerSource`, `providerCustomerId`, `providerPaymentMethodId`)
   * are required and must be non-empty strings — we check at the repo
   * boundary as defense in depth so a misbehaving caller can't write a
   * row that bypasses the unique index.
   *
   * Card metadata is required at insert time (the caller pulled it from
   * the provider's PaymentMethod object before calling).
   *
   * Returns the persisted row. A duplicate
   * `(companyId, providerSource, providerPaymentMethodId)` raises a
   * Postgres unique violation (SQLSTATE 23505); the caller is
   * responsible for surfacing it as a 409 / replay outcome.
   */
  async createPaymentMethod(
    tx: any,
    data: CreatePaymentMethodInput,
  ): Promise<SavedPaymentMethod> {
    this.assertCompanyId(data.companyId);
    this.validateUUID(data.customerCompanyId, "customerCompanyId");
    if (!data.providerSource) {
      throw this.validationError("providerSource is required");
    }
    if (!data.providerCustomerId) {
      throw this.validationError("providerCustomerId is required");
    }
    if (!data.providerPaymentMethodId) {
      throw this.validationError("providerPaymentMethodId is required");
    }
    if (!data.cardBrand || !data.cardLast4) {
      throw this.validationError("cardBrand + cardLast4 are required");
    }
    if (
      !Number.isInteger(data.cardExpMonth) ||
      data.cardExpMonth < 1 ||
      data.cardExpMonth > 12
    ) {
      throw this.validationError("cardExpMonth must be an integer 1-12");
    }
    if (!Number.isInteger(data.cardExpYear) || data.cardExpYear < 2000) {
      throw this.validationError("cardExpYear must be a 4-digit year");
    }
    if (!data.consentText) {
      throw this.validationError("consentText is required");
    }
    if (!data.consentAt) {
      throw this.validationError("consentAt is required");
    }

    const [row] = await tx
      .insert(paymentMethods)
      .values({
        ...data,
        isDefault: data.isDefault ?? false,
      })
      .returning();
    return row;
  }

  /**
   * List active (non-detached) saved cards for a (tenant, customer-company).
   *
   * Sort: default first, then most-recently-created first — matches the
   * order the portal "Saved cards" screen renders. Detached rows are
   * excluded by design; an "include archived" flag is intentionally NOT
   * exposed (the soft-delete table is for forensic queries via direct
   * DB read, not a customer-facing list).
   *
   * Read-only — does not touch any tx; uses the canonical pool.
   */
  async listByCustomerCompany(
    companyId: string,
    customerCompanyId: string,
  ): Promise<SavedPaymentMethod[]> {
    this.assertCompanyId(companyId);
    this.validateUUID(customerCompanyId, "customerCompanyId");

    return await db
      .select()
      .from(paymentMethods)
      .where(
        and(
          eq(paymentMethods.companyId, companyId),
          eq(paymentMethods.customerCompanyId, customerCompanyId),
          isNull(paymentMethods.detachedAt),
        ),
      )
      // is_default desc puts the default at the top; created_at desc
      // breaks ties for non-default rows.
      .orderBy(desc(paymentMethods.isDefault), desc(paymentMethods.createdAt));
  }

  /**
   * Read one row by id, tenant-scoped. Returns null on miss.
   *
   * Used by the service layer to validate ownership before flipping
   * default / detaching / charging-with-saved-card.
   */
  async getById(
    companyId: string,
    paymentMethodId: string,
  ): Promise<SavedPaymentMethod | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(paymentMethodId, "paymentMethodId");

    const [row] = await db
      .select()
      .from(paymentMethods)
      .where(
        and(
          eq(paymentMethods.companyId, companyId),
          eq(paymentMethods.id, paymentMethodId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Set one card as the active default for its (tenant, customer-company).
   *
   * Atomic two-step under the caller's transaction:
   *   1. clear `is_default` on every active row for the same
   *      (companyId, customerCompanyId)
   *   2. set `is_default = true` on the target row
   *
   * The partial unique index `payment_methods_one_default_per_customer`
   * enforces correctness at the DB level — a missed step (e.g., two
   * rows ending up flagged) would surface as SQLSTATE 23505 rather
   * than corrupt state.
   *
   * Throws on:
   *   - row not found / cross-tenant
   *   - target row is detached (cannot default a removed card)
   */
  async setDefault(
    tx: any,
    companyId: string,
    paymentMethodId: string,
  ): Promise<SavedPaymentMethod> {
    this.assertCompanyId(companyId);
    this.validateUUID(paymentMethodId, "paymentMethodId");

    const [target] = await tx
      .select()
      .from(paymentMethods)
      .where(
        and(
          eq(paymentMethods.companyId, companyId),
          eq(paymentMethods.id, paymentMethodId),
        ),
      )
      .limit(1);
    if (!target) {
      throw this.notFoundError("Payment method");
    }
    if (target.detachedAt) {
      throw this.validationError(
        "Cannot set a detached payment method as default",
      );
    }

    // 1. Clear default on every active row for this (tenant, customer).
    await tx
      .update(paymentMethods)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(paymentMethods.companyId, companyId),
          eq(paymentMethods.customerCompanyId, target.customerCompanyId),
          eq(paymentMethods.isDefault, true),
          isNull(paymentMethods.detachedAt),
        ),
      );

    // 2. Set default on the target.
    const [updated] = await tx
      .update(paymentMethods)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(
        and(
          eq(paymentMethods.companyId, companyId),
          eq(paymentMethods.id, paymentMethodId),
        ),
      )
      .returning();
    return updated;
  }

  /**
   * Soft-delete: stamp `detached_at` + `detached_by_contact_id` +
   * `detach_reason`. Provider-side detach must be performed by the
   * service layer BEFORE calling this; the repo only persists the
   * local bookkeeping.
   *
   * Idempotent — calling twice on the same row keeps the original
   * `detached_at` timestamp (we don't overwrite). Returns the row in
   * either case.
   *
   * Also clears `is_default` so the partial unique index doesn't
   * spuriously block the next "set default" call on a different row.
   */
  async markDetached(
    tx: any,
    companyId: string,
    paymentMethodId: string,
    opts?: { byContactId?: string | null; reason?: string | null },
  ): Promise<SavedPaymentMethod> {
    this.assertCompanyId(companyId);
    this.validateUUID(paymentMethodId, "paymentMethodId");

    const [existing] = await tx
      .select()
      .from(paymentMethods)
      .where(
        and(
          eq(paymentMethods.companyId, companyId),
          eq(paymentMethods.id, paymentMethodId),
        ),
      )
      .limit(1);
    if (!existing) {
      throw this.notFoundError("Payment method");
    }
    // Already detached — return as-is. Idempotent.
    if (existing.detachedAt) return existing;

    const [updated] = await tx
      .update(paymentMethods)
      .set({
        detachedAt: new Date(),
        detachedByContactId: opts?.byContactId ?? null,
        detachReason: opts?.reason ?? null,
        // Clear is_default so a subsequent "set new default" call is
        // unblocked by the partial unique index.
        isDefault: false,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(paymentMethods.companyId, companyId),
          eq(paymentMethods.id, paymentMethodId),
        ),
      )
      .returning();
    return updated;
  }

  /**
   * 2026-05-03 PR C — saved-card management.
   *
   * Refresh the mirrored card metadata for a row located by the
   * provider's PaymentMethod id. Fired by the
   * `payment_method.updated` webhook (notably the Stripe Card Updater
   * service refreshing exp dates / last4 when a card brand re-issues).
   *
   * No-op semantics:
   *   - Row not found → returns null (idempotent: a webhook for a PM
   *     we never saved is logged + ignored at the service layer).
   *   - Patch fields with `null` are SKIPPED, not written. We don't
   *     overwrite a known good value with the absent fields a
   *     provider event might omit.
   *
   * Tenant-scoped: caller passes the tenant id from the customer-
   * companies lookup performed at the service layer (the webhook
   * doesn't carry tenant context directly — only the provider PM id).
   */
  async updateCardMetadata(
    tx: any,
    companyId: string,
    providerSource: string,
    providerPaymentMethodId: string,
    patch: {
      cardBrand?: string | null;
      cardLast4?: string | null;
      cardExpMonth?: number | null;
      cardExpYear?: number | null;
      cardFunding?: string | null;
      cardCountry?: string | null;
    },
  ): Promise<SavedPaymentMethod | null> {
    this.assertCompanyId(companyId);
    if (!providerPaymentMethodId) {
      throw this.validationError("providerPaymentMethodId is required");
    }
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.cardBrand) update.cardBrand = patch.cardBrand;
    if (patch.cardLast4) update.cardLast4 = patch.cardLast4;
    if (
      Number.isInteger(patch.cardExpMonth) &&
      (patch.cardExpMonth as number) >= 1 &&
      (patch.cardExpMonth as number) <= 12
    ) {
      update.cardExpMonth = patch.cardExpMonth;
    }
    if (
      Number.isInteger(patch.cardExpYear) &&
      (patch.cardExpYear as number) >= 2000
    ) {
      update.cardExpYear = patch.cardExpYear;
    }
    if (patch.cardFunding !== undefined && patch.cardFunding !== null) {
      update.cardFunding = patch.cardFunding;
    }
    if (patch.cardCountry !== undefined && patch.cardCountry !== null) {
      update.cardCountry = patch.cardCountry;
    }
    // Nothing to actually patch beyond `updatedAt` → still execute so
    // the row's `updatedAt` reflects the webhook delivery time, but
    // the SET list will be just `updatedAt`.

    const [updated] = await tx
      .update(paymentMethods)
      .set(update)
      .where(
        and(
          eq(paymentMethods.companyId, companyId),
          eq(paymentMethods.providerSource, providerSource),
          eq(paymentMethods.providerPaymentMethodId, providerPaymentMethodId),
        ),
      )
      .returning();
    return updated ?? null;
  }

  /**
   * 2026-05-03 PR C — saved-card management.
   *
   * Read the active default card for a (tenant, customer-company),
   * or null if there isn't one. Used by the portal Dashboard "Default
   * card on file" hook + future PR-D "Pay with saved card" flows.
   */
  async getActiveDefault(
    companyId: string,
    customerCompanyId: string,
  ): Promise<SavedPaymentMethod | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(customerCompanyId, "customerCompanyId");

    const [row] = await db
      .select()
      .from(paymentMethods)
      .where(
        and(
          eq(paymentMethods.companyId, companyId),
          eq(paymentMethods.customerCompanyId, customerCompanyId),
          eq(paymentMethods.isDefault, true),
          isNull(paymentMethods.detachedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }
}

export const paymentMethodsRepository = new PaymentMethodsRepository();
