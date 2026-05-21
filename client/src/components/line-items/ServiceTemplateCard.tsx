import { memo, useCallback } from "react";
import { Clock, Minus, Package, Plus } from "lucide-react";
import { StatusChip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/formatters";
import type { CatalogPickerRow } from "./catalogPickerTypes";

interface ServiceTemplateCardProps {
  row: Extract<CatalogPickerRow, { _source: "template" }>;
  quantity: number;
  onIncrement: (id: string) => void;
  onDecrement: (id: string) => void;
}

function formatDurationMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Memoized card for flat-rate service templates in the unified pricebook picker.
 *
 * Shows: name, flat-rate badge, price, category, duration, component count.
 * Does NOT show: internalNotes, component internals, or operational metadata.
 */
export const ServiceTemplateCard = memo(function ServiceTemplateCard({
  row,
  quantity,
  onIncrement,
  onDecrement,
}: ServiceTemplateCardProps) {
  const isSelected = quantity > 0;
  const t = row._raw;

  const handleIncrement = useCallback(() => onIncrement(row.id), [onIncrement, row.id]);
  const handleDecrement = useCallback(() => onDecrement(row.id), [onDecrement, row.id]);

  return (
    <div
      className={
        "h-full rounded-md border bg-white p-2.5 transition-colors flex flex-col " +
        (isSelected
          ? "border-emerald-500 ring-1 ring-emerald-200 bg-emerald-50/40"
          : "border-card-border hover:border-slate-300 hover:bg-slate-50")
      }
      data-testid={`pricebook-template-${row.id}`}
      data-selected={isSelected ? "true" : "false"}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <StatusChip tone="info">Flat-Rate</StatusChip>
        <h4 className="text-sm font-semibold text-slate-900 truncate min-w-0">
          {row.name}
        </h4>
      </div>

      {row.category && (
        <p className="mt-1 text-[11px] text-slate-500 truncate">{row.category}</p>
      )}

      <div className="mt-auto pt-1.5 flex items-center justify-between gap-1.5">
        <div className="min-w-0 flex flex-col gap-0.5">
          <span className="text-sm font-semibold tabular-nums text-slate-900 leading-tight">
            {formatCurrency(t.flatRatePrice)}
          </span>
          <div className="flex items-center gap-2 text-[10px] leading-tight text-slate-500">
            {row.estimatedDurationMinutes != null && (
              <span className="flex items-center gap-0.5">
                <Clock className="h-3 w-3" aria-hidden />
                {formatDurationMinutes(row.estimatedDurationMinutes)}
              </span>
            )}
            <span className="flex items-center gap-0.5">
              <Package className="h-3 w-3" aria-hidden />
              {row.componentCount === 0
                ? "No components"
                : `${row.componentCount} component${row.componentCount === 1 ? "" : "s"}`}
            </span>
          </div>
        </div>

        {isSelected ? (
          <div
            className="flex items-center gap-0.5"
            data-testid={`pricebook-quantity-controls-${row.id}`}
          >
            <Button
              size="icon"
              variant="outline"
              className="h-7 w-7 shrink-0"
              onClick={handleDecrement}
              aria-label={`Decrease quantity for ${row.name}`}
              data-testid={`pricebook-decrement-${row.id}`}
            >
              <Minus className="h-3 w-3" />
            </Button>
            <span
              className="min-w-[1.75rem] text-center text-sm font-semibold tabular-nums text-slate-900"
              data-testid={`pricebook-quantity-${row.id}`}
            >
              {quantity}
            </span>
            <Button
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={handleIncrement}
              aria-label={`Increase quantity for ${row.name}`}
              data-testid={`pricebook-increment-${row.id}`}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <Button
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={handleIncrement}
            aria-label={`Add ${row.name}`}
            data-testid={`pricebook-add-${row.id}`}
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
});
