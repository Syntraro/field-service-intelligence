import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const SUBTYPE_LABELS: Record<string, string> = {
  vacation: "Vacation",
  sick: "Sick",
  personal: "Personal",
  holiday: "Holiday",
  training: "Training",
  scheduled_off: "Scheduled off",
  other: "Other",
};

export const SUBTYPE_VALUES = Object.keys(SUBTYPE_LABELS) as Array<keyof typeof SUBTYPE_LABELS>;

interface Props {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  id?: string;
}

export default function UnavailableSubtypeSelect({ value, onChange, disabled, id }: Props) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} data-testid="unavailable-subtype-select">
        <SelectValue placeholder="Select reason" />
      </SelectTrigger>
      <SelectContent>
        {SUBTYPE_VALUES.map((k) => (
          <SelectItem key={k} value={k}>
            {SUBTYPE_LABELS[k]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
