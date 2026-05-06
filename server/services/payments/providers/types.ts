/**
 * Payment provider adapter contract.
 *
 * The narrowest interface that today's real callers need:
 *   - `createCheckout`  → issue a client token for card collection.
 *   - `refundPayment`   → move money back to the cardholder.
 *   - `verifyWebhook`   → authenticate a raw inbound provider payload and
 *                         normalize it into a canonical shape the
 *                         paymentApplicationService can apply to the ledger.
 *
 * Deliberately NOT in this interface — add only when a concrete call site
 * demands it: customer vaulting, saved payment methods, subscription sync,
 * captures, dispute/chargeback feeds. Adding them now would be speculative.
 *
 * Stripe is the first and only active implementation.
 */

/** Discriminator for adapters. Keep literal-union; no string-open. */
export type ProviderId = "stripe";

// ============================================================================
// createCheckout
// ============================================================================

export interface CreateCheckoutInput {
  companyId: string;
  invoiceId: string;
  amountCents: number;
  currency: string;
  /** Whether the checkout was opened by staff or a portal customer.
   *  Providers that render different SDK surfaces per audience branch on this. */
  source: "staff" | "portal";
  /**
   * 2026-05-03 PR4 — Required. The tenant's connected provider
   * account id (Stripe `acct_...`). Stripe Direct Charges model:
   * every PaymentIntent runs ON the connected account via
   * `{ stripeAccount: providerAccountId }`. The application service
   * resolves this from `paymentProviderAccountService.getActiveAccount`
   * and throws PAYMENTS_NOT_ENABLED before reaching the adapter when
   * no active account exists. Adapters MUST NOT fall back to the
   * platform account.
   */
  providerAccountId: string;
  /**
   * Caller-supplied idempotency key. Also the value that will become
   * `payments.id` when the webhook records the eventual ledger row — see
   * paymentApplicationService.createCheckout for the full chain.
   */
  idempotencyKey: string;
  /**
   * Metadata the provider must echo back on its webhook so the webhook
   * handler can re-associate the event with the tenant + invoice without
   * trusting the client. Every provider MUST round-trip this verbatim.
   */
  metadata: Record<string, string>;
  /**
   * 2026-05-03 PR B — saved-card foundation. When set, the adapter
   * attaches the resulting PaymentMethod to this provider customer
   * and the provider records consent for re-use. Provider-neutral
   * value — the Stripe adapter passes it as `customer:` on
   * `paymentIntents.create`.
   */
  providerCustomerId?: string;
  /**
   * 2026-05-03 PR B — when present, the provider should set up the
   * payment method for re-use under the canonical "off-session"
   * future-usage pattern. The Stripe adapter passes this verbatim
   * (`"off_session"` / `"on_session"`) on `paymentIntents.create`.
   * Both `providerCustomerId` AND `setupFutureUsage` must be set
   * together — the application service enforces that pair-wise rule.
   */
  setupFutureUsage?: "off_session" | "on_session";
}

export interface CreateCheckoutResult {
  providerId: ProviderId;
  /**
   * Opaque token the frontend hands to the provider SDK to confirm the
   * charge (Stripe clientSecret; future providers: their equivalent).
   */
  clientToken: string;
  /** The provider's own identifier for the pending payment (Stripe pi_...). */
  providerPaymentId: string;
  /**
   * Publishable/public key the client needs to load the provider SDK.
   * Present when the SDK mounts on the customer device (portal); absent
   * when the staff surface owns the form (not implemented yet).
   */
  publishableKey?: string;
  /**
   * 2026-05-05: provider connected-account identifier (Stripe Connect
   * `acct_...`). When the PaymentIntent is created on a connected
   * account (Direct Charges model), the customer device MUST load the
   * provider SDK with `{ stripeAccount }` so the PaymentElement iframe
   * can fetch the connected-account-scoped intent. Without it the
   * iframe never resolves, `onReady` never fires, and the Pay button
   * sits stuck on "Loading payment form…". Present whenever the
   * provider runs Direct Charges and the SDK mounts on the customer
   * device (portal).
   */
  providerAccountId?: string;
}

// ============================================================================
// createCustomer (PR A — saved-card foundation, 2026-05-03)
// ============================================================================

/**
 * Provider-neutral input for "create me a Customer object on the
 * provider side". Used lazily by the saved-card flow on first
 * save-card request for a given customer-company.
 *
 * `metadata` MUST round-trip our tenant + customer-company ids so the
 * provider's dashboard reconciles cleanly without a DB lookup. The
 * resolver service in `customerCompanyPaymentService` is the only
 * caller; the provider adapter just forwards.
 */
export interface CreateCustomerInput {
  /** Display name for the provider's dashboard. */
  name: string;
  /** Optional contact email. Stripe shows this on the Customer page. */
  email?: string | null;
  /** Tenant-resolution metadata. MUST include `companyId` + `customerCompanyId`. */
  metadata: Record<string, string>;
  /**
   * 2026-05-03 PR4 — Required. Tenant's connected provider account id.
   * Customers in Stripe Connect Direct Charges live ON the connected
   * account (not the platform). The customer_companies table row's
   * `provider_customer_id` is therefore scoped to (tenant, connected
   * account). When a tenant onboards a NEW connected account in
   * future, customers minted under the old account become invalid;
   * that re-onboarding workflow is out of scope for PR4.
   */
  providerAccountId: string;
}

export interface CreateCustomerResult {
  providerId: ProviderId;
  /** The provider's Customer-object id (`cus_...` for Stripe). */
  providerCustomerId: string;
}

// ============================================================================
// 2026-05-03 PR C — Saved-card management primitives.
// ============================================================================

/**
 * Provider-neutral input for "create a setup intent" — used by the
 * portal "Add a card without paying" flow. The Stripe adapter maps
 * this to `stripe.setupIntents.create({ customer, usage: "off_session",
 * metadata })`. The customer must already exist (resolveOrCreateProviderCustomer
 * mints it before this call).
 *
 * `metadata` round-trips our consent context (consent_text + ip + ua +
 * contactId) the same way `createCheckout` does — the
 * `payment_method.attached` webhook reads it back to populate the
 * `payment_methods` row.
 */
export interface CreateSetupIntentInput {
  providerCustomerId: string;
  metadata: Record<string, string>;
  /** 2026-05-03 PR4 — Required. Connect account id (`acct_...`). */
  providerAccountId: string;
}

export interface CreateSetupIntentResult {
  providerId: ProviderId;
  /** Opaque token the frontend hands to Stripe Elements (Stripe SetupIntent.client_secret). */
  clientToken: string;
  /** The provider's setup-intent id (`seti_...` for Stripe). */
  providerSetupIntentId: string;
  /** Same publishable key shape as createCheckout — needed by Elements. */
  publishableKey?: string;
}

/**
 * Provider-neutral input for "detach a saved payment method". Maps to
 * `stripe.paymentMethods.detach(providerPaymentMethodId)`. The local
 * row is soft-deleted via `paymentMethodsRepository.markDetached`
 * AFTER this call (or via the `payment_method.detached` webhook
 * handler if the call races a Stripe-dashboard detach).
 */
export interface DetachPaymentMethodInput {
  providerPaymentMethodId: string;
  /** 2026-05-03 PR4 — Required. Connect account id (`acct_...`). */
  providerAccountId: string;
}

// ============================================================================
// 2026-05-03 PR D — pay-with-saved-card.
// ============================================================================

/**
 * Provider-neutral input for "charge an existing saved card right
 * now". Maps to a Stripe PaymentIntent with `customer` +
 * `payment_method` + `off_session: true` + `confirm: true`.
 *
 * Idempotency:
 *   - `idempotencyKey` is also the `payments.id` written by the
 *     webhook on success — the same chain PR 1 established.
 *
 * Metadata round-trips the canonical `companyId` + invoiceId (single)
 * or `invoiceIds` JSON (multi) + `prospectivePaymentId` so the
 * webhook handler can recover tenant scope without trusting the
 * client. For the multi-invoice off-session flow, callers ALSO
 * embed `off_session_multi: "true"` so the adapter's PI normaliser
 * routes the event to the multi-invoice handler instead of
 * deferring to the (non-existent) Checkout Session event.
 */
export interface CreateOffSessionPaymentInput {
  providerCustomerId: string;
  providerPaymentMethodId: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
  metadata: Record<string, string>;
  /** 2026-05-03 PR4 — Required. Connect account id (`acct_...`). */
  providerAccountId: string;
}

/**
 * Outcome of an off-session confirm. The provider's terminal states
 * are normalised here so the application service stays provider-blind:
 *   - "succeeded"      → terminal success (webhook will record the ledger row)
 *   - "processing"     → still confirming (rare for cards; common for ACH).
 *                        Webhook arrives shortly with the terminal state.
 *   - "requires_action"→ 3DS challenge needed; off-session can't satisfy.
 *                        Frontend must fall back to the on-session
 *                        Elements flow.
 *   - "failed"         → declined / cancelled. `declineCode` carries the
 *                        provider's reason when available.
 */
export interface CreateOffSessionPaymentResult {
  providerId: ProviderId;
  /** Provider PaymentIntent id (`pi_...` for Stripe). */
  providerPaymentId: string;
  status: "succeeded" | "processing" | "requires_action" | "failed";
  /** Charge id (Stripe `ch_...`) when one was created — webhook payload uses it. */
  latestChargeId?: string | null;
  /** Provider decline code (Stripe `card_declined`, `expired_card`, etc.). */
  declineCode?: string | null;
  /** Human-readable failure / requires-action message for the route to surface. */
  message?: string | null;
}

// ============================================================================
// createCheckoutSession (multi-invoice)
// ============================================================================

/**
 * Multi-invoice checkout input. Distinct from `CreateCheckoutInput`
 * because the underlying provider primitive is different:
 *   - createCheckout       → Stripe PaymentIntent + clientSecret (one invoice).
 *   - createCheckoutSession → Stripe Checkout Session redirect URL (N invoices).
 *
 * Adapter contract:
 *   - `lineItems` is the canonical billing slice — one entry per
 *     invoice. The adapter must NOT add or fold lines.
 *   - `metadata` is the only tenant-resolution carrier on the webhook.
 *     `metadata.invoiceIds` is a JSON-encoded `string[]` so a single
 *     metadata field round-trips the full set inside Stripe's
 *     50-key / 500-char-per-value limit.
 *   - `successUrl` / `cancelUrl` are required by Stripe Checkout.
 */
export interface CreateCheckoutSessionInput {
  companyId: string;
  invoiceIds: string[];
  /** 2026-05-03 PR4 — Required. Connect account id (`acct_...`). */
  providerAccountId: string;
  /** One per invoice, in the same order as `invoiceIds`. */
  lineItems: Array<{
    invoiceId: string;
    /** Display label rendered on the Stripe Checkout receipt. */
    description: string;
    amountCents: number;
  }>;
  currency: string;
  source: "staff" | "portal";
  /** Caller-supplied idempotency key — also `payments.id` on success. */
  idempotencyKey: string;
  /** MUST contain `companyId`, `invoiceIds` (JSON string), `prospectivePaymentId`. */
  metadata: Record<string, string>;
  /** Where Stripe redirects after a successful payment. */
  successUrl: string;
  /** Where Stripe redirects when the customer abandons the session. */
  cancelUrl: string;
  /**
   * 2026-05-03 PR B — saved-card foundation. Same semantics as on
   * `CreateCheckoutInput`: the adapter attaches the resulting
   * PaymentMethod to this provider customer and primes it for
   * future use. Stripe passes it as the top-level `customer:` field
   * on `checkout.sessions.create`.
   */
  providerCustomerId?: string;
  /**
   * 2026-05-03 PR B — Stripe Checkout Sessions accept this via
   * `payment_intent_data.setup_future_usage`. Both `providerCustomerId`
   * and `setupFutureUsage` must be set together — pair-wise validation
   * is enforced at the application service.
   */
  setupFutureUsage?: "off_session" | "on_session";
}

export interface CreateCheckoutSessionResult {
  providerId: ProviderId;
  /** Stripe Checkout Session id (`cs_...`); used for telemetry / replay safety. */
  sessionId: string;
  /** Public URL the client redirects to. */
  checkoutUrl: string;
  /**
   * The `payment_intent` Stripe creates internally for this session — captured
   * here so the webhook can correlate `checkout.session.completed` and
   * `payment_intent.succeeded` if Stripe ever emits them in either order.
   * May be null at session-create time and filled later by Stripe.
   */
  providerPaymentIntentId: string | null;
}

// ============================================================================
// 2026-05-03 PR2 — Tenant payment provider account onboarding.
// ============================================================================
//
// Provider-neutral primitives for the Stripe Connect-style onboarding
// flow. Three methods, three result shapes — every Stripe concept
// (`acct_...`, `account.requirements`, `accountLinks`) stays inside
// the adapter; callers (service / route / webhook) see only the
// provider-blind shapes below.
//
// Why not extend `createCustomer`: that primitive mints a *Customer*
// (a payer-side entity owned by the platform). `createAccount` mints
// an *Account* (a merchant-side entity owned by the tenant). The two
// are unrelated objects in every provider we plan to support; sharing
// a method would couple them.

/**
 * Provider-neutral input for "create me a connected merchant account
 * for this tenant". The adapter is responsible for translating this
 * to the provider's own primitive (Stripe Connect `accounts.create`).
 *
 * Idempotency: NOT idempotent at this layer. The
 * `paymentProviderAccountService` uses a row-level lock + insert
 * pattern (same as `customerCompanyPaymentService`) to ensure exactly
 * one account is minted per (tenant, provider). Provider-side
 * idempotency keys are belt-and-suspenders; we do not rely on them.
 */
export interface CreateAccountInput {
  /** Tenant whose account is being onboarded. */
  companyId: string;
  /** ISO 3166-1 alpha-2 (e.g. "CA", "US"). Required by Stripe Connect. */
  country: string;
  /** Tenant contact email — pre-fills the onboarding form when present. */
  email?: string | null;
  /** Tenant business display name — appears on the Stripe dashboard. */
  businessName?: string | null;
}

/**
 * Provider-neutral input for "give me a one-time onboarding URL the
 * tenant can use to complete KYC / bank verification". Maps to Stripe
 * `accountLinks.create({ account, refresh_url, return_url, type:
 * "account_onboarding" })`.
 *
 * Returned link is one-time-use and short-lived (Stripe: ~5 minutes);
 * the service layer is responsible for caching this returned shape
 * for that duration if at all.
 */
export interface CreateAccountLinkInput {
  /** The provider's account id (Stripe `acct_...`). */
  providerAccountId: string;
  /** URL the provider sends the user to when their session expires
   *  mid-onboarding (must trigger a refresh of the link). */
  refreshUrl: string;
  /** URL the provider sends the user to on successful completion. */
  returnUrl: string;
}

/**
 * Provider-neutral input for "fetch the latest state of this
 * connected account". The adapter calls
 * `stripe.accounts.retrieve(providerAccountId)` and normalises the
 * response. Used at:
 *   1. service-layer "refresh" — explicit poll from the route.
 *   2. webhook handler — when an `account.updated` event arrives but
 *      its payload omits a field we care about and we want to refetch
 *      authoritative state.
 */
export interface RetrieveAccountInput {
  providerAccountId: string;
}

/**
 * Provider-neutral connected-account snapshot. Mirrors the columns
 * persisted on `payment_provider_accounts`:
 *
 *   - `chargesEnabled`     → can the account accept charges
 *   - `payoutsEnabled`     → can the account receive payouts
 *   - `detailsSubmitted`   → has the tenant submitted the onboarding form
 *   - `requirementsDue`    → provider-specific structured remediation list.
 *                            Stored as `jsonb`; UI renders without parsing
 *                            beyond top-level "what does the provider
 *                            still need?". Stripe shape:
 *                            `{ currently_due: string[], eventually_due:
 *                            string[], past_due: string[],
 *                            pending_verification: string[] }`.
 *   - `disabledReason`     → free-text from the provider when the account
 *                            has been disabled (e.g. Stripe `rejected.fraud`).
 *                            null when not disabled.
 *   - `country`            → ISO 3166-1 alpha-2 returned by the provider.
 *   - `defaultCurrency`    → ISO 4217 (lowercase, Stripe convention).
 */
export interface ProviderAccountState {
  providerId: ProviderId;
  providerAccountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirementsDue: unknown;
  disabledReason: string | null;
  country: string | null;
  defaultCurrency: string | null;
}

/**
 * Provider-neutral onboarding-link result. The frontend redirects the
 * tenant straight to `url`. `expiresAt` is a defensive UTC ISO-string
 * the route can surface so the UI can pre-emptively refresh the link
 * when the user takes a long time to click through.
 */
export interface OnboardingLink {
  providerId: ProviderId;
  url: string;
  expiresAt: string | null;
}

// ============================================================================
// refundPayment
// ============================================================================

export interface RefundInput {
  /** The provider's id for the ORIGINAL payment (charge or payment intent). */
  providerPaymentId: string;
  amountCents: number;
  reason?: string | null;
  /**
   * Idempotency key == `payments.id` of the ledger row this refund will
   * create. Guarantees the provider returns the same refund on retry and
   * that our ledger insert can collide-safely with any webhook that may
   * also try to record the same provider refund.
   */
  idempotencyKey: string;
  /**
   * 2026-05-03 PR4 — Required for connected-account refunds. Reads
   * back from the parent payment's `provider_account_id` column.
   * Refunds in Stripe Connect Direct Charges MUST run on the same
   * connected account that originated the charge.
   */
  providerAccountId: string;
}

export interface RefundResult {
  providerRefundId: string;
  status: "succeeded" | "pending" | "failed";
}

// ============================================================================
// verifyWebhook → normalized events
// ============================================================================

/**
 * Minimal normalized event shapes. One provider event can expand into
 * multiple normalized events (e.g. a Stripe `charge.refunded` carrying N
 * refund objects), so adapters return an array.
 */
export type NormalizedWebhookEvent =
  | {
      kind: "payment_succeeded";
      eventId: string;
      /** Raw provider event-type string (e.g. `payment_intent.succeeded`).
       *  Stored on the ops log for grep-ability; not used for dispatch. */
      eventType: string;
      providerPaymentId: string;
      amountCents: number;
      /** Provider's charge id (Stripe `ch_...`); becomes `payments.reference`. */
      chargeId: string | null;
      metadata: Record<string, string>;
      /**
       * 2026-05-03 PR4 — connected account id from `event.account` on
       * Stripe Connect deliveries. Null only on platform-level events
       * (which is never the case for payment_succeeded today; the
       * adapter normaliser surfaces null as a defensive default and
       * the application service treats null as a config_error).
       */
      providerAccountId: string | null;
    }
  | {
      kind: "payment_failed";
      eventId: string;
      eventType: string;
      providerPaymentId: string;
      lastErrorMessage: string | null;
      /** 2026-05-03 PR4 — connected account id, see payment_succeeded. */
      providerAccountId: string | null;
    }
  | {
      /**
       * 2026-05-03 multi-invoice payments: Stripe `checkout.session.completed`
       * for a session created via `createCheckoutSession`. Carries the
       * full `invoiceIds` set in metadata so the application service can
       * write one payment row + N allocations atomically.
       *
       * `amountTotalCents` is the total amount the session collected
       * (Stripe's `amount_total`); it must equal the sum of allocations
       * the application service writes.
       */
      kind: "multi_invoice_payment_succeeded";
      eventId: string;
      eventType: string;
      /** Stripe Checkout Session id (`cs_...`). */
      sessionId: string;
      /** PaymentIntent id (`pi_...`). May be null only on degenerate sessions. */
      providerPaymentId: string | null;
      amountTotalCents: number;
      chargeId: string | null;
      metadata: Record<string, string>;
      /** 2026-05-03 PR4 — connected account id, see payment_succeeded. */
      providerAccountId: string | null;
    }
  | {
      kind: "refund_created";
      eventId: string;
      eventType: string;
      providerRefundId: string;
      /** The provider charge the refund was issued against. */
      providerChargeId: string;
      amountCents: number;
      reason: string | null;
      /** 2026-05-03 PR4 — connected account id, see payment_succeeded. */
      providerAccountId: string | null;
    }
  | {
      /**
       * 2026-05-03 PR B — saved-card foundation. Stripe
       * `payment_method.attached` event for a PaymentMethod that was
       * attached to one of OUR Customer objects via the
       * `setup_future_usage` flow. The adapter normalizes the event by:
       *   1. Reading the PM-object fields directly off `event.data.object`
       *      (brand, last4, exp, funding, country, customer).
       *   2. Looking up the latest PaymentIntent for the same customer
       *      via the provider SDK to extract our consent metadata
       *      (consent_text, consent_ip, consent_user_agent, contactId).
       *      The application-service handler stays provider-blind.
       *
       * `providerCustomerId` is required — PMs not attached to a
       * customer (e.g., one-shot guest charges) emit `kind:"unsupported"`
       * instead.
       *
       * `consent` is null when no recent PaymentIntent for the
       * customer carries our consent metadata; the application
       * service treats that as "skip — customer didn't opt in via
       * this flow" and ACKs 200.
       */
      kind: "payment_method_attached";
      eventId: string;
      eventType: string;
      providerCustomerId: string;
      paymentMethodId: string;
      cardBrand: string;
      cardLast4: string;
      cardExpMonth: number;
      cardExpYear: number;
      cardFunding: string | null;
      cardCountry: string | null;
      consent: {
        text: string;
        ip: string | null;
        userAgent: string | null;
        contactId: string | null;
      } | null;
      /** 2026-05-03 PR4 — connected account id, see payment_succeeded. */
      providerAccountId: string | null;
    }
  | {
      /**
       * 2026-05-03 PR C — saved-card management. Stripe
       * `payment_method.detached` event. The application service
       * marks the local row as detached if it isn't already (the
       * portal DELETE route also marks it locally for the user-
       * initiated case; this handler is the safety net for
       * Stripe-dashboard detaches + reconciles any race).
       */
      kind: "payment_method_detached";
      eventId: string;
      eventType: string;
      /** The PaymentMethod id Stripe just detached. */
      paymentMethodId: string;
      /** 2026-05-03 PR4 — connected account id, see payment_succeeded. */
      providerAccountId: string | null;
    }
  | {
      /**
       * 2026-05-03 PR C — saved-card management. Stripe
       * `payment_method.updated` event (also used by the Card
       * Updater service when a card brand pushes new exp dates /
       * last4 / etc.). The application service refreshes the
       * mirrored card metadata locally.
       */
      kind: "payment_method_updated";
      eventId: string;
      eventType: string;
      paymentMethodId: string;
      cardBrand: string | null;
      cardLast4: string | null;
      cardExpMonth: number | null;
      cardExpYear: number | null;
      cardFunding: string | null;
      cardCountry: string | null;
      /** 2026-05-03 PR4 — connected account id, see payment_succeeded. */
      providerAccountId: string | null;
    }
  | {
      /**
       * 2026-05-03 PR2 — Stripe Connect onboarding. The provider
       * (today only Stripe) emits `account.updated` whenever the
       * connected account's onboarding state changes — `charges_enabled`
       * flips on after KYC, `payouts_enabled` flips on after the bank
       * account is verified, `requirements.currently_due` shrinks as
       * the tenant fills in the wizard, etc.
       *
       * The adapter normalises the event into the provider-neutral
       * shape below. The application service handler walks the
       * `payment_provider_accounts` row keyed by `providerAccountId`
       * and stamps the new state via the same code path
       * `paymentProviderAccountService.retrieveAndSyncAccount` uses.
       *
       * Idempotency: dedupes via `providerEventId` against
       * `payment_provider_accounts.last_event_id` (PR2 schema bump
       * lives behind the same SQL migration as the
       * `account_updated` webhook event-kind). Replay → no-op.
       */
      kind: "account_updated";
      eventId: string;
      eventType: string;
      providerAccountId: string;
      chargesEnabled: boolean;
      payoutsEnabled: boolean;
      detailsSubmitted: boolean;
      requirementsDue: unknown;
      disabledReason: string | null;
      country: string | null;
      defaultCurrency: string | null;
    }
  | {
      /**
       * 2026-05-04 PR5 — Connect payout lifecycle. Stripe emits five
       * `payout.*` events on the connected account; the adapter
       * normalises all five into the same shape with a discriminating
       * `kind`. The application-service handler folds them back into a
       * single `paymentPayoutsRepository.upsertFromProviderEvent` call
       * keyed on `(provider, providerPayoutId)`.
       *
       * Provider-neutral envelope:
       *   - `providerAccountId` carries `event.account` (the connected
       *     account that owns the payout). Used by the handler to
       *     resolve the local `payment_provider_accounts` row.
       *   - `status` is the normalised five-state enum (PR1
       *     `paymentPayoutStatusEnum`). Unmapped Stripe statuses fold
       *     to `"pending"` and the verbatim provider string is preserved
       *     in `rawProviderStatus`.
       *   - `destinationLast4` is populated only when Stripe expanded
       *     the destination object on the event payload. We never
       *     refetch — privacy minimisation rule from PR1's schema
       *     header.
       */
      kind:
        | "payout_created"
        | "payout_updated"
        | "payout_paid"
        | "payout_failed"
        | "payout_canceled";
      eventId: string;
      eventType: string;
      /** Connected account id (Stripe `acct_...`). Always present —
       *  payout events fire on the connected account, never the platform. */
      providerAccountId: string;
      /** Provider's payout id (Stripe `po_...`). */
      providerPayoutId: string;
      /** Cents (integer). Sign convention: always positive — see PR1
       *  `payment_payouts.amount` column header. */
      amountCents: number;
      /** ISO 4217 lowercase, Stripe convention. */
      currency: string;
      /** Normalised lifecycle enum (`paymentPayoutStatusEnum`). */
      status:
        | "pending"
        | "in_transit"
        | "paid"
        | "failed"
        | "canceled";
      /** UTC ISO string when present; null if Stripe hasn't scheduled
       *  arrival yet (rare — pending payouts always carry one). */
      arrivalDate: string | null;
      /** Destination summary — last 4 digits only. Null when Stripe
       *  did not expand the destination object on this event. */
      destinationLast4: string | null;
      /** Stripe provides these on terminal-failed payouts only
       *  (`payout.failed`). Null on every other state. */
      failureCode: string | null;
      failureMessage: string | null;
      /** Verbatim Stripe `payout.status` (e.g. `"in_transit"`,
       *  `"paid"`, or any future Stripe state we don't yet recognise).
       *  Mirrored for forensic reconciliation. */
      rawProviderStatus: string;
    }
  | {
      /**
       * 2026-05-04 PR6 — Connect dispute / chargeback lifecycle.
       * Stripe emits three `charge.dispute.*` events on the
       * connected account; the adapter normalises all three into the
       * same shape with a discriminating `kind`. The application-
       * service handler folds them back into a single
       * `paymentDisputesRepository.upsertFromProviderEvent` call
       * keyed on `(provider, providerDisputeId)`.
       *
       * Provider-neutral envelope:
       *   - `providerAccountId` carries `event.account` (the connected
       *     account that owns the disputed charge). Used by the
       *     handler to resolve the local
       *     `payment_provider_accounts` row.
       *   - `providerDisputeId` is Stripe `dp_...`.
       *   - `providerPaymentId` is the disputed charge id (Stripe
       *     `ch_...`). Always present — the handler tries to match it
       *     against `payments.reference` to backfill `payment_id`/
       *     `invoice_id`.
       *   - `status` is the normalised eight-state enum (PR1
       *     `paymentDisputeStatusEnum`). Unmapped Stripe statuses
       *     fold to `"under_review"` and the verbatim provider string
       *     is preserved on `rawProviderStatus`.
       *   - `evidenceDueBy` is null on early-warning disputes (which
       *     don't accept evidence) and on closed-state events.
       */
      kind: "dispute_created" | "dispute_updated" | "dispute_closed";
      eventId: string;
      eventType: string;
      /** Connected account id (Stripe `acct_...`). Always present —
       *  dispute events fire on the connected account, never the platform. */
      providerAccountId: string;
      /** Provider's dispute id (Stripe `dp_...`). */
      providerDisputeId: string;
      /** Disputed charge id (Stripe `ch_...`). The handler uses this
       *  to attempt a `payments.reference` match for backfilling
       *  payment_id / invoice_id. */
      providerPaymentId: string;
      /** Cents (integer). Always positive — the disputed amount the
       *  cardholder challenged. */
      amountCents: number;
      /** ISO 4217 lowercase, Stripe convention. */
      currency: string;
      /** Normalised lifecycle enum (`paymentDisputeStatusEnum`). */
      status:
        | "needs_response"
        | "under_review"
        | "won"
        | "lost"
        | "warning_needs_response"
        | "warning_under_review"
        | "warning_closed"
        | "closed";
      /** Provider's reason code (Stripe: `fraudulent`,
       *  `product_not_received`, `duplicate`, …). Free text because
       *  the enum varies per provider. Null when not classified. */
      reason: string | null;
      /** Provider deadline for evidence submission. UTC ISO string;
       *  null on warning disputes (no evidence) and closed events. */
      evidenceDueBy: string | null;
      /** Verbatim Stripe `dispute.status`. Mirrored for forensics. */
      rawProviderStatus: string;
    }
  | {
      /** Ack-and-ignore events the dispatcher will not act on. */
      kind: "unsupported";
      eventId: string;
      eventType: string;
    };

export interface PaymentProvider {
  id: ProviderId;
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>;
  /**
   * 2026-05-03 multi-invoice payments. Optional: providers without a
   * "checkout session" primitive can leave it unimplemented (the
   * application service surfaces a clear 501 in that case). Stripe
   * implements it via Checkout Sessions API.
   */
  createCheckoutSession?(
    input: CreateCheckoutSessionInput,
  ): Promise<CreateCheckoutSessionResult>;
  /**
   * 2026-05-03 PR A — saved-card foundation. Optional because not every
   * payment provider has a "Customer" primitive (a future PSP that
   * tokenizes cards without identity binding could leave this
   * unimplemented; the resolver surfaces a 501 in that case). Stripe
   * implements it via `stripe.customers.create`.
   */
  createCustomer?(input: CreateCustomerInput): Promise<CreateCustomerResult>;
  /**
   * 2026-05-03 PR C — saved-card management. Optional. Stripe
   * implements via `stripe.setupIntents.create`. Used by the portal
   * "Add card" flow that doesn't run through a payment.
   */
  createSetupIntent?(
    input: CreateSetupIntentInput,
  ): Promise<CreateSetupIntentResult>;
  /**
   * 2026-05-03 PR C — saved-card management. Optional. Stripe
   * implements via `stripe.paymentMethods.detach`. Used by the
   * portal DELETE / api/portal/payment-methods/:id route.
   */
  detachPaymentMethod?(input: DetachPaymentMethodInput): Promise<void>;
  /**
   * 2026-05-03 PR D — pay-with-saved-card. Optional. Stripe
   * implements via `stripe.paymentIntents.create({ customer,
   * payment_method, off_session: true, confirm: true })`. The
   * provider tries to confirm immediately; the result discriminates
   * succeeded / processing / requires_action / failed for the
   * application service.
   */
  createOffSessionPayment?(
    input: CreateOffSessionPaymentInput,
  ): Promise<CreateOffSessionPaymentResult>;
  refundPayment(input: RefundInput): Promise<RefundResult>;
  /**
   * 2026-05-03 PR2 — Tenant payment provider onboarding. Optional
   * because not every provider supports Connect-style sub-accounts (a
   * future "platform-only" provider could leave it unimplemented; the
   * service layer surfaces a 501 in that case). Stripe implements
   * `createAccount` via `stripe.accounts.create({ type: "express", ... })`.
   */
  createAccount?(input: CreateAccountInput): Promise<ProviderAccountState>;
  /**
   * 2026-05-03 PR2 — issue a one-time onboarding URL for the tenant.
   * Stripe implements via `stripe.accountLinks.create({...})`.
   */
  createAccountLink?(input: CreateAccountLinkInput): Promise<OnboardingLink>;
  /**
   * 2026-05-03 PR2 — fetch the latest authoritative state of a
   * connected account. Stripe implements via
   * `stripe.accounts.retrieve(providerAccountId)`.
   */
  retrieveAccount?(input: RetrieveAccountInput): Promise<ProviderAccountState>;
  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<NormalizedWebhookEvent[]>;
}
