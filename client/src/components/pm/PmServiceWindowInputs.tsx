/**
 * PmServiceWindowInputs — Shared service window before/after day inputs.
 * Used by PM Create wizard and PM Edit page.
 */
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PmServiceWindowInputsProps {
  daysBefore: number;
  daysAfter: number;
  onDaysBeforeChange: (v: number) => void;
  onDaysAfterChange: (v: number) => void;
  testIdPrefix?: string;
}

export function PmServiceWindowInputs({
  daysBefore,
  daysAfter,
  onDaysBeforeChange,
  onDaysAfterChange,
  testIdPrefix = "pm",
}: PmServiceWindowInputsProps) {
  return (
    <div className="space-y-2">
      <Label>Service window</Label>
      <p className="text-xs text-muted-foreground">
        Acceptable date range around the ideal PM date.
      </p>
      <div className="flex items-center gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Days before</Label>
          <Input
            type="number"
            min={0}
            max={90}
            className="w-20 h-7 text-sm"
            value={daysBefore}
            onChange={(e) => onDaysBeforeChange(parseInt(e.target.value, 10) || 0)}
            data-testid={`${testIdPrefix}-window-before`}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Days after</Label>
          <Input
            type="number"
            min={0}
            max={90}
            className="w-20 h-7 text-sm"
            value={daysAfter}
            onChange={(e) => onDaysAfterChange(parseInt(e.target.value, 10) || 0)}
            data-testid={`${testIdPrefix}-window-after`}
          />
        </div>
      </div>
    </div>
  );
}
