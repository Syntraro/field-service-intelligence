import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { InvoiceDateRange } from "@/components/invoices/InvoiceListPanel";

// ── Preset computation ────────────────────────────────────────────────────────

const DATE_PRESETS: { value: NonNullable<InvoiceDateRange["preset"]>; label: string }[] = [
  { value: "this_month",   label: "This Month" },
  { value: "last_month",   label: "Last Month" },
  { value: "last_30_days", label: "Last 30 Days" },
  { value: "custom",       label: "Custom Range" },
];

function computePresetBounds(
  preset: NonNullable<InvoiceDateRange["preset"]>,
): { start: string; end: string } | null {
  if (preset === "custom") return null;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  if (preset === "this_month") {
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const lastDay = new Date(y, m, 0).getDate();
    return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(lastDay)}` };
  }
  if (preset === "last_month") {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const lastDay = new Date(y, m, 0).getDate();
    return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(lastDay)}` };
  }
  // last_30_days
  const end = now.toISOString().slice(0, 10);
  const s = new Date(now);
  s.setDate(s.getDate() - 30);
  return { start: s.toISOString().slice(0, 10), end };
}

export const EMPTY_DATE_RANGE: InvoiceDateRange = { preset: null, start: null, end: null };

// ── DateRangeButton ───────────────────────────────────────────────────────────

interface DateRangeButtonProps {
  value: InvoiceDateRange;
  onChange: (r: InvoiceDateRange) => void;
  label?: string;
  /**
   * "sm" (default) — h-9 rounded-lg, for use in page headers.
   * "md" — h-8 rounded-md, matches WorkspaceViewChip size="md" in filter bars.
   */
  size?: "sm" | "md";
}

/**
 * Invoice date range filter button. Extracted from InvoicesWorkspaceTab.
 * Shared filter primitive — lives in components/filters/.
 */
export function DateRangeButton({ value, onChange, label = "Invoice Date", size = "sm" }: DateRangeButtonProps) {
  const isActive = value.preset !== null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-2 border text-sm transition-colors shrink-0",
            size === "md" ? "h-8 px-3 rounded-md" : "h-9 px-3 rounded-lg",
            isActive
              ? "border-primary/60 bg-primary/5 text-primary"
              : size === "md"
                ? "bg-white border-slate-200/60 text-slate-600 hover:bg-slate-50 hover:text-slate-800"
                : "border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50",
          )}
          data-testid="button-invoice-date-filter"
        >
          <CalendarDays className="h-4 w-4" aria-hidden="true" />
          {label}
          {isActive && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-2">
        <div className="space-y-0.5">
          {DATE_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              className={cn(
                "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                value.preset === p.value
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-foreground hover:bg-muted",
              )}
              onClick={() => {
                if (p.value === "custom") {
                  onChange({ preset: "custom", start: value.start, end: value.end });
                } else {
                  const bounds = computePresetBounds(p.value);
                  onChange({ preset: p.value, start: bounds?.start ?? null, end: bounds?.end ?? null });
                }
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {value.preset === "custom" && (
          <div className="mt-2 pt-2 border-t border-border space-y-2">
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.06em] mb-1">
                From
              </div>
              <input
                type="date"
                value={value.start ?? ""}
                onChange={(e) => onChange({ ...value, start: e.target.value || null })}
                className="w-full h-8 px-2 rounded-md border border-slate-200 text-sm bg-white"
              />
            </div>
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.06em] mb-1">
                To
              </div>
              <input
                type="date"
                value={value.end ?? ""}
                onChange={(e) => onChange({ ...value, end: e.target.value || null })}
                className="w-full h-8 px-2 rounded-md border border-slate-200 text-sm bg-white"
              />
            </div>
          </div>
        )}

        {isActive && (
          <div className="mt-1 pt-1 border-t border-border">
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-muted transition-colors"
              onClick={() => onChange(EMPTY_DATE_RANGE)}
              data-testid="button-invoice-date-filter-clear"
            >
              Clear
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
