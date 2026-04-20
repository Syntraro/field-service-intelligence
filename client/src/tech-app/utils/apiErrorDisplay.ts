/**
 * apiErrorDisplay — auth-aware mutation error formatting for the tech app.
 *
 * Delegates 401 handling to the canonical SessionExpiredDialog (mounted at
 * the app root and driven by the `session-expired` event that queryClient.ts
 * dispatches on every 401). That means tech-app mutation handlers should
 * suppress their own toast on 401 — otherwise the user sees a raw "Request
 * failed: 401" flash immediately before the session-expired modal opens.
 *
 * For 403, CSRF (EBADCSRFTOKEN) is already auto-retried inside apiRequest,
 * so any 403 that reaches a mutation error handler is a real permission
 * denial. Surface it with a stable message instead of the opaque server
 * text so techs get a consistent signal.
 */
import { isApiError } from "@/lib/queryClient";

/**
 * Convert a mutation error into a user-visible message, or `null` to
 * suppress the toast entirely (used for 401, which the SessionExpired
 * dialog handles).
 */
export function displayApiError(err: unknown): string | null {
  if (isApiError(err)) {
    if (err.status === 401) return null;
    // 403: prefer the server-supplied message (some endpoints return
    // useful context like "Visit not assigned to you") and fall back to
    // a stable generic string when the server doesn't include one.
    if (err.status === 403) return err.message || "You don't have permission to do that.";
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong. Please try again.";
}
