/**
 * Canonical email-shape validator (2026-04-14).
 *
 * Single source of truth shared by client + server. Same pattern the
 * recipient resolver, send-modal chip input, and contact picker filter
 * already use. Keeping the regex here stops validation drift.
 *
 * The pattern intentionally only enforces a basic "something@something
 * DOT something" shape — matches what `Resend` will reliably accept and
 * what our historical ad-hoc regexes already enforced. Full RFC 5322 is
 * deliberately out of scope (too permissive for typo protection).
 */

export const EMAIL_SHAPE_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * `true` for any value that passes the canonical shape. Blank strings
 * fail — callers that treat "optional" explicitly check for empty input
 * before calling this.
 */
export function isValidEmailShape(value: string): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && EMAIL_SHAPE_REGEX.test(trimmed);
}

/**
 * Optional-field validator — returns `true` when the value is blank or
 * null (= allowed) OR when the value passes the canonical shape.
 * Use in Zod `.refine(...)` and in UI when a field is nullable.
 */
export function isValidOptionalEmail(value: string | null | undefined): boolean {
  if (value == null) return true;
  const trimmed = String(value).trim();
  if (trimmed.length === 0) return true;
  return EMAIL_SHAPE_REGEX.test(trimmed);
}

/** Canonical user-facing message for invalid emails across the app. */
export const INVALID_EMAIL_MESSAGE = "Enter a valid email address";
