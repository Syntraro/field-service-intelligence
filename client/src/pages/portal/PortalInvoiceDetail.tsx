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
  ArrowLeft,
  Loader2,
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
  /**
   * 2026-05-05: connected-account id (Stripe Connect `acct_...`). The
   * backend creates the PaymentIntent on the tenant's connected
   * account (Direct Charges); the customer device MUST load Stripe.js
   * with `{ stripeAccount }` or PaymentElement's iframe sits stuck
   * trying to fetch the intent on the platform account and `onReady`
   * never fires. Present on portal source.
   */
  providerAccountId?: string;
  prospectivePaymentId: string;
}

// Cache Stripe.js loads across invoice pages — loading the script once
// per (publishable key, stripeAccount) tuple is the documented pattern.
//
// 2026-05-05: wrap loadStripe with a `.catch(() => null)` so a script-
// load failure (CSP block, network outage, ad-blocker) resolves the
// returned Promise to `null` instead of REJECTING. A rejected Promise
// here would bubble into <Elements> and surface as Vite's
// "Failed to load Stripe.js" runtime overlay; the null path renders
// a graceful "Online payments are temporarily unavailable" message.
//
// 2026-05-05 (Connect fix): cache key now includes the connected
// account id. Different tenants land on different connected accounts;
// reusing the same Stripe.js instance across them mounts intents on
// the wrong account and the iframe never resolves.
const stripePromiseCache = new Map<string, Promise<Stripe | null>>();
function getStripePromise(
  publishableKey: string,
  stripeAccount?: string | null,
): Promise<Stripe | null> {
  const cacheKey = stripeAccount
    ? `${publishableKey}|${stripeAccount}`
    : publishableKey;
  let p = stripePromiseCache.get(cacheKey);
  if (!p) {
    p = loadStripe(
      publishableKey,
      stripeAccount ? { stripeAccount } : undefined,
    ).catch((err) => {
      console.error("[PortalInvoiceDetail] Stripe.js failed to load", err);
      return null;
    });
    stripePromiseCache.set(cacheKey, p);
  }
  return p;
}

export default function PortalInvoiceDetail() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const [intent, setIntent] = useState<CheckoutResponse | null>(null);
  const [intentError, setIntentError] = useState<string | null>(null);
  // 2026-05-05: Stripe accepted the payment but we haven't yet confirmed
  // that the canonical webhook writer applied it server-side. Until
  // either the balance decreases OR the status transitions, we show
  // "Processing payment…" — NOT "Payment received". Webhook stays the
  // sole writer (no synchronous-finalize endpoint); the portal just
  // polls until it sees the writer commit.
  const [awaitingApplication, setAwaitingApplication] = useState(false);
  // Snapshot of the balance at the moment Stripe accepted the payment.
  // If the polled `data.invoice.balance` drops below this value we know
  // the webhook landed.
  const [pendingBalanceCents, setPendingBalanceCents] = useState<number | null>(null);
  // 30-second timeout. After this, the customer sees a "your invoice
  // will update once Stripe confirms" message instead of a stuck
  // spinner. Common cause: dev environment without Stripe CLI
  // forwarding (in production the webhook usually lands within ~3s).
  const [applicationTimedOut, setApplicationTimedOut] = useState(false);
  const [justPaid, setJustPaid] = useState(false);
  const queryClient = useQueryClient();

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

  // 2026-05-05: Stripe-accepted → backend-applied polling. After
  // confirmPayment succeeds the canonical webhook writer is what
  // actually creates the payment row, allocation, balance update,
  // status transition, AND receipt email. Without webhook delivery
  // the portal must NOT pretend "Payment received" — so we poll the
  // invoice every 1.5s until either the balance decreases (or the
  // status transitions to paid / partial_paid). 30-second cap so a
  // dev environment without Stripe CLI forwarding doesn't spin
  // forever — see `applicationTimedOut` branch in the panel below.
  useEffect(() => {
    if (!awaitingApplication) return;
    const POLL_MS = 1500;
    const TIMEOUT_MS = 30_000;
    const start = Date.now();
    const timer = window.setInterval(() => {
      queryClient.invalidateQueries({ queryKey: invoiceQueryKey });
      if (Date.now() - start >= TIMEOUT_MS) {
        setApplicationTimedOut(true);
        window.clearInterval(timer);
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [awaitingApplication, queryClient, invoiceId, accessToken]);

  // Watch for the webhook's effect to land. The `data` from useQuery
  // refreshes on each invalidate from the polling effect above; when
  // the balance has dropped below `pendingBalanceCents` we know the
  // canonical writer committed. Status transition is a secondary
  // signal for the rare case where the new balance equals the old
  // one (e.g., a refund/adjustment race).
  useEffect(() => {
    if (!awaitingApplication) return;
    if (pendingBalanceCents == null) return;
    const inv = data?.invoice;
    if (!inv) return;
    const currentCents = Math.round(parseFloat(inv.balance || "0") * 100);
    const statusTransitioned =
      inv.status === "paid" || inv.status === "partial_paid";
    if (currentCents < pendingBalanceCents || statusTransitioned) {
      setJustPaid(true);
      setAwaitingApplication(false);
      setApplicationTimedOut(false);
    }
  }, [awaitingApplication, pendingBalanceCents, data?.invoice?.balance, data?.invoice?.status]);

  // 2026-05-05 redesign: the Pay flow no longer hides behind a modal.
  // The right-side payment panel renders inline as soon as the invoice
  // loads into a payable state, so we mint the PaymentIntent eagerly
  // here. Guarded against re-firing while a request is in flight, while
  // an intent already exists, while a previous attempt errored, and
  // after a successful payment.
  const dataInvoiceStatus = data?.invoice.status;
  const dataPaymentsEnabled = data?.paymentsEnabled;
  const dataBalance = data?.invoice.balance;
  const isPayableForIntent =
    !!dataInvoiceStatus &&
    !!dataPaymentsEnabled &&
    parseFloat(dataBalance ?? "0") > 0 &&
    (dataInvoiceStatus === "awaiting_payment" ||
      dataInvoiceStatus === "sent" ||
      dataInvoiceStatus === "partial_paid");
  useEffect(() => {
    if (!isPayableForIntent) return;
    if (intent) return;
    if (intentError) return;
    if (createIntentMutation.isPending) return;
    if (justPaid) return;
    createIntentMutation.mutate();
    // createIntentMutation is referentially stable from useMutation;
    // omitted from deps so we don't re-fire on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPayableForIntent, intent, intentError, justPaid]);

  const stripePromise = useMemo(
    () =>
      intent?.publishableKey
        ? getStripePromise(intent.publishableKey, intent.providerAccountId ?? null)
        : null,
    [intent?.publishableKey, intent?.providerAccountId],
  );

  // 2026-05-05: track whether Stripe.js actually loaded. The promise
  // returned by `getStripePromise` resolves to `null` on script-load
  // failure (see catch wrap above). Without this state the modal's
  // ternary mounts <Elements stripe={null}>, which Stripe throws on.
  // We observe the resolved value and surface a clean error UI.
  const [stripeLoadFailed, setStripeLoadFailed] = useState(false);
  useEffect(() => {
    if (!stripePromise) {
      setStripeLoadFailed(false);
      return;
    }
    setStripeLoadFailed(false);
    let cancelled = false;
    stripePromise.then((stripe) => {
      if (!cancelled && !stripe) setStripeLoadFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [stripePromise]);

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

      {/* 2026-05-05 redesign: two-column layout. Left column carries
          the invoice itself (hero, status banner, line items, totals,
          history, notes); the right column hosts a sticky payment
          panel that mounts Stripe Elements directly — no modal step.
          Below `lg` the columns stack and the panel renders inline
          beneath the invoice content. */}
      <div className="grid lg:grid-cols-3 gap-4 lg:items-start">
        <div className="lg:col-span-2 space-y-4">

      {/* ── Top card — invoice identity + dates + scope + amount due.
           2026-05-05 redesign: replaces the prior dual-emphasis hero
           (Total + giant Balance Due). The right-side payment panel
           is the single source of "balance due" visual emphasis;
           this card carries identity and the billable summary. */}
      <Card className="overflow-hidden" data-testid="portal-invoice-top-card">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <CardTitle className="text-xl tracking-tight">
                Invoice #{invoice.invoiceNumber || "—"}
              </CardTitle>
              <p className="text-sm text-slate-500 mt-1">
                Issued {formatDate(invoice.issueDate)}
                {invoice.dueDate ? ` · Due ${formatDate(invoice.dueDate)}` : ""}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              asChild
              className="h-9 shrink-0"
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
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Scope of Work — promoted up from the legacy Notes/Terms
               block. Customers want context for "what am I paying for"
               at the top, not at the bottom of the page. Gated by the
               same `showJobDescription` policy that previously drove
               the Notes block. */}
          {invoice.workDescription && policy.showJobDescription && (
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500 font-medium">
                Scope of Work
              </p>
              <p
                className="text-sm text-slate-700 mt-1 whitespace-pre-wrap leading-relaxed"
                data-testid="portal-scope-of-work"
              >
                {invoice.workDescription}
              </p>
            </div>
          )}

          {/* Amount Due — single line. Big balance treatment lives in
               the right-side payment panel; here it's just informational
               so a customer scanning the top of the page sees what they
               owe. Hidden when the tenant's display policy hides the
               balance on customer-facing PDFs/portal. */}
          {invoice.showBalance && (
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs uppercase tracking-wide text-slate-500 font-medium">
                Amount Due
              </span>
              <span
                className={`text-lg font-semibold tabular-nums ${
                  kind === "past_due"
                    ? "text-red-700"
                    : kind === "due_soon"
                      ? "text-orange-700"
                      : "text-slate-900"
                }`}
                data-testid="portal-amount-due"
              >
                {formatCurrency(invoice.balance, invoice.currency)}
              </span>
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

      {/* ── Compact totals block.
           2026-05-05 redesign: was a separate Card; now a slim
           summary that lives at the bottom of the line items. The
           balance row only renders when it differs from the total
           (i.e., a partial payment has been applied) — repeating
           "Total = Balance Due" added noise without information. */}
      <Card data-testid="portal-totals">
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
            <span className="tabular-nums">
              {formatCurrency(invoice.total, invoice.currency)}
            </span>
          </div>
          {parseFloat(invoice.amountPaid || "0") > 0 && (
            <div className="flex justify-between text-sm text-emerald-700">
              <span>Paid</span>
              <span className="tabular-nums">
                -{formatCurrency(invoice.amountPaid, invoice.currency)}
              </span>
            </div>
          )}
          {invoice.showBalance &&
            hasBalance &&
            parseFloat(invoice.amountPaid || "0") > 0 && (
              <div className="flex justify-between font-semibold text-base">
                <span>Balance Due</span>
                <span className="tabular-nums">
                  {formatCurrency(invoice.balance, invoice.currency)}
                </span>
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
          2026-05-05 redesign: `Scope of work` (workDescription) moved
          UP to the top card so a customer scanning the page sees what
          they're paying for first. This block carries the customer-
          facing message only (clientMessage; backfilled from notesCustomer
          via 2026_05_13 migration). */}
      {policy.clientMessage && (
        <Card>
          <CardContent className="pt-6">
            <NotesBlock label="Message" text={policy.clientMessage} />
          </CardContent>
        </Card>
      )}

        </div>{/* /lg:col-span-2 (left column) */}

        {/* ── Right column: sticky inline payment panel ───────────────
             Renders only when:
               - the invoice is in a payable state (canPayNow), OR
               - we're showing the post-payment success card.
             Mounts on `lg+` as a sticky sidebar; on smaller breakpoints
             it stacks below the invoice content. */}
        {(canPayNow || justPaid) && (
          <aside className="lg:col-span-1" data-testid="portal-payment-panel">
            <div className="lg:sticky lg:top-4">
              <Card className="overflow-hidden">
                <CardHeader className="pb-3">
                  {/* 2026-05-05 redesign: slim header. Title is just
                       "Payment", and the amount sits as a single-line
                       "Amount due: $XX" — no large balance hero
                       treatment (the top card already shows the
                       Amount Due line, no need to repeat in big type). */}
                  <CardTitle className="text-base">Payment</CardTitle>
                  {invoice.showBalance && (
                    <div
                      className="flex items-baseline justify-between gap-2 pt-1"
                      data-testid="portal-payment-panel-amount-due"
                    >
                      <span className="text-xs uppercase tracking-wide text-slate-500 font-medium">
                        Amount Due
                      </span>
                      <span className="text-base font-semibold tabular-nums text-slate-900">
                        {formatCurrency(invoice.balance, invoice.currency)}
                      </span>
                    </div>
                  )}
                </CardHeader>
                <CardContent>
                  {justPaid ? (
                    <div
                      className="text-center space-y-3 py-2"
                      data-testid="portal-pay-success"
                    >
                      <div className="mx-auto h-12 w-12 rounded-full bg-emerald-50 flex items-center justify-center">
                        <CheckCircle2 className="h-7 w-7 text-emerald-600" />
                      </div>
                      <p className="font-semibold text-slate-900">
                        Payment received
                      </p>
                      <p className="text-sm text-slate-600 leading-relaxed">
                        A receipt will be emailed to you shortly.
                      </p>
                    </div>
                  ) : applicationTimedOut ? (
                    // 2026-05-05: webhook hasn't landed within 30s.
                    // Stripe definitely accepted the payment (we got
                    // here from a successful confirmPayment), but our
                    // backend hasn't recorded it yet. The customer
                    // should NOT see "Payment received" until the
                    // canonical writer commits — but we also can't
                    // leave them spinning forever. Surface an honest
                    // "still processing" state with a hint.
                    <div
                      className="text-center space-y-3 py-2"
                      data-testid="portal-pay-awaiting-timeout"
                    >
                      <div className="mx-auto h-12 w-12 rounded-full bg-amber-50 flex items-center justify-center">
                        <AlertTriangle className="h-6 w-6 text-amber-600" />
                      </div>
                      <p className="font-semibold text-slate-900">
                        Payment is still processing
                      </p>
                      <p className="text-sm text-slate-600 leading-relaxed">
                        Your invoice will update once Stripe confirms it. If
                        you don't see a receipt within a few minutes, please
                        contact us — we can confirm directly from the
                        payment processor.
                      </p>
                    </div>
                  ) : awaitingApplication ? (
                    // 2026-05-05: Stripe accepted the payment, polling
                    // for the canonical writer (webhook) to commit.
                    <div
                      className="text-center space-y-3 py-2"
                      data-testid="portal-pay-awaiting"
                    >
                      <Loader2 className="h-6 w-6 animate-spin text-slate-400 mx-auto" />
                      <p className="font-semibold text-slate-900">
                        Processing your payment…
                      </p>
                      <p className="text-sm text-slate-600 leading-relaxed">
                        Stripe accepted your card. We're confirming the
                        payment with our records now — this usually takes
                        a few seconds.
                      </p>
                    </div>
                  ) : intentError ? (
                    <div className="space-y-3" data-testid="portal-intent-error">
                      <p className="text-sm text-red-600 leading-snug">
                        {intentError}
                      </p>
                      <Button
                        variant="outline"
                        className="w-full h-10"
                        onClick={() => {
                          setIntent(null);
                          setIntentError(null);
                          createIntentMutation.mutate();
                        }}
                      >
                        Try again
                      </Button>
                    </div>
                  ) : stripeLoadFailed ? (
                    <div
                      className="flex flex-col items-center gap-3 text-center py-2"
                      data-testid="portal-stripe-load-failed"
                    >
                      <div className="mx-auto h-12 w-12 rounded-full bg-amber-50 flex items-center justify-center">
                        <AlertTriangle className="h-6 w-6 text-amber-600" />
                      </div>
                      <p className="font-semibold text-slate-900">
                        Online payments are temporarily unavailable.
                      </p>
                      <p className="text-sm text-slate-600 leading-relaxed">
                        We couldn't load the secure payment form. Please try
                        again later, or reply to your invoice email and we'll
                        arrange another way to pay.
                      </p>
                    </div>
                  ) : !intent || createIntentMutation.isPending ? (
                    <div
                      className="flex flex-col items-center gap-2 py-6"
                      data-testid="portal-payment-panel-loading"
                    >
                      <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                      <p className="text-sm text-slate-500">
                        Preparing secure payment…
                      </p>
                    </div>
                  ) : stripePromise ? (
                    <Elements
                      stripe={stripePromise}
                      options={{ clientSecret: intent.clientToken }}
                    >
                      <PortalPayInvoiceForm
                        amountLabel={`Pay ${formatCurrency(invoice.balance, invoice.currency)}`}
                        onSucceeded={() => {
                          // 2026-05-05: Stripe accepted the payment —
                          // but the backend hasn't applied it yet. The
                          // canonical webhook writer creates the
                          // payment row + allocation + balance update
                          // + receipt email. Snapshot the current
                          // balance and start polling; the panel
                          // shows "Processing payment…" until the
                          // poll observes the writer commit.
                          const cents = Math.round(
                            parseFloat(invoice.balance || "0") * 100,
                          );
                          setPendingBalanceCents(cents);
                          setApplicationTimedOut(false);
                          setAwaitingApplication(true);
                          queryClient.invalidateQueries({
                            queryKey: invoiceQueryKey,
                          });
                        }}
                        onRetry={() => {
                          // Reset intent so the auto-create-intent
                          // useEffect re-mints. Useful when Stripe.js
                          // mounts the script but PaymentElement's
                          // iframe never reports onReady within 10s.
                          setIntent(null);
                          setIntentError(null);
                        }}
                      />
                    </Elements>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          </aside>
        )}
      </div>{/* /grid */}
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
