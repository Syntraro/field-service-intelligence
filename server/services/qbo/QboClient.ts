/**
 * QboClient - QuickBooks Online API client with OAuth handling
 *
 * Handles:
 * - OAuth token management (refresh when needed)
 * - Base API requests (GET, POST)
 * - Request/response logging
 * - Error handling and retry logic
 *
 * IMPORTANT: This is a foundation service. OAuth tokens must be
 * configured per-company. Token storage is handled separately.
 */

export interface QboTokens {
  accessToken: string;
  refreshToken: string;
  realmId: string; // QBO company ID
  expiresAt: Date;
}

export interface QboClientConfig {
  clientId: string;
  clientSecret: string;
  environment: "sandbox" | "production";
}

export interface QboApiError {
  code: string;
  message: string;
  detail?: string;
  // Error classification for retry logic
  retryable: boolean;
  // Seconds to wait before retrying (from Retry-After header for 429s)
  retryAfterSeconds?: number;
  // Error category for UI messaging
  category: "auth" | "rate_limit" | "validation" | "mapping" | "conflict" | "server" | "network" | "unknown";
}

export interface QboApiResponse<T> {
  success: boolean;
  data?: T;
  error?: QboApiError;
  raw?: unknown;
}

// QBO API base URLs
const QBO_API_BASE = {
  sandbox: "https://sandbox-quickbooks.api.intuit.com",
  production: "https://quickbooks.api.intuit.com",
} as const;

const QBO_OAUTH_BASE = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

/**
 * QBO API Client
 *
 * Usage:
 * ```typescript
 * const client = new QboClient(config, tokens);
 * const customer = await client.createCustomer(payload);
 * ```
 */
export class QboClient {
  private config: QboClientConfig;
  private tokens: QboTokens;
  private baseUrl: string;

  constructor(config: QboClientConfig, tokens: QboTokens) {
    this.config = config;
    this.tokens = tokens;
    this.baseUrl = QBO_API_BASE[config.environment];
  }

  /**
   * Get current tokens (may be refreshed)
   */
  getTokens(): QboTokens {
    return { ...this.tokens };
  }

  /**
   * Check if access token is expired or about to expire
   */
  isTokenExpired(): boolean {
    const bufferMs = 5 * 60 * 1000; // 5 minute buffer
    return this.tokens.expiresAt.getTime() - bufferMs < Date.now();
  }

  /**
   * Refresh the access token using the refresh token
   * Returns new tokens if successful
   */
  async refreshAccessToken(): Promise<QboTokens> {
    const response = await fetch(QBO_OAUTH_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.tokens.refreshToken,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to refresh QBO token: ${response.status} ${errorText}`);
    }

    const data = await response.json();

    this.tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || this.tokens.refreshToken, // QBO may or may not return new refresh token
      realmId: this.tokens.realmId,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };

    return this.getTokens();
  }

  /**
   * Ensure we have a valid access token, refreshing if needed
   */
  private async ensureValidToken(): Promise<void> {
    if (this.isTokenExpired()) {
      await this.refreshAccessToken();
    }
  }

  /**
   * Make an authenticated GET request to QBO API
   */
  async get<T>(endpoint: string): Promise<QboApiResponse<T>> {
    await this.ensureValidToken();

    const url = `${this.baseUrl}/v3/company/${this.tokens.realmId}${endpoint}`;

    const startTime = Date.now();
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${this.tokens.accessToken}`,
        "Accept": "application/json",
      },
    });

    return this.handleResponse<T>(response, startTime);
  }

  /**
   * Make an authenticated POST request to QBO API
   */
  async post<T>(endpoint: string, body: unknown): Promise<QboApiResponse<T>> {
    await this.ensureValidToken();

    const url = `${this.baseUrl}/v3/company/${this.tokens.realmId}${endpoint}`;

    const startTime = Date.now();
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.tokens.accessToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(body),
    });

    return this.handleResponse<T>(response, startTime);
  }

  /**
   * Handle QBO API response with structured error handling
   */
  private async handleResponse<T>(response: Response, startTime: number): Promise<QboApiResponse<T>> {
    const durationMs = Date.now() - startTime;

    try {
      // Handle rate limiting (429) - may not have JSON body
      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const retryAfterSeconds = retryAfter ? parseInt(retryAfter, 10) : 60; // Default 60s
        return {
          success: false,
          error: {
            code: "429",
            message: "Rate limit exceeded",
            detail: `Too many requests. Retry after ${retryAfterSeconds} seconds.`,
            retryable: true,
            retryAfterSeconds,
            category: "rate_limit",
          },
        };
      }

      const data = await response.json();

      if (!response.ok) {
        // QBO returns errors in a nested Fault structure
        const fault = data.Fault;
        const qboError = fault?.Error?.[0];
        const code = qboError?.code || String(response.status);
        const message = qboError?.Message || `QBO API error: ${response.statusText}`;
        const detail = qboError?.Detail;

        // Classify the error
        const { retryable, category } = this.classifyError(response.status, code, message, detail);

        return {
          success: false,
          error: {
            code,
            message,
            detail,
            retryable,
            category,
          },
          raw: data,
        };
      }

      // Success - extract the entity from the response
      // QBO wraps responses like { Customer: {...} } or { Invoice: {...} }
      const entityKey = Object.keys(data).find(k => k !== "time");
      const entity = entityKey ? data[entityKey] : data;

      return {
        success: true,
        data: entity as T,
        raw: data,
      };
    } catch (err) {
      return {
        success: false,
        error: {
          code: "PARSE_ERROR",
          message: `Failed to parse QBO response: ${err instanceof Error ? err.message : String(err)}`,
          retryable: true,
          category: "network",
        },
      };
    }
  }

  /**
   * Classify error for retry logic and UI messaging
   */
  private classifyError(
    httpStatus: number,
    code: string,
    message: string,
    detail?: string
  ): { retryable: boolean; category: QboApiError["category"] } {
    const fullText = `${message} ${detail || ""}`.toLowerCase();

    // Authentication errors - not retryable, need re-auth
    if (httpStatus === 401 || code === "AuthenticationFailed" || fullText.includes("token")) {
      return { retryable: false, category: "auth" };
    }

    // Validation errors - not retryable, need data fix
    if (
      httpStatus === 400 ||
      code === "ValidationFault" ||
      fullText.includes("required") ||
      fullText.includes("invalid") ||
      fullText.includes("must be")
    ) {
      return { retryable: false, category: "validation" };
    }

    // Mapping errors (missing QBO references) - not retryable
    if (
      fullText.includes("customer") && fullText.includes("not found") ||
      fullText.includes("item") && fullText.includes("not found") ||
      fullText.includes("taxcode") && fullText.includes("not found")
    ) {
      return { retryable: false, category: "mapping" };
    }

    // Stale object (optimistic locking) - retryable after refresh
    if (code === "6000" || code === "StaleObjectError" || fullText.includes("stale object")) {
      return { retryable: true, category: "conflict" };
    }

    // Server errors - may be transient, retryable
    if (httpStatus >= 500) {
      return { retryable: true, category: "server" };
    }

    // Not found - not retryable
    if (httpStatus === 404) {
      return { retryable: false, category: "validation" };
    }

    // Default: assume retryable for unknown errors
    return { retryable: true, category: "unknown" };
  }

  // ============================================================
  // CUSTOMER ENDPOINTS
  // ============================================================

  /**
   * Create a new customer in QBO
   */
  async createCustomer<T>(payload: unknown): Promise<QboApiResponse<T>> {
    return this.post<T>("/customer", payload);
  }

  /**
   * Update an existing customer in QBO
   * Note: QBO updates require the full entity with Id and SyncToken
   */
  async updateCustomer<T>(payload: unknown): Promise<QboApiResponse<T>> {
    return this.post<T>("/customer", payload);
  }

  /**
   * Get a customer by ID
   */
  async getCustomer<T>(customerId: string): Promise<QboApiResponse<T>> {
    return this.get<T>(`/customer/${customerId}`);
  }

  /**
   * Query customers using QBO Query Language
   */
  async queryCustomers<T>(query: string): Promise<QboApiResponse<T>> {
    const encodedQuery = encodeURIComponent(query);
    return this.get<T>(`/query?query=${encodedQuery}`);
  }

  // ============================================================
  // INVOICE ENDPOINTS
  // ============================================================

  /**
   * Create a new invoice in QBO
   */
  async createInvoice<T>(payload: unknown): Promise<QboApiResponse<T>> {
    return this.post<T>("/invoice", payload);
  }

  /**
   * Get an invoice by ID
   */
  async getInvoice<T>(invoiceId: string): Promise<QboApiResponse<T>> {
    return this.get<T>(`/invoice/${invoiceId}`);
  }

  /**
   * Query invoices using QBO Query Language
   */
  async queryInvoices<T>(query: string): Promise<QboApiResponse<T>> {
    const encodedQuery = encodeURIComponent(query);
    return this.get<T>(`/query?query=${encodedQuery}`);
  }
}

/**
 * Create a QboClient instance from environment configuration
 * Returns null if QBO is not configured
 */
export function createQboClientFromEnv(tokens: QboTokens): QboClient | null {
  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const environment = (process.env.QBO_ENVIRONMENT as "sandbox" | "production") || "sandbox";

  if (!clientId || !clientSecret) {
    return null;
  }

  return new QboClient(
    { clientId, clientSecret, environment },
    tokens
  );
}

/**
 * Check if QBO integration is configured in environment
 */
export function isQboConfigured(): boolean {
  return Boolean(process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET);
}
