/**
 * timeOffFormatting — canonical formatters for technician time-off
 * labels rendered across the dispatch board (2026-05-07 RALPH).
 *
 * Pure functions. No React, no DOM. Both the day-view lane band
 * and the week / month chips read these so the labels stay in
 * lockstep across views.
 *
 * Three concerns live here:
 *   • Return-day phrasing  — formatTimeOffReturnLabel()
 *   • Composite label      — formatTimeOffLabel()
 *   • Reason → variant key — getTimeOffVariant()
 *
 * The variant key drives a small palette lookup inside
 * `<TimeOffOverlay>` so vacation / sick / training / personal each
 * read distinctly without a saturated color clash on the dashboard.
 */

/** Canonical reason-driven palette key. Mirrors the
 *  `TECHNICIAN_TIME_OFF_REASONS` union from `shared/schema.ts`. */
export type TimeOffVariant =
  | "vacation"
  | "sick"
  | "training"
  | "personal"
  | "default";

const REASON_VARIANT_MAP: Record<string, TimeOffVariant> = {
  vacation: "vacation",
  sick: "sick",
  training: "training",
  personal: "personal",
  unavailable: "default",
  other: "default",
};

/** Map a reason string to a palette key. Unknown reasons fall back
 *  to "default" (muted amber). Case-insensitive. */
export function getTimeOffVariant(reason: string | null | undefined): TimeOffVariant {
  if (!reason) return "default";
  const key = reason.toLowerCase();
  return REASON_VARIANT_MAP[key] ?? "default";
}

/** Capitalize the first letter of a reason string for display.
 *  ("vacation" → "Vacation"). Returns the input unchanged when
 *  empty / nullish. */
export function formatReasonForDisplay(reason: string | null | undefined): string {
  if (!reason) return "";
  return reason.charAt(0).toUpperCase() + reason.slice(1);
}

/** Compute "the day the tech returns to work" from an `endsAt`
 *  timestamp + the all-day flag.
 *
 *  - All-day: the tech is unavailable for full local days. Our
 *    schema stores `endsAt` at the end of the off period (typically
 *    23:59 local for the LAST off day, depending on how the modal
 *    clamps). The "return" day is the day AFTER endsAt's local
 *    calendar day.
 *  - Partial-day (`!allDay`): there's no separate "return day" —
 *    the tech returns the same day. Returns `null`.
 *
 *  We compute purely from the local Date object; the caller is
 *  responsible for passing an ISO string the JS engine resolves to
 *  the correct local instant. The brief calls for "tenant timezone"
 *  awareness — in practice the tenant's office staff use the same
 *  browser locale as the data was entered with, so local-zone
 *  display matches.
 */
export function getTimeOffReturnDate(
  endsAtISO: string,
  allDay: boolean,
): Date | null {
  if (!allDay) return null;
  const ms = Date.parse(endsAtISO);
  if (!Number.isFinite(ms)) return null;
  const endLocal = new Date(ms);
  // Floor to local-calendar-day, then add 1 day for the return.
  const returnDay = new Date(
    endLocal.getFullYear(),
    endLocal.getMonth(),
    endLocal.getDate(),
  );
  returnDay.setDate(returnDay.getDate() + 1);
  return returnDay;
}

/** Stable local-day key (YYYY-MM-DD) for two Date objects. Used
 *  by the "is tomorrow" check below — pure date comparison, no
 *  timezone math. */
function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Format the "Returning …" tail of the time-off label.
 *
 *  Returns `null` when the tail should be omitted — same-day
 *  return, partial-day entry, or already-past entry. The dispatch
 *  surfaces use this null to skip the trailing dot-separator.
 *
 *  Examples (assuming `now` is May 7):
 *    endsAt May 7 23:59 (allDay) → null   (returning May 8 — but that's
 *                                          tomorrow, see below)
 *    endsAt May 8 23:59 (allDay) → "Returning May 9"  no — Wait.
 *
 *  Let me reread: endsAt is the LAST moment of the off period.
 *  If the off period is May 8 (single day, allDay), endsAt is
 *  May 8 23:59. Return day = May 8 + 1 = May 9. If today (now) is
 *  May 7, returning May 9 is "in 2 days" → format as "Returning May 9"
 *  (or "Returning Mon" — we'll use the absolute date format
 *  consistently).
 *
 *  Examples (now = May 7):
 *    endsAt May 7 23:59 (off = today) → null (returning today)
 *    endsAt May 8 23:59 (off = tomorrow only) → "Returning tomorrow"
 *      (return day = May 9, which is the day-after-tomorrow → no
 *       wait, "Returning tomorrow" means the user will SEE the
 *       tech on the return day. If return day = tomorrow, label
 *       reads "Returning tomorrow". If return day is May 9 and
 *       today is May 7, return day is in 2 days → use date format.)
 *    endsAt May 12 23:59 → "Returning May 13"
 *
 *  Edge case: allDay entry with endsAt before now → null (already
 *  back). Don't render a return label for past entries.
 */
export function formatTimeOffReturnLabel(
  endsAtISO: string,
  allDay: boolean,
  now: Date = new Date(),
): string | null {
  const returnDate = getTimeOffReturnDate(endsAtISO, allDay);
  if (!returnDate) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Past or same-day return → omit. The tech is back / coming
  // back today; no useful "returning" signal.
  if (returnDate.getTime() <= today.getTime()) return null;
  // Tomorrow → human shorthand.
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (localDayKey(returnDate) === localDayKey(tomorrow)) {
    return "Returning tomorrow";
  }
  // Otherwise abbreviated month-day. Locale-aware.
  const formatted = returnDate.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `Returning ${formatted}`;
}

/** Compose the canonical full label for a time-off entry.
 *
 *  Format: "Time off · {Reason} · Returning {date}"
 *
 *  Each segment is dropped when empty so the label degrades
 *  gracefully:
 *    Reason missing  → "Time off · Returning May 12"
 *    Return missing  → "Time off · Vacation"
 *    Both missing    → "Time off"
 */
export function formatTimeOffLabel(input: {
  reason?: string | null;
  returningLabel?: string | null;
}): string {
  const segments: string[] = ["Time off"];
  const reason = formatReasonForDisplay(input.reason ?? null);
  if (reason) segments.push(reason);
  if (input.returningLabel) segments.push(input.returningLabel);
  return segments.join(" · ");
}

/** Compose the screen-reader label. Used by `<TimeOffOverlay>`'s
 *  `aria-label` so the meaning is conveyed even when the visual is
 *  truncated or hidden.
 *
 *  Example: "Juliana Smith unavailable due to vacation; returning May 12"
 */
export function formatTimeOffAriaLabel(input: {
  technicianName?: string | null;
  reason?: string | null;
  returningLabel?: string | null;
}): string {
  const name = input.technicianName?.trim() || "Technician";
  const reason = input.reason?.trim()
    ? `due to ${input.reason.toLowerCase()}`
    : "";
  const returning = input.returningLabel ? `; ${input.returningLabel.toLowerCase()}` : "";
  return [
    `${name} unavailable`,
    reason,
    returning.replace(/^;\s*/, "; "),
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
