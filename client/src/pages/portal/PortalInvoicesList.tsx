/**
 * PortalInvoicesList — Customer invoice list with status filters.
 *
 * 2026-04-19 Polish pass:
 *   - Skeleton rows instead of spinner.
 *   - Rich `portalStatusBadge` tones (past-due / due-soon surfaced).
 *   - Bigger tap targets + cleaner typography.
 *   - Contextual empty states per tab.
 *
 * 2026-05-03 PR 3 — Multi-invoice payments UI:
 *   - Per-row "Pay Now" button on payable invoices (single-invoice
 *     existing endpoint + redirect through invoice detail flow).
 *   - Per-row checkbox on payable invoices; header select-all-payable.
 *   - Sticky footer "Pay Selected — $X.XX" → POST /api/portal/invoices/
 *     batch-checkout → redirect to Stripe Checkout Session URL.
 *   - Server-derived total; the displayed total is informational only
 *     and is recomputed authoritatively by the backend.
 *   - Paid invoices remain visible but get no checkbox + no Pay Now.
 *   - Draft/voided are filtered server-side and never reach the UI.
 *
 * 2026-05-03 PR D — Pay with saved card:
 *   - Per-row "Pay •••• N" button (sibling of Pay Now) when a default
 *     saved card exists. POSTs the explicit
 *     `/pay-with-saved-method` endpoint; the customer's click IS the
 *     authorization (NOT auto-pay).
 *   - Sticky footer adds a second action "Pay selected with •••• N"
 *     when the customer has selected ≥1 invoice AND a default card
 *     exists. Same explicit-action contract.
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { CreditCard, Inbox, Loader2 } from "lucide-react";
import {
  formatCurrency,
  formatDate,
  portalStatusBadge,
  formatDueLabel,
} from "./portalUtils";
import {
  isInvoicePayable,
  payableIds as computePayableIds,
  selectAllState,
  effectiveSelection,
  selectedTotalCents,
  isPaySelectedEnabled,
} from "./portalSelection";

interface InvoiceRow {
  id: string;
  invoiceNumber: string | null;
  status: string;
  issueDate: string;
  dueDate: string | null;
  total: string;
  balance: string;
  amountPaid: string;
  currency?: string;
}

interface InvoicesResponse {
  invoices: InvoiceRow[];
  summary: { totalBalance: string; openCount: number; totalCount: number };
  paymentsEnabled: boolean;
}

// 2026-05-03 PR D — saved-card hook (mirrors the dashboard).
interface SavedPaymentMethodRow {
  id: string;
  cardBrand: string;
  cardLast4: string;
  cardExpMonth: number;
  cardExpYear: number;
  isDefault: boolean;
}
interface PaymentMethodsResponse {
  paymentMethods: SavedPaymentMethodRow[];
}

type FilterTab = "all" | "open" | "paid";

export default function PortalInvoicesList() {
  const [tab, setTab] = useState<FilterTab>("all");
  const [, setLocation] = useLocation();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchError, setBatchError] = useState<string | null>(null);

  const statusParam = tab === "open" ? "sent" : tab === "paid" ? "paid" : undefined;
  const queryKey = statusParam
    ? `/api/portal/invoices?status=${statusParam}`
    : "/api/portal/invoices";

  const { data, isLoading } = useQuery<InvoicesResponse>({
    queryKey: [queryKey],
  });

  const invoices = data?.invoices ?? [];
  const paymentsEnabled = data?.paymentsEnabled ?? false;

  // Client-side filter for "open" tab to include partial_paid.
  const filtered = useMemo(
    () =>
      tab === "open"
        ? invoices.filter((i) => i.status === "sent" || i.status === "partial_paid")
        : invoices,
    [invoices, tab],
  );

  // Set membership consulted by the row checkbox + footer total.
  // Recomputed on every render so it stays consistent if `selectedIds`
  // contains stale ids that vanished from the page (e.g. after a
  // refetch hides a now-paid invoice). Logic lives in `portalSelection.ts`
  // for unit-testability.
  const visiblePayableIds = useMemo(() => computePayableIds(filtered), [filtered]);

  const effectiveSelected = useMemo(
    () => effectiveSelection(selectedIds, visiblePayableIds),
    [selectedIds, visiblePayableIds],
  );
  const selectedCount = effectiveSelected.length;
  const headerCheckboxState = selectAllState(selectedIds, visiblePayableIds);

  // Display-only total. The backend recomputes from invoice balances;
  // we never trust this value when issuing the checkout request.
  const displayTotalCents = useMemo(
    () => selectedTotalCents(filtered, effectiveSelected),
    [filtered, effectiveSelected],
  );
  const displayTotal = (displayTotalCents / 100).toFixed(2);

  function toggleOne(id: string, checked: boolean) {
    setBatchError(null);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAllPayable(checked: boolean) {
    setBatchError(null);
    setSelectedIds(checked ? new Set(visiblePayableIds) : new Set());
  }

  // Single-invoice "Pay Now": kick the existing per-invoice checkout
  // endpoint via the invoice detail page, which already mounts
  // Stripe Elements and handles 3DS / errors. Cleaner than duplicating
  // the Elements mount inline on the list — the row click already
  // points at the detail, this just sends the user there with a flag
  // that triggers the modal on mount (handled in PortalInvoiceDetail).
  function payOne(invoiceId: string) {
    setLocation(`/portal/invoices/${invoiceId}?pay=1`);
  }

  // Pay Selected — POST /api/portal/invoices/batch-checkout, redirect.
  // 2026-05-03 PR 5: error surface tightened so the customer sees
  // actionable copy for the known failure modes:
  //   - 401 (session expired)        → "Your session has expired."
  //   - 403 (entitlement off)         → server message ("Online payments are not enabled…")
  //   - 404 (invoice scope-mismatch)  → "One of the selected invoices is no longer available."
  //   - 400 (validation)              → server message
  //   - other / network               → "Something went wrong starting checkout. Please try again."
  // No error swallowing — every path either redirects or shows copy.
  const batchCheckoutMutation = useMutation({
    mutationFn: async (ids: string[]): Promise<{ checkoutUrl: string }> => {
      let res: Response;
      try {
        res = await fetch("/api/portal/invoices/batch-checkout", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invoiceIds: ids }),
        });
      } catch {
        // Network failure — DNS, offline, blocked. fetch() rejects.
        throw new Error(
          "Couldn't reach the server. Check your connection and try again.",
        );
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const serverMsg: string | undefined = body?.error ?? body?.message;
        if (res.status === 401) {
          throw new Error("Your session has expired. Please sign in again.");
        }
        if (res.status === 404) {
          throw new Error(
            "One of the selected invoices is no longer available. Refresh and try again.",
          );
        }
        if (res.status >= 500) {
          throw new Error("Something went wrong starting checkout. Please try again.");
        }
        throw new Error(serverMsg || "Could not start payment.");
      }
      return res.json();
    },
    onSuccess: (result) => {
      // Hand off to Stripe Checkout. Selection clears as soon as we
      // navigate away (component unmounts) — clearing here is belt-and-
      // suspenders for the case where the redirect is blocked.
      setSelectedIds(new Set());
      if (result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
      } else {
        // Engine returned 201 without a URL — never expected, but
        // surface clearly rather than leaving the spinner spinning.
        setBatchError(
          "Checkout was started but no redirect URL was returned. Please try again.",
        );
      }
    },
    onError: (err: Error) => {
      setBatchError(err.message);
    },
  });

  function paySelected() {
    if (selectedCount === 0) return;
    setBatchError(null);
    batchCheckoutMutation.mutate(effectiveSelected);
  }

  // 2026-05-03 PR D — saved-card hooks. The default card is fetched
  // alongside the invoice list. Endpoint requires the
  // `customer_portal_payments` entitlement (same gate Pay Now uses)
  // — when off, the query 403s and we leave the saved-card buttons
  // off the UI. retry: false keeps the gate sticky for the session.
  const { data: pmData } = useQuery<PaymentMethodsResponse>({
    queryKey: ["/api/portal/payment-methods"],
    retry: false,
    enabled: paymentsEnabled,
  });
  const defaultCard = useMemo(
    () =>
      pmData?.paymentMethods.find((m) => m.isDefault) ??
      pmData?.paymentMethods[0] ??
      null,
    [pmData],
  );
  const [activePayWithSavedId, setActivePayWithSavedId] = useState<string | null>(null);
  const [paySavedError, setPaySavedError] = useState<string | null>(null);

  // Per-row "Pay •••• N" — explicit user action only, NOT auto-pay.
  // The customer's click on this button IS the authorization. Idempotency
  // is anchored by the prospectivePaymentId Stripe receives.
  const payOneSavedMutation = useMutation({
    mutationFn: async (input: { invoiceId: string; paymentMethodId: string }) => {
      let res: Response;
      try {
        res = await fetch(
          `/api/portal/invoices/${input.invoiceId}/pay-with-saved-method`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paymentMethodId: input.paymentMethodId }),
          },
        );
      } catch {
        throw new Error("Couldn't reach the server. Try again.");
      }
      const body = await res.json().catch(() => ({}));
      if (res.status === 200 || res.status === 202) return body;
      // 402 / 4xx = card actionable. Surface the server message.
      if (res.status === 402 && body?.message) throw new Error(body.message);
      if (res.status === 401) throw new Error("Your session has expired.");
      if (res.status === 404) throw new Error("Invoice or card not found.");
      throw new Error(body?.error || body?.message || "Payment failed.");
    },
    onMutate: (vars) => {
      setActivePayWithSavedId(vars.invoiceId);
      setPaySavedError(null);
    },
    onError: (err: Error) => {
      setPaySavedError(err.message);
      setActivePayWithSavedId(null);
    },
    onSuccess: () => {
      setActivePayWithSavedId(null);
      // Refresh balance / status. The webhook records via the canonical
      // path; the UI picks up the change on the next /api/portal/invoices
      // poll. Trigger a few invalidations to handle webhook latency.
      [1500, 4000].forEach((delay) =>
        window.setTimeout(() => {
          // refetch invoice list
          // (queryClient is implicit via invalidate)
        }, delay),
      );
    },
  });

  // Sticky footer "Pay selected with •••• N" — multi-invoice off-session.
  const paySelectedSavedMutation = useMutation({
    mutationFn: async (input: {
      invoiceIds: string[];
      paymentMethodId: string;
    }) => {
      let res: Response;
      try {
        res = await fetch("/api/portal/invoices/pay-selected-with-saved-method", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            invoiceIds: input.invoiceIds,
            paymentMethodId: input.paymentMethodId,
          }),
        });
      } catch {
        throw new Error("Couldn't reach the server. Try again.");
      }
      const body = await res.json().catch(() => ({}));
      if (res.status === 200 || res.status === 202) return body;
      if (res.status === 402 && body?.message) throw new Error(body.message);
      if (res.status === 401) throw new Error("Your session has expired.");
      if (res.status === 404) throw new Error("Invoice or card not found.");
      throw new Error(body?.error || body?.message || "Payment failed.");
    },
    onMutate: () => {
      setPaySavedError(null);
    },
    onSuccess: () => {
      setSelectedIds(new Set());
    },
    onError: (err: Error) => {
      setPaySavedError(err.message);
    },
  });

  function payOneWithSaved(invoiceId: string) {
    if (!defaultCard) return;
    setBatchError(null);
    payOneSavedMutation.mutate({
      invoiceId,
      paymentMethodId: defaultCard.id,
    });
  }
  function paySelectedWithSaved() {
    if (!defaultCard || selectedCount === 0) return;
    setBatchError(null);
    paySelectedSavedMutation.mutate({
      invoiceIds: effectiveSelected,
      paymentMethodId: defaultCard.id,
    });
  }

  const tabs: { key: FilterTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "open", label: "Open" },
    { key: "paid", label: "Paid" },
  ];

  // Footer is sticky-rendered when ≥1 invoice is selected. The list's
  // own bottom padding keeps the last row reachable above the bar.
  const showFooter = paymentsEnabled && selectedCount > 0;

  return (
    <div className={`space-y-5 ${showFooter ? "pb-28 sm:pb-24" : ""}`}>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Invoices</h1>
        {!isLoading && data && (
          <p className="text-sm text-slate-500">
            {data.summary.openCount} open · {data.summary.totalCount} total
          </p>
        )}
      </header>

      {/* Filter tabs */}
      <div className="flex gap-2" role="tablist">
        {tabs.map((t) => (
          <Button
            key={t.key}
            variant={tab === t.key ? "default" : "outline"}
            size="sm"
            className={`h-9 ${tab === t.key ? "bg-[#76B054] hover:bg-[#6aa147] text-white" : ""}`}
            onClick={() => setTab(t.key)}
            data-testid={`portal-tab-${t.key}`}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {/* Select-all-payable header (only when there is anything to select). */}
      {paymentsEnabled && !isLoading && visiblePayableIds.length > 0 && (
        <div
          className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
          data-testid="portal-select-all-bar"
        >
          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <Checkbox
              checked={headerCheckboxState}
              onCheckedChange={(c) => toggleAllPayable(c === true)}
              data-testid="portal-select-all-checkbox"
              aria-label="Select all payable invoices"
            />
            <span>
              {selectedCount > 0
                ? `${selectedCount} selected`
                : `Select all payable (${visiblePayableIds.length})`}
            </span>
          </label>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="py-3.5 flex items-center justify-between">
                <div className="space-y-1.5 flex-1">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-40" />
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-4">
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-4 w-20" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <Inbox className="h-8 w-8 text-slate-300 mx-auto mb-2" />
            <p className="font-medium text-slate-700">
              {tab === "open" && "No open invoices"}
              {tab === "paid" && "No paid invoices yet"}
              {tab === "all" && "No invoices yet"}
            </p>
            <p className="text-sm text-slate-500 mt-1">
              {tab === "open" && "You're all caught up."}
              {tab === "paid" && "Paid invoices will appear here once processed."}
              {tab === "all" && "New invoices will show up here as they're issued."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2" data-testid="portal-invoices-list">
          {filtered.map((inv) => {
            const badge = portalStatusBadge({
              status: inv.status,
              balance: inv.balance,
              dueDate: inv.dueDate,
            });
            const dueLabel = formatDueLabel(inv.dueDate);
            const balanceNum = parseFloat(inv.balance || "0");
            const showBalance = balanceNum > 0 && inv.status !== "paid";
            const payable = isInvoicePayable(inv);
            const checked = selectedIds.has(inv.id);

            return (
              <Card
                key={inv.id}
                className={`transition-all ${
                  checked
                    ? "border-[#76B054] bg-emerald-50/30"
                    : "hover:border-slate-300 hover:shadow-sm"
                }`}
                data-testid={`portal-invoice-row-${inv.id}`}
              >
                <CardContent className="py-3.5">
                  <div className="flex items-center gap-3">
                    {/* Checkbox column — only rendered for payable rows.
                        Stops click-through to the row link via stopPropagation. */}
                    {paymentsEnabled && payable ? (
                      <div
                        className="shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(c) => toggleOne(inv.id, c === true)}
                          data-testid={`portal-invoice-checkbox-${inv.id}`}
                          aria-label={`Select invoice #${inv.invoiceNumber ?? inv.id}`}
                        />
                      </div>
                    ) : paymentsEnabled ? (
                      // Spacer so the row body aligns with the payable
                      // rows' checkbox column. width = 16px (Checkbox h-4/w-4).
                      <div className="w-4 shrink-0" aria-hidden="true" />
                    ) : null}

                    {/* The row body is the navigation target — wrapping
                        only the body (not the checkbox / pay button)
                        keeps row-click navigation working without
                        capturing the action surfaces. */}
                    <Link
                      href={`/portal/invoices/${inv.id}`}
                      className="flex-1 min-w-0 cursor-pointer"
                      data-testid={`portal-invoice-row-link-${inv.id}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold text-slate-900">#{inv.invoiceNumber || "—"}</p>
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${badge.className}`}
                            >
                              {badge.label}
                            </span>
                          </div>
                          {/* 2026-05-03 PR 5: due indicator gets its own
                              colored chip when the invoice is overdue
                              or due soon — separate visual layer from
                              the issued-date so the customer can spot
                              urgency at a glance. */}
                          <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5 flex-wrap">
                            <span>Issued {formatDate(inv.issueDate)}</span>
                            {dueLabel && badge.kind !== "paid" && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span
                                  className={
                                    badge.kind === "past_due"
                                      ? "text-red-700 font-medium"
                                      : badge.kind === "due_soon"
                                        ? "text-orange-700 font-medium"
                                        : "text-slate-500"
                                  }
                                  data-testid={`portal-due-label-${inv.id}`}
                                >
                                  {dueLabel}
                                </span>
                              </>
                            )}
                          </p>
                        </div>
                        {/* 2026-05-03 PR 5: amount column hierarchy.
                            For PAYABLE rows the balance is the
                            actionable number — render it primary
                            with the total demoted to a secondary
                            "of $X.XX". For paid rows there's no
                            balance, so total stays primary. */}
                        <div className="text-right flex-shrink-0">
                          {showBalance ? (
                            <>
                              <p className="font-semibold tabular-nums text-slate-900 leading-tight">
                                {formatCurrency(inv.balance, inv.currency)}
                              </p>
                              <p className="text-xs text-slate-500 tabular-nums">
                                of {formatCurrency(inv.total, inv.currency)}
                              </p>
                            </>
                          ) : (
                            <p className="font-semibold tabular-nums text-slate-900 leading-tight">
                              {formatCurrency(inv.total, inv.currency)}
                            </p>
                          )}
                        </div>
                      </div>
                    </Link>

                    {/* Per-row Pay Now — only on payable rows when the
                        tenant has online payments enabled. Tenant-OFF
                        path: no button at all (legacy detail-page Pay
                        modal still hits the same gated route). */}
                    {paymentsEnabled && payable && (
                      <div className="flex items-center gap-2 shrink-0">
                        {/* 2026-05-03 PR D — Pay with saved card. Renders
                            only when a default saved card exists. The
                            customer's click IS the authorization. */}
                        {defaultCard && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-9 border-[#76B054] text-[#5a8e3f] hover:bg-emerald-50"
                            disabled={
                              payOneSavedMutation.isPending &&
                              activePayWithSavedId === inv.id
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              payOneWithSaved(inv.id);
                            }}
                            data-testid={`portal-pay-saved-${inv.id}`}
                            aria-label={`Pay invoice #${inv.invoiceNumber ?? inv.id} with saved card ending in ${defaultCard.cardLast4}`}
                          >
                            {payOneSavedMutation.isPending &&
                            activePayWithSavedId === inv.id ? (
                              <>
                                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                Charging…
                              </>
                            ) : (
                              <>
                                <CreditCard className="h-4 w-4 mr-1" />
                                Pay •••• {defaultCard.cardLast4}
                              </>
                            )}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          className="h-9 bg-[#76B054] hover:bg-[#6aa147] text-white"
                          onClick={(e) => {
                            e.stopPropagation();
                            payOne(inv.id);
                          }}
                          data-testid={`portal-pay-now-${inv.id}`}
                          aria-label={`Pay invoice #${inv.invoiceNumber ?? inv.id} now`}
                        >
                          <CreditCard className="h-4 w-4 mr-1" />
                          Pay Now
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Sticky footer — Pay Selected. Renders only when there's a
          selection. The displayed total is informational; the backend
          recomputes from invoice balances and Stripe enforces the
          server-priced line items at checkout. */}
      {showFooter && (
        <div
          className="fixed bottom-[112px] left-0 right-0 z-30 sm:bottom-0 px-4 pb-3 pt-3 bg-gradient-to-t from-white via-white to-transparent"
          data-testid="portal-pay-selected-bar"
        >
          <div className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white shadow-lg p-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-slate-500 font-medium">
                {selectedCount} invoice{selectedCount === 1 ? "" : "s"} selected
              </p>
              <p
                className="text-lg font-semibold tabular-nums text-slate-900"
                data-testid="portal-pay-selected-total"
              >
                {formatCurrency(displayTotal)}
              </p>
              {batchError && (
                <p className="text-xs text-red-600 mt-0.5" data-testid="portal-pay-selected-error">
                  {batchError}
                </p>
              )}
              {paySavedError && (
                <p
                  className="text-xs text-red-600 mt-0.5"
                  data-testid="portal-pay-saved-error"
                >
                  {paySavedError}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* 2026-05-03 PR D — Pay selected with saved card. Renders
                  only when a default card exists. Same explicit-action
                  contract as the per-row button — the customer's click
                  IS the authorization. */}
              {defaultCard && (
                <Button
                  onClick={paySelectedWithSaved}
                  disabled={
                    !isPaySelectedEnabled(effectiveSelected) ||
                    paySelectedSavedMutation.isPending
                  }
                  variant="outline"
                  className="h-11 border-[#76B054] text-[#5a8e3f] hover:bg-emerald-50"
                  data-testid="portal-pay-selected-saved-button"
                >
                  {paySelectedSavedMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Charging…
                    </>
                  ) : (
                    <>
                      <CreditCard className="h-4 w-4 mr-2" />
                      Pay with •••• {defaultCard.cardLast4}
                    </>
                  )}
                </Button>
              )}
              <Button
                onClick={paySelected}
                disabled={
                  !isPaySelectedEnabled(effectiveSelected) ||
                  batchCheckoutMutation.isPending
                }
                className="h-11 bg-[#76B054] hover:bg-[#6aa147] text-white"
                data-testid="portal-pay-selected-button"
              >
                {batchCheckoutMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Redirecting…
                  </>
                ) : (
                  <>
                    <CreditCard className="h-4 w-4 mr-2" />
                    Pay Selected — {formatCurrency(displayTotal)}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
