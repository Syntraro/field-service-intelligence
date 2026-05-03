/**
 * DiscountEditor — invoice-totals-row discount UI, extracted from
 * `InvoiceDetailPage` 2026-05-02 as Audit #2 invoice-flow Phase 3.
 *
 * Controlled component. The persisted discount state is owned by the
 * caller (`value` prop); the Apply / Clear buttons emit committed
 * changes via `onChange(next)`. The caller decides what `onChange`
 * does: live-mode (`InvoiceDetailPage`) PATCHes via the existing
 * `updateInvoiceFieldsMutation`; future draft-mode (`/invoices/new`
 * builder, Phase 4–6) just updates local state. No PATCH calls,
 * no mutations, no `invoiceId` usage live inside this component.
 *
 * The component DOES own a small internal buffer (the user types into
 * `%` or `$`, fields keep typing, then "Apply" commits). This buffer
 * mirrors the pre-extraction local state on `InvoiceDetailPage` and
 * preserves the two-step "type → Apply" UX exactly. The buffer
 * resyncs whenever `value` changes (e.g. after a successful PATCH).
 *
 * Auto-compute behavior is preserved: typing in `%` auto-fills `$`,
 * and vice-versa — both derived from the invoice subtotal passed in
 * via the `subtotal` prop. The math is identical to the prior inline
 * helpers (`handleDiscountPercentChange` / `handleDiscountAmountChange`).
 *
 * Visual JSX preserved byte-for-byte from `InvoiceDetailPage` lines
 * 2278–2339 pre-extraction (rounded card, Tag/Percent/DollarSign
 * icons, paired number inputs separated by "or", Clear + Apply
 * buttons in the right footer).
 */

import { useEffect, useState } from "react";
import { Tag, Percent, DollarSign, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type DiscountType = "PERCENT" | "AMOUNT" | null;

export interface DiscountEditorValue {
  discountType: DiscountType;
  discountPercent?: string;
  discountAmount?: string;
  discountNotes?: string;
}

export interface DiscountEditorProps {
  /** Persisted discount state. Component re-syncs its internal buffer
   *  whenever this changes (e.g. after a parent-driven save). */
  value: DiscountEditorValue;
  /** Invoice subtotal (decimal-as-string). Used for the type-percent
   *  → auto-fill-amount and type-amount → auto-fill-percent helpers,
   *  matching the pre-extraction inline math. */
  subtotal: string;
  /** Fired when the user commits a change via Apply or Clear. The
   *  caller decides what to do — typically: PATCH the invoice. */
  onChange: (next: DiscountEditorValue) => void;
  /** Disable every input + button (used by the parent during a
   *  pending PATCH). Default: `false`. */
  disabled?: boolean;
}

export function DiscountEditor({
  value,
  subtotal,
  onChange,
  disabled = false,
}: DiscountEditorProps) {
  // Internal buffer state. Mirrors the pre-extraction `discountPercent`
  // / `discountAmount` / `discountType` `useState`s on InvoiceDetailPage.
  // Seeded from `value` and resynced whenever `value` updates.
  const [percent, setPercent] = useState<string>(value.discountPercent ?? "");
  const [amount, setAmount] = useState<string>(value.discountAmount ?? "");
  const [type, setType] = useState<DiscountType>(value.discountType);

  // Resync internal buffer whenever the parent-controlled value moves
  // (post-save the parent updates its prop; we mirror).
  useEffect(() => {
    setPercent(value.discountPercent ?? "");
    setAmount(value.discountAmount ?? "");
    setType(value.discountType);
  }, [value.discountType, value.discountPercent, value.discountAmount]);

  // Auto-compute helpers — same math as the pre-extraction handlers.
  const handlePercentChange = (next: string) => {
    setPercent(next);
    setType("PERCENT");
    if (next) {
      const subtotalNum = parseFloat(subtotal) || 0;
      const percentNum = parseFloat(next) || 0;
      const computedAmount = Math.round(subtotalNum * (percentNum / 100) * 100) / 100;
      setAmount(computedAmount.toFixed(2));
    } else {
      setAmount("");
      setType(null);
    }
  };

  const handleAmountChange = (next: string) => {
    setAmount(next);
    setType("AMOUNT");
    if (next) {
      const subtotalNum = parseFloat(subtotal) || 0;
      const amountNum = parseFloat(next) || 0;
      const computedPercent =
        subtotalNum > 0 ? Math.round((amountNum / subtotalNum) * 100 * 100) / 100 : 0;
      setPercent(computedPercent.toFixed(2));
    } else {
      setPercent("");
      setType(null);
    }
  };

  // Apply emits the staged values to the parent, preserving the prior
  // PATCH payload contract (`{discountType, discountPercent || null,
  // discountAmount || null}`) plus the unmodified `discountNotes`
  // passthrough so a future caller editing notes elsewhere doesn't
  // lose them.
  const handleApply = () => {
    onChange({
      discountType: type,
      discountPercent: percent || undefined,
      discountAmount: amount || undefined,
      discountNotes: value.discountNotes,
    });
  };

  const handleClear = () => {
    setPercent("");
    setAmount("");
    setType(null);
    onChange({
      discountType: null,
      discountPercent: undefined,
      discountAmount: undefined,
      discountNotes: value.discountNotes,
    });
  };

  return (
    <div className="rounded-md border border-card-border bg-card px-3 py-2 my-2 space-y-2">
      <div className="flex items-center gap-2 text-xs text-slate-600">
        <Tag className="h-3.5 w-3.5" />
        <span className="font-medium">Discount</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 flex-1">
          <Input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            max="100"
            placeholder="0"
            value={percent}
            onChange={(e) => handlePercentChange(e.target.value)}
            className="h-7 w-16 text-right text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            data-testid="input-discount-percent"
            disabled={disabled}
          />
          <Percent className="h-3.5 w-3.5 text-slate-400" />
        </div>
        <span className="text-slate-400 text-xs">or</span>
        <div className="flex items-center gap-1 flex-1">
          <DollarSign className="h-3.5 w-3.5 text-slate-400" />
          <Input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            placeholder="0.00"
            value={amount}
            onChange={(e) => handleAmountChange(e.target.value)}
            className="h-7 w-20 text-right text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            data-testid="input-discount-amount"
            disabled={disabled}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        {(percent || amount) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={handleClear}
            disabled={disabled}
            data-testid="button-clear-discount"
          >
            <X className="h-3 w-3 mr-1" />
            Clear
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={handleApply}
          disabled={disabled || (!percent && !amount)}
          data-testid="button-save-discount"
        >
          {disabled ? "Saving..." : "Apply"}
        </Button>
      </div>
    </div>
  );
}
