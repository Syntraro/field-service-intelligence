/**
 * Canonical email cell parsing for CSV imports.
 *
 * CSVs (especially Jobber exports) frequently stuff multiple emails into
 * a single cell separated by commas, semicolons, or pipes. The adapters
 * historically picked "the first one"; this canonical helper preserves
 * that behavior and exposes a list variant for future adapters that may
 * want to import secondary contacts.
 */

import { trimOrNull } from "./text";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Split a cell on common multi-email separators (comma, semicolon, pipe,
 * whitespace) and return the trimmed list. Whitespace is included because
 * Jobber exports sometimes list multiple addresses as " foo@x.com  bar@y.com".
 */
export function splitEmails(val: string | null | undefined): string[] {
  const t = trimOrNull(val);
  if (t === null) return [];
  return t
    .split(/[,;|\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Extract the first well-formed email from a cell. Mirrors the legacy
 * `extractFirstEmail` semantics (strict — returns null when no token
 * passes the shape check). Adapters that want the raw tokens regardless
 * of validity should use `splitEmails`.
 */
export function extractFirstEmail(val: string | null | undefined): string | null {
  const candidates = splitEmails(val);
  for (const c of candidates) {
    if (EMAIL_REGEX.test(c)) return c;
  }
  return null;
}

/** Shape-only validator; does NOT do DNS/MX verification. */
export function isValidEmailShape(val: string | null | undefined): boolean {
  if (!val) return false;
  return EMAIL_REGEX.test(val.trim());
}
