/**
 * Re-auth helper for the secure tenant-teardown approval gate
 * (2026-05-04).
 *
 * Phase 3 (approval) requires the approver to re-enter their password
 * even though they already hold an authenticated platform session.
 * This is a separation-of-duties + intent control: a hijacked logged-in
 * session alone cannot approve a deletion; the attacker would also
 * need the password.
 *
 * Implementation:
 *   • Resolves identity through `platformIdentityRepository` — the
 *     dedicated `platform_users` / `platform_user_identities` surface
 *     introduced in 2026-05-04 Phase 5. Tenant identity rows are NEVER
 *     consulted here.
 *   • bcrypt-compares the supplied plaintext against the platform
 *     identity's password hash.
 *   • Hard-rejects if the platform user is disabled / deactivated —
 *     matches the platform login posture.
 *   • Returns a discriminated result so route handlers can map "wrong
 *     password" to 401 and "disabled account" to 403 without leaking
 *     account state in the wrong direction.
 *
 * Defensive notes:
 *   • bcrypt.compare runs even when the lookup mismatched the userId
 *     (against a synthetic constant-shape hash) so callers cannot use
 *     timing differences between "wrong email" / "wrong password" as
 *     an enumeration channel. The route already pre-resolves the user
 *     via the platform session, so the email branch is irrelevant —
 *     but the structural rule still applies for defense in depth.
 */

import bcrypt from "bcryptjs";
import { platformIdentityRepository } from "../storage/platformIdentity";

export type ReauthResult =
  | { ok: true }
  | { ok: false; code: "INVALID_PASSWORD" | "ACCOUNT_DISABLED" | "NO_IDENTITY" };

// Bcrypt hash of the literal string "invalid" — used as a constant-time
// dummy when the email lookup fails so the bcrypt path always runs.
const DUMMY_HASH =
  "$2a$10$CwTycUXWue0Thq9StjUM0uJ8yGZ1hC5/E7xqQs0wGgVRH2k3rAmZK";

export async function verifyPlatformPassword(input: {
  userId: string;
  email: string;
  password: string;
}): Promise<ReauthResult> {
  if (!input.password || typeof input.password !== "string") {
    return { ok: false, code: "INVALID_PASSWORD" };
  }
  const found = await platformIdentityRepository.findPlatformUserByEmail(
    input.email,
  );

  // Always run a bcrypt compare to keep the timing profile uniform
  // regardless of which branch fails. The result of the compare is
  // discarded for the mismatch / no-identity branches.
  if (!found || found.user.id !== input.userId) {
    await bcrypt.compare(input.password, DUMMY_HASH);
    return { ok: false, code: "INVALID_PASSWORD" };
  }

  const { user, identity } = found;
  if (!identity.passwordHash) {
    await bcrypt.compare(input.password, DUMMY_HASH);
    return { ok: false, code: "NO_IDENTITY" };
  }
  if (user.disabled || user.status === "deactivated") {
    await bcrypt.compare(input.password, DUMMY_HASH);
    return { ok: false, code: "ACCOUNT_DISABLED" };
  }
  const ok = await bcrypt.compare(input.password, identity.passwordHash);
  return ok ? { ok: true } : { ok: false, code: "INVALID_PASSWORD" };
}
