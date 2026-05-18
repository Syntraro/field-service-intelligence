/**
 * OnCallIndicator — small chip shown next to a technician's name when they
 * have an on-call shift overlapping the visible dispatch range.
 * Only rendered when technician_shift_management is enabled.
 */
import { Chip } from "@/components/ui/chip";

type Props = {
  /** Show the indicator. Caller is responsible for feature-gating. */
  show: boolean;
};

export default function OnCallIndicator({ show }: Props) {
  if (!show) return null;
  return (
    <Chip
      tone="info"
      data-testid="on-call-indicator"
      title="Technician has an on-call shift during this period"
    >
      On-Call
    </Chip>
  );
}
