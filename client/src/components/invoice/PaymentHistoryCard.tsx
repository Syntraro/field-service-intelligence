/**
 * PaymentHistoryCard (2026-04-18 Phase 10 — payments clarity)
 *
 * Canonical payment-history surface for Invoice Detail. Renders the
 * already-fetched `payments` array with distinct rows for payment /
 * refund / reversal, clear signed amounts, method + provider hints,
 * and the parent payment reference for refund/reversal children.
 *
 * Data source:
 *   GET /api/invoices/:invoiceId/payments (already fetched on
 *   InvoiceDetailPage; this component consumes the cached result).
 *
 * No mutations live here — create/delete flows remain on the parent
 * page so the canonical `recalculateInvoiceBalance` tx path isn't
 * bypassed.
 */
import { format } from "date-fns";
import {
  Receipt, Undo2, CornerUpLeft, CreditCard, Banknote, Building2, Mail,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/formatters";

export interface PaymentHistoryRow {
  id: string;
  amount: string;
  method: string;
  reference: string | null;
  receivedAt: string;
  notes: string | null;
  paymentType: "payment" | "refund" | "reversal" | string;
  parentPaymentId: string | null;
  providerSource: "manual" | "stripe" | "qbo" | string;
  qboPaymentId?: string | null;
}

interface PaymentHistoryCardProps {
  payments: PaymentHistoryRow[];
  isLoading?: boolean;
}

function methodIcon(method: string) {
  const m = method.toLowerCase();
  if (m === "cash") return <Banknote className="h-3 w-3" />;
  if (m === "cheque" || m === "check") return <Mail className="h-3 w-3" />;
  if (m === "credit" || m === "debit") return <CreditCard className="h-3 w-3" />;
  return <Building2 className="h-3 w-3" />;
}

function typeMeta(paymentType: string): {
  label: string;
  icon: React.ReactNode;
  tone: "default" | "refund" | "reversal";
} {
  if (paymentType === "refund") {
    return { label: "Refund", icon: <Undo2 className="h-3 w-3" />, tone: "refund" };
  }
  if (paymentType === "reversal") {
    return { label: "Reversal", icon: <CornerUpLeft className="h-3 w-3" />, tone: "reversal" };
  }
  return { label: "Payment", icon: <Receipt className="h-3 w-3" />, tone: "default" };
}

function providerBadge(providerSource: string, qboPaymentId?: string | null) {
  // Show a provider chip only for non-manual rows so the common case
  // (office-entered cash/cheque) stays uncluttered.
  if (providerSource === "stripe") {
    return (
      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-violet-300 text-violet-700 bg-violet-50">
        Stripe
      </Badge>
    );
  }
  if (providerSource === "qbo" || qboPaymentId) {
    return (
      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-sky-300 text-sky-700 bg-sky-50">
        QuickBooks
      </Badge>
    );
  }
  return null;
}

export function PaymentHistoryCard({ payments, isLoading }: PaymentHistoryCardProps) {
  // Order newest-first by receivedAt.
  const sorted = [...payments].sort(
    (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
  );

  return (
    <Card data-testid="card-payment-history">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Receipt className="h-4 w-4 text-muted-foreground" />
          Payment History
          {payments.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              ({payments.length})
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : sorted.length === 0 ? (
          <p className="text-xs text-muted-foreground" data-testid="empty-payment-history">
            No payments recorded yet.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {sorted.map((p) => {
              const meta = typeMeta(p.paymentType);
              const amountNum = parseFloat(p.amount || "0");
              // Display amount with an explicit sign for refund/reversal —
              // the stored value is already signed (negative) on those rows,
              // so formatCurrency will render the minus on its own; we just
              // tone the number to signal AR direction.
              const toneClass =
                meta.tone === "refund"
                  ? "text-red-700"
                  : meta.tone === "reversal"
                    ? "text-amber-700"
                    : "text-slate-900";
              return (
                <div
                  key={p.id}
                  className="py-2 text-xs flex items-start gap-2"
                  data-testid={`payment-row-${p.id}`}
                >
                  <div className={cn(
                    "mt-0.5 shrink-0 rounded p-1",
                    meta.tone === "refund" ? "bg-red-50 text-red-700"
                    : meta.tone === "reversal" ? "bg-amber-50 text-amber-700"
                    : "bg-emerald-50 text-emerald-700",
                  )}>
                    {meta.icon}
                  </div>
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-slate-900">{meta.label}</span>
                      {providerBadge(p.providerSource, p.qboPaymentId)}
                      <span className={cn("ml-auto font-semibold tabular-nums", toneClass)}>
                        {formatCurrency(amountNum)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        {methodIcon(p.method)}
                        <span className="capitalize">{p.method.replace(/_/g, " ")}</span>
                      </span>
                      <span>·</span>
                      <span>{format(new Date(p.receivedAt), "MMM d, yyyy")}</span>
                      {p.reference && (
                        <>
                          <span>·</span>
                          <span className="truncate" title={p.reference}>
                            {p.reference}
                          </span>
                        </>
                      )}
                    </div>
                    {p.notes && (
                      <p className="text-[11px] text-slate-500 whitespace-pre-wrap">{p.notes}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
