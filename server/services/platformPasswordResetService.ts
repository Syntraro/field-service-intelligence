/**
 * Platform Password Reset Service (2026-05-03).
 *
 * Mirrors the tenant `passwordResetService` for platform-role users only.
 * Backed by a dedicated `platform_password_reset_tokens` table (see
 * `shared/schema.ts::platformPasswordResetTokens`) so a tenant reset
 * link can never be redeemed via the platform endpoint and vice versa.
 *
 * Security invariants:
 *   - Token raw value is never persisted; only SHA-256 hex digest.
 *   - Issuing a new token invalidates every prior un-used token for the
 *     user — a leaked email link becomes inert once re-requested.
 *   - Tokens are single-use (`used_at` timestamp) and have the same
 *     fixed TTL the tenant flow uses (`RESET_TOKEN_TTL_MS`).
 *   - `requestPlatformPasswordReset` ALWAYS resolves with no info about
 *     existence: tenant-only / unknown emails return `{ delivered: false }`
 *     just like a deliverable email that failed to send. Callers (the
 *     route) must not surface the difference.
 *   - Successful reset bumps `users.token_version` to invalidate every
 *     existing platform session for the user.
 */

import { db } from "../db";
import { and, eq, gt, isNull } from "drizzle-orm";
import { platformPasswordResetTokens } from "@shared/schema";
import {
  generateResetToken,
  hashPassword,
  hashResetToken,
  RESET_TOKEN_TTL_MS,
} from "../auth/passwordUtils";
import { getResendClient } from "../resendClient";
import { BRAND } from "@shared/branding";
// 2026-05-04 Phase 5: read AND write surface is the dedicated platform
// identity tables only. The Phase 2-A → Phase 3.5 fallback to the
// legacy `users` / `user_identities` was removed in this commit; the
// `storage` and `isPlatformRole` imports went with it.
import { platformIdentityRepository } from "../storage/platformIdentity";

function buildPlatformResetUrl(
  rawToken: string,
  requestOrigin: string | null,
): string {
  const configured = process.env.APP_BASE_URL?.trim().replace(/\/+$/, "");
  const base = configured || requestOrigin?.replace(/\/+$/, "");
  if (!base) {
    throw new Error(
      "Platform password reset: APP_BASE_URL is not set and request origin is unavailable",
    );
  }
  // CRITICAL: link points at /platform/reset-password — NOT the tenant
  // /reset-password page. Wrong landing page = wrong endpoint = token
  // never matches.
  return `${base}/platform/reset-password?token=${encodeURIComponent(rawToken)}`;
}

function expiryWindowLabel(): string {
  const minutes = Math.round(RESET_TOKEN_TTL_MS / 60000);
  return `${minutes} minutes`;
}

/**
 * Request a platform password reset. Always resolves successfully —
 * callers MUST NOT distinguish "email sent" from "no platform account
 * with that email" in the HTTP response.
 *
 * Tenant-only accounts and unknown emails both fall through with
 * `{ delivered: false }`; only platform-role accounts produce a real
 * email + token row.
 */
export async function requestPlatformPasswordReset(args: {
  email: string;
  requestIp: string | null;
  requestOrigin: string | null;
}): Promise<{ delivered: boolean; userId: string | null }> {
  const normalized = (args.email || "").trim().toLowerCase();
  if (!normalized) return { delivered: false, userId: null };

  // 2026-05-04 Phase 5: identity comes EXCLUSIVELY from the dedicated
  // platform tables. The Phase 3.5 legacy `users` fallback was
  // removed in this commit alongside the destructive cleanup
  // migration. Tenant emails and unknown emails both return null
  // here and fall through to the silent-noop branch below — same
  // anti-enumeration response shape as before.
  const fromNew = await platformIdentityRepository.findPlatformUserByEmail(normalized);
  const userId: string | null = fromNew ? fromNew.user.id : null;
  const firstNameRaw: string | null = fromNew?.user.firstName ?? null;

  if (!userId) {
    // Silent noop — covers unknown email AND tenant-only email.
    // Anti-enumeration: caller cannot distinguish.
    console.log(
      `[PlatformPasswordReset] Request for unknown / non-platform email (silent noop).`,
    );
    return { delivered: false, userId: null };
  }

  // Invalidate any active token before issuing a new one.
  await db
    .update(platformPasswordResetTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(platformPasswordResetTokens.userId, userId),
        isNull(platformPasswordResetTokens.usedAt),
        gt(platformPasswordResetTokens.expiresAt, new Date()),
      ),
    );

  const { raw, hash } = generateResetToken();
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  await db.insert(platformPasswordResetTokens).values({
    userId,
    tokenHash: hash,
    expiresAt,
    requestedIp: args.requestIp,
  });

  const resetUrl = buildPlatformResetUrl(raw, args.requestOrigin);
  const firstName = (firstNameRaw || "").trim();
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";

  const subject = `Reset your ${BRAND.product} platform-admin password`;
  const textBody =
    `${greeting}\n\n` +
    `We received a request to reset the password for your ${BRAND.product} platform-admin account. ` +
    `Click the link below to choose a new password:\n\n` +
    `${resetUrl}\n\n` +
    `This link expires in ${expiryWindowLabel()} and can only be used once. ` +
    `If you didn't request a password reset, you can safely ignore this email — your password will stay the same.\n\n` +
    `${BRAND.emailFooter}`;

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; color: #111827; line-height: 1.5;">
      <p>${greeting}</p>
      <p>We received a request to reset the password for your <strong>${BRAND.product}</strong> platform-admin account. Click the button below to choose a new password:</p>
      <p style="margin: 24px 0;">
        <a href="${resetUrl}" style="display:inline-block; padding:10px 18px; background:#76B054; color:#ffffff; text-decoration:none; border-radius:6px; font-weight:600;">Reset password</a>
      </p>
      <p style="color:#4b5563; font-size:13px;">Or paste this link into your browser:<br/><span style="word-break:break-all;">${resetUrl}</span></p>
      <p style="color:#4b5563; font-size:13px;">This link expires in <strong>${expiryWindowLabel()}</strong> and can only be used once. If you didn't request a password reset, you can safely ignore this email — your password will stay the same.</p>
      <p style="color:#9ca3af; font-size:12px; margin-top:24px;">${BRAND.emailFooter}</p>
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
    return { delivered: true, userId };
  } catch (err) {
    console.error(`[PlatformPasswordReset] Failed to send reset email:`, err);
    return { delivered: false, userId };
  }
}

export type PlatformPasswordResetConfirmError =
  | "invalid_token"
  | "expired_token"
  | "weak_password"
  // 2026-05-04 Phase 5: `non_platform_role` is RETIRED — the legacy
  // fallback that produced it has been removed. The variant is kept
  // here as a type-level entry so callers that switch on this union
  // (route layer / future SDKs) do not need to be re-typed in lockstep
  // with this PR. No code path emits it. Drop in a future cleanup.
  | "non_platform_role";

export interface PlatformPasswordResetConfirmResult {
  ok: boolean;
  error?: PlatformPasswordResetConfirmError;
  userId?: string;
}

/**
 * Confirm a platform reset: validate the supplied token against the
 * platform-only token table, set the new password on the local
 * identity, mark the token consumed, and bump `tokenVersion` to
 * invalidate every active platform session for the user.
 */
export async function confirmPlatformPasswordReset(args: {
  rawToken: string;
  newPassword: string;
}): Promise<PlatformPasswordResetConfirmResult> {
  const raw = (args.rawToken || "").trim();
  const pwd = args.newPassword || "";
  if (!raw) return { ok: false, error: "invalid_token" };
  if (pwd.length < 8) return { ok: false, error: "weak_password" };

  const hash = hashResetToken(raw);

  const rows = await db
    .select({
      id: platformPasswordResetTokens.id,
      userId: platformPasswordResetTokens.userId,
      expiresAt: platformPasswordResetTokens.expiresAt,
      usedAt: platformPasswordResetTokens.usedAt,
    })
    .from(platformPasswordResetTokens)
    .where(eq(platformPasswordResetTokens.tokenHash, hash))
    .limit(1);

  const row = rows[0];
  if (!row) return { ok: false, error: "invalid_token" };
  if (row.usedAt) return { ok: false, error: "invalid_token" };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, error: "invalid_token" };

  // 2026-05-04 Phase 5: resolve user EXCLUSIVELY from the dedicated
  // platform tables. The Phase 3.5 legacy fallback was removed in
  // this commit alongside the destructive cleanup migration. The
  // `non_platform_role` error code is also retired — it could only
  // arise from the legacy-fallback branch. A token whose user_id
  // does not resolve in `platform_users` collapses to `invalid_token`
  // (single-error anti-enumeration shape).
  const fromNew = await platformIdentityRepository.getPlatformUserById(row.userId);
  if (!fromNew) {
    return { ok: false, error: "invalid_token" };
  }
  const resolvedUserId = fromNew.user.id;

  const passwordHash = await hashPassword(pwd);

  // Canonical write surface — `platform_user_identities`. NO legacy
  // mirror.
  await platformIdentityRepository.setPlatformPasswordHash(resolvedUserId, passwordHash);

  // Mark this token consumed + invalidate any others for the user.
  await db
    .update(platformPasswordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(platformPasswordResetTokens.id, row.id));
  await db
    .update(platformPasswordResetTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(platformPasswordResetTokens.userId, resolvedUserId),
        isNull(platformPasswordResetTokens.usedAt),
      ),
    );

  // Invalidate every existing platform session — `requirePlatformSession`
  // refuses any psid whose `platformTokenVersion` no longer matches.
  await platformIdentityRepository.incrementPlatformTokenVersion(resolvedUserId);

  return { ok: true, userId: resolvedUserId };
}
