import { Resend } from 'resend';

/**
 * Validate email sending prerequisites at startup.
 * Logs warnings for missing config so operators know portal emails won't work.
 */
export function validateEmailConfig(): { valid: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!process.env.RESEND_API_KEY) missing.push("RESEND_API_KEY");
  if (!process.env.PORTAL_FROM_EMAIL) missing.push("PORTAL_FROM_EMAIL");

  if (missing.length > 0) {
    console.warn(
      `[Email] Missing env vars: ${missing.join(", ")}. ` +
      "Portal magic-link emails will not be sent until these are configured."
    );
  }
  return { valid: missing.length === 0, missing };
}

/**
 * Build a Resend client + formatted sender address.
 *
 * Env vars:
 *   RESEND_API_KEY       — Resend API key (required)
 *   PORTAL_FROM_EMAIL    — Verified sender email, e.g. noreply@yourdomain.com (required)
 *   PORTAL_FROM_NAME     — Display name for sender (optional, default "Customer Portal")
 *
 * Throws if RESEND_API_KEY or PORTAL_FROM_EMAIL is missing.
 */
export async function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY not configured');
  }

  const fromEmail = process.env.PORTAL_FROM_EMAIL;
  if (!fromEmail) {
    throw new Error(
      'PORTAL_FROM_EMAIL not configured. Set it to a verified Resend domain address ' +
      '(e.g. noreply@yourdomain.com). See https://resend.com/domains'
    );
  }

  const fromName = process.env.PORTAL_FROM_NAME || 'Customer Portal';

  return {
    client: new Resend(apiKey),
    fromEmail: `${fromName} <${fromEmail}>`,
  };
}
