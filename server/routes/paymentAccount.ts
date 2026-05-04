/**
 * Tenant payment-provider account routes — onboarding API surface
 * (PR 2, 2026-05-03).
 *
 * Three thin endpoints over `paymentProviderAccountService`. NO UI in
 * this PR — these routes exist so a future operator / admin can POST
 * to them via curl / a test client and verify the onboarding flow
 * end-to-end before PR3 ships the settings page.
 *
 *   GET  /api/payments/account
 *     → returns the persisted account snapshot for the authenticated
 *       tenant (or null + the resolved providerId when none).
 *       Pure-read — no provider SDK call, no DB write.
 *
 *   POST /api/payments/account/onboard
 *     → idempotent get-or-create + mints a one-time onboarding URL.
 *       Body: { country: "CA" | "US" | ..., refreshUrl, returnUrl }.
 *       Response: { url, expiresAt, account }.
 *
 *   POST /api/payments/account/refresh
 *     → authoritative pull from the provider; stamps the local row.
 *       No body. Returns the refreshed account snapshot.
 *
 * Authorization:
 *   * All routes require an authenticated tenant session and the
 *     ADMIN_ROLES gate (owner | admin). Onboarding sets up the
 *     merchant identity for the entire tenant — non-admins must not
 *     trigger it. RBAC parity with `/api/admin/*` and the legacy
 *     billing-settings paths.
 *   * Tenant scoping is enforced at the service layer; the route
 *     forwards `req.companyId!` (set by `ensureTenantContext`).
 *
 * Rate limiting:
 *   * `onboard` / `refresh` mint provider SDK calls. Per-tenant cap
 *     of 30/min — generous for legitimate retries while still capping
 *     scripted abuse on a compromised session. The read-only
 *     `GET /account` is uncapped (cheap DB read).
 *
 * Provider-neutral seam:
 *   * Routes call `paymentProviderAccountService` only. The service
 *     resolves the provider via `resolveForCompanyAsync` and routes
 *     to the matching adapter. No Stripe SDK, no Stripe-named fields
 *     in the response shape.
 */

import { Router, type Response } from "express";
import { z } from "zod";
import { requireRole } from "../auth/requireRole";
import { ADMIN_ROLES, RESTRICTED_MANAGER_ROLES } from "../auth/roles";
import { asyncHandler } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { type AuthedRequest, rateLimitPerTenant } from "../auth/tenantIsolation";
import { paymentProviderAccountService } from "../services/payments/paymentProviderAccountService";
// 2026-05-04 PR5 — payouts read API (no UI yet; backend-only).
import { paymentPayoutsRepository } from "../storage/paymentPayouts";
import {
  paymentPayoutStatusEnum,
  paymentDisputeStatusEnum,
} from "@shared/schema";
// 2026-05-04 PR6 — disputes read API (no UI yet; backend-only).
import { paymentDisputesRepository } from "../storage/paymentDisputes";
// 2026-05-04 PR7 — tenant-level transactions list for Payments dashboard.
import { paymentRepository } from "../storage/payments";
// 2026-05-04 PR8 — ops anomaly summary (counts-only, tenant-scoped).
import { getTenantWebhookAnomalySummary } from "../storage/paymentWebhookEvents";

const router = Router();

const accountMutationLimiter = rateLimitPerTenant({
  scope: "payment-account-mutation",
  windowMs: 60_000,
  max: 30,
});

// ========================================
// VALIDATION SCHEMAS
// ========================================

/**
 * ISO 3166-1 alpha-2 country code. Stripe Connect requires this on
 * account create. We accept upper or lower case and normalise to
 * upper inside the schema; the adapter passes verbatim.
 */
const onboardSchema = z
  .object({
    country: z
      .string()
      .length(2, "country must be a 2-letter ISO 3166-1 alpha-2 code")
      .transform((v) => v.toUpperCase()),
    /** Where the provider redirects when the onboarding link expires
     *  mid-flow. Required by Stripe; the route layer is the only
     *  place that knows the tenant-facing URL conventions. */
    refreshUrl: z.string().url(),
    /** Where the provider redirects on completion. */
    returnUrl: z.string().url(),
  })
  .strict();

// ========================================
// ROUTES
// ========================================

/**
 * GET /api/payments/account
 *
 * Returns the persisted snapshot for this tenant's provider account
 * (or `null` + the resolved providerId when none has been onboarded
 * yet). Pure-read; no provider SDK call. Drives the future settings
 * page's "Get started" vs "Continue onboarding" vs "Manage" gate.
 */
router.get(
  "/payments/account",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const snapshot = await paymentProviderAccountService.getAccountSnapshot(
      req.companyId!,
    );
    res.json(snapshot);
  }),
);

/**
 * POST /api/payments/account/onboard
 *
 * Idempotent: first call mints a Connect account at the provider AND
 * a one-time onboarding URL. Subsequent calls re-use the persisted
 * account row and mint a fresh URL each time (the URL itself is
 * one-time-use, ~5 min expiry).
 *
 * Tenant flow:
 *   1. Frontend POSTs `{ country, refreshUrl, returnUrl }`.
 *   2. Route returns `{ url, expiresAt, account }`.
 *   3. Frontend redirects window.location to `url`.
 *   4. Stripe-hosted onboarding wizard runs.
 *   5. Stripe redirects to `returnUrl` (success) or `refreshUrl`
 *      (mid-flow expiry → frontend POSTs again to mint a new URL).
 */
router.post(
  "/payments/account/onboard",
  requireRole(ADMIN_ROLES),
  accountMutationLimiter,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const body = validateSchema(onboardSchema, req.body ?? {});
    const result = await paymentProviderAccountService.createOnboardingLink(
      req.companyId!,
      body,
    );
    res.status(200).json(result);
  }),
);

/**
 * POST /api/payments/account/refresh
 *
 * Operator-triggered authoritative pull from the provider. Used:
 *   * After the tenant returns from the onboarding wizard — re-syncs
 *     the local row so the UI reflects the post-onboarding state
 *     without waiting for the `account.updated` webhook to land.
 *   * From an ops "force re-sync" button when the local snapshot
 *     diverges from provider state.
 *
 * Returns 404 (via createError in the service) when no local row
 * exists yet — the route layer surfaces that with the standard
 * error-handler middleware.
 */
router.post(
  "/payments/account/refresh",
  requireRole(ADMIN_ROLES),
  accountMutationLimiter,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const account = await paymentProviderAccountService.retrieveAndSyncAccount(
      req.companyId!,
    );
    res.status(200).json({ account });
  }),
);

// ============================================================================
// 2026-05-04 PR5 — Payout read API.
//
// Both routes are RESTRICTED_MANAGER_ROLES (owner | admin | manager) —
// matches the access pattern of other financial reporting surfaces
// (Tax & Billing settings, Reports). The list/summary endpoints carry
// no PII beyond payout amount + arrival date + last4; ownership info
// (provider account id) is already exposed via the account snapshot.
//
// No mutation routes — Syntraro never initiates payouts. Stripe
// dashboards are the canonical place to schedule / cancel; we only
// mirror what the provider tells us via the `payout.*` webhooks.
// ============================================================================

const payoutsListQuerySchema = z
  .object({
    status: z.enum(paymentPayoutStatusEnum).optional(),
    /** ISO date string (e.g. `"2026-01-01"` or full timestamp). */
    from: z
      .string()
      .optional()
      .refine(
        (v) => v === undefined || !Number.isNaN(Date.parse(v)),
        "from must be an ISO date string",
      ),
    to: z
      .string()
      .optional()
      .refine(
        (v) => v === undefined || !Number.isNaN(Date.parse(v)),
        "to must be an ISO date string",
      ),
    limit: z.coerce.number().int().positive().max(200).optional(),
    offset: z.coerce.number().int().nonnegative().optional(),
  })
  .strict();

/**
 * GET /api/payments/payouts
 *
 * Tenant-scoped payout list. Filters: status, from, to (arrival_date
 * range), limit, offset. Sort: most-recent arrival first (NULLS LAST).
 * Returns the raw payout rows; the future dashboard formats these.
 */
router.get(
  "/payments/payouts",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const q = validateSchema(payoutsListQuerySchema, req.query ?? {});
    const payouts = await paymentPayoutsRepository.listForCompany(
      req.companyId!,
      {
        status: q.status,
        from: q.from ? new Date(q.from) : undefined,
        to: q.to ? new Date(q.to) : undefined,
        limit: q.limit,
        offset: q.offset,
      },
    );
    res.json({ payouts });
  }),
);

/**
 * GET /api/payments/payouts/summary
 *
 * Aggregates for the future dashboard hero — pending / in-transit /
 * paid-30d totals, failed count, next arrival date. Single SQL
 * aggregation in the repository; tenant-scoped.
 */
router.get(
  "/payments/payouts/summary",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const summary = await paymentPayoutsRepository.getSummaryForCompany(
      req.companyId!,
    );
    res.json(summary);
  }),
);

// ============================================================================
// 2026-05-04 PR6 — Dispute read API.
//
// Same access pattern as the payouts routes above: RESTRICTED_MANAGER_ROLES
// (owner | admin | manager). No mutation routes — Syntraro doesn't open
// disputes itself; evidence submission lives in a future PR.
// ============================================================================

const disputesListQuerySchema = z
  .object({
    status: z.enum(paymentDisputeStatusEnum).optional(),
    /** ISO date string (e.g. `"2026-01-01"` or full timestamp). */
    from: z
      .string()
      .optional()
      .refine(
        (v) => v === undefined || !Number.isNaN(Date.parse(v)),
        "from must be an ISO date string",
      ),
    to: z
      .string()
      .optional()
      .refine(
        (v) => v === undefined || !Number.isNaN(Date.parse(v)),
        "to must be an ISO date string",
      ),
    limit: z.coerce.number().int().positive().max(200).optional(),
    offset: z.coerce.number().int().nonnegative().optional(),
  })
  .strict();

/**
 * GET /api/payments/disputes
 *
 * Tenant-scoped dispute list. Filters: status, from, to (created_at
 * range), limit, offset. Sort: most-recent first. Returns the raw
 * dispute rows; the future dashboard formats these.
 */
router.get(
  "/payments/disputes",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const q = validateSchema(disputesListQuerySchema, req.query ?? {});
    const disputes = await paymentDisputesRepository.listForCompany(
      req.companyId!,
      {
        status: q.status,
        from: q.from ? new Date(q.from) : undefined,
        to: q.to ? new Date(q.to) : undefined,
        limit: q.limit,
        offset: q.offset,
      },
    );
    res.json({ disputes });
  }),
);

/**
 * GET /api/payments/disputes/summary
 *
 * Aggregates for the future dashboard hero — needs-response /
 * under-review / won / lost counts, total open amount, next evidence
 * due-by. Single SQL aggregation in the repository; tenant-scoped.
 */
router.get(
  "/payments/disputes/summary",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const summary = await paymentDisputesRepository.getSummaryForCompany(
      req.companyId!,
    );
    res.json(summary);
  }),
);

// ============================================================================
// 2026-05-04 PR7 — Tenant-level Transactions read API.
//
// Returns ONLINE payments (provider_source = 'stripe') for the
// current tenant. Manual / QBO-source rows are excluded by design —
// the dashboard's Transactions tab is "online payments only" per
// PR7 spec ("manual/QBO payments may be excluded unless current API
// includes them clearly").
//
// Includes both top-level payment rows and refund/reversal children
// so operators see the full ledger as it appears on a statement.
// ============================================================================

const transactionsListQuerySchema = z
  .object({
    /** ISO date string. Filters on `payments.received_at`. */
    from: z
      .string()
      .optional()
      .refine(
        (v) => v === undefined || !Number.isNaN(Date.parse(v)),
        "from must be an ISO date string",
      ),
    to: z
      .string()
      .optional()
      .refine(
        (v) => v === undefined || !Number.isNaN(Date.parse(v)),
        "to must be an ISO date string",
      ),
    limit: z.coerce.number().int().positive().max(200).optional(),
    offset: z.coerce.number().int().nonnegative().optional(),
  })
  .strict();

/**
 * GET /api/payments/transactions
 *
 * Tenant-scoped online-payments list. Filters: from/to (received_at),
 * limit, offset. Sort: most-recent received_at first.
 *
 * Response shape: array of safe customer-facing fields. We do NOT
 * surface `provider_event_id`, raw Stripe ids, or qbo_* columns —
 * the dashboard is a customer-facing surface, not an ops console.
 */
router.get(
  "/payments/transactions",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const q = validateSchema(transactionsListQuerySchema, req.query ?? {});
    const transactions =
      await paymentRepository.listOnlineTransactionsForCompany(
        req.companyId!,
        {
          from: q.from ? new Date(q.from) : undefined,
          to: q.to ? new Date(q.to) : undefined,
          limit: q.limit,
          offset: q.offset,
        },
      );
    res.json({ transactions });
  }),
);

// ============================================================================
// 2026-05-04 PR8 — Webhook anomaly summary.
//
// Powers the Payments dashboard's "events requiring attention" banner.
// Counts-only — never returns row contents. Returns two windows so the
// dashboard can show "X in 7 days · Y in 30 days" without two
// round-trips. Tenant-scoped (companyId from session). The same gate
// pattern as the rest of the dashboard read APIs.
// ============================================================================

router.get(
  "/payments/anomalies/summary",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const [last7Days, last30Days] = await Promise.all([
      getTenantWebhookAnomalySummary(req.companyId!, 7),
      getTenantWebhookAnomalySummary(req.companyId!, 30),
    ]);
    res.json({ last7Days, last30Days });
  }),
);

export default router;
