/**
 * Error-message translator for the Job ↔ Equipment link mutations.
 *
 * 2026-05-08: extracted from `JobEquipmentSection.tsx` so it's a
 * directly-importable, framework-free helper for unit tests.
 *
 * Contract:
 *   • If the error is an `ApiError` AND its `code` is one of the codes
 *     we surface a friendly translation for (today: `JOB_INVOICED_LOCKED`),
 *     return that translation.
 *   • Otherwise, return the server-supplied `error.message` verbatim
 *     (this is what `apiRequest` extracts from the response body's
 *     `error` / `message` field — i.e., the actual server reason).
 *   • Final fallback: return the generic fallback string the caller
 *     supplies. Used when the error is something other than an Error
 *     instance, or when `message` is empty.
 *
 * Why a dedicated module:
 *   The opaque `onError: () => toast(...)` pattern in the prior
 *   implementation collapsed every server failure (invoiced lock,
 *   soft-deleted equipment, role gate, CSRF, 500) into the same
 *   diagnostic-blind toast. Source-pinning the import + adding a small
 *   unit test for this helper guards the diagnostic surface from
 *   silently regressing.
 */

import { isApiError } from "@/lib/queryClient";

/**
 * Friendly user-facing copy keyed by canonical server error code. Add
 * new entries as the server starts emitting more `code` values that
 * need a translation. Codes not present here fall through to the
 * server's `error.message` verbatim.
 */
const FRIENDLY_CODE_MESSAGES: Record<string, string> = {
  JOB_INVOICED_LOCKED: "This job is locked because it has been invoiced.",
};

/**
 * Translate a thrown mutation error into a user-facing toast description.
 * Pure function — no React dependency, easy to unit-test.
 */
export function describeMutationError(
  error: unknown,
  fallback: string,
): string {
  if (isApiError(error)) {
    if (error.code && FRIENDLY_CODE_MESSAGES[error.code]) {
      return FRIENDLY_CODE_MESSAGES[error.code];
    }
    if (error.message) return error.message;
    return fallback;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}
