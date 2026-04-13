import { QueryClient } from "@tanstack/react-query";
import {
  logMutationRequest,
  logMutationResponse,
  logMutationError,
  isDiagnosticsEnabled,
} from "./schedulingDiagnostics";

// ========================================
// API ERROR CLASS
// ========================================

/**
 * Structured API error with status, url, and message.
 * Used for consistent error handling across the app.
 */
export class ApiError extends Error {
  status: number;
  url: string;
  /** Server-supplied error code (e.g., "VERSION_MISMATCH", "VISIT_CONFLICT", "ACTIVE_TIMER_EXISTS").
   *  Extracted from response body `code` field so callers can distinguish 409 subtypes. */
  code?: string;
  /** Additional structured data from the response body (e.g., activeItem for timer conflicts). */
  data?: Record<string, any>;

  constructor(status: number, url: string, message: string, code?: string, data?: Record<string, any>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.url = url;
    this.code = code;
    this.data = data;
  }
}

/**
 * Type guard to check if an error is an ApiError
 */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

// ========================================
// CSRF TOKEN MANAGEMENT
// ========================================

let csrfToken: string | null = null;

// Reset CSRF token (call after login/signup/logout when session changes)
export function resetCsrf(): void {
  csrfToken = null;
}

/**
 * 2026-04-10 Phase-2 Fix B — re-entry guard for the session-expired dispatcher.
 *
 * Without this guard, a 401 storm (e.g. multiple dashboard widgets all 401-ing
 * during the brief stale-user window between modal click and Login mount) will
 * dispatch "session-expired" repeatedly and reopen the modal in a loop.
 *
 * The flag is set on first dispatch and only reset by an explicit successful
 * login (via auth.tsx loginMutation.onSuccess) or signup. Reset is exported as
 * resetSessionExpiredGuard().
 */
let sessionExpiredFired = false;

/** Auth-page path prefixes — never reopen the modal while we're already here. */
const AUTH_PAGE_PREFIXES = ["/login", "/signup", "/request-reset", "/reset-password"];

/**
 * Reset the one-shot session-expired guard. Called by AuthProvider after a
 * successful login so the next genuine session expiration can fire the modal
 * again.
 */
export function resetSessionExpiredGuard(): void {
  sessionExpiredFired = false;
}

/**
 * Dispatch a "session-expired" event when an API call gets 401.
 * The SessionExpiredDialog listens for this to show a friendly prompt.
 * Skip the auth-check endpoint itself (it naturally returns 401 when logged out).
 */
function notifySessionExpired(url: string): void {
  // Skip endpoints that naturally return 401 during bootstrap or use non-fetch transports
  if (url === "/api/auth/me") return;
  if (url === "/api/dispatch/stream") return;

  // 2026-04-10 Phase-2 Fix B: one-shot guard. The first 401 in a session-expired
  // burst opens the modal; subsequent in-flight 401s are swallowed until login.
  if (sessionExpiredFired) return;

  // 2026-04-10 Phase-2 Fix B: never reopen the modal on top of an auth page —
  // the user is already where they need to be.
  if (typeof window !== "undefined") {
    const pathname = window.location.pathname;
    for (const prefix of AUTH_PAGE_PREFIXES) {
      if (pathname.startsWith(prefix)) return;
    }
  }

  sessionExpiredFired = true;
  window.dispatchEvent(new CustomEvent("session-expired"));
}


/**
 * In-flight CSRF initialization promise — serializes concurrent callers so only
 * one fetch is active at a time. Without this, login-triggered initCSRF() and
 * a simultaneous apiRequest→getCSRFToken()→initCSRF() would race and could
 * overwrite each other with tokens from different sessions.
 */
let csrfInitPromise: Promise<void> | null = null;

/**
 * Initialize CSRF token — fetches a fresh token from the server.
 *
 * Always clears the in-memory token FIRST so that any concurrent
 * getCSRFToken() caller awaits the fresh fetch instead of returning
 * a stale pre-login token. This closes the race window where:
 *   1. User logs in → Passport regenerates session → old CSRF secret gone
 *   2. onSuccess fires initCSRF() (non-blocking)
 *   3. User clicks "Add Member" before fetch completes
 *   4. getCSRFToken() returns stale token → EBADCSRFTOKEN
 */
export async function initCSRF(): Promise<void> {
  // Clear immediately so concurrent getCSRFToken() callers will await this fetch
  csrfToken = null;

  // Serialize: if a fetch is already in-flight, piggyback on it
  if (csrfInitPromise) {
    return csrfInitPromise;
  }

  csrfInitPromise = (async () => {
    try {
      // Abort after 8 seconds to prevent login hang on cold-start or network stall
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const response = await fetch('/api/csrf-token', {
        credentials: 'include',
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Failed to fetch CSRF token: ${response.status}`);
      }

      const data = await response.json();
      csrfToken = data.csrfToken;
    } catch (error) {
      console.error('[CSRF] Failed to fetch CSRF token:', error);
      throw error;
    } finally {
      csrfInitPromise = null;
    }
  })();

  return csrfInitPromise;
}

/**
 * Refresh CSRF token (called automatically on CSRF errors).
 * Clears the old token and fetches fresh — same as initCSRF() now
 * that initCSRF() always clears first.
 */
async function refreshCSRF(): Promise<void> {
  await initCSRF();
}

/**
 * Get current CSRF token, initializing if needed.
 * If initCSRF() is in-flight (e.g., from post-login refresh),
 * this awaits the same promise instead of starting a second fetch.
 */
export async function getCSRFToken(): Promise<string> {
  if (!csrfToken) {
    await initCSRF();
  }
  return csrfToken!;
}

// ========================================
// API REQUEST FUNCTIONS
// ========================================

/**
 * Make an API request with automatic CSRF token injection
 * Used for mutations (POST, PATCH, DELETE, PUT)
 * Returns parsed JSON response
 */
export async function apiRequest<T = any>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers);
  const method = options.method?.toUpperCase() || 'GET';
  const startTime = Date.now();

  // Parse body for diagnostics logging
  let parsedBody: unknown;
  if (options.body && typeof options.body === 'string') {
    try {
      parsedBody = JSON.parse(options.body);
    } catch {
      parsedBody = options.body;
    }
  }

  // Log mutation request (only for calendar-related mutations in diagnostics mode)
  const isCalendarMutation = url.includes('/calendar') || url.includes('/jobs');
  if (isDiagnosticsEnabled() && isCalendarMutation && method !== 'GET') {
    logMutationRequest(method, url, parsedBody);
  }

  // Ensure JSON content type for requests with body (skip FormData — browser sets multipart boundary)
  if (options.body && !headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  // Add CSRF token for state-changing requests
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    // Ensure we have a token
    const token = await getCSRFToken();
    headers.set('x-csrf-token', token);
  }

  // Make request
  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include' // CRITICAL: Required for session cookies
  });

  // Handle CSRF errors with automatic retry
  if (response.status === 403) {
    try {
      const errorData = await response.clone().json();

      // Check for CSRF error (your backend sends 'EBADCSRFTOKEN')
      if (errorData.code === 'EBADCSRFTOKEN') {
        console.warn('[CSRF] Invalid token detected, refreshing and retrying...');

        // Refresh token
        await refreshCSRF();

        // Retry request with new token
        const newToken = await getCSRFToken();
        headers.set('x-csrf-token', newToken);

        const retryResponse = await fetch(url, {
          ...options,
          headers,
          credentials: 'include'
        });

        if (!retryResponse.ok) {
          const rawText = await retryResponse.text();
          let rawErrorBody: unknown;
          try {
            rawErrorBody = JSON.parse(rawText);
          } catch {
            rawErrorBody = { rawText };
          }
          const errorData = typeof rawErrorBody === 'object' && rawErrorBody !== null
            ? rawErrorBody as Record<string, unknown>
            : { error: rawText };
          const clientMappedMessage = (errorData.error || errorData.message || `Request failed: ${retryResponse.status}`) as string;
          const durationMs = Date.now() - startTime;
          if (isDiagnosticsEnabled() && isCalendarMutation) {
            logMutationError(method, url, retryResponse.status, rawErrorBody, clientMappedMessage, durationMs);
          }
          throw new ApiError(
            retryResponse.status,
            url,
            clientMappedMessage,
            (errorData.code as string) || undefined
          );
        }

        const durationMs = Date.now() - startTime;
        const retryData = await retryResponse.json();
        if (isDiagnosticsEnabled() && isCalendarMutation) {
          logMutationResponse(method, url, retryResponse.status, retryData, durationMs);
        }
        return retryData;
      }
    } catch (parseError) {
      // If we can't parse the error, throw the original response error
      if (parseError instanceof Error && parseError.message.includes('Request failed')) {
        throw parseError; // Re-throw our formatted error
      }
      // Otherwise fall through to handle as regular error
    }
  }

  // Handle other errors
  if (response.status === 401) notifySessionExpired(url);
  if (!response.ok) {
    // Read FULL raw response body for diagnostics
    const rawText = await response.text();
    let rawErrorBody: unknown;
    try {
      rawErrorBody = JSON.parse(rawText);
    } catch {
      rawErrorBody = { rawText };
    }

    // Extract client-facing message (this is what gets shown in toasts)
    const errorData = typeof rawErrorBody === 'object' && rawErrorBody !== null
      ? rawErrorBody as Record<string, unknown>
      : { error: rawText };
    const clientMappedMessage = (errorData.error || errorData.message || `Request failed: ${response.status}`) as string;

    const durationMs = Date.now() - startTime;

    // Log FULL raw error to diagnostics BEFORE any mapping
    if (isDiagnosticsEnabled() && isCalendarMutation) {
      logMutationError(method, url, response.status, rawErrorBody, clientMappedMessage, durationMs);
    }

    throw new ApiError(
      response.status,
      url,
      clientMappedMessage,
      (errorData.code as string) || undefined,
      errorData as Record<string, any>,
    );
  }

  // Return parsed JSON with diagnostics logging (handle 204 No Content gracefully)
  const durationMs = Date.now() - startTime;
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    if (isDiagnosticsEnabled() && isCalendarMutation && method !== 'GET') {
      logMutationResponse(method, url, response.status, null, durationMs);
    }
    return undefined as T;
  }
  const data = await response.json();
  if (isDiagnosticsEnabled() && isCalendarMutation && method !== 'GET') {
    logMutationResponse(method, url, response.status, data, durationMs);
  }
  return data;
}

/**
 * Default query function for TanStack Query (GET requests)
 */
export async function getQueryFn<T = any>({
  queryKey
}: {
  queryKey: readonly unknown[]
}): Promise<T> {
  const url = queryKey[0] as string;

  if (!url) {
    throw new Error('Query key must include a URL');
  }

  const response = await fetch(url, {
    credentials: 'include' // CRITICAL: Required for session cookies
  });

  if (!response.ok) {
    if (response.status === 401) notifySessionExpired(url);
    const errorData = await response.json().catch(() => ({
      error: response.statusText
    }));
    throw new ApiError(
      response.status,
      url,
      errorData.error || errorData.message || `Request failed: ${response.status}`
    );
  }

  return response.json();
}

// ========================================
// QUERY CLIENT CONFIGURATION
// ========================================

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn,
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0, // Don't retry mutations automatically (we handle CSRF retry manually)
    },
  },
});