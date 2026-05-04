/**
 * Payment Provider Account Service — tenant onboarding orchestration
 * (PR 2, 2026-05-03).
 *
 * Owns "create-or-get a connected merchant account for this tenant"
 * and the related onboarding-link / state-sync primitives. Provider-
 * neutral by design — every Stripe-specific concern stays inside
 * `stripeAdapter.ts`. Routes call this service; this service calls the
 * adapter and persists state via `paymentProviderAccountsRepository`.
 *
 * Responsibilities (and the boundaries they respect):
 *   * `getOrCreateAccount`      → row-locked first-touch; mints provider
 *                                  account on first call, returns the
 *                                  same row on subsequent calls.
 *   * `createOnboardingLink`    → ensures account exists, then asks
 *                                  the adapter for a one-time URL.
 *   * `retrieveAndSyncAccount`  → authoritative pull from the provider,
 *                                  normalised + persisted via the
 *                                  status-rule helper below.
 *   * `getActiveAccount`        → the single "is this tenant ready
 *                                  to collect?" question every other
 *                                  payment flow needs to ask.
 *   * `markAccountStatus`       → manual transitions only. The webhook
 *                                  handler routes through this for the
 *                                  `account.updated` lifecycle.
 *   * `applyAccountUpdate`      → webhook integration point. Walks
 *                                  the row by `providerAccountId`,
 *                                  upserts if missing, applies the
 *                                  same normalisation as
 *                                  `retrieveAndSyncAccount`.
 *
 * NOT in scope (later PRs):
 *   * Onboarding UI, settings page wiring (PR 3).
 *   * Payouts / disputes lifecycle (PR 4 / PR 5).
 *
 * Idempotency contract (mirrors `customerCompanyPaymentService.
 * resolveOrCreateProviderCustomer`):
 *   1. Read the row by `(companyId, provider)`. If `providerAccountId`
 *      is set → return cached. No SDK call.
 *   2. Open a transaction, lock the row (or insert it locked), re-read.
 *      Concurrent caller may have minted the provider account — return
 *      that without a SDK call.
 *   3. Otherwise call `provider.createAccount(...)` and persist the
 *      result inside the same transaction. The DB unique index
 *      `payment_provider_accounts_company_provider_uq` is the
 *      belt-and-suspenders against lock leakage.
 *
 * Concurrency safety:
 *   * `SELECT ... FOR UPDATE` on the (companyId, provider) row blocks
 *     a second concurrent `getOrCreateAccount` until the first either
 *     completes or rolls back.
 *   * The `payment_provider_accounts_company_provider_uq` partial
 *     unique index in PR1's migration enforces "one row per (tenant,
 *     provider)" at the DB level even if locking ever misbehaves.
 */

import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  companies as companiesTable,
  paymentProviderAccounts as paymentProviderAccountsTable,
  paymentProviderAccountStatusEnum,
  paymentProviderEnum,
} from "@shared/schema";
import type {
  PaymentProviderAccount,
  PaymentProviderAccountStatus,
} from "@shared/schema";
import { createError } from "../../middleware/errorHandler";
import { paymentProviderAccountsRepository } from "../../storage/paymentProviderAccounts";
import { resolveById, resolveForCompanyAsync } from "./providers/resolver";
import type {
  OnboardingLink,
  PaymentProvider,
  ProviderAccountState,
  ProviderId,
} from "./providers/types";

/** Default provider used when `companies.payment_provider` is NULL. */
const DEFAULT_PROVIDER: ProviderId = "stripe";

// ============================================================================
// Status normalisation
// ============================================================================

/**
 * Provider-neutral mapping of (chargesEnabled / payoutsEnabled /
 * detailsSubmitted / disabledReason) → our local lifecycle enum.
 *
 * Rules in priority order (first match wins):
 *
 *   1. `disabledReason` non-null → `disabled`
 *      (Provider has actively shut the account off; remediation may
 *      or may not be possible.)
 *   2. `!detailsSubmitted` → `pending`
 *      (Tenant hasn't finished the onboarding form.)
 *   3. `!chargesEnabled` → `restricted`
 *      (Form submitted but provider hasn't unlocked charges; usually
 *      means an `eventually_due` requirement is now `currently_due`.)
 *   4. `chargesEnabled && payoutsEnabled` → `active`
 *      (Fully onboarded — charges flow + payouts flow both green.)
 *   5. Else (`chargesEnabled && !payoutsEnabled`) → `restricted`
 *      (Can take cards, can't be paid out yet — most often an
 *      external_account verification that the tenant hasn't done.)
 *
 * Exported so the webhook applier and the retrieve-sync flow share one
 * source of truth.
 */
export function normalizeAccountStatus(input: {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  disabledReason: string | null;
}): PaymentProviderAccountStatus {
  if (input.disabledReason) return "disabled";
  if (!input.detailsSubmitted) return "pending";
  if (!input.chargesEnabled) return "restricted";
  if (input.chargesEnabled && input.payoutsEnabled) return "active";
  return "restricted";
}

// ============================================================================
// Provider resolution
// ============================================================================

/**
 * Resolve "which provider should this tenant onboard with?".
 *
 * Reads `companies.payment_provider` via the async resolver; falls
 * back to "stripe" when null. Returns the adapter id alongside the
 * adapter so callers can persist `provider` on the row without
 * special-casing.
 */
async function resolveTenantProvider(
  companyId: string,
): Promise<{ providerId: ProviderId; provider: PaymentProvider }> {
  const provider = await resolveForCompanyAsync(companyId);
  return { providerId: provider.id, provider };
}

/** Throws 501 if the resolved adapter doesn't implement onboarding. */
function assertOnboardingCapable(provider: PaymentProvider): void {
  if (
    typeof provider.createAccount !== "function" ||
    typeof provider.createAccountLink !== "function" ||
    typeof provider.retrieveAccount !== "function"
  ) {
    throw createError(
      501,
      `Provider "${provider.id}" does not support tenant onboarding`,
    );
  }
}

// ============================================================================
// Tenant context helpers
// ============================================================================

interface TenantSnapshot {
  country: string | null;
  email: string | null;
  businessName: string | null;
}

async function loadTenantSnapshot(companyId: string): Promise<TenantSnapshot> {
  const [row] = await db
    .select({
      // Use province_state as a degenerate signal — Stripe Connect
      // requires `country` (ISO-3166-1 alpha-2). The
      // `companies.address` block holds province, not country, so for
      // PR2 we leave `country` null and require the route to pass it
      // explicitly. PR3's settings UI surfaces a country picker.
      email: companiesTable.email,
      name: companiesTable.name,
    })
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId))
    .limit(1);
  if (!row) {
    throw createError(404, "Company not found");
  }
  return {
    country: null,
    email: row.email ?? null,
    businessName: row.name ?? null,
  };
}

// ============================================================================
// Main service surface
// ============================================================================

export interface CreateProviderAccountInput {
  /** Required ISO 3166-1 alpha-2 (e.g. "CA", "US"). */
  country: string;
}

/**
 * Idempotent get-or-create. Returns the persisted row in either case.
 * `created: true` only when this call minted the provider account.
 */
export interface GetOrCreateAccountResult {
  account: PaymentProviderAccount;
  created: boolean;
  providerId: ProviderId;
}

/**
 * Returns the active provider account for a tenant if one exists, else
 * null. Caller is the one and only authority on "is this tenant ready
 * to collect?".
 *
 * "Active" here means BOTH the persisted enum status is `active` AND
 * `charges_enabled = true`. We require the boolean separately because
 * the enum can lag behind capability flips by milliseconds during
 * webhook processing — defence in depth against stale local state.
 */
export async function getActiveAccount(
  companyId: string,
): Promise<PaymentProviderAccount | null> {
  if (!companyId) {
    throw createError(400, "companyId is required");
  }
  const { providerId } = await resolveTenantProvider(companyId);
  const row = await paymentProviderAccountsRepository.getByCompanyAndProvider(
    companyId,
    providerId,
  );
  if (!row) return null;
  if (row.status !== "active") return null;
  if (!row.chargesEnabled) return null;
  return row;
}

/**
 * Get the existing provider account for the tenant, or create a new
 * `not_started` row (no provider call) if none exists. Used by the
 * `GET /api/payments/account` route.
 *
 * Distinct from `getOrCreateAccount` (which DOES call the provider):
 * this method never makes an SDK call — it only mirrors current
 * persisted state. The route layer needs this to render "Get started"
 * vs. "Continue onboarding" without billing the provider for a
 * speculative `accounts.create`.
 */
export async function getAccountSnapshot(
  companyId: string,
): Promise<{ account: PaymentProviderAccount | null; providerId: ProviderId }> {
  if (!companyId) {
    throw createError(400, "companyId is required");
  }
  const { providerId } = await resolveTenantProvider(companyId);
  const account =
    await paymentProviderAccountsRepository.getByCompanyAndProvider(
      companyId,
      providerId,
    );
  return { account, providerId };
}

/**
 * The canonical create-or-get. On first call:
 *   1. Resolve the provider for this tenant.
 *   2. Open a transaction. Try to load the (companyId, provider) row;
 *      if it exists with `providerAccountId` set, return it immediately.
 *   3. If the row is missing or `providerAccountId` is null:
 *      a. Insert the row in `not_started` if needed.
 *      b. Lock it via `SELECT ... FOR UPDATE`.
 *      c. Re-read. If a concurrent caller minted in the gap, return.
 *      d. Otherwise call `provider.createAccount(...)` and persist
 *         the returned `providerAccountId` + initial state on the row.
 *
 * Throws 501 if the resolved provider doesn't implement onboarding.
 */
export async function getOrCreateAccount(
  companyId: string,
  input: CreateProviderAccountInput,
): Promise<GetOrCreateAccountResult> {
  if (!companyId) {
    throw createError(400, "companyId is required");
  }
  if (!input.country || input.country.length !== 2) {
    throw createError(
      400,
      "country (ISO 3166-1 alpha-2, e.g. 'CA') is required",
    );
  }

  const { providerId, provider } = await resolveTenantProvider(companyId);
  assertOnboardingCapable(provider);

  // Fast path — already minted.
  const existing = await paymentProviderAccountsRepository.getByCompanyAndProvider(
    companyId,
    providerId,
  );
  if (existing && existing.providerAccountId) {
    return { account: existing, created: false, providerId };
  }

  return await db.transaction(async (tx) => {
    let row = existing;

    if (!row) {
      // No row yet — insert a `not_started` placeholder. Race-safe
      // because the unique index `(company_id, provider)` will collide
      // on a concurrent insert; we catch the error and re-read.
      try {
        row = await paymentProviderAccountsRepository.insertAccount(tx, {
          companyId,
          provider: providerId,
          status: "not_started",
          country: input.country,
        });
      } catch (err: unknown) {
        const e = err as { code?: string; cause?: { code?: string } };
        if (e?.code !== "23505" && e?.cause?.code !== "23505") {
          throw err;
        }
        // Concurrent insert won the race; re-read.
        const [reread] = await tx
          .select()
          .from(paymentProviderAccountsTable)
          .where(
            and(
              eq(paymentProviderAccountsTable.companyId, companyId),
              eq(paymentProviderAccountsTable.provider, providerId),
            ),
          )
          .limit(1);
        row = reread;
      }
    }

    if (!row) {
      throw createError(
        500,
        "Failed to load provider account row after insert",
      );
    }

    // Lock the row so a second concurrent caller waits here while we
    // (re)check `providerAccountId` and decide whether to mint.
    const [locked] = await tx
      .select()
      .from(paymentProviderAccountsTable)
      .where(eq(paymentProviderAccountsTable.id, row.id))
      .for("update")
      .limit(1);
    if (!locked) {
      throw createError(500, "Provider account row vanished during lock");
    }
    if (locked.providerAccountId) {
      // Concurrent caller minted while we were waiting on the lock.
      return { account: locked, created: false, providerId };
    }

    // Mint at the provider.
    const tenant = await loadTenantSnapshot(companyId);
    const created = await provider.createAccount!({
      companyId,
      country: input.country,
      email: tenant.email,
      businessName: tenant.businessName,
    });

    // Persist provider id + initial lifecycle snapshot. Status is
    // normalised in case the provider returns a partially-onboarded
    // account on first create (Stripe Express never does — but
    // future providers might).
    const status = normalizeAccountStatus({
      chargesEnabled: created.chargesEnabled,
      payoutsEnabled: created.payoutsEnabled,
      detailsSubmitted: created.detailsSubmitted,
      disabledReason: created.disabledReason,
    });
    const updated =
      await paymentProviderAccountsRepository.updateAccountState(
        tx,
        companyId,
        providerId,
        {
          providerAccountId: created.providerAccountId,
          status,
          chargesEnabled: created.chargesEnabled,
          payoutsEnabled: created.payoutsEnabled,
          detailsSubmitted: created.detailsSubmitted,
          requirementsDue: created.requirementsDue ?? null,
          disabledReason: created.disabledReason,
          country: created.country ?? input.country,
          defaultCurrency: created.defaultCurrency,
        },
      );

    return { account: updated, created: true, providerId };
  });
}

/**
 * Issue a one-time onboarding URL. Ensures the account exists (mints
 * one if needed via `getOrCreateAccount`), then asks the adapter for
 * a fresh `accountLinks.create`-style URL.
 *
 * Returns both the URL and the persisted account so the caller can
 * make a single round-trip on the "Get started" / "Continue
 * onboarding" path.
 */
export async function createOnboardingLink(
  companyId: string,
  input: {
    country: string;
    refreshUrl: string;
    returnUrl: string;
  },
): Promise<{ link: OnboardingLink; account: PaymentProviderAccount }> {
  const { account, providerId } = await getOrCreateAccount(companyId, {
    country: input.country,
  });
  if (!account.providerAccountId) {
    throw createError(
      500,
      "Provider account exists but has no providerAccountId — cannot mint link",
    );
  }
  const provider = resolveById(providerId);
  if (!provider) {
    throw createError(500, `No adapter registered for provider '${providerId}'`);
  }
  assertOnboardingCapable(provider);

  const link = await provider.createAccountLink!({
    providerAccountId: account.providerAccountId,
    refreshUrl: input.refreshUrl,
    returnUrl: input.returnUrl,
  });
  return { link, account };
}

/**
 * Authoritative refresh from the provider. Fetches the latest state
 * via `provider.retrieveAccount(...)` and stamps the local row.
 *
 * Used by:
 *   * `POST /api/payments/account/refresh` — explicit operator pull.
 *   * The `account.updated` webhook handler when the event payload is
 *     ambiguous and we want fresh authoritative state.
 *
 * Throws 404 when the local row doesn't exist; the route layer
 * surfaces that as "no account onboarded yet" without auto-minting.
 */
export async function retrieveAndSyncAccount(
  companyId: string,
): Promise<PaymentProviderAccount> {
  if (!companyId) {
    throw createError(400, "companyId is required");
  }
  const { providerId, provider } = await resolveTenantProvider(companyId);
  assertOnboardingCapable(provider);

  const existing = await paymentProviderAccountsRepository.getByCompanyAndProvider(
    companyId,
    providerId,
  );
  if (!existing) {
    throw createError(404, "No provider account onboarded for this tenant");
  }
  if (!existing.providerAccountId) {
    // We have a `not_started` row but no provider account. Nothing to
    // refresh — return as-is rather than masquerade a no-op as a
    // successful sync.
    return existing;
  }

  const fresh = await provider.retrieveAccount!({
    providerAccountId: existing.providerAccountId,
  });
  const status = normalizeAccountStatus({
    chargesEnabled: fresh.chargesEnabled,
    payoutsEnabled: fresh.payoutsEnabled,
    detailsSubmitted: fresh.detailsSubmitted,
    disabledReason: fresh.disabledReason,
  });
  return await db.transaction(async (tx) => {
    return paymentProviderAccountsRepository.updateAccountState(
      tx,
      companyId,
      providerId,
      {
        status,
        chargesEnabled: fresh.chargesEnabled,
        payoutsEnabled: fresh.payoutsEnabled,
        detailsSubmitted: fresh.detailsSubmitted,
        requirementsDue: fresh.requirementsDue ?? null,
        disabledReason: fresh.disabledReason,
        country: fresh.country,
        defaultCurrency: fresh.defaultCurrency,
      },
    );
  });
}

/**
 * Manually transition an account to a new status. Used by ops /
 * service-internal flows that need a forced state without re-reading
 * the provider (e.g. webhook handlers that have authoritative state
 * inline).
 *
 * Validates against `paymentProviderAccountStatusEnum` so a typo can't
 * write an unknown enum value.
 */
export async function markAccountStatus(
  companyId: string,
  status: PaymentProviderAccountStatus,
): Promise<PaymentProviderAccount> {
  if (!companyId) {
    throw createError(400, "companyId is required");
  }
  if (
    !(paymentProviderAccountStatusEnum as readonly string[]).includes(status)
  ) {
    throw createError(400, `Invalid status '${status}'`);
  }
  const { providerId } = await resolveTenantProvider(companyId);
  return await db.transaction(async (tx) => {
    return paymentProviderAccountsRepository.updateAccountState(
      tx,
      companyId,
      providerId,
      { status },
    );
  });
}

/**
 * Webhook integration point. The `account.updated` handler arrives
 * with the full lifecycle payload + a `(provider, providerAccountId)`
 * pair. This function:
 *   1. Looks up the row by (provider, providerAccountId) — NOT
 *      tenant-scoped, because the webhook does not know companyId.
 *   2. If missing, creates a `not_started` row stamped with the
 *      provider id from the event so it's never orphaned.
 *      (Should be rare — local minting always precedes the webhook —
 *      but Stripe-dashboard-created accounts are a real path.)
 *   3. Stamps the lifecycle snapshot via the canonical normalisation
 *      and the same repo update path `retrieveAndSyncAccount` uses.
 *
 * Returns the persisted row.
 *
 * Idempotency: the application service is responsible for `(provider,
 * providerEventId)` dedupe via the `payments_provider_event_id_uq`
 * pattern. This service treats a duplicate apply as a no-op write
 * because the lifecycle snapshot lands at the same final state.
 */
export async function applyAccountUpdate(input: {
  providerId: ProviderId;
  providerAccountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirementsDue: unknown;
  disabledReason: string | null;
  country: string | null;
  defaultCurrency: string | null;
}): Promise<PaymentProviderAccount> {
  if (!(paymentProviderEnum as readonly string[]).includes(input.providerId)) {
    throw createError(400, `Unknown provider id '${input.providerId}'`);
  }

  const status = normalizeAccountStatus({
    chargesEnabled: input.chargesEnabled,
    payoutsEnabled: input.payoutsEnabled,
    detailsSubmitted: input.detailsSubmitted,
    disabledReason: input.disabledReason,
  });

  return await db.transaction(async (tx) => {
    // Resolve the tenant by (provider, providerAccountId). The webhook
    // never carries `companyId` — it's the local row that does.
    let row =
      await paymentProviderAccountsRepository.getByProviderAndProviderAccountId(
        input.providerId,
        input.providerAccountId,
      );
    if (!row) {
      // Tenant unknown to us. Webhook arrives but no local row exists.
      // PR2 deliberately does NOT auto-create here:
      //   * Stripe-dashboard-minted accounts fall outside the
      //     in-app onboarding contract.
      //   * Inserting a tenant-less row would violate
      //     `companies.payment_provider` -> `payment_provider_accounts`
      //     ownership.
      // Surface as 404 so the application service classifies the
      // webhook outcome as `config_error` (200 ACK + ops log).
      throw createError(
        404,
        `No provider account row for ${input.providerId}:${input.providerAccountId}`,
      );
    }

    // Lock then update — keeps the read-then-write pair atomic
    // against a racing `retrieveAndSyncAccount`.
    const [locked] = await tx
      .select()
      .from(paymentProviderAccountsTable)
      .where(eq(paymentProviderAccountsTable.id, row.id))
      .for("update")
      .limit(1);
    if (!locked) {
      throw createError(500, "Provider account row vanished during lock");
    }
    return paymentProviderAccountsRepository.updateAccountState(
      tx,
      locked.companyId,
      locked.provider,
      {
        status,
        chargesEnabled: input.chargesEnabled,
        payoutsEnabled: input.payoutsEnabled,
        detailsSubmitted: input.detailsSubmitted,
        requirementsDue: input.requirementsDue ?? null,
        disabledReason: input.disabledReason,
        country: input.country,
        defaultCurrency: input.defaultCurrency,
      },
    );
  });
}

export const paymentProviderAccountService = {
  normalizeAccountStatus,
  getActiveAccount,
  getAccountSnapshot,
  getOrCreateAccount,
  createOnboardingLink,
  retrieveAndSyncAccount,
  markAccountStatus,
  applyAccountUpdate,
};
