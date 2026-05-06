/**
 * Stripe implementation of the PaymentProvider contract.
 *
 * This file is the ONLY place outside `stripeClient.ts` that imports the
 * Stripe SDK. Route handlers, the application service, and the canonical
 * payment repository stay provider-blind.
 */

import type Stripe from "stripe";
import {
  getStripeClient,
  getStripeWebhookSecret,
} from "../../stripeClient";
import { createError } from "../../../middleware/errorHandler";
import type {
  CreateAccountInput,
  CreateAccountLinkInput,
  CreateCheckoutInput,
  CreateCheckoutResult,
  CreateCheckoutSessionInput,
  CreateCheckoutSessionResult,
  CreateCustomerInput,
  CreateCustomerResult,
  CreateOffSessionPaymentInput,
  CreateOffSessionPaymentResult,
  CreateSetupIntentInput,
  CreateSetupIntentResult,
  DetachPaymentMethodInput,
  NormalizedWebhookEvent,
  OnboardingLink,
  PaymentProvider,
  ProviderAccountState,
  RefundInput,
  RefundResult,
  RetrieveAccountInput,
} from "./types";

/** Friendly 503 when the Stripe env is not set on this deployment. */
function assertStripeConfigured() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw createError(503, "Stripe is not configured on this server");
  }
}

/**
 * 2026-05-03 PR4 — Connect requires `acct_...` on every SDK call that
 * touches per-tenant resources. This guard is the structural defence
 * against a regression where a future caller accidentally drops the
 * field — the adapter refuses to call Stripe at all without it, so a
 * platform-account fallback is impossible.
 */
function assertConnectAccount(providerAccountId: string | null | undefined) {
  if (!providerAccountId) {
    throw createError(
      500,
      "Internal error: providerAccountId is required for Stripe Connect calls",
    );
  }
}

/**
 * Map a Stripe refund `status` (string) into the narrowed union the
 * application service consumes. Anything unexpected is folded into
 * "pending" — safer to wait for the webhook than to claim a terminal
 * state we don't understand.
 */
function normalizeStripeRefundStatus(
  s: string | null | undefined,
): RefundResult["status"] {
  if (s === "succeeded") return "succeeded";
  if (s === "failed" || s === "canceled") return "failed";
  return "pending";
}

/** Extract charge id from a PaymentIntent's `latest_charge`, null-safe. */
function extractChargeId(
  latest: Stripe.PaymentIntent["latest_charge"],
): string | null {
  if (typeof latest === "string") return latest;
  if (latest && typeof latest === "object") return (latest as Stripe.Charge).id;
  return null;
}

/**
 * 2026-05-03 PR2 — map a Stripe Account object to the provider-neutral
 * `ProviderAccountState`. Used by both `createAccount` /
 * `retrieveAccount` and the `account.updated` webhook normaliser.
 *
 * `requirements_due` is mirrored as the WHOLE Stripe `requirements`
 * sub-object (currently_due / eventually_due / past_due /
 * pending_verification) so the onboarding UI can render the live
 * remediation list without a second SDK round-trip.
 *
 * `disabled_reason` is preserved verbatim from Stripe; it's a free-text
 * field with values like `rejected.fraud`, `requirements.past_due`,
 * `under_review`. The UI surfaces it as a status hint, not a string
 * the user types.
 */
/**
 * 2026-05-04 PR5 — Map a Stripe Payout object + event metadata to the
 * provider-neutral `payout_*` normalized event.
 *
 * Status mapping (Stripe → our enum):
 *   pending     → pending
 *   in_transit  → in_transit
 *   paid        → paid
 *   failed      → failed
 *   canceled    → canceled
 *   anything else (incl. future Stripe-added states) → pending,
 *     verbatim Stripe value preserved on `rawProviderStatus` so
 *     ops can investigate without grepping the Stripe Node typings.
 *
 * Discriminating `kind` is derived from the event type (one event
 * type per kind) so the application service can switch on it.
 *
 * `destinationLast4` is opportunistic — Stripe sometimes expands the
 * destination object on the payout payload (e.g. when the payout was
 * just created and the bank account was attached on the same flow);
 * sometimes it sends just an opaque id (`ba_...`). When the object is
 * absent, we leave last4 null. We never refetch — the privacy
 * minimisation rule from PR1 says "store only safe destination
 * summary, such as last4; do NOT retrieve full bank account unless
 * already available in event payload".
 */
type PayoutKind =
  | "payout_created"
  | "payout_updated"
  | "payout_paid"
  | "payout_failed"
  | "payout_canceled";
type PayoutStatus = "pending" | "in_transit" | "paid" | "failed" | "canceled";

function mapStripePayoutEvent(
  eventId: string,
  eventType: string,
  eventAccount: string,
  payout: Stripe.Payout,
): NormalizedWebhookEvent {
  const kind: PayoutKind = (() => {
    switch (eventType) {
      case "payout.created":
        return "payout_created";
      case "payout.paid":
        return "payout_paid";
      case "payout.failed":
        return "payout_failed";
      case "payout.canceled":
        return "payout_canceled";
      default:
        // Stripe emits `payout.updated` for every intermediate state
        // change (in_transit, etc.). Anything else also folds here.
        return "payout_updated";
    }
  })();

  const rawStatus = payout.status ?? "pending";
  const status: PayoutStatus =
    rawStatus === "pending" ||
    rawStatus === "in_transit" ||
    rawStatus === "paid" ||
    rawStatus === "failed" ||
    rawStatus === "canceled"
      ? rawStatus
      : "pending";

  // Stripe's `arrival_date` is a Unix timestamp in seconds; convert
  // to ISO string. May be 0 / null on never-scheduled payouts (rare).
  const arrivalDate =
    typeof payout.arrival_date === "number" && payout.arrival_date > 0
      ? new Date(payout.arrival_date * 1000).toISOString()
      : null;

  return {
    kind,
    eventId,
    eventType,
    providerAccountId: eventAccount,
    providerPayoutId: payout.id,
    amountCents: payout.amount ?? 0,
    currency: (payout.currency ?? "usd").toLowerCase(),
    status,
    arrivalDate,
    destinationLast4: extractStripePayoutDestinationLast4(payout.destination),
    failureCode: payout.failure_code ?? null,
    failureMessage: payout.failure_message ?? null,
    rawProviderStatus: rawStatus,
  };
}

/**
 * Stripe's `payout.destination` is `string | DeletedBankAccount |
 * BankAccount | DeletedCard | Card | null`. We pull `last4` ONLY when
 * Stripe expanded the object; opaque-string `ba_...` / `card_...`
 * ids return null without an SDK round-trip. Same privacy rule as
 * mapStripePayoutEvent.
 */
function extractStripePayoutDestinationLast4(
  destination: Stripe.Payout["destination"],
): string | null {
  if (!destination || typeof destination === "string") return null;
  // Bank account objects have `last4`; card objects also have `last4`.
  // Both DeletedBankAccount / DeletedCard lack the field — return null.
  const obj = destination as { last4?: string };
  return typeof obj.last4 === "string" ? obj.last4 : null;
}

/**
 * 2026-05-04 PR6 — Map a Stripe Dispute object + event metadata to
 * the provider-neutral `dispute_*` normalized event.
 *
 * Status mapping (Stripe → our enum):
 *   needs_response          → needs_response
 *   under_review            → under_review
 *   won                     → won
 *   lost                    → lost
 *   warning_needs_response  → warning_needs_response
 *   warning_under_review    → warning_under_review
 *   warning_closed          → warning_closed
 *   closed                  → closed
 *   anything else (incl. future Stripe-added states) → under_review,
 *     verbatim Stripe value preserved on `rawProviderStatus`.
 *
 * Discriminating `kind` is derived from event type. `charge.dispute.
 * funds_withdrawn` and `funds_reinstated` events also exist at Stripe
 * but emit identical state — we treat them as `dispute_updated` if
 * they ever land here, but the case statement intentionally does NOT
 * subscribe to them yet (out of scope for PR6).
 *
 * Charge id resolution: Stripe disputes ALWAYS carry `dispute.charge`
 * (the disputed `ch_...`). We prefer `dispute.payment_intent` when
 * present (newer disputes do), falling back to `dispute.charge`.
 * This goes into `providerPaymentId`, which the application service
 * matches against `payments.reference` to backfill payment_id /
 * invoice_id when a local row exists.
 *
 * Evidence due-by: Stripe puts this at `dispute.evidence_details.
 * due_by` as a Unix timestamp in seconds. NULL on warnings.
 */
function mapStripeDisputeEvent(
  eventId: string,
  eventType: string,
  eventAccount: string,
  dispute: Stripe.Dispute,
): NormalizedWebhookEvent {
  const kind: "dispute_created" | "dispute_updated" | "dispute_closed" =
    eventType === "charge.dispute.created"
      ? "dispute_created"
      : eventType === "charge.dispute.closed"
        ? "dispute_closed"
        : "dispute_updated";

  // Cast to plain string so TS doesn't narrow this against the
  // Stripe SDK's evolving Dispute.Status union (which has added
  // `"prevented"` and may add others). Our normalised enum is
  // `paymentDisputeStatusEnum` from PR1 — anything Stripe sends that
  // doesn't match it folds to `under_review` per PR6 spec.
  const rawStatus: string = dispute.status ?? "under_review";
  const status:
    | "needs_response"
    | "under_review"
    | "won"
    | "lost"
    | "warning_needs_response"
    | "warning_under_review"
    | "warning_closed"
    | "closed" =
    rawStatus === "needs_response" ||
    rawStatus === "under_review" ||
    rawStatus === "won" ||
    rawStatus === "lost" ||
    rawStatus === "warning_needs_response" ||
    rawStatus === "warning_under_review" ||
    rawStatus === "warning_closed" ||
    rawStatus === "closed"
      ? rawStatus
      : "under_review";

  // payment_intent landed in Stripe's dispute model later than charge;
  // both are on every modern dispute but charge is the more reliable
  // backfill key for our `payments.reference` (Stripe stamps `ch_...`
  // there on the original `payment_intent.succeeded` webhook).
  const providerPaymentId = extractStripeDisputeChargeId(dispute);

  const evidenceDueBy =
    dispute.evidence_details &&
    typeof dispute.evidence_details.due_by === "number" &&
    dispute.evidence_details.due_by > 0
      ? new Date(dispute.evidence_details.due_by * 1000).toISOString()
      : null;

  return {
    kind,
    eventId,
    eventType,
    providerAccountId: eventAccount,
    providerDisputeId: dispute.id,
    providerPaymentId,
    amountCents: dispute.amount ?? 0,
    currency: (dispute.currency ?? "usd").toLowerCase(),
    status,
    reason: dispute.reason ?? null,
    evidenceDueBy,
    rawProviderStatus: rawStatus,
  };
}

/**
 * Pull the `ch_...` charge id off a Stripe Dispute. Disputes always
 * have one; payment_intent is also present on modern disputes but we
 * prefer the charge id for backfill (matches `payments.reference`
 * which is `ch_...` per the PR4 webhook handler).
 */
function extractStripeDisputeChargeId(dispute: Stripe.Dispute): string {
  const charge = dispute.charge;
  if (typeof charge === "string") return charge;
  if (charge && typeof charge === "object") {
    return (charge as Stripe.Charge).id;
  }
  // Defensive fallback — should never hit in practice.
  return "";
}

function mapStripeAccountToState(
  account: Stripe.Account,
): ProviderAccountState {
  return {
    providerId: "stripe",
    providerAccountId: account.id,
    chargesEnabled: account.charges_enabled ?? false,
    payoutsEnabled: account.payouts_enabled ?? false,
    detailsSubmitted: account.details_submitted ?? false,
    requirementsDue: account.requirements ?? null,
    disabledReason: account.requirements?.disabled_reason ?? null,
    country: account.country ?? null,
    defaultCurrency: account.default_currency ?? null,
  };
}

export const stripeAdapter: PaymentProvider = {
  id: "stripe",

  // --------------------------------------------------------------------
  // 2026-05-03 PR A — createCustomer (saved-card foundation).
  //
  // Lazily creates a Stripe Customer object for a given (tenant,
  // customer-company) pair. Called by `customerCompanyPaymentService.
  // resolveOrCreateProviderCustomer` ONLY when the persisted
  // `customer_companies.provider_customer_id` is null.
  //
  // The metadata round-trip is the only tenant-resolution carrier on
  // future Stripe-dashboard reconciliation paths — a Stripe support
  // engineer triaging a Customer should see `{ companyId,
  // customerCompanyId }` on the object directly, no DB lookup needed.
  //
  // Idempotency: NOT idempotent at this layer. Stripe's
  // `customers.create` will happily mint two distinct Customer objects
  // for the same input — the resolver service guards against double-
  // mint via a `SELECT FOR UPDATE` + INSERT inside a transaction.
  // Using Stripe's `idempotencyKey` here is also possible, but the
  // resolver pattern is the canonical guard the rest of the codebase
  // uses; Stripe-side dedupe is belt-and-suspenders.
  // --------------------------------------------------------------------
  async createCustomer(
    input: CreateCustomerInput,
  ): Promise<CreateCustomerResult> {
    assertStripeConfigured();
    assertConnectAccount(input.providerAccountId);
    const stripe = getStripeClient();

    const customer = await stripe.customers.create(
      {
        name: input.name,
        // Stripe requires `email` to be a string OR omitted; never empty.
        ...(input.email ? { email: input.email } : {}),
        metadata: input.metadata,
      },
      // 2026-05-03 PR4 — Connect Direct Charges. Customer lives ON the
      // connected account, NOT the platform.
      { stripeAccount: input.providerAccountId },
    );

    return {
      providerId: "stripe",
      providerCustomerId: customer.id,
    };
  },

  // --------------------------------------------------------------------
  // 2026-05-03 PR C — createSetupIntent (saved-card management).
  //
  // The portal "Add a card" flow has no associated payment — the
  // customer is just adding a card for future use. Stripe's canonical
  // primitive for that is the SetupIntent, which is confirmed
  // client-side by Stripe Elements. On confirmation, Stripe attaches
  // the resulting PaymentMethod to the customer and fires the
  // `payment_method.attached` webhook (already handled in PR B).
  //
  // Consent metadata is forwarded the same way it is on a PaymentIntent
  // — the webhook normalizer reads SetupIntent metadata as a fallback
  // when no recent PI carries consent (handled in verifyWebhook below).
  //
  // `usage: "off_session"` matches the PR B PaymentIntent path so the
  // SCA mode the customer experiences during confirmation is identical
  // to the during-payment save flow.
  // --------------------------------------------------------------------
  async createSetupIntent(
    input: CreateSetupIntentInput,
  ): Promise<CreateSetupIntentResult> {
    assertStripeConfigured();
    assertConnectAccount(input.providerAccountId);
    if (!process.env.STRIPE_PUBLISHABLE_KEY) {
      throw createError(503, "Stripe publishable key is not configured");
    }
    const stripe = getStripeClient();

    const setupIntent = await stripe.setupIntents.create(
      {
        customer: input.providerCustomerId,
        usage: "off_session",
        // `automatic_payment_methods.enabled = true` matches the
        // PaymentIntent shape so the same Elements config works for
        // both flows.
        automatic_payment_methods: { enabled: true },
        metadata: input.metadata,
      },
      // 2026-05-03 PR4 — SetupIntent runs on the connected account so
      // the resulting PaymentMethod attaches to a customer that ALSO
      // lives on the connected account. Cross-account PMs do not work.
      { stripeAccount: input.providerAccountId },
    );

    return {
      providerId: "stripe",
      clientToken: setupIntent.client_secret ?? "",
      providerSetupIntentId: setupIntent.id,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    };
  },

  // --------------------------------------------------------------------
  // 2026-05-03 PR C — detachPaymentMethod (saved-card management).
  //
  // Removes the PaymentMethod from the customer at Stripe so future
  // off-session charges fail at the provider, not just locally. The
  // application service marks the local row detached AFTER this call
  // returns; the `payment_method.detached` webhook is the safety net
  // for races (Stripe-dashboard detaches, retry interleavings, etc.).
  //
  // Idempotent at Stripe — calling detach twice on the same PM is a
  // no-op; we just don't bubble that as an error.
  // --------------------------------------------------------------------
  async detachPaymentMethod(input: DetachPaymentMethodInput): Promise<void> {
    assertStripeConfigured();
    assertConnectAccount(input.providerAccountId);
    const stripe = getStripeClient();
    try {
      // 2026-05-03 PR4 — detach must be on the same connected account
      // that owns the PaymentMethod. Stripe rejects platform-account
      // detach calls for connected-account-owned PMs as resource_missing.
      await stripe.paymentMethods.detach(
        input.providerPaymentMethodId,
        undefined,
        { stripeAccount: input.providerAccountId },
      );
    } catch (err: unknown) {
      // Stripe returns "resource_missing" when the PM is already
      // detached. Treat as success — the local mark-detached path is
      // idempotent too.
      const e = err as { code?: string; raw?: { code?: string } };
      const code = e?.code ?? e?.raw?.code;
      if (code === "resource_missing") return;
      throw err;
    }
  },

  // --------------------------------------------------------------------
  // 2026-05-03 PR D — createOffSessionPayment (pay-with-saved-card).
  //
  // Charges an existing PaymentMethod against an existing Customer
  // immediately. Stripe attempts the confirm synchronously and the
  // result discriminates the four outcomes the application service
  // cares about:
  //
  //   • succeeded         → terminal; webhook will record the row.
  //   • processing        → still confirming (rare for cards). Webhook
  //                         arrives shortly.
  //   • requires_action   → 3DS challenge needed. Off-session can't
  //                         satisfy. The route surfaces a 402 +
  //                         message; the frontend re-mounts Elements
  //                         on the regular Pay flow to perform the
  //                         on-session challenge.
  //   • failed            → declined. `declineCode` carries Stripe's
  //                         reason when present.
  //
  // Idempotency:
  //   `idempotencyKey` is the same UUID the application service will
  //   write as `payments.id` on success — same chain PR 1 established.
  //   Stripe returns the SAME PaymentIntent on a retry with the same
  //   key, so the webhook never double-records.
  // --------------------------------------------------------------------
  async createOffSessionPayment(
    input: CreateOffSessionPaymentInput,
  ): Promise<CreateOffSessionPaymentResult> {
    assertStripeConfigured();
    assertConnectAccount(input.providerAccountId);
    const stripe = getStripeClient();

    let intent: Stripe.PaymentIntent;
    try {
      intent = await stripe.paymentIntents.create(
        {
          amount: input.amountCents,
          currency: input.currency,
          customer: input.providerCustomerId,
          payment_method: input.providerPaymentMethodId,
          off_session: true,
          confirm: true,
          metadata: input.metadata,
        },
        // 2026-05-03 PR4 — Idempotency keys are scoped (account, key)
        // in Stripe Connect, so the same key on a different connected
        // account does NOT collide. Funds settle on the connected
        // account, not the platform.
        {
          idempotencyKey: input.idempotencyKey,
          stripeAccount: input.providerAccountId,
        },
      );
    } catch (err: unknown) {
      // Stripe throws StripeCardError on hard declines for off-session
      // confirms; the error carries the failed PaymentIntent on
      // `error.payment_intent` so we can still surface its id.
      const e = err as {
        type?: string;
        code?: string;
        decline_code?: string;
        message?: string;
        payment_intent?: Stripe.PaymentIntent;
        raw?: { code?: string; decline_code?: string };
      };
      const failedIntent = e?.payment_intent;
      // `requires_action` arrives via the error path on off-session
      // when the issuer asks for SCA. Map to its own status so the
      // route can return 402 with a "use the regular pay flow"
      // message instead of a generic decline.
      const intentStatus = failedIntent?.status;
      if (intentStatus === "requires_action" && failedIntent) {
        return {
          providerId: "stripe",
          providerPaymentId: failedIntent.id,
          status: "requires_action",
          latestChargeId: extractChargeId(failedIntent.latest_charge),
          message:
            "This card needs additional verification. Please use the regular Pay flow to complete this charge.",
        };
      }
      return {
        providerId: "stripe",
        providerPaymentId: failedIntent?.id ?? "",
        status: "failed",
        latestChargeId: extractChargeId(failedIntent?.latest_charge ?? null),
        declineCode: e?.decline_code ?? e?.raw?.decline_code ?? null,
        message:
          e?.message ?? "The card was declined. Please use a different card or try again.",
      };
    }

    // Happy paths.
    const status: CreateOffSessionPaymentResult["status"] =
      intent.status === "succeeded"
        ? "succeeded"
        : intent.status === "processing"
          ? "processing"
          : intent.status === "requires_action"
            ? "requires_action"
            : "failed";
    const message =
      status === "requires_action"
        ? "This card needs additional verification. Please use the regular Pay flow to complete this charge."
        : status === "failed"
          ? `Payment did not complete (status=${intent.status}).`
          : null;
    return {
      providerId: "stripe",
      providerPaymentId: intent.id,
      status,
      latestChargeId: extractChargeId(intent.latest_charge),
      message,
    };
  },

  // --------------------------------------------------------------------
  // 2026-05-03 PR2 — createAccount (Stripe Connect Express).
  //
  // Mints a fresh Stripe `Express` connected account for the tenant.
  // Express is the right product tier for our shape:
  //   * Stripe owns the onboarding UI (we redirect via accountLinks).
  //   * Tenant gets a Stripe-hosted dashboard for refunds / disputes /
  //     payouts — we don't have to rebuild that UI ourselves.
  //   * Connect platform takes responsibility for KYC/AML; the
  //     tenant's bank account info NEVER touches our DB.
  //
  // Capabilities requested:
  //   * `card_payments` — accept card charges.
  //   * `transfers`     — receive payouts to the tenant's bank.
  // Both are required for the standard "merchant of record = tenant"
  // collection model. We do NOT request `card_issuing` /
  // `treasury` etc. — those are out of scope for PR2.
  //
  // Idempotency: NOT idempotent at this layer. Stripe will happily
  // mint two distinct Account objects on retry. The
  // `paymentProviderAccountService.getOrCreateAccount` flow guards
  // against double-mint via row-level locking on
  // `payment_provider_accounts`.
  // --------------------------------------------------------------------
  async createAccount(
    input: CreateAccountInput,
  ): Promise<ProviderAccountState> {
    assertStripeConfigured();
    const stripe = getStripeClient();

    const params: Stripe.AccountCreateParams = {
      type: "express",
      country: input.country,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      // Metadata round-trips our tenant id so a Stripe support engineer
      // triaging an Express account can identify the tenant without a
      // DB lookup.
      metadata: {
        companyId: input.companyId,
      },
      ...(input.email ? { email: input.email } : {}),
      ...(input.businessName
        ? { business_profile: { name: input.businessName } }
        : {}),
    };
    const account = await stripe.accounts.create(params);
    return mapStripeAccountToState(account);
  },

  // --------------------------------------------------------------------
  // 2026-05-03 PR2 — createAccountLink (Connect onboarding URL).
  //
  // Stripe `accountLinks.create` returns a one-time URL the tenant
  // visits to complete KYC / business details / bank account
  // verification. Two URLs from the caller:
  //
  //   * `refresh_url` — Stripe redirects here when the link expires
  //                     mid-flow (or the tenant abandons + re-clicks).
  //                     The caller's route should mint a fresh link
  //                     and redirect the tenant back into Stripe.
  //   * `return_url`  — Stripe redirects here on completion. The
  //                     caller's route typically calls
  //                     `retrieveAndSyncAccount` to refresh the local
  //                     row and then renders the post-onboarding state.
  //
  // The link itself is a short-lived URL (Stripe: ~5 minutes) — the
  // service layer is responsible for caching / not caching as needed.
  // --------------------------------------------------------------------
  async createAccountLink(
    input: CreateAccountLinkInput,
  ): Promise<OnboardingLink> {
    assertStripeConfigured();
    const stripe = getStripeClient();

    const link = await stripe.accountLinks.create({
      account: input.providerAccountId,
      refresh_url: input.refreshUrl,
      return_url: input.returnUrl,
      type: "account_onboarding",
    });
    // Stripe returns `expires_at` as a unix timestamp (seconds). Convert
    // to UTC ISO-string so the route can return it as JSON without
    // worrying about timezone conventions.
    const expiresAt =
      typeof link.expires_at === "number"
        ? new Date(link.expires_at * 1000).toISOString()
        : null;
    return {
      providerId: "stripe",
      url: link.url,
      expiresAt,
    };
  },

  // --------------------------------------------------------------------
  // 2026-05-03 PR2 — retrieveAccount (refresh provider state).
  //
  // Authoritative pull of the Connect account's current state.
  // Called by:
  //   1. service-layer "refresh" — explicit operator-triggered poll.
  //   2. webhook handler — when an `account.updated` event arrives
  //      and we want to re-fetch instead of trusting partial payloads.
  //
  // Throws `404` if the account has been deleted at Stripe (rare; the
  // service layer handles by marking the local row `disabled` with
  // a synthetic disabled_reason).
  // --------------------------------------------------------------------
  async retrieveAccount(
    input: RetrieveAccountInput,
  ): Promise<ProviderAccountState> {
    assertStripeConfigured();
    const stripe = getStripeClient();
    try {
      const account = await stripe.accounts.retrieve(input.providerAccountId);
      return mapStripeAccountToState(account);
    } catch (err: unknown) {
      const e = err as { code?: string; raw?: { code?: string } };
      const code = e?.code ?? e?.raw?.code;
      if (code === "resource_missing") {
        throw createError(
          404,
          `Provider account ${input.providerAccountId} not found at Stripe`,
        );
      }
      throw err;
    }
  },

  // --------------------------------------------------------------------
  // createCheckout — returns a clientSecret for Stripe Elements.
  // --------------------------------------------------------------------
  async createCheckout(
    input: CreateCheckoutInput,
  ): Promise<CreateCheckoutResult> {
    assertStripeConfigured();
    assertConnectAccount(input.providerAccountId);
    // publishable key is required on the portal (customer device loads
    // Stripe.js); not needed on staff surfaces that don't mount Elements.
    if (input.source === "portal" && !process.env.STRIPE_PUBLISHABLE_KEY) {
      throw createError(503, "Stripe publishable key is not configured");
    }

    const stripe = getStripeClient();
    // 2026-05-03 PR B — saved-card foundation. When `providerCustomerId`
    // + `setupFutureUsage` are present, Stripe attaches the resulting
    // PaymentMethod to the customer and primes it for re-use. Both
    // params travel together; the application service enforces the
    // pair-wise rule before calling here.
    const params: Stripe.PaymentIntentCreateParams = {
      amount: input.amountCents,
      currency: input.currency,
      automatic_payment_methods: { enabled: true },
      // Metadata is the ONLY tenant-resolution carrier on the webhook
      // path — it must be round-tripped verbatim. The application
      // service composes this; the adapter just forwards.
      metadata: input.metadata,
    };
    if (input.providerCustomerId) {
      params.customer = input.providerCustomerId;
    }
    if (input.setupFutureUsage) {
      params.setup_future_usage = input.setupFutureUsage;
    }
    // 2026-05-03 PR4 — Connect Direct Charges. PaymentIntent runs on
    // the tenant's connected account; funds settle there. The frontend
    // confirms with Stripe Elements using the same {stripeAccount}
    // hint the publishable key is bound to (Stripe.js loads with
    // stripeAccount).
    const intent = await stripe.paymentIntents.create(params, {
      idempotencyKey: input.idempotencyKey,
      stripeAccount: input.providerAccountId,
    });

    return {
      providerId: "stripe",
      clientToken: intent.client_secret ?? "",
      providerPaymentId: intent.id,
      publishableKey:
        input.source === "portal" ? process.env.STRIPE_PUBLISHABLE_KEY : undefined,
      // 2026-05-05: portal payments need the connected-account id on
      // the client so `loadStripe(key, { stripeAccount })` can fetch
      // the Direct-Charges PaymentIntent. Without this the iframe
      // sits on a 404 and `onReady` never fires.
      providerAccountId:
        input.source === "portal" ? input.providerAccountId : undefined,
    };
  },

  // --------------------------------------------------------------------
  // 2026-05-03 createCheckoutSession — multi-invoice path.
  //
  // Uses Stripe's Checkout Sessions API (NOT PaymentIntents). One
  // session = one payment row written by the webhook. The session
  // creates its own PaymentIntent internally; we capture its id in the
  // result so the application service / observability can correlate.
  //
  // The session enforces server-side amounts: each `lineItem` becomes
  // a Stripe `line_items` entry with `unit_amount` set in cents. The
  // customer cannot override; Stripe charges exactly the sum we set.
  // This is the structural defense against client-supplied totals.
  //
  // Metadata round-trip: `companyId`, `invoiceIds` (JSON-encoded
  // string[]), `prospectivePaymentId`. The webhook handler reads these
  // verbatim — never trusts client-side state.
  // --------------------------------------------------------------------
  async createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<CreateCheckoutSessionResult> {
    assertStripeConfigured();
    assertConnectAccount(input.providerAccountId);
    const stripe = getStripeClient();

    if (input.lineItems.length === 0) {
      throw createError(400, "At least one invoice is required for checkout");
    }
    // Sanity: every line item must align with the invoiceIds array.
    if (input.lineItems.length !== input.invoiceIds.length) {
      throw createError(
        500,
        "Internal error: lineItems / invoiceIds length mismatch",
      );
    }

    // 2026-05-03 PR B — saved-card foundation. When set, attach the
    // session to the customer and prime the resulting PaymentMethod
    // for re-use. The PI created by the session inherits both fields
    // via `payment_intent_data`.
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      line_items: input.lineItems.map((li) => ({
        price_data: {
          currency: input.currency,
          product_data: {
            name: li.description,
            // The invoice id ends up on the Stripe receipt under
            // product metadata — useful for the buyer reconciling
            // their statement against our invoice numbers.
            metadata: { invoiceId: li.invoiceId },
          },
          unit_amount: li.amountCents,
        },
        quantity: 1,
      })),
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      // The session-level metadata is the canonical webhook tenant
      // resolver. invoiceIds is a JSON string because Stripe metadata
      // is flat key/value (no arrays). The application service
      // re-parses on the webhook side.
      metadata: input.metadata,
      // Forward the SAME metadata to the underlying PaymentIntent so
      // a stray `payment_intent.succeeded` arriving without the
      // `checkout.session.completed` still carries the resolver bits
      // — though the multi-invoice handler is gated on
      // `invoiceIds` metadata so it always wins.
      payment_intent_data: {
        metadata: input.metadata,
        ...(input.setupFutureUsage
          ? { setup_future_usage: input.setupFutureUsage }
          : {}),
      },
    };
    if (input.providerCustomerId) {
      sessionParams.customer = input.providerCustomerId;
    }
    // 2026-05-03 PR4 — Connect Direct Charges. Checkout Session runs
    // on the connected account; the PI created internally inherits
    // the same account context. Idempotency keys are scoped per
    // connected account.
    const session = await stripe.checkout.sessions.create(sessionParams, {
      idempotencyKey: input.idempotencyKey,
      stripeAccount: input.providerAccountId,
    });

    return {
      providerId: "stripe",
      sessionId: session.id,
      checkoutUrl: session.url ?? "",
      providerPaymentIntentId:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : (session.payment_intent?.id ?? null),
    };
  },

  // --------------------------------------------------------------------
  // refundPayment — actually moves money back at the provider.
  // --------------------------------------------------------------------
  async refundPayment(input: RefundInput): Promise<RefundResult> {
    assertStripeConfigured();
    assertConnectAccount(input.providerAccountId);
    const stripe = getStripeClient();

    // `payment_intent` accepts a `pi_...` OR the charge id. The parent
    // payment row stores the charge id in `reference` (written by the
    // `payment_intent.succeeded` webhook handler), so callers pass that.
    //
    // 2026-05-03 PR4 — Refund MUST be on the same connected account
    // that originated the charge. The parent `payments.provider_account_id`
    // column is the canonical source of that id; the application
    // service reads it back and passes it through here.
    const refund = await stripe.refunds.create(
      {
        payment_intent: input.providerPaymentId,
        amount: input.amountCents,
        reason: toStripeReason(input.reason),
      },
      {
        idempotencyKey: input.idempotencyKey,
        stripeAccount: input.providerAccountId,
      },
    );

    return {
      providerRefundId: refund.id,
      status: normalizeStripeRefundStatus(refund.status),
    };
  },

  // --------------------------------------------------------------------
  // verifyWebhook — authenticate + normalize. One Stripe event can
  // produce multiple normalized events (charge.refunded carries N
  // refunds), so we return an array.
  // --------------------------------------------------------------------
  async verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<NormalizedWebhookEvent[]> {
    const sigHeader = headers["stripe-signature"];
    const sig = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader ?? "";
    const secret = getStripeWebhookSecret();

    const stripe = getStripeClient();
    // Throws on bad signature / missing secret. The route layer catches
    // and returns 400 so Stripe keeps the event queued.
    const event = stripe.webhooks.constructEvent(rawBody, sig, secret);

    // 2026-05-03 PR4 — Connect attribution. Stripe sets `event.account`
    // on every webhook delivered for a connected account; it's null /
    // undefined for platform-level events (e.g. `account.updated` is a
    // hybrid — the account ID is on event.account because Connect
    // Express accounts are platform-owned). We surface this verbatim
    // on the normalised event; the application service is the single
    // source of truth for "is this allowed for this tenant?".
    const eventAccount = (event.account ?? null) as string | null;

    switch (event.type) {
      case "payment_intent.succeeded": {
        const intent = event.data.object as Stripe.PaymentIntent;
        const amountReceived = intent.amount_received ?? intent.amount ?? 0;
        const metadata = (intent.metadata ?? {}) as Record<string, string>;

        // 2026-05-03 PR D — multi-invoice OFF-SESSION path. The
        // `pay-selected-with-saved-method` flow creates a PaymentIntent
        // directly (no Checkout Session), so `payment_intent.succeeded`
        // is the ONLY event Stripe fires. We route to the multi-invoice
        // handler via the same normalised event the session path uses.
        // The discriminator is `metadata.off_session_multi === "true"`
        // — set by the application service only on this flow.
        if (metadata.invoiceIds && metadata.off_session_multi === "true") {
          return [
            {
              kind: "multi_invoice_payment_succeeded",
              eventId: event.id,
              eventType: event.type,
              // No Checkout Session — use the PI id as the correlation id
              // for log lines.
              sessionId: intent.id,
              providerPaymentId: intent.id,
              amountTotalCents: amountReceived,
              chargeId: extractChargeId(intent.latest_charge),
              metadata,
              providerAccountId: eventAccount,
            },
          ];
        }

        // 2026-05-03 multi-invoice payments (Checkout Session path):
        // a session-driven PaymentIntent succeeded event arrives with
        // `invoiceIds` (JSON) in metadata. We treat it as
        // ack-and-ignore at this layer because the canonical recorder
        // for that flow is the `checkout.session.completed` event
        // below. Stripe always emits both for a session payment; we
        // let the session event do the work and drop the PI event to
        // avoid double-writes.
        if (metadata.invoiceIds) {
          return [
            {
              kind: "unsupported",
              eventId: event.id,
              eventType: `${event.type} (multi-invoice — handled by checkout.session.completed)`,
            },
          ];
        }

        return [
          {
            kind: "payment_succeeded",
            eventId: event.id,
            eventType: event.type,
            providerPaymentId: intent.id,
            amountCents: amountReceived,
            chargeId: extractChargeId(intent.latest_charge),
            metadata,
            providerAccountId: eventAccount,
          },
        ];
      }

      // 2026-05-03 multi-invoice payments — Stripe Checkout Session
      // canonical success signal. One event = one payment row.
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const metadata = (session.metadata ?? {}) as Record<string, string>;

        // Only act on terminal-paid sessions. Stripe also emits
        // `completed` for `payment_status='unpaid'` (off-session
        // setup-intent flows etc.) — those carry no money.
        if (session.payment_status !== "paid") {
          return [
            {
              kind: "unsupported",
              eventId: event.id,
              eventType: `${event.type} (payment_status=${session.payment_status})`,
            },
          ];
        }

        const piId =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : (session.payment_intent?.id ?? null);

        // Charge id (for `payments.reference`) is not on the session
        // payload by default; we leave it null. The downstream
        // `charge.refunded` lookup uses `payments.reference`, so multi-
        // invoice rows skip provider-charge dedupe at refund time today.
        // This is acceptable because PR 2 doesn't ship multi-invoice
        // refunds — those are PR 3+ scope.
        return [
          {
            kind: "multi_invoice_payment_succeeded",
            eventId: event.id,
            eventType: event.type,
            sessionId: session.id,
            providerPaymentId: piId,
            amountTotalCents: session.amount_total ?? 0,
            chargeId: null,
            metadata,
            providerAccountId: eventAccount,
          },
        ];
      }

      case "payment_intent.payment_failed": {
        const intent = event.data.object as Stripe.PaymentIntent;
        return [
          {
            kind: "payment_failed",
            eventId: event.id,
            eventType: event.type,
            providerPaymentId: intent.id,
            lastErrorMessage: intent.last_payment_error?.message ?? null,
            providerAccountId: eventAccount,
          },
        ];
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const refunds = charge.refunds?.data ?? [];
        if (refunds.length === 0) {
          return [
            {
              kind: "unsupported",
              eventId: event.id,
              eventType: `${event.type} (no refund data)`,
            },
          ];
        }
        return refunds.map<NormalizedWebhookEvent>((r) => ({
          kind: "refund_created",
          eventId: event.id,
          eventType: event.type,
          providerRefundId: r.id,
          providerChargeId: charge.id,
          amountCents: r.amount ?? 0,
          reason: r.reason ?? null,
          providerAccountId: eventAccount,
        }));
      }

      // 2026-04-29 Stripe completion: refunds initiated from the Stripe
      // dashboard sometimes deliver `refund.created` ahead of (or
      // entirely without) `charge.refunded`. Handle the standalone form
      // so dashboard-issued refunds backfill the canonical ledger via
      // the same `handleRefundCreated` path API-issued refunds use.
      // Replay safety is preserved by `payments_provider_event_id_uq`
      // on `(company_id, provider_source, provider_event_id)`: if both
      // events arrive, the second insert collides on the refund id and
      // the application service maps that to a 200 ACK.
      case "refund.created":
      case "refund.updated": {
        const refund = event.data.object as Stripe.Refund;
        const chargeId = extractRefundChargeId(refund);
        if (!chargeId) {
          // No charge association — nothing to attach the ledger row to.
          return [
            {
              kind: "unsupported",
              eventId: event.id,
              eventType: `${event.type} (missing charge id)`,
            },
          ];
        }
        // Only act on terminal succeeded state; pending/failed refunds
        // do not carry money movement to mirror locally.
        if (refund.status !== "succeeded") {
          return [
            {
              kind: "unsupported",
              eventId: event.id,
              eventType: `${event.type} (status=${refund.status ?? "null"})`,
            },
          ];
        }
        return [
          {
            kind: "refund_created",
            eventId: event.id,
            eventType: event.type,
            providerRefundId: refund.id,
            providerChargeId: chargeId,
            amountCents: refund.amount ?? 0,
            reason: refund.reason ?? null,
            providerAccountId: eventAccount,
          },
        ];
      }

      // 2026-05-03 PR B — saved-card foundation. Stripe emits
      // `payment_method.attached` whenever a PaymentMethod is bound to
      // a Customer object — including the canonical save-card path
      // where `setup_future_usage` is set on the originating
      // PaymentIntent / Checkout Session.
      //
      // The event itself carries the PM-object fields (brand, last4,
      // exp, customer) but NOT our consent metadata. Consent lives on
      // the originating PI's metadata; we pull it here via a single
      // additional Stripe round-trip so the application-service
      // handler stays provider-blind.
      case "payment_method.attached": {
        const pm = event.data.object as Stripe.PaymentMethod;
        const providerCustomerId =
          typeof pm.customer === "string"
            ? pm.customer
            : (pm.customer?.id ?? null);
        // PMs not attached to a customer (one-off guest charges) are
        // out of scope for the saved-card feature.
        if (!providerCustomerId) {
          return [
            {
              kind: "unsupported",
              eventId: event.id,
              eventType: `${event.type} (no customer attached)`,
            },
          ];
        }
        // Only card PMs land in the saved-card table — other PM types
        // (us_bank_account, sepa_debit, etc.) need their own normaliser
        // when those flows ship.
        const card = pm.card;
        if (!card) {
          return [
            {
              kind: "unsupported",
              eventId: event.id,
              eventType: `${event.type} (non-card type=${pm.type})`,
            },
          ];
        }

        // Fetch the latest PaymentIntent for this customer to extract
        // our save-card consent context. Bounded to the most recent
        // 5 entries to handle rare interleaving without an unbounded
        // sweep. 2026-05-03 PR C — fall back to SetupIntent metadata
        // when no PI carries consent (the "Add a card without paying"
        // portal flow uses a SetupIntent and never creates a PI).
        type ConsentShape = {
          text: string;
          ip: string | null;
          userAgent: string | null;
          contactId: string | null;
        };
        let consent: ConsentShape | null = null;
        const metadataToConsent = (
          metadata: Stripe.Metadata | null | undefined,
        ): ConsentShape | null => {
          const text = metadata?.consent_text;
          if (!text) return null;
          return {
            text,
            ip: metadata?.consent_ip || null,
            userAgent: metadata?.consent_user_agent || null,
            contactId: metadata?.created_by_contact_id || null,
          };
        };
        try {
          // 2026-05-03 PR4 — Connect: PI list must run on the same
          // connected account that owns the customer. Without this
          // option Stripe returns the platform account's PIs and the
          // consent lookup misses every time.
          const listOpts = eventAccount
            ? { stripeAccount: eventAccount }
            : undefined;
          const intents = await stripe.paymentIntents.list(
            {
              customer: providerCustomerId,
              limit: 5,
            },
            listOpts,
          );
          for (const pi of intents.data) {
            const c = metadataToConsent(pi.metadata as Stripe.Metadata | null);
            if (c) {
              consent = c;
              break;
            }
          }
        } catch {
          consent = null;
        }
        if (!consent) {
          // 2026-05-03 PR C — SetupIntent fallback for the "Add card"
          // portal flow.
          try {
            // 2026-05-03 PR4 — same Connect account hint as the PI list.
            const listOpts = eventAccount
              ? { stripeAccount: eventAccount }
              : undefined;
            const setupIntents = await stripe.setupIntents.list(
              {
                customer: providerCustomerId,
                limit: 5,
              },
              listOpts,
            );
            for (const si of setupIntents.data) {
              const c = metadataToConsent(si.metadata as Stripe.Metadata | null);
              if (c) {
                consent = c;
                break;
              }
            }
          } catch {
            // Lookup failure is non-fatal — the application service
            // skips the row when consent is null.
            consent = null;
          }
        }

        return [
          {
            kind: "payment_method_attached",
            eventId: event.id,
            eventType: event.type,
            providerCustomerId,
            paymentMethodId: pm.id,
            cardBrand: card.brand,
            cardLast4: card.last4,
            cardExpMonth: card.exp_month,
            cardExpYear: card.exp_year,
            cardFunding: card.funding ?? null,
            cardCountry: card.country ?? null,
            consent,
            providerAccountId: eventAccount,
          },
        ];
      }

      // 2026-05-03 PR C — saved-card management. Stripe
      // `payment_method.detached` fires when our DELETE route detaches
      // a PM, OR when a Stripe-dashboard operator removes one. The
      // application service handler is idempotent — if the local row
      // is already detached, no-op.
      case "payment_method.detached": {
        const pm = event.data.object as Stripe.PaymentMethod;
        return [
          {
            kind: "payment_method_detached",
            eventId: event.id,
            eventType: event.type,
            paymentMethodId: pm.id,
            providerAccountId: eventAccount,
          },
        ];
      }

      // 2026-05-03 PR C — Stripe `payment_method.updated` (also fires
      // via the Stripe Card Updater service when card-brand-pushed
      // refreshes change the exp date / last4 / country). The handler
      // refreshes the mirrored card metadata locally so the portal
      // never shows stale "Expires 12/24" text.
      case "payment_method.updated": {
        const pm = event.data.object as Stripe.PaymentMethod;
        const card = pm.card;
        return [
          {
            kind: "payment_method_updated",
            eventId: event.id,
            eventType: event.type,
            paymentMethodId: pm.id,
            cardBrand: card?.brand ?? null,
            cardLast4: card?.last4 ?? null,
            cardExpMonth: card?.exp_month ?? null,
            cardExpYear: card?.exp_year ?? null,
            cardFunding: card?.funding ?? null,
            cardCountry: card?.country ?? null,
            providerAccountId: eventAccount,
          },
        ];
      }

      // 2026-05-03 PR C — Stripe `setup_intent.succeeded` arrives
      // alongside `payment_method.attached` when the customer
      // confirms an Add-card SetupIntent. The canonical recorder for
      // the saved-card row is `payment_method.attached`; this event
      // is informational, ack-and-ignore. (We could log it for ops
      // visibility, but leaving it to the unsupported branch keeps
      // the switch lean. Operators see it via the standard
      // `event_out_of_scope` log.)

      // 2026-05-03 PR2 — Connect onboarding lifecycle. Stripe emits
      // `account.updated` for every change to the connected account:
      // capability flips, requirements changes, payouts enablement,
      // disabled-reason transitions. We normalise to a tenant-blind
      // shape and let `paymentApplicationService.handleAccountUpdated`
      // walk `payment_provider_accounts` by `providerAccountId` and
      // stamp the new state. Idempotency is at the application
      // service via `provider_event_id` dedupe.
      case "account.updated": {
        const account = event.data.object as Stripe.Account;
        const state = mapStripeAccountToState(account);
        return [
          {
            kind: "account_updated",
            eventId: event.id,
            eventType: event.type,
            providerAccountId: state.providerAccountId,
            chargesEnabled: state.chargesEnabled,
            payoutsEnabled: state.payoutsEnabled,
            detailsSubmitted: state.detailsSubmitted,
            requirementsDue: state.requirementsDue,
            disabledReason: state.disabledReason,
            country: state.country,
            defaultCurrency: state.defaultCurrency,
          },
        ];
      }

      // 2026-05-04 PR5 — Connect payout lifecycle. Five Stripe events,
      // all sharing the same provider-neutral envelope. The
      // discriminating `kind` lets ops dashboards graph each
      // transition independently without our application service
      // having to fan out — the handler folds them back into a single
      // `upsertFromProviderEvent` keyed on `(provider, providerPayoutId)`.
      //
      // We deliberately do NOT make additional SDK calls here (e.g.
      // expanding the destination bank-account object). PR1's schema
      // header says "store only safe destination summary, such as
      // last4" — we honour that by reading last4 ONLY when Stripe
      // already expanded the destination on the event payload.
      case "payout.created":
      case "payout.updated":
      case "payout.paid":
      case "payout.failed":
      case "payout.canceled": {
        const payout = event.data.object as Stripe.Payout;
        if (!eventAccount) {
          // Payout events MUST arrive on a connected account. A
          // platform-account payout would mean Stripe itself is paying
          // out our balance — out of scope for this PR.
          return [
            {
              kind: "unsupported",
              eventId: event.id,
              eventType: `${event.type} (no event.account; not a connected-account payout)`,
            },
          ];
        }
        return [mapStripePayoutEvent(event.id, event.type, eventAccount, payout)];
      }

      // 2026-05-04 PR6 — Connect dispute / chargeback lifecycle.
      // Three Stripe events, all sharing the same provider-neutral
      // envelope. Mirror of the PR5 payout pattern: discriminating
      // `kind` lets ops graph each transition independently while the
      // application service folds them into a single
      // `upsertFromProviderEvent` keyed on
      // `(provider, providerDisputeId)`.
      //
      // We deliberately do NOT make additional SDK calls here. The
      // dispute object on the event already carries everything we
      // need (charge id, amount, status, reason, evidence_details).
      case "charge.dispute.created":
      case "charge.dispute.updated":
      case "charge.dispute.closed": {
        const dispute = event.data.object as Stripe.Dispute;
        if (!eventAccount) {
          // Dispute events MUST arrive on a connected account. A
          // platform-account dispute would mean a charge ran on the
          // platform's own balance — out of scope for our model.
          return [
            {
              kind: "unsupported",
              eventId: event.id,
              eventType: `${event.type} (no event.account; not a connected-account dispute)`,
            },
          ];
        }
        return [mapStripeDisputeEvent(event.id, event.type, eventAccount, dispute)];
      }

      default:
        return [
          {
            kind: "unsupported",
            eventId: event.id,
            eventType: event.type,
          },
        ];
    }
  },
};

/** Extract charge id from a Refund's `charge` (string | Charge | null). */
function extractRefundChargeId(refund: Stripe.Refund): string | null {
  const charge = refund.charge;
  if (typeof charge === "string") return charge;
  if (charge && typeof charge === "object") return (charge as Stripe.Charge).id;
  return null;
}

/**
 * Stripe accepts a constrained enum for refund reasons; passing an
 * arbitrary string throws. Map the three supported values; fall back to
 * unset so free-text `notes` are preserved locally without leaking to
 * Stripe as a type error.
 */
function toStripeReason(
  reason: string | null | undefined,
): Stripe.RefundCreateParams["reason"] | undefined {
  if (!reason) return undefined;
  if (reason === "duplicate" || reason === "fraudulent" || reason === "requested_by_customer") {
    return reason;
  }
  return undefined;
}
