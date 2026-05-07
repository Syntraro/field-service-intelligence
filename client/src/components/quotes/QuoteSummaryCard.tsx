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
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/formatters";
import { QuoteMetaRow } from "./shared/QuoteMetaRow";

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
    <Card data-testid="card-quote-summary">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Quote Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <QuoteMetaRow label="Subtotal" value={formatCurrency(subtotal)} />
        <QuoteMetaRow label="Tax" value={formatCurrency(taxTotal)} />
        <div className="pt-2 border-t flex justify-between items-baseline">
          <span className="text-muted-foreground font-medium">Total</span>
          <span className="text-lg font-bold text-slate-900" data-testid="text-quote-total">
            {formatCurrency(total)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
