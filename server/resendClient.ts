import { Resend } from "resend";

/**
 * Canonical Resend / outbound-email configuration.
 *
 * 2026-04-14 cleanup pass: the legacy `PORTAL_FROM_EMAIL` /
 * `PORTAL_FROM_NAME` env vars are no longer accepted — operators must
 * use the canonical `RESEND_*` variables. One config path, no drift.
 *
 * Required env:
 *   RESEND_API_KEY       — Resend API key
 *   RESEND_FROM_EMAIL    — Verified sender email (e.g. notifications@yourdomain.com)
 *
 * Optional env:
 *   RESEND_FROM_NAME     — Display name for the sender (defaults to "Notifications")
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
 * Build a Resend client + formatted sender address.
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

  const fromName = process.env.RESEND_FROM_NAME || "Notifications";
  return {
    client: new Resend(apiKey),
    fromEmail: `${fromName} <${fromEmail}>`,
  };
}
