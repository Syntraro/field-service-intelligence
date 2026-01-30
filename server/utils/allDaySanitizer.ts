/**
 * All-Day Timestamp Sanitizer
 *
 * Shared utility that replaces JavaScript Date objects with UTC-safe SQL
 * expressions for scheduledStart/scheduledEnd when isAllDay=true.
 *
 * This prevents the node-pg driver from serializing Date objects using
 * local-timezone getHours()/getMinutes()/getSeconds(), which can produce
 * incorrect timestamp values on non-UTC servers — violating the
 * jobs_all_day_end_2359_check constraint.
 *
 * MUST be called right before every DB write that may set all-day timestamps.
 * Used by both server/storage/calendar.ts and server/storage/jobs.ts.
 */
import { sql } from "drizzle-orm";
import { IS_DEV } from "./devFlags";

/**
 * Convert a Date to a Drizzle SQL expression that casts the ISO string
 * directly as a PostgreSQL timestamp, bypassing node-pg Date serialization.
 */
export function forceUTCTimestamp(date: Date) {
  return sql`${date.toISOString()}::timestamp`;
}

/**
 * DEV-only assertion: when isAllDay, the UTC ISO strings must have
 * exact midnight start (T00:00:00.000Z) and end-of-day end (T23:59:59.000Z).
 * Catches domain-layer bugs before they hit the DB CHECK constraints.
 */
export function assertAllDayUTCBoundaries(startDate: Date | null, endDate: Date | null, jobId: string): void {
  if (!IS_DEV) return;

  if (startDate) {
    const iso = startDate.toISOString();
    if (!iso.endsWith('T00:00:00.000Z')) {
      console.error(
        `[ALLDAY ASSERT FAIL] jobId=${jobId} scheduledStart ISO does not end with T00:00:00.000Z: ${iso}`
      );
    }
  }

  if (endDate) {
    const iso = endDate.toISOString();
    if (!iso.endsWith('T23:59:59.000Z')) {
      console.error(
        `[ALLDAY ASSERT FAIL] jobId=${jobId} scheduledEnd ISO does not end with T23:59:59.000Z: ${iso}`
      );
    }
  }
}

/**
 * Sanitize updateData in-place: replace Date objects with UTC-safe SQL
 * expressions for scheduledStart/scheduledEnd when isAllDay=true.
 *
 * MUST be called right before every DB write that may set all-day timestamps.
 * Emits a DEV log + regression assertion for observability.
 */
export function sanitizeAllDayTimestamps(updateData: any, jobId: string): void {
  if (IS_DEV) {
    console.log('[SANITIZE-DEBUG] sanitizeAllDayTimestamps called:', {
      isAllDay: updateData.isAllDay,
      isAllDayStrictEquals: updateData.isAllDay === true,
      hasScheduledEnd: 'scheduledEnd' in updateData,
      scheduledEndType: updateData.scheduledEnd?.constructor?.name ?? typeof updateData.scheduledEnd,
    });
  }

  if (updateData.isAllDay !== true) return;

  const startDate = updateData.scheduledStart instanceof Date ? updateData.scheduledStart : null;
  const endDate = updateData.scheduledEnd instanceof Date ? updateData.scheduledEnd : null;

  // DEV: Assert boundaries BEFORE replacing with SQL expressions
  assertAllDayUTCBoundaries(startDate, endDate, jobId);

  if (startDate) {
    updateData.scheduledStart = forceUTCTimestamp(startDate);
  }
  if (endDate) {
    updateData.scheduledEnd = forceUTCTimestamp(endDate);
  }

  if (IS_DEV) {
    console.log('[SANITIZE-DEBUG] After replacement:', {
      scheduledEndType: updateData.scheduledEnd?.constructor?.name ?? typeof updateData.scheduledEnd,
    });
    console.log('[SCHEDULE ALLDAY]', {
      jobId,
      scheduledStartIso: startDate?.toISOString() ?? 'null',
      scheduledEndIso: endDate?.toISOString() ?? 'null',
    });
  }
}
