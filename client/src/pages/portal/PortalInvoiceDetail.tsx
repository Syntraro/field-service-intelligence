/**
 * PortalInvoiceDetail (2026-04-18 Phase 11, polished 2026-04-19)
 *
 * Customer-facing invoice detail.
 *
 * 2026-04-19 Polish pass:
 *   - Hero-style Balance Due card emphasizes the amount that matters
 *     for conversion.
 *   - Sticky mobile Pay CTA — always reachable while scrolling.
 *   - Skeleton loading instead of spinner.
 *   - Unified status banners via `portalStatusBadge` (consistent with
 *     dashboard + list tones).
 *   - Larger tap targets (44px min) on all primary actions.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Loader2,
  CreditCard,
  Download,
  CheckCircle2,
  AlertTriangle,
  Clock,
} from "lucide-react";
import {
  formatCurrency,
  formatDate,
  portalStatusBadge,
  resolveStatusKind,
  formatDueLabel,
  type PortalStatusKind,
} from "./portalUtils";
import { PortalPayInvoiceForm } from "./PortalPayInvoiceForm";
import { apiRequest } from "@/lib/queryClient";
import { usePortalAuth } from "@/lib/portalAuth";

interface InvoiceLine {
  id: string;
  lineNumber: number;
  lineItemType: string;
  description: string;
  quantity: string;
  unitPrice: string;
  lineSubtotal: string;
  taxAmount: string;
  lineTotal: string;
}

interface TaxLine {
  taxRateName: string;
  ratePercent: string;
  taxableAmount: string;
  taxAmount: string;
}

interface InvoiceDetail {
  id: string;
  invoiceNumber: string | null;
  status: string;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  amountPaid: string;
  balance: string;
  notesCustomer: string | null;
  clientMessage: string | null;
  workDescription: string | null;
  // Per-invoice raw flags retained for backward compat with the prior
  // client. Visibility decisions on this page are now driven entirely
  // by the resolved `displayPolicy` field on the response (2026-05-05).
  showQuantity: boolean;
  showUnitPrice: boolean;
  showLineTotals: boolean;
  showLineItems: boolean;
  showBalance: boolean;
}

/**
 * 2026-05-05: canonical resolved Invoice Display policy. Mirrors the
 * `InvoiceDisplayPolicy` shape exported from `@shared/invoiceDisplayPolicy`
 * — the server resolves once and the client renders against it directly.
 * Pre-policy server responses omit this field; the page falls back to
 * sensible defaults when it's missing.
 */
interface DisplayPolicy {
  showLogo: boolean;
  showCompanyAddress: boolean;
  showCompanyPhone: boolean;
  showCompanyEmail: boolean;
  showCompanyWebsite: boolean;
  showTaxNumber: boolean;
  showBillingAddress: boolean;
  showServiceAddress: boolean;
  showLocationName: boolean;
  showJobNumber: boolean;
  showSummary: boolean;
  showJobDescription: boolean;
  showClientMessage: boolean;
  clientMessage: string | null;
  showLineItems: boolean;
  showQuantities: boolean;
  showUnitPrices: boolean;
  showLineTotals: boolean;
}

/**
 * 2026-05-03 PR 5: payment history row on the portal invoice detail.
 * Both legacy 1:1 payments and modern multi-invoice allocations
 * contribute via the same shape — the source field lets the UI
 * distinguish if needed (today both render with a generic "Payment"
 * label and the per-row method / amount).
 */
interface PaymentHistoryRow {
  id: string;
  amount: string;
  method: string;
  receivedAt: string | null;
  providerSource: string | null;
  source: "direct" | "allocation";
}

interface InvoiceDetailResponse {
  invoice: InvoiceDetail;
  lines: InvoiceLine[];
  taxLines: TaxLine[];
  paymentsEnabled: boolean;
  /** 2026-05-03 PR 5 — additive; missing on pre-PR-5 server responses. */
  payments?: PaymentHistoryRow[];
  /** 2026-05-05 — additive resolved display policy; missing on older servers. */
  displayPolicy?: DisplayPolicy;
}

/**
 * Fallback policy mirrors the shared/invoiceDisplayPolicy resolver's
 * defaults for the case where the server response predates this field.
 * Per-invoice raw flags are honored so behavior matches the prior client.
 */
function defaultPolicyFromInvoice(inv: InvoiceDetail): DisplayPolicy {
  return {
    showLogo: false,
    showCompanyAddress: true,
    showCompanyPhone: true,
    showCompanyEmail: true,
    showCompanyWebsite: false,
    showTaxNumber: true,
    showBillingAddress: true,
    showServiceAddress: true,
    showLocationName: true,
    showJobNumber: false,
    showSummary: false,
    showJobDescription: true,
    showClientMessage: true,
    clientMessage: inv.clientMessage,
    showLineItems: inv.showLineItems !== false,
    showQuantities: inv.showQuantity !== false,
    showUnitPrices: inv.showUnitPrice !== false,
    showLineTotals: inv.showLineTotals !== false,
  };
}

// 2026-04-21 provider-neutral response from the canonical checkout route.
// `clientToken` is the opaque token the provider SDK consumes (for Stripe:
// the PaymentIntent clientSecret). Other fields are passthrough — the UI
// never reads provider-specific names.
interface CheckoutResponse {
  providerId: "stripe";
  clientToken: string;
  providerPaymentId: string;
  publishableKey?: string;
  prospectivePaymentId: string;
}

// Cache Stripe.js loads across invoice pages — loading the script once
// per publishable key is the documented pattern.
const stripePromiseCache = new Map<string, Promise<Stripe | null>>();
function getStripePromise(publishableKey: string): Promise<Stripe | null> {
  let p = stripePromiseCache.get(publishableKey);
  if (!p) {
    p = loadStripe(publishableKey);
    stripePromiseCache.set(publishableKey, p);
  }
  return p;
}

export default function PortalInvoiceDetail() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [intent, setIntent] = useState<CheckoutResponse | null>(null);
  const [intentError, setIntentError] = useState<string | null>(null);
  const [justPaid, setJustPaid] = useState(false);
  const queryClient = useQueryClient();

  // 2026-05-03 PR 3: support `?pay=1` deep-link from the list page's
  // per-row Pay Now button. We auto-open the pay modal once the
  // invoice loads (and is payable). One-shot — clearing the query
  // string isn't necessary because wouter doesn't re-fire the effect
  // on identical-state renders.
  const autoOpenPay =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("pay") === "1";

  // 2026-05-05: invoice-scoped access token from the Pay Invoice email
  // link (`?t=…`). When present, the customer can view + pay this ONE
  // invoice without going through magic-link sign-in. The token is
  // threaded onto every API call as a query string parameter so the
  // server's `resolveInvoiceTokenScope` middleware can validate it.
  // Falls through to portal-session auth when absent.
  const accessToken =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("t")
      : null;
  const tokenQuery = accessToken ? `?t=${encodeURIComponent(accessToken)}` : "";

  // 2026-05-05: when the customer arrived via the email Pay Invoice
  // link (token mode) and has no portal session, surface a "Sign in to
  // view all invoices" affordance in place of the Invoices back link
  // (which would 401 anyway). The portal-session probe is the standard
  // /api/portal/me query mounted by PortalAuthProvider.
  const portalAuth = usePortalAuth();
  const isTokenOnlyAccess = !!accessToken && !portalAuth.user && !portalAuth.isLoading;

  const invoiceQueryKey = [`/api/portal/invoices/${invoiceId}${tokenQuery}`];
  const { data, isLoading, isError } = useQuery<InvoiceDetailResponse>({
    queryKey: invoiceQueryKey,
    enabled: !!invoiceId,
  });

  const createIntentMutation = useMutation({
    mutationFn: async (): Promise<CheckoutResponse> => {
      // 2026-04-21 provider-neutral endpoint. Response uses `clientToken`
      // + `providerId`; the Stripe-specific names stay inside the
      // provider-adapter layer and the Stripe Elements call below.
      // 2026-05-05: switched from plain fetch() to `apiRequest` so the
      // global csurf middleware sees the X-CSRF-Token header. The bare
      // fetch path was the cause of "Invalid CSRF token" on every Pay
      // click in the portal. Access token (if present) is threaded on
      // the query string so the server's invoice-scoped access check
      // can authorize the request without a magic-link session.
      return await apiRequest<CheckoutResponse>(
        `/api/portal/invoices/${invoiceId}/payments/checkout${tokenQuery}`,
        { method: "POST" },
      );
    },
    onSuccess: (result) => {
      setIntent(result);
      setIntentError(null);
    },
    onError: (err: Error) => {
      setIntentError(err.message);
    },
  });

  const openPayModal = () => {
    setIntent(null);
    setIntentError(null);
    setPayModalOpen(true);
    createIntentMutation.mutate();
  };

  const closePayModal = () => {
    setPayModalOpen(false);
    setIntent(null);
    setIntentError(null);
  };

  // When Stripe confirms inline, the webhook has NOT necessarily
  // finished yet — refetch on an interval briefly so the UI picks up
  // the balance update as soon as the canonical writer commits.
  useEffect(() => {
    if (!justPaid) return;
    const timers: number[] = [];
    [1500, 3500, 7500].forEach((delay) => {
      timers.push(
        window.setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: invoiceQueryKey });
        }, delay),
      );
    });
    return () => timers.forEach((t) => clearTimeout(t));
  }, [justPaid, queryClient, invoiceId]);

  // Auto-open pay modal when the page lands with `?pay=1` AND the
  // invoice has loaded into a payable state. We trigger via the same
  // openPayModal path as the manual button so every guard stays in
  // one place. Re-runs only when the underlying invoice id or
  // payments-enabled flag changes (the boolean dep keeps it idempotent
  // on the same load).
  const dataInvoiceStatus = data?.invoice.status;
  const dataPaymentsEnabled = data?.paymentsEnabled;
  const dataBalance = data?.invoice.balance;
  useEffect(() => {
    if (!autoOpenPay) return;
    if (!dataInvoiceStatus) return;
    if (!dataPaymentsEnabled) return;
    const hasBalance = parseFloat(dataBalance ?? "0") > 0;
    const isPayable =
      dataInvoiceStatus === "awaiting_payment" ||
      dataInvoiceStatus === "sent" ||
      dataInvoiceStatus === "partial_paid";
    if (hasBalance && isPayable && !payModalOpen) {
      openPayModal();
    }
    // openPayModal closes over stable state setters; safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenPay, dataInvoiceStatus, dataPaymentsEnabled, dataBalance]);

  const stripePromise = useMemo(
    () => (intent?.publishableKey ? getStripePromise(intent.publishableKey) : null),
    [intent?.publishableKey],
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" className="h-10 -ml-2" asChild>
          <Link href="/portal/invoices">
            <ArrowLeft className="h-4 w-4 mr-1" /> Invoices
          </Link>
        </Button>
        <Card>
          <CardContent className="py-8 space-y-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-8 w-56" />
            <div className="grid grid-cols-2 gap-4 pt-4">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-6 space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-10/12" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" className="h-10 -ml-2" asChild>
          <Link href="/portal/invoices">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Link>
        </Button>
        <Card>
          <CardContent className="py-12 text-center text-slate-500">
            Invoice not found.
          </CardContent>
        </Card>
      </div>
    );
  }

  const { invoice, lines, taxLines, paymentsEnabled, payments, displayPolicy } = data;
  const paymentHistory = payments ?? [];
  // 2026-05-05: resolved display policy — preferred source of truth for
  // every visibility decision. Falls back to the prior per-invoice flags
  // when the server response predates the policy field.
  const policy: DisplayPolicy = displayPolicy ?? defaultPolicyFromInvoice(invoice);
  const hasBalance = parseFloat(invoice.balance || "0") > 0;
  const isPayable =
    invoice.status === "awaiting_payment" ||
    invoice.status === "sent" ||
    invoice.status === "partial_paid";
  const canPayNow = paymentsEnabled && hasBalance && isPayable;

  const badge = portalStatusBadge({
    status: invoice.status,
    balance: invoice.balance,
    dueDate: invoice.dueDate,
  });
  const kind: PortalStatusKind = badge.kind;
  const dueLabel = formatDueLabel(invoice.dueDate);

  return (
    <div className="space-y-4 pb-24 sm:pb-4">
      {/* Back link / sign-in affordance — larger tap target than before.
           In token-only mode (?t= present, no portal session) the
           Invoices list would 401, so show a sign-in CTA instead. */}
      {isTokenOnlyAccess ? (
        <Button variant="ghost" size="sm" className="h-10 -ml-2" asChild>
          <Link href="/portal">
            <ArrowLeft className="h-4 w-4 mr-1" /> Sign in to view all invoices
          </Link>
        </Button>
      ) : (
        <Button variant="ghost" size="sm" className="h-10 -ml-2" asChild>
          <Link href="/portal/invoices">
            <ArrowLeft className="h-4 w-4 mr-1" /> Invoices
          </Link>
        </Button>
      )}

      {/* ── Hero card — Balance Due is the emphasis. ──────────────── */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <CardTitle className="text-xl tracking-tight">
                Invoice #{invoice.invoiceNumber || "—"}
              </CardTitle>
              <p className="text-sm text-slate-500 mt-1">
                Issued {formatDate(invoice.issueDate)}
                {dueLabel && kind !== "paid" ? ` · ${dueLabel}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${badge.className}`}
              >
                {badge.label}
              </span>
              <Button
                variant="outline"
                size="sm"
                asChild
                className="h-9"
                data-testid="portal-download-pdf"
              >
                <a
                  href={`/api/portal/invoices/${invoice.id}/pdf${tokenQuery}`}
                  target="_blank"
                  rel="noopener"
                >
                  <Download className="h-4 w-4 mr-1" /> PDF
                </a>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 items-end">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500 font-medium">Total</p>
              <p className="text-lg font-semibold text-slate-900 tabular-nums">
                {formatCurrency(invoice.total, invoice.currency)}
              </p>
            </div>
            {invoice.showBalance && (
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500 font-medium">Balance Due</p>
                <p
                  className={`text-3xl font-bold tabular-nums leading-tight ${
                    kind === "past_due"
                      ? "text-red-700"
                      : kind === "due_soon"
                        ? "text-orange-700"
                        : "text-slate-900"
                  }`}
                  data-testid="portal-balance-due"
                >
                  {formatCurrency(invoice.balance, invoice.currency)}
                </p>
              </div>
            )}
          </div>

          {/* Inline Pay CTA on desktop (hidden on mobile — sticky bar covers it). */}
          {canPayNow && (
            <div className="hidden sm:block mt-5">
              <Button
                onClick={openPayModal}
                className="w-full h-12 text-base bg-[#76B054] hover:bg-[#6aa147] text-white"
                size="lg"
                data-testid="portal-pay-now"
              >
                <CreditCard className="h-5 w-5 mr-2" />
                Pay {formatCurrency(invoice.balance, invoice.currency)}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Status banner. Tones match portalStatusBadge. ─────────── */}
      {kind === "paid" && (
        <StatusBanner
          tone="emerald"
          icon={CheckCircle2}
          title="Paid in full"
          body="Thank you — we received your payment."
          testId="portal-banner-paid"
        />
      )}
      {kind === "partial_paid" && (
        <StatusBanner
          tone="yellow"
          icon={CheckCircle2}
          title="Partial payment received"
          body={`Remaining balance: ${formatCurrency(invoice.balance, invoice.currency)}.`}
          testId="portal-banner-partial"
        />
      )}
      {kind === "past_due" && (
        <StatusBanner
          tone="red"
          icon={AlertTriangle}
          title="Past due"
          body={`Balance of ${formatCurrency(invoice.balance, invoice.currency)} is past the due date.`}
          testId="portal-banner-past-due"
        />
      )}
      {kind === "due_soon" && (
        <StatusBanner
          tone="orange"
          icon={Clock}
          title="Due soon"
          body={`Balance of ${formatCurrency(invoice.balance, invoice.currency)} is due ${formatDate(invoice.dueDate)}.`}
          testId="portal-banner-due-soon"
        />
      )}

      {/* ── Line items ──────────────────────────────────────────── */}
      {policy.showLineItems && lines.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Line items</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-slate-100">
              {lines.map((line) => (
                <div key={line.id} className="px-4 py-3">
                  <div className="flex justify-between items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-900">{line.description}</p>
                      {(policy.showQuantities || policy.showUnitPrices) && (
                        <p className="text-xs text-slate-500 mt-0.5">
                          {policy.showQuantities && `Qty: ${line.quantity}`}
                          {policy.showQuantities && policy.showUnitPrices && " × "}
                          {policy.showUnitPrices && formatCurrency(line.unitPrice, invoice.currency)}
                        </p>
                      )}
                    </div>
                    {policy.showLineTotals && (
                      <p className="font-medium text-slate-900 tabular-nums shrink-0">
                        {formatCurrency(line.lineTotal, invoice.currency)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Totals ──────────────────────────────────────────────── */}
      <Card>
        <CardContent className="pt-6 space-y-2">
          <TotalsRow
            label="Subtotal"
            value={formatCurrency(invoice.subtotal, invoice.currency)}
          />
          {taxLines.length > 0 ? (
            taxLines.map((tl, i) => (
              <TotalsRow
                key={i}
                label={`${tl.taxRateName} (${tl.ratePercent}%)`}
                value={formatCurrency(tl.taxAmount, invoice.currency)}
              />
            ))
          ) : parseFloat(invoice.taxTotal || "0") > 0 ? (
            <TotalsRow label="Tax" value={formatCurrency(invoice.taxTotal, invoice.currency)} />
          ) : null}
          <div className="flex justify-between font-semibold text-base border-t pt-2.5">
            <span>Total</span>
            <span className="tabular-nums">{formatCurrency(invoice.total, invoice.currency)}</span>
          </div>
          {parseFloat(invoice.amountPaid || "0") > 0 && (
            <div className="flex justify-between text-sm text-emerald-700">
              <span>Paid</span>
              <span className="tabular-nums">-{formatCurrency(invoice.amountPaid, invoice.currency)}</span>
            </div>
          )}
          {invoice.showBalance && hasBalance && (
            <div className="flex justify-between font-semibold text-base">
              <span>Balance Due</span>
              <span className="tabular-nums">{formatCurrency(invoice.balance, invoice.currency)}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Payment history (2026-05-03 PR 5) ────────────────────────
          Shows every "money in" event applied to this invoice — both
          legacy 1:1 payments and multi-invoice payment allocations.
          Renders only when there's history to show; pre-PR-5 server
          responses omit the field entirely (paymentHistory == []). */}
      {paymentHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payment history</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-slate-100">
              {paymentHistory.map((p) => {
                const label =
                  p.providerSource === "stripe"
                    ? "Online payment"
                    : p.providerSource === "qbo"
                      ? "Payment (QuickBooks)"
                      : "Payment";
                const methodSuffix =
                  p.method && p.method !== "credit" && p.method !== "other"
                    ? ` · ${p.method}`
                    : "";
                return (
                  <div
                    key={p.id}
                    className="px-4 py-3 flex items-center justify-between gap-3"
                    data-testid={`portal-payment-row-${p.id}`}
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 text-sm">
                        {label}
                        {methodSuffix}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {p.receivedAt ? formatDate(p.receivedAt) : "—"}
                      </p>
                    </div>
                    <p
                      className="font-semibold text-sm tabular-nums text-emerald-700 shrink-0"
                      data-testid={`portal-payment-amount-${p.id}`}
                    >
                      {formatCurrency(p.amount, invoice.currency)}
                    </p>
                  </div>
                );
              })}
            </div>
            {/* Footer rolls up the totals — gives the customer a clear
                "Total paid" + "Remaining" view that matches the
                Hero Balance Due number above. */}
            <div className="border-t border-slate-100 px-4 py-3 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Total paid</span>
                <span className="font-semibold tabular-nums text-emerald-700">
                  {formatCurrency(invoice.amountPaid, invoice.currency)}
                </span>
              </div>
              {invoice.showBalance && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Remaining balance</span>
                  <span
                    className={`font-semibold tabular-nums ${
                      hasBalance ? "text-slate-900" : "text-emerald-700"
                    }`}
                  >
                    {formatCurrency(invoice.balance, invoice.currency)}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Notes / Terms ─────────────────────────────────────────
          2026-05-05: blocks are gated by the resolved displayPolicy.
          policy.clientMessage is null when the tenant has the message
          block off OR when the per-invoice text is empty. notesCustomer
          (QBO CustomerMemo) is rendered as before — it's a separate
          field and not part of the new tenant Client-Message toggle. */}
      {(policy.clientMessage ||
        invoice.notesCustomer ||
        (invoice.workDescription && policy.showJobDescription)) && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            {policy.clientMessage && (
              <NotesBlock label="Message" text={policy.clientMessage} />
            )}
            {invoice.notesCustomer && (
              <NotesBlock label="Notes" text={invoice.notesCustomer} />
            )}
            {invoice.workDescription && policy.showJobDescription && (
              <NotesBlock label="Scope of work" text={invoice.workDescription} />
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Sticky mobile Pay CTA ──────────────────────────────────
          Sits above the PortalLayout trust strip + bottom nav. The
          parent already sets `pb-24 sm:pb-4` on the content container
          so nothing scrolls underneath the bar. */}
      {canPayNow && (
        <div
          className="fixed bottom-[112px] left-0 right-0 z-30 sm:hidden px-4 pb-2 pt-3 bg-gradient-to-t from-white via-white to-transparent"
          data-testid="portal-pay-now-sticky"
        >
          <Button
            onClick={openPayModal}
            className="w-full h-12 text-base bg-[#76B054] hover:bg-[#6aa147] text-white shadow-lg"
            size="lg"
          >
            <CreditCard className="h-5 w-5 mr-2" />
            Pay {formatCurrency(invoice.balance, invoice.currency)}
          </Button>
        </div>
      )}

      {/* ── Payment modal ──────────────────────────────────────── */}
      <Dialog open={payModalOpen} onOpenChange={(open) => (open ? setPayModalOpen(true) : closePayModal())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pay invoice</DialogTitle>
            <DialogDescription>
              Paying {formatCurrency(invoice.balance, invoice.currency)} for invoice #
              {invoice.invoiceNumber || "—"}.
            </DialogDescription>
          </DialogHeader>

          {justPaid ? (
            <div className="py-6 text-center space-y-3" data-testid="portal-pay-success">
              <div className="mx-auto h-12 w-12 rounded-full bg-emerald-50 flex items-center justify-center">
                <CheckCircle2 className="h-7 w-7 text-emerald-600" />
              </div>
              <p className="font-semibold text-lg text-slate-900">Payment received</p>
              <p className="text-sm text-slate-600 leading-relaxed">
                Your balance will update here once processing completes. A receipt will be emailed to you.
              </p>
              <Button variant="outline" onClick={closePayModal} className="h-10">
                Close
              </Button>
            </div>
          ) : createIntentMutation.isPending || !intent ? (
            <div className="py-6 flex flex-col items-center gap-2">
              {intentError ? (
                <>
                  <p className="text-sm text-red-600" data-testid="portal-intent-error">
                    {intentError}
                  </p>
                  <Button variant="outline" onClick={closePayModal} className="h-10">
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
          ) : (
            stripePromise && (
              <Elements
                stripe={stripePromise}
                options={{ clientSecret: intent.clientToken }}
              >
                <PortalPayInvoiceForm
                  onSucceeded={() => {
                    setJustPaid(true);
                    queryClient.invalidateQueries({ queryKey: invoiceQueryKey });
                  }}
                  onCancel={closePayModal}
                />
              </Elements>
            )
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Inline sub-components ─────────────────────────────────────────

function TotalsRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="tabular-nums text-slate-700">{value}</span>
    </div>
  );
}

function NotesBlock({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-1">{label}</p>
      <p className="text-sm whitespace-pre-wrap text-slate-700 leading-relaxed">{text}</p>
    </div>
  );
}

function StatusBanner({
  tone,
  icon: Icon,
  title,
  body,
  testId,
}: {
  // 2026-05-03 PR 5: tone palette aligned with `portalStatusBadge`.
  // `yellow` for partial-paid + `orange` for due-soon disambiguates
  // them at a glance vs. the previous sky/amber pairing where partial
  // could be misread as informational rather than "needs attention".
  tone: "emerald" | "yellow" | "orange" | "red";
  icon: typeof CheckCircle2;
  title: string;
  body: string;
  testId: string;
}) {
  const toneClasses = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
    yellow: "border-yellow-200 bg-yellow-50 text-yellow-900",
    orange: "border-orange-200 bg-orange-50 text-orange-900",
    red: "border-red-200 bg-red-50 text-red-900",
  }[tone];
  const iconColor = {
    emerald: "text-emerald-700",
    yellow: "text-yellow-700",
    orange: "text-orange-700",
    red: "text-red-700",
  }[tone];
  return (
    <div className={`rounded-md border px-4 py-3 flex items-start gap-3 ${toneClasses}`} data-testid={testId}>
      <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${iconColor}`} />
      <div className="text-sm">
        <p className="font-semibold">{title}</p>
        <p className="opacity-90">{body}</p>
      </div>
    </div>
  );
}
