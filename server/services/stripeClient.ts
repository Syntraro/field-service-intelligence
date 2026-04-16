import Stripe from "stripe";

/**
 * Canonical Stripe client. Mirrors the `resendClient.ts` shape — single
 * SDK instance behind a factory, fail-closed when required env vars are
 * missing, startup validator that warns-loudly without crashing boot.
 *
 * Env vars:
 *   STRIPE_SECRET_KEY      — server-side secret key (sk_live_... / sk_test_...).
 *   STRIPE_WEBHOOK_SECRET  — signing secret for /api/webhooks/stripe.
 *
 * The client is NOT instantiated until `getStripeClient()` is called so
 * startup doesn't require the keys; they're only required at the moment
 * an actual Stripe call is made. `validateStripeConfig()` during
 * bootstrap surfaces missing keys in the logs so operators see the gap
 * before a user hits a 503.
 */

/**
 * Validate Stripe configuration at startup. Warns loudly — the server
 * boots in all environments, but Stripe endpoints return 503 until
 * required vars are set. Mirrors `validateEmailConfig`.
 */
export function validateStripeConfig(): { valid: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!process.env.STRIPE_SECRET_KEY) missing.push("STRIPE_SECRET_KEY");
  if (!process.env.STRIPE_WEBHOOK_SECRET) missing.push("STRIPE_WEBHOOK_SECRET");

  if (missing.length > 0) {
    console.warn(
      `[Stripe] Missing env vars: ${missing.join(", ")}. ` +
        "In-app card payments and webhook reconciliation will fail until these are set.",
    );
  }
  return { valid: missing.length === 0, missing };
}

let cachedClient: Stripe | null = null;

/**
 * Return a lazily-instantiated Stripe client. Throws if the secret key
 * is not configured — callers are expected to translate that into a 503.
 *
 * Pins an API version so the provider cannot silently shift behavior
 * underneath us. Upgrade the pin deliberately when upgrading the SDK.
 */
export function getStripeClient(): Stripe {
  if (cachedClient) return cachedClient;

  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) {
    throw new Error(
      "STRIPE_SECRET_KEY not configured. Set it in the environment before " +
        "calling any Stripe-backed endpoint.",
    );
  }

  cachedClient = new Stripe(apiKey, {
    // Pin explicitly — SDK v22 supports multiple versions. If the pin
    // is stale, the SDK warns; behavior stays deterministic.
    apiVersion: "2026-03-25.dahlia",
    typescript: true,
    appInfo: {
      name: "Syntraro",
    },
  });
  return cachedClient;
}

/**
 * Return the configured webhook signing secret, or throw. Callers that
 * need to fail-closed on missing config use this at request time so the
 * error surfaces as a 500 on the webhook path (Stripe will then retry,
 * which is the desired behavior when OUR config is broken — operator
 * fixes the env, subsequent retries succeed).
 */
export function getStripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      "STRIPE_WEBHOOK_SECRET not configured. Set it to the signing secret " +
        "from your Stripe webhook endpoint before enabling the webhook.",
    );
  }
  return secret;
}
