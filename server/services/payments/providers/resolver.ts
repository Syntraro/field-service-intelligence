/**
 * Provider resolver — single source of truth for "which provider runs
 * this flow".
 *
 * Two surfaces:
 *
 *   1. `resolveForCompany(companyId)` — SYNC, used by the hot-path
 *      checkout / refund / saved-card flows. Returns the Stripe adapter
 *      today. Kept sync so the existing call sites (8+ across the
 *      payment application service) don't need to await — pre-PR2
 *      behaviour preserved bit-identically.
 *
 *   2. `resolveForCompanyAsync(companyId)` — ASYNC, reads
 *      `companies.payment_provider` and dispatches via `resolveById`.
 *      Used by PR2's tenant-payments onboarding flow. Falls back to
 *      `"stripe"` when the column is NULL (tenant hasn't picked yet).
 *
 *   3. `resolveById(id)` — pure dispatch by adapter id. Used by the
 *      webhook router (`/api/webhooks/:provider`) to map URL segment
 *      to adapter without a DB read.
 *
 *   4. `resolveForProviderSource(providerSource)` — used by the refund
 *      flow to decide whether to move money at a provider or only
 *      write a local ledger entry, based on `payments.provider_source`.
 *
 * When a second adapter ships:
 *   * `resolveById` gets a new branch.
 *   * `paymentProviderEnum` gets a new entry.
 *   * `resolveForCompanyAsync` already routes correctly.
 *   * The sync `resolveForCompany` will need an audit + likely become
 *     async itself; that audit is deferred until a second adapter
 *     actually exists.
 */

import { eq } from "drizzle-orm";
import { db } from "../../../db";
import { companies, paymentProviderEnum } from "@shared/schema";
import { stripeAdapter } from "./stripeAdapter";
import type { PaymentProvider, ProviderId } from "./types";

/**
 * SYNC resolver — returns the active provider for the hot-path
 * checkout / refund / saved-card flows. Today only Stripe is shippable;
 * adding a second adapter requires both this function and every caller
 * to be async-converted (deferred until a second adapter ships).
 */
export function resolveForCompany(_companyId: string): PaymentProvider {
  return stripeAdapter;
}

/**
 * ASYNC resolver — reads `companies.payment_provider` for the given
 * tenant and dispatches via `resolveById`. Falls back to `"stripe"`
 * when the column is NULL (tenant hasn't onboarded yet).
 *
 * Used by:
 *   * `paymentProviderAccountService` (PR2) for onboarding.
 *   * Future webhook handlers that need to know "which adapter owns
 *     this tenant?" without hitting the SDK.
 *
 * Throws 400 when the column carries a value not in
 * `paymentProviderEnum` — defence in depth against schema drift /
 * forgotten enum extension.
 */
export async function resolveForCompanyAsync(
  companyId: string,
): Promise<PaymentProvider> {
  if (!companyId) {
    throw new Error("companyId is required");
  }
  const [row] = await db
    .select({ paymentProvider: companies.paymentProvider })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if (!row) {
    throw new Error(`Company ${companyId} not found`);
  }
  const id: string = row.paymentProvider ?? "stripe";
  if (!(paymentProviderEnum as readonly string[]).includes(id)) {
    throw new Error(
      `Unknown payment_provider '${id}' on company ${companyId}; expected one of: ${paymentProviderEnum.join(", ")}`,
    );
  }
  const provider = resolveById(id);
  if (!provider) {
    // Should be unreachable thanks to the enum check above; defence
    // in depth in case `resolveById` and `paymentProviderEnum` ever
    // drift apart.
    throw new Error(`No adapter registered for provider '${id}'`);
  }
  return provider;
}

/**
 * Resolve a provider adapter by its id. Used by the webhook dispatcher:
 * `POST /api/webhooks/:provider` routes to the adapter whose id matches
 * the URL segment. Returns `null` for unknown ids so the route can return
 * 404 cleanly.
 */
export function resolveById(id: string): PaymentProvider | null {
  if (id === "stripe") return stripeAdapter;
  return null;
}

/**
 * Resolve the provider that owns a payment row based on its
 * `providerSource`. Used by the refund flow to decide whether to move
 * money at a provider or only write a local ledger entry.
 *
 * Returns `null` for `'manual'` (no provider to call) and throws for
 * sources we do not yet have an adapter for — today, QBO-owned rows
 * cannot be refunded through this flow (they flow through the QBO sync
 * service's own lifecycle). Surfacing the "not supported" case as an
 * explicit 409 beats silently writing an orphan ledger row.
 */
export function resolveForProviderSource(
  providerSource: string | null | undefined,
): { provider: PaymentProvider } | { manual: true } | { unsupported: true; providerSource: string } {
  if (!providerSource || providerSource === "manual") return { manual: true };
  if (providerSource === "stripe") return { provider: stripeAdapter };
  return { unsupported: true, providerSource };
}

export type { PaymentProvider, ProviderId };
