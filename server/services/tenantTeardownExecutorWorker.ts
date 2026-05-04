/**
 * Tenant Teardown Executor Worker (2026-05-04).
 *
 * Two cooperating loops drive Phase 4 of the secure tenant-deletion
 * workflow:
 *
 *   • Execute loop (every 60s by default)
 *       Scans `tenant_deletion_requests` for rows in status `approved`
 *       whose `execution_scheduled_at` has passed and invokes
 *       `tenantDeletionRequestService.executeRequest()`. The service
 *       claims the row atomically via `transitionToExecuting`, re-runs
 *       the preview, refuses on hash drift, and otherwise calls
 *       `tenantTeardownService.teardownTenant({ confirm: true })`.
 *
 *   • Expire loop (every 5 minutes by default)
 *       Scans for rows still `pending` past `expires_at` and transitions
 *       them to `expired`. Sends an alert so operators see "request
 *       lapsed without approval".
 *
 * Concurrency: every transition runs through a conditional UPDATE in
 * the repository, so duplicate workers cannot both believe they
 * advanced the same row. We still serialise at the worker level
 * (`isExecuting` / `isExpiring` flags) so a single instance does not
 * stack overlapping passes if the loop misses its tick.
 *
 * Failure posture:
 *   • Per-row failures are caught and logged; the loop never crashes.
 *   • An execution failure transitions the row to `failed` (handled by
 *     the service) and emits an `execution_failed` alert.
 *   • Worker startup is delayed slightly so HTTP routes get a chance
 *     to bind first — startup failures shouldn't take the API down.
 *
 * Hard-coded out: the worker NEVER runs `executeRequest` for a row it
 * looked up before the schedule passed. The service double-checks
 * `executionScheduledAt > now` and `status === "approved"` before
 * touching anything.
 */

import { tenantDeletionRequestsRepository } from "../storage/tenantDeletionRequests";
import {
  executeRequest,
  expireOnePending,
  reapStaleExecuting,
  STALE_EXECUTING_AFTER_MS,
} from "./tenantDeletionRequestService";

const STARTUP_DELAY_MS = 60 * 1000; // 60s — let HTTP routes bind first
const EXECUTE_INTERVAL_MS = 60 * 1000; // every 60s
const EXPIRE_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes
// 2026-05-04 F2: stale-executing reaper. Same cadence as the expire
// loop (5 min). The threshold itself (STALE_EXECUTING_AFTER_MS = 60min)
// is what controls how long a stuck row sits before being marked
// failed; this interval just controls how often we look.
const STALE_EXECUTING_INTERVAL_MS = 5 * 60 * 1000;

let startupTimeout: NodeJS.Timeout | null = null;
let executeIntervalHandle: NodeJS.Timeout | null = null;
let expireIntervalHandle: NodeJS.Timeout | null = null;
let staleExecutingIntervalHandle: NodeJS.Timeout | null = null;
let isExecuting = false;
let isExpiring = false;
let isReapingStale = false;

export interface ExecuteSweepResult {
  scanned: number;
  completed: number;
  failed: number;
  skipped: number;
  errors: number;
}

export interface ExpireSweepResult {
  scanned: number;
  expired: number;
  errors: number;
}

export interface StaleExecutingSweepResult {
  scanned: number;
  reaped: number;
  skipped: number;
  errors: number;
}

/** One execute sweep — exported for tests + manual triggers. */
export async function runExecuteSweep(): Promise<ExecuteSweepResult> {
  const now = new Date();
  const due = await tenantDeletionRequestsRepository.listReadyToExecute(now);
  const result: ExecuteSweepResult = {
    scanned: due.length,
    completed: 0,
    failed: 0,
    skipped: 0,
    errors: 0,
  };

  for (const row of due) {
    try {
      const r = await executeRequest(row.id);
      if (r.outcome === "completed") result.completed++;
      else result.failed++;
    } catch (err) {
      // Service throws when the row was claimed by another worker, when
      // the schedule hadn't actually passed yet, etc. Treat as "skipped"
      // — not an error in the operational sense.
      const code = (err as { code?: string }).code;
      if (
        code === "REQUEST_NOT_APPROVED" ||
        code === "EXECUTION_NOT_DUE" ||
        code === "REQUEST_NOT_FOUND"
      ) {
        result.skipped++;
      } else {
        result.errors++;
        console.error(
          `[tenantTeardownExecutorWorker] executeRequest failed for ${row.id}:`,
          err,
        );
      }
    }
  }

  return result;
}

/**
 * 2026-05-04 F2 hardening: one stale-executing sweep — exported for
 * tests + manual triggers.
 *
 * Finds rows stuck in `executing` past `STALE_EXECUTING_AFTER_MS` and
 * marks each `failed` via `reapStaleExecuting`. The reaper itself
 * defends against races: if a worker finished the cascade between our
 * SELECT and our UPDATE, the conditional UPDATE inside `transitionToFailed`
 * returns null and we skip without writing audit/alert noise.
 */
export async function runStaleExecutingSweep(): Promise<StaleExecutingSweepResult> {
  const cutoff = new Date(Date.now() - STALE_EXECUTING_AFTER_MS);
  const rows =
    await tenantDeletionRequestsRepository.listStaleExecuting(cutoff);
  const result: StaleExecutingSweepResult = {
    scanned: rows.length,
    reaped: 0,
    skipped: 0,
    errors: 0,
  };
  for (const row of rows) {
    try {
      const failed = await reapStaleExecuting(row);
      if (failed) result.reaped++;
      else result.skipped++; // race-loser
    } catch (err) {
      result.errors++;
      console.error(
        `[tenantTeardownExecutorWorker] reapStaleExecuting failed for ${row.id}:`,
        err,
      );
    }
  }
  return result;
}

/** One expire sweep — exported for tests + manual triggers. */
export async function runExpireSweep(): Promise<ExpireSweepResult> {
  const now = new Date();
  const expired =
    await tenantDeletionRequestsRepository.listExpiredPending(now);
  const result: ExpireSweepResult = {
    scanned: expired.length,
    expired: 0,
    errors: 0,
  };

  for (const row of expired) {
    try {
      const r = await expireOnePending(row);
      if (r) result.expired++;
    } catch (err) {
      result.errors++;
      console.error(
        `[tenantTeardownExecutorWorker] expireOnePending failed for ${row.id}:`,
        err,
      );
    }
  }

  return result;
}

async function tickExecute(): Promise<void> {
  if (isExecuting) return;
  isExecuting = true;
  try {
    const r = await runExecuteSweep();
    if (r.scanned > 0) {
      console.log(
        `[tenantTeardownExecutorWorker] execute sweep: ` +
          `scanned=${r.scanned} completed=${r.completed} failed=${r.failed} ` +
          `skipped=${r.skipped} errors=${r.errors}`,
      );
    }
  } catch (err) {
    console.error("[tenantTeardownExecutorWorker] execute sweep failed:", err);
  } finally {
    isExecuting = false;
  }
}

async function tickExpire(): Promise<void> {
  if (isExpiring) return;
  isExpiring = true;
  try {
    const r = await runExpireSweep();
    if (r.scanned > 0) {
      console.log(
        `[tenantTeardownExecutorWorker] expire sweep: ` +
          `scanned=${r.scanned} expired=${r.expired} errors=${r.errors}`,
      );
    }
  } catch (err) {
    console.error("[tenantTeardownExecutorWorker] expire sweep failed:", err);
  } finally {
    isExpiring = false;
  }
}

async function tickStaleExecuting(): Promise<void> {
  if (isReapingStale) return;
  isReapingStale = true;
  try {
    const r = await runStaleExecutingSweep();
    if (r.scanned > 0) {
      console.log(
        `[tenantTeardownExecutorWorker] stale-executing sweep: ` +
          `scanned=${r.scanned} reaped=${r.reaped} skipped=${r.skipped} errors=${r.errors}`,
      );
    }
  } catch (err) {
    console.error(
      "[tenantTeardownExecutorWorker] stale-executing sweep failed:",
      err,
    );
  } finally {
    isReapingStale = false;
  }
}

/**
 * Start the two scheduler loops. Safe to call once at bootstrap.
 * Both intervals are .unref()'d so they never keep the process alive.
 */
export function startTenantTeardownExecutorWorker(): void {
  if (
    executeIntervalHandle ||
    expireIntervalHandle ||
    staleExecutingIntervalHandle
  ) {
    console.warn(
      "[tenantTeardownExecutorWorker] start called twice — ignoring",
    );
    return;
  }
  console.log(
    `[tenantTeardownExecutorWorker] Scheduler active: startup in ` +
      `${STARTUP_DELAY_MS / 1000}s, execute every ${EXECUTE_INTERVAL_MS / 1000}s, ` +
      `expire every ${EXPIRE_INTERVAL_MS / 60000}m, ` +
      `stale-executing reap every ${STALE_EXECUTING_INTERVAL_MS / 60000}m ` +
      `(threshold ${STALE_EXECUTING_AFTER_MS / 60000}m)`,
  );

  startupTimeout = setTimeout(() => {
    void tickExecute();
    void tickExpire();
    void tickStaleExecuting();
  }, STARTUP_DELAY_MS);
  startupTimeout.unref();

  executeIntervalHandle = setInterval(() => {
    void tickExecute();
  }, EXECUTE_INTERVAL_MS);
  executeIntervalHandle.unref();

  expireIntervalHandle = setInterval(() => {
    void tickExpire();
  }, EXPIRE_INTERVAL_MS);
  expireIntervalHandle.unref();

  staleExecutingIntervalHandle = setInterval(() => {
    void tickStaleExecuting();
  }, STALE_EXECUTING_INTERVAL_MS);
  staleExecutingIntervalHandle.unref();
}

/** Cancel all schedules + the startup timer. Idempotent. */
export function stopTenantTeardownExecutorWorker(): void {
  if (startupTimeout) {
    clearTimeout(startupTimeout);
    startupTimeout = null;
  }
  if (executeIntervalHandle) {
    clearInterval(executeIntervalHandle);
    executeIntervalHandle = null;
  }
  if (expireIntervalHandle) {
    clearInterval(expireIntervalHandle);
    expireIntervalHandle = null;
  }
  if (staleExecutingIntervalHandle) {
    clearInterval(staleExecutingIntervalHandle);
    staleExecutingIntervalHandle = null;
  }
}
