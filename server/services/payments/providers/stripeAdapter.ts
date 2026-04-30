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
  CreateCheckoutInput,
  CreateCheckoutResult,
  NormalizedWebhookEvent,
  PaymentProvider,
  RefundInput,
  RefundResult,
} from "./types";

/** Friendly 503 when the Stripe env is not set on this deployment. */
function assertStripeConfigured() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw createError(503, "Stripe is not configured on this server");
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

export const stripeAdapter: PaymentProvider = {
  id: "stripe",

  // --------------------------------------------------------------------
  // createCheckout — returns a clientSecret for Stripe Elements.
  // --------------------------------------------------------------------
  async createCheckout(
    input: CreateCheckoutInput,
  ): Promise<CreateCheckoutResult> {
    assertStripeConfigured();
    // publishable key is required on the portal (customer device loads
    // Stripe.js); not needed on staff surfaces that don't mount Elements.
    if (input.source === "portal" && !process.env.STRIPE_PUBLISHABLE_KEY) {
      throw createError(503, "Stripe publishable key is not configured");
    }

    const stripe = getStripeClient();
    const intent = await stripe.paymentIntents.create(
      {
        amount: input.amountCents,
        currency: input.currency,
        automatic_payment_methods: { enabled: true },
        // Metadata is the ONLY tenant-resolution carrier on the webhook
        // path — it must be round-tripped verbatim. The application
        // service composes this; the adapter just forwards.
        metadata: input.metadata,
      },
      { idempotencyKey: input.idempotencyKey },
    );

    return {
      providerId: "stripe",
      clientToken: intent.client_secret ?? "",
      providerPaymentId: intent.id,
      publishableKey:
        input.source === "portal" ? process.env.STRIPE_PUBLISHABLE_KEY : undefined,
    };
  },

  // --------------------------------------------------------------------
  // refundPayment — actually moves money back at the provider.
  // --------------------------------------------------------------------
  async refundPayment(input: RefundInput): Promise<RefundResult> {
    assertStripeConfigured();
    const stripe = getStripeClient();

    // `payment_intent` accepts a `pi_...` OR the charge id. The parent
    // payment row stores the charge id in `reference` (written by the
    // `payment_intent.succeeded` webhook handler), so callers pass that.
    const refund = await stripe.refunds.create(
      {
        payment_intent: input.providerPaymentId,
        amount: input.amountCents,
        reason: toStripeReason(input.reason),
      },
      { idempotencyKey: input.idempotencyKey },
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

    // Throws on bad signature / missing secret. The route layer catches
    // and returns 400 so Stripe keeps the event queued.
    const event = getStripeClient().webhooks.constructEvent(
      rawBody,
      sig,
      secret,
    );

    switch (event.type) {
      case "payment_intent.succeeded": {
        const intent = event.data.object as Stripe.PaymentIntent;
        const amountReceived = intent.amount_received ?? intent.amount ?? 0;
        return [
          {
            kind: "payment_succeeded",
            eventId: event.id,
            eventType: event.type,
            providerPaymentId: intent.id,
            amountCents: amountReceived,
            chargeId: extractChargeId(intent.latest_charge),
            metadata: (intent.metadata ?? {}) as Record<string, string>,
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
          },
        ];
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
