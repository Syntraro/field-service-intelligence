import { FormField, FormLabel, FormHelperText } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type RecurrenceMode = "none" | "daily" | "weekdays" | "weekly" | "biweekly" | "custom";

export interface CustomRecurrence {
  days: string[];    // BYDAY abbreviations: "MO","TU","WE","TH","FR","SA","SU"
  interval: 1 | 2;  // 1 = every week, 2 = every 2 weeks
}

const BYDAY_ORDER: Record<string, number> = {
  MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6,
};

/**
 * Maps UI recurrence mode + optional custom config to the RRULE string the
 * server expects. Frontend never computes occurrences — only produces the rule.
 *
 * FREQ=WEEKLY with no BYDAY is valid: the server defaults to the DTSTART day.
 * FREQ=WEEKLY;INTERVAL=2 likewise inherits DTSTART's day of week.
 */
export function recurrenceModeToRule(
  mode: RecurrenceMode,
  custom?: CustomRecurrence,
): string | null {
  switch (mode) {
    case "daily":    return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU";
    case "weekdays": return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
    case "weekly":   return "FREQ=WEEKLY";
    case "biweekly": return "FREQ=WEEKLY;INTERVAL=2";
    case "custom": {
      if (!custom || custom.days.length === 0) return null;
      const days = [...custom.days]
        .sort((a, b) => (BYDAY_ORDER[a] ?? 0) - (BYDAY_ORDER[b] ?? 0))
        .join(",");
      return custom.interval === 2
        ? `FREQ=WEEKLY;BYDAY=${days};INTERVAL=2`
        : `FREQ=WEEKLY;BYDAY=${days}`;
    }
    default: return null;
  }
}

const MAIN_OPTIONS: { value: RecurrenceMode; label: string }[] = [
  { value: "none",     label: "No repeat" },
  { value: "daily",    label: "Daily" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly",   label: "Every week" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "custom",   label: "Custom" },
];

const DOW_OPTIONS: { key: string; label: string }[] = [
  { key: "MO", label: "Mon" },
  { key: "TU", label: "Tue" },
  { key: "WE", label: "Wed" },
  { key: "TH", label: "Thu" },
  { key: "FR", label: "Fri" },
  { key: "SA", label: "Sat" },
  { key: "SU", label: "Sun" },
];

interface Props {
  mode: RecurrenceMode;
  onModeChange: (m: RecurrenceMode) => void;
  custom: CustomRecurrence;
  onCustomChange: (c: CustomRecurrence) => void;
  endDate: string;
  onEndDateChange: (d: string) => void;
  disabled?: boolean;
}

export default function RecurrenceControls({
  mode,
  onModeChange,
  custom,
  onCustomChange,
  endDate,
  onEndDateChange,
  disabled,
}: Props) {
  function toggleDay(day: string) {
    const next = custom.days.includes(day)
      ? custom.days.filter((d) => d !== day)
      : [...custom.days, day];
    onCustomChange({ ...custom, days: next });
  }

  return (
    <div className="space-y-3">
      <FormField>
        <FormLabel>Repeat</FormLabel>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Repeat options">
          {MAIN_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              type="button"
              size="sm"
              variant={mode === opt.value ? "default" : "outline"}
              onClick={() => onModeChange(opt.value)}
              disabled={disabled}
              data-testid={`recurrence-${opt.value}`}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </FormField>

      {mode === "custom" && (
        <FormField>
          <FormLabel>Days</FormLabel>
          <div
            className="flex flex-wrap gap-1"
            role="group"
            aria-label="Days of week"
            data-testid="recurrence-custom-days"
          >
            {DOW_OPTIONS.map((d) => (
              <Button
                key={d.key}
                type="button"
                size="sm"
                variant={custom.days.includes(d.key) ? "default" : "outline"}
                onClick={() => toggleDay(d.key)}
                disabled={disabled}
                data-testid={`recurrence-day-${d.key.toLowerCase()}`}
                className="w-11"
              >
                {d.label}
              </Button>
            ))}
          </div>
          <div
            className="flex gap-1 mt-2"
            role="group"
            aria-label="Repeat interval"
            data-testid="recurrence-interval-group"
          >
            {([1, 2] as const).map((n) => (
              <Button
                key={n}
                type="button"
                size="sm"
                variant={custom.interval === n ? "default" : "outline"}
                onClick={() => onCustomChange({ ...custom, interval: n })}
                disabled={disabled}
                data-testid={`recurrence-interval-${n}`}
              >
                {n === 1 ? "Every week" : "Every 2 weeks"}
              </Button>
            ))}
          </div>
        </FormField>
      )}

      {mode !== "none" && (
        <FormField>
          <FormLabel htmlFor="recurrence-end-date">End date</FormLabel>
          <Input
            id="recurrence-end-date"
            type="date"
            value={endDate}
            onChange={(e) => onEndDateChange(e.target.value)}
            disabled={disabled}
            data-testid="recurrence-end-date"
          />
          <FormHelperText>Leave blank for no end date</FormHelperText>
        </FormField>
      )}
    </div>
  );
}
