/**
 * Shared duration/time helpers for time entry modals.
 * Both TimeEntryModal (job detail) and any future consumer can import from here.
 */

/** Given start HH:mm and duration h+m, return the computed end time HH:mm. */
export function computeEndTime(startTime: string, hours: number, minutes: number): string {
  if (!startTime) return "";
  const [sh, sm] = startTime.split(":").map(Number);
  const totalMin = sh * 60 + sm + (hours * 60 + minutes);
  const eh = Math.floor(totalMin / 60) % 24;
  const em = totalMin % 60;
  return `${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`;
}

/** Given start HH:mm and end HH:mm, return hours + minutes of the gap. */
export function computeDuration(
  startTime: string,
  endTime: string,
): { hours: number; minutes: number } {
  if (!startTime || !endTime) return { hours: 0, minutes: 0 };
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  let diffMin = eh * 60 + em - (sh * 60 + sm);
  if (diffMin < 0) diffMin = 0;
  return { hours: Math.floor(diffMin / 60), minutes: diffMin % 60 };
}

/** Combine a YYYY-MM-DD date and HH:mm time into an ISO 8601 string. */
export function toISODateTime(dateStr: string, timeStr: string): string {
  if (!dateStr || !timeStr) return "";
  return new Date(`${dateStr}T${timeStr}`).toISOString();
}
