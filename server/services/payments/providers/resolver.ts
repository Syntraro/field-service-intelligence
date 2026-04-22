/**
 * Provider resolver — single source of truth for "which provider runs
 * this flow".
 *
 * Today Stripe is the only active provider. When a second provider is
 * introduced, the expected expansion is:
 *   - `resolveForCompany` reads a new nullable `companies.payment_provider`
 *     column and falls back to Stripe.
 *   - `resolveById` gains a branch.
 * Nothing else in the codebase should need to change.
 */

import { stripeAdapter } from "./stripeAdapter";
import type { PaymentProvider, ProviderId } from "./types";

/**
 * Resolve the provider a given tenant uses for NEW checkouts. Kept as a
 * function (not a constant) so the future tenant-level-config rollout is
 * a one-file change.
 */
export function resolveForCompany(_companyId: string): PaymentProvider {
  return stripeAdapter;
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
