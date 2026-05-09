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
 *
 * Phase 3 RailContentCard adoption (2026-05-08): replaced shadcn
 * Card/CardHeader/CardContent/CardTitle with canonical RailContentCard
 * family. Provider badges migrated from ad-hoc outline Badge color
 * triplets to RailContentCardChip. Typography normalized to canonical
 * role tokens throughout (text-xs / text-[10px] / text-[11px] /
 * text-slate-* removed). Row layout DOM is unchanged — rows are
 * static/non-clickable so neither RailContentCardSubrow nor
 * RailContentCardField applies.
 */
import { format } from "date-fns";
import {
  Receipt, Undo2, CornerUpLeft, CreditCard, Banknote, Building2, Mail,
} from "lucide-react";
import {
  RailContentCard,
  RailContentCardHeader,
  RailContentCardTitle,
  RailContentCardMeta,
  RailContentCardChip,
} from "@/components/detail-rail/RailContentCard";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/formatters";
// 2026-04-29 Stripe completion: refund-affordance visibility helper.
// Pure logic shared with the regression test suite — UX hint only;
// server-side `assertRefundAmountWithinParent` is authoritative.
import { isPaymentRefundable } from "@shared/paymentRefundability";

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
  /**
   * 2026-04-29 Stripe completion: per-row refund initiator. When provided,
   * a Refund action button renders on each `paymentType='payment'` parent
   * row that still has remaining refundable amount (parent amount minus
   * sum of |child amounts|). Visibility is computed locally for UX only;
   * server `assertRefundAmountWithinParent` is authoritative on the cap.
   *
   * Omit to render history read-only (e.g., portal context).
   */
  onRefund?: (payment: PaymentHistoryRow) => void;
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

// 2026-05-08 Phase 3: migrated from ad-hoc outline Badge color triplets
// (text-[10px] px-1.5 py-0 border-*-300 text-*-700 bg-*-50) to the
// canonical RailContentCardChip. Stripe → purple, QBO → info.
function providerBadge(providerSource: string, qboPaymentId?: string | null) {
  // Show a provider chip only for non-manual rows so the common case
  // (office-entered cash/cheque) stays uncluttered.
  if (providerSource === "stripe") {
    return <RailContentCardChip variant="purple">Stripe</RailContentCardChip>;
  }
  if (providerSource === "qbo" || qboPaymentId) {
    return <RailContentCardChip variant="info">QuickBooks</RailContentCardChip>;
  }
  return null;
}

export function PaymentHistoryCard({ payments, isLoading, onRefund }: PaymentHistoryCardProps) {
  // Order newest-first by receivedAt.
  const sorted = [...payments].sort(
    (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
  );

  // 2026-04-29 Stripe completion: refund-button visibility delegates to
  // the canonical shared helper so the rule lives in one testable place.
  const isRefundable = (row: PaymentHistoryRow): boolean =>
    isPaymentRefundable(row, payments);

  return (
    <RailContentCard testId="card-payment-history">
      <RailContentCardHeader>
        <RailContentCardTitle as="h4" className="flex items-center gap-2">
          <Receipt className="h-4 w-4 text-muted-foreground shrink-0" />
          Payment History
          {payments.length > 0 && (
            <span className="text-helper font-normal text-muted-foreground">
              ({payments.length})
            </span>
          )}
        </RailContentCardTitle>
      </RailContentCardHeader>

      {isLoading ? (
        <RailContentCardMeta className="mt-2">Loading…</RailContentCardMeta>
      ) : sorted.length === 0 ? (
        <RailContentCardMeta className="mt-2" data-testid="empty-payment-history">
          No payments recorded yet.
        </RailContentCardMeta>
      ) : (
        <div className="divide-y divide-slate-100 mt-2">
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
                  : "text-text-primary";
            return (
              <div
                key={p.id}
                className="py-2 flex items-start gap-2"
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
                    <span className="text-helper font-medium text-text-primary">{meta.label}</span>
                    {providerBadge(p.providerSource, p.qboPaymentId)}
                    <span className={cn("ml-auto text-helper font-semibold tabular-nums", toneClass)}>
                      {formatCurrency(amountNum)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-helper text-muted-foreground">
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
                    <p className="text-helper text-text-secondary whitespace-pre-wrap">{p.notes}</p>
                  )}
                  {/* 2026-04-29 Stripe completion: refund affordance.
                      Only renders for parent payments with remaining
                      refundable amount; the dialog enforces the rest. */}
                  {onRefund && isRefundable(p) && (
                    <div className="pt-0.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-helper text-rose-700 hover:text-rose-900 hover:bg-rose-50"
                        onClick={() => onRefund(p)}
                        data-testid={`button-refund-${p.id}`}
                      >
                        <Undo2 className="h-3 w-3 mr-1" />
                        Refund
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </RailContentCard>
  );
}
