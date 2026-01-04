import { QueryClient } from "@tanstack/react-query";

// ========================================
// CSRF TOKEN MANAGEMENT
// ========================================

let csrfToken: string | null = null;

// Reset CSRF token (call after login/signup/logout when session changes)
export function resetCsrf(): void {
  csrfToken = null;
}


/**
 * Initialize CSRF token - call this when app mounts
 */
export async function initCSRF(): Promise<void> {
  try {
    const response = await fetch('/api/csrf-token', {
      credentials: 'include'
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch CSRF token: ${response.status}`);
    }

    const data = await response.json();
    csrfToken = data.csrfToken;
    console.log('[CSRF] Token initialized:', csrfToken?.substring(0, 8) + '...');
  } catch (error) {
    console.error('[CSRF] Failed to fetch CSRF token:', error);
    throw error; // Re-throw so app knows initialization failed
  }
}

/**
 * Refresh CSRF token (called automatically on CSRF errors)
 */
async function refreshCSRF(): Promise<void> {
  console.log('[CSRF] Refreshing token...');
  csrfToken = null; // Clear old token first
  await initCSRF();
}

/**
 * Get current CSRF token, initializing if needed
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

  // Ensure JSON content type for requests with body
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  // Add CSRF token for state-changing requests
  const method = options.method?.toUpperCase() || 'GET';
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    // Ensure we have a token
    const token = await getCSRFToken();
    headers.set('x-csrf-token', token);
    console.log(`[CSRF] Adding token to ${method} ${url}`);
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
          const retryError = await retryResponse.json().catch(() => ({
            error: retryResponse.statusText
          }));
          throw new Error(retryError.error || `Request failed: ${retryResponse.status}`);
        }

        return retryResponse.json();
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
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({
      error: response.statusText
    }));
    throw new Error(errorData.error || `Request failed: ${response.status}`);
  }

  // Return parsed JSON
  return response.json();
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
    const errorData = await response.json().catch(() => ({
      error: response.statusText
    }));
    throw new Error(errorData.error || `Request failed: ${response.status}`);
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