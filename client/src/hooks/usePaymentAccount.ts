/**
 * Payment Account hooks — provider-neutral data layer for the
 * `/settings/payments` page (PR 3, 2026-05-03).
 *
 * Three hooks, one file:
 *
 *   useTenantPaymentAccount()
 *     → GET /api/payments/account. Returns the persisted snapshot for
 *       the authenticated tenant. The account is `null` when the
 *       tenant has not started onboarding; `providerId` is always
 *       present (defaults to "stripe" when the tenant hasn't picked).
 *
 *   useOnboardPaymentAccount()
 *     → POST /api/payments/account/onboard. Mints (or re-fetches) a
 *       Stripe-Connect-style onboarding URL and returns it. The page
 *       redirects window.location to `link.url` on success.
 *
 *   useRefreshPaymentAccount()
 *     → POST /api/payments/account/refresh. Authoritative pull from
 *       the provider; persists locally. Used:
 *         (a) on the post-onboarding return from Stripe (page detects
 *             a URL flag and triggers once);
 *         (b) when the user clicks the "Refresh status" button.
 *
 * Provider-neutral by design — none of these hooks know what
 * "Stripe" is. The `providerId` field is opaque to the UI; the
 * frontend treats `link.url` as a black-box redirect target. No
 * Stripe SDK loaded on the client for this flow.
 *
 * Naming: the hook is `useTenantPaymentAccount` (not just
 * `usePaymentAccount`) because the codebase already overloads
 * "PaymentMethod" between `payments.method` (cash/credit/cheque) and
 * `payment_methods` (saved cards). Adding a clear "Tenant" prefix
 * keeps the new concept distinct in autocomplete + grep.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

// ============================================================================
// Types — mirror the canonical PR1/PR2 server contract.
// ============================================================================

/**
 * Lifecycle enum stamped on the persisted row by
 * `paymentProviderAccountService.normalizeAccountStatus`. The UI
 * never computes this — server is the single source of truth.
 */
export type PaymentAccountStatus =
  | "not_started"
  | "pending"
  | "active"
  | "restricted"
  | "disabled";

/**
 * Persisted account snapshot. Columns mirror
 * `payment_provider_accounts` (PR1 schema) — omit timestamps the UI
 * doesn't render. `requirementsDue` is the raw provider payload
 * (Stripe `requirements` object); the UI extracts only `currently_due`
 * via the page-level helper without parsing further.
 */
export interface TenantPaymentAccount {
  id: string;
  companyId: string;
  provider: string;
  providerAccountId: string | null;
  status: PaymentAccountStatus;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirementsDue: unknown;
  disabledReason: string | null;
  defaultCurrency: string | null;
  country: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TenantPaymentAccountSnapshot {
  account: TenantPaymentAccount | null;
  providerId: string;
}

export interface OnboardingLinkResult {
  link: {
    providerId: string;
    url: string;
    expiresAt: string | null;
  };
  account: TenantPaymentAccount;
}

export interface OnboardPaymentAccountVars {
  /** ISO 3166-1 alpha-2 (e.g. "CA", "US"). The PR2 server schema
   *  validates length 2 + uppercases. */
  country: string;
  /** Where Stripe redirects when the onboarding link expires
   *  mid-flow. Frontend hands this in so it owns the URL convention. */
  refreshUrl: string;
  /** Where Stripe redirects on successful completion. Should include
   *  the `?from=stripe` flag the post-return effect detects. */
  returnUrl: string;
}

export interface RefreshPaymentAccountResult {
  account: TenantPaymentAccount;
}

// ============================================================================
// Canonical query key — exported so mutation onSuccess invalidates
// the same cache slot the read hook owns.
// ============================================================================

export const PAYMENT_ACCOUNT_QUERY_KEY = ["/api/payments/account"] as const;

// ============================================================================
// useTenantPaymentAccount — read snapshot.
// ============================================================================

export function useTenantPaymentAccount() {
  return useQuery<TenantPaymentAccountSnapshot>({
    queryKey: PAYMENT_ACCOUNT_QUERY_KEY,
    // No background-tab polling — onboarding state changes are user-
    // driven (refresh button, post-Stripe-return effect, webhook).
    refetchInterval: false,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });
}

// ============================================================================
// useOnboardPaymentAccount — start / continue onboarding.
// ============================================================================

/**
 * Mutation hook. Resolves the persisted account (creating one at the
 * provider on first call) and returns the one-time onboarding URL the
 * caller should redirect to.
 *
 * The hook does NOT perform the redirect itself — the calling page
 * does, after deciding whether to use `window.location.assign` or
 * `window.open` (today: `assign`, replacing the current tab).
 *
 * On success, also invalidates the read cache so when the user
 * returns to the page (back button before completing onboarding) the
 * snapshot reflects the now-persisted `not_started` → `pending` row.
 */
export function useOnboardPaymentAccount() {
  const qc = useQueryClient();
  return useMutation<OnboardingLinkResult, Error, OnboardPaymentAccountVars>({
    mutationFn: (vars) =>
      apiRequest("/api/payments/account/onboard", {
        method: "POST",
        body: JSON.stringify(vars),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PAYMENT_ACCOUNT_QUERY_KEY });
    },
  });
}

// ============================================================================
// useRefreshPaymentAccount — authoritative provider pull.
// ============================================================================

/**
 * Mutation hook for explicit refresh. The page wires it to BOTH:
 *   1. The "Refresh status" button.
 *   2. A `useEffect` that fires once when the URL contains the
 *      `?from=stripe` flag (post-onboarding return).
 *
 * Surfacing as a mutation (rather than a manual `queryClient.fetchQuery`)
 * lets the page surface `isPending` for the spinner and `error` for
 * the inline warning without re-implementing those states.
 */
export function useRefreshPaymentAccount() {
  const qc = useQueryClient();
  return useMutation<RefreshPaymentAccountResult, Error, void>({
    mutationFn: () =>
      apiRequest("/api/payments/account/refresh", {
        method: "POST",
      }),
    onSuccess: (result) => {
      // Optimistic cache write — the refresh response carries the
      // freshly-stamped account, so we don't need a second GET.
      qc.setQueryData<TenantPaymentAccountSnapshot>(
        PAYMENT_ACCOUNT_QUERY_KEY,
        (prev) => ({
          providerId: prev?.providerId ?? result.account.provider,
          account: result.account,
        }),
      );
      qc.invalidateQueries({ queryKey: PAYMENT_ACCOUNT_QUERY_KEY });
    },
  });
}

// ============================================================================
// 2026-05-04 PR7 — Payments dashboard hooks (read-only).
// ============================================================================
//
// Five hooks over the PR5/PR6/PR7 backend read APIs. Every hook is
// pure-read (no mutations); the dashboard never initiates payouts /
// opens disputes / submits evidence.
//
// Naming: `useTenantPayment*` to keep grep-discoverability and avoid
// collision with the `payments.method` enum + `payment_methods`
// (saved cards) concepts already in the codebase.

// ─── Payouts ────────────────────────────────────────────────────────────────

export type PayoutStatus =
  | "pending"
  | "in_transit"
  | "paid"
  | "failed"
  | "canceled";

export interface TenantPayout {
  id: string;
  companyId: string;
  provider: string;
  paymentProviderAccountId: string;
  providerAccountId: string;
  providerPayoutId: string | null;
  amount: string;
  currency: string;
  status: PayoutStatus;
  arrivalDate: string | null;
  destinationLast4: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  rawProviderStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TenantPayoutSummary {
  pendingTotal: string;
  inTransitTotal: string;
  paidLast30Days: string;
  failedCount: number;
  nextArrivalDate: string | null;
}

export interface ListPayoutsFilters {
  status?: PayoutStatus;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export const PAYMENT_PAYOUTS_QUERY_KEY = ["/api/payments/payouts"] as const;
export const PAYMENT_PAYOUTS_SUMMARY_QUERY_KEY = [
  "/api/payments/payouts/summary",
] as const;

export function useTenantPaymentPayouts(filters: ListPayoutsFilters = {}) {
  const qs = buildQueryString(filters);
  return useQuery<{ payouts: TenantPayout[] }>({
    queryKey: [...PAYMENT_PAYOUTS_QUERY_KEY, qs],
    queryFn: () =>
      apiRequest(`/api/payments/payouts${qs ? `?${qs}` : ""}`, {
        method: "GET",
      }),
    refetchInterval: false,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });
}

export function useTenantPaymentPayoutSummary() {
  return useQuery<TenantPayoutSummary>({
    queryKey: PAYMENT_PAYOUTS_SUMMARY_QUERY_KEY,
    refetchInterval: false,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });
}

// ─── Disputes ───────────────────────────────────────────────────────────────

export type DisputeStatus =
  | "needs_response"
  | "under_review"
  | "won"
  | "lost"
  | "warning_needs_response"
  | "warning_under_review"
  | "warning_closed"
  | "closed";

export interface TenantDispute {
  id: string;
  companyId: string;
  paymentId: string | null;
  invoiceId: string | null;
  provider: string;
  paymentProviderAccountId: string;
  providerAccountId: string;
  providerDisputeId: string | null;
  providerPaymentId: string;
  amount: string;
  currency: string;
  status: DisputeStatus;
  reason: string | null;
  evidenceDueBy: string | null;
  rawProviderStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TenantDisputeSummary {
  needsResponseCount: number;
  underReviewCount: number;
  wonCount: number;
  lostCount: number;
  totalOpenAmount: string;
  nextEvidenceDueBy: string | null;
}

export interface ListDisputesFilters {
  status?: DisputeStatus;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export const PAYMENT_DISPUTES_QUERY_KEY = ["/api/payments/disputes"] as const;
export const PAYMENT_DISPUTES_SUMMARY_QUERY_KEY = [
  "/api/payments/disputes/summary",
] as const;

export function useTenantPaymentDisputes(filters: ListDisputesFilters = {}) {
  const qs = buildQueryString(filters);
  return useQuery<{ disputes: TenantDispute[] }>({
    queryKey: [...PAYMENT_DISPUTES_QUERY_KEY, qs],
    queryFn: () =>
      apiRequest(`/api/payments/disputes${qs ? `?${qs}` : ""}`, {
        method: "GET",
      }),
    refetchInterval: false,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });
}

export function useTenantPaymentDisputeSummary() {
  return useQuery<TenantDisputeSummary>({
    queryKey: PAYMENT_DISPUTES_SUMMARY_QUERY_KEY,
    refetchInterval: false,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });
}

// ─── Transactions ───────────────────────────────────────────────────────────

export interface TenantTransaction {
  id: string;
  receivedAt: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceStatus: string | null;
  customerCompanyId: string | null;
  customerCompanyName: string | null;
  method: string;
  /** Numeric string (positive on payments, negative on refunds/reversals). */
  amount: string;
  paymentType: "payment" | "refund" | "reversal";
  parentPaymentId: string | null;
  paymentProviderAccountId: string | null;
}

export interface ListTransactionsFilters {
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export const PAYMENT_TRANSACTIONS_QUERY_KEY = [
  "/api/payments/transactions",
] as const;

export function useTenantPaymentTransactions(
  filters: ListTransactionsFilters = {},
) {
  const qs = buildQueryString(filters);
  return useQuery<{ transactions: TenantTransaction[] }>({
    queryKey: [...PAYMENT_TRANSACTIONS_QUERY_KEY, qs],
    queryFn: () =>
      apiRequest(`/api/payments/transactions${qs ? `?${qs}` : ""}`, {
        method: "GET",
      }),
    refetchInterval: false,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });
}

// ─── Internal: query-string builder. ────────────────────────────────────────
//
// Tiny enough to inline; wrapping `URLSearchParams` keeps the
// number/undefined coercion in one place so every hook stamps the
// same key set into the query-key array (cache hit consistency).
function buildQueryString(params: Record<string, string | number | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  return sp.toString();
}
