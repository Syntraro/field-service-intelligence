/**
 * Time helpers for the Day View create + edit modals (2026-05-05).
 *
 * Canonical representation: `"HH:mm"` (24-hour, zero-padded) — the
 * same shape `<input type="time">` produces, so values flow through
 * the modal state unchanged.
 *
 * Earlier revisions of this file shipped `parseTimeInput` and
 * `formatTimeDisplay` to support a custom text-based time field. That
 * field was reverted in favour of `<input type="time">` (browser-
 * native structured picker, locale-aware AM/PM display), so those
 * helpers became dead and have been removed.
 */

/**
 * Add a number of minutes to a 24-hour `"HH:mm"` string and return the
 * resulting 24-hour `"HH:mm"`. Wraps within a single 24-hour day; the
 * Day View create modal assumes same-day entries (no midnight rollover).
 *
 * Used by:
 *   - End-time autofill (start changes → end = start + 60).
 *   - Drive→on-site prefill (on-site start = drive end → on-site end +60).
 *   - Duration → End sync in handleRowDurationChange.
 */
export function addMinutesToTime(time24: string, minutes: number): string {
  const m = time24.match(/^(\d{2}):(\d{2})$/);
  if (!m) return time24;
  const totalMin =
    (parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + minutes + 24 * 60) %
    (24 * 60);
  const h = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

// ── Segmented input helpers ─────────────────────────────────────────
//
// SegmentedTimeInput renders three direct fields (H | M | AM/PM
// toggle) instead of a browser-native time picker. The canonical
// `"HH:mm"` 24h value flows in via `value` and out via `onChange`;
// these helpers are the only conversion layer between canonical and
// the segmented display.

export type Period = "AM" | "PM";

export interface TimeSegments {
  h12: string;   // "" or "1".."12"
  min: string;   // "" or "00".."59"
  period: Period;
}

/** Decompose a 24h "HH:mm" value into 12-hour segments. Empty / invalid
 *  input returns `{ h12: "", min: "", period: "AM" }` (period defaults
 *  to AM so the toggle button still has a value to render). */
export function valueToSegments(value: string): TimeSegments {
  if (!value) return { h12: "", min: "", period: "AM" };
  const m = value.match(/^(\d{2}):(\d{2})$/);
  if (!m) return { h12: "", min: "", period: "AM" };
  const h24 = parseInt(m[1], 10);
  const min = m[2];
  if (Number.isNaN(h24) || h24 < 0 || h24 > 23) {
    return { h12: "", min: "", period: "AM" };
  }
  const period: Period = h24 < 12 ? "AM" : "PM";
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return { h12: String(h12), min, period };
}

/** Recompose 12h segments back into canonical 24h "HH:mm". Returns ""
 *  when any segment is missing or out of range — caller treats that
 *  as "value not yet committed". */
export function segmentsToValue(
  h12: string,
  min: string,
  period: Period,
): string {
  if (!h12 || !min) return "";
  const h = parseInt(h12, 10);
  const m = parseInt(min, 10);
  if (Number.isNaN(h) || h < 1 || h > 12) return "";
  if (Number.isNaN(m) || m < 0 || m > 59) return "";
  let h24 = h;
  if (period === "AM" && h24 === 12) h24 = 0;
  if (period === "PM" && h24 < 12) h24 += 12;
  return `${String(h24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
