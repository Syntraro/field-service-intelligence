/**
 * StaffTakeCardDialog (2026-04-29 Stripe completion)
 *
 * Staff-facing card-take surface for the Invoice Detail page. Mounts
 * Stripe Elements off the canonical neutral checkout endpoint:
 *
 *   POST /api/invoices/:invoiceId/payments/checkout  (source = "staff")
 *
 * Mirrors the customer portal's `PortalPayInvoiceForm` exactly — same
 * Elements API, same `redirect: "if_required"` confirmation, same
 * webhook-is-authoritative posture. The webhook (not this UI) writes
 * the canonical `payments` row; this component only opens a payment
 * intent, mounts Elements, and signals refetch on success.
 *
 * Architectural notes:
 *   - No direct ledger writes from the UI. The `onSucceeded` callback
 *     invalidates the invoice + payments query family so the canonical
 *     server-side state becomes visible once the Stripe webhook lands.
 *   - The provider name is leaked into the response shape only via
 *     `providerId: "stripe"` and the `publishableKey`. UI strings stay
 *     provider-neutral ("Take card payment", "Processing…").
 *   - CSRF: the staff API requires a token on POST. The fetch helper
 *     used elsewhere on InvoiceDetailPage handles that automatically;
 *     we mirror it here via `apiRequest`.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, CreditCard, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/formatters";

// 2026-04-21 provider-neutral response from the canonical checkout route.
// Field names match `paymentApplicationService.createCheckout`'s return —
// keep this in sync with `CreateCheckoutResponse` on the server.
interface CheckoutResponse {
  providerId: "stripe";
  clientToken: string;
  providerPaymentId: string;
  publishableKey?: string;
  prospectivePaymentId: string;
}

// Cache `loadStripe` per publishable key. Loading the script twice in a
// session is wasteful and can cause Elements warnings.
const stripePromiseCache = new Map<string, Promise<StripeJs | null>>();
function getStripePromise(publishableKey: string): Promise<StripeJs | null> {
  let p = stripePromiseCache.get(publishableKey);
  if (!p) {
    p = loadStripe(publishableKey);
    stripePromiseCache.set(publishableKey, p);
  }
  return p;
}

interface StaffTakeCardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  invoiceNumber?: string | null;
  /** Outstanding balance (numeric string) shown in the header. The server
   *  always charges the full balance for staff source today; the amount
   *  rendered here is informational. */
  balanceDue: string;
  currency?: string;
  /** Invoice + payment query keys to invalidate after Stripe confirms. */
  invoiceQueryKey: unknown[];
  paymentsQueryKey: unknown[];
}

export function StaffTakeCardDialog({
  open,
  onOpenChange,
  invoiceId,
  invoiceNumber,
  balanceDue,
  currency = "USD",
  invoiceQueryKey,
  paymentsQueryKey,
}: StaffTakeCardDialogProps) {
  const queryClient = useQueryClient();
  const [intent, setIntent] = useState<CheckoutResponse | null>(null);
  const [intentError, setIntentError] = useState<string | null>(null);
  const [justPaid, setJustPaid] = useState(false);

  const createIntentMutation = useMutation({
    mutationFn: async (): Promise<CheckoutResponse> => {
      // Canonical neutral endpoint — server-side `staffPaymentCheckoutLimiter`
      // throttles abuse; `paymentApplicationService.createCheckout` does
      // the canonical invoice-payable + balance check. UI does NOT pass
      // an amount; staff today charges the full outstanding balance.
      return await apiRequest(`/api/invoices/${invoiceId}/payments/checkout`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    },
    onSuccess: (result) => {
      setIntent(result);
      setIntentError(null);
    },
    onError: (err: Error) => {
      setIntentError(err.message ?? "Could not start payment.");
    },
  });

  // Reset state every time the dialog opens, then mint a fresh intent.
  useEffect(() => {
    if (!open) return;
    setIntent(null);
    setIntentError(null);
    setJustPaid(false);
    createIntentMutation.mutate();
    // intentionally one-shot per open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // After Stripe confirms inline, the webhook is the authoritative writer.
  // Refetch on a short cadence so the balance updates as soon as the
  // canonical writer commits the row.
  useEffect(() => {
    if (!justPaid) return;
    const timers: number[] = [];
    [1500, 3500, 7500].forEach((delay) => {
      timers.push(
        window.setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: invoiceQueryKey });
          queryClient.invalidateQueries({ queryKey: paymentsQueryKey });
        }, delay),
      );
    });
    return () => timers.forEach((t) => clearTimeout(t));
  }, [justPaid, queryClient, invoiceQueryKey, paymentsQueryKey]);

  const stripePromise = useMemo(
    () => (intent?.publishableKey ? getStripePromise(intent.publishableKey) : null),
    [intent?.publishableKey],
  );

  const handleClose = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : handleClose())}>
      <DialogContent className="sm:max-w-md" data-testid="staff-take-card-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-emerald-600" />
            Take card payment
            {invoiceNumber ? (
              <span className="text-sm font-normal text-muted-foreground">
                Invoice #{invoiceNumber}
              </span>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            Charging {formatCurrency(parseFloat(balanceDue || "0"))} to a card via Stripe.
            The receipt and payment record post automatically once Stripe confirms.
          </DialogDescription>
        </DialogHeader>

        {justPaid ? (
          <div className="py-6 text-center space-y-3" data-testid="staff-card-success">
            <div className="mx-auto h-12 w-12 rounded-full bg-emerald-50 flex items-center justify-center">
              <CheckCircle2 className="h-7 w-7 text-emerald-600" />
            </div>
            <p className="font-semibold text-lg text-slate-900">Payment received</p>
            <p className="text-sm text-slate-600 leading-relaxed">
              Updating invoice balance — this may take a moment while the
              receipt finishes processing.
            </p>
            <Button variant="outline" onClick={handleClose} className="h-10">
              Close
            </Button>
          </div>
        ) : createIntentMutation.isPending || !intent ? (
          <div className="py-6 flex flex-col items-center gap-3">
            {intentError ? (
              <>
                <div className="mx-auto h-10 w-10 rounded-full bg-red-50 flex items-center justify-center">
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                </div>
                <p
                  className="text-sm text-red-600 text-center max-w-xs"
                  data-testid="staff-card-intent-error"
                >
                  {intentError}
                </p>
                <Button variant="outline" onClick={handleClose} className="h-10">
                  Close
                </Button>
              </>
            ) : (
              <>
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                <p className="text-sm text-slate-500">Preparing secure payment…</p>
              </>
            )}
          </div>
        ) : stripePromise ? (
          <Elements
            stripe={stripePromise}
            options={{ clientSecret: intent.clientToken }}
          >
            <StaffPayCardForm
              currency={currency}
              onSucceeded={() => setJustPaid(true)}
              onCancel={handleClose}
            />
          </Elements>
        ) : (
          // Defensive: should never reach this branch — the server returns
          // `publishableKey` on every staff checkout response. If it does,
          // surface a clean message rather than a blank dialog.
          <div className="py-6 flex flex-col items-center gap-2">
            <p className="text-sm text-red-600" data-testid="staff-card-config-error">
              Stripe is not fully configured on this server. Ask an admin to set
              STRIPE_PUBLISHABLE_KEY.
            </p>
            <Button variant="outline" onClick={handleClose} className="h-10">
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Inner form. Lives inside <Elements> so `useStripe` / `useElements`
 * resolve to a configured instance. Direct sibling of
 * `PortalPayInvoiceForm` — same confirmation contract, same webhook-
 * authoritative posture.
 */
function StaffPayCardForm({
  onSucceeded,
  onCancel,
  currency,
}: {
  onSucceeded: () => void;
  onCancel: () => void;
  currency: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements || submitting) return;
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
      // Webhook is authoritative — UI just signals up.
      onSucceeded();
      return;
    }

    setError("Payment did not complete. Please try again.");
    setSubmitting(false);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 pt-2"
      data-testid="staff-card-form"
    >
      <PaymentElement />
      {error && (
        <p className="text-sm text-red-600" data-testid="staff-card-error">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!stripe || submitting}
          data-testid="staff-card-submit"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Processing…
            </>
          ) : (
            "Charge card"
          )}
        </Button>
      </DialogFooter>
      {/* `currency` is intentionally not displayed here — the parent
          dialog header renders the formatted amount and currency code
          shows in the Stripe Element's totals automatically. */}
      <span className="sr-only">{currency}</span>
    </form>
  );
}

export default StaffTakeCardDialog;
