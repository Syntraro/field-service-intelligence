/**
 * PortalPayInvoiceForm (2026-04-18 Phase 11)
 *
 * Customer-side Stripe Elements card confirmation. Mounts inside the
 * Pay modal on `PortalInvoiceDetail.tsx` once the portal payment-intent
 * route has returned a clientSecret. The canonical Stripe webhook
 * remains the sole writer of the `payments` ledger row — this form's
 * job ends at Stripe client-side confirmation; the balance update
 * reaches the UI via refetch once the webhook has fired.
 */

import { useState } from "react";
import { PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface PortalPayInvoiceFormProps {
  onSucceeded: () => void;
  onCancel: () => void;
}

export function PortalPayInvoiceForm({ onSucceeded, onCancel }: PortalPayInvoiceFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    setError(null);

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
    // completed the confirmation inline (no 3DS redirect). The webhook
    // is the authoritative writer — we signal the parent to refetch.
    if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")) {
      onSucceeded();
      return;
    }

    setError("Payment did not complete. Please try again.");
    setSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="portal-pay-form">
      <PaymentElement />
      {error && (
        <p className="text-sm text-red-600" data-testid="portal-pay-error">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={!stripe || submitting} data-testid="portal-pay-submit">
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Processing…
            </>
          ) : (
            "Pay Now"
          )}
        </Button>
      </div>
    </form>
  );
}
