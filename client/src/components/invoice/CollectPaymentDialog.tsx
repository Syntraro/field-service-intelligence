/**
 * CollectPaymentDialog (2026-05-06 PR3)
 *
 * Single entry point for recording a payment from the Invoice Detail
 * page. Supports every method the schema enum exposes:
 *
 *   • Manual methods (cash / cheque / e-transfer / debit / other)
 *     POST /api/payments  → one payment row + N allocations atomically.
 *
 *   • Credit card (method = "credit")
 *     POST /api/payments/card-intent  → Stripe PaymentIntent for the
 *     summed allocation amount, allocations packed into Stripe metadata.
 *     Inline <PaymentElement> capture. The Stripe webhook is the
 *     CANONICAL writer — this UI never POSTs to /api/payments for card
 *     charges. After success the dialog polls the invoice + payments
 *     queries until the webhook lands the canonical row.
 *
 * UX rules enforced here:
 *   • Method-specific fields:
 *       cheque / e-transfer / debit / other → reference + details
 *       cash → details only
 *       credit → embedded Stripe form (no reference, no details)
 *   • "Save and Email Receipt" disabled when the customer has no
 *     resolvable billing email. We pull the upfront `billingEmail`
 *     hint from the context endpoint; the actual receipt mailer
 *     re-resolves at send time, so this is a safe pre-flight.
 *   • Stripe path NEVER calls the manual endpoint. The two submit
 *     buttons are mutually exclusive based on method.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, isPast } from "date-fns";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import { Loader2, Mail, CheckCircle2, AlertTriangle, CreditCard } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/formatters";
import { EmbeddedStripeCardForm } from "@/components/invoice/EmbeddedStripeCardForm";

type PaymentMethod = "cash" | "credit" | "debit" | "e-transfer" | "cheque" | "other";

interface ContextInvoice {
  id: string;
  invoiceNumber: string | null;
  status: string;
  issueDate: string | null;
  dueDate: string | null;
  total: string;
  amountPaid: string;
  balance: string;
  locationId: string | null;
}

interface CollectPaymentContext {
  sourceInvoiceId: string;
  customerCompany: { id: string; name: string } | null;
  invoices: ContextInvoice[];
  accountBalance: string;
  supportedMethods: readonly PaymentMethod[];
  /** 2026-05-06 — pre-resolved billing email; null when unavailable. */
  billingEmail: string | null;
}

interface AllocationDraft {
  invoiceId: string;
  selected: boolean;
  amount: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  invoiceQueryKey: unknown[];
  paymentsQueryKey: unknown[];
}

const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  cheque: "Cheque",
  "e-transfer": "E-transfer",
  credit: "Credit card",
  debit: "Debit",
  other: "Other",
};

const REFERENCE_LABEL_BY_METHOD: Record<PaymentMethod, string> = {
  cash: "",
  cheque: "Cheque #",
  "e-transfer": "E-transfer reference",
  credit: "",
  debit: "Reference ID",
  other: "Reference",
};

const REFERENCE_PLACEHOLDER_BY_METHOD: Record<PaymentMethod, string> = {
  cash: "",
  cheque: "e.g. 1042",
  "e-transfer": "e.g. CONFIRM-XYZ",
  credit: "",
  debit: "",
  other: "",
};

const METHOD_HAS_REFERENCE: Record<PaymentMethod, boolean> = {
  cash: false,
  cheque: true,
  "e-transfer": true,
  credit: false,
  debit: true,
  other: true,
};

const METHOD_HAS_DETAILS: Record<PaymentMethod, boolean> = {
  cash: true,
  cheque: true,
  "e-transfer": true,
  credit: false,
  debit: true,
  other: true,
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Cache `loadStripe` per publishable key — same pattern the original
// StaffTakeCardDialog uses to avoid loading Stripe.js twice in a session.
const stripePromiseCache = new Map<string, Promise<StripeJs | null>>();
function getStripePromise(publishableKey: string): Promise<StripeJs | null> {
  let p = stripePromiseCache.get(publishableKey);
  if (!p) {
    p = loadStripe(publishableKey);
    stripePromiseCache.set(publishableKey, p);
  }
  return p;
}

interface CardIntentResponse {
  providerId: "stripe";
  clientToken: string;
  providerPaymentId: string;
  publishableKey?: string;
  prospectivePaymentId: string;
  totalAmount: string;
}

export function CollectPaymentDialog({
  open,
  onOpenChange,
  invoiceId,
  invoiceQueryKey,
  paymentsQueryKey,
}: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: context, isLoading: contextLoading, isError: contextError } =
    useQuery<CollectPaymentContext>({
      queryKey: ["collect-payment-context", invoiceId],
      queryFn: async () => {
        const res = await fetch(
          `/api/invoices/${invoiceId}/collect-payment-context`,
          { credentials: "include" },
        );
        if (!res.ok) throw new Error("Failed to load payment context");
        return res.json();
      },
      enabled: open && !!invoiceId,
      staleTime: 5_000,
    });

  // Form state.
  const [method, setMethod] = useState<PaymentMethod>("cheque");
  const [transactionDate, setTransactionDate] = useState<string>(todayIso());
  const [reference, setReference] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [allocationDrafts, setAllocationDrafts] = useState<AllocationDraft[]>([]);
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const [saveMode, setSaveMode] = useState<"save" | "save-email" | null>(null);

  // Card-mode state.
  const [cardIntent, setCardIntent] = useState<CardIntentResponse | null>(null);
  const [cardIntentError, setCardIntentError] = useState<string | null>(null);
  const [cardSucceeded, setCardSucceeded] = useState(false);

  const isCardMode = method === "credit";

  // Seed allocation drafts: source invoice preselected with full balance.
  useEffect(() => {
    if (!context || seededFor === context.sourceInvoiceId) return;
    setSeededFor(context.sourceInvoiceId);
    const seeded: AllocationDraft[] = context.invoices.map((inv) => {
      if (inv.id === context.sourceInvoiceId) {
        return {
          invoiceId: inv.id,
          selected: true,
          amount: parseFloat(inv.balance ?? "0").toFixed(2),
        };
      }
      return { invoiceId: inv.id, selected: false, amount: "" };
    });
    setAllocationDrafts(seeded);
  }, [context, seededFor]);

  // Reset everything on close.
  useEffect(() => {
    if (!open) {
      setSeededFor(null);
      setMethod("cheque");
      setTransactionDate(todayIso());
      setReference("");
      setNotes("");
      setAllocationDrafts([]);
      setSaveMode(null);
      setCardIntent(null);
      setCardIntentError(null);
      setCardSucceeded(false);
    }
  }, [open]);

  // After Stripe confirms, poll the canonical queries on the same cadence
  // the existing StaffTakeCardDialog uses (1500/3500/7500ms). The webhook
  // is the authoritative writer — these timers refresh the UI as soon as
  // the canonical row + allocations land in the DB.
  useEffect(() => {
    if (!cardSucceeded) return;
    const timers: number[] = [];
    [1500, 3500, 7500].forEach((delay) => {
      timers.push(
        window.setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: invoiceQueryKey });
          queryClient.invalidateQueries({ queryKey: paymentsQueryKey });
          queryClient.invalidateQueries({ queryKey: ["invoices"] });
          queryClient.invalidateQueries({ queryKey: ["payments"] });
          queryClient.invalidateQueries({ queryKey: ["dashboard"] });
          queryClient.invalidateQueries({ queryKey: ["/api/payments/transactions"] });
        }, delay),
      );
    });
    return () => timers.forEach((t) => clearTimeout(t));
  }, [cardSucceeded, queryClient, invoiceQueryKey, paymentsQueryKey]);

  const invoicesById = useMemo(() => {
    const map = new Map<string, ContextInvoice>();
    for (const inv of context?.invoices ?? []) map.set(inv.id, inv);
    return map;
  }, [context]);

  function setDraft(id: string, patch: Partial<AllocationDraft>) {
    setAllocationDrafts((prev) =>
      prev.map((d) => (d.invoiceId === id ? { ...d, ...patch } : d)),
    );
  }

  function toggleSelected(id: string) {
    const inv = invoicesById.get(id);
    if (!inv) return;
    setAllocationDrafts((prev) =>
      prev.map((d) => {
        if (d.invoiceId !== id) return d;
        const nextSelected = !d.selected;
        return {
          ...d,
          selected: nextSelected,
          amount: nextSelected
            ? parseFloat(inv.balance ?? "0").toFixed(2)
            : "",
        };
      }),
    );
  }

  const selectedDrafts = allocationDrafts.filter((d) => d.selected);
  const totalCents = selectedDrafts.reduce((sum, d) => {
    const n = parseFloat(d.amount || "0");
    return Number.isFinite(n) ? sum + Math.round(n * 100) : sum;
  }, 0);
  const totalAmount = (totalCents / 100).toFixed(2);

  const validationError = (() => {
    if (selectedDrafts.length === 0) return "Select at least one invoice to apply payment to.";
    if (totalCents <= 0) return "Total payment amount must be greater than zero.";
    if (!isCardMode && !transactionDate) return "Transaction date is required.";
    for (const d of selectedDrafts) {
      const inv = invoicesById.get(d.invoiceId);
      if (!inv) continue;
      const amt = parseFloat(d.amount || "0");
      if (!Number.isFinite(amt) || amt <= 0) {
        return `Enter an amount for invoice ${inv.invoiceNumber ?? "—"}.`;
      }
      const balance = parseFloat(inv.balance ?? "0");
      if (amt > balance + 0.0049) {
        return `Allocation $${amt.toFixed(2)} exceeds invoice ${inv.invoiceNumber ?? "—"} balance $${balance.toFixed(2)}.`;
      }
    }
    if (isCardMode && totalCents < 50) {
      return "Card payments require a minimum total of $0.50.";
    }
    if (isCardMode && selectedDrafts.length > 10) {
      return "Card payments support up to 10 invoices per charge. Use cheque/e-transfer for larger batches.";
    }
    return null;
  })();

  const hasBillingEmail = !!context?.billingEmail;

  // ── Manual save mutation. ──
  type CollectPaymentResponse = {
    payment: { id: string; amount: string };
    invoices: Array<{ id: string; status: string; balance: string }>;
    receiptEmailRequested: boolean;
    receiptEmailQueued: boolean;
    receiptEmailReason: "not_requested" | "no_recipient" | "send_failed" | null;
    receiptEmailMessageId: string | null;
    receiptEmailError?: string | null;
  };
  const saveMutation = useMutation<CollectPaymentResponse, Error, boolean>({
    mutationFn: async (emailReceipt) => {
      const customerCompanyId = context?.customerCompany?.id;
      if (!customerCompanyId) {
        throw new Error("Cannot collect payment for an invoice with no customer company");
      }
      const body = {
        customerCompanyId,
        method,
        transactionDate: new Date(`${transactionDate}T12:00:00.000Z`).toISOString(),
        reference: reference.trim() || null,
        notes: notes.trim() || null,
        allocations: selectedDrafts.map((d) => ({
          invoiceId: d.invoiceId,
          amount: parseFloat(d.amount).toFixed(2),
        })),
        emailReceipt,
      };
      return apiRequest(`/api/payments`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    onSuccess: (data, emailReceipt) => {
      queryClient.invalidateQueries({ queryKey: invoiceQueryKey });
      queryClient.invalidateQueries({ queryKey: paymentsQueryKey });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payments/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["customer-companies"] });

      const summary = `$${totalAmount} across ${selectedDrafts.length} invoice${selectedDrafts.length === 1 ? "" : "s"}`;

      if (!emailReceipt) {
        toast({ title: "Payment recorded", description: `Recorded ${summary}.` });
      } else if (data.receiptEmailQueued) {
        toast({
          title: "Payment recorded · receipt emailed",
          description: `Recorded ${summary}. Receipt sent.`,
        });
      } else {
        const reasonHint =
          data.receiptEmailReason === "no_recipient"
            ? "No billing email is on file for this customer."
            : data.receiptEmailReason === "send_failed"
              ? data.receiptEmailError ?? "The email service rejected the send."
              : "Receipt email could not be queued.";
        toast({
          title: "Payment saved, but receipt email was not sent",
          description: `Recorded ${summary}. ${reasonHint}`,
          variant: "destructive",
        });
      }
      onOpenChange(false);
    },
    onError: (err) => {
      toast({
        title: "Failed to record payment",
        description: err.message,
        variant: "destructive",
      });
    },
    onSettled: () => setSaveMode(null),
  });

  // ── Card intent mutation (only used in card mode). ──
  const cardIntentMutation = useMutation<CardIntentResponse, Error, void>({
    mutationFn: async () => {
      const customerCompanyId = context?.customerCompany?.id;
      if (!customerCompanyId) {
        throw new Error("Card payments require a customer company");
      }
      const body = {
        customerCompanyId,
        allocations: selectedDrafts.map((d) => ({
          invoiceId: d.invoiceId,
          amount: parseFloat(d.amount).toFixed(2),
        })),
      };
      return apiRequest(`/api/payments/card-intent`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    onSuccess: (data) => {
      setCardIntent(data);
      setCardIntentError(null);
    },
    onError: (err) => {
      setCardIntentError(err.message ?? "Could not start card payment.");
      setCardIntent(null);
    },
  });

  const stripePromise = useMemo(
    () => (cardIntent?.publishableKey ? getStripePromise(cardIntent.publishableKey) : null),
    [cardIntent?.publishableKey],
  );

  const busy = saveMutation.isPending || cardIntentMutation.isPending;
  const canSubmitManual = !busy && validationError === null && !!context;
  const canStartCard = !busy && validationError === null && !!context;

  function handleSaveManual(emailReceipt: boolean) {
    if (emailReceipt && !hasBillingEmail) return; // guarded by disabled state too
    setSaveMode(emailReceipt ? "save-email" : "save");
    saveMutation.mutate(emailReceipt);
  }

  function handleStartCard() {
    setCardIntent(null);
    setCardIntentError(null);
    setCardSucceeded(false);
    cardIntentMutation.mutate();
  }

  const sourceInvoiceNumber = context?.invoices.find(
    (i) => i.id === context.sourceInvoiceId,
  )?.invoiceNumber;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-3xl max-h-[88vh] overflow-hidden flex flex-col gap-0 p-0"
        data-testid="dialog-collect-payment"
      >
        {/* Header — compact. */}
        <DialogHeader className="px-5 py-3 border-b border-slate-200">
          <DialogTitle>
            New Payment{context?.customerCompany ? ` for ${context.customerCompany.name}` : ""}
          </DialogTitle>
          {sourceInvoiceNumber && (
            <DialogDescription>
              Started from invoice #{sourceInvoiceNumber}
            </DialogDescription>
          )}
        </DialogHeader>

        {/* Body — scrolls between header + sticky footer. */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          {/* Compact total summary. */}
          <div
            className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2"
            data-testid="collect-payment-total-summary"
          >
            <p className="text-[10px] uppercase tracking-wide text-emerald-700 font-semibold">
              Total payment
            </p>
            <p className="text-2xl font-bold text-emerald-900 tabular-nums leading-tight">
              {formatCurrency(totalAmount)}
            </p>
            {context && (
              <p className="text-[11px] text-emerald-800 mt-0.5">
                Account balance:{" "}
                <span className="tabular-nums font-medium">
                  {formatCurrency(context.accountBalance)}
                </span>
                {selectedDrafts.length > 0 && (
                  <>
                    {" · "}
                    {selectedDrafts.length} invoice
                    {selectedDrafts.length === 1 ? "" : "s"} selected
                  </>
                )}
              </p>
            )}
          </div>

          {/* Method + date row. Two-column on md+; stacked on mobile. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="payment-method" className="text-xs">Payment method</Label>
              <Select
                value={method}
                onValueChange={(v) => setMethod(v as PaymentMethod)}
              >
                <SelectTrigger id="payment-method" data-testid="collect-payment-method" className="h-9">
                  <SelectValue placeholder="Select method" />
                </SelectTrigger>
                <SelectContent>
                  {(context?.supportedMethods ?? Object.keys(METHOD_LABELS) as PaymentMethod[]).map(
                    (m) => (
                      <SelectItem key={m} value={m}>
                        {METHOD_LABELS[m]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
            {!isCardMode && (
              <div className="space-y-1">
                <Label htmlFor="payment-date" className="text-xs">Transaction date</Label>
                <Input
                  id="payment-date"
                  type="date"
                  value={transactionDate}
                  onChange={(e) => setTransactionDate(e.target.value)}
                  data-testid="collect-payment-date"
                  className="h-9"
                />
              </div>
            )}
          </div>

          {/* Reference (only when method has one). */}
          {METHOD_HAS_REFERENCE[method] && (
            <div className="space-y-1">
              <Label htmlFor="payment-reference" className="text-xs">
                {REFERENCE_LABEL_BY_METHOD[method]}
              </Label>
              <Input
                id="payment-reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder={REFERENCE_PLACEHOLDER_BY_METHOD[method]}
                data-testid="collect-payment-reference"
                className="h-9"
              />
            </div>
          )}

          {/* Details (only when method has them). */}
          {METHOD_HAS_DETAILS[method] && (
            <div className="space-y-1">
              <Label htmlFor="payment-notes" className="text-xs">Details</Label>
              <Textarea
                id="payment-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Optional notes"
                data-testid="collect-payment-notes"
                className="min-h-[56px]"
              />
            </div>
          )}

          {/* Outstanding invoices list. */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wide">
                Outstanding invoices
              </h3>
              {context && (
                <span className="text-[11px] text-muted-foreground">
                  {context.invoices.length} outstanding
                </span>
              )}
            </div>

            {contextLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-4 justify-center">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading…
              </div>
            ) : contextError ? (
              <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                Failed to load outstanding invoices.
              </div>
            ) : !context || context.invoices.length === 0 ? (
              <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                No outstanding invoices for this account.
              </div>
            ) : (
              <div
                className="border rounded-md divide-y divide-slate-100 max-h-[240px] overflow-y-auto"
                data-testid="collect-payment-invoices-list"
              >
                {context.invoices.map((inv) => {
                  const draft = allocationDrafts.find((d) => d.invoiceId === inv.id);
                  if (!draft) return null;
                  const overdue =
                    inv.dueDate && isPast(new Date(inv.dueDate)) && parseFloat(inv.balance) > 0;
                  return (
                    <div
                      key={inv.id}
                      className="flex items-start gap-2.5 px-3 py-1.5 hover:bg-slate-50/40"
                      data-testid={`collect-payment-row-${inv.id}`}
                    >
                      <div className="pt-0.5">
                        <Checkbox
                          checked={draft.selected}
                          onCheckedChange={() => toggleSelected(inv.id)}
                          aria-label={`Apply payment to invoice ${inv.invoiceNumber ?? ""}`}
                          data-testid={`collect-payment-select-${inv.id}`}
                        />
                      </div>
                      <div className="flex-1 min-w-0 text-[11px] space-y-0.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <a
                            href={`/invoices/${inv.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-slate-900 hover:text-primary"
                          >
                            #{inv.invoiceNumber ?? inv.id.slice(0, 8)}
                          </a>
                          {overdue && (
                            <Badge variant="destructive" className="h-4 px-1.5 text-[9px] uppercase">
                              Overdue
                            </Badge>
                          )}
                          {inv.dueDate && (
                            <span className="text-muted-foreground">
                              Due {format(new Date(inv.dueDate), "MMM d, yyyy")}
                            </span>
                          )}
                        </div>
                        <div className="text-muted-foreground tabular-nums">
                          Total {formatCurrency(inv.total)} · Balance{" "}
                          <span className="font-medium text-slate-800">
                            {formatCurrency(inv.balance)}
                          </span>
                        </div>
                      </div>
                      <div className="w-28 shrink-0">
                        <Input
                          type="text"
                          inputMode="decimal"
                          value={draft.amount}
                          onChange={(e) => setDraft(inv.id, { amount: e.target.value })}
                          disabled={!draft.selected || isCardMode && !!cardIntent}
                          placeholder="0.00"
                          className="text-right tabular-nums h-8 text-xs"
                          aria-label={`Payment amount for invoice ${inv.invoiceNumber ?? ""}`}
                          data-testid={`collect-payment-amount-${inv.id}`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {validationError && (
              <p
                className="mt-1.5 text-xs text-rose-600"
                data-testid="collect-payment-validation"
              >
                {validationError}
              </p>
            )}
          </div>

          {/* Card mode — Stripe Elements panel. */}
          {isCardMode && (
            <div
              className="rounded-md border border-slate-200 bg-white px-3 py-3 space-y-2"
              data-testid="collect-payment-card-panel"
            >
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                <CreditCard className="h-3.5 w-3.5 text-emerald-600" />
                Charge total {formatCurrency(totalAmount)} to a card
              </div>
              {cardSucceeded ? (
                <div
                  className="flex items-start gap-2 rounded bg-emerald-50 border border-emerald-200 px-3 py-2"
                  data-testid="collect-payment-card-success"
                >
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div className="text-xs">
                    <p className="font-semibold text-emerald-900">Card charged</p>
                    <p className="text-emerald-800 leading-snug">
                      Updating invoice balances — the payment record posts automatically once
                      Stripe confirms.
                    </p>
                  </div>
                </div>
              ) : !cardIntent ? (
                <>
                  {cardIntentError ? (
                    <div className="flex items-start gap-2 rounded bg-rose-50 border border-rose-200 px-3 py-2">
                      <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                      <p
                        className="text-xs text-rose-700"
                        data-testid="collect-payment-card-error"
                      >
                        {cardIntentError}
                      </p>
                    </div>
                  ) : cardIntentMutation.isPending ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Preparing secure payment…
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      Click <span className="font-medium">Continue</span> below to enter card details.
                    </p>
                  )}
                </>
              ) : stripePromise ? (
                <Elements
                  stripe={stripePromise}
                  options={{ clientSecret: cardIntent.clientToken }}
                >
                  <EmbeddedStripeCardForm
                    submitLabel={`Charge ${formatCurrency(cardIntent.totalAmount)}`}
                    onSucceeded={() => setCardSucceeded(true)}
                    helperLine="The receipt and payment record post automatically once Stripe confirms."
                  />
                </Elements>
              ) : (
                <p
                  className="text-xs text-rose-600"
                  data-testid="collect-payment-card-config-error"
                >
                  Stripe is not fully configured. Ask an admin to set STRIPE_PUBLISHABLE_KEY.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Sticky footer. */}
        <DialogFooter
          className="px-5 py-3 border-t border-slate-200 bg-white gap-2 sticky bottom-0 z-10"
          data-testid="collect-payment-footer"
        >
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            data-testid="collect-payment-cancel"
            size="sm"
          >
            {cardSucceeded ? "Close" : "Cancel"}
          </Button>

          {/* Manual mode buttons. */}
          {!isCardMode && (
            <>
              <Button
                variant="outline"
                onClick={() => handleSaveManual(true)}
                disabled={!canSubmitManual || !hasBillingEmail}
                title={
                  !hasBillingEmail
                    ? "No billing email on file."
                    : undefined
                }
                data-testid="collect-payment-save-email"
                size="sm"
              >
                {busy && saveMode === "save-email" ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Mail className="h-4 w-4 mr-1.5" />
                )}
                Save and Email Receipt
              </Button>
              <Button
                onClick={() => handleSaveManual(false)}
                disabled={!canSubmitManual}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                data-testid="collect-payment-save"
                size="sm"
              >
                {busy && saveMode === "save" && (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                )}
                Save
              </Button>
            </>
          )}

          {/* Card mode — single primary button drives intent creation
              first, then the embedded form takes over. After success,
              only the close button remains active. */}
          {isCardMode && !cardIntent && !cardSucceeded && (
            <Button
              onClick={handleStartCard}
              disabled={!canStartCard}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              data-testid="collect-payment-card-continue"
              size="sm"
            >
              {cardIntentMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              )}
              Continue
            </Button>
          )}
        </DialogFooter>

        {/* Footer-row inline note when email is unavailable in manual mode. */}
        {!isCardMode && !hasBillingEmail && context && (
          <p
            className="px-5 py-1 text-[11px] text-amber-700 bg-amber-50 border-t border-amber-100"
            data-testid="collect-payment-no-billing-email"
          >
            No billing email on file — receipts cannot be emailed for this customer.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
