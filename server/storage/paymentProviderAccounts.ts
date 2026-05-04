/**
 * Payment Provider Accounts Repository — tenant onboarding data layer
 * (PR 2, 2026-05-03).
 *
 * Pure data access for the `payment_provider_accounts` table from
 * `migrations/2026_05_03_tenant_payment_provider_foundation.sql`. One
 * row per (tenant, provider). Holds the connected-account lifecycle
 * state (`charges_enabled`, `payouts_enabled`, `details_submitted`,
 * `requirements_due`, `disabled_reason`, `country`, `default_currency`)
 * + the local-row status enum (`not_started` / `pending` / `active` /
 * `restricted` / `disabled`).
 *
 * Provider-neutral by design — this file MUST NOT import the Stripe
 * SDK or any provider-specific surface. Provider concerns (creating
 * accounts, requesting onboarding links, retrieving authoritative
 * state) live behind the `PaymentProvider` interface and its
 * adapters; this repo only persists / reads the snapshots those
 * adapters return.
 *
 * No business logic here either:
 *   * status normalization (charges/payouts/disabled → enum) lives in
 *     `paymentProviderAccountService.normalizeAccountStatus`.
 *   * provider lifecycle calls live in the adapter.
 *   * authorization / tenant-scoping middleware lives in the route layer.
 *
 * Tenant scoping: every read/write requires `companyId`. Cross-tenant
 * lookups are not exposed (a future ops-side reconciliation job that
 * needs them would call a dedicated method on a separate ops repo).
 *
 * The single exception is `getByProviderAndProviderAccountId` — the
 * webhook handler arrives with only `(provider, providerAccountId)`
 * and needs to find the owning row to discover the `companyId`. The
 * row already has `companyId` denormalised; the handler then falls
 * back into tenant-scoped writes for everything else.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { paymentProviderAccounts } from "@shared/schema";
import type {
  InsertPaymentProviderAccount,
  PaymentProviderAccount,
  PaymentProviderAccountStatus,
} from "@shared/schema";
import { BaseRepository } from "./base";

/** Subset writable by the canonical "create-or-get" flow at first touch. */
export interface CreateProviderAccountInput {
  companyId: string;
  provider: string;
  providerAccountId?: string | null;
  status?: PaymentProviderAccountStatus;
  country?: string | null;
  defaultCurrency?: string | null;
}

/**
 * Subset writable by `retrieveAndSyncAccount` / webhook handlers when
 * refreshing the lifecycle snapshot.
 *
 * Every field is optional because partial updates are valid (e.g. the
 * `account.updated` webhook may carry only `requirements` changes
 * with capabilities unchanged). The repo always sets `updatedAt`.
 */
export interface UpdateProviderAccountStateInput {
  status?: PaymentProviderAccountStatus;
  providerAccountId?: string | null;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  detailsSubmitted?: boolean;
  requirementsDue?: unknown;
  disabledReason?: string | null;
  country?: string | null;
  defaultCurrency?: string | null;
}

export class PaymentProviderAccountsRepository extends BaseRepository {
  /**
   * Tenant-scoped lookup by (companyId, provider). Returns null when
   * the row doesn't exist; the service layer treats null as "not yet
   * started" and creates the row inside the transaction-locked
   * get-or-create path.
   */
  async getByCompanyAndProvider(
    companyId: string,
    provider: string,
  ): Promise<PaymentProviderAccount | null> {
    this.assertCompanyId(companyId);
    if (!provider) {
      throw this.validationError("provider is required");
    }
    const [row] = await db
      .select()
      .from(paymentProviderAccounts)
      .where(
        and(
          eq(paymentProviderAccounts.companyId, companyId),
          eq(paymentProviderAccounts.provider, provider),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Webhook-handler lookup. Resolves a row by the provider's own
   * opaque account id (Stripe `acct_...`) — the only context the
   * incoming `account.updated` event carries. Includes `provider` in
   * the WHERE so two adapters with overlapping id formats don't
   * cross-talk. Returns null when no row matches; the webhook
   * handler treats null as "create the row idempotently" because
   * the platform may have minted the account out of band.
   */
  async getByProviderAndProviderAccountId(
    provider: string,
    providerAccountId: string,
  ): Promise<PaymentProviderAccount | null> {
    if (!provider) {
      throw this.validationError("provider is required");
    }
    if (!providerAccountId) {
      throw this.validationError("providerAccountId is required");
    }
    const [row] = await db
      .select()
      .from(paymentProviderAccounts)
      .where(
        and(
          eq(paymentProviderAccounts.provider, provider),
          eq(paymentProviderAccounts.providerAccountId, providerAccountId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * List every provider account for a tenant. Used by the
   * `GET /api/payments/account` route. Tiny set — at most one row
   * per provider — so no pagination.
   */
  async listByCompany(companyId: string): Promise<PaymentProviderAccount[]> {
    this.assertCompanyId(companyId);
    return db
      .select()
      .from(paymentProviderAccounts)
      .where(eq(paymentProviderAccounts.companyId, companyId));
  }

  /**
   * Insert one provider-account row. Tx-aware so the service layer
   * can lock + insert atomically. The DB unique index
   * `payment_provider_accounts_company_provider_uq` is the
   * belt-and-suspenders against duplicate-create races.
   */
  async insertAccount(
    tx: any,
    data: CreateProviderAccountInput,
  ): Promise<PaymentProviderAccount> {
    this.assertCompanyId(data.companyId);
    if (!data.provider) {
      throw this.validationError("provider is required");
    }
    const insertable: InsertPaymentProviderAccount = {
      companyId: data.companyId,
      provider: data.provider,
      providerAccountId: data.providerAccountId ?? null,
      status: data.status ?? "not_started",
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      requirementsDue: null,
      disabledReason: null,
      country: data.country ?? null,
      defaultCurrency: data.defaultCurrency ?? null,
    };
    const [row] = await tx
      .insert(paymentProviderAccounts)
      .values(insertable)
      .returning();
    return row;
  }

  /**
   * Update the lifecycle-state subset for a given (companyId, provider)
   * row. Returns the updated row. Tx-aware. Only fields explicitly
   * present in `patch` are written — undefined fields are left intact.
   *
   * Throws 404 when the row doesn't exist; the service layer guards
   * against that by always going through `getOrCreateAccount` first.
   */
  async updateAccountState(
    tx: any,
    companyId: string,
    provider: string,
    patch: UpdateProviderAccountStateInput,
  ): Promise<PaymentProviderAccount> {
    this.assertCompanyId(companyId);
    if (!provider) {
      throw this.validationError("provider is required");
    }
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.providerAccountId !== undefined) {
      set.providerAccountId = patch.providerAccountId;
    }
    if (patch.chargesEnabled !== undefined) {
      set.chargesEnabled = patch.chargesEnabled;
    }
    if (patch.payoutsEnabled !== undefined) {
      set.payoutsEnabled = patch.payoutsEnabled;
    }
    if (patch.detailsSubmitted !== undefined) {
      set.detailsSubmitted = patch.detailsSubmitted;
    }
    if (patch.requirementsDue !== undefined) {
      set.requirementsDue = patch.requirementsDue;
    }
    if (patch.disabledReason !== undefined) {
      set.disabledReason = patch.disabledReason;
    }
    if (patch.country !== undefined) set.country = patch.country;
    if (patch.defaultCurrency !== undefined) {
      set.defaultCurrency = patch.defaultCurrency;
    }

    const [row] = await tx
      .update(paymentProviderAccounts)
      .set(set)
      .where(
        and(
          eq(paymentProviderAccounts.companyId, companyId),
          eq(paymentProviderAccounts.provider, provider),
        ),
      )
      .returning();
    if (!row) {
      throw this.notFoundError("Provider account");
    }
    return row;
  }
}

export const paymentProviderAccountsRepository =
  new PaymentProviderAccountsRepository();
