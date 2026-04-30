// Canonical date picker — single source of truth for date popovers across
// the app (2026-04-29). Wraps shadcn `<Calendar>` (DayPicker) inside a
// `<Popover>`, with an outline `<Button>` trigger styled to match the
// Create Job modal — the visual reference. Use this component instead of
// native `<Input type="date">` or hand-rolled Calendar+Popover pairs so
// every date popover in the app stays consistent.
//
// Date model:
//   - String values are `YYYY-MM-DD`. We parse to a local-midnight `Date`
//     (no UTC drift) and format back the same way.
//   - `null` / empty string both mean "no value" and render the placeholder.
//   - Selected day is highlighted in the theme primary (HSL 98 37% 51%,
//     a green) via the existing Calendar `day_selected` style.
//
// Why a wrapper:
//   - DRY — the trigger + popover + format chain was duplicated across
//     Create Job, Edit Visit, Dispatch, JobScheduleFields, Payroll.
//   - Consistency — one place to evolve the visual.
//   - Replaces every native `<Input type="date">` with the same look on
//     desktop and mobile.

import { useMemo } from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type CanonicalDatePickerProps = {
  /** Controlled value as `YYYY-MM-DD`. `null`/`undefined`/`""` render the placeholder. */
  value: string | null | undefined;
  /** Fired with `YYYY-MM-DD` on pick, or `null` on clear. */
  onChange: (next: string | null) => void;
  /** Disable the trigger and prevent picker open. */
  disabled?: boolean;
  /** Trigger placeholder when no value is set. */
  placeholder?: string;
  /** Earliest allowed date. */
  minDate?: Date;
  /** Latest allowed date. */
  maxDate?: Date;
  /** Show an inline "X" inside the trigger to clear the value. */
  clearable?: boolean;
  /** date-fns format token for the trigger label. Default: `MMM d, yyyy`. */
  displayFormat?: string;
  /** Additional classes on the trigger button. */
  className?: string;
  /** Forwarded to the trigger. */
  id?: string;
  /** Forwarded to the trigger as `aria-label`. */
  ariaLabel?: string;
  /** Forwarded to the trigger button. */
  size?: "default" | "sm" | "lg" | "icon";
  /** Forwarded as `data-testid` on the trigger. */
  "data-testid"?: string;
};

export function CanonicalDatePicker({
  value,
  onChange,
  disabled,
  placeholder = "Pick date",
  minDate,
  maxDate,
  clearable = false,
  displayFormat = "MMM d, yyyy",
  className,
  id,
  ariaLabel,
  size = "sm",
  "data-testid": testId,
}: CanonicalDatePickerProps) {
  const parsed = useMemo(() => parseDateOnly(value), [value]);
  const formatted = parsed ? format(parsed, displayFormat) : "";

  // Build the disabled-day matcher only if we have bounds.
  const dayDisabled = useMemo(() => {
    if (!minDate && !maxDate) return undefined;
    return (date: Date) => {
      if (minDate && date < startOfLocalDay(minDate)) return true;
      if (maxDate && date > startOfLocalDay(maxDate)) return true;
      return false;
    };
  }, [minDate, maxDate]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          size={size}
          disabled={disabled}
          aria-label={ariaLabel}
          data-testid={testId}
          className={cn(
            "justify-start gap-1.5 bg-white text-left font-normal",
            !parsed && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate flex-1">{formatted || placeholder}</span>
          {clearable && parsed && !disabled && (
            <span
              role="button"
              aria-label="Clear date"
              tabIndex={0}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onChange(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange(null);
                }
              }}
              className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-sm opacity-50 hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={parsed ?? undefined}
          onSelect={(d) => onChange(d ? format(d, "yyyy-MM-dd") : null)}
          disabled={dayDisabled}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Parse a `YYYY-MM-DD` (or longer ISO) string to a local-midnight Date so
 * the date the user sees in the picker matches the date stored on the
 * server — no UTC drift on the day boundary.
 */
function parseDateOnly(s: string | null | undefined): Date | null {
  if (!s) return null;
  const datePart = s.length >= 10 ? s.slice(0, 10) : s;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!m) return null;
  const [, y, mo, d] = m;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
