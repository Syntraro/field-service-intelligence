/**
 * ShiftOverlay — displays a technician's scheduled normal shift hours as a
 * subtle time-range label. Rendered in the technician sidebar row so
 * dispatchers can see at a glance when the tech is scheduled to work.
 *
 * Only visible when technician_shift_management is enabled and the tech
 * has at least one normal shift on the given date.
 */
import type { DispatchShiftEntry } from "./dispatchPreviewTypes";

type Props = {
  /** All normal shifts for the technician (pre-filtered to normal type). */
  shifts: DispatchShiftEntry[];
  technicianUserId: string;
  /** YYYY-MM-DD date being displayed (company timezone). */
  date: string;
};

/** Format ISO string to "HH:MM" local time label using the browser's locale. */
function toLocalTimeLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "";
  }
}

export default function ShiftOverlay({ shifts, technicianUserId, date }: Props) {
  const techShifts = shifts.filter(
    (s) =>
      s.technicianUserId === technicianUserId &&
      (s.occurrenceDate === date || s.startsAt.slice(0, 10) === date),
  );

  if (!techShifts.length) return null;

  return (
    <div className="flex flex-wrap gap-0.5">
      {techShifts.map((s) => (
        <span
          key={s.id}
          className="rounded bg-blue-50 px-1 py-0.5 text-[10px] font-medium text-blue-700 leading-none"
          title={s.label ?? s.shiftSubtype ?? "Scheduled shift"}
          data-testid={`shift-overlay-${s.id}`}
        >
          {toLocalTimeLabel(s.startsAt)}–{toLocalTimeLabel(s.endsAt)}
        </span>
      ))}
    </div>
  );
}
