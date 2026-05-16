/**
 * RefundPaymentDialog (2026-04-29 Stripe completion)
 *
 * Staff-facing refund initiation surface. Calls the canonical refund
 * endpoint:
 *
 *   POST /api/payments/:id/refund
 *
 * The application service (`paymentApplicationService.refundPayment`)
 * is the sole authority for:
 *   - cap-check (refund must not exceed remaining refundable amount)
 *   - provider routing (manual → ledger-only; stripe → provider call
 *     with deterministic idempotency key, then ledger insert)
 *   - the H2 reconciliation-pending result when the provider succeeds
 *     but the local ledger insert fails for a non-unique reason
 *
 * This dialog does NOT recompute caps locally beyond a thin
 * client-side guard for UX (preventing the submit button from firing
 * when the form is obviously invalid). The server is authoritative.
 *
 * Architectural notes:
 *   - No local refund row is ever written from the frontend. The
 *     server-side `paymentRepository.createRefund` is the only writer.
 *   - The 202 (`reconciliation_pending`) path is rendered distinctly:
 *     the user sees "refund issued — reconciliation pending" without
 *     a retry CTA, because retrying with the same arguments would
 *     route through the same Stripe idempotency key (a no-op at the
 *     provider).
 *   - Submit is debounced by `disabled={mutation.isPending}` AND a
 *     local `submitted` flag so a fast double-click cannot fire two
 *     POSTs even before TanStack Query updates `isPending`.
 */

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Undo2, Clock3, AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
  ModalFooter,
} from "@/components/ui/modal";
import {
  InlineInput,
  InlineSelectTrigger,
  InlineTextarea,
  FormField,
  FormErrorText,
  FormHelperText,
} from "@/components/ui/form-field";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/formatters";
import { receivablesKeys } from "@/lib/receivablesQueryKeys";

interface RefundPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The PARENT payment row being refunded (must be paymentType='payment'). */
  payment: {
    id: string;
    amount: string;
    method: string;
    reference: string | null;
    providerSource: "manual" | "stripe" | "qbo" | string;
  };
  /** Amount already refunded/reversed on this parent (sum of |child amounts|). */
  alreadyOffset: number;
  /** Currency for display only. The server stores no currency on payments today. */
  currency?: string;
  /** Query keys to invalidate after success / 202. */
  invoiceQueryKey: unknown[];
  paymentsQueryKey: unknown[];
}

type RefundResult =
  | {
      kind: "settled";
      // Shape mirrors `paymentRepository.createRefund` return — Payment row.
      // We render only the amount + reference for confirmation.
      id: string;
      amount: string;
      reference: string | null;
    }
  | {
      kind: "reconciliation_pending";
      refundLedgerId: string;
      providerRefundId: string;
      providerSource: "stripe";
    };

export function RefundPaymentDialog({
  open,
  onOpenChange,
  payment,
  alreadyOffset,
  currency = "USD",
  invoiceQueryKey,
  paymentsQueryKey,
}: RefundPaymentDialogProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const parentAmount = parseFloat(payment.amount || "0");
  const remainingRefundable = Math.max(0, parentAmount - alreadyOffset);
  const remainingStr = remainingRefundable.toFixed(2);

  const [amount, setAmount] = useState<string>(remainingStr);
  const [reason, setReason] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [methodOverride, setMethodOverride] = useState<string>("");
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<RefundResult | null>(null);

  const isStripeLinked = payment.providerSource === "stripe";

  // Reset form on open. Default amount = full remaining refundable.
  useEffect(() => {
    if (!open) return;
    setAmount(remainingStr);
    setReason("");
    setNotes("");
    setMethodOverride("");
    setSubmitted(false);
    setResult(null);
  }, [open, remainingStr]);

  const refundMutation = useMutation({
    mutationFn: async (): Promise<RefundResult> => {
      // The server returns either 201 (the ledger row) or 202 (the
      // reconciliation_pending body). `apiRequest` returns the parsed
      // JSON for both; we discriminate on the `kind`/`status` fields.
      const body: Record<string, unknown> = { amount };
      if (reason.trim()) body.reason = reason.trim();
      if (notes.trim()) body.notes = notes.trim();
      if (methodOverride && !isStripeLinked) body.method = methodOverride;

      const res = await apiRequest<unknown>(`/api/payments/${payment.id}/refund`, {
        method: "POST",
        body: JSON.stringify(body),
      });

      // Normalize either response shape into our local discriminated union.
      const r = res as Record<string, unknown>;
      if (r && r["status"] === "reconciliation_pending") {
        return {
          kind: "reconciliation_pending",
          refundLedgerId: String(r["refundLedgerId"] ?? ""),
          providerRefundId: String(r["providerRefundId"] ?? ""),
          providerSource: "stripe",
        };
      }
      // 201 settled — full payment row
      const refundRow = res as { id: string; amount: string; reference: string | null };
      return {
        kind: "settled",
        id: refundRow.id,
        amount: refundRow.amount,
        reference: refundRow.reference,
      };
    },
    onSuccess: (r) => {
      setResult(r);
      // Always invalidate — both the settled and reconciliation_pending
      // paths affect the visible payment history; the latter often
      // becomes a settled row within seconds of the webhook arriving.
      queryClient.invalidateQueries({ queryKey: invoiceQueryKey });
      queryClient.invalidateQueries({ queryKey: paymentsQueryKey });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: receivablesKeys.invoicesRoot() });
      queryClient.invalidateQueries({ queryKey: receivablesKeys.viewsCounts() });

      if (r.kind === "settled") {
        toast({
          title: "Refund recorded",
          description: `${formatCurrency(parseFloat(amount), currency)} refunded.`,
        });
      } else {
        toast({
          title: "Refund issued",
          description:
            "Stripe accepted the refund. The local record will appear shortly.",
        });
      }
    },
    onError: (err: Error) => {
      setSubmitted(false);
      toast({
        title: "Refund failed",
        description: err.message ?? "Try again in a moment.",
        variant: "destructive",
      });
    },
  });

  const amountNum = parseFloat(amount || "0");
  const amountValid =
    Number.isFinite(amountNum) && amountNum > 0 && amountNum <= remainingRefundable + 1e-9;
  const canSubmit =
    !submitted && !refundMutation.isPending && amountValid && !result;

  const handleSubmit = () => {
    if (!canSubmit) return;
    setSubmitted(true);
    refundMutation.mutate();
  };

  const handleClose = () => {
    if (refundMutation.isPending) return;
    onOpenChange(false);
  };

  return (
    <ModalShell
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : handleClose())}
      className="sm:max-w-md"
      data-testid="refund-payment-dialog"
    >
      <ModalHeader>
        <ModalTitle className="flex items-center gap-2">
          <Undo2 className="h-5 w-5 text-rose-600" />
          Issue refund
        </ModalTitle>
        <ModalDescription>
          Refunding payment{" "}
          {payment.reference ? (
            <span className="font-medium">#{payment.reference}</span>
          ) : (
            <span className="font-medium">of {formatCurrency(parentAmount, currency)}</span>
          )}
          {isStripeLinked
            ? " — money will be returned to the original card via Stripe."
            : " — this records a manual refund only; no funds move automatically."}
        </ModalDescription>
      </ModalHeader>

      <ModalBody className="space-y-3">
        {result?.kind === "reconciliation_pending" ? (
          <Alert
            variant="warning"
            className="px-3 py-2"
            data-testid="refund-reconciliation-pending"
          >
            <AlertDescription className="flex items-start gap-2 text-sm">
              <Clock3 className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">Refund issued — reconciliation pending</p>
                <p className="text-xs opacity-90 mt-1 leading-relaxed">
                  Stripe accepted the refund. The local record will appear in the
                  payment history within a few seconds, when the webhook lands.
                  No further action is needed — retrying would not produce a
                  duplicate refund.
                </p>
              </div>
            </AlertDescription>
          </Alert>
        ) : result?.kind === "settled" ? (
          <Alert
            variant="success"
            className="px-3 py-2"
            data-testid="refund-settled"
          >
            <AlertDescription className="flex items-start gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-700 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">Refund recorded</p>
                <p className="text-xs opacity-90 mt-1">
                  {formatCurrency(parseFloat(result.amount.replace("-", "")), currency)} attached
                  to the original payment.
                </p>
              </div>
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <Alert variant="neutral" className="px-3 py-2 text-xs">
              <AlertDescription className="flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-slate-500 mt-0.5 shrink-0" />
                <div>
                  <p>
                    Original: <span className="font-medium tabular-nums">{formatCurrency(parentAmount, currency)}</span>
                    {" · "}Already refunded:{" "}
                    <span className="font-medium tabular-nums">{formatCurrency(alreadyOffset, currency)}</span>
                  </p>
                  <p>
                    Remaining refundable:{" "}
                    <span className="font-semibold text-slate-900 tabular-nums">
                      {formatCurrency(remainingRefundable, currency)}
                    </span>
                  </p>
                </div>
              </AlertDescription>
            </Alert>

            <FormField>
              <InlineInput
                id="refund-amount"
                label="Refund amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                max={remainingStr}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={refundMutation.isPending}
                data-testid="input-refund-amount"
              />
              {!amountValid && amount.length > 0 && (
                <FormErrorText>
                  Amount must be greater than 0 and at most{" "}
                  {formatCurrency(remainingRefundable, currency)}.
                </FormErrorText>
              )}
            </FormField>

            {isStripeLinked ? (
              <FormField>
                <Select
                  value={reason || "__none"}
                  onValueChange={(v) => setReason(v === "__none" ? "" : v)}
                  disabled={refundMutation.isPending}
                >
                  <InlineSelectTrigger
                    id="refund-reason"
                    label="Reason (optional)"
                    data-testid="select-refund-reason"
                  >
                    <SelectValue placeholder="Select a reason" />
                  </InlineSelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">No reason</SelectItem>
                    <SelectItem value="duplicate">Duplicate</SelectItem>
                    <SelectItem value="fraudulent">Fraudulent</SelectItem>
                    <SelectItem value="requested_by_customer">
                      Requested by customer
                    </SelectItem>
                  </SelectContent>
                </Select>
                <FormHelperText>
                  Reason is sent to Stripe; free-text notes stay local.
                </FormHelperText>
              </FormField>
            ) : (
              <Select
                value={methodOverride || "__same"}
                onValueChange={(v) => setMethodOverride(v === "__same" ? "" : v)}
                disabled={refundMutation.isPending}
              >
                <InlineSelectTrigger
                  id="refund-method"
                  label="Refund method (optional)"
                  data-testid="select-refund-method"
                >
                  <SelectValue placeholder={`Same as original (${payment.method})`} />
                </InlineSelectTrigger>
                <SelectContent>
                  <SelectItem value="__same">
                    Same as original ({payment.method})
                  </SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="credit">Credit</SelectItem>
                  <SelectItem value="debit">Debit</SelectItem>
                  <SelectItem value="e-transfer">E-Transfer</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            )}

            <InlineTextarea
              id="refund-notes"
              label="Notes (optional)"
              placeholder="Internal notes for this refund…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={refundMutation.isPending}
              data-testid="input-refund-notes"
            />
          </>
        )}
      </ModalBody>

      <ModalFooter>
        {result ? (
          <Button onClick={handleClose} data-testid="button-close-refund">Close</Button>
        ) : (
          <>
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={refundMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="bg-rose-600 hover:bg-rose-700 text-white"
              data-testid="button-submit-refund"
            >
              {refundMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Refunding…
                </>
              ) : (
                `Refund ${formatCurrency(parseFloat(amount || "0"), currency)}`
              )}
            </Button>
          </>
        )}
      </ModalFooter>
    </ModalShell>
  );
}

export default RefundPaymentDialog;
