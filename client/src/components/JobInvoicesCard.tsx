/**
 * JobInvoicesCard (2026-04-18 Phase 6 — multi-invoice usability)
 *
 * Right-rail card on the Job Detail page that surfaces every invoice
 * linked to the job. Replaces the pre-Phase-6 "singular primary only"
 * UX where a job could only show one invoice.
 *
 * Read path:
 *   GET /api/invoices/list?jobId=<jobId>  (canonical plural feed)
 *
 * Affordances:
 *   - Row per invoice, ordered newest-first (server-side sort).
 *   - Primary badge on the one pointed to by `jobs.invoiceId`.
 *   - Status pill (via canonical getInvoiceStatusBadge).
 *   - Row click opens the invoice in the full invoice detail page.
 *   - "Set as Primary" action on non-primary rows.
 *   - "Create Invoice" button at bottom (same modal the command bar uses).
 *   - Empty state (no invoices yet) shows a single Create Invoice button.
 *
 * Kept intentionally small — this is a list surface, not an invoice
 * editor. No line-item / payment detail is pulled here.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueries } from "@tanstack/react-query";
import { Link } from "wouter";
import { format } from "date-fns";
import { Receipt, Star, Loader2, Plus, Undo2, CornerUpLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getInvoiceStatusBadge } from "@/lib/statusBadges";
import { formatCurrency } from "@/lib/formatters";

interface InvoiceRow {
  id: string;
  invoiceNumber: string | null;
  status: string;
  issueDate: string | null;
  dueDate: string | null;
  total: string | null;
  amountPaid: string | null;
  balance: string | null;
  jobId: string | null;
  isPastDue?: boolean;
}

interface FeedResponse {
  data: InvoiceRow[];
  hasMore?: boolean;
}

interface JobInvoicesCardProps {
  jobId: string;
  /** The job's current primary invoice pointer (jobs.invoiceId). */
  primaryInvoiceId: string | null;
  /** Callback for opening the Create Invoice dialog (owned by parent). */
  onCreateInvoice?: () => void;
  /** Controls whether the Create Invoice CTA is visible. Hidden on
   *  non-billable states (e.g., archived jobs) by the parent. */
  canCreate?: boolean;
}

export function JobInvoicesCard({
  jobId,
  primaryInvoiceId,
  onCreateInvoice,
  canCreate = true,
}: JobInvoicesCardProps) {
  const { toast } = useToast();
  const [pendingPrimaryId, setPendingPrimaryId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<FeedResponse>({
    queryKey: ["invoices", "list", { jobId }],
    queryFn: async () => {
      const res = await fetch(
        `/api/invoices/list?jobId=${encodeURIComponent(jobId)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load invoices");
      return res.json();
    },
    enabled: !!jobId,
    staleTime: 30_000,
  });

  const invoices = useMemo(() => {
    const rows = Array.isArray(data?.data) ? data!.data : [];
    // Server already sorts issueDate desc, createdAt desc (via feed).
    // Pin the primary to the top regardless of date so "Primary" is
    // always the first row the user sees.
    if (!primaryInvoiceId) return rows;
    const primary = rows.find((r) => r.id === primaryInvoiceId);
    if (!primary) return rows;
    return [primary, ...rows.filter((r) => r.id !== primaryInvoiceId)];
  }, [data, primaryInvoiceId]);

  // 2026-04-18 Phase 7: empty-primary state.
  // True when invoices exist on the job but `jobs.invoiceId` is NULL
  // (e.g. the primary was deleted and no explicit reassignment has
  // happened yet). Per product rule there is no automatic promotion —
  // this card shows a nudge so the user sets a new primary manually.
  const hasInvoicesButNoPrimary =
    invoices.length > 0 && !primaryInvoiceId;

  // 2026-04-18 Phase 9 (collections visibility): job-level billing
  // roll-up computed purely from the plural feed response. No extra
  // query, no new storage method — the canonical feed already carries
  // total / amountPaid / balance / isPastDue per row, which is all we
  // need for a roll-up summary. Money math is done in integer cents
  // to avoid float drift when summing many rows.
  const billingTotals = useMemo(() => {
    let invoicedCents = 0;
    let paidCents = 0;
    let outstandingCents = 0;
    let overdueCount = 0;
    for (const inv of invoices) {
      invoicedCents += Math.round(parseFloat(inv.total ?? "0") * 100);
      paidCents += Math.round(parseFloat(inv.amountPaid ?? "0") * 100);
      outstandingCents += Math.round(parseFloat(inv.balance ?? "0") * 100);
      if (inv.isPastDue) overdueCount += 1;
    }
    return {
      invoiced: (invoicedCents / 100).toFixed(2),
      paid: (paidCents / 100).toFixed(2),
      outstanding: (outstandingCents / 100).toFixed(2),
      overdueCount,
    };
  }, [invoices]);

  // 2026-04-18 Phase 10 (payments clarity): aggregate payments across
  // every invoice on the job so the user can see the job-level payment
  // stream in one place. Done client-side via parallel per-invoice
  // fetches so we reuse the canonical `/api/invoices/:id/payments`
  // route and don't introduce a new backend roll-up path. Typical job
  // has 1–3 invoices, so the bounded parallel fetch is cheap and the
  // query cache is shared with Invoice Detail (same key).
  const paymentQueries = useQueries({
    queries: invoices.map((inv) => ({
      queryKey: ["invoices", "detail", inv.id, "payments"],
      queryFn: async () => {
        const res = await fetch(`/api/invoices/${inv.id}/payments`, {
          credentials: "include",
        });
        if (!res.ok) return [];
        return res.json();
      },
      staleTime: 30_000,
      enabled: !!inv.id,
    })),
  });

  const recentPayments = useMemo(() => {
    const all: Array<{
      id: string;
      amount: string;
      method: string;
      receivedAt: string;
      paymentType: string;
      providerSource: string;
      invoiceId: string;
      invoiceNumber: string | null;
    }> = [];
    paymentQueries.forEach((q, idx) => {
      const rows = Array.isArray(q.data) ? q.data : [];
      const inv = invoices[idx];
      if (!inv) return;
      for (const p of rows) {
        all.push({
          id: p.id,
          amount: p.amount,
          method: p.method,
          receivedAt: p.receivedAt,
          paymentType: p.paymentType ?? "payment",
          providerSource: p.providerSource ?? "manual",
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
        });
      }
    });
    all.sort(
      (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
    );
    return all.slice(0, 5);
  }, [paymentQueries, invoices]);

  const paymentsLoading = paymentQueries.some((q) => q.isLoading);

  const setPrimaryMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      setPendingPrimaryId(invoiceId);
      try {
        return await apiRequest<{ jobId: string; primaryInvoiceId: string }>(
          `/api/invoices/${invoiceId}/set-primary`,
          { method: "POST" },
        );
      } finally {
        setPendingPrimaryId(null);
      }
    },
    onSuccess: () => {
      // Primary pointer lives on `jobs.invoiceId`; invalidate the job
      // header + billing-sensitive queries so the UI picks up the
      // new primary on next render.
      queryClient.invalidateQueries({ queryKey: ["jobs", "detail", jobId] });
      queryClient.invalidateQueries({ queryKey: ["invoices", "byJob", jobId] });
      queryClient.invalidateQueries({ queryKey: ["invoices", "list", { jobId }] });
      toast({ title: "Primary invoice updated" });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to update primary",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const header = (
    <div className="w-full flex items-center justify-between px-4 py-2.5 bg-[#f8fafc]">
      <span className="text-sm font-semibold text-[#0f172a] flex items-center gap-2">
        <Receipt className="h-4 w-4 text-[#64748b]" />
        Invoices{invoices.length > 0 ? ` (${invoices.length})` : ""}
      </span>
    </div>
  );

  return (
    <div
      className="bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden"
      data-testid="section-job-invoices"
    >
      {header}
      <div className="border-t border-slate-200">
        {isLoading ? (
          <div className="px-4 py-3 text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading invoices…
          </div>
        ) : invoices.length === 0 ? (
          <div className="px-4 py-4 text-center" data-testid="empty-invoices">
            <Receipt className="h-5 w-5 mx-auto mb-1.5 text-slate-300" />
            <p className="text-xs text-muted-foreground mb-2">No invoices yet</p>
            {canCreate && onCreateInvoice && (
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-7"
                onClick={onCreateInvoice}
                data-testid="button-create-invoice-empty"
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> Create Invoice
              </Button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {hasInvoicesButNoPrimary && (
              <div
                className="px-4 py-2 bg-amber-50/60 border-b border-amber-100 text-[11px] text-amber-800"
                data-testid="empty-primary-hint"
              >
                No primary invoice set. Use <span className="font-medium">Set Primary</span> below to choose one.
              </div>
            )}
            {invoices.map((inv) => {
              const isPrimary = inv.id === primaryInvoiceId;
              // 2026-04-18 Phase 9: pass dueDate so "Due Soon" surfaces
              // for awaiting-payment invoices within the 7-day window.
              const statusInfo = getInvoiceStatusBadge(
                inv.status,
                inv.isPastDue ?? false,
                inv.dueDate,
              );
              const isSettingThis = pendingPrimaryId === inv.id;
              return (
                <div
                  key={inv.id}
                  className="px-4 py-2.5 flex items-center gap-2"
                  data-testid={`invoice-row-${inv.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <Link
                        href={`/invoices/${inv.id}`}
                        className="text-sm font-semibold text-primary hover:underline truncate"
                        data-testid={`link-invoice-${inv.id}`}
                      >
                        {inv.invoiceNumber ?? "—"}
                      </Link>
                      {isPrimary && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0 gap-0.5 bg-amber-50 text-amber-700 border-amber-200"
                          data-testid={`primary-badge-${inv.id}`}
                        >
                          <Star className="h-2.5 w-2.5 fill-amber-500 text-amber-500" />
                          Primary
                        </Badge>
                      )}
                      <Badge
                        variant={statusInfo.variant}
                        className="text-[10px] px-1.5 py-0"
                      >
                        {statusInfo.label}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {inv.issueDate && (
                        <span>{format(new Date(inv.issueDate), "MMM d, yyyy")}</span>
                      )}
                      {inv.total != null && (
                        <span className="tabular-nums">
                          ${Number(inv.total).toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>
                  {!isPrimary && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs h-7 px-2 text-slate-500 hover:text-slate-900"
                      disabled={isSettingThis || setPrimaryMutation.isPending}
                      onClick={() => setPrimaryMutation.mutate(inv.id)}
                      data-testid={`button-set-primary-${inv.id}`}
                    >
                      {isSettingThis ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <>
                          <Star className="h-3 w-3 mr-1" />
                          Set Primary
                        </>
                      )}
                    </Button>
                  )}
                </div>
              );
            })}
            {invoices.length > 0 && (
              <div
                className="px-4 py-2.5 bg-slate-50/50 text-xs space-y-1"
                data-testid="job-invoices-totals"
              >
                <div className="flex items-center justify-between text-slate-600">
                  <span>Invoiced</span>
                  <span className="tabular-nums text-slate-900 font-medium">${billingTotals.invoiced}</span>
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span>Paid</span>
                  <span className="tabular-nums text-slate-900 font-medium">${billingTotals.paid}</span>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-slate-200">
                  <span className="font-semibold text-slate-900">Outstanding</span>
                  <span
                    className={`tabular-nums font-bold ${
                      parseFloat(billingTotals.outstanding) > 0 ? "text-amber-700" : "text-slate-900"
                    }`}
                    data-testid="job-invoices-outstanding"
                  >
                    ${billingTotals.outstanding}
                  </span>
                </div>
                {billingTotals.overdueCount > 0 && (
                  <div
                    className="flex items-center gap-1.5 pt-1 text-[11px] text-red-700"
                    data-testid="job-invoices-overdue"
                  >
                    <span className="inline-flex items-center rounded bg-red-50 px-1.5 py-0.5 font-medium">
                      {billingTotals.overdueCount} overdue
                    </span>
                    <span className="text-muted-foreground">
                      {billingTotals.overdueCount === 1 ? "invoice is" : "invoices are"} past due
                    </span>
                  </div>
                )}
              </div>
            )}
            {/* 2026-04-18 Phase 10: Recent Payments — aggregated stream
                across every invoice on this job. Shows top 5 newest
                payments (incl. refund/reversal) with signed amount +
                invoice number so the user has a single job-level view
                of what's been collected without opening each invoice. */}
            {(paymentsLoading || recentPayments.length > 0) && (
              <div
                className="px-4 py-2.5 bg-slate-50/30 border-t border-slate-200"
                data-testid="job-recent-payments"
              >
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
                  Recent Payments
                </div>
                {paymentsLoading && recentPayments.length === 0 ? (
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading payments…
                  </div>
                ) : (
                  <div className="space-y-1">
                    {recentPayments.map((p) => {
                      const isRefund = p.paymentType === "refund";
                      const isReversal = p.paymentType === "reversal";
                      const toneClass = isRefund
                        ? "text-red-700"
                        : isReversal
                          ? "text-amber-700"
                          : "text-emerald-700";
                      const Icon = isRefund
                        ? Undo2
                        : isReversal
                          ? CornerUpLeft
                          : Receipt;
                      const amountNum = parseFloat(p.amount || "0");
                      return (
                        <div
                          key={p.id}
                          className="flex items-center gap-1.5 text-[11px]"
                          data-testid={`job-recent-payment-${p.id}`}
                        >
                          <Icon className={`h-3 w-3 ${toneClass}`} />
                          <span className={`font-medium tabular-nums ${toneClass}`}>
                            {formatCurrency(amountNum)}
                          </span>
                          <span className="text-muted-foreground">·</span>
                          <span className="capitalize text-slate-600">
                            {p.method.replace(/_/g, " ")}
                          </span>
                          <span className="text-muted-foreground">·</span>
                          <span className="text-muted-foreground">
                            {format(new Date(p.receivedAt), "MMM d")}
                          </span>
                          <Link
                            href={`/invoices/${p.invoiceId}`}
                            className="ml-auto text-primary hover:underline truncate"
                            data-testid={`job-recent-payment-link-${p.id}`}
                          >
                            {p.invoiceNumber ?? "—"}
                          </Link>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {canCreate && onCreateInvoice && (
              <div className="px-4 py-2.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7 w-full"
                  onClick={onCreateInvoice}
                  data-testid="button-create-invoice-list"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Create Another Invoice
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
