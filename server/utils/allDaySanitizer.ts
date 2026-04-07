/**
 * Scheduling Timestamp Sanitizer
 *
 * Shared utility that replaces JavaScript Date objects with UTC-safe SQL
 * expressions for all scheduling timestamp columns.
 *
 * This prevents the node-pg driver from serializing Date objects using
 * local-timezone getHours()/getMinutes()/getSeconds(), which can produce
 * incorrect timestamp values on non-UTC servers — violating CHECK constraints
 * for all-day events and causing visual drift for timed events (the dispatch
 * board drag/drop bug where 2 PM renders as 6 PM after refetch).
 *
 * MUST be called right before every DB write that sets scheduling timestamps.
 * Covers all scheduling entities: jobs, job_visits, and tasks.
 *
 * Belt-and-suspenders alongside process.env.TZ = 'UTC' (server/index.ts)
 * and SET timezone = 'UTC' (server/db.ts pool connect handler).
 */
import { sql } from "drizzle-orm";
import { IS_DEV } from "./devFlags";

/**
 * Convert a Date to a Drizzle SQL expression that casts the ISO string
 * directly as a PostgreSQL timestamp, bypassing node-pg Date serialization.
 *
 * This is the CANONICAL UTC-safe timestamp write mechanism.
 * Date.toISOString() always returns UTC (e.g. "2026-04-05T18:00:00.000Z").
 * The ::timestamp cast tells PostgreSQL to parse the ISO string directly,
 * stripping the Z and storing the UTC components — deterministic regardless
 * of server or session timezone.
 */
export function forceUTCTimestamp(date: Date) {
  return sql`${date.toISOString()}::timestamp`;
}

/**
 * DEV-only assertion: when isAllDay, the UTC ISO strings must have
 * exact midnight start (T00:00:00.000Z) and end-of-day end (T23:59:59.000Z).
 * Catches domain-layer bugs before they hit the DB CHECK constraints.
 */
export function assertAllDayUTCBoundaries(startDate: Date | null, endDate: Date | null, entityId: string): void {
  if (!IS_DEV) return;

  if (startDate) {
    const iso = startDate.toISOString();
    if (!iso.endsWith('T00:00:00.000Z')) {
      console.error(
        `[ALLDAY ASSERT FAIL] entityId=${entityId} scheduledStart ISO does not end with T00:00:00.000Z: ${iso}`
      );
    }
  }

  if (endDate) {
    const iso = endDate.toISOString();
    if (!iso.endsWith('T23:59:59.000Z')) {
      console.error(
        `[ALLDAY ASSERT FAIL] entityId=${entityId} scheduledEnd ISO does not end with T23:59:59.000Z: ${iso}`
      );
    }
  }
}

// ============================================================================
// Scheduling timestamp field sets — single source of truth for field names
// ============================================================================

/** Fields used by jobs and job_visits tables */
const JOB_SCHEDULE_FIELDS = ["scheduledStart", "scheduledEnd", "scheduledDate"] as const;
/** Fields used by tasks table */
const TASK_SCHEDULE_FIELDS = ["scheduledStartAt", "scheduledEndAt"] as const;

/**
 * Sanitize scheduling timestamps in-place: replace Date objects with UTC-safe
 * SQL expressions for ALL scheduling timestamp columns (timed AND all-day).
 *
 * MUST be called right before every DB write that sets scheduling timestamps
 * on jobs, job_visits, or tasks tables.
 *
 * For all-day events, additionally asserts UTC midnight/end-of-day boundaries.
 */
export function sanitizeSchedulingTimestamps(updateData: any, entityId: string): void {
  const isAllDay = updateData.isAllDay === true || updateData.allDay === true;

  // All-day boundary assertions (DEV only)
  if (isAllDay) {
    const startDate = updateData.scheduledStart instanceof Date ? updateData.scheduledStart : null;
    const endDate = updateData.scheduledEnd instanceof Date ? updateData.scheduledEnd : null;
    assertAllDayUTCBoundaries(startDate, endDate, entityId);
  }

  // Replace Date objects with UTC-safe SQL expressions across all scheduling fields
  for (const field of JOB_SCHEDULE_FIELDS) {
    if (updateData[field] instanceof Date) {
      updateData[field] = forceUTCTimestamp(updateData[field]);
    }
  }
  for (const field of TASK_SCHEDULE_FIELDS) {
    if (updateData[field] instanceof Date) {
      updateData[field] = forceUTCTimestamp(updateData[field]);
    }
  }
}

/**
 * Legacy alias — preserved for existing callsites.
 * Delegates to the unified sanitizeSchedulingTimestamps.
 */
export function sanitizeAllDayTimestamps(updateData: any, jobId: string): void {
  sanitizeSchedulingTimestamps(updateData, jobId);
}

// ============================================================================
// UTC-safe READ path — canonical timestamp-without-timezone parser
// ============================================================================

/**
 * Parse a `timestamp without time zone` value from the pg driver into a Date
 * that represents UTC, regardless of the server process timezone.
 *
 * The pg driver's default type parser for OID 1114 (timestamp without tz)
 * creates Date objects using `new Date(year, month, day, hour, ...)` which
 * interprets the components in the process-local timezone. On non-UTC servers
 * this silently shifts the Date. And `process.env.TZ = "UTC"` set at runtime
 * in ESM modules does not reliably override this because ESM hoists imports
 * before module body code.
 *
 * This function normalizes the value to a correct UTC Date by:
 * - If the value is a Date: extract UTC-equivalent components via getTime()
 *   offset correction, OR more reliably, re-parse the ISO string.
 * - If the value is a string: parse it as UTC explicitly.
 *
 * Since forceUTCTimestamp() writes values as UTC hours (e.g. "18:00:00" for
 * 2 PM EDT), and the pg driver may read "18:00:00" as local time, we need to
 * extract the raw hour/minute/second and reconstruct as UTC.
 *
 * CANONICAL: All scheduling read paths MUST use this for timestamp-without-tz.
 */
export function parseTimestampAsUTC(value: Date | string | null): Date | null {
  if (value == null) return null;

  if (typeof value === "string") {
    // Raw string from pg like "2026-04-05 18:00:00" or ISO "2026-04-05T18:00:00.000Z"
    // If it already has a Z or offset, Date.parse handles it correctly.
    // If it lacks timezone info, we must interpret it as UTC.
    if (value.includes("Z") || value.includes("+") || /T\d{2}:\d{2}:\d{2}[+-]/.test(value)) {
      return new Date(value);
    }
    // No timezone info — treat the literal time components as UTC
    // "2026-04-05 18:00:00" → "2026-04-05T18:00:00.000Z"
    const normalized = value.replace(" ", "T");
    return new Date(normalized.endsWith("Z") ? normalized : normalized + "Z");
  }

  // Date object from pg driver — the driver interpreted the raw timestamp string
  // in process-local time. We need the raw components (which ARE the UTC values
  // stored by forceUTCTimestamp). Extract them using the LOCAL accessors (which
  // is what the driver used to construct the Date) and reconstruct as UTC.
  //
  // Example: DB has "18:00:00". Driver on EDT server does new Date(2026,3,5,18,0,0)
  // which creates 18:00 EDT = 22:00 UTC. We need 18:00 UTC.
  // getHours() returns 18 (the EDT hour the driver used). Date.UTC(2026,3,5,18,0,0)
  // gives us the correct 18:00 UTC instant.
  return new Date(Date.UTC(
    value.getFullYear(),
    value.getMonth(),
    value.getDate(),
    value.getHours(),
    value.getMinutes(),
    value.getSeconds(),
    value.getMilliseconds(),
  ));
}
