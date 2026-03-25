/**
 * PmMonthPicker — Shared month selector with preset buttons.
 * Used by PM Create wizard and PM Edit page.
 */
import { Label } from "@/components/ui/label";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const MONTH_PRESETS = [
  { label: "Quarterly", months: [1, 4, 7, 10] },
  { label: "Bi-Annual", months: [4, 10] },
  { label: "Annual", months: [4] },
  { label: "Monthly", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
] as const;

export { MONTH_LABELS, MONTH_PRESETS };

interface PmMonthPickerProps {
  months: number[];
  onChange: (months: number[]) => void;
  testIdPrefix?: string;
}

export function PmMonthPicker({ months, onChange, testIdPrefix = "pm" }: PmMonthPickerProps) {
  const toggleMonth = (m: number) => {
    const next = months.includes(m)
      ? months.filter((v) => v !== m)
      : [...months, m].sort((a, b) => a - b);
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <Label>Which months should this run?</Label>
      <div className="flex flex-wrap gap-1.5">
        {MONTH_LABELS.map((label, idx) => {
          const monthNum = idx + 1;
          const selected = months.includes(monthNum);
          return (
            <button
              key={monthNum}
              type="button"
              onClick={() => toggleMonth(monthNum)}
              className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                selected
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:border-primary/50"
              }`}
              data-testid={`${testIdPrefix}-month-${monthNum}`}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2 mt-1">
        {MONTH_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => onChange([...preset.months])}
            className="text-xs text-primary hover:underline"
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}
