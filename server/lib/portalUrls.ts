/**
 * Portal URL helper (2026-04-19 Phase 12).
 *
 * Single source of truth for resolving the customer-facing portal URL
 * for a given invoice. Used by template-data builders to inject
 * `PAYMENT_URL` into outbound invoice/reminder/receipt emails so
 * customers can land directly on the portal invoice page.
 *
 * Auth model: the portal route is gated by the existing magic-link /
 * session flow. If the customer is not logged in when they click, the
 * portal redirects them through the email-capture sign-in. This helper
 * does NOT mint magic links — those are short-lived and would expire
 * before a customer typically opens an emailed invoice.
 */

const FALLBACK_BASE = "http://localhost:5000";

/** Resolve the configured app base URL. Mirrors `portal.ts` resolution.
 *  2026-05-05: exported so the magic-link route in `portal.ts` can use the
 *  canonical resolver instead of its own buggy local constant. */
export function appBase(): string {
  if (process.env.APP_URL) return process.env.APP_URL;
  if (process.env.BASE_URL) return process.env.BASE_URL;
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }
  return FALLBACK_BASE;
}

/**
 * Build the customer-facing portal invoice URL. The customer hits the
 * authenticated portal route; if no portal session exists, the portal
 * sign-in flow takes over.
 *
 * 2026-05-05: optional `accessToken` param embeds an invoice-scoped
 * access token (see `server/services/portal/invoiceAccessTokens.ts`).
 * Pages presented with `?t=<token>` skip the magic-link sign-in
 * prompt and grant view + pay access to that ONE invoice — clean
 * Pay Invoice email flow with no double-email friction.
 */
export function buildPortalInvoiceUrl(
  invoiceId: string,
  accessToken?: string,
): string {
  if (!invoiceId) return "";
  const base = `${appBase()}/portal/invoices/${encodeURIComponent(invoiceId)}`;
  if (!accessToken) return base;
  return `${base}?t=${encodeURIComponent(accessToken)}`;
}
