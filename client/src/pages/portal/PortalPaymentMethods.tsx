/**
 * PortalPaymentMethods (PR C, 2026-05-03)
 *
 * Customer-facing saved-card management page.
 *
 * Surfaces:
 *   - List of active saved cards (brand icon + ••••last4 + expiry +
 *     "Default" badge).
 *   - Per-row actions: Set as default + Remove.
 *   - "Add a card" button → opens an Elements drawer that mounts on
 *     a SetupIntent clientSecret; on confirmation Stripe attaches the
 *     PaymentMethod to the customer and the `payment_method.attached`
 *     webhook persists the row server-side. The page polls the list
 *     for a few seconds after success so the new card appears
 *     promptly.
 *
 * No charging happens here — this is the management surface only.
 * PR D will add "Pay with saved card" affordances on the invoice
 * pages.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  Loader2,
  Plus,
  Star,
  Trash2,
} from "lucide-react";

interface PaymentMethodRow {
  id: string;
  cardBrand: string;
  cardLast4: string;
  cardExpMonth: number;
  cardExpYear: number;
  cardFunding: string | null;
  cardCountry: string | null;
  isDefault: boolean;
  createdAt: string;
}

interface ListResponse {
  paymentMethods: PaymentMethodRow[];
}

interface SetupIntentResponse {
  providerId: "stripe";
  clientToken: string;
  publishableKey?: string;
}

// 2026-05-03: same canonical consent copy used in PR B's during-payment
// save flow. Tenants can override later via templates; for now the
// copy is centralized so the customer sees the same wording wherever
// a card might be saved.
const CONSENT_TEXT =
  "I authorize this business to securely store my card details with our payment processor (Stripe) for future authorized payments. I can remove this card from my portal at any time.";

// Cache Stripe.js loads across sessions — same pattern as
// PortalInvoiceDetail.
//
// 2026-05-05: catches script-load failures so the resulting Promise
// resolves to null instead of rejecting. A rejection here would bubble
// into <Elements> as a Vite runtime-overlay error ("Failed to load
// Stripe.js"); the null path renders cleanly at the call site (the
// caller's intent state stays in "loading" if Stripe never resolves).
const stripePromiseCache = new Map<string, Promise<StripeJs | null>>();
function getStripePromise(publishableKey: string): Promise<StripeJs | null> {
  let p = stripePromiseCache.get(publishableKey);
  if (!p) {
    p = loadStripe(publishableKey).catch((err) => {
      console.error("[PortalPaymentMethods] Stripe.js failed to load", err);
      return null;
    });
    stripePromiseCache.set(publishableKey, p);
  }
  return p;
}

function formatExpiry(m: number, y: number): string {
  const mm = String(m).padStart(2, "0");
  const yy = String(y).slice(-2);
  return `${mm}/${yy}`;
}

function brandLabel(brand: string): string {
  // Stripe brand strings are lowercase ("visa", "mastercard", "amex", …).
  if (!brand) return "Card";
  if (brand === "amex") return "Amex";
  return brand[0].toUpperCase() + brand.slice(1);
}

export default function PortalPaymentMethods() {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<PaymentMethodRow | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const listKey = ["/api/portal/payment-methods"];
  const { data, isLoading } = useQuery<ListResponse>({ queryKey: listKey });

  const setDefaultMutation = useMutation({
    // 2026-05-05: routed through apiRequest so the global csurf
    // middleware sees X-CSRF-Token. Plain fetch was a CSRF dead end.
    mutationFn: (id: string) =>
      apiRequest(`/api/portal/payment-methods/${id}/default`, {
        method: "PATCH",
      }),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: listKey });
    },
    onError: (err: Error) => setActionError(err.message),
  });

  const removeMutation = useMutation({
    // 2026-05-05: routed through apiRequest for CSRF compliance.
    mutationFn: (id: string) =>
      apiRequest(`/api/portal/payment-methods/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setActionError(null);
      setRemoveTarget(null);
      queryClient.invalidateQueries({ queryKey: listKey });
    },
    onError: (err: Error) => setActionError(err.message),
  });

  const cards = data?.paymentMethods ?? [];
  const sorted = useMemo(() => {
    // Server returns default-first + most-recent next, but sort defensively.
    return [...cards].sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      return (b.createdAt || "").localeCompare(a.createdAt || "");
    });
  }, [cards]);

  return (
    <div className="space-y-5">
      <div>
        <Button variant="ghost" size="sm" className="h-9 -ml-2" asChild>
          <Link href="/portal">
            <ArrowLeft className="h-4 w-4 mr-1" /> Dashboard
          </Link>
        </Button>
      </div>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Saved payment methods
        </h1>
        <p className="text-sm text-slate-500">
          Manage cards you've saved for future invoice payments.
        </p>
      </header>

      <div>
        <Button
          size="sm"
          className="h-10 bg-[#76B054] hover:bg-[#6aa147] text-white"
          onClick={() => {
            setActionError(null);
            setAddOpen(true);
          }}
          data-testid="portal-add-card"
        >
          <Plus className="h-4 w-4 mr-1" /> Add a card
        </Button>
      </div>

      {actionError && (
        <div
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 flex items-start gap-2"
          data-testid="portal-pm-action-error"
        >
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2" data-testid="portal-pm-loading">
          {[0, 1].map((i) => (
            <Card key={i}>
              <CardContent className="py-4 flex items-center gap-3">
                <Skeleton className="h-9 w-12 rounded" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-8 w-20" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center" data-testid="portal-pm-empty">
            <CreditCard className="h-8 w-8 text-slate-300 mx-auto mb-2" />
            <p className="font-medium text-slate-700">No saved cards yet</p>
            <p className="text-sm text-slate-500 mt-1">
              Add a card to make future invoice payments faster.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2" data-testid="portal-pm-list">
          {sorted.map((card) => (
            <Card
              key={card.id}
              className={
                card.isDefault
                  ? "border-[#76B054] bg-emerald-50/30"
                  : "hover:border-slate-300 transition-colors"
              }
              data-testid={`portal-pm-row-${card.id}`}
            >
              <CardContent className="py-3.5 flex items-center gap-3">
                <div className="h-9 w-12 rounded border border-slate-200 bg-white flex items-center justify-center text-xs font-semibold text-slate-700 uppercase tracking-wide shrink-0">
                  {brandLabel(card.cardBrand)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-slate-900 tabular-nums">
                      •••• {card.cardLast4}
                    </p>
                    {card.isDefault && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"
                        data-testid={`portal-pm-default-badge-${card.id}`}
                      >
                        <Star className="h-3 w-3" /> Default
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Expires {formatExpiry(card.cardExpMonth, card.cardExpYear)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!card.isDefault && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9"
                      disabled={
                        setDefaultMutation.isPending &&
                        setDefaultMutation.variables === card.id
                      }
                      onClick={() => {
                        setActionError(null);
                        setDefaultMutation.mutate(card.id);
                      }}
                      data-testid={`portal-pm-set-default-${card.id}`}
                    >
                      Set default
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 text-red-600 hover:text-red-700 hover:bg-red-50"
                    onClick={() => {
                      setActionError(null);
                      setRemoveTarget(card);
                    }}
                    data-testid={`portal-pm-remove-${card.id}`}
                    aria-label={`Remove card ending in ${card.cardLast4}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Add card dialog ───────────────────────────────────────── */}
      <AddCardDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSucceeded={() => {
          setAddOpen(false);
          // Refresh the list a few times so the webhook-written row
          // shows up reliably (Stripe's `payment_method.attached`
          // typically arrives within a couple of seconds).
          [1500, 3500, 7500].forEach((delay) => {
            window.setTimeout(() => {
              queryClient.invalidateQueries({ queryKey: listKey });
            }, delay);
          });
        }}
      />

      {/* ── Remove confirmation dialog ─────────────────────────────── */}
      <Dialog
        open={!!removeTarget}
        onOpenChange={(open) => {
          if (!open) {
            setRemoveTarget(null);
            setActionError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove this card?</DialogTitle>
            <DialogDescription>
              {removeTarget && (
                <>
                  {brandLabel(removeTarget.cardBrand)} •••• {removeTarget.cardLast4}{" "}
                  will no longer be available for future payments. You can add
                  it again later if you change your mind.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRemoveTarget(null)}
              disabled={removeMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => {
                if (removeTarget) removeMutation.mutate(removeTarget.id);
              }}
              disabled={removeMutation.isPending}
              data-testid="portal-pm-confirm-remove"
            >
              {removeMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Removing…
                </>
              ) : (
                "Remove card"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Add-card dialog: mints a SetupIntent and mounts Stripe Elements on
// its clientSecret. The actual card-save is triggered by the customer
// confirming inside Elements; on success we close the dialog + bubble
// up to the parent so it can refresh the list.
// ────────────────────────────────────────────────────────────────────

function AddCardDialog({
  open,
  onClose,
  onSucceeded,
}: {
  open: boolean;
  onClose: () => void;
  onSucceeded: () => void;
}) {
  const [intent, setIntent] = useState<SetupIntentResponse | null>(null);
  const [intentError, setIntentError] = useState<string | null>(null);

  const createIntent = useMutation({
    // 2026-05-05: routed through apiRequest for CSRF compliance.
    mutationFn: (): Promise<SetupIntentResponse> =>
      apiRequest<SetupIntentResponse>("/api/portal/payment-methods/setup-intent", {
        method: "POST",
        body: JSON.stringify({ consentText: CONSENT_TEXT }),
      }),
    onSuccess: (result) => {
      setIntent(result);
      setIntentError(null);
    },
    onError: (err: Error) => setIntentError(err.message),
  });

  // Kick the SetupIntent on first open. Reset on close.
  useEffect(() => {
    if (open && !intent && !createIntent.isPending && !intentError) {
      createIntent.mutate();
    }
    if (!open) {
      setIntent(null);
      setIntentError(null);
    }
    // We intentionally only re-fire on `open` transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const stripePromise = useMemo(
    () => (intent?.publishableKey ? getStripePromise(intent.publishableKey) : null),
    [intent?.publishableKey],
  );

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a card</DialogTitle>
          <DialogDescription>
            Save a card for future invoice payments. We never store card
            numbers — your card details are tokenized by Stripe.
          </DialogDescription>
        </DialogHeader>

        {createIntent.isPending || (!intent && !intentError) ? (
          <div className="py-6 flex flex-col items-center gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            <p className="text-sm text-slate-500">Preparing secure form…</p>
          </div>
        ) : intentError ? (
          <div className="py-4 text-center space-y-3" data-testid="portal-pm-intent-error">
            <AlertTriangle className="h-7 w-7 text-red-500 mx-auto" />
            <p className="text-sm text-red-700">{intentError}</p>
            <Button variant="outline" onClick={onClose}>Close</Button>
          </div>
        ) : (
          intent &&
          stripePromise && (
            <Elements
              stripe={stripePromise}
              options={{ clientSecret: intent.clientToken }}
            >
              <AddCardForm onSucceeded={onSucceeded} onCancel={onClose} />
            </Elements>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddCardForm({
  onSucceeded,
  onCancel,
}: {
  onSucceeded: () => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setErr(null);

    const { error: confirmError, setupIntent } = await stripe.confirmSetup({
      elements,
      confirmParams: {
        return_url: window.location.href,
      },
      redirect: "if_required",
    });

    if (confirmError) {
      setErr(confirmError.message ?? "Couldn't save the card. Try again.");
      setSubmitting(false);
      return;
    }
    if (
      setupIntent &&
      (setupIntent.status === "succeeded" || setupIntent.status === "processing")
    ) {
      onSucceeded();
      return;
    }
    setErr("Card save did not complete. Please try again.");
    setSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="portal-add-card-form">
      <PaymentElement />
      {err && (
        <p className="text-sm text-red-600" data-testid="portal-add-card-error">{err}</p>
      )}
      <p className="text-xs text-slate-500 leading-relaxed">
        By saving, you authorize this business to securely store your card
        with Stripe for future authorized payments. You can remove the card
        at any time from the portal.
      </p>
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!stripe || submitting}
          className="bg-[#76B054] hover:bg-[#6aa147] text-white"
          data-testid="portal-add-card-submit"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4 mr-2" /> Save card
            </>
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}
