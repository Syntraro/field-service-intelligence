/**
 * Canonical phone normalization & comparison.
 *
 * Single source of truth for "is this the same phone number?" everywhere
 * — Communications Hub contact resolution, future SMS/call provider
 * webhook routing, dispatch contact dedup, anywhere else that needs to
 * match user input against stored numbers.
 *
 * Design
 * ------
 * Field service in this product targets Canadian + US numbers (NANP).
 * The match key is the trailing 10 digits, which collapses every common
 * presentation form to the same canonical key:
 *
 *   "(416) 555-0142"     →  "4165550142"
 *   "+1 416 555 0142"    →  "4165550142"
 *   "1-416-555-0142"     →  "4165550142"
 *   "+14165550142"       →  "4165550142"
 *   "416.555.0142"       →  "4165550142"
 *
 * For NANP this is the universally-correct dedup key — the leading "1"
 * country code is collapsed by the trailing-10 rule.
 *
 * For inputs with fewer than 10 digits we still return whatever digits
 * we have, so a search-as-you-type field can match partial input. The
 * `isMatchableE164Like` predicate gates "treat this as a complete number"
 * decisions (e.g. fire a contact-resolution lookup).
 *
 * Out of scope
 * ------------
 *   • International (non-NANP) numbers. The match key is wrong for many
 *     of them (e.g. UK / DE / etc. share trailing digits across cities).
 *     If we add international support, this module gains a country hint
 *     and a region-aware normalizer; callers still go through the same
 *     surface so we don't silently break.
 *   • Display formatting. We deliberately do NOT reformat user input.
 *     The Communications Hub stores whatever the user / provider
 *     supplied as the display string and uses the match key only for
 *     equality comparison.
 *
 * No DOM / framework imports — both client and server bundles consume
 * this file.
 */

import { stripNonDigits } from "./normalizeForMatch";

const MATCH_KEY_LENGTH = 10;

/**
 * Canonical phone match key.
 *
 *   • Strips every non-digit.
 *   • Returns the trailing 10 digits (NANP local-without-country shape).
 *   • Returns "" when no digits remain.
 *
 * Use this key for `WHERE` predicates, `Map<string, T>` lookup tables,
 * and any place two phone strings need to compare equal.
 */
export function normalizePhoneForMatch(value: string | null | undefined): string {
  const digits = stripNonDigits(value);
  if (digits.length === 0) return "";
  return digits.length > MATCH_KEY_LENGTH ? digits.slice(-MATCH_KEY_LENGTH) : digits;
}

/**
 * Two phone strings are the same number when their match keys are equal
 * AND non-empty. Two empty / undefined inputs are NOT equal (an unset
 * phone is never the "same" as another unset phone — that semantic
 * matters for contact resolution).
 */
export function phonesMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ka = normalizePhoneForMatch(a);
  const kb = normalizePhoneForMatch(b);
  if (ka.length === 0 || kb.length === 0) return false;
  return ka === kb;
}

/**
 * True when the input has the digit count required to look up an exact
 * NANP number (10+ digits). Sub-10-digit values are partial input and
 * should not trigger a contact-resolution fetch.
 */
export function isMatchableE164Like(value: string | null | undefined): boolean {
  return normalizePhoneForMatch(value).length === MATCH_KEY_LENGTH;
}

/**
 * Display-safe formatting — used ONLY when the caller doesn't already
 * have a stored display string. Never call this on a value that came
 * from the database; we preserve whatever the source system stored.
 *
 *   "4165550142"   → "(416) 555-0142"
 *   "14165550142"  → "(416) 555-0142"
 *   anything else  → original string (or "" for null/undefined)
 */
export function formatPhoneForDisplay(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const key = normalizePhoneForMatch(value);
  if (key.length !== MATCH_KEY_LENGTH) return value;
  return `(${key.slice(0, 3)}) ${key.slice(3, 6)}-${key.slice(6)}`;
}
