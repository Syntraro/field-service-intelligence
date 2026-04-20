/**
 * Portal URL helpers for the office UI.
 *
 * Mirrors the server's `server/lib/portalUrls.ts` `buildPortalInvoiceUrl()`.
 * The portal is hosted under the same origin as the office app, so the
 * frontend never needs to know the deployment APP_URL — `window.location.origin`
 * is authoritative.
 */

/** Canonical per-invoice portal link. Requires a valid portal session. */
export function buildPortalInvoiceUrl(invoiceId: string): string {
  return `${window.location.origin}/portal/invoices/${invoiceId}`;
}

/** Portal login URL (starts the magic-link flow client-side). */
export function buildPortalLoginUrl(): string {
  return `${window.location.origin}/portal/login`;
}
