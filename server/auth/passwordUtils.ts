/**
 * Canonical password + reset-token hashing utilities (2026-04-15).
 *
 * Extracted so every path that creates or changes a password — invitation
 * acceptance, signup, admin manual set, password reset — uses the same
 * bcrypt cost and the same code path. Reset-token hashing lives here too
 * because both concerns are auth-hashing concerns and sharing the file
 * avoids a second tiny `*.ts` for one function.
 */

import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "crypto";

/** Canonical bcrypt cost used for stored password hashes. */
const BCRYPT_COST = 10;

/**
 * Hash a user-supplied password for storage. All new password writes
 * (signup, invitation accept, admin manual set, password reset) must use
 * this so the cost stays consistent.
 */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

/**
 * Generate a cryptographically secure password-reset token.
 *
 * Returns `{ raw, hash }`:
 *   - `raw` is the one-shot token delivered to the user via email; it is
 *     never persisted.
 *   - `hash` is the deterministic SHA-256 hex digest stored in
 *     `password_reset_tokens.tokenHash`. Deterministic hashing is correct
 *     here (we need to look the token up by hash on confirm) — bcrypt is
 *     deliberately *not* used for this.
 */
export function generateResetToken(): { raw: string; hash: string } {
  // 32 random bytes → base64url is URL-safe and long enough to resist
  // offline brute force even if the DB hash ever leaks.
  const raw = randomBytes(32).toString("base64url");
  const hash = hashResetToken(raw);
  return { raw, hash };
}

/** Deterministic SHA-256 hex digest used for storing / looking up reset tokens. */
export function hashResetToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Canonical reset-token validity window. Short enough to limit exposure
 *  if an inbox is compromised, long enough to survive delivery delays. */
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 60 minutes
