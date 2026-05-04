import { Resend } from "resend";

/**
 * Canonical Resend / outbound-email configuration.
 *
 * 2026-04-14 cleanup pass: the legacy `PORTAL_FROM_EMAIL` /
 * `PORTAL_FROM_NAME` env vars are no longer accepted — operators must
 * use the canonical `RESEND_*` variables. One config path, no drift.
 *
 * 2026-05-03 sender-identity refactor: `getResendClient()` now exposes
 * the raw verified sender email + the platform default display name
 * separately, and a `formatFromHeader()` helper composes the final
 * `Display Name <email>` string. Callers that want a per-tenant
 * display name (the canonical pattern used by every send-* function
 * in `emailDispatchService`) build the header per-call via
 * `buildSenderHeaders(tenantId)`. The verified Resend domain stays
 * fixed — only the display name varies. No tenant-owned domains are
 * sent from until per-tenant Resend domain verification is built.
 *
 * Required env:
 *   RESEND_API_KEY       — Resend API key
 *   RESEND_FROM_EMAIL    — Verified sender email (e.g. notifications@yourdomain.com)
 *
 * Optional env:
 *   RESEND_FROM_NAME     — Default display name when no per-call override is given
 *                          (defaults to "Notifications")
 *   RESEND_REPLY_TO      — Platform-level reply-to fallback when no
 *                          per-call replyTo is given. Optional.
 */

/**
 * Validate email sending prerequisites at startup. Warns loudly — the
 * server boots in all environments, but sends will fail until required
 * vars are set.
 */
export function validateEmailConfig(): { valid: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!process.env.RESEND_API_KEY) missing.push("RESEND_API_KEY");
  if (!process.env.RESEND_FROM_EMAIL) missing.push("RESEND_FROM_EMAIL");

  if (missing.length > 0) {
    console.warn(
      `[Email] Missing env vars: ${missing.join(", ")}. ` +
        "Outbound email (invoices, quotes, jobs, portal links) will fail until these are set.",
    );
  }
  return { valid: missing.length === 0, missing };
}

/**
 * Default display name fallback when no tenant name is available.
 * Reads `RESEND_FROM_NAME` lazily so tests can override via
 * `process.env`. */
export function getDefaultFromName(): string {
  return process.env.RESEND_FROM_NAME || "Notifications";
}

/**
 * Compose the final `Display Name <email>` string used in the Resend
 * `from` field. Sanitises the display name by stripping characters
 * that would break RFC 5322 header parsing (`<`, `>`, `\r`, `\n`,
 * `"`). Trims whitespace; falls back to the default platform name
 * when the input is empty after sanitisation.
 */
export function formatFromHeader(displayName: string | null | undefined, fromEmail: string): string {
  const cleaned = (displayName ?? "")
    .replace(/[<>\r\n"]/g, "")
    .trim();
  const safeName = cleaned.length > 0 ? cleaned : getDefaultFromName();
  return `${safeName} <${fromEmail}>`;
}

/**
 * Lightweight email-shape sanity check for caller-supplied reply-to
 * values. Pre-empts a "valid header but garbage address" 500 from
 * Resend. NOT a full RFC 5322 validator — just rejects the obvious
 * bad cases (empty, no `@`, contains whitespace, header-injection
 * characters).
 */
export function isPlausibleEmail(value: string | null | undefined): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (/[<>\r\n",\s]/.test(trimmed)) return false;
  const at = trimmed.indexOf("@");
  if (at < 1 || at === trimmed.length - 1) return false;
  return true;
}

/**
 * Build a Resend client + the verified platform sender email +
 * formatted default-from string. The default-from string is what
 * legacy callers can pass through unchanged when they don't have a
 * tenant id; new callers should use `buildSenderHeaders(tenantId)` in
 * `emailDispatchService` to override the display name per-tenant.
 *
 * Throws if `RESEND_API_KEY` or `RESEND_FROM_EMAIL` is missing.
 */
export async function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY not configured");
  }

  const fromEmail = process.env.RESEND_FROM_EMAIL;
  if (!fromEmail) {
    throw new Error(
      "RESEND_FROM_EMAIL not configured. Set it to a verified Resend sender " +
        "address (e.g. notifications@yourdomain.com). See https://resend.com/domains.",
    );
  }

  return {
    client: new Resend(apiKey),
    /** Raw verified-domain sender email — pass to `formatFromHeader` to
     *  compose the final `from` string. Exposed separately so callers
     *  can vary the display name per-tenant while the address stays
     *  fixed at the verified Resend domain. */
    fromEmail,
    /** Pre-formatted `Default Name <email>` for callers that don't
     *  have a tenant id in scope (rare — used only as a last-resort
     *  fallback). */
    defaultFromHeader: formatFromHeader(getDefaultFromName(), fromEmail),
    /** Platform-level reply-to fallback. Optional. */
    defaultReplyTo: process.env.RESEND_REPLY_TO && isPlausibleEmail(process.env.RESEND_REPLY_TO)
      ? process.env.RESEND_REPLY_TO
      : undefined,
  };
}
