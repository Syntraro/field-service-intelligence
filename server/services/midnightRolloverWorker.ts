/**
 * Midnight rollover auto-pause worker (2026-04-16).
 *
 * Prevents technician labour timers from running across tenant-local
 * calendar days while preserving unfinished work. When the sweep runs,
 * any `time_entries` row that is still open (`end_at IS NULL`) and
 * whose `start_at` fell on a tenant-local calendar day BEFORE the
 * tenant's current local date is:
 *
 *   1. Closed at 23:59:59.999 local time of the calendar day it
 *      started in, with `duration_minutes` computed canonically.
 *   2. Stamped with `auto_paused_at = now()` so downstream reports
 *      can distinguish rollover auto-pause from a manual stop.
 *   3. Left attached to its original `job_id` / `visit_id` — the
 *      job and the visit are NOT completed, NOT closed. Resume on
 *      the next day is a normal "start a new time entry" action.
 *   4. Announced to the technician via a single `notifications`
 *      row keyed by `dedupeKey = time_entry_auto_paused:<entryId>`
 *      so the worker is idempotent under re-run (same entry won't
 *      produce a second banner).
 *
 * The worker is a lightweight scan — it selects only tenants that
 * currently have an open time entry (via a `GROUP BY company_id`) and
 * only those entries whose `start_at` is older than the tenant's
 * current local midnight. Sweep cadence (15 minutes) is tight enough
 * to minimise the lag between midnight and the banner while cheap to
 * run; the worker is idempotent so jitter is harmless.
 *
 * This worker does NOT replace the read-time running-state guard in
 * `getJobTimeSummary` (2026-04-16 earlier today). The guard continues
 * to suppress ghost "active" badges in the UI during the small window
 * between midnight and the next sweep; the worker closes the data.
 *
 * Orphaned entries (visit soft-deleted while timer open, etc.) are
 * handled by the same code path as legitimate rollovers — they get
 * closed with the same `auto_paused_at` stamp. Orphans do NOT receive
 * a technician banner: if the linked visit is no longer active, there
 * is nothing for the tech to resume, and we do not want to spam users
 * with notifications about internal data drift.
 */

import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db";
import {
  timeEntries,
  companySettings,
  notifications,
  jobVisits,
} from "@shared/schema";
import { DEFAULT_TIMEZONE, isValidTimezone } from "../domain/scheduling";

// ---------------------------------------------------------------------------
// Scheduling constants — align with subscription/invoice-reminder workers.
// ---------------------------------------------------------------------------

/** Delay before the first sweep after boot. Keeps startup fast and avoids
 *  piling work into the first few seconds of a fresh process. */
const STARTUP_DELAY_MS = 60 * 1000;

/** Between sweeps. 15 minutes is tight enough that the banner latency from
 *  tenant-local midnight to a tech opening the app stays under a quarter
 *  hour across every supported timezone, while cheap to run. */
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

let startupTimeout: NodeJS.Timeout | null = null;
let intervalHandle: NodeJS.Timeout | null = null;

// ---------------------------------------------------------------------------
// Timezone helpers — localised here to avoid pulling `date-fns-tz` for two
// operations that `Intl.DateTimeFormat` handles natively.
// ---------------------------------------------------------------------------

/** YYYY-MM-DD of `date` rendered in the given IANA timezone. */
function localDateYMD(date: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

/** UTC offset (minutes) in effect at the given UTC instant for `tz`. */
function tzOffsetMinutes(atUtc: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "longOffset",
  });
  const offsetToken = fmt
    .formatToParts(atUtc)
    .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{2}):?(\d{2})/.exec(offsetToken);
  if (!m) return 0;
  const sign = m[1] === "+" ? 1 : -1;
  return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
}

/** Given a local-YMD and an IANA TZ, return the UTC instant for
 *  `YMD 23:59:59.999` at that local wall-clock. Anchored at local noon
 *  (a DST-safe point) to read the offset, then back-computed. */
function endOfLocalDayUtc(ymd: string, tz: string): Date {
  const anchor = new Date(`${ymd}T12:00:00Z`);
  const offsetMin = tzOffsetMinutes(anchor, tz);
  const localEndAsUtc = new Date(`${ymd}T23:59:59.999Z`);
  return new Date(localEndAsUtc.getTime() - offsetMin * 60_000);
}

/** Given a local-YMD and an IANA TZ, return the UTC instant for
 *  `YMD 00:00:00.000` at that local wall-clock (i.e. start of local day). */
function startOfLocalDayUtc(ymd: string, tz: string): Date {
  const anchor = new Date(`${ymd}T12:00:00Z`);
  const offsetMin = tzOffsetMinutes(anchor, tz);
  const localStartAsUtc = new Date(`${ymd}T00:00:00.000Z`);
  return new Date(localStartAsUtc.getTime() - offsetMin * 60_000);
}

// ---------------------------------------------------------------------------
// Core sweep
// ---------------------------------------------------------------------------

export interface MidnightRolloverResult {
  /** Number of tenants that had at least one open entry to consider. */
  tenantsScanned: number;
  /** Number of time entries closed by this sweep. */
  entriesClosed: number;
  /** Number of technician notifications inserted. Orphaned entries are
   *  closed but skip the notification — this count therefore reflects
   *  user-facing banners only. */
  notificationsSent: number;
}

/** Run one full sweep across all tenants. Safe to call manually in tests
 *  or ops scripts — all work is idempotent via the dedupeKey and the
 *  `end_at IS NULL` write-guard. */
export async function runMidnightRollover(): Promise<MidnightRolloverResult> {
  const tenants = await db
    .selectDistinct({ companyId: timeEntries.companyId })
    .from(timeEntries)
    .where(isNull(timeEntries.endAt));

  let entriesClosed = 0;
  let notificationsSent = 0;

  for (const { companyId } of tenants) {
    try {
      const result = await sweepTenant(companyId);
      entriesClosed += result.closed;
      notificationsSent += result.notified;
    } catch (err) {
      console.error(
        `[midnightRollover] tenant sweep failed (companyId=${companyId}):`,
        err,
      );
    }
  }

  return {
    tenantsScanned: tenants.length,
    entriesClosed,
    notificationsSent,
  };
}

async function resolveTenantTimezone(companyId: string): Promise<string> {
  const rows = await db
    .select({ tz: companySettings.timezone })
    .from(companySettings)
    .where(eq(companySettings.companyId, companyId))
    .limit(1);
  const raw = rows[0]?.tz ?? null;
  return raw && isValidTimezone(raw) ? raw : DEFAULT_TIMEZONE;
}

async function sweepTenant(
  companyId: string,
): Promise<{ closed: number; notified: number }> {
  const tz = await resolveTenantTimezone(companyId);
  const now = new Date();
  const todayLocal = localDateYMD(now, tz);
  const todayStartUtc = startOfLocalDayUtc(todayLocal, tz);

  // Any open entry that started before today's local midnight must be
  // closed at the 23:59:59.999 of the day it started in. Join against
  // `job_visits` so we can short-circuit notifications for orphaned
  // entries (visit soft-deleted while timer open) — those are closed
  // silently per the "do not alert users about internal bugs/orphans"
  // constraint in the feature spec.
  const openPriorDay = await db
    .select({
      id: timeEntries.id,
      technicianId: timeEntries.technicianId,
      startAt: timeEntries.startAt,
      jobId: timeEntries.jobId,
      visitId: timeEntries.visitId,
      taskId: timeEntries.taskId,
      visitIsActive: jobVisits.isActive,
    })
    .from(timeEntries)
    .leftJoin(jobVisits, eq(timeEntries.visitId, jobVisits.id))
    .where(
      and(
        eq(timeEntries.companyId, companyId),
        isNull(timeEntries.endAt),
        lt(timeEntries.startAt, todayStartUtc),
      ),
    );

  if (openPriorDay.length === 0) {
    return { closed: 0, notified: 0 };
  }

  const autoPausedAt = new Date();
  let closed = 0;
  let notified = 0;

  for (const entry of openPriorDay) {
    const entryDayLocal = localDateYMD(entry.startAt, tz);
    const endAt = endOfLocalDayUtc(entryDayLocal, tz);

    // Defensive: an entry that started less than a millisecond before
    // its computed endAt is nonsensical; skip rather than write a bad
    // duration. This only happens in pathological clock states.
    if (endAt.getTime() <= entry.startAt.getTime()) {
      continue;
    }

    const durationMinutes = Math.max(
      0,
      Math.round((endAt.getTime() - entry.startAt.getTime()) / 60_000),
    );

    const result = await db
      .update(timeEntries)
      .set({
        endAt,
        durationMinutes,
        autoPausedAt,
        updatedAt: autoPausedAt,
      })
      .where(
        and(
          eq(timeEntries.id, entry.id),
          // Write-guard: if a manual stop landed between SELECT and UPDATE,
          // bail out. We never overwrite an endAt the tech set themselves.
          isNull(timeEntries.endAt),
        ),
      )
      .returning({ id: timeEntries.id });

    if (result.length === 0) continue;
    closed++;

    // Skip the technician banner for orphaned entries. Surfacing "your
    // timer was paused at midnight" for a visit that no longer exists
    // is confusing — there's nothing for them to resume — and violates
    // the "do not alert users about internal bugs/orphans" rule.
    const isOrphaned =
      entry.visitId != null && entry.visitIsActive !== true;
    if (isOrphaned) continue;

    const dedupeKey = `time_entry_auto_paused:${entry.id}`;
    try {
      await db
        .insert(notifications)
        .values({
          companyId,
          userId: entry.technicianId,
          type: "time_entry_auto_paused",
          title: "Timer paused at midnight",
          body: "Your timer was paused at midnight. Resume to continue today.",
          linkUrl: entry.jobId ? `/tech/jobs/${entry.jobId}` : null,
          relatedEntityType: entry.visitId
            ? "job_visit"
            : entry.jobId
              ? "job"
              : entry.taskId
                ? "task"
                : null,
          relatedEntityId: entry.visitId ?? entry.jobId ?? entry.taskId ?? null,
          dedupeKey,
        })
        .onConflictDoNothing();
      notified++;
    } catch (err) {
      // Dedupe collisions or concurrent-insert races are expected under
      // re-run — log but do not fail the sweep.
      console.error(
        `[midnightRollover] notification insert failed (entryId=${entry.id}):`,
        err,
      );
    }
  }

  if (closed > 0) {
    console.log(
      `[midnightRollover] companyId=${companyId} tz=${tz} closed=${closed} notified=${notified}`,
    );
  }

  return { closed, notified };
}

// ---------------------------------------------------------------------------
// Lifecycle (mirrors subscriptionWorker / invoiceReminderWorker)
// ---------------------------------------------------------------------------

export function startMidnightRolloverWorker(): void {
  if (startupTimeout || intervalHandle) return; // idempotent
  startupTimeout = setTimeout(() => {
    runMidnightRollover().catch((err) => {
      console.error("[midnightRollover] startup sweep failed:", err);
    });
  }, STARTUP_DELAY_MS);
  intervalHandle = setInterval(() => {
    runMidnightRollover().catch((err) => {
      console.error("[midnightRollover] sweep failed:", err);
    });
  }, SWEEP_INTERVAL_MS);
  intervalHandle.unref();
}

export function stopMidnightRolloverWorker(): void {
  if (startupTimeout) {
    clearTimeout(startupTimeout);
    startupTimeout = null;
  }
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
