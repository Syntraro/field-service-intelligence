/**
 * QuoteSummaryCard — right-rail subtotal/tax/total card for quote surfaces.
 *
 * Extracted from QuoteDetailPage so the saved detail page and the create
 * page render the same chrome. Pure presentational — takes the three
 * money strings and renders them. Both modes share the same body, so
 * there is no `mode` prop here; the saved page passes `quote.subtotal /
 * quote.taxTotal / quote.total`, the create page passes the same values
 * computed locally from draft line items.
 *
 * If a chrome change is needed, change it here — both surfaces source
 * this card.
 *
 * Phase 2 RailContentCard adoption (2026-05-08): replaced shadcn
 * Card/CardHeader/CardContent with canonical RailContentCard family.
 * Removes the double-card chrome layering inside the rail panel body.
 */
import {
  RailContentCard,
  RailContentCardHeader,
  RailContentCardTitle,
  RailContentCardFieldList,
  RailContentCardField,
} from "@/components/detail-rail/RailContentCard";
import { formatCurrency } from "@/lib/formatters";

export interface QuoteSummaryCardProps {
  /** Pre-tax sum of all line item subtotals. Decimal string. */
  subtotal: string | number;
  /** Total tax across all lines. Decimal string. */
  taxTotal: string | number;
  /** Subtotal + tax. Decimal string. */
  total: string | number;
}

export function QuoteSummaryCard({ subtotal, taxTotal, total }: QuoteSummaryCardProps) {
  return (
    <RailContentCard testId="card-quote-summary">
      <RailContentCardHeader>
        <RailContentCardTitle as="h4">Quote Summary</RailContentCardTitle>
      </RailContentCardHeader>

      <RailContentCardFieldList>
        <RailContentCardField label="Subtotal">
          {formatCurrency(subtotal)}
        </RailContentCardField>
        <RailContentCardField label="Tax">
          {formatCurrency(taxTotal)}
        </RailContentCardField>
      </RailContentCardFieldList>

      {/* Total row — border-t separator with emphasis value */}
      <div className="mt-2 pt-2 border-t border-slate-100 flex justify-between items-baseline">
        <span className="text-label text-text-secondary">Total</span>
        <span className="text-emphasis text-text-primary" data-testid="text-quote-total">
          {formatCurrency(total)}
        </span>
      </div>
    </RailContentCard>
  );
}
