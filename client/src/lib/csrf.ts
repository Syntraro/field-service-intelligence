// client/src/lib/csrf.ts

let csrfToken: string | null = null;

/**
 * Fetches a fresh CSRF token from the server
 */
export async function fetchCsrfToken(): Promise<string> {
  const response = await fetch('/api/csrf-token', {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Failed to fetch CSRF token');
  }

  const data = await response.json();
  csrfToken = data.csrfToken;
  return csrfToken!;
}

/**
 * Gets the current CSRF token, fetching a new one if needed
 */
export async function getCsrfToken(): Promise<string> {
  if (!csrfToken) {
    return fetchCsrfToken();
  }
  return csrfToken;
}

/**
 * Clears the cached CSRF token (useful on 403 errors)
 */
export function clearCsrfToken(): void {
  csrfToken = null;
}

/**
 * Checks if this request needs CSRF protection
 * (only non-GET requests need it)
 */
export function needsCsrfToken(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}