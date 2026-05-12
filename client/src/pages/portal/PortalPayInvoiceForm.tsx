/**
 * PortalPayInvoiceForm
 *
 * 2026-04-18 Phase 11 — Customer-side Stripe Elements card confirmation.
 * Original modal-mounted version.
 *
 * 2026-05-05 — UX redesign. The component now mounts INLINE inside the
 * right-column sticky payment card on `PortalInvoiceDetail.tsx` instead
 * of inside a confirmation modal. Behavioural changes:
 *
 *   • Pay button is gated on PaymentElement having mounted
 *     (`onReady` fired) AS WELL AS Stripe + Elements being available.
 *     Without this gate the button could be clicked before the iframe
 *     was ready and `stripe.confirmPayment` would throw an unhandled
 *     promise rejection into Vite's runtime overlay.
 *   • Pay button label embeds the balance: "Pay $567.50". The caller
 *     supplies it via `amountLabel` so the form stays currency-agnostic.
 *   • `onCancel` is gone — there's no modal to dismiss.
 *   • Stripe errors are surfaced inline in `<p data-testid="portal-pay-error">`
 *     and never thrown.
 *
 * The canonical Stripe webhook remains the sole writer of the
 * `payments` ledger row. This form's job ends at Stripe client-side
 * confirmation; the balance update reaches the UI via refetch once the
 * webhook has fired.
 */

import { useEffect, useState } from "react";
import { PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface PortalPayInvoiceFormProps {
  /** Fired after Stripe accepts the PaymentIntent (succeeded / processing). */
  onSucceeded: () => void;
  /** Pay button label, e.g. "Pay $567.50". Caller formats currency. */
  amountLabel: string;
  /** Caller-supplied retry handler — wired to the timeout fallback's
   *  "Try again" button. Typically resets the parent's intent state
   *  so the checkout API call re-fires. */
  onRetry?: () => void;
}

const READY_TIMEOUT_MS = 10_000;

export function PortalPayInvoiceForm({
  onSucceeded,
  amountLabel,
  onRetry,
}: PortalPayInvoiceFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 2026-05-05: PaymentElement-ready gate. Stripe's `onReady` fires
  // when the iframe finishes mounting; calling `confirmPayment` before
  // this point throws a "PaymentElement is not mounted" error that
  // bubbles into the Vite runtime overlay. Gating the Pay button on
  // this prevents the failure mode entirely.
  const [isReady, setIsReady] = useState(false);
  // 2026-05-05: bounded loading. If `onReady` doesn't fire within 10s
  // the user is staring at a stuck form — surface a clear error +
  // retry. Common causes: Stripe-Connect publishableKey/clientSecret
  // mismatch, ad-blocker partially blocking subresources, network
  // hiccup mid-iframe-load. The Pay button stays disabled either way.
  const [readyTimedOut, setReadyTimedOut] = useState(false);
  useEffect(() => {
    if (isReady) return;
    const timer = window.setTimeout(() => {
      setReadyTimedOut(true);
    }, READY_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [isReady]);

  const canSubmit = !!stripe && !!elements && isReady && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !stripe || !elements) return;

    setSubmitting(true);
    setError(null);

    try {
      const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: window.location.href,
        },
        redirect: "if_required",
      });

      if (confirmError) {
        setError(confirmError.message ?? "Payment failed. Please try again.");
        setSubmitting(false);
        return;
      }

      // `redirect: "if_required"` means we only reach here when Stripe
      // completed the confirmation inline (no 3DS redirect). The
      // webhook is the authoritative writer — we signal the parent to
      // refetch.
      if (
        paymentIntent &&
        (paymentIntent.status === "succeeded" ||
          paymentIntent.status === "processing")
      ) {
        onSucceeded();
        return;
      }

      setError("Payment did not complete. Please try again.");
      setSubmitting(false);
    } catch (err: any) {
      // Defensive: in practice `stripe.confirmPayment` returns errors
      // via the {error} field rather than throwing, but a thrown
      // exception here would otherwise hit the Vite runtime overlay.
      // Surface it inline instead.
      console.error("[PortalPayInvoiceForm] confirmPayment threw", err);
      setError(err?.message ?? "Payment failed. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4"
      data-testid="portal-pay-form"
    >
      {/* 2026-05-05: disable Stripe Link — its "save card with Stripe"
          model conflicts with our per-tenant Saved Cards feature
          (cards saved through Link don't populate the tenant's saved-
          cards list, so a customer thinks "I saved my card" but on
          their next visit the Saved Cards UI is empty). Apple Pay /
          Google Pay stay on `auto`; both are transient wallets and
          don't create the cross-merchant identity confusion that
          Link does. */}
      <PaymentElement
        onReady={() => setIsReady(true)}
        options={{ wallets: { link: "never", applePay: "auto", googlePay: "auto" } }}
      />
      {readyTimedOut && !isReady && (
        <Alert variant="warning" className="p-3 space-y-2" data-testid="portal-pay-ready-timeout">
          <AlertDescription>
            <p className="text-sm leading-snug">
              Payment form could not load. Refresh the page or try again.
            </p>
            {onRetry && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRetry}
                className="h-9 mt-2"
                data-testid="portal-pay-retry"
              >
                Try again
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <p
          className="text-sm text-red-600 leading-snug"
          data-testid="portal-pay-error"
          role="alert"
        >
          {error}
        </p>
      )}
      <Button
        type="submit"
        disabled={!canSubmit}
        className="w-full h-12 text-base bg-[#76B054] hover:bg-[#6aa147] text-white"
        data-testid="portal-pay-submit"
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Processing…
          </>
        ) : !isReady ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Loading payment form…
          </>
        ) : (
          amountLabel
        )}
      </Button>
    </form>
  );
}
