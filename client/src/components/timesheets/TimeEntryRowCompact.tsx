/**
 * TimeEntryRowCompact — compact entry row for use inside JobTimeGroupCard.
 * Delegates to TimesheetEntryCard variant="job-row". Public interface
 * preserved for backward compatibility with JobTimeGroupCard and DayView.
 */
import {
  TimesheetEntryCard,
  type TimesheetEntryCardDatum,
} from "./TimesheetEntryCard";

export type TimeEntryRowCompactDatum = TimesheetEntryCardDatum;

export interface TimeEntryRowCompactProps {
  entry: TimeEntryRowCompactDatum;
  isLocked: boolean;
  onEdit: () => void;
  onClockOut: () => void;
  hideTypeChip?: boolean;
}

export function TimeEntryRowCompact({
  entry,
  isLocked,
  onEdit,
  onClockOut,
  hideTypeChip = false,
}: TimeEntryRowCompactProps) {
  return (
    <TimesheetEntryCard
      variant="job-row"
      entry={entry}
      isLocked={isLocked}
      onEdit={onEdit}
      onClockOut={onClockOut}
      hideTypeChip={hideTypeChip}
    />
  );
}
