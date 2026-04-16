/**
 * Password reset service (2026-04-15).
 *
 * End-to-end business logic for the self-service password reset flow.
 * Reused by:
 *   - public `POST /api/auth/password-reset-request`
 *   - public `POST /api/auth/password-reset/confirm`
 *   - admin-triggered `POST /api/team/:userId/send-password-reset`
 *
 * Security invariants enforced here (not at the route level):
 *   - Tokens are never stored raw; only a SHA-256 hex digest is persisted.
 *   - Prior unused tokens for the user are invalidated whenever a new one
 *     is issued, so a leaked email link becomes inert once re-requested.
 *   - Tokens are single-use (`usedAt` timestamp) and have a fixed TTL
 *     (`RESET_TOKEN_TTL_MS`).
 *   - `requestReset` never throws on "unknown email" — it returns success
 *     in both cases so the response can't be used to enumerate accounts.
 */

import { storage } from "../storage/index";
import { identityRepository } from "../storage/identities";
import { passwordResetTokenRepository } from "../storage/passwordResetTokens";
import {
  generateResetToken,
  hashPassword,
  hashResetToken,
  RESET_TOKEN_TTL_MS,
} from "../auth/passwordUtils";
import { getResendClient } from "../resendClient";

/**
 * Build the reset URL the user will click in email. Prefers an explicit
 * `APP_BASE_URL` env (canonical for production) and falls back to an
 * inferred origin when running locally. Never silently produces a
 * broken link — throws if we have nothing usable.
 */
function buildResetUrl(rawToken: string, requestOrigin: string | null): string {
  const configured = process.env.APP_BASE_URL?.trim().replace(/\/+$/, "");
  const base = configured || requestOrigin?.replace(/\/+$/, "");
  if (!base) {
    throw new Error(
      "Password reset: APP_BASE_URL is not set and request origin is unavailable; " +
        "set APP_BASE_URL to the public URL of the office app (e.g. https://app.example.com).",
    );
  }
  return `${base}/reset-password?token=${encodeURIComponent(rawToken)}`;
}

/** Human-readable expiry window for email copy. */
function expiryWindowLabel(): string {
  const minutes = Math.round(RESET_TOKEN_TTL_MS / 60000);
  return `${minutes} minutes`;
}

/**
 * Request a password reset. Always resolves successfully — callers must
 * NOT leak the return value's distinction between "email sent" and
 * "email not on file" in the HTTP response.
 */
export async function requestPasswordReset(args: {
  email: string;
  requestIp: string | null;
  requestOrigin: string | null;
}): Promise<{ delivered: boolean }> {
  const normalized = (args.email || "").trim().toLowerCase();
  if (!normalized) return { delivered: false };

  // Look up the account globally — reset is a pre-auth flow so there is
  // no company context yet. `findUserByEmailGlobal` enforces the
  // "one email = one company" invariant that signup already relies on.
  const match = await identityRepository.findUserByEmailGlobal(normalized);
  if (!match) {
    // Intentional silent success — do NOT surface this to the caller as
    // a different response. Log so operators can see the attempt.
    console.log(`[PasswordReset] Request for unknown email (silent noop).`);
    return { delivered: false };
  }

  const { user } = match;

  // Invalidate any still-active tokens for this user before minting a
  // new one. The prior email link in the inbox becomes inert.
  await passwordResetTokenRepository.invalidateActiveForUser(user.id);

  const { raw, hash } = generateResetToken();
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  await passwordResetTokenRepository.insertToken({
    userId: user.id,
    tokenHash: hash,
    expiresAt,
    requestedIp: args.requestIp,
  });

  const resetUrl = buildResetUrl(raw, args.requestOrigin);
  const firstName = (user.firstName || "").trim();
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";

  const subject = "Reset your Syntraro password";
  const textBody =
    `${greeting}\n\n` +
    `We received a request to reset the password for this account. Click the link below to choose a new password:\n\n` +
    `${resetUrl}\n\n` +
    `This link expires in ${expiryWindowLabel()} and can only be used once. ` +
    `If you didn't request a password reset, you can safely ignore this email — your password will stay the same.\n\n` +
    `— Syntraro`;

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; color: #111827; line-height: 1.5;">
      <p>${greeting}</p>
      <p>We received a request to reset the password for this account. Click the button below to choose a new password:</p>
      <p style="margin: 24px 0;">
        <a href="${resetUrl}" style="display:inline-block; padding:10px 18px; background:#76B054; color:#ffffff; text-decoration:none; border-radius:6px; font-weight:600;">Reset password</a>
      </p>
      <p style="color:#4b5563; font-size:13px;">Or paste this link into your browser:<br/><span style="word-break:break-all;">${resetUrl}</span></p>
      <p style="color:#4b5563; font-size:13px;">This link expires in <strong>${expiryWindowLabel()}</strong> and can only be used once. If you didn't request a password reset, you can safely ignore this email — your password will stay the same.</p>
      <p style="color:#9ca3af; font-size:12px; margin-top:24px;">— Syntraro</p>
    </div>
  `.trim();

  try {
    const { client, fromEmail } = await getResendClient();
    await client.emails.send({
      from: fromEmail,
      to: normalized,
      subject,
      text: textBody,
      html: htmlBody,
    });
    return { delivered: true };
  } catch (err) {
    // Log and swallow — we must not surface the failure to the caller
    // (that would leak whether the email existed). Operators will see
    // this in logs / Resend dashboard.
    console.error(`[PasswordReset] Failed to send reset email:`, err);
    return { delivered: false };
  }
}

/** Reasons `confirmPasswordReset` can refuse a submission. */
export type PasswordResetConfirmError =
  | "invalid_token"
  | "expired_token"
  | "weak_password";

export interface PasswordResetConfirmResult {
  ok: boolean;
  error?: PasswordResetConfirmError;
  userId?: string;
}

/**
 * Confirm a reset: validate the submitted token, set the new password
 * via the canonical identity path, mark the token consumed, and
 * invalidate every existing session for the user.
 */
export async function confirmPasswordReset(args: {
  rawToken: string;
  newPassword: string;
}): Promise<PasswordResetConfirmResult> {
  const raw = (args.rawToken || "").trim();
  const pwd = args.newPassword || "";
  if (!raw) return { ok: false, error: "invalid_token" };
  if (pwd.length < 8) return { ok: false, error: "weak_password" };

  const hash = hashResetToken(raw);

  // Active = not used, not expired (enforced in repo). We treat any
  // miss identically ("invalid_token") — leaking expired-vs-missing
  // is not useful to an attacker and is not useful to the UI either.
  const row = await passwordResetTokenRepository.findActiveByHash(hash);
  if (!row) return { ok: false, error: "invalid_token" };

  // Resolve the user so we have companyId for the canonical identity
  // password write. `storage.getUser` returns the single user record
  // — tenant is enforced by the subsequent `setEmailPassword` scoping.
  const user = await storage.getUser(row.userId);
  if (!user) return { ok: false, error: "invalid_token" };

  const passwordHash = await hashPassword(pwd);

  // Canonical password write — identical to the one used by admin
  // manual-set and by invitation acceptance.
  const updated = await storage.setEmailPassword(
    user.companyId,
    user.id,
    passwordHash,
    true, // verified
  );
  if (!updated) return { ok: false, error: "invalid_token" };

  // One-time use: mark this token consumed. Any other still-active
  // token for the user was already invalidated at issue time, but
  // do a sweep anyway in case one slipped through a concurrent issue.
  await passwordResetTokenRepository.markUsed(row.id);
  await passwordResetTokenRepository.invalidateActiveForUser(user.id);

  // Invalidate every existing session for the user — same mechanism
  // used by admin manual-set (`team.ts:805`). Anyone who had somehow
  // stolen a live session is now logged out.
  await storage.incrementTokenVersion(user.id);

  return { ok: true, userId: user.id };
}
