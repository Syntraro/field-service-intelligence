/**
 * EmbeddedStripeCardForm (2026-05-06)
 *
 * Provider-neutral, host-component-agnostic Stripe Elements card-capture
 * form. Extracted from `StaffTakeCardDialog` so the same submit + webhook-
 * authoritative contract can be reused inside `CollectPaymentDialog` for
 * the multi-invoice card path. The two callers differ only in:
 *   • how they mint the PaymentIntent (single-invoice vs multi-allocation)
 *   • how they invalidate downstream queries on success
 *
 * Same contract as the original inline form:
 *   1. Caller mounts <Elements> with the clientSecret returned by the
 *      backend checkout/intent endpoint.
 *   2. This form renders <PaymentElement> + a submit button.
 *   3. On submit, calls `stripe.confirmPayment({ redirect: "if_required" })`.
 *   4. When Stripe returns status "succeeded" or "processing", calls
 *      `onSucceeded()` so the parent can show success UI + start polling
 *      the canonical invoice/payments queries (the webhook is the
 *      authoritative writer; this UI never writes a payment row).
 *   5. On decline / error, calls `setError` and surfaces a toast.
 *
 * The component is intentionally stateless about WHAT was being charged —
 * the parent renders the amount, invoice list, etc. This component only
 * owns the card capture + confirmation moment.
 */

import { useState } from "react";
import {
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { FormHelperText, InlineActionRow } from "@/components/ui/form-field";

interface EmbeddedStripeCardFormProps {
  /** Called once Stripe confirms (succeeded or processing). The parent
   *  is then responsible for invalidating queries + showing success UI. */
  onSucceeded: () => void;
  /** Submit button label. Defaults to "Charge card". */
  submitLabel?: string;
  /** Optional small helper line below the card field (e.g. "Charging $123"). */
  helperLine?: string;
  /** Optional className passthrough for parent layout control. */
  className?: string;
  /** When true, the Cancel slot is rendered. Parent supplies the handler. */
  showCancel?: boolean;
  onCancel?: () => void;
  /** Disabled flag the parent can use to lock the form during pending
   *  intent creation or other busy states. */
  disabled?: boolean;
}

export function EmbeddedStripeCardForm({
  onSucceeded,
  submitLabel = "Charge card",
  helperLine,
  className = "",
  showCancel = false,
  onCancel,
  disabled = false,
}: EmbeddedStripeCardFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements || submitting || disabled) return;
    setSubmitting(true);
    setError(null);

    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: "if_required",
    });

    if (confirmError) {
      const msg = confirmError.message ?? "Payment failed. Please try again.";
      setError(msg);
      toast({
        title: "Card declined",
        description: msg,
        variant: "destructive",
      });
      setSubmitting(false);
      return;
    }

    if (
      paymentIntent &&
      (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")
    ) {
      // Webhook is authoritative — UI just signals up. The parent
      // starts the polling cadence to refresh canonical state.
      onSucceeded();
      return;
    }

    setError("Payment did not complete. Please try again.");
    setSubmitting(false);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={`space-y-3 ${className}`}
      data-testid="embedded-stripe-card-form"
    >
      <PaymentElement />
      {helperLine && (
        <FormHelperText>{helperLine}</FormHelperText>
      )}
      {error && (
        <p className="text-sm text-red-600" data-testid="embedded-stripe-card-error">
          {error}
        </p>
      )}
      <InlineActionRow>
        {showCancel && onCancel && (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={submitting}
            data-testid="embedded-stripe-card-cancel"
          >
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          disabled={!stripe || submitting || disabled}
          data-testid="embedded-stripe-card-submit"
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Processing…
            </>
          ) : (
            submitLabel
          )}
        </Button>
      </InlineActionRow>
    </form>
  );
}
