/**
 * PmGenerationModeSelector — Generation mode radio group.
 * Used by PM Edit page (the create wizard has its own redesigned UI).
 */
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type GenerationMode = "period_start" | "day_of_month";

interface PmGenerationModeSelectorProps {
  generationMode: GenerationMode;
  generationDayOfMonth: number;
  onModeChange: (mode: GenerationMode) => void;
  onDayChange: (day: number) => void;
  testIdPrefix?: string;
}

export function PmGenerationModeSelector({
  generationMode,
  generationDayOfMonth,
  onModeChange,
  onDayChange,
  testIdPrefix = "pm",
}: PmGenerationModeSelectorProps) {
  return (
    <div className="space-y-2">
      <Label>When should work orders be created?</Label>
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="radio"
            name="generationMode"
            checked={generationMode === "period_start"}
            onChange={() => onModeChange("period_start")}
            className="accent-primary"
          />
          On the 1st of each service month
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="radio"
            name="generationMode"
            checked={generationMode === "day_of_month"}
            onChange={() => onModeChange("day_of_month")}
            className="accent-primary"
          />
          <span>Specific day:</span>
          <Input
            type="number"
            min={1}
            max={31}
            className="w-16 h-7 text-sm"
            value={generationDayOfMonth}
            onChange={(e) => onDayChange(parseInt(e.target.value, 10) || 1)}
            disabled={generationMode !== "day_of_month"}
            data-testid={`${testIdPrefix}-day-of-month`}
          />
        </label>
      </div>
    </div>
  );
}
