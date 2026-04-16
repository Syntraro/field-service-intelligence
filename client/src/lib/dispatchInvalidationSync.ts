/**
 * Shared coalescing timestamp for dispatch calendar invalidation.
 *
 * Context: a scheduling mutation on the server (a) commits the change
 * and (b) emits an SSE dispatch signal. Client-side, two independent
 * paths react to the same event:
 *
 *   1. `useDispatchStream` (SSE) receives the signal and invalidates
 *      `/api/calendar` + `/api/calendar/unscheduled` (among others).
 *   2. `useDispatchPreviewMutations.backgroundInvalidate` fires at
 *      +800 ms post-mutation and invalidates the same two keys.
 *
 * Both paths currently fire for every edit, producing a double refetch.
 *
 * 2026-04-14 Phase 2 hygiene: the SSE handler is AUTHORITATIVE (server-
 * emitted, tenant-scoped) and always arrives shortly after a successful
 * mutation. It calls `markCalendarInvalidated()` after flushing. The
 * mutation-side `backgroundInvalidate` calls `isCalendarRecentlyInvalidated()`
 * and SKIPS only the two calendar keys when SSE has marked them in the
 * last 700 ms. Every other key the mutation invalidates keeps firing.
 *
 * Failsafe: if SSE is disconnected, no mark ever happens,
 * `isCalendarRecentlyInvalidated()` always returns false, and the
 * mutation path continues to invalidate the calendar keys as before.
 * So this is a pure suppression of duplicate work on the happy path —
 * zero risk to the disconnected-SSE fallback.
 */

const COALESCE_WINDOW_MS = 700;

let lastCalendarInvalidation = 0;

export function markCalendarInvalidated(): void {
  lastCalendarInvalidation = Date.now();
}

export function isCalendarRecentlyInvalidated(
  windowMs: number = COALESCE_WINDOW_MS,
): boolean {
  return Date.now() - lastCalendarInvalidation < windowMs;
}
