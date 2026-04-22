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
    }
  | {
      kind: "payment_failed";
      eventId: string;
      eventType: string;
      providerPaymentId: string;
      lastErrorMessage: string | null;
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
  refundPayment(input: RefundInput): Promise<RefundResult>;
  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<NormalizedWebhookEvent[]>;
}
