/**
 * Hook and helpers for company regional settings (timezone, dateFormat, timeFormat, weekStartsOn).
 *
 * Settings are fetched from /api/company-settings and cached for 5 minutes.
 * Calendar components consume these to render locale-aware grids, hour labels, and "today" markers.
 */
import { useQuery } from "@tanstack/react-query";

export interface RegionalSettings {
  timezone: string;
  dateFormat: "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD";
  timeFormat: "12h" | "24h";
  weekStartsOn: "monday" | "sunday";
}

const DEFAULTS: RegionalSettings = {
  timezone: "America/Toronto",
  dateFormat: "MM/DD/YYYY",
  timeFormat: "12h",
  weekStartsOn: "monday",
};

/**
 * Returns the company's regional settings, falling back to sensible defaults
 * while the query is loading or if values are missing.
 */
export function useCompanyRegionalSettings(): RegionalSettings {
  const { data } = useQuery<Record<string, unknown>>({
    queryKey: ["/api/company-settings"],
    staleTime: 5 * 60_000,
  });
  return {
    timezone: (data?.timezone as string) || DEFAULTS.timezone,
    dateFormat: (data?.dateFormat as RegionalSettings["dateFormat"]) || DEFAULTS.dateFormat,
    timeFormat: (data?.timeFormat as RegionalSettings["timeFormat"]) || DEFAULTS.timeFormat,
    weekStartsOn: (data?.weekStartsOn as RegionalSettings["weekStartsOn"]) || DEFAULTS.weekStartsOn,
  };
}

/**
 * Convert "now" to the company timezone for "today" determination.
 *
 * Uses Intl.DateTimeFormat to extract year/month/day/hour/minute in the target
 * timezone, then constructs a local Date from those parts.  This avoids adding
 * a timezone library dependency.
 */
export function nowInTimezone(tz: string): Date {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return new Date(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
}

/**
 * Format an hour number (0-23) as a display label respecting the time format.
 *
 * 12h: "12 AM", "1 AM", ... "12 PM", "1 PM", ... "11 PM"
 * 24h: "00:00", "01:00", ... "23:00"
 */
export function formatHourLabel(hour: number, timeFormat: "12h" | "24h"): string {
  if (timeFormat === "24h") {
    return `${String(hour).padStart(2, "0")}:00`;
  }
  if (hour === 0) return "12 AM";
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return "12 PM";
  return `${hour - 12} PM`;
}
