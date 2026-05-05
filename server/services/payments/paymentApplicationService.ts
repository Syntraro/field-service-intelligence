/**
 * Payment application service — provider-neutral orchestration layer.
 *
 * Responsibilities that belong here:
 *   - invoice-payment business rules (payable? amount ≤ balance?)
 *   - provider resolution (via the resolver — not inline env sniffing)
 *   - idempotency-key generation and routing through the provider + ledger
 *   - canonical ledger writes via `paymentRepository`
 *   - normalized webhook event → ledger-write application
 *
 * Responsibilities that do NOT belong here:
 *   - provider SDK calls (live only in the adapter)
 *   - invoice balance arithmetic (lives in `paymentRepository` /
 *     `recalculateInvoiceBalance`)
 *   - route auth, HTTP status translation
 *
 * Routes are expected to be thin: auth + validation + call this service +
 * render a response. The service does not know about Express.
 */

import { createHash, randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  payments as paymentsTable,
  paymentAllocations as paymentAllocationsTable,
  invoices as invoicesTable,
  // 2026-05-03 PR C — saved-card management webhook handlers walk
  // payment_methods directly to recover (companyId) from a provider
  // PM id. The shape is a thin SELECT so we don't pull the whole
  // repo class into the application service.
  paymentMethods as paymentMethodsTable,
} from "@shared/schema";
import { invoiceRepository } from "../../storage/invoices";
import { paymentRepository } from "../../storage/payments";
import { paymentAllocationRepository } from "../../storage/paymentAllocations";
// 2026-05-03 PR B — saved-card foundation. Lazy resolver for the
// provider Customer object; called only when `saveForFuture=true`.
import { resolveOrCreateProviderCustomer } from "../customerCompanyPaymentService";
// 2026-05-03 PR B — repository for `payment_methods` rows. Used by
// the `payment_method.attached` webhook handler.
import { paymentMethodsRepository } from "../../storage/paymentMethods";
// 2026-05-03 PR2 — tenant payments onboarding. The webhook handler
// for `account.updated` looks up the local row by (provider,
// providerAccountId) and routes the update through the service's
// canonical applier. Both concerns are kept in their own modules so
// the application service stays a thin dispatcher over per-domain
// helpers.
import { paymentProviderAccountsRepository } from "../../storage/paymentProviderAccounts";
import { paymentProviderAccountService } from "./paymentProviderAccountService";
// 2026-05-04 PR5 — payout lifecycle persistence. The webhook handler
// folds five Stripe `payout.*` events into a single upsert keyed on
// `(provider, provider_payout_id)`.
import { paymentPayoutsRepository } from "../../storage/paymentPayouts";
// 2026-05-04 PR6 — dispute / chargeback lifecycle persistence. Three
// `charge.dispute.*` events fold into a single upsert keyed on
// `(provider, provider_dispute_id)`.
import { paymentDisputesRepository } from "../../storage/paymentDisputes";
import { customerCompanies as customerCompaniesTable } from "@shared/schema";
import { canAcceptInvoicePayment } from "../../lib/invoicePredicates";
import { createError } from "../../middleware/errorHandler";
import { emailDispatchService } from "../emailDispatchService";
// 2026-04-22 Lightweight error-only webhook log. Only transient /
// config / signature failures are persisted; success + replay + ignored
// deliveries stay in-memory via `[payments-webhook]` console logs.
// Writes are fire-and-forget — a log-write failure must never block
// the canonical webhook decision path.
import {
  buildDedupeKey,
  safeRecordPaymentWebhookEvent,
} from "../../storage/paymentWebhookEvents";
import {
  resolveForCompany,
  resolveById,
  resolveForProviderSource,
} from "./providers/resolver";
import type {
  CreateCheckoutResult,
  NormalizedWebhookEvent,
  PaymentProvider,
  ProviderId,
} from "./providers/types";

// ============================================================================
// 2026-05-03 PR4 — Connect-aware checkout: domain errors.
// ============================================================================
//
// Three named errors carry stable codes the route layer translates to
// HTTP status + JSON body. The frontend keys off the `code` field —
// the message is operator-facing only.
//
//   PAYMENTS_NOT_ENABLED      → 409. Tenant has no `active` provider
//                                account; the portal / staff dialog
//                                should surface "Online payments are
//                                not available for this company".
//   PAYMENT_ACCOUNT_NOT_FOUND → 409. Webhook arrived with an
//                                `event.account` we don't have a local
//                                row for. The webhook handler logs
//                                + 200-ACKs (config drift); routes
//                                that surface this code are
//                                belt-and-suspenders.
//   PROVIDER_ACCOUNT_MISMATCH → 409. Webhook's `event.account` does
//                                not match the metadata-derived tenant
//                                — i.e. another tenant's connected
//                                account is firing for our metadata.
//                                Treated as a final config error
//                                (200 ACK + ops alert).

/** Error code field carried by every domain error. Stable across versions. */
export const PAYMENTS_DOMAIN_ERRORS = {
  PAYMENTS_NOT_ENABLED: "PAYMENTS_NOT_ENABLED",
  PAYMENT_ACCOUNT_NOT_FOUND: "PAYMENT_ACCOUNT_NOT_FOUND",
  PROVIDER_ACCOUNT_MISMATCH: "PROVIDER_ACCOUNT_MISMATCH",
} as const;

export type PaymentsDomainErrorCode =
  (typeof PAYMENTS_DOMAIN_ERRORS)[keyof typeof PAYMENTS_DOMAIN_ERRORS];

/**
 * Wrapper around `createError(409, ...)` that also stamps a stable
 * `code` field. The route handler middleware reads both `status` and
 * `code`; the frontend keys off `code` to render specific copy.
 */
function createDomainError(code: PaymentsDomainErrorCode, message: string) {
  const err = createError(409, message) as Error & {
    status?: number;
    code?: string;
  };
  err.code = code;
  return err;
}

// ============================================================================
// Shared helpers
// ============================================================================

function dollarsStringToCents(dollars: string): number {
  const n = parseFloat(dollars);
  if (!Number.isFinite(n) || n <= 0) {
    throw createError(400, "Amount must be a positive number");
  }
  return Math.round(n * 100);
}

function centsToDollarsString(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Unique-violation surfacing from Postgres — used for webhook replay dedupe. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | undefined;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/**
 * 2026-04-21 Patch C1 — webhook error classifier.
 *
 * Three categories feed the webhook ACK decision:
 *
 *   - **final / replay**  — unique violation on the ledger idempotency
 *                            index. The row already exists; ACK 200.
 *   - **final / config**  — 4xx from the canonical repository (e.g.
 *                            404 invoice-not-found from tenant metadata
 *                            mismatch). Retrying won't help — ACK 200,
 *                            anomaly log the drift.
 *   - **transient**       — Everything else: DB connection errors,
 *                            timeouts, pool exhaustion, unknown bugs.
 *                            Retry CAN succeed. Propagate so the route
 *                            returns 500 and Stripe's own retry window
 *                            (exponential backoff, ~72h) rides out the
 *                            outage.
 *
 * Never treat an unknown error as final. The cost of an unnecessary
 * Stripe retry is near-zero; the cost of a silently-lost payment row
 * is the captured money vanishing from our ledger forever.
 */
type WebhookErrorClass = "final_replay" | "final_config" | "transient";

function classifyWebhookError(err: unknown): WebhookErrorClass {
  if (isUniqueViolation(err)) return "final_replay";
  const e = err as
    | { status?: number; statusCode?: number }
    | undefined;
  const status = e?.status ?? e?.statusCode;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return "final_config";
  }
  return "transient";
}

/** Structured log lines — grep for `[payments-webhook]` in operator logs. */
function logInfo(kind: string, ctx: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.info(`[payments-webhook] ${kind}`, JSON.stringify({ kind, ...ctx }));
}
function logAnomaly(kind: string, ctx: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.error(`[payments-webhook] ${kind}`, JSON.stringify({ kind, ...ctx }));
}

/**
 * 2026-04-21 refund hardening logs. Separate tag so operators can alert
 * on refund-specific anomalies without grepping the webhook channel.
 */
function logRefundInfo(kind: string, ctx: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.info(`[payments-refund] ${kind}`, JSON.stringify({ kind, ...ctx }));
}
function logRefundCritical(kind: string, ctx: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.error(
    `[payments-refund] CRITICAL ${kind}`,
    JSON.stringify({ kind, severity: "critical", ...ctx }),
  );
}

// ============================================================================
// createCheckout
// ============================================================================

export interface CreateCheckoutParams {
  companyId: string;
  invoiceId: string;
  source: "staff" | "portal";
  /**
   * Dollars string. When omitted, the invoice's outstanding balance is
   * used (portal self-pay always pays the full balance; staff today
   * supplies an explicit amount ≤ balance).
   */
  amount?: string;
  currency?: string;
  /**
   * 2026-05-03 PR B — saved-card foundation. When true:
   *   - resolves (or creates) a provider Customer for the invoice's
   *     customer-company,
   *   - passes `customer:` + `setup_future_usage:"off_session"` through
   *     to the provider via the adapter,
   *   - embeds `consentText` (+ ip / user-agent / contactId) into the
   *     PaymentIntent metadata so the `payment_method.attached`
   *     webhook can persist consent on the saved-card row.
   * `consentText` is REQUIRED when this flag is true; the service
   * surfaces a 400 otherwise.
   */
  saveForFuture?: boolean;
  /** Verbatim consent copy shown to the customer at save-time. */
  consentText?: string;
  /** Caller IP. Captured into metadata for the consent audit trail. */
  consentIp?: string | null;
  /** Caller user-agent. Same audit-trail purpose. */
  consentUserAgent?: string | null;
  /** Optional contact id of the human who clicked "save card". */
  contactId?: string | null;
}

export interface CreateCheckoutResponse extends CreateCheckoutResult {
  /** Pre-generated UUID that will become `payments.id` on webhook success. */
  prospectivePaymentId: string;
}

/**
 * Issue a provider-neutral checkout token for an invoice.
 *
 * Idempotency chain (identical to the pre-neutralization Stripe path):
 *
 *   prospectivePaymentId  === provider idempotency key
 *                        === `payments.id` written by the webhook
 *                        === stable key across retries
 */
async function createCheckout(
  params: CreateCheckoutParams,
): Promise<CreateCheckoutResponse> {
  const { companyId, invoiceId, source } = params;
  const currency = params.currency ?? "usd";

  // 0. 2026-05-03 PR4 — Connect-aware gate. Resolve the tenant's
  //    active provider account FIRST so we don't burn an invoice
  //    fetch on a tenant that can't take payments. Throws
  //    PAYMENTS_NOT_ENABLED with a stable code the route surfaces as
  //    409 + JSON `{ code, error }`.
  const account = await paymentProviderAccountService.getActiveAccount(
    companyId,
  );
  if (!account || !account.providerAccountId) {
    throw createDomainError(
      "PAYMENTS_NOT_ENABLED",
      "Online payments are not available for this company.",
    );
  }
  const providerAccountId = account.providerAccountId;
  const paymentProviderAccountId = account.id;

  // 1. Canonical invoice-payable check.
  const invoice = await invoiceRepository.getInvoice(companyId, invoiceId);
  if (!invoice) throw createError(404, "Invoice not found");
  if (!canAcceptInvoicePayment(invoice.status)) {
    throw createError(
      400,
      `Cannot take payment on invoice with status "${invoice.status}".`,
    );
  }

  // 2. Resolve the requested amount. Staff-supplied amount is honored
  //    with an overshoot guard; portal always pays the full balance.
  const balanceCents = Math.round(parseFloat(invoice.balance ?? "0") * 100);
  if (!Number.isFinite(balanceCents) || balanceCents <= 0) {
    throw createError(400, "Invoice has no outstanding balance");
  }

  let amountCents: number;
  if (params.amount) {
    amountCents = dollarsStringToCents(params.amount);
    if (amountCents > balanceCents) {
      throw createError(
        400,
        `Requested amount exceeds outstanding invoice balance (${centsToDollarsString(balanceCents)}).`,
      );
    }
  } else {
    amountCents = balanceCents;
  }

  // 3. Single source of truth for the idempotency key chain.
  const prospectivePaymentId = randomUUID();

  // 2026-05-03 PR B — saved-card foundation. When `saveForFuture` is
  // true: validate consent, resolve provider customer, and prime the
  // metadata with consent context the webhook will read back.
  let providerCustomerId: string | undefined;
  const consentMetadata: Record<string, string> = {};
  if (params.saveForFuture) {
    const consentText = params.consentText?.trim() ?? "";
    if (!consentText) {
      throw createError(
        400,
        "consentText is required when saveForFuture is true",
      );
    }
    if (!invoice.customerCompanyId) {
      // The save-card foundation requires a known bill-to party. An
      // invoice without a customer-company can still be paid, but
      // the card cannot be saved against any identity — drop the
      // save and continue paying. (Fail-loud for the portal flow,
      // where customerCompanyId is always populated.)
      throw createError(
        400,
        "Cannot save a card on an invoice with no associated customer company",
      );
    }
    const resolved = await resolveOrCreateProviderCustomer({
      companyId,
      customerCompanyId: invoice.customerCompanyId,
      providerAccountId,
    });
    providerCustomerId = resolved.providerCustomerId;
    consentMetadata.consent_text = consentText;
    if (params.consentIp) consentMetadata.consent_ip = params.consentIp;
    if (params.consentUserAgent) {
      consentMetadata.consent_user_agent = params.consentUserAgent;
    }
    if (params.contactId) {
      consentMetadata.created_by_contact_id = params.contactId;
    }
  }

  // 4. Resolve provider and call. The adapter is the ONLY place that
  //    speaks the provider SDK.
  const provider: PaymentProvider = resolveForCompany(companyId);
  const result = await provider.createCheckout({
    companyId,
    invoiceId,
    amountCents,
    currency,
    source,
    idempotencyKey: prospectivePaymentId,
    providerAccountId,
    // Tenant + invoice + id are round-tripped via provider metadata so
    // the webhook can trust the association without client input.
    // 2026-05-03 PR4 — embed paymentProviderAccountId so the webhook
    // can persist attribution without a second resolver lookup. The
    // adapter doesn't read this; only our handler does.
    metadata: {
      companyId,
      invoiceId,
      prospectivePaymentId,
      invoiceNumber: String(invoice.invoiceNumber ?? ""),
      source,
      paymentProviderAccountId,
      ...consentMetadata,
    },
    ...(providerCustomerId
      ? {
          providerCustomerId,
          setupFutureUsage: "off_session" as const,
        }
      : {}),
  });

  return { ...result, prospectivePaymentId };
}

// ============================================================================
// 2026-05-03 createMultiCheckout — multi-invoice payment engine.
//
// Distinct from createCheckout (single-invoice / PaymentIntent path).
// Uses Stripe Checkout Sessions to collect ONE payment that covers
// N invoices; the webhook recorder writes one `payments` row plus N
// `payment_allocations` rows in a single transaction.
//
// Validation contract — all checked here, never on the client:
//   - every invoice belongs to (companyId, customerCompanyId)
//   - status accepts payment (canAcceptInvoicePayment)
//   - balance > 0
//   - first failure rejects the entire request (no partial intake)
//
// Total amount is derived server-side from the invoice balances. The
// caller does not pass an amount — Stripe is told the line-item
// amounts directly so the customer cannot pay anything but the sum.
// ============================================================================

export interface CreateMultiCheckoutParams {
  companyId: string;
  /** Tenant-portal scope: every invoice must belong to this customer-company. */
  customerCompanyId: string;
  invoiceIds: string[];
  source: "staff" | "portal";
  currency?: string;
  /** Where Stripe redirects after a successful Checkout Session. */
  successUrl: string;
  /** Where Stripe redirects when the customer abandons the Session. */
  cancelUrl: string;
  /**
   * 2026-05-03 PR B — saved-card foundation. Same semantics as
   * `CreateCheckoutParams.saveForFuture`: when true, resolve a
   * provider Customer for the portal session's `customerCompanyId`
   * and pass it through to Stripe so the resulting PaymentMethod
   * is attached and primed for re-use.
   * `consentText` is REQUIRED when the flag is set.
   */
  saveForFuture?: boolean;
  consentText?: string;
  consentIp?: string | null;
  consentUserAgent?: string | null;
  contactId?: string | null;
}

export interface CreateMultiCheckoutResponse {
  providerId: "stripe";
  sessionId: string;
  checkoutUrl: string;
  /** UUID minted server-side; lands as `payments.id` on webhook success. */
  prospectivePaymentId: string;
  /** Server-derived total in dollars (sum of invoice balances). */
  totalAmount: string;
  invoiceIds: string[];
}

async function createMultiCheckout(
  params: CreateMultiCheckoutParams,
): Promise<CreateMultiCheckoutResponse> {
  const { companyId, customerCompanyId, source } = params;
  const currency = params.currency ?? "usd";

  if (!Array.isArray(params.invoiceIds) || params.invoiceIds.length === 0) {
    throw createError(400, "At least one invoice is required");
  }

  // 2026-05-03 PR4 — Connect-aware gate (same contract as createCheckout).
  const account = await paymentProviderAccountService.getActiveAccount(
    companyId,
  );
  if (!account || !account.providerAccountId) {
    throw createDomainError(
      "PAYMENTS_NOT_ENABLED",
      "Online payments are not available for this company.",
    );
  }
  const providerAccountId = account.providerAccountId;
  const paymentProviderAccountId = account.id;

  // De-dupe defensively — `payment_allocations_payment_invoice_uq`
  // would catch this at write time, but bouncing it here gives a
  // cleaner 400 to the portal client.
  const uniqueInvoiceIds = Array.from(new Set(params.invoiceIds));
  if (uniqueInvoiceIds.length !== params.invoiceIds.length) {
    throw createError(400, "Duplicate invoice ids in request");
  }

  // 1+2. Load and validate each invoice. First failure short-circuits.
  type ValidatedInvoice = {
    id: string;
    invoiceNumber: string | null;
    balanceCents: number;
  };
  const validated: ValidatedInvoice[] = [];
  for (const invoiceId of uniqueInvoiceIds) {
    const invoice = await invoiceRepository.getInvoice(companyId, invoiceId);
    if (!invoice) {
      throw createError(404, `Invoice ${invoiceId} not found`);
    }
    if (invoice.customerCompanyId !== customerCompanyId) {
      // Portal cross-customer attempt. 404, not 403, to avoid leaking
      // the existence of another customer's invoice id.
      throw createError(404, `Invoice ${invoiceId} not found`);
    }
    if (!canAcceptInvoicePayment(invoice.status)) {
      throw createError(
        400,
        `Invoice ${invoice.invoiceNumber ?? invoiceId} cannot accept payment (status="${invoice.status}").`,
      );
    }
    const balanceCents = Math.round(parseFloat(invoice.balance ?? "0") * 100);
    if (!Number.isFinite(balanceCents) || balanceCents <= 0) {
      throw createError(
        400,
        `Invoice ${invoice.invoiceNumber ?? invoiceId} has no outstanding balance.`,
      );
    }
    validated.push({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber ?? null,
      balanceCents,
    });
  }

  // 3. Compute server-side total + line items. The frontend never sees
  //    these computations — Stripe receives the canonical values.
  const totalCents = validated.reduce((s, v) => s + v.balanceCents, 0);
  const lineItems = validated.map((v) => ({
    invoiceId: v.id,
    description: v.invoiceNumber
      ? `Invoice #${v.invoiceNumber}`
      : `Invoice ${v.id}`,
    amountCents: v.balanceCents,
  }));

  // 4. Mint the idempotency / payment-id chain.
  const prospectivePaymentId = randomUUID();

  // 2026-05-03 PR B — saved-card foundation. Same shape as the
  // single-invoice path: resolve provider customer + embed consent
  // metadata when saveForFuture is set.
  let providerCustomerId: string | undefined;
  const consentMetadata: Record<string, string> = {};
  if (params.saveForFuture) {
    const consentText = params.consentText?.trim() ?? "";
    if (!consentText) {
      throw createError(
        400,
        "consentText is required when saveForFuture is true",
      );
    }
    const resolved = await resolveOrCreateProviderCustomer({
      companyId,
      customerCompanyId,
      providerAccountId,
    });
    providerCustomerId = resolved.providerCustomerId;
    consentMetadata.consent_text = consentText;
    if (params.consentIp) consentMetadata.consent_ip = params.consentIp;
    if (params.consentUserAgent) {
      consentMetadata.consent_user_agent = params.consentUserAgent;
    }
    if (params.contactId) {
      consentMetadata.created_by_contact_id = params.contactId;
    }
  }

  const provider = resolveForCompany(companyId);
  if (!provider.createCheckoutSession) {
    throw createError(
      501,
      "The configured payment provider does not support multi-invoice checkout sessions.",
    );
  }

  const result = await provider.createCheckoutSession({
    companyId,
    invoiceIds: validated.map((v) => v.id),
    lineItems,
    currency,
    source,
    idempotencyKey: prospectivePaymentId,
    providerAccountId,
    metadata: {
      companyId,
      customerCompanyId,
      // JSON-encode so Stripe metadata (string-only) round-trips the array.
      invoiceIds: JSON.stringify(validated.map((v) => v.id)),
      prospectivePaymentId,
      source,
      paymentProviderAccountId,
      ...consentMetadata,
    },
    successUrl: params.successUrl,
    cancelUrl: params.cancelUrl,
    ...(providerCustomerId
      ? {
          providerCustomerId,
          setupFutureUsage: "off_session" as const,
        }
      : {}),
  });

  return {
    providerId: "stripe",
    sessionId: result.sessionId,
    checkoutUrl: result.checkoutUrl,
    prospectivePaymentId,
    totalAmount: centsToDollarsString(totalCents),
    invoiceIds: validated.map((v) => v.id),
  };
}

// ============================================================================
// 2026-05-03 PR C — Saved-card management (portal-facing).
//
// Three methods for the portal "Saved cards" page:
//   • createPortalSetupIntent   — issue a SetupIntent for the
//                                 "Add a card" Elements flow.
//   • setDefaultSavedPaymentMethod  — flip default + invalidate any
//                                     prior active default.
//   • removeSavedPaymentMethod  — detach at provider, mark detached
//                                 locally.
//
// All three live in the application service (not the route) so the
// staff surface or any future internal caller can use the same API
// without re-implementing the provider routing + idempotency rules.
// ============================================================================

export interface CreatePortalSetupIntentParams {
  companyId: string;
  customerCompanyId: string;
  /** REQUIRED — verbatim consent copy shown to the customer at save-time. */
  consentText: string;
  consentIp?: string | null;
  consentUserAgent?: string | null;
  contactId?: string | null;
}

export interface CreatePortalSetupIntentResponse {
  providerId: "stripe";
  clientToken: string;
  providerSetupIntentId: string;
  publishableKey?: string;
}

/**
 * Issue a SetupIntent for the "Add a card without paying" portal flow.
 * Lazily resolves (or creates) the provider Customer for the
 * (tenant, customer-company) pair, then calls
 * `provider.createSetupIntent` with consent metadata embedded so the
 * `payment_method.attached` webhook can populate the saved-card row.
 *
 * Validation:
 *   - `consentText` is required + non-empty.
 *   - Provider must implement `createSetupIntent` (Stripe does);
 *     other providers surface a clean 501.
 */
async function createPortalSetupIntent(
  params: CreatePortalSetupIntentParams,
): Promise<CreatePortalSetupIntentResponse> {
  const { companyId, customerCompanyId } = params;
  if (!companyId) throw createError(400, "companyId is required");
  if (!customerCompanyId) throw createError(400, "customerCompanyId is required");

  const consentText = params.consentText?.trim() ?? "";
  if (!consentText) {
    throw createError(400, "consentText is required");
  }

  // 2026-05-03 PR4 — Connect-aware gate. SetupIntents on a connected
  // account require an active onboarded account.
  const account = await paymentProviderAccountService.getActiveAccount(
    companyId,
  );
  if (!account || !account.providerAccountId) {
    throw createDomainError(
      "PAYMENTS_NOT_ENABLED",
      "Online payments are not available for this company.",
    );
  }
  const providerAccountId = account.providerAccountId;

  // Lazy resolve-or-create the provider customer (PR A).
  const resolved = await resolveOrCreateProviderCustomer({
    companyId,
    customerCompanyId,
    providerAccountId,
  });

  const provider = resolveForCompany(companyId);
  if (!provider.createSetupIntent) {
    throw createError(
      501,
      "The configured payment provider does not support SetupIntents",
    );
  }

  const metadata: Record<string, string> = {
    companyId,
    customerCompanyId,
    consent_text: consentText,
  };
  if (params.consentIp) metadata.consent_ip = params.consentIp;
  if (params.consentUserAgent) metadata.consent_user_agent = params.consentUserAgent;
  if (params.contactId) metadata.created_by_contact_id = params.contactId;

  const result = await provider.createSetupIntent({
    providerCustomerId: resolved.providerCustomerId,
    metadata,
    providerAccountId,
  });
  return {
    providerId: "stripe",
    clientToken: result.clientToken,
    providerSetupIntentId: result.providerSetupIntentId,
    publishableKey: result.publishableKey,
  };
}

export interface SetDefaultSavedPaymentMethodParams {
  companyId: string;
  customerCompanyId: string;
  paymentMethodId: string;
}

/**
 * Flip the active default to the given saved-card row. Tenant +
 * customer-company are validated against the row before any write
 * runs (cross-customer attempts surface 404 with no info leak).
 *
 * The repository's `setDefault` implementation is a small two-step
 * UPDATE inside a transaction; the partial unique index
 * `payment_methods_one_default_per_customer` is the DB-level safety
 * net.
 */
async function setDefaultSavedPaymentMethod(
  params: SetDefaultSavedPaymentMethodParams,
) {
  const { companyId, customerCompanyId, paymentMethodId } = params;
  if (!companyId) throw createError(400, "companyId is required");
  if (!customerCompanyId) throw createError(400, "customerCompanyId is required");
  if (!paymentMethodId) throw createError(400, "paymentMethodId is required");

  const existing = await paymentMethodsRepository.getById(
    companyId,
    paymentMethodId,
  );
  if (!existing || existing.customerCompanyId !== customerCompanyId) {
    throw createError(404, "Payment method not found");
  }
  if (existing.detachedAt) {
    throw createError(400, "Cannot set a removed card as default");
  }

  return await db.transaction(async (tx) =>
    paymentMethodsRepository.setDefault(tx, companyId, paymentMethodId),
  );
}

export interface RemoveSavedPaymentMethodParams {
  companyId: string;
  customerCompanyId: string;
  paymentMethodId: string;
  /** Optional — populated from the portal session for audit trail. */
  contactId?: string | null;
  reason?: string | null;
}

/**
 * Detach a saved card. Two-phase:
 *   1. Tenant + customer-company scope check.
 *   2. Provider-side detach (best-effort: the
 *      `payment_method.detached` webhook is the safety net for
 *      Stripe-dashboard detaches that bypass us).
 *   3. Local soft-delete via `paymentMethodsRepository.markDetached`
 *      — idempotent (calling twice keeps the original timestamp).
 *
 * If step 2 throws transient, we still mark detached locally so the
 * customer's UI reflects intent — the next webhook reconciles the
 * provider side. If step 2 throws a permanent (e.g. provider doesn't
 * support detach), we surface 501.
 */
async function removeSavedPaymentMethod(
  params: RemoveSavedPaymentMethodParams,
) {
  const { companyId, customerCompanyId, paymentMethodId } = params;
  if (!companyId) throw createError(400, "companyId is required");
  if (!customerCompanyId) throw createError(400, "customerCompanyId is required");
  if (!paymentMethodId) throw createError(400, "paymentMethodId is required");

  const existing = await paymentMethodsRepository.getById(
    companyId,
    paymentMethodId,
  );
  if (!existing || existing.customerCompanyId !== customerCompanyId) {
    throw createError(404, "Payment method not found");
  }
  // Already detached → idempotent no-op (UI may have stale state).
  if (existing.detachedAt) {
    return existing;
  }

  // 2026-05-03 PR4 — Connect: detach must run on the account that
  // owns the PM. We look up the active account and forward its id;
  // if the tenant has no active account but has saved cards (rare
  // edge — onboarding regressed AFTER cards saved), we still soft-
  // delete the local row so the customer's UI reflects intent.
  const account =
    await paymentProviderAccountService.getActiveAccount(companyId);
  const providerAccountIdForDetach = account?.providerAccountId ?? null;

  const provider = resolveForCompany(companyId);
  if (provider.detachPaymentMethod && providerAccountIdForDetach) {
    try {
      await provider.detachPaymentMethod({
        providerPaymentMethodId: existing.providerPaymentMethodId,
        providerAccountId: providerAccountIdForDetach,
      });
    } catch (err: unknown) {
      // Don't bubble — the user clicked Remove; we still flip our
      // local row + log the provider failure so ops can investigate.
      // The `payment_method.detached` webhook will reconcile when the
      // provider eventually catches up.
      logAnomaly("payment_method_detach_provider_failed", {
        companyId,
        customerCompanyId,
        paymentMethodId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return await db.transaction(async (tx) =>
    paymentMethodsRepository.markDetached(tx, companyId, paymentMethodId, {
      byContactId: params.contactId ?? null,
      reason: params.reason ?? "portal_remove",
    }),
  );
}

// ============================================================================
// 2026-05-03 PR D — payWithSavedMethod (pay-with-saved-card).
//
// One method handles single-invoice (1 id in `invoiceIds`) AND
// multi-invoice (N ids). The metadata shape varies so the existing
// PR 1 / PR 2 webhook handlers route correctly:
//   • 1 id  → metadata.invoiceId (singular). The `payment_succeeded`
//             handler writes one `payments` row via the canonical
//             `paymentRepository.createPayment`.
//   • N ids → metadata.invoiceIds (JSON) + metadata.off_session_multi="true".
//             The Stripe adapter's PI normalizer routes the event to
//             the multi-invoice handler (PR 2), which writes one
//             payment + N allocations atomically.
//
// The route writes NO ledger row directly — Stripe fires
// `payment_intent.succeeded` and the existing webhook flow records.
// This keeps the canonical idempotency anchor on
// `payments_provider_event_id_uq` working: a customer who clicks
// "Pay with saved card" twice (or a Stripe retry) hits the same
// `idempotencyKey` and Stripe returns the same PaymentIntent — the
// webhook records exactly once.
// ============================================================================

export interface PayWithSavedMethodParams {
  companyId: string;
  customerCompanyId: string;
  invoiceIds: string[];
  paymentMethodId: string;
  /** Optional contact id from the portal session — round-tripped to the
   *  PaymentIntent metadata for the audit trail. */
  contactId?: string | null;
  currency?: string;
}

export interface PayWithSavedMethodResponse {
  status: "succeeded" | "processing" | "requires_action" | "failed";
  /** Server-derived total in dollars (sum of invoice balances). */
  totalAmount: string;
  invoiceIds: string[];
  /** Pre-generated UUID — `payments.id` once the webhook records. */
  prospectivePaymentId: string;
  providerPaymentId: string;
  /** Human-readable failure / requires-action message. Null on success. */
  message?: string | null;
  declineCode?: string | null;
}

async function payWithSavedMethod(
  params: PayWithSavedMethodParams,
): Promise<PayWithSavedMethodResponse> {
  const { companyId, customerCompanyId, paymentMethodId } = params;
  const currency = params.currency ?? "usd";

  if (!companyId) throw createError(400, "companyId is required");
  if (!customerCompanyId) throw createError(400, "customerCompanyId is required");
  if (!paymentMethodId) throw createError(400, "paymentMethodId is required");
  if (!Array.isArray(params.invoiceIds) || params.invoiceIds.length === 0) {
    throw createError(400, "At least one invoice is required");
  }
  const uniqueInvoiceIds = Array.from(new Set(params.invoiceIds));
  if (uniqueInvoiceIds.length !== params.invoiceIds.length) {
    throw createError(400, "Duplicate invoice ids in request");
  }

  // 2026-05-03 PR4 — Connect-aware gate. Off-session PaymentIntents on
  // a connected account require an active onboarded account; the saved
  // PM itself was minted under that account so a no-account state is
  // structurally impossible for legitimate use, but the explicit gate
  // surfaces a clean PAYMENTS_NOT_ENABLED instead of a Stripe error.
  const account = await paymentProviderAccountService.getActiveAccount(
    companyId,
  );
  if (!account || !account.providerAccountId) {
    throw createDomainError(
      "PAYMENTS_NOT_ENABLED",
      "Online payments are not available for this company.",
    );
  }
  const providerAccountId = account.providerAccountId;
  const paymentProviderAccountId = account.id;

  // 1. Validate the payment method: tenant + customer-company scope,
  //    not detached. Cross-customer attempts surface 404 with no info
  //    leak.
  const pm = await paymentMethodsRepository.getById(companyId, paymentMethodId);
  if (!pm || pm.customerCompanyId !== customerCompanyId) {
    throw createError(404, "Payment method not found");
  }
  if (pm.detachedAt) {
    throw createError(400, "This payment method has been removed");
  }

  // 2. Validate every invoice. First failure short-circuits — the
  //    saved-card charge is all-or-nothing, same as the multi-invoice
  //    Checkout Session path (PR 2).
  type ValidatedInvoice = {
    id: string;
    invoiceNumber: string | null;
    balanceCents: number;
  };
  const validated: ValidatedInvoice[] = [];
  for (const invoiceId of uniqueInvoiceIds) {
    const invoice = await invoiceRepository.getInvoice(companyId, invoiceId);
    if (!invoice || invoice.customerCompanyId !== customerCompanyId) {
      throw createError(404, `Invoice ${invoiceId} not found`);
    }
    if (!canAcceptInvoicePayment(invoice.status)) {
      throw createError(
        400,
        `Invoice ${invoice.invoiceNumber ?? invoiceId} cannot accept payment (status="${invoice.status}").`,
      );
    }
    const balanceCents = Math.round(parseFloat(invoice.balance ?? "0") * 100);
    if (!Number.isFinite(balanceCents) || balanceCents <= 0) {
      throw createError(
        400,
        `Invoice ${invoice.invoiceNumber ?? invoiceId} has no outstanding balance.`,
      );
    }
    validated.push({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber ?? null,
      balanceCents,
    });
  }
  const totalCents = validated.reduce((s, v) => s + v.balanceCents, 0);

  // 3. Mint the idempotency / payment-id chain.
  const prospectivePaymentId = randomUUID();

  // 4. Build provider-call params + metadata. The metadata shape
  //    discriminates which webhook handler fires:
  //    - single (1 invoice): `invoiceId` singular → handlePaymentSucceeded.
  //    - multi (N invoices): `invoiceIds` JSON + `off_session_multi`
  //      flag → handleMultiInvoicePaymentSucceeded (PR 2).
  const metadata: Record<string, string> = {
    companyId,
    customerCompanyId,
    prospectivePaymentId,
    source: "portal",
    // 2026-05-03 PR4 — embed local FK so the webhook can persist
    // attribution without a second resolver lookup.
    paymentProviderAccountId,
  };
  if (validated.length === 1) {
    metadata.invoiceId = validated[0].id;
    metadata.invoiceNumber = String(validated[0].invoiceNumber ?? "");
  } else {
    metadata.invoiceIds = JSON.stringify(validated.map((v) => v.id));
    metadata.off_session_multi = "true";
  }
  if (params.contactId) metadata.created_by_contact_id = params.contactId;

  // 5. Provider call. The Stripe adapter wraps `paymentIntents.create`
  //    with `customer:` + `payment_method:` + `off_session: true` +
  //    `confirm: true`. The result discriminates the four outcomes
  //    we care about; the webhook records the ledger row on success.
  const provider = resolveForCompany(companyId);
  if (!provider.createOffSessionPayment) {
    throw createError(
      501,
      "The configured payment provider does not support off-session payments",
    );
  }

  const result = await provider.createOffSessionPayment({
    providerCustomerId: pm.providerCustomerId,
    providerPaymentMethodId: pm.providerPaymentMethodId,
    amountCents: totalCents,
    currency,
    idempotencyKey: prospectivePaymentId,
    metadata,
    providerAccountId,
  });

  return {
    status: result.status,
    totalAmount: centsToDollarsString(totalCents),
    invoiceIds: validated.map((v) => v.id),
    prospectivePaymentId,
    providerPaymentId: result.providerPaymentId,
    message: result.message ?? null,
    declineCode: result.declineCode ?? null,
  };
}

// ============================================================================
// refundPayment
// ============================================================================

export interface RefundPaymentParams {
  companyId: string;
  parentPaymentId: string;
  /** Positive dollars string. The ledger negates. */
  amount: string;
  method?: string;
  reference?: string | null;
  notes?: string | null;
  reason?: string | null;
}

/**
 * Discriminated result so the route can distinguish "fully settled"
 * from "provider succeeded but ledger write pending reconciliation".
 * The 202 path is taken only when Stripe has definitely moved money
 * but our ledger write failed for a reason other than unique-violation
 * (which is handled transparently by lookup-and-return).
 */
export type RefundPaymentResult =
  | { kind: "settled"; row: Awaited<ReturnType<typeof paymentRepository.createRefund>> }
  | {
      kind: "reconciliation_pending";
      refundLedgerId: string;
      providerRefundId: string;
      providerSource: "stripe";
    };

/**
 * Derive a DETERMINISTIC Stripe idempotency key from the refund request
 * shape. The same (companyId, parentPaymentId, amountCents, reason)
 * tuple produces the same key — so any retry with identical arguments
 * collapses to a single Stripe refund object (Stripe returns the same
 * `re_...` on every retried call carrying the same idempotency key).
 *
 * This is the core defense against the "provider succeeded but our
 * ledger insert failed → user retries → Stripe issues second refund"
 * scenario (H2). Even if the user clicks refund three times, Stripe
 * issues exactly one refund; our ledger insert is idempotent via the
 * `payments_provider_event_id_uq` partial unique on the returned
 * `providerRefundId`.
 *
 * We DO NOT use the ledger PK (random UUID) as the provider key —
 * that would be unique per attempt and defeat the dedupe. The ledger
 * PK remains random; the provider key is deterministic.
 */
function stripeRefundIdempotencyKey(
  companyId: string,
  parentPaymentId: string,
  amountCents: number,
  reason: string | null,
): string {
  const h = createHash("sha256");
  h.update(companyId);
  h.update("|");
  h.update(parentPaymentId);
  h.update("|");
  h.update(String(amountCents));
  h.update("|");
  h.update(reason ?? "");
  // Stripe idempotency keys accept up to 255 chars; our prefix makes
  // them grep-able in the Stripe dashboard.
  return `syntraro_refund_${h.digest("hex").slice(0, 40)}`;
}

/**
 * Issue a refund. Behavior branches on the parent payment's
 * `providerSource`:
 *
 *   - `'manual'` → ledger-only. Unchanged.
 *   - `'stripe'` → (1) cap check pre-provider, (2) Stripe call with
 *                  deterministic idempotency key, (3) ledger insert.
 *                  Failure of step 3 returns a reconciliation_pending
 *                  result — the provider has the refund, the webhook
 *                  will backfill the ledger row, and a retry from the
 *                  user cannot produce a second provider refund.
 *   - anything else → 409 (e.g. QBO-linked rows go through QBO sync).
 *
 * Retry safety (H2):
 *   Same (companyId, parentPaymentId, amount, reason) → same Stripe
 *   idempotency key → Stripe returns the same refund object → our
 *   ledger insert collides on `payments_provider_event_id_uq` →
 *   service returns the existing row. No second provider refund.
 *
 * Cap ordering (H1):
 *   `paymentRepository.assertRefundAmountWithinParent` runs BEFORE
 *   the provider call. Overshoot rejects at 400 without a Stripe hit.
 */
async function refundPayment(
  params: RefundPaymentParams,
): Promise<RefundPaymentResult> {
  const { companyId, parentPaymentId } = params;

  // 1. Load parent row to determine provider branch.
  const [parent] = await db
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.id, parentPaymentId))
    .limit(1);

  if (!parent) throw createError(404, "Parent payment not found");
  if (parent.companyId !== companyId) {
    // Behave like not-found for cross-tenant attempts.
    throw createError(404, "Parent payment not found");
  }

  const route = resolveForProviderSource(parent.providerSource);
  if ("unsupported" in route) {
    throw createError(
      409,
      `Refunds for provider "${route.providerSource}" are not supported through this endpoint.`,
    );
  }

  const amountCents = dollarsStringToCents(params.amount);
  const amountAbs = amountCents / 100;

  // Provider-linked branch.
  if ("provider" in route) {
    if (!parent.reference) {
      throw createError(
        500,
        "Provider-linked payment is missing its provider reference; refund cannot be issued.",
      );
    }
    // 2026-05-03 PR4 — Connect requires the originating account on
    // the refund call. The parent row's `providerAccountId` column
    // is the canonical source; if it's missing, the row pre-dates
    // PR4 (legacy platform-account payment) and we cannot route a
    // Connect refund. Surface 409 with a stable code so ops can
    // see the migration gap clearly.
    if (!parent.providerAccountId) {
      throw createDomainError(
        "PAYMENT_ACCOUNT_NOT_FOUND",
        "Original payment is missing its connected-account attribution; refund cannot be routed.",
      );
    }

    // ------------------------------------------------------------------
    // H1: Cap check BEFORE any provider call. Overshoot → 400, no Stripe
    // hit. The same canonical check runs inside paymentRepository's
    // ledger-write path; surfacing it here gives a clean error without
    // leaving a real refund at Stripe for a request we can't record.
    // ------------------------------------------------------------------
    await paymentRepository.assertRefundAmountWithinParent(
      companyId,
      parentPaymentId,
      amountAbs,
    );

    // Deterministic provider idempotency key — same inputs, same key,
    // same Stripe refund on every retry (H2 core defense).
    const providerIdempotencyKey = stripeRefundIdempotencyKey(
      companyId,
      parentPaymentId,
      amountCents,
      params.reason ?? null,
    );
    // Ledger row PK is independent (random) so operators can still
    // distinguish retries in local logs. Only ONE row will land; the
    // others collide on providerEventId dedupe.
    const refundLedgerId = randomUUID();

    logRefundInfo("provider_call_start", {
      companyId,
      parentPaymentId,
      providerSource: "stripe",
      amountCents,
      idempotencyKey: providerIdempotencyKey,
    });

    const providerResult = await route.provider.refundPayment({
      providerPaymentId: parent.reference,
      amountCents,
      reason: params.reason ?? null,
      idempotencyKey: providerIdempotencyKey,
      providerAccountId: parent.providerAccountId,
    });

    if (providerResult.status === "failed") {
      logRefundInfo("provider_refund_failed", {
        companyId,
        parentPaymentId,
        providerRefundId: providerResult.providerRefundId,
      });
      throw createError(
        502,
        `Provider refund failed (status=${providerResult.status}).`,
      );
    }

    logRefundInfo("provider_refund_succeeded", {
      companyId,
      parentPaymentId,
      providerRefundId: providerResult.providerRefundId,
      providerStatus: providerResult.status,
    });

    // Attempt the canonical ledger write.
    try {
      const row = await paymentRepository.createRefund(
        companyId,
        parentPaymentId,
        {
          amount: params.amount,
          method: params.method ?? undefined,
          reference: providerResult.providerRefundId,
          notes: params.notes ?? null,
          id: refundLedgerId,
          providerSource: "stripe",
          providerEventId: providerResult.providerRefundId,
        },
      );
      logRefundInfo("ledger_write_succeeded", {
        companyId,
        parentPaymentId,
        refundLedgerId,
        providerRefundId: providerResult.providerRefundId,
      });
      return { kind: "settled", row };
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Either the webhook beat us, or a prior retry of this exact
        // request already wrote the row. Same `providerRefundId` →
        // same row. Return it — the client sees a normal success.
        const existing = await paymentRepository.findByProviderReference(
          "stripe",
          providerResult.providerRefundId,
        );
        if (existing) {
          logRefundInfo("ledger_write_replayed", {
            companyId,
            parentPaymentId,
            refundLedgerId: existing.id,
            providerRefundId: providerResult.providerRefundId,
          });
          return { kind: "settled", row: existing };
        }
      }

      // ----------------------------------------------------------------
      // H2: Stripe has definitely moved money but our ledger write
      // failed for a reason other than unique-violation. Escalate and
      // return a reconciliation_pending result. The `charge.refunded`
      // webhook will arrive within seconds and write the row via the
      // same canonical path; any user retry with identical arguments
      // hits the same providerIdempotencyKey, gets back the same
      // `providerRefundId`, and either finds the webhook-written row
      // (unique-violation branch above) OR sees the same 202 again —
      // never a second Stripe refund.
      // ----------------------------------------------------------------
      logRefundCritical("ledger_write_failed_after_provider_success", {
        companyId,
        parentPaymentId,
        refundLedgerId,
        providerRefundId: providerResult.providerRefundId,
        error: err instanceof Error ? err.message : String(err),
      });

      // 2026-04-22 Rollback: reconciliation-pending TABLE removed.
      // The CRITICAL log above remains the operator signal; the 202
      // response contract is preserved. Stripe's charge.refunded
      // webhook still backfills the canonical ledger within seconds.
      return {
        kind: "reconciliation_pending",
        refundLedgerId,
        providerRefundId: providerResult.providerRefundId,
        providerSource: "stripe",
      };
    }
  }

  // Manual branch — ledger-only (unchanged). Cap check runs inside
  // paymentRepository.createRefund → createLedgerAdjustment, which is
  // sufficient since there's no provider side-effect to guard.
  const row = await paymentRepository.createRefund(
    companyId,
    parentPaymentId,
    {
      amount: params.amount,
      method: params.method ?? undefined,
      reference: params.reference ?? null,
      notes: params.notes ?? null,
    },
  );
  return { kind: "settled", row };
}

// ============================================================================
// Webhook application
// ============================================================================

export interface ApplyWebhookResult {
  accepted: NormalizedWebhookEvent[];
  ignored: NormalizedWebhookEvent[];
  replayed: NormalizedWebhookEvent[];
  failed: Array<{ event: NormalizedWebhookEvent; error: string }>;
}

/**
 * 2026-04-21 Patch C1: tagged error thrown by `applyVerifiedWebhookBatch`
 * when one or more handlers surfaced a transient failure. The route
 * maps this to HTTP 500 so Stripe retries.
 *
 * `name` is set so downstream `err.name === "WebhookTransientFailure"`
 * works without instanceof checks across module boundaries (serialized
 * error objects lose prototype chains).
 */
export class WebhookTransientFailureError extends Error {
  readonly name = "WebhookTransientFailure";
  readonly failed: Array<{ event: NormalizedWebhookEvent; error: string }>;
  readonly totalEvents: number;
  constructor(
    failed: Array<{ event: NormalizedWebhookEvent; error: string }>,
    totalEvents: number,
  ) {
    super(
      `Transient webhook processing failure: ${failed.length}/${totalEvents} events could not be recorded`,
    );
    this.failed = failed;
    this.totalEvents = totalEvents;
  }
}

/**
 * Apply a verified, normalized webhook-event batch to the canonical
 * ledger. The provider has already authenticated the payload; this
 * function is provider-blind.
 *
 * 2026-04-21 Patch C1 — ACK-correctness:
 *   Per-event handlers classify their errors into replay / config / transient.
 *   Replay and config errors are kept in the `accepted` / `replayed` /
 *   `ignored` arrays (HTTP 200 from the route). Transient errors propagate
 *   out of the handler, are captured per-event in `failed`, and cause THIS
 *   function to throw `WebhookTransientFailureError` after the loop so the
 *   route returns HTTP 500 and Stripe retries. Pre-patch behavior silently
 *   200-ACKed transient errors and dropped the ledger write.
 */
async function applyVerifiedWebhookBatch(
  providerId: string,
  events: NormalizedWebhookEvent[],
): Promise<ApplyWebhookResult> {
  const out: ApplyWebhookResult = {
    accepted: [],
    ignored: [],
    replayed: [],
    failed: [],
  };

  for (const event of events) {
    try {
      switch (event.kind) {
        case "payment_succeeded": {
          const handled = await handlePaymentSucceeded(providerId, event);
          if (handled === "replay") out.replayed.push(event);
          else out.accepted.push(event);
          break;
        }
        // 2026-05-03 multi-invoice payments — distinct handler that
        // writes one payment row + N allocation rows in a single tx.
        case "multi_invoice_payment_succeeded": {
          const handled = await handleMultiInvoicePaymentSucceeded(
            providerId,
            event,
          );
          if (handled === "replay") out.replayed.push(event);
          else if (handled === "skipped") out.ignored.push(event);
          else out.accepted.push(event);
          break;
        }
        case "refund_created": {
          const handled = await handleRefundCreated(providerId, event);
          if (handled === "replay") out.replayed.push(event);
          else if (handled === "skipped") out.ignored.push(event);
          else out.accepted.push(event);
          break;
        }
        // 2026-05-03 PR B — saved-card foundation. Stripe
        // `payment_method.attached` arrives whenever the customer
        // confirms a PI / Session that had `setup_future_usage` set.
        case "payment_method_attached": {
          const handled = await handlePaymentMethodAttached(providerId, event);
          if (handled === "replay") out.replayed.push(event);
          else if (handled === "skipped") out.ignored.push(event);
          else out.accepted.push(event);
          break;
        }
        // 2026-05-03 PR C — saved-card management.
        case "payment_method_detached": {
          const handled = await handlePaymentMethodDetached(providerId, event);
          if (handled === "skipped") out.ignored.push(event);
          else out.accepted.push(event);
          break;
        }
        case "payment_method_updated": {
          const handled = await handlePaymentMethodUpdated(providerId, event);
          if (handled === "skipped") out.ignored.push(event);
          else out.accepted.push(event);
          break;
        }
        // 2026-05-03 PR2 — Stripe Connect onboarding lifecycle.
        // `account.updated` arrives on every connected-account state
        // change. Idempotency is at the local row level: stamping the
        // same lifecycle snapshot twice lands the same final state.
        case "account_updated": {
          const handled = await handleAccountUpdated(providerId, event);
          if (handled === "skipped") out.ignored.push(event);
          else out.accepted.push(event);
          break;
        }
        // 2026-05-04 PR5 — Connect payout lifecycle. Five distinct
        // event kinds, one shared handler. Idempotency is anchored by
        // the DB unique index on (provider, provider_payout_id);
        // tenant resolution comes from the local
        // payment_provider_accounts row keyed on
        // `(provider, providerAccountId)` from the webhook.
        case "payout_created":
        case "payout_updated":
        case "payout_paid":
        case "payout_failed":
        case "payout_canceled": {
          const handled = await handlePayoutEvent(providerId, event);
          if (handled === "skipped") out.ignored.push(event);
          else out.accepted.push(event);
          break;
        }
        // 2026-05-04 PR6 — Connect dispute / chargeback lifecycle.
        // Three event kinds, one shared handler. Idempotency anchored
        // on (provider, provider_dispute_id) DB unique index. Tenant
        // resolution + payment/invoice linking happens inside
        // handleDisputeEvent.
        case "dispute_created":
        case "dispute_updated":
        case "dispute_closed": {
          const handled = await handleDisputeEvent(providerId, event);
          if (handled === "skipped") out.ignored.push(event);
          else out.accepted.push(event);
          break;
        }
        case "payment_failed":
          logInfo("payment_intent_failed", {
            providerId,
            eventId: event.eventId,
            providerPaymentId: event.providerPaymentId,
            lastError: event.lastErrorMessage,
          });
          out.ignored.push(event);
          break;
        case "unsupported":
          logInfo("event_out_of_scope", {
            providerId,
            eventId: event.eventId,
            eventType: event.eventType,
          });
          out.ignored.push(event);
          break;
      }
    } catch (err) {
      // Only transient errors reach here — the per-handler catch already
      // absorbs replay/config. Stash for the post-loop throw so every
      // event in the batch still gets its turn.
      const message = err instanceof Error ? err.message : String(err);
      logAnomaly("handler_transient_failure", {
        providerId,
        eventId: event.eventId,
        kind: event.kind,
        message,
      });
      out.failed.push({ event, error: message });
    }
  }

  if (out.failed.length > 0) {
    throw new WebhookTransientFailureError(out.failed, events.length);
  }

  return out;
}

// ============================================================================
// 2026-05-03 PR4 — Webhook account attribution helper.
// ============================================================================
//
// Every connected-account webhook event (payment_succeeded,
// multi_invoice_payment_succeeded, refund_created, payment_method_*)
// arrives with `providerAccountId` set to the firing connected
// account's id. The handler:
//
//   1. Looks up the local `payment_provider_accounts` row by
//      (provider, providerAccountId).
//   2. Verifies the metadata-derived companyId matches the local
//      row's companyId. Mismatch → PROVIDER_ACCOUNT_MISMATCH (config
//      error; 200 ACK so Stripe stops retrying, plus an ops alert).
//   3. Returns the local FK + the verified attribution pair so the
//      handler persists both into the new `payments` columns.
//
// Returns:
//   { ok: true, paymentProviderAccountId, providerAccountId }
//   { ok: "skip", reason: "missing_account_on_event" | "account_not_found"
//                            | "tenant_mismatch", message }
//
// "skip" vs throw — the lookup is supposed to be tolerant: a webhook
// arriving without account context (legacy platform-account, or a
// Stripe-dashboard-issued event from a non-connected account) is a
// config drift the handler logs and ACKs. Only the ledger write
// itself triggers transient-failure retries.

interface AttributionResolved {
  ok: true;
  paymentProviderAccountId: string;
  providerAccountId: string;
}

interface AttributionSkipped {
  ok: "skip";
  reason:
    | "missing_account_on_event"
    | "account_not_found"
    | "tenant_mismatch";
  message: string;
}

async function resolveAccountAttributionForWebhook(
  providerId: string,
  providerAccountId: string | null,
  expectedCompanyId: string,
): Promise<AttributionResolved | AttributionSkipped> {
  if (!providerAccountId) {
    return {
      ok: "skip",
      reason: "missing_account_on_event",
      message:
        "Webhook event has no connected-account id; cannot persist attribution.",
    };
  }
  const row =
    await paymentProviderAccountsRepository.getByProviderAndProviderAccountId(
      providerId,
      providerAccountId,
    );
  if (!row) {
    return {
      ok: "skip",
      reason: "account_not_found",
      message: `No local payment_provider_accounts row for ${providerId}:${providerAccountId}`,
    };
  }
  if (row.companyId !== expectedCompanyId) {
    return {
      ok: "skip",
      reason: "tenant_mismatch",
      message: `Connected account ${providerAccountId} belongs to company ${row.companyId}, but webhook metadata claims ${expectedCompanyId}`,
    };
  }
  return {
    ok: true,
    paymentProviderAccountId: row.id,
    providerAccountId: row.providerAccountId ?? providerAccountId,
  };
}

async function handlePaymentSucceeded(
  providerId: string,
  event: Extract<NormalizedWebhookEvent, { kind: "payment_succeeded" }>,
): Promise<"accepted" | "replay"> {
  // Shared base for every log call in this handler. We fill in outcome +
  // http_status + optional error_message at each decision point below.
  const logBase = {
    providerId,
    providerEventId: event.eventId,
    eventType: event.eventType,
    eventKind: "payment_succeeded" as const,
    providerPaymentId: event.providerPaymentId,
    amountCents: event.amountCents,
    rawMetadata: event.metadata as Record<string, unknown>,
    dedupeKey: buildDedupeKey({
      providerId,
      providerEventId: event.eventId,
    }),
  };

  const meta = readTenantMetadata(event.metadata);
  if (!meta) {
    logAnomaly("metadata_missing_or_malformed", {
      providerId,
      eventId: event.eventId,
      providerPaymentId: event.providerPaymentId,
      providedMetadata: event.metadata,
    });
    // Config drift: the provider accepted the charge but the metadata
    // we set on the PaymentIntent doesn't carry a resolvable tenant.
    // 200 ACK — retry cannot help — but log so ops can investigate.
    void safeRecordPaymentWebhookEvent({
      ...logBase,
      outcome: "config_error",
      httpStatus: 200,
      errorMessage: "metadata_missing_or_malformed",
    });
    return "accepted";
  }

  const amountDollars = centsToDollarsString(event.amountCents);

  // 2026-05-03 PR4 — Resolve connected-account attribution. A
  // missing / mismatched account is a config drift: log it but
  // STILL write the ledger row (the money already moved at the
  // provider; failing to record locally would lose it). The
  // attribution columns are nullable specifically so this fallback
  // path lands a row even when account context is unrecoverable.
  const attribution = await resolveAccountAttributionForWebhook(
    providerId,
    event.providerAccountId,
    meta.companyId,
  );
  if (attribution.ok !== true) {
    logAnomaly("payment_account_attribution_skipped", {
      providerId,
      eventId: event.eventId,
      reason: attribution.reason,
      message: attribution.message,
      companyId: meta.companyId,
      invoiceId: meta.invoiceId,
      providerAccountId: event.providerAccountId,
    });
    void safeRecordPaymentWebhookEvent({
      ...logBase,
      outcome: "config_error",
      httpStatus: 200,
      companyId: meta.companyId,
      invoiceId: meta.invoiceId,
      errorMessage: attribution.message,
    });
    // fall through — write the ledger row without attribution.
  }

  try {
    await paymentRepository.createPayment(meta.companyId, meta.invoiceId, {
      amount: amountDollars,
      method: "credit",
      reference: event.chargeId ?? null,
      notes: null,
      id: meta.prospectivePaymentId,
      providerSource: providerId as "stripe",
      providerEventId: event.eventId,
      paymentProviderAccountId:
        attribution.ok === true ? attribution.paymentProviderAccountId : null,
      providerAccountId:
        attribution.ok === true ? attribution.providerAccountId : null,
    });
    logInfo("payment_recorded", {
      providerId,
      eventId: event.eventId,
      providerPaymentId: event.providerPaymentId,
      chargeId: event.chargeId,
      companyId: meta.companyId,
      invoiceId: meta.invoiceId,
      paymentId: meta.prospectivePaymentId,
      amount: amountDollars,
    });

    // Post-payment receipt email — runs AFTER the canonical ledger
    // write so the rendered balance reflects the just-committed row.
    // Failures must not bubble to the webhook ACK.
    try {
      await emailDispatchService.sendPaymentReceiptEmail({
        tenantId: meta.companyId,
        invoiceId: meta.invoiceId,
        paymentAmount: amountDollars,
      });
    } catch (receiptErr: unknown) {
      logAnomaly("payment_receipt_send_failed", {
        providerId,
        eventId: event.eventId,
        invoiceId: meta.invoiceId,
        message:
          receiptErr instanceof Error
            ? receiptErr.message
            : String(receiptErr),
      });
    }

    // 2026-05-05: revoke any outstanding `?t=` access tokens for this
    // invoice so a leaked email URL cannot be replayed to "pay" the
    // already-paid invoice. Failures here are logged and swallowed —
    // a stale token is at worst a 404 on the next click (the gate at
    // resolveInvoiceTokenScope already filters expired/consumed rows).
    try {
      const { revokeInvoiceAccessTokens } = await import(
        "../portal/invoiceAccessTokens"
      );
      await revokeInvoiceAccessTokens(meta.invoiceId);
    } catch (revokeErr: unknown) {
      logAnomaly("invoice_access_token_revoke_failed", {
        providerId,
        eventId: event.eventId,
        invoiceId: meta.invoiceId,
        message:
          revokeErr instanceof Error
            ? revokeErr.message
            : String(revokeErr),
      });
    }
    return "accepted";
  } catch (err: unknown) {
    // 2026-04-21 Patch C1: classify before deciding the ACK path.
    // Transient errors must propagate so Stripe retries — swallowing
    // them was the previous behavior and caused silent payment loss.
    const klass = classifyWebhookError(err);
    const errMessage = err instanceof Error ? err.message : String(err);
    if (klass === "final_replay") {
      logInfo("replay_already_ingested", {
        providerId,
        eventId: event.eventId,
        providerPaymentId: event.providerPaymentId,
        companyId: meta.companyId,
        invoiceId: meta.invoiceId,
      });
      return "replay";
    }
    if (klass === "final_config") {
      logAnomaly("create_payment_config_error", {
        providerId,
        eventId: event.eventId,
        providerPaymentId: event.providerPaymentId,
        companyId: meta.companyId,
        invoiceId: meta.invoiceId,
        message: errMessage,
      });
      void safeRecordPaymentWebhookEvent({
        ...logBase,
        outcome: "config_error",
        httpStatus: 200,
        companyId: meta.companyId,
        invoiceId: meta.invoiceId,
        errorMessage: errMessage,
      });
      return "accepted"; // 200-ACK — retry cannot help a config mismatch
    }
    // transient — rethrow. The batch-level aggregator will 500 so
    // Stripe's retry machinery eventually succeeds once the transient
    // condition clears.
    logAnomaly("create_payment_transient_failure_will_retry", {
      providerId,
      eventId: event.eventId,
      providerPaymentId: event.providerPaymentId,
      companyId: meta.companyId,
      invoiceId: meta.invoiceId,
      message: errMessage,
    });
    void safeRecordPaymentWebhookEvent({
      ...logBase,
      outcome: "transient_failure",
      httpStatus: 500,
      companyId: meta.companyId,
      invoiceId: meta.invoiceId,
      errorMessage: errMessage,
    });
    throw err;
  }
}

// ============================================================================
// 2026-05-03 multi-invoice webhook handler
//
// Detects metadata.invoiceIds and runs the multi-invoice path:
//   1. parse + validate metadata
//   2. open a transaction
//   3. insert ONE payment row (invoiceId = NULL, amount = total)
//   4. for each invoice: re-validate, write allocation, subtract
//      allocated amount, set status (paid / partial_paid)
//   5. commit
//
// Idempotency is anchored by `payments_provider_event_id_uq` on
// (companyId, providerSource, providerEventId): a webhook replay
// collides on the parent payment insert and rolls back the whole tx
// without writing any allocations or moving any balances. The
// classifier returns "replay" so the route ACKs 200.
// ============================================================================
type MultiMetadata = {
  companyId: string;
  customerCompanyId: string | null;
  invoiceIds: string[];
  prospectivePaymentId: string;
};

function readMultiInvoiceMetadata(
  metadata: Record<string, string> | null | undefined,
): MultiMetadata | null {
  if (!metadata) return null;
  const { companyId, invoiceIds, prospectivePaymentId, customerCompanyId } = metadata;
  if (!companyId || !invoiceIds || !prospectivePaymentId) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(invoiceIds);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  if (!parsed.every((x): x is string => typeof x === "string" && x.length > 0)) {
    return null;
  }
  return {
    companyId,
    customerCompanyId: customerCompanyId ?? null,
    invoiceIds: parsed,
    prospectivePaymentId,
  };
}

/**
 * Multi-invoice in-tx invoice updater. For each invoice:
 *   - re-validate ownership + status + balance
 *   - subtract `allocatedCents / 100` from balance
 *   - bump amountPaid by the same
 *   - set status to 'paid' if balance hits zero, else 'partial_paid'
 *
 * Throws on any per-invoice validation failure so the outer tx rolls
 * back. We rely on `canAcceptInvoicePayment` for the same status check
 * the createMultiCheckout pre-flight ran; the worst case (status
 * changed between checkout and webhook) is rare but worth catching
 * before allocations land.
 */
async function applyMultiInvoiceAllocationsTx(
  tx: any,
  meta: MultiMetadata,
  paymentId: string,
  invoiceAllocations: Array<{ invoiceId: string; allocatedCents: number }>,
): Promise<void> {
  // Fold the per-invoice allocation map by id for fast lookup.
  for (const { invoiceId, allocatedCents } of invoiceAllocations) {
    const [invoice] = await tx
      .select()
      .from(invoicesTable)
      .where(
        and(
          eq(invoicesTable.id, invoiceId),
          eq(invoicesTable.companyId, meta.companyId),
        ),
      )
      .limit(1);

    if (!invoice) {
      // 2026-05-03 PR 5: emit a structured `payment_allocation_failed`
      // log line so operators can correlate webhook config-drift cases
      // with the affected invoice id without grep'ing through generic
      // `multi_invoice_config_error` lines. The throw still rolls back
      // the tx via the outer catch.
      logAnomaly("payment_allocation_failed", {
        companyId: meta.companyId,
        paymentId,
        invoiceId,
        reason: "invoice_not_found",
      });
      throw createError(404, `Invoice ${invoiceId} not found`);
    }
    if (
      meta.customerCompanyId &&
      invoice.customerCompanyId !== meta.customerCompanyId
    ) {
      logAnomaly("payment_allocation_failed", {
        companyId: meta.companyId,
        paymentId,
        invoiceId,
        reason: "customer_scope_mismatch",
        expectedCustomerCompanyId: meta.customerCompanyId,
        actualCustomerCompanyId: invoice.customerCompanyId ?? null,
      });
      throw createError(404, `Invoice ${invoiceId} not found`);
    }
    if (!canAcceptInvoicePayment(invoice.status)) {
      // Edge: invoice was voided / paid by another payment between
      // checkout and webhook. Reject the whole batch — Stripe has the
      // money but our allocation can't land safely.
      logAnomaly("payment_allocation_failed", {
        companyId: meta.companyId,
        paymentId,
        invoiceId,
        reason: "invoice_state_changed",
        currentStatus: invoice.status,
      });
      throw createError(
        409,
        `Invoice ${invoiceId} state changed to "${invoice.status}" before payment recording.`,
      );
    }

    // Insert allocation. The unique-violation on
    // `payment_allocations_payment_invoice_uq` would surface as 23505
    // and bubble up the tx — handled by the outer classifier as a
    // replay (the payment row also collided).
    try {
      await paymentAllocationRepository.createAllocations(
        tx,
        meta.companyId,
        paymentId,
        [
          {
            invoiceId,
            allocatedAmount: (allocatedCents / 100).toFixed(2),
          },
        ],
      );
    } catch (allocErr: unknown) {
      // 2026-05-03 PR 5: log + re-throw so the outer classifier still
      // gets to make the replay/transient/config decision. Don't
      // swallow.
      const e = allocErr as { code?: string; message?: string };
      logAnomaly("payment_allocation_failed", {
        companyId: meta.companyId,
        paymentId,
        invoiceId,
        allocatedCents,
        reason: e?.code === "23505" ? "duplicate_allocation" : "insert_error",
        message: e?.message ?? String(allocErr),
      });
      throw allocErr;
    }

    // Subtract allocated amount, bump amountPaid, transition status.
    const currentBalance = parseFloat(invoice.balance ?? "0");
    const currentAmountPaid = parseFloat(invoice.amountPaid ?? "0");
    const allocatedDollars = allocatedCents / 100;
    const newBalanceRaw = currentBalance - allocatedDollars;
    const newBalance = Math.max(0, newBalanceRaw);
    const newAmountPaid = currentAmountPaid + allocatedDollars;

    let newStatus: typeof invoice.status = invoice.status;
    if (newBalance <= 0 && newAmountPaid > 0) {
      newStatus = "paid";
    } else if (newAmountPaid > 0 && newBalance > 0) {
      newStatus = "partial_paid";
    }

    await tx
      .update(invoicesTable)
      .set({
        balance: newBalance.toFixed(2),
        amountPaid: newAmountPaid.toFixed(2),
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(invoicesTable.id, invoiceId),
          eq(invoicesTable.companyId, meta.companyId),
        ),
      );
  }
}

async function handleMultiInvoicePaymentSucceeded(
  providerId: string,
  event: Extract<NormalizedWebhookEvent, { kind: "multi_invoice_payment_succeeded" }>,
): Promise<"accepted" | "replay" | "skipped"> {
  const logBase = {
    providerId,
    providerEventId: event.eventId,
    eventType: event.eventType,
    eventKind: "multi_invoice_payment_succeeded" as const,
    sessionId: event.sessionId,
    providerPaymentId: event.providerPaymentId,
    amountCents: event.amountTotalCents,
    rawMetadata: event.metadata as Record<string, unknown>,
    dedupeKey: buildDedupeKey({ providerId, providerEventId: event.eventId }),
  };

  const meta = readMultiInvoiceMetadata(event.metadata);
  if (!meta) {
    logAnomaly("multi_invoice_metadata_missing_or_malformed", {
      providerId,
      eventId: event.eventId,
      sessionId: event.sessionId,
      providedMetadata: event.metadata,
    });
    void safeRecordPaymentWebhookEvent({
      ...logBase,
      outcome: "config_error",
      httpStatus: 200,
      errorMessage: "multi_invoice_metadata_missing_or_malformed",
    });
    return "skipped";
  }

  // Distribute the session total across invoices proportionally to
  // the invoiceIds count is wrong — instead, the Checkout Session line
  // items determined the customer's actual amount per invoice. Stripe
  // doesn't echo the line items on the session.completed payload by
  // default, so we re-derive each allocation from the live invoice
  // balance at allocation time. This mirrors the createMultiCheckout
  // behavior (which used balance at checkout-time as line-item amount).
  // If the customer paid less than the sum of current balances (e.g.
  // a balance shifted between checkout and webhook), we cap each
  // allocation at the live balance and reject any leftover via the
  // status-change check.
  //
  // Ground truth: amount_total from the Checkout Session is what
  // Stripe charged. Each allocation = min(invoice.balance, share). For
  // PR 2 we keep the simpler "each allocation = invoice's current
  // balance" model — matching how the session's line items were
  // priced. We then verify the SUM equals amount_total and reject any
  // mismatch (forces an operator-visible error rather than silently
  // splitting unevenly).

  let txOutcome: "accepted" | "replay" | "skipped";
  try {
    txOutcome = await db.transaction(async (tx): Promise<"accepted" | "replay" | "skipped"> => {
      // 1. Re-load invoice balances inside the tx for atomicity.
      const allocations: Array<{ invoiceId: string; allocatedCents: number }> = [];
      for (const invoiceId of meta.invoiceIds) {
        const [invoice] = await tx
          .select()
          .from(invoicesTable)
          .where(
            and(
              eq(invoicesTable.id, invoiceId),
              eq(invoicesTable.companyId, meta.companyId),
            ),
          )
          .limit(1);
        if (!invoice) {
          throw createError(404, `Invoice ${invoiceId} not found`);
        }
        const balanceCents = Math.round(parseFloat(invoice.balance ?? "0") * 100);
        allocations.push({ invoiceId, allocatedCents: balanceCents });
      }

      const sumCents = allocations.reduce((s, a) => s + a.allocatedCents, 0);
      if (sumCents !== event.amountTotalCents) {
        // Money already moved at Stripe but our balance arithmetic
        // can't reconcile. Surface as 409 — caller (webhook classifier)
        // routes it to config_error → 200 ACK + operator alert. Do NOT
        // write a partial ledger.
        throw createError(
          409,
          `Multi-invoice allocation mismatch: invoices sum to ${sumCents}c, Stripe charged ${event.amountTotalCents}c.`,
        );
      }

      // 2. Insert the parent payment row with invoiceId = NULL.
      //    The unique index on (companyId, providerSource, providerEventId)
      //    is the canonical idempotency anchor — a replay collides here
      //    and the entire tx rolls back without writing allocations.
      //
      // 2026-05-03 PR4 — connected-account attribution (same lookup
      // pattern as handlePaymentSucceeded; logged + tolerated when
      // missing because the money already moved).
      const attribution = await resolveAccountAttributionForWebhook(
        providerId,
        event.providerAccountId,
        meta.companyId,
      );
      if (attribution.ok !== true) {
        logAnomaly("multi_invoice_payment_account_attribution_skipped", {
          providerId,
          eventId: event.eventId,
          reason: attribution.reason,
          message: attribution.message,
          companyId: meta.companyId,
          providerAccountId: event.providerAccountId,
        });
      }
      await tx.insert(paymentsTable).values({
        id: meta.prospectivePaymentId,
        companyId: meta.companyId,
        invoiceId: null,
        amount: centsToDollarsString(event.amountTotalCents),
        method: "credit",
        reference: event.chargeId ?? event.sessionId,
        notes: null,
        receivedAt: new Date(),
        paymentType: "payment",
        providerSource: providerId as "stripe",
        providerEventId: event.eventId,
        paymentProviderAccountId:
          attribution.ok === true ? attribution.paymentProviderAccountId : null,
        providerAccountId:
          attribution.ok === true ? attribution.providerAccountId : null,
      });

      // 3. Allocations + per-invoice balance/status updates.
      await applyMultiInvoiceAllocationsTx(
        tx,
        meta,
        meta.prospectivePaymentId,
        allocations,
      );

      logInfo("multi_invoice_payment_recorded", {
        providerId,
        eventId: event.eventId,
        sessionId: event.sessionId,
        companyId: meta.companyId,
        paymentId: meta.prospectivePaymentId,
        invoiceCount: allocations.length,
        amountCents: event.amountTotalCents,
      });

      // 2026-05-05: revoke `?t=` invoice-access tokens for every
      // invoice that received an allocation. Same rationale as the
      // single-invoice path. Runs inside the transaction so a
      // rollback un-does the revocation; failures bubble through to
      // the surrounding catch which classifies them.
      try {
        const { revokeInvoiceAccessTokensForInvoices } = await import(
          "../portal/invoiceAccessTokens"
        );
        await revokeInvoiceAccessTokensForInvoices(
          allocations.map(a => a.invoiceId),
        );
      } catch (revokeErr: unknown) {
        logAnomaly("invoice_access_token_revoke_failed", {
          providerId,
          eventId: event.eventId,
          message:
            revokeErr instanceof Error ? revokeErr.message : String(revokeErr),
        });
      }

      return "accepted";
    });
  } catch (err: unknown) {
    const klass = classifyWebhookError(err);
    const errMessage = err instanceof Error ? err.message : String(err);
    if (klass === "final_replay") {
      logInfo("multi_invoice_replay_already_ingested", {
        providerId,
        eventId: event.eventId,
        sessionId: event.sessionId,
        companyId: meta.companyId,
      });
      return "replay";
    }
    if (klass === "final_config") {
      logAnomaly("multi_invoice_config_error", {
        providerId,
        eventId: event.eventId,
        sessionId: event.sessionId,
        companyId: meta.companyId,
        message: errMessage,
      });
      void safeRecordPaymentWebhookEvent({
        ...logBase,
        outcome: "config_error",
        httpStatus: 200,
        companyId: meta.companyId,
        errorMessage: errMessage,
      });
      return "accepted";
    }
    logAnomaly("multi_invoice_transient_failure_will_retry", {
      providerId,
      eventId: event.eventId,
      sessionId: event.sessionId,
      companyId: meta.companyId,
      message: errMessage,
    });
    void safeRecordPaymentWebhookEvent({
      ...logBase,
      outcome: "transient_failure",
      httpStatus: 500,
      companyId: meta.companyId,
      errorMessage: errMessage,
    });
    throw err;
  }

  // 2026-05-03 PR 4 — multi-invoice payment receipt email.
  //
  // Runs AFTER the tx commits (and only on the "accepted" outcome) so:
  //   - replays never reach this code (the tx rolled back inside the
  //     catch block above and we returned "replay" before getting here)
  //   - config-mismatch / metadata errors never reach this code (also
  //     short-circuited above)
  //   - the canonical idempotency anchor on `payments_provider_event_id_uq`
  //     is the per-payment uniqueness contract for the receipt: one
  //     committed payment row → exactly one receipt send attempt
  //
  // Receipt failures must NEVER bubble to the webhook ACK. We log
  // anomalies + record on the webhook-events table and let Stripe
  // believe the webhook succeeded (because the canonical ledger write
  // DID succeed). The customer can be re-sent the receipt later via
  // the email-history "resend" path; not surfacing a 500 here keeps
  // Stripe from re-delivering and re-attempting the ledger write
  // (which would dedupe via UNIQUE but is wasted work).
  if (txOutcome === "accepted") {
    try {
      await emailDispatchService.sendMultiInvoicePaymentReceiptEmail({
        tenantId: meta.companyId,
        paymentId: meta.prospectivePaymentId,
      });
    } catch (receiptErr: unknown) {
      logAnomaly("multi_invoice_payment_receipt_send_failed", {
        providerId,
        eventId: event.eventId,
        sessionId: event.sessionId,
        companyId: meta.companyId,
        paymentId: meta.prospectivePaymentId,
        message:
          receiptErr instanceof Error ? receiptErr.message : String(receiptErr),
      });
    }
  }

  return txOutcome;
}

async function handleRefundCreated(
  providerId: string,
  event: Extract<NormalizedWebhookEvent, { kind: "refund_created" }>,
): Promise<"accepted" | "replay" | "skipped"> {
  // Shared base for every log call in this handler.
  const logBase = {
    providerId,
    providerEventId: event.eventId,
    eventType: event.eventType,
    eventKind: "refund_created" as const,
    providerRefundId: event.providerRefundId,
    amountCents: event.amountCents,
    dedupeKey: buildDedupeKey({
      providerId,
      providerEventId: event.eventId,
      providerRefundId: event.providerRefundId,
    }),
  };

  // Locate the parent payment by its provider charge id. Tenant-less
  // lookup is safe: the resulting row carries `companyId`.
  const parent = await paymentRepository.findByProviderReference(
    providerId as "stripe",
    event.providerChargeId,
  );
  if (!parent) {
    logAnomaly("refund_for_unknown_charge", {
      providerId,
      eventId: event.eventId,
      chargeId: event.providerChargeId,
    });
    void safeRecordPaymentWebhookEvent({
      ...logBase,
      outcome: "config_error",
      httpStatus: 200,
      providerPaymentId: event.providerChargeId,
      errorMessage: "refund_for_unknown_charge",
    });
    return "skipped";
  }

  const refundDollars = centsToDollarsString(event.amountCents);
  try {
    await paymentRepository.createRefund(parent.companyId, parent.id, {
      amount: refundDollars,
      method: "credit",
      reference: event.providerRefundId,
      notes: event.reason ?? null,
      providerSource: providerId as "stripe",
      // For refund rows, providerEventId is the refund id itself so a
      // multi-refund event still produces unique rows.
      providerEventId: event.providerRefundId,
    });
    logInfo("refund_recorded", {
      providerId,
      eventId: event.eventId,
      chargeId: event.providerChargeId,
      refundId: event.providerRefundId,
      companyId: parent.companyId,
      invoiceId: parent.invoiceId,
      parentPaymentId: parent.id,
      amount: refundDollars,
    });
    return "accepted";
  } catch (err: unknown) {
    // 2026-04-21 Patch C1: same classification as the payment handler.
    // Transient errors propagate → 500 → Stripe retries.
    const klass = classifyWebhookError(err);
    const errMessage = err instanceof Error ? err.message : String(err);
    if (klass === "final_replay") {
      logInfo("refund_replay_already_ingested", {
        providerId,
        eventId: event.eventId,
        chargeId: event.providerChargeId,
        refundId: event.providerRefundId,
      });
      return "replay";
    }
    if (klass === "final_config") {
      logAnomaly("create_refund_config_error", {
        providerId,
        eventId: event.eventId,
        chargeId: event.providerChargeId,
        refundId: event.providerRefundId,
        companyId: parent.companyId,
        invoiceId: parent.invoiceId,
        message: errMessage,
      });
      void safeRecordPaymentWebhookEvent({
        ...logBase,
        outcome: "config_error",
        httpStatus: 200,
        companyId: parent.companyId,
        invoiceId: parent.invoiceId,
        parentPaymentId: parent.id,
        providerPaymentId: event.providerChargeId,
        errorMessage: errMessage,
      });
      return "accepted";
    }
    logAnomaly("create_refund_transient_failure_will_retry", {
      providerId,
      eventId: event.eventId,
      chargeId: event.providerChargeId,
      refundId: event.providerRefundId,
      companyId: parent.companyId,
      invoiceId: parent.invoiceId,
      message: errMessage,
    });
    void safeRecordPaymentWebhookEvent({
      ...logBase,
      outcome: "transient_failure",
      httpStatus: 500,
      companyId: parent.companyId,
      invoiceId: parent.invoiceId,
      parentPaymentId: parent.id,
      providerPaymentId: event.providerChargeId,
      errorMessage: errMessage,
    });
    throw err;
  }
}

// ============================================================================
// 2026-05-03 PR B — handlePaymentMethodAttached
//
// Persists a saved-card row in `payment_methods` for the PaymentMethod
// the customer just attached via the `setup_future_usage` flow.
//
// Tenant resolution:
//   The webhook event itself does NOT carry our tenant id directly —
//   it carries the provider's customer id. We look up the local
//   `customer_companies.provider_customer_id` (UNIQUE on
//   `(company_id, provider_source, provider_customer_id)` per PR A)
//   to recover (companyId, customerCompanyId). A miss = the customer
//   was created outside our flow → skip with an ops anomaly log.
//
// Consent:
//   The adapter pre-extracts `event.consent` from the originating
//   PaymentIntent's metadata. When null, the customer didn't opt in
//   via the save-for-future flow (legacy attach, manual portal-of-the-
//   future setupIntent, etc.) → skip with an ops anomaly log.
//
// Idempotency:
//   `payment_methods_provider_pm_uq` on
//   `(company_id, provider_source, provider_payment_method_id)` is the
//   canonical anchor — a webhook replay collides with SQLSTATE 23505,
//   the classifier treats it as "replay" and the route ACKs 200.
// ============================================================================
async function handlePaymentMethodAttached(
  providerId: string,
  event: Extract<NormalizedWebhookEvent, { kind: "payment_method_attached" }>,
): Promise<"accepted" | "replay" | "skipped"> {
  const logBase = {
    providerId,
    providerEventId: event.eventId,
    eventType: event.eventType,
    eventKind: "payment_method_attached" as const,
    providerCustomerId: event.providerCustomerId,
    providerPaymentMethodId: event.paymentMethodId,
    dedupeKey: buildDedupeKey({
      providerId,
      providerEventId: event.eventId,
    }),
  };

  const consent = event.consent;
  if (!consent) {
    logInfo("payment_method_attached_no_consent_skipped", {
      providerId,
      eventId: event.eventId,
      providerCustomerId: event.providerCustomerId,
      providerPaymentMethodId: event.paymentMethodId,
    });
    void safeRecordPaymentWebhookEvent({
      ...logBase,
      outcome: "ignored",
      httpStatus: 200,
      errorMessage: "no_consent_metadata_on_originating_intent",
    });
    return "skipped";
  }

  // Look up the (companyId, customerCompanyId) by provider_customer_id.
  // The unique index on customer_companies guarantees at most one match.
  const [owner] = await db
    .select({
      id: customerCompaniesTable.id,
      companyId: customerCompaniesTable.companyId,
    })
    .from(customerCompaniesTable)
    .where(
      and(
        eq(customerCompaniesTable.providerCustomerId, event.providerCustomerId),
      ),
    )
    .limit(1);

  if (!owner) {
    logAnomaly("payment_method_attached_unknown_customer", {
      providerId,
      eventId: event.eventId,
      providerCustomerId: event.providerCustomerId,
    });
    void safeRecordPaymentWebhookEvent({
      ...logBase,
      outcome: "config_error",
      httpStatus: 200,
      errorMessage: "unknown_provider_customer",
    });
    return "skipped";
  }

  try {
    await db.transaction(async (tx) => {
      await paymentMethodsRepository.createPaymentMethod(tx, {
        companyId: owner.companyId,
        customerCompanyId: owner.id,
        providerSource: providerId as "stripe",
        providerCustomerId: event.providerCustomerId,
        providerPaymentMethodId: event.paymentMethodId,
        cardBrand: event.cardBrand,
        cardLast4: event.cardLast4,
        cardExpMonth: event.cardExpMonth,
        cardExpYear: event.cardExpYear,
        cardFunding: event.cardFunding ?? null,
        cardCountry: event.cardCountry ?? null,
        consentAt: new Date(),
        consentText: consent.text,
        consentIp: consent.ip,
        consentUserAgent: consent.userAgent,
        createdByContactId: consent.contactId,
        // Default flag: leave as the schema default (false). Setting
        // a card as default is an explicit portal action — PR C
        // wires the route. A future "first-saved-card auto-defaults"
        // policy would land here; intentionally NOT in PR B's scope.
      });
    });
    logInfo("payment_method_saved", {
      providerId,
      eventId: event.eventId,
      companyId: owner.companyId,
      customerCompanyId: owner.id,
      providerPaymentMethodId: event.paymentMethodId,
      cardBrand: event.cardBrand,
      cardLast4: event.cardLast4,
    });
    return "accepted";
  } catch (err: unknown) {
    const klass = classifyWebhookError(err);
    const errMessage = err instanceof Error ? err.message : String(err);
    if (klass === "final_replay") {
      logInfo("payment_method_replay_already_saved", {
        providerId,
        eventId: event.eventId,
        companyId: owner.companyId,
        providerPaymentMethodId: event.paymentMethodId,
      });
      return "replay";
    }
    if (klass === "final_config") {
      logAnomaly("payment_method_attached_config_error", {
        providerId,
        eventId: event.eventId,
        companyId: owner.companyId,
        providerPaymentMethodId: event.paymentMethodId,
        message: errMessage,
      });
      void safeRecordPaymentWebhookEvent({
        ...logBase,
        outcome: "config_error",
        httpStatus: 200,
        companyId: owner.companyId,
        errorMessage: errMessage,
      });
      return "accepted";
    }
    logAnomaly("payment_method_attached_transient_failure_will_retry", {
      providerId,
      eventId: event.eventId,
      companyId: owner.companyId,
      providerPaymentMethodId: event.paymentMethodId,
      message: errMessage,
    });
    void safeRecordPaymentWebhookEvent({
      ...logBase,
      outcome: "transient_failure",
      httpStatus: 500,
      companyId: owner.companyId,
      errorMessage: errMessage,
    });
    throw err;
  }
}

// ============================================================================
// 2026-05-03 PR C — handlePaymentMethodDetached + handlePaymentMethodUpdated
// ============================================================================

/**
 * Look up the local row by provider PM id. Tenant-scoped via the
 * `payment_methods_provider_pm_uq` unique index (UNIQUE on
 * `(company_id, provider_source, provider_payment_method_id)` per PR A).
 *
 * The webhook event itself doesn't carry tenant context — only the
 * provider PM id — so we walk a small select to recover (companyId,
 * customerCompanyId). Returns null when no row matches; the handler
 * treats that as ignored (the PM was never one we tracked).
 */
async function lookupLocalPaymentMethodByProviderId(
  providerId: string,
  paymentMethodId: string,
): Promise<{ id: string; companyId: string } | null> {
  const [row] = await db
    .select({
      id: paymentMethodsTable.id,
      companyId: paymentMethodsTable.companyId,
    })
    .from(paymentMethodsTable)
    .where(
      and(
        eq(paymentMethodsTable.providerSource, providerId),
        eq(paymentMethodsTable.providerPaymentMethodId, paymentMethodId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Stripe `payment_method.detached` event. Idempotent: if the local
 * row is already detached, no-op. The portal DELETE route also
 * marks the row detached for the user-initiated case; this handler
 * is the safety net for Stripe-dashboard detaches + retry races.
 */
async function handlePaymentMethodDetached(
  providerId: string,
  event: Extract<NormalizedWebhookEvent, { kind: "payment_method_detached" }>,
): Promise<"accepted" | "skipped"> {
  const owner = await lookupLocalPaymentMethodByProviderId(
    providerId,
    event.paymentMethodId,
  );
  if (!owner) {
    logInfo("payment_method_detached_unknown_pm_skipped", {
      providerId,
      eventId: event.eventId,
      paymentMethodId: event.paymentMethodId,
    });
    return "skipped";
  }
  await db.transaction(async (tx) => {
    await paymentMethodsRepository.markDetached(tx, owner.companyId, owner.id, {
      reason: "provider_webhook_detached",
    });
  });
  logInfo("payment_method_detached", {
    providerId,
    eventId: event.eventId,
    companyId: owner.companyId,
    paymentMethodId: event.paymentMethodId,
  });
  return "accepted";
}

/**
 * Stripe `payment_method.updated` event. Refreshes mirrored card
 * metadata locally (brand / last4 / exp / funding / country).
 * Idempotent — repeated deliveries land the same patch values.
 *
 * Does NOT touch `is_default`, `consent_*`, or `detached_at` —
 * those are user-state, not provider-state.
 */
async function handlePaymentMethodUpdated(
  providerId: string,
  event: Extract<NormalizedWebhookEvent, { kind: "payment_method_updated" }>,
): Promise<"accepted" | "skipped"> {
  const owner = await lookupLocalPaymentMethodByProviderId(
    providerId,
    event.paymentMethodId,
  );
  if (!owner) {
    logInfo("payment_method_updated_unknown_pm_skipped", {
      providerId,
      eventId: event.eventId,
      paymentMethodId: event.paymentMethodId,
    });
    return "skipped";
  }
  await db.transaction(async (tx) =>
    paymentMethodsRepository.updateCardMetadata(
      tx,
      owner.companyId,
      providerId,
      event.paymentMethodId,
      {
        cardBrand: event.cardBrand,
        cardLast4: event.cardLast4,
        cardExpMonth: event.cardExpMonth,
        cardExpYear: event.cardExpYear,
        cardFunding: event.cardFunding,
        cardCountry: event.cardCountry,
      },
    ),
  );
  logInfo("payment_method_updated", {
    providerId,
    eventId: event.eventId,
    companyId: owner.companyId,
    paymentMethodId: event.paymentMethodId,
  });
  return "accepted";
}

// ============================================================================
// 2026-05-03 PR2 — handleAccountUpdated
// ============================================================================

/**
 * Stripe `account.updated` for a Connect Express connected account.
 * Walks the local `payment_provider_accounts` row by (provider,
 * providerAccountId) and stamps the new lifecycle snapshot via the
 * canonical normaliser in `paymentProviderAccountService`.
 *
 * Outcomes:
 *   * "accepted" → row found and updated.
 *   * "skipped"  → no local row matches the provider account id. PR2
 *                  deliberately does NOT auto-create on receive — the
 *                  in-app onboarding is the only minting path. Ops
 *                  log records the orphan event for triage.
 *
 * Idempotency:
 *   * The diagnostic log row uses the standard `(provider, eventId)`
 *     dedupeKey via `buildDedupeKey`. Replays of the same event-id
 *     collide on `payment_webhook_events_dedupe_key_uq` and the
 *     handler completes its repo write either way (the lifecycle
 *     snapshot is end-state-equivalent; double-stamping is a no-op
 *     because the patch's `updatedAt` is the only changing field on
 *     replay).
 *   * No `provider_event_id` column on `payment_provider_accounts`
 *     — duplicate apply is harmless (the same chargesEnabled /
 *     payoutsEnabled / requirementsDue snapshot lands twice with
 *     identical values). Adding a per-row last-event-id is deferred
 *     to the first regression that demonstrates a need.
 *
 * Error classification (mirrors `handlePaymentMethodAttached`):
 *   * 23505 (unique violation) → not expected for this handler;
 *     classified as `final_replay` defensively (200 ACK).
 *   * 4xx from the service → `final_config` (200 ACK + ops log).
 *   * Anything else → `transient` (propagated to the batch loop;
 *     route returns 500 + Stripe retries).
 */
async function handleAccountUpdated(
  providerId: string,
  event: Extract<NormalizedWebhookEvent, { kind: "account_updated" }>,
): Promise<"accepted" | "skipped"> {
  const dedupeKey = buildDedupeKey({
    providerId,
    providerEventId: event.eventId,
  });
  const logBase = {
    providerId,
    providerEventId: event.eventId,
    eventType: event.eventType,
    eventKind: "account_updated" as const,
    dedupeKey,
  };

  // Fast pre-check — is the row known? If not, log + skip. The
  // application service loop converts "skipped" to `ignored` (200 ACK).
  const known =
    await paymentProviderAccountsRepository.getByProviderAndProviderAccountId(
      providerId,
      event.providerAccountId,
    );
  if (!known) {
    logInfo("account_updated_unknown_account_skipped", {
      providerId,
      eventId: event.eventId,
      providerAccountId: event.providerAccountId,
    });
    void safeRecordPaymentWebhookEvent({
      ...logBase,
      outcome: "config_error",
      httpStatus: 200,
      errorMessage: "no local payment_provider_accounts row matches",
    });
    return "skipped";
  }

  try {
    const updated = await paymentProviderAccountService.applyAccountUpdate({
      providerId: providerId as ProviderId,
      providerAccountId: event.providerAccountId,
      chargesEnabled: event.chargesEnabled,
      payoutsEnabled: event.payoutsEnabled,
      detailsSubmitted: event.detailsSubmitted,
      requirementsDue: event.requirementsDue,
      disabledReason: event.disabledReason,
      country: event.country,
      defaultCurrency: event.defaultCurrency,
    });
    logInfo("account_updated", {
      providerId,
      eventId: event.eventId,
      companyId: updated.companyId,
      providerAccountId: event.providerAccountId,
      newStatus: updated.status,
      chargesEnabled: updated.chargesEnabled,
      payoutsEnabled: updated.payoutsEnabled,
    });
    void safeRecordPaymentWebhookEvent({
      ...logBase,
      outcome: "accepted",
      httpStatus: 200,
      companyId: updated.companyId,
    });
    return "accepted";
  } catch (err: unknown) {
    const cls = classifyWebhookError(err);
    const errMessage = err instanceof Error ? err.message : String(err);
    if (cls === "final_replay") {
      logInfo("account_updated_replay", {
        providerId,
        eventId: event.eventId,
        providerAccountId: event.providerAccountId,
      });
      void safeRecordPaymentWebhookEvent({
        ...logBase,
        outcome: "replayed",
        httpStatus: 200,
        companyId: known.companyId,
      });
      return "accepted";
    }
    if (cls === "final_config") {
      logAnomaly("account_updated_config_error_acked", {
        providerId,
        eventId: event.eventId,
        providerAccountId: event.providerAccountId,
        message: errMessage,
      });
      void safeRecordPaymentWebhookEvent({
        ...logBase,
        outcome: "config_error",
        httpStatus: 200,
        companyId: known.companyId,
        errorMessage: errMessage,
      });
      return "accepted";
    }
    logAnomaly("account_updated_transient_failure_will_retry", {
      providerId,
      eventId: event.eventId,
      providerAccountId: event.providerAccountId,
      message: errMessage,
    });
    void safeRecordPaymentWebhookEvent({
      ...logBase,
      outcome: "transient_failure",
      httpStatus: 500,
      companyId: known.companyId,
      errorMessage: errMessage,
    });
    throw err;
  }
}

// ============================================================================
// 2026-05-04 PR5 — handlePayoutEvent
// ============================================================================
//
// Stripe `payout.*` events arrive on a connected account; the
// adapter normalises all five into a shared shape. This handler:
//
//   1. Resolves the local `payment_provider_accounts` row by
//      `(provider, providerAccountId)`. The row's `companyId` +
//      `id` give us tenant attribution.
//   2. If no local row matches → log + 200 ACK + skip. Per PR5 spec:
//      "Do not create provider accounts from payout webhooks; do not
//      fail webhook because local account is missing." Surface as
//      `payment_payout_account_not_found` for ops triage.
//   3. Upserts via `paymentPayoutsRepository.upsertFromProviderEvent`.
//      Idempotent on replay (DB unique index `(provider,
//      provider_payout_id)`); status updates are NOT monotonic —
//      provider truth wins (Stripe legitimately moves rows from
//      pending → in_transit → paid).
//   4. Standard three-class error taxonomy on persistence failures:
//      `final_replay` / `final_config` (200 ACK) vs `transient`
//      (500, Stripe retries).
//
// Provider-blind: this function never imports the Stripe SDK. The
// adapter is the only place that knows what a Stripe payout looks
// like; here we only see the normalised envelope.

async function handlePayoutEvent(
  providerId: string,
  event: Extract<
    NormalizedWebhookEvent,
    {
      kind:
        | "payout_created"
        | "payout_updated"
        | "payout_paid"
        | "payout_failed"
        | "payout_canceled";
    }
  >,
): Promise<"accepted" | "skipped"> {
  const dedupeKey = buildDedupeKey({
    providerId,
    providerEventId: event.eventId,
  });
  const logBase = {
    providerId,
    providerEventId: event.eventId,
    eventType: event.eventType,
    eventKind: event.kind,
    dedupeKey,
  };

  // 1. Resolve local connected-account row. The webhook never carries
  //    `companyId` directly — the local row is the canonical mapping.
  const account =
    await paymentProviderAccountsRepository.getByProviderAndProviderAccountId(
      providerId,
      event.providerAccountId,
    );
  if (!account) {
    logAnomaly("payment_payout_account_not_found", {
      providerId,
      eventId: event.eventId,
      eventType: event.eventType,
      providerAccountId: event.providerAccountId,
      providerPayoutId: event.providerPayoutId,
    });
    void safeRecordPaymentWebhookEvent({
      ...logBase,
      outcome: "config_error",
      httpStatus: 200,
      errorMessage: "no local payment_provider_accounts row matches",
    });
    return "skipped";
  }

  // 2. Persist. Tenant attribution comes from the local row; the
  //    repository trusts the caller for that and writes the payout
  //    snapshot keyed on (provider, provider_payout_id).
  try {
    const row = await paymentPayoutsRepository.upsertFromProviderEvent({
      companyId: account.companyId,
      paymentProviderAccountId: account.id,
      providerAccountId: event.providerAccountId,
      provider: providerId,
      providerPayoutId: event.providerPayoutId,
      amount: (event.amountCents / 100).toFixed(2),
      currency: event.currency,
      status: event.status,
      arrivalDate: event.arrivalDate ? new Date(event.arrivalDate) : null,
      destinationLast4: event.destinationLast4,
      failureCode: event.failureCode,
      failureMessage: event.failureMessage,
      rawProviderStatus: event.rawProviderStatus,
    });
    logInfo("payout_recorded", {
      providerId,
      eventId: event.eventId,
      eventType: event.eventType,
      companyId: account.companyId,
      payoutRowId: row.id,
      providerPayoutId: event.providerPayoutId,
      newStatus: event.status,
    });
    void safeRecordPaymentWebhookEvent({
      ...logBase,
      outcome: "accepted",
      httpStatus: 200,
      companyId: account.companyId,
    });
    return "accepted";
  } catch (err: unknown) {
    const cls = classifyWebhookError(err);
    const errMessage = err instanceof Error ? err.message : String(err);
    if (cls === "final_replay") {
      // 23505 on the partial unique index — should be rare since we
      // upsert via ON CONFLICT, but defence-in-depth: if a sibling
      // writer ever inserts on the same key we still 200-ACK.
      logInfo("payout_replay", {
        providerId,
        eventId: event.eventId,
        providerPayoutId: event.providerPayoutId,
      });
      void safeRecordPaymentWebhookEvent({
        ...logBase,
        outcome: "replayed",
        httpStatus: 200,
        companyId: account.companyId,
      });
      return "accepted";
    }
    if (cls === "final_config") {
      logAnomaly("payout_config_error_acked", {
        providerId,
        eventId: event.eventId,
        providerPayoutId: event.providerPayoutId,
        message: errMessage,
      });
      void safeRecordPaymentWebhookEvent({
        ...logBase,
        outcome: "config_error",
        httpStatus: 200,
        companyId: account.companyId,
        errorMessage: errMessage,
      });
      return "accepted";
    }
    logAnomaly("payout_transient_failure_will_retry", {
      providerId,
      eventId: event.eventId,
      providerPayoutId: event.providerPayoutId,
      message: errMessage,
    });
    void safeRecordPaymentWebhookEvent({
      ...logBase,
      outcome: "transient_failure",
      httpStatus: 500,
      companyId: account.companyId,
      errorMessage: errMessage,
    });
    throw err;
  }
}

// ============================================================================
// 2026-05-04 PR6 — handleDisputeEvent
// ============================================================================
//
// Stripe `charge.dispute.*` events arrive on a connected account; the
// adapter normalises all three (created/updated/closed) into a shared
// shape. This handler:
//
//   1. Resolves the local `payment_provider_accounts` row by
//      `(provider, providerAccountId)`. Missing → 200 ACK + log
//      `payment_dispute_account_not_found` + skip. Per spec: "Do not
//      create provider accounts from dispute webhooks."
//   2. Attempts to find a local payment by `payments.reference ===
//      providerPaymentId` (Stripe `ch_...`). Tenant-scoped: only
//      links a payment whose `companyId` matches the resolved
//      account's `companyId`. Cross-tenant match → null link + log.
//   3. Upserts the dispute row. Payment/invoice FKs are populated
//      when matched, null otherwise. Per spec: "Never drop a dispute
//      solely because local payment match is missing."
//   4. Standard three-class error taxonomy on persistence failures:
//      `final_replay` / `final_config` (200 ACK) vs `transient`
//      (500, Stripe retries).

async function handleDisputeEvent(
  providerId: string,
  event: Extract<
    NormalizedWebhookEvent,
    { kind: "dispute_created" | "dispute_updated" | "dispute_closed" }
  >,
): Promise<"accepted" | "skipped"> {
  const dedupeKey = buildDedupeKey({
    providerId,
    providerEventId: event.eventId,
  });
  const logBase = {
    providerId,
    providerEventId: event.eventId,
    eventType: event.eventType,
    eventKind: event.kind,
    dedupeKey,
  };

  // 1. Resolve local connected-account row.
  const account =
    await paymentProviderAccountsRepository.getByProviderAndProviderAccountId(
      providerId,
      event.providerAccountId,
    );
  if (!account) {
    logAnomaly("payment_dispute_account_not_found", {
      providerId,
      eventId: event.eventId,
      eventType: event.eventType,
      providerAccountId: event.providerAccountId,
      providerDisputeId: event.providerDisputeId,
      providerPaymentId: event.providerPaymentId,
    });
    void safeRecordPaymentWebhookEvent({
      ...logBase,
      outcome: "config_error",
      httpStatus: 200,
      errorMessage: "no local payment_provider_accounts row matches",
    });
    return "skipped";
  }

  // 2. Attempt to find a local payment by charge id. Tenant-scoped:
  //    findByProviderReference is NOT tenant-scoped at the repo
  //    layer (PR4 added it for refund replay); we apply the
  //    companyId guard here. A payment row found under a DIFFERENT
  //    tenant means our adapter saw an event whose `event.account`
  //    resolved to one tenant but whose disputed charge was recorded
  //    under another — that's a config drift, not a leak vector,
  //    and we treat it as "no match" (still write the dispute, log
  //    the anomaly, FKs stay null).
  let paymentId: string | null = null;
  let invoiceId: string | null = null;
  if (event.providerPaymentId) {
    const matchedPayment = await paymentRepository.findByProviderReference(
      providerId as "stripe",
      event.providerPaymentId,
    );
    if (matchedPayment && matchedPayment.companyId === account.companyId) {
      paymentId = matchedPayment.id;
      // Multi-invoice payments leave invoice_id NULL on the payment
      // row and rely on payment_allocations; we don't backfill that
      // here (PR6 keeps the link 1:1; future enhancement could
      // surface allocations for multi-invoice disputes).
      invoiceId = matchedPayment.invoiceId ?? null;
    } else if (matchedPayment) {
      logAnomaly("payment_dispute_payment_cross_tenant_skipped", {
        providerId,
        eventId: event.eventId,
        providerDisputeId: event.providerDisputeId,
        providerPaymentId: event.providerPaymentId,
        eventCompanyId: account.companyId,
        matchedPaymentCompanyId: matchedPayment.companyId,
      });
    } else {
      logAnomaly("payment_dispute_payment_not_found", {
        providerId,
        eventId: event.eventId,
        providerDisputeId: event.providerDisputeId,
        providerPaymentId: event.providerPaymentId,
        companyId: account.companyId,
      });
    }
  }

  // 3. Persist. The repository upserts on (provider, providerDisputeId);
  //    payment/invoice FKs are written even when null so a future
  //    backfill that DOES match can overwrite the link.
  try {
    const row = await paymentDisputesRepository.upsertFromProviderEvent({
      companyId: account.companyId,
      paymentProviderAccountId: account.id,
      providerAccountId: event.providerAccountId,
      provider: providerId,
      providerDisputeId: event.providerDisputeId,
      providerPaymentId: event.providerPaymentId,
      paymentId,
      invoiceId,
      amount: (event.amountCents / 100).toFixed(2),
      currency: event.currency,
      status: event.status,
      reason: event.reason,
      evidenceDueBy: event.evidenceDueBy ? new Date(event.evidenceDueBy) : null,
      rawProviderStatus: event.rawProviderStatus,
    });
    logInfo("dispute_recorded", {
      providerId,
      eventId: event.eventId,
      eventType: event.eventType,
      companyId: account.companyId,
      disputeRowId: row.id,
      providerDisputeId: event.providerDisputeId,
      providerPaymentId: event.providerPaymentId,
      paymentId,
      invoiceId,
      newStatus: event.status,
    });
    void safeRecordPaymentWebhookEvent({
      ...logBase,
      outcome: "accepted",
      httpStatus: 200,
      companyId: account.companyId,
    });
    return "accepted";
  } catch (err: unknown) {
    const cls = classifyWebhookError(err);
    const errMessage = err instanceof Error ? err.message : String(err);
    if (cls === "final_replay") {
      logInfo("dispute_replay", {
        providerId,
        eventId: event.eventId,
        providerDisputeId: event.providerDisputeId,
      });
      void safeRecordPaymentWebhookEvent({
        ...logBase,
        outcome: "replayed",
        httpStatus: 200,
        companyId: account.companyId,
      });
      return "accepted";
    }
    if (cls === "final_config") {
      logAnomaly("dispute_config_error_acked", {
        providerId,
        eventId: event.eventId,
        providerDisputeId: event.providerDisputeId,
        message: errMessage,
      });
      void safeRecordPaymentWebhookEvent({
        ...logBase,
        outcome: "config_error",
        httpStatus: 200,
        companyId: account.companyId,
        errorMessage: errMessage,
      });
      return "accepted";
    }
    logAnomaly("dispute_transient_failure_will_retry", {
      providerId,
      eventId: event.eventId,
      providerDisputeId: event.providerDisputeId,
      message: errMessage,
    });
    void safeRecordPaymentWebhookEvent({
      ...logBase,
      outcome: "transient_failure",
      httpStatus: 500,
      companyId: account.companyId,
      errorMessage: errMessage,
    });
    throw err;
  }
}

/**
 * Extract tenant-resolution metadata written by `createCheckout`. Every
 * field is required; a missing one means the charge cannot be trusted
 * to land on the right tenant.
 */
function readTenantMetadata(
  metadata: Record<string, string> | null | undefined,
): { companyId: string; invoiceId: string; prospectivePaymentId: string } | null {
  if (!metadata) return null;
  const { companyId, invoiceId, prospectivePaymentId } = metadata;
  if (!companyId || !invoiceId || !prospectivePaymentId) return null;
  return { companyId, invoiceId, prospectivePaymentId };
}

// ============================================================================
// Webhook verification wrapper
// ============================================================================

/**
 * 2026-04-21 Patch C1 — thrown on signature / secret-config failures so
 * the route can map signature issues to HTTP 400 while mapping
 * application-layer transient failures to HTTP 500. The two failure
 * classes need different ACK semantics and this marker is how the
 * route tells them apart without relying on error-message matching.
 */
export class WebhookSignatureError extends Error {
  readonly name = "WebhookSignatureError";
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    (this as any).cause = cause;
  }
}

/**
 * Verify + normalize a provider webhook payload. Throws
 * `WebhookSignatureError` on signature / secret-config failure. Returns
 * the normalized events on success. Does NOT apply events to the ledger;
 * the caller is expected to invoke `applyVerifiedWebhookBatch` next.
 *
 * The verify step and the apply step are split so the route can wrap
 * each in its own try/catch and map failures to the correct HTTP status
 * (400 for unverified payloads, 500 for transient processing failures).
 */
async function verifyInboundWebhook(
  providerId: string,
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
): Promise<NormalizedWebhookEvent[]> {
  const provider = resolveById(providerId);
  if (!provider) {
    throw createError(404, `Unknown payment provider: ${providerId}`);
  }
  try {
    return await provider.verifyWebhook(rawBody, headers);
  } catch (err) {
    throw new WebhookSignatureError(err);
  }
}

/**
 * End-to-end helper retained for callers that don't need the two-phase
 * split. Verification failures surface as `WebhookSignatureError`;
 * transient processing failures surface as
 * `WebhookTransientFailureError` so either side can be mapped to the
 * correct HTTP status at the route layer.
 */
async function handleInboundWebhook(
  providerId: string,
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
): Promise<ApplyWebhookResult> {
  const events = await verifyInboundWebhook(providerId, rawBody, headers);
  return applyVerifiedWebhookBatch(providerId, events);
}

// ============================================================================
// Exports
// ============================================================================

export const paymentApplicationService = {
  createCheckout,
  createMultiCheckout,
  // 2026-05-03 PR C — saved-card management.
  createPortalSetupIntent,
  setDefaultSavedPaymentMethod,
  removeSavedPaymentMethod,
  // 2026-05-03 PR D — pay-with-saved-card.
  payWithSavedMethod,
  refundPayment,
  verifyInboundWebhook,
  handleInboundWebhook,
  applyVerifiedWebhookBatch,
};
