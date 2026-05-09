/**
 * DaySummaryCard — Day View context header.
 * Shell delegated to TimesheetSummaryStrip; this component owns
 * category chip assembly and date formatting.
 */
import { format, parseISO } from "date-fns";
import { Chip, type ChipTone } from "@/components/ui/chip";
import { type EntryCategory } from "./categoryMap";
import {
  TimesheetSummaryStrip,
  type TimesheetSummaryStripMember,
} from "./TimesheetSummaryStrip";

export interface DayTeamMember {
  id: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface DaySummaryCardProps {
  date: string;
  members: DayTeamMember[];
  selectedMemberId: string;
  totalMinutes: number;
  hasRunning: boolean;
  /** Pre-summed minutes per UI category (onsite / drive / general). */
  categoryTotals: Record<EntryCategory, number>;
  formatMemberName: (member: DayTeamMember) => string;
  onSelectMember: (memberId: string) => void;
}

function formatMinutes(minutes: number): string {
  if (minutes === 0) return "0h 0m";
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hrs}h ${mins}m`;
}

function formatMinutesShort(minutes: number): string {
  if (minutes === 0) return "0m";
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs === 0) return `${mins}m`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

const STRIP_ORDER: EntryCategory[] = ["onsite", "drive", "general"];
const STRIP_SHORT: Record<EntryCategory, string> = {
  onsite: "On-site",
  drive: "Drive",
  general: "General",
};
const STRIP_TONE: Record<EntryCategory, ChipTone> = {
  onsite: "success",
  drive: "info",
  general: "neutral",
};

export function DaySummaryCard({
  date,
  members,
  selectedMemberId,
  totalMinutes,
  hasRunning,
  categoryTotals,
  formatMemberName,
  onSelectMember,
}: DaySummaryCardProps) {
  const selected = members.find((m) => m.id === selectedMemberId) ?? null;

  const stripMembers: TimesheetSummaryStripMember[] = members.map((m) => ({
    id: m.id,
    label: formatMemberName(m),
  }));

  const chips = selected ? (
    <div
      className="flex flex-wrap items-center gap-1.5"
      data-testid="day-category-strip"
    >
      {STRIP_ORDER.map((cat) => (
        <Chip
          key={cat}
          tone={STRIP_TONE[cat]}
          size="compact"
          leadingIcon={
            <span className="h-1.5 w-1.5 rounded-full bg-current shrink-0 opacity-80" aria-hidden />
          }
          data-testid={`category-total-${cat}`}
        >
          {STRIP_SHORT[cat]}
          <span className="font-mono font-semibold tabular-nums ml-0.5">
            {formatMinutesShort(categoryTotals[cat] ?? 0)}
          </span>
        </Chip>
      ))}
    </div>
  ) : undefined;

  return (
    <TimesheetSummaryStrip
      members={stripMembers}
      selectedMemberId={selectedMemberId}
      onSelectMember={onSelectMember}
      techName={selected ? formatMemberName(selected) : null}
      dateLabel={selected ? format(parseISO(date), "EEE, MMM d, yyyy") : undefined}
      chips={chips}
      hasRunning={hasRunning}
      totalFormatted={selected ? formatMinutes(totalMinutes) : null}
      containerTestId="day-summary-card"
      selectorTestId="day-employee-select"
      totalTestId="day-total"
    />
  );
}
