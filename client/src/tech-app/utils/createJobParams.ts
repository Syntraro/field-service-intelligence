/**
 * Query-param parsing and validation for CreateJobPage prefill.
 *
 * Extracted for testability — pure URLSearchParams → validated values.
 */

const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RE_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CreateJobPrefill {
  locationId: string;
  /** Empty string when the raw value is not a valid UUID. */
  technicianId: string;
  /** Empty string when the raw value is not a valid YYYY-MM-DD. */
  date: string;
  /** Empty string when the raw value is not a valid HH:MM (24-hour). */
  startTime: string;
  /** Minimum 15 min; defaults to 60 when missing or non-numeric. */
  duration: number;
  /** True only when both date and startTime are valid — auto-activates Schedule Now. */
  hasSchedulePrefill: boolean;
}

export function parseCreateJobParams(qs: URLSearchParams): CreateJobPrefill {
  const locationId = qs.get("locationId") ?? "";

  const rawTechId = qs.get("technicianId") ?? "";
  const technicianId = RE_UUID.test(rawTechId) ? rawTechId : "";

  const rawDate = qs.get("date") ?? "";
  const date = RE_DATE.test(rawDate) ? rawDate : "";

  const rawTime = qs.get("startTime") ?? "";
  const startTime = RE_TIME.test(rawTime) ? rawTime : "";

  const rawDuration = qs.get("duration") ?? "";
  const parsed = parseInt(rawDuration, 10);
  const duration = Number.isFinite(parsed) && parsed >= 15 ? parsed : 60;

  return {
    locationId,
    technicianId,
    date,
    startTime,
    duration,
    hasSchedulePrefill: !!(date && startTime),
  };
}
