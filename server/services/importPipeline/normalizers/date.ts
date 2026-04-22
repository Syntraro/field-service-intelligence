/**
 * Canonical date parser for CSV imports — timezone-aware.
 *
 * 2026-04-21: Replaces the legacy job-import usage of `new Date(string)`,
 * which was timezone-naive: the browser/server environment silently
 * decided whether "2024-01-15" meant UTC midnight or local midnight,
 * producing off-by-one `createdAt`/`closedAt` values for non-UTC tenants.
 *
 * This module accepts an explicit tenant IANA timezone and interprets
 * date-only strings as wall-clock midnight in that zone. Full timestamp
 * strings with an offset are left as-is (the offset is authoritative).
 *
 * Supported inputs (in priority order):
 *   1. ISO 8601 with offset or Z — parsed natively (offset authoritative).
 *   2. ISO 8601 date-only "YYYY-MM-DD"       — tenant-tz midnight.
 *   3. "YYYY/MM/DD"                          — tenant-tz midnight.
 *   4. "MM/DD/YYYY" or "M/D/YYYY"            — tenant-tz midnight.
 *   5. "DD-MMM-YYYY" e.g. "15-Jan-2024"      — tenant-tz midnight.
 *   6. "Mon DD, YYYY" e.g. "Jan 15, 2024"    — tenant-tz midnight.
 *
 * Anything else yields null — adapters decide whether that's a warning
 * or an error.
 */

const MONTHS: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

/**
 * Parse a CSV date cell into a concrete UTC Date, interpreting date-only
 * values as wall-clock midnight in the tenant's IANA timezone.
 *
 * @param val       Raw cell value.
 * @param timezone  Tenant IANA timezone (e.g. "America/Toronto"). When
 *                  missing, date-only values are interpreted as UTC — the
 *                  same naive behavior as the legacy parser. Adapters
 *                  should always pass a timezone; this fallback exists
 *                  only for tests and for tenants without a configured zone.
 */
export function parseDate(val: string | null | undefined, timezone?: string | null): Date | null {
  if (val === null || val === undefined) return null;
  const raw = val.trim();
  if (raw === "") return null;

  // 1. ISO with offset or Z — native parse is authoritative.
  if (/T\d{2}:\d{2}/.test(raw) && /(Z|[+-]\d{2}:?\d{2})$/.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // 2. ISO date-only: YYYY-MM-DD
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (m) return dateInZone(+m[1], +m[2] - 1, +m[3], timezone);

  // 3. YYYY/MM/DD
  m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(raw);
  if (m) return dateInZone(+m[1], +m[2] - 1, +m[3], timezone);

  // 4. M/D/YYYY or MM/DD/YYYY
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (m) return dateInZone(+m[3], +m[1] - 1, +m[2], timezone);

  // 5. DD-MMM-YYYY (e.g. "15-Jan-2024")
  m = /^(\d{1,2})-([A-Za-z]{3,})-(\d{4})$/.exec(raw);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month === undefined) return null;
    return dateInZone(+m[3], month, +m[1], timezone);
  }

  // 6. "Mon DD, YYYY" / "Month DD, YYYY"
  m = /^([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})$/.exec(raw);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    if (month === undefined) return null;
    return dateInZone(+m[3], month, +m[2], timezone);
  }

  return null;
}

/**
 * Build a Date representing wall-clock midnight (00:00:00.000) on
 * `year/month/day` in the supplied IANA timezone.
 *
 * Implementation: we build a UTC Date at the nominal midnight, ask what
 * that instant looks like in the target zone, and subtract the offset.
 * This avoids depending on any timezone library while still honoring DST.
 */
function dateInZone(year: number, month: number, day: number, timezone: string | null | undefined): Date | null {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 0 || month > 11) return null;
  if (day < 1 || day > 31) return null;

  if (!timezone) {
    // Legacy fallback: UTC midnight.
    const d = new Date(Date.UTC(year, month, day));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Start with UTC midnight for the target calendar date.
  const nominal = Date.UTC(year, month, day);

  // Ask Intl what `nominal` looks like in the target zone.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(nominal));

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const wallYear = +get("year");
  const wallMonth = +get("month") - 1;
  const wallDay = +get("day");
  const wallHour = get("hour") === "24" ? 0 : +get("hour");
  const wallMinute = +get("minute");
  const wallSecond = +get("second");

  const wallAsUTC = Date.UTC(wallYear, wallMonth, wallDay, wallHour, wallMinute, wallSecond);
  const offsetMs = wallAsUTC - nominal;

  // Subtract the offset so the produced instant, re-formatted in the
  // target zone, reads as midnight on the requested date.
  const result = new Date(nominal - offsetMs);
  return Number.isNaN(result.getTime()) ? null : result;
}

/**
 * Convenience: parse a CSV cell and return an ISO string or null. Useful
 * when an adapter wants to store dates as ISO strings in the normalized
 * row payload (round-trips cleanly through JSON).
 */
export function parseDateISO(val: string | null | undefined, timezone?: string | null): string | null {
  const d = parseDate(val, timezone);
  return d ? d.toISOString() : null;
}
