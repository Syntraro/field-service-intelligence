/**
 * Job Lifecycle Orchestrator
 *
 * SINGLE CANONICAL AUTHORITY for all job and visit lifecycle mutations.
 * Every lifecycle state change in the system MUST go through this orchestrator.
 * No route, storage method, or helper may independently author lifecycle decisions.
 *
 * Supported intents:
 * - COMPLETE_VISIT: Complete a visit with explicit outcome → reconcile parent job
 * - FORCE_CLOSE_JOB: Office force-close (archive/invoice_later/invoice_now)
 * - REOPEN_JOB: Reopen a closed job
 * - UNDO_CLOSE_JOB: Undo a recent close (20s window)
 * - PLACE_JOB_ON_HOLD: Office manually places job on hold
 * - RESUME_JOB: Clear on_hold and resume active work
 * - UPDATE_HOLD_METADATA: Update hold reason/notes without state change
 * - SET_JOB_SUBSTATUS: Set workflow substatus (on_route, in_progress) — NOT lifecycle
 * - CANCEL_VISIT: Cancel a visit
 * - BULK_COMPLETE_VISITS: Auto-complete visits during job close (with outcome=completed)
 *
 * 2026-03-18: Created as the single canonical entry point for all job/visit
 * lifecycle mutations. Absorbs reconciliation logic from visitReconciliation.ts.
 */

import { db } from "../db";
import { and, eq, ne, notInArray, isNull, isNotNull, or, sql } from "drizzle-orm";
import { jobVisits, jobs, invoices } from "@shared/schema";
import { jobNotesRepository } from "../storage/jobNotes";
import type {
  Job,
  JobVisit,
  VisitOutcome,
  HoldReason,
  OpenSubStatus,
} from "@shared/schema";
import type { LifecycleIntent, TransitionActor } from "../domain/jobLifecycle";
import { LifecycleTransitionError } from "../domain/jobLifecycle";
import {
  JOB_TERMINAL_STATUSES,
  normalizeScheduleTimes,
  normalizeVisitCrewWrite,
  TerminalJobImmutableError,
  VersionMismatchError,
} from "../domain/scheduling";
import { jobRepository } from "../storage/jobs";
import { jobVisitsRepository, isVisitActioned } from "../storage/jobVisits";
import { assertWritableSupportContext } from "../auth/supportContext";
import { schedulingRepository, DEFAULT_VISIT_DURATION_MINUTES } from "../storage/scheduling";
import { reconciliationActionableVisitFilter } from "../lib/visitPredicates";
import { timeTrackingRepository } from "../storage/timeTracking";
import { logEventAsync } from "../lib/events";

// ============================================================================
// Intent Types
// ============================================================================

/** Complete a visit with an explicit outcome and reconcile the parent job. */
export interface CompleteVisitIntent {
  type: "COMPLETE_VISIT";
  companyId: string;
  visitId: string;
  jobId: string;
  /** Required — the tech or office must declare an outcome. */
  outcome: VisitOutcome;
  holdReason?: HoldReason | null;
  holdNotes?: string | null;
  completedByUserId: string;
  isFollowUpNeeded?: boolean;
  /** Optional free-text note from the tech. Stored in structured outcomeNote column
   *  and auto-creates a job note documenting the outcome. */
  outcomeNote?: string | null;
  /** Visit number for the auto-generated job note label (e.g., "Visit #2"). */
  visitNumber?: number | null;
}

/** Force-close a job from the office (archive / invoice_later / invoice_now). */
export interface ForceCloseJobIntent {
  type: "FORCE_CLOSE_JOB";
  companyId: string;
  jobId: string;
  version: number;
  mode: "archive" | "invoice_later" | "invoice_now";
  actor: TransitionActor;
  invoiceId?: string;
  /** If true, auto-complete all open visits before closing. */
  autoCompleteOpenVisits?: boolean;
}

/** Reopen a previously closed/archived job. */
export interface ReopenJobIntent {
  type: "REOPEN_JOB";
  companyId: string;
  jobId: string;
  version: number;
  actor: TransitionActor;
  targetOpenSubStatus?: OpenSubStatus;
}

/** Undo a recent close within the 20-second window. */
export interface UndoCloseJobIntent {
  type: "UNDO_CLOSE_JOB";
  companyId: string;
  jobId: string;
  version: number;
  actor: TransitionActor;
}

/** Mark a job as invoiced after an invoice has been created/linked. */
export interface MarkInvoicedIntent {
  type: "MARK_INVOICED";
  companyId: string;
  jobId: string;
  version: number;
  actor: TransitionActor;
  invoiceId: string;
}

/** Place an open job on hold with a required reason. */
export interface PlaceJobOnHoldIntent {
  type: "PLACE_JOB_ON_HOLD";
  companyId: string;
  jobId: string;
  /** Required — must declare why the job is on hold. */
  holdReason: HoldReason;
  holdNotes?: string | null;
  nextActionDate?: Date | null;
  changedBy: string;
}

/** Resume a job that is currently on hold. */
export interface ResumeJobIntent {
  type: "RESUME_JOB";
  companyId: string;
  jobId: string;
  /** Sub-status to restore after clearing hold. Defaults to null (no sub-status). */
  targetSubStatus?: OpenSubStatus | null;
  changedBy: string;
}

/** Update hold metadata without changing lifecycle state. */
export interface UpdateHoldMetadataIntent {
  type: "UPDATE_HOLD_METADATA";
  companyId: string;
  jobId: string;
  holdReason?: HoldReason | null;
  holdNotes?: string | null;
  nextActionDate?: Date | null;
  changedBy: string;
}

/** Set or clear workflow sub-status (on_route, in_progress, null) — NOT a lifecycle change. */
export interface SetJobSubstatusIntent {
  type: "SET_JOB_SUBSTATUS";
  companyId: string;
  jobId: string;
  /** The sub-status to set. null clears any non-hold sub-status. */
  openSubStatus: OpenSubStatus | null;
  additionalUpdates?: Record<string, unknown>;
  changedBy: string;
}

/** Cancel a single visit. */
export interface CancelVisitIntent {
  type: "CANCEL_VISIT";
  companyId: string;
  visitId: string;
  jobId: string;
}

/** Bulk-complete all uncompleted visits for a job. */
export interface BulkCompleteVisitsIntent {
  type: "BULK_COMPLETE_VISITS";
  companyId: string;
  jobId: string;
  /** User id of the office/dispatcher/admin who initiated the force-close. */
  changedByUserId: string;
}

/** Mark a visit as en_route (tech traveling to job site). */
export interface SetVisitEnRouteIntent {
  type: "SET_VISIT_EN_ROUTE";
  companyId: string;
  visitId: string;
  jobId: string;
  /** Timestamp override (e.g. from mobile device clock). Defaults to server now. */
  at?: Date;
  /**
   * 2026-04-10: Acting tech user id. When provided, the orchestrator enforces
   * single-active-visit per technician — refuses with a clean error if the
   * tech already has another visit in en_route / in_progress / on_site / paused.
   * Optional for backward compat with legacy callers (office-side actions).
   */
  actingUserId?: string;
}

/** Start a visit (tech on-site, work beginning). Sets checkedInAt if not already set. */
export interface StartVisitIntent {
  type: "START_VISIT";
  companyId: string;
  visitId: string;
  jobId: string;
  /** Timestamp override (e.g. from mobile device clock). Defaults to server now. */
  at?: Date;
  /** 2026-04-10: see SetVisitEnRouteIntent.actingUserId */
  actingUserId?: string;
}

/**
 * Cancel an en_route visit — tech taps were accidental, rerouted, going home,
 * etc. Reverts the visit from `en_route` back to `scheduled`. The route time
 * entry is stopped and discarded if it is sub-1-minute (handled in
 * timeTrackingRepository.recordJobStatus via the "paused" path with the
 * stopAndDiscardIfTrivial helper). 2026-04-09.
 */
export interface CancelVisitRouteIntent {
  type: "CANCEL_VISIT_ROUTE";
  companyId: string;
  visitId: string;
  jobId: string;
  at?: Date;
}

/**
 * Cancel a started visit — tech tapped Start Job by mistake. Reverts from
 * `in_progress` to `en_route` (preserving any prior travel state). The on_site
 * time entry is stopped and discarded if sub-1-minute. checkedInAt is preserved
 * (mirrors the existing reopenVisit policy of not mutating historical labor
 * data). 2026-04-09.
 */
export interface CancelVisitStartIntent {
  type: "CANCEL_VISIT_START";
  companyId: string;
  visitId: string;
  jobId: string;
  at?: Date;
}

/**
 * Pause a visit — tech is taking a break. Visit goes from `in_progress` to
 * `paused`. The running on_site time entry is stopped (and discarded if
 * sub-1-minute). 2026-04-09.
 */
export interface PauseVisitIntent {
  type: "PAUSE_VISIT";
  companyId: string;
  visitId: string;
  jobId: string;
  at?: Date;
}

/**
 * Resume a paused visit. Visit goes from `paused` back to `in_progress`. A
 * fresh on_site time entry is started. 2026-04-09.
 */
export interface ResumeVisitIntent {
  type: "RESUME_VISIT";
  companyId: string;
  visitId: string;
  jobId: string;
  at?: Date;
  /** 2026-04-10: see SetVisitEnRouteIntent.actingUserId */
  actingUserId?: string;
}

/** Reopen a completed visit — auto-reopens the parent job if it is terminal. */
export interface ReopenVisitIntent {
  type: "REOPEN_VISIT";
  companyId: string;
  visitId: string;
  jobId: string;
  actor: TransitionActor;
}

/** Reschedule a visit — may update in-place or spawn a new visit depending on state. */
export interface RescheduleVisitIntent {
  type: "RESCHEDULE_VISIT";
  companyId: string;
  visitId: string;
  // 2026-04-12 final cleanup: canonical crew input.
  //   undefined = crew unchanged, null = clear crew, string[] = replace crew.
  assignedTechnicianIds?: string[] | null;
  startAt?: Date;
  endAt?: Date;
  notes?: string;
  allDay?: boolean;
  expectedVersion?: number;
  mode?: "replace" | "complete_and_new";
}

/**
 * Assign a crew to an existing visit WITHOUT changing the schedule.
 *
 * 2026-04-21 Phase 1 canonical visit mutation architecture: replaces the
 * legacy direct-storage `schedulingRepository.updateVisitCrew()` path. Crew
 * is an operational field, not metadata, because:
 *   - single-active-visit invariants apply to the tech being assigned
 *   - actioned visits (en_route / in_progress / paused / on_site) should not
 *     silently have their crew replaced without lifecycle consideration
 *   - crew changes emit dispatch SSE + event log entries the orchestrator owns
 *
 * Canonical field name: `assignedTechnicianIds` (matches shared schema
 * column + every other visit mutation). The legacy `technicianUserIds`
 * naming used by the old `schedulingRepository.updateVisitCrew` contract
 * is no longer part of any surface.
 */
export interface AssignVisitCrewIntent {
  type: "ASSIGN_VISIT_CREW";
  companyId: string;
  visitId: string;
  /** Canonical crew: `[]` clears, `[id, ...]` replaces. */
  assignedTechnicianIds: string[];
  expectedVersion: number;
}

/**
 * Unschedule an existing visit — return it to the backlog.
 *
 * 2026-04-21 Phase 1 canonical visit mutation architecture: wraps the
 * legacy `schedulingRepository.unscheduleVisit()` storage path with the
 * actioned-visit guard that was previously missing. Unscheduling a visit
 * that a tech has already checked into (or is en-route to) would erase
 * real-world state; the orchestrator rejects that class of mutation.
 */
export interface UnscheduleVisitIntent {
  type: "UNSCHEDULE_VISIT";
  companyId: string;
  visitId: string;
  expectedVersion?: number;
}

/** Union of all orchestrator intents. */
export type OrchestratorIntent =
  | CompleteVisitIntent
  | ForceCloseJobIntent
  | ReopenJobIntent
  | UndoCloseJobIntent
  | MarkInvoicedIntent
  | PlaceJobOnHoldIntent
  | ResumeJobIntent
  | UpdateHoldMetadataIntent
  | SetJobSubstatusIntent
  | CancelVisitIntent
  | BulkCompleteVisitsIntent
  | SetVisitEnRouteIntent
  | StartVisitIntent
  | CancelVisitRouteIntent
  | CancelVisitStartIntent
  | PauseVisitIntent
  | ResumeVisitIntent
  | RescheduleVisitIntent
  | ReopenVisitIntent
  | AssignVisitCrewIntent
  | UnscheduleVisitIntent;

// ============================================================================
// Result Types
// ============================================================================

export interface ReconciliationResult {
  jobUpdated: boolean;
  newJobStatus: string;
  newOpenSubStatus: string | null;
}

export interface CompleteVisitResult {
  visit: JobVisit;
  reconciliation: ReconciliationResult;
}

export interface ForceCloseJobResult {
  job: Job;
  autoCompletedVisitCount: number;
}

export interface ReopenJobResult {
  job: Job;
}

export interface UndoCloseJobResult {
  job: Job;
}

export interface MarkInvoicedResult {
  job: Job;
}

export interface PlaceJobOnHoldResult {
  job: Job;
}

export interface ResumeJobResult {
  job: Job;
}

export interface UpdateHoldMetadataResult {
  job: Job;
}

export interface SetJobSubstatusResult {
  job: Job;
}

export interface CancelVisitResult {
  visit: JobVisit;
}

export interface BulkCompleteVisitsResult {
  completedCount: number;
  visits: JobVisit[];
}

export interface SetVisitEnRouteResult {
  visit: JobVisit;
}

export interface StartVisitResult {
  visit: JobVisit;
}

export interface CancelVisitRouteResult {
  visit: JobVisit;
}

export interface CancelVisitStartResult {
  visit: JobVisit;
}

export interface PauseVisitResult {
  visit: JobVisit;
}

export interface ResumeVisitResult {
  visit: JobVisit;
}

export interface ReopenVisitResult {
  job: Job;
  visit: JobVisit;
  /** True if the parent job was auto-reopened as part of this operation. */
  jobWasReopened: boolean;
}

/** Return shape matches the original storage method: { ...job, visitId, visitVersion } */
export type RescheduleVisitResult = Record<string, any> & {
  visitId: string;
  visitVersion: number;
  /**
   * 2026-04-21 Phase 2 push notifications: visit state BEFORE the write.
   * Captured from the `visit` row the orchestrator already had to fetch
   * for the terminal-status guard. Exposed so the route handler can
   * compute a meaningful-datetime delta without a second round-trip.
   * ISO strings for consistency with wire shapes; null when the previous
   * visit had no scheduled time (e.g. backlog → first schedule).
   */
  previousScheduledStart: string | null;
  previousScheduledEnd: string | null;
  previousIsAllDay: boolean;
};

export interface AssignVisitCrewResult {
  visit: JobVisit;
  /** Mirror of `visit.jobId` for caller convenience (parity with legacy storage return). */
  jobId: string;
  /**
   * 2026-04-21 Phase 1 push notifications: the visit's crew BEFORE this write.
   * Exposed so the route handler can compute the newly-assigned delta
   * without a second DB round-trip.
   */
  previousAssignedTechnicianIds: string[];
  /**
   * 2026-04-21 Phase 1 push notifications: parent job's job_number for use in
   * the notification title/body. Free-of-charge since the orchestrator has
   * to fetch the job anyway for the terminal-status guard.
   */
  jobNumber: number;
}

/** Unschedule result matches the legacy storage shape so route handlers need no changes. */
export type UnscheduleVisitResult = Record<string, any> & {
  visitId: string;
  visitVersion: number;
};

// ============================================================================
// COMPLETE_VISIT
// ============================================================================

/**
 * Complete a visit with an explicit outcome, then reconcile the parent job.
 *
 * Steps:
 * 1. Load the visit and validate it exists and is not already terminal.
 * 2. Write all terminal fields on the visit (status, outcome, timestamps).
 * 3. Run reconciliation logic to determine parent job state.
 * 4. Sync job schedule from visits.
 */
export async function completeVisit(
  intent: CompleteVisitIntent
): Promise<CompleteVisitResult> {
  assertWritableSupportContext("job.completeVisit");
  const {
    companyId,
    visitId,
    jobId,
    outcome,
    holdReason,
    holdNotes,
    completedByUserId,
    isFollowUpNeeded,
    outcomeNote,
    visitNumber,
  } = intent;

  // Step 1: Load visit (outside transaction — read-only, no stale risk since
  // we hold version for optimistic locking in the write)
  const existing = await jobVisitsRepository.getJobVisit(companyId, visitId);
  if (!existing) {
    throw new Error(`Visit ${visitId} not found for company ${companyId}`);
  }

  if (existing.status === "completed" || existing.status === "cancelled") {
    // 2026-03-20: Structured 409 so client can detect this vs generic 500 errors.
    // Express error handler routes status=409 to res.status(409).json({error:...}).
    const err: any = new Error(`Visit ${visitId} is already in terminal status: ${existing.status}`);
    err.status = 409;
    err.code = "VISIT_ALREADY_TERMINAL";
    throw err;
  }
  assertVisitIsScheduled(existing);

  // Step 2: Visit update + optional job note run in a single transaction.
  const now = new Date();
  const trimmedNote = outcomeNote?.trim() || null;

  const updatedVisit = await db.transaction(async (tx) => {
    const visitUpdates: Record<string, unknown> = {
      status: "completed",
      outcome,
      // 2026-04-05: outcomeNote stored in structured column only — no longer appended
      // to visitNotes as legacy [OUTCOME: ...] / [COMPLETED_BY: ...] tags.
      outcomeNote: trimmedNote,
      completedAt: now,
      completedByUserId,
      isFollowUpNeeded: isFollowUpNeeded ?? (outcome !== "completed"),
      // 2026-04-10 patch (#1/#2): clear previousStatus on completion so a
      // future reopen does not see a stale captured prior state.
      previousStatus: null,
      updatedAt: now,
      version: existing.version + 1,
    };

    // Auto check-out if checked in but not yet checked out
    // Labor unification: actualDurationMinutes deprecated — duration derived from time_entries
    if (existing.checkedInAt && !existing.checkedOutAt) {
      visitUpdates.checkedOutAt = now;
    }

    const [visit] = await tx
      .update(jobVisits)
      .set(visitUpdates)
      .where(and(eq(jobVisits.id, visitId), eq(jobVisits.companyId, companyId)))
      .returning();

    // Auto-create job note documenting the outcome (if note provided).
    // 2026-04-20: routes through canonical jobNotesRepository.createSystemNoteTx
    // so this surface joins every other job-note write path under one
    // helper. Drops the raw tx.insert() and stops re-declaring column
    // defaults (id, createdAt, updatedAt) the DB already stamps.
    if (trimmedNote) {
      const outcomeLabels: Record<string, string> = {
        completed: "Completed",
        needs_parts: "Needs parts",
        needs_followup: "Needs follow-up",
      };
      const label = visitNumber ? `Visit #${visitNumber}` : "Visit";
      await jobNotesRepository.createSystemNoteTx(
        tx,
        companyId,
        jobId,
        completedByUserId,
        `${label} — ${outcomeLabels[outcome] ?? outcome}: ${trimmedNote}`,
      );
    }

    return visit;
  });

  // Step 3: Stop active time entry for the visit's assigned technician.
  // 2026-04-05: Moved into orchestrator so ALL completion paths (tech, office,
  // bulk-complete) stop running time entries canonically. Previously only the
  // techField.ts route stopped entries — office paths left them running.
  //
  // 2026-04-10 patch (#5): tighten the cleanup so no orphan active timer can
  // remain after completion.
  //   1. Stop the entry for THIS job via stopAndDiscardIfTrivial — trivial
  //      complete-immediately-after-start segments are discarded instead of
  //      landing in payroll (consistent with the cancel/pause cleanup).
  //   2. Defensive sweep: if any other entry is still running for this tech
  //      after step 1, stop it as well. This catches the rare orphan case
  //      where the running entry was for a different job (state divergence).
  //      The sweep also uses stopAndDiscardIfTrivial.
  // 2026-04-12 scalar removal: walk the visit's crew instead of the scalar.
  // Each crew member is independently checked for a running entry on this
  // job; the discard logic is identical to before.
  const crewForCleanup = Array.isArray(existing.assignedTechnicianIds) ? existing.assignedTechnicianIds : [];
  for (const techId of crewForCleanup) {
    try {
      const running = await timeTrackingRepository.getRunningTimeEntry(companyId, techId);
      if (running && running.jobId === jobId) {
        await timeTrackingRepository.stopAndDiscardIfTrivial(
          companyId,
          techId,
          { timeEntryId: running.id, at: now },
        );
      }
      const stillRunning = await timeTrackingRepository.getRunningTimeEntry(companyId, techId);
      if (stillRunning) {
        await timeTrackingRepository.stopAndDiscardIfTrivial(
          companyId,
          techId,
          { timeEntryId: stillRunning.id, at: now },
        );
      }
    } catch {
      // Non-fatal: entry may not exist or already stopped
    }
  }

  // Step 4: Reconcile parent job AFTER visit transaction commits.
  // 2026-03-20 BUG FIX: Previously this ran INSIDE the visit transaction,
  // but reconcileJobAfterVisitCompletion() queries via `db` (pool), not `tx`.
  // Under READ COMMITTED isolation the uncommitted visit status update was
  // invisible to reconciliation — the just-completed visit was still counted
  // as "actionable", so hasRemainingVisits was always true and the parent job
  // was never closed. Moving reconciliation after commit ensures it reads the
  // committed visit status correctly.
  // Repository methods (transitionJobStatus, updateJobStatusWithEvent) use
  // their own db.transaction() internally — safe as independent transactions.
  const reconciliation = await reconcileJobAfterVisitCompletion({
    companyId,
    jobId,
    outcome,
    holdReason,
    holdNotes,
    completedByUserId,
  });

  // Step 5: Sync job schedule from visits AFTER transaction commits.
  // This is a denormalization sync that reads committed state — intentionally
  // outside the transaction to avoid holding locks during the schedule query.
  await jobVisitsRepository.syncJobToVisits(companyId, jobId);

  return { visit: updatedVisit, reconciliation };
}

// ============================================================================
// FORCE_CLOSE_JOB
// ============================================================================

/**
 * Force-close a job from the office UI.
 *
 * If autoCompleteOpenVisits is true, all uncompleted visits are bulk-completed
 * with outcome="completed" before the job transition runs.
 */
export async function forceCloseJob(
  intent: ForceCloseJobIntent,
  txHandle?: any
): Promise<ForceCloseJobResult> {
  assertWritableSupportContext("job.forceClose");
  const {
    companyId,
    jobId,
    version,
    mode,
    actor,
    invoiceId,
    autoCompleteOpenVisits,
  } = intent;

  let autoCompletedVisitCount = 0;
  let effectiveVersion = version;

  // Step 1: Bulk-complete open visits if requested.
  // When running inside a shared transaction, version is consistent within tx.
  if (autoCompleteOpenVisits) {
    const result = await bulkCompleteVisitsInternal(companyId, jobId, txHandle, actor.userId);
    autoCompletedVisitCount = result.completedCount;
    if (result.completedCount > 0) {
      const freshJob = await jobRepository.getJob(companyId, jobId, txHandle);
      effectiveVersion = freshJob.version;
    }
  }

  // Step 2: Delegate to domain lifecycle engine via storage
  const lifecycleIntent: LifecycleIntent = {
    type: "CLOSE_JOB",
    mode,
    invoiceId,
  };
  const job = await jobRepository.transitionJobStatus(
    companyId,
    jobId,
    effectiveVersion,
    lifecycleIntent,
    actor,
    txHandle
  );

  return { job, autoCompletedVisitCount };
}

// ============================================================================
// REOPEN_JOB
// ============================================================================

/**
 * Reopen a previously closed or archived job.
 */
export async function reopenJob(
  intent: ReopenJobIntent
): Promise<ReopenJobResult> {
  assertWritableSupportContext("job.reopen");
  const { companyId, jobId, version, actor, targetOpenSubStatus } = intent;

  const lifecycleIntent: LifecycleIntent = {
    type: "REOPEN_JOB",
    targetOpenSubStatus,
  };
  const job = await jobRepository.transitionJobStatus(
    companyId,
    jobId,
    version,
    lifecycleIntent,
    actor
  );

  return { job };
}

// ============================================================================
// REOPEN_VISIT
// ============================================================================

/**
 * Reopen a completed visit. If the parent job is in a terminal status
 * (completed/invoiced/archived), auto-reopens the job first using the
 * canonical reopenJob() lifecycle method — no duplication.
 *
 * Steps:
 * 1. Load visit — must be in terminal status (completed/cancelled).
 * 2. Load parent job — if terminal, call reopenJob() to bring it back to open.
 * 3. Reset visit status to "scheduled" and clear completion fields.
 * 4. Sync job schedule from visits.
 */
export async function reopenVisit(
  intent: ReopenVisitIntent
): Promise<ReopenVisitResult> {
  assertWritableSupportContext("visit.reopen");
  const { companyId, visitId, jobId, actor } = intent;

  // Step 1: Load and validate visit
  const existing = await jobVisitsRepository.getJobVisit(companyId, visitId);
  if (!existing) {
    throw new Error(`Visit ${visitId} not found for company ${companyId}`);
  }
  if (existing.status !== "completed" && existing.status !== "cancelled") {
    const err: any = new Error(`Visit ${visitId} is not in a terminal status (current: ${existing.status})`);
    err.status = 400;
    throw err;
  }

  // Step 2: Load parent job — auto-reopen if terminal
  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)));

  if (!job) {
    throw new Error(`Job ${jobId} not found for company ${companyId}`);
  }

  let jobWasReopened = false;
  let updatedJob = job;

  const REOPEN_TRIGGERING_STATUSES = ["completed", "invoiced", "archived"];
  if (REOPEN_TRIGGERING_STATUSES.includes(job.status)) {
    // Delegate to canonical reopenJob() — reuses existing lifecycle engine
    const reopenResult = await reopenJob({
      type: "REOPEN_JOB",
      companyId,
      jobId,
      version: job.version,
      actor,
    });
    updatedJob = reopenResult.job;
    jobWasReopened = true;
  } else if (job.status === "open" && job.openSubStatus === "on_hold") {
    // Job is open but on_hold — the visit that caused the hold is being reopened,
    // so the hold reason no longer applies. Delegate to canonical resumeJob()
    // which clears openSubStatus, holdReason, holdNotes, and onHoldAt.
    const resumeResult = await resumeJob({
      type: "RESUME_JOB",
      companyId,
      jobId,
      changedBy: actor.userId,
    });
    updatedJob = resumeResult.job;
    jobWasReopened = true;
  }

  // Step 3: Reset visit to scheduled, clear completion fields
  const now = new Date();
  const [updatedVisit] = await db
    .update(jobVisits)
    .set({
      status: "scheduled",
      outcome: null,
      completedAt: null,
      completedByUserId: null,
      isFollowUpNeeded: false,
      checkedOutAt: null,
      // actualDurationMinutes: intentionally NOT nulled — historical labor data preserved on reopen.
      // Reopening affects workflow state only; manual labor edits are a separate explicit action.
      updatedAt: now,
      version: existing.version + 1,
    })
    .where(and(eq(jobVisits.id, visitId), eq(jobVisits.companyId, companyId)))
    .returning();

  // Step 4: Sync job schedule from visits
  await jobVisitsRepository.syncJobToVisits(companyId, jobId);

  return { job: updatedJob, visit: updatedVisit, jobWasReopened };
}

// ============================================================================
// UNDO_CLOSE_JOB
// ============================================================================

/**
 * Undo a recent job close within the 20-second undo window.
 *
 * 2026-04-18 Phase 7 (billing semantics cleanup): under multi-invoice,
 * `jobs.invoiceId` is only the primary pointer — it may be NULL while
 * sibling invoices still exist (e.g., if the primary was deleted).
 * The pure lifecycle check at `applyUndoCloseTransition` can only see
 * the primary pointer. We pre-check the authoritative side (`invoices.jobId`)
 * here in the orchestrator, where we have DB access, so a close that
 * spawned any invoice — primary or otherwise — cannot be undone.
 */
export async function undoCloseJob(
  intent: UndoCloseJobIntent
): Promise<UndoCloseJobResult> {
  assertWritableSupportContext("job.undoClose");
  const { companyId, jobId, version, actor } = intent;

  // Authoritative check: any invoice referencing this job (including
  // siblings whose parent job.invoiceId has been cleared by a prior
  // primary-invoice deletion) blocks undo-close.
  const [anyInvoice] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.companyId, companyId), eq(invoices.jobId, jobId)))
    .limit(1);
  if (anyInvoice) {
    throw new LifecycleTransitionError(
      "INVOICED_JOB",
      "Cannot undo close for a job that has one or more invoices. Delete the invoices first, or reopen the job explicitly.",
    );
  }

  const lifecycleIntent: LifecycleIntent = { type: "UNDO_CLOSE" };
  const job = await jobRepository.transitionJobStatus(
    companyId,
    jobId,
    version,
    lifecycleIntent,
    actor
  );

  return { job };
}

// ============================================================================
// MARK_INVOICED
// ============================================================================

/**
 * Mark a job as invoiced — standalone canonical lifecycle transition.
 *
 * Called AFTER an invoice has been created and linked.
 * Transitions job status to "invoiced" via the domain lifecycle engine.
 */
export async function markInvoiced(
  intent: MarkInvoicedIntent,
  txHandle?: any
): Promise<MarkInvoicedResult> {
  assertWritableSupportContext("job.markInvoiced");
  const { companyId, jobId, version, actor, invoiceId } = intent;

  const lifecycleIntent: LifecycleIntent = {
    type: "MARK_INVOICED",
    invoiceId,
  };
  const job = await jobRepository.transitionJobStatus(
    companyId,
    jobId,
    version,
    lifecycleIntent,
    actor,
    txHandle
  );

  return { job };
}

// ============================================================================
// PLACE_JOB_ON_HOLD
// ============================================================================

/**
 * Place an open job on hold with a required reason.
 *
 * Validates the job is currently open before applying the hold.
 */
export async function placeJobOnHold(
  intent: PlaceJobOnHoldIntent
): Promise<PlaceJobOnHoldResult> {
  assertWritableSupportContext("job.placeOnHold");
  const { companyId, jobId, holdReason, holdNotes, nextActionDate, changedBy } = intent;

  // Load job to validate current state
  const [currentJob] = await db
    .select({ id: jobs.id, status: jobs.status, openSubStatus: jobs.openSubStatus })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)));

  if (!currentJob) {
    throw new Error(`Job ${jobId} not found for company ${companyId}`);
  }
  if (currentJob.status !== "open") {
    throw new Error(
      `Cannot place job on hold: job is in status '${currentJob.status}', must be 'open'`
    );
  }

  const job = await jobRepository.updateJobStatusWithEvent(companyId, jobId, {
    fromStatus: "open",
    toStatus: "open", // Status stays open; sub-status changes
    changedBy,
    note: `Placed on hold: ${holdReason}`,
    meta: { action: "place_on_hold", holdReason },
    additionalUpdates: {
      openSubStatus: "on_hold",
      holdReason,
      holdNotes: holdNotes ?? null,
      onHoldAt: new Date(),
      nextActionDate: nextActionDate ?? null,
    },
  });

  return { job };
}

// ============================================================================
// RESUME_JOB
// ============================================================================

/**
 * Resume a job that is currently on hold.
 *
 * Validates the job is open and on_hold before clearing hold fields.
 */
export async function resumeJob(
  intent: ResumeJobIntent
): Promise<ResumeJobResult> {
  assertWritableSupportContext("job.resume");
  const { companyId, jobId, targetSubStatus, changedBy } = intent;

  // Load job to validate current state
  const [currentJob] = await db
    .select({ id: jobs.id, status: jobs.status, openSubStatus: jobs.openSubStatus })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)));

  if (!currentJob) {
    throw new Error(`Job ${jobId} not found for company ${companyId}`);
  }
  if (currentJob.status !== "open") {
    throw new Error(
      `Cannot resume job: job is in status '${currentJob.status}', must be 'open'`
    );
  }
  if (currentJob.openSubStatus !== "on_hold") {
    throw new Error(
      `Cannot resume job: job is not on hold (openSubStatus='${currentJob.openSubStatus}')`
    );
  }

  const job = await jobRepository.updateJobStatusWithEvent(companyId, jobId, {
    fromStatus: "open",
    toStatus: "open", // Status stays open; sub-status clears
    changedBy,
    note: "Resumed from hold",
    meta: { action: "resume_job", previousSubStatus: "on_hold" },
    additionalUpdates: {
      openSubStatus: targetSubStatus ?? null,
      holdReason: null,
      holdNotes: null,
      onHoldAt: null,
      nextActionDate: null,
    },
  });

  return { job };
}

// ============================================================================
// UPDATE_HOLD_METADATA
// ============================================================================

/**
 * Update hold metadata (reason, notes, next action date) without changing state.
 *
 * Validates the job is already on_hold before updating.
 */
export async function updateHoldMetadata(
  intent: UpdateHoldMetadataIntent
): Promise<UpdateHoldMetadataResult> {
  assertWritableSupportContext("job.updateHoldMetadata");
  const { companyId, jobId, holdReason, holdNotes, nextActionDate, changedBy } = intent;

  // Load job to validate current state
  const [currentJob] = await db
    .select({ id: jobs.id, status: jobs.status, openSubStatus: jobs.openSubStatus })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)));

  if (!currentJob) {
    throw new Error(`Job ${jobId} not found for company ${companyId}`);
  }
  if (currentJob.status !== "open" || currentJob.openSubStatus !== "on_hold") {
    throw new Error(
      `Cannot update hold metadata: job is not on hold (status='${currentJob.status}', openSubStatus='${currentJob.openSubStatus}')`
    );
  }

  // Build update payload — only include fields that were explicitly provided
  const updates: Record<string, unknown> = {};
  if (holdReason !== undefined) updates.holdReason = holdReason;
  if (holdNotes !== undefined) updates.holdNotes = holdNotes;
  if (nextActionDate !== undefined) updates.nextActionDate = nextActionDate;

  const job = await jobRepository.updateJobStatusWithEvent(companyId, jobId, {
    fromStatus: "open",
    toStatus: "open", // No status change
    changedBy,
    note: "Updated hold metadata",
    meta: { action: "update_hold_metadata", ...updates },
    additionalUpdates: updates,
  });

  return { job };
}

// ============================================================================
// SET_JOB_SUBSTATUS
// ============================================================================

/**
 * Set workflow sub-status (on_route, in_progress) for travel/arrival tracking.
 *
 * This is NOT a lifecycle transition — the job remains open.
 */
export async function setJobSubstatus(
  intent: SetJobSubstatusIntent
): Promise<SetJobSubstatusResult> {
  assertWritableSupportContext("job.setSubstatus");
  const { companyId, jobId, openSubStatus, additionalUpdates, changedBy } = intent;

  // Load job to validate current state
  const [currentJob] = await db
    .select({ id: jobs.id, status: jobs.status, openSubStatus: jobs.openSubStatus })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)));

  if (!currentJob) {
    throw new Error(`Job ${jobId} not found for company ${companyId}`);
  }
  if (currentJob.status !== "open") {
    throw new Error(
      `Cannot set sub-status: job is in status '${currentJob.status}', must be 'open'`
    );
  }

  const job = await jobRepository.updateJobStatusWithEvent(companyId, jobId, {
    fromStatus: "open",
    toStatus: "open", // Status stays open
    changedBy,
    note: openSubStatus ? `Sub-status set to ${openSubStatus}` : "Sub-status cleared",
    meta: { action: openSubStatus ? "set_substatus" : "clear_substatus", openSubStatus },
    additionalUpdates: {
      openSubStatus,
      ...(additionalUpdates ?? {}),
    },
  });

  return { job };
}

// ============================================================================
// SINGLE-ACTIVE-VISIT GUARD (2026-04-10)
// ============================================================================

/**
 * The visit statuses that count as "active" for a technician — i.e. the tech
 * is currently on the hook for this visit and cannot also be active on another.
 * Used by the single-active enforcement guard.
 */
const ACTIVE_VISIT_STATUSES = ["en_route", "on_site", "in_progress", "paused"] as const;

/**
 * Throw if the technician already has another active visit in the same
 * company. Active = en_route | on_site | in_progress | paused. The current
 * visit (excludeVisitId) is excluded from the check so an idempotent
 * re-trigger of the same action does not self-conflict.
 *
 * Matches the route-handler auth model: a tech is "assigned" iff they
 * appear in `assignedTechnicianIds`. There is no lead-tech concept.
 *
 * No-op when actingUserId is undefined (legacy/office callers do not enforce).
 *
 * Intentionally throws a plain Error with a stable prefix so route handlers
 * can map it to a 409 without parsing.
 */
async function assertNoOtherActiveVisitForTech(
  companyId: string,
  actingUserId: string | undefined,
  excludeVisitId: string,
): Promise<void> {
  if (!actingUserId) return;

  const conflicts = await db
    .select({
      id: jobVisits.id,
      jobId: jobVisits.jobId,
      status: jobVisits.status,
    })
    .from(jobVisits)
    .where(and(
      eq(jobVisits.companyId, companyId),
      eq(jobVisits.isActive, true),
      ne(jobVisits.id, excludeVisitId),
      sql`${jobVisits.status} IN ('en_route', 'on_site', 'in_progress', 'paused')`,
      sql`${actingUserId} = ANY(${jobVisits.assignedTechnicianIds})`,
    ))
    .limit(1);

  if (conflicts.length > 0) {
    const c = conflicts[0];
    throw new Error(
      `ACTIVE_VISIT_CONFLICT: technician already has an active visit (visit ${c.id}, status '${c.status}'). ` +
      `Cancel or complete that visit first before starting another.`
    );
  }
}

// ============================================================================
// SHARED GUARD: Unscheduled visit lifecycle block
// ============================================================================
//
// 2026-04-10: Canonical guard preventing lifecycle actions on unscheduled
// visits (scheduledStart IS NULL). An unscheduled visit is a placeholder
// created by "Schedule Later" — it should not be actionable until the office
// or dispatch board assigns a time slot.
//
// Applied to: setVisitEnRoute, startVisit, completeVisit, pauseVisit,
//             resumeVisit, cancelVisitRoute, cancelVisitStart.
//
// NOT applied to: rescheduleVisit (the point IS to schedule it),
//                 cancelVisit (admin can cancel any visit),
//                 bulkCompleteVisits (force-close during job termination),
//                 reopenVisit (admin reopens completed visit).
//
// The guard reads `scheduledStart` from the visit row already fetched by the
// calling function — no extra DB query.

function assertVisitIsScheduled(
  visit: { id: string; scheduledStart: Date | string | null },
): void {
  if (!visit.scheduledStart) {
    throw new Error(
      "Cannot perform this action on an unscheduled visit. Schedule the visit first.",
    );
  }
}

// ============================================================================
// SET_VISIT_EN_ROUTE
// ============================================================================

/**
 * Mark a visit as en_route — tech is traveling to the job site.
 *
 * 2026-03-18 BP-3 fix: Moved from route-level direct db.update(jobVisits) in
 * techField.ts to canonical orchestrator ownership. Validation, mutation, and
 * schedule sync are now centralized here.
 *
 * 2026-04-10: enforces single-active-visit per technician via
 * assertNoOtherActiveVisitForTech when actingUserId is provided.
 */
export async function setVisitEnRoute(
  intent: SetVisitEnRouteIntent
): Promise<SetVisitEnRouteResult> {
  assertWritableSupportContext("visit.setEnRoute");
  const { companyId, visitId, jobId, at, actingUserId } = intent;
  const now = at ?? new Date();

  // Step 1: Load and validate visit
  const existing = await jobVisitsRepository.getJobVisit(companyId, visitId);
  if (!existing) {
    throw new Error(`Visit ${visitId} not found for company ${companyId}`);
  }
  if (existing.status === "completed" || existing.status === "cancelled") {
    throw new Error(`Cannot update a ${existing.status} visit`);
  }
  assertVisitIsScheduled(existing);

  // 2026-04-10: single-active-visit enforcement (#3)
  await assertNoOtherActiveVisitForTech(companyId, actingUserId, visitId);

  // Step 2: Apply visit workflow mutation
  const [updated] = await db
    .update(jobVisits)
    .set({
      status: "en_route",
      updatedAt: now,
      version: existing.version + 1,
    })
    .where(and(eq(jobVisits.id, visitId), eq(jobVisits.companyId, companyId)))
    .returning();

  // Step 3: Sync parent job schedule fields
  await jobVisitsRepository.syncJobToVisits(companyId, jobId);

  return { visit: updated };
}

// ============================================================================
// START_VISIT
// ============================================================================

/**
 * Start a visit — tech is on-site, work beginning.
 * Sets checkedInAt if not already set (preserves existing check-in time).
 *
 * 2026-03-18 BP-4 fix: Moved from route-level direct db.update(jobVisits) in
 * techField.ts to canonical orchestrator ownership. Validation, mutation, and
 * schedule sync are now centralized here.
 */
export async function startVisit(
  intent: StartVisitIntent
): Promise<StartVisitResult> {
  assertWritableSupportContext("visit.start");
  const { companyId, visitId, jobId, at, actingUserId } = intent;
  const now = at ?? new Date();

  // Step 1: Load and validate visit
  const existing = await jobVisitsRepository.getJobVisit(companyId, visitId);
  if (!existing) {
    throw new Error(`Visit ${visitId} not found for company ${companyId}`);
  }
  if (existing.status === "completed" || existing.status === "cancelled") {
    throw new Error(`Cannot start a ${existing.status} visit`);
  }
  assertVisitIsScheduled(existing);

  // 2026-04-10: single-active-visit enforcement (#3)
  await assertNoOtherActiveVisitForTech(companyId, actingUserId, visitId);

  // Step 2: Apply visit workflow mutation
  // Preserve existing checkedInAt if already set (idempotent check-in).
  // 2026-04-10: capture the prior status into previousStatus so cancelVisitStart
  // can restore to the actual previous state instead of guessing en_route.
  // Only writes previousStatus when transitioning FROM a non-in_progress state
  // (an idempotent re-start should not overwrite the original prior state).
  const [updated] = await db
    .update(jobVisits)
    .set({
      status: "in_progress",
      checkedInAt: existing.checkedInAt ?? now,
      previousStatus: existing.status === "in_progress" || existing.status === "on_site"
        ? existing.previousStatus  // already started — keep the original prior state
        : existing.status,         // first start — capture en_route or scheduled
      updatedAt: now,
      version: existing.version + 1,
    })
    .where(and(eq(jobVisits.id, visitId), eq(jobVisits.companyId, companyId)))
    .returning();

  // Step 3: Sync parent job schedule fields
  await jobVisitsRepository.syncJobToVisits(companyId, jobId);

  return { visit: updated };
}

// ============================================================================
// CANCEL_VISIT_ROUTE (2026-04-09)
// ============================================================================

/**
 * Reverse an en_route visit back to scheduled. Used when a tech taps Start
 * Route by accident, gets rerouted, or no longer heads to that visit.
 *
 * Visit transition: en_route → scheduled. Only valid from en_route. Stopping
 * and discarding the route time entry is the route handler's responsibility
 * (via timeTrackingRepository.recordJobStatus("paused") which routes through
 * stopAndDiscardIfTrivial). The route history event is still recorded.
 */
export async function cancelVisitRoute(
  intent: CancelVisitRouteIntent
): Promise<CancelVisitRouteResult> {
  assertWritableSupportContext("visit.cancelRoute");
  const { companyId, visitId, jobId, at } = intent;
  const now = at ?? new Date();

  const existing = await jobVisitsRepository.getJobVisit(companyId, visitId);
  if (!existing) {
    throw new Error(`Visit ${visitId} not found for company ${companyId}`);
  }
  assertVisitIsScheduled(existing);
  if (existing.status !== "en_route") {
    throw new Error(
      `Cannot cancel route for visit in status '${existing.status}'. Only en_route visits can be reverted.`
    );
  }

  const [updated] = await db
    .update(jobVisits)
    .set({
      status: "scheduled",
      updatedAt: now,
      version: existing.version + 1,
    })
    .where(and(eq(jobVisits.id, visitId), eq(jobVisits.companyId, companyId)))
    .returning();

  await jobVisitsRepository.syncJobToVisits(companyId, jobId);

  return { visit: updated };
}

// ============================================================================
// CANCEL_VISIT_START (2026-04-09)
// ============================================================================

/**
 * Cancel a started visit — tech tapped Start Job by mistake.
 *
 * 2026-04-10 patch fixes two integrity gaps in the original implementation:
 *
 *   FIX #1 (timestamp behavior): the prior version always preserved
 *   `checkedInAt`, even for trivial mistaken starts. Now we compute the raw
 *   elapsed time from `checkedInAt` to `now`. If it is < 60_000 ms (consistent
 *   with stopAndDiscardIfTrivial's threshold), the segment is considered
 *   accidental and `checkedInAt` is cleared. Otherwise (>= 1 minute) the
 *   historical `checkedInAt` is preserved.
 *
 *   FIX #2 (restore-to-correct-prior-state): the prior version always
 *   restored the visit to `en_route`, which was wrong when the tech tapped
 *   Start Job directly from `scheduled`. Now we read `previousStatus` (which
 *   `startVisit` captures at transition time) and restore to that. The
 *   fallback for legacy in-flight visits with NULL previousStatus is still
 *   `en_route`, matching the pre-patch behavior so existing tabs do not break.
 *
 * The on_site time entry is stopped and discarded if sub-1-minute by the
 * route handler via recordJobStatus("paused"). After a successful cancel
 * `previousStatus` is cleared so a subsequent Start Job will recapture it.
 */
export async function cancelVisitStart(
  intent: CancelVisitStartIntent
): Promise<CancelVisitStartResult> {
  assertWritableSupportContext("visit.cancelStart");
  const { companyId, visitId, jobId, at } = intent;
  const now = at ?? new Date();

  const existing = await jobVisitsRepository.getJobVisit(companyId, visitId);
  if (!existing) {
    throw new Error(`Visit ${visitId} not found for company ${companyId}`);
  }
  assertVisitIsScheduled(existing);
  if (existing.status !== "in_progress" && existing.status !== "on_site") {
    throw new Error(
      `Cannot cancel start for visit in status '${existing.status}'. Only in_progress / on_site visits can be reverted.`
    );
  }

  // FIX #1: compute raw elapsed time from checkedInAt to now. Anything under
  // 60_000 ms is treated as an accidental start and checkedInAt is cleared.
  const elapsedMs = existing.checkedInAt
    ? now.getTime() - existing.checkedInAt.getTime()
    : 0;
  const isTrivial = elapsedMs < 60_000;

  // FIX #2: restore to the actual prior state captured by startVisit.
  // Fallback to en_route for legacy rows with NULL previousStatus (preserves
  // the pre-patch behavior so existing in-flight visits do not break).
  const restoreStatus = (existing as any).previousStatus ?? "en_route";

  const [updated] = await db
    .update(jobVisits)
    .set({
      status: restoreStatus,
      // FIX #1: clear checkedInAt for accidental sub-minute starts; preserve
      // historical labor data otherwise (mirrors reopenVisit's policy).
      checkedInAt: isTrivial ? null : existing.checkedInAt,
      // Clear the captured prior state — a future Start Job will recapture it.
      previousStatus: null,
      updatedAt: now,
      version: existing.version + 1,
    })
    .where(and(eq(jobVisits.id, visitId), eq(jobVisits.companyId, companyId)))
    .returning();

  await jobVisitsRepository.syncJobToVisits(companyId, jobId);

  return { visit: updated };
}

// ============================================================================
// PAUSE_VISIT (2026-04-09)
// ============================================================================

/**
 * Pause an in-progress visit. Visit transition: in_progress → paused.
 * The on_site time entry is stopped (and discarded if sub-1-minute) by the
 * route handler via recordJobStatus("paused").
 */
export async function pauseVisit(
  intent: PauseVisitIntent
): Promise<PauseVisitResult> {
  assertWritableSupportContext("visit.pause");
  const { companyId, visitId, jobId, at } = intent;
  const now = at ?? new Date();

  const existing = await jobVisitsRepository.getJobVisit(companyId, visitId);
  if (!existing) {
    throw new Error(`Visit ${visitId} not found for company ${companyId}`);
  }
  assertVisitIsScheduled(existing);
  if (existing.status !== "in_progress" && existing.status !== "on_site") {
    throw new Error(
      `Cannot pause visit in status '${existing.status}'. Only in_progress / on_site visits can be paused.`
    );
  }

  const [updated] = await db
    .update(jobVisits)
    .set({
      status: "paused",
      updatedAt: now,
      version: existing.version + 1,
    })
    .where(and(eq(jobVisits.id, visitId), eq(jobVisits.companyId, companyId)))
    .returning();

  await jobVisitsRepository.syncJobToVisits(companyId, jobId);

  return { visit: updated };
}

// ============================================================================
// RESUME_VISIT (2026-04-09)
// ============================================================================

/**
 * Resume a paused visit. Visit transition: paused → in_progress. A fresh
 * on_site time entry is started by the route handler via
 * recordJobStatus("resumed").
 *
 * 2026-04-10 micro-patch: explicit running-time-entry guard. Resume must NOT
 * silently auto-stop a stale running entry — it must refuse so the operator
 * sees the inconsistency. State drift this catches: visit is paused but a
 * running time entry still exists due to a stale tab, partial failure, or
 * inconsistent prior state. Without this guard, autoStopOpen inside
 * recordJobStatus("resumed") would erase the evidence by stopping the orphan.
 */
export async function resumeVisit(
  intent: ResumeVisitIntent
): Promise<ResumeVisitResult> {
  assertWritableSupportContext("visit.resume");
  const { companyId, visitId, jobId, at, actingUserId } = intent;
  const now = at ?? new Date();

  const existing = await jobVisitsRepository.getJobVisit(companyId, visitId);
  if (!existing) {
    throw new Error(`Visit ${visitId} not found for company ${companyId}`);
  }
  assertVisitIsScheduled(existing);
  if (existing.status !== "paused") {
    throw new Error(
      `Cannot resume visit in status '${existing.status}'. Only paused visits can be resumed.`
    );
  }

  // 2026-04-10: single-active-visit enforcement (#3) — resuming this visit
  // would put the tech in two simultaneously active visits if another one is
  // already running. Refuse with the same conflict error as Start Route /
  // Start Job. The current paused visit itself is excluded from the check.
  await assertNoOtherActiveVisitForTech(companyId, actingUserId, visitId);

  // 2026-04-10 micro-patch: running-time-entry guard. Pause stops the
  // on_site entry; if anything is still running for this tech at resume time,
  // we refuse and let the route handler return a clean 409. Stable error
  // prefix is consumed by techField.ts:maybeMapActiveVisitConflict.
  if (actingUserId) {
    const running = await timeTrackingRepository.getRunningTimeEntry(
      companyId,
      actingUserId,
    );
    if (running) {
      throw new Error(
        `RUNNING_TIME_ENTRY_EXISTS: technician already has a running time entry ` +
          `(entry ${running.id}, type '${running.type}', job ${running.jobId ?? "none"}). ` +
          `Stop the running entry before resuming.`,
      );
    }
  }

  const [updated] = await db
    .update(jobVisits)
    .set({
      status: "in_progress",
      updatedAt: now,
      version: existing.version + 1,
    })
    .where(and(eq(jobVisits.id, visitId), eq(jobVisits.companyId, companyId)))
    .returning();

  await jobVisitsRepository.syncJobToVisits(companyId, jobId);

  return { visit: updated };
}

// ============================================================================
// CANCEL_VISIT
// ============================================================================

/**
 * Cancel a single visit, then sync the parent job's schedule fields.
 */
export async function cancelVisit(
  intent: CancelVisitIntent
): Promise<CancelVisitResult> {
  assertWritableSupportContext("visit.cancel");
  const { companyId, visitId, jobId } = intent;

  // Use updateJobVisitStatus with skipSync so we control sync ordering
  const visit = await jobVisitsRepository.updateJobVisitStatus(
    companyId,
    visitId,
    "cancelled",
    { skipSync: true }
  );

  // Sync job schedule after cancellation
  await jobVisitsRepository.syncJobToVisits(companyId, jobId);

  return { visit };
}

// ============================================================================
// BULK_COMPLETE_VISITS
// ============================================================================

/**
 * Bulk-complete all uncompleted visits for a job.
 *
 * Each visit gets: status=completed, outcome="completed", completedAt=now,
 * isFollowUpNeeded=false, checkedOutAt (if checkedInAt was set).
 * Syncs job schedule once after all visits are processed.
 */
export async function bulkCompleteVisits(
  intent: BulkCompleteVisitsIntent
): Promise<BulkCompleteVisitsResult> {
  assertWritableSupportContext("visit.bulkComplete");
  return bulkCompleteVisitsInternal(intent.companyId, intent.jobId, undefined, intent.changedByUserId);
}

// ============================================================================
// Reconciliation Logic (absorbed from visitReconciliation.ts)
// ============================================================================

/**
 * Reconcile parent job state after a visit is completed.
 *
 * Core rules:
 * 1. If no actionable visits remain + outcome=completed → job.status=completed
 * 2. If no actionable visits remain + outcome=needs_parts/needs_followup → job stays open + on_hold
 * 3. If actionable visits remain + outcome=needs_* → job set to on_hold
 * 4. If actionable visits remain + outcome=completed → clear on_hold if set (progress resumes)
 *
 * Must be called AFTER the visit status is set to "completed" and
 * BEFORE syncJobScheduleFromVisits clears schedule fields.
 */
async function reconcileJobAfterVisitCompletion(input: {
  companyId: string;
  jobId: string;
  outcome: VisitOutcome;
  holdReason?: HoldReason | null;
  holdNotes?: string | null;
  /** User who completed the visit — used as closedBy actor for canonical lifecycle close. */
  completedByUserId: string;
}): Promise<ReconciliationResult> {
  const { companyId, jobId, outcome, holdReason, holdNotes, completedByUserId } = input;

  // Verify job is still open — only open jobs need reconciliation.
  // Load version for optimistic locking in canonical lifecycle path.
  const [job] = await db
    .select({ id: jobs.id, status: jobs.status, openSubStatus: jobs.openSubStatus, version: jobs.version })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)));

  if (!job || job.status !== "open") {
    // Job already in terminal state — no reconciliation needed
    return {
      jobUpdated: false,
      newJobStatus: job?.status ?? "unknown",
      newOpenSubStatus: null,
    };
  }

  // Find remaining actionable visits that represent real pending work.
  // 2026-03-18: Uses canonical reconciliationActionableVisitFilter from visitPredicates.ts.
  // This includes scheduled visits AND unscheduled-but-checked-in visits (real activity),
  // while excluding inert placeholders (no schedule, no activity).
  const actionableVisits = await db
    .select({
      id: jobVisits.id,
      status: jobVisits.status,
      scheduledStart: jobVisits.scheduledStart,
      checkedInAt: jobVisits.checkedInAt,
      isActive: jobVisits.isActive,
      archivedAt: jobVisits.archivedAt,
    })
    .from(jobVisits)
    .where(reconciliationActionableVisitFilter(companyId, jobId));

  const hasRemainingVisits = actionableVisits.length > 0;

  // 2026-04-19 Task A: Canonical outcome → holdReason mapping.
  // The tech-app complete endpoint (server/routes/techField.ts) does not
  // prompt techs for a separate hold-reason dropdown — it passes
  // holdReason=null and lets the domain decide. Previously both branches
  // below fell back to `holdReason || "other"`, which meant a tech
  // marking a visit as `needs_parts` persisted `jobs.hold_reason = "other"`
  // and surfaced on the dashboard drilldown as a generic "Hold: other".
  //
  // Fix is surgical and lives here because this is the single canonical
  // writer of `jobs.hold_reason` on visit completion. The office
  // completion route (routes/jobVisits.routes.ts) still supplies an
  // explicit canonical HoldReason and is unaffected — the caller-supplied
  // value wins whenever present.
  //
  // Mapping (per shared/schema.ts holdReasonEnum):
  //   outcome="needs_parts"    → holdReason "parts"    (label "Needs Parts")
  //   outcome="needs_followup" → holdReason "other"    (preserves prior
  //                              behavior — there is no canonical follow-up
  //                              enum value and the tech app doesn't choose
  //                              a reason)
  //   caller-supplied          → used verbatim
  const effectiveHoldReason: HoldReason =
    holdReason ?? (outcome === "needs_parts" ? "parts" : "other");

  // 2026-03-20: Diagnostic logging for reconciliation debugging.
  // Logs when unexpected remaining visits prevent job closure.
  if (hasRemainingVisits && outcome === "completed") {
    console.warn(
      `[RECONCILE] Job ${jobId}: ${actionableVisits.length} actionable visit(s) remain after completion — job will NOT auto-close.`,
      actionableVisits.map(v => ({
        id: v.id,
        status: v.status,
        scheduledStart: v.scheduledStart,
        checkedInAt: v.checkedInAt,
      }))
    );
  }

  if (!hasRemainingVisits) {
    // This was the LAST actionable visit
    if (outcome === "completed") {
      // Rule 1: Completed Fully → close job through canonical lifecycle engine.
      // 2026-03-18 BP-1 fix: Previously this was a direct db.update(jobs) that
      // missed previousStatus, closedBy, schedule clearing, pmBillingStatus,
      // version increment, and audit event creation. Now routes through the
      // same CLOSE_JOB(mode=invoice_later) intent used by the office close flow,
      // so the resulting job state is structurally identical to a manual close.
      const closeIntent: LifecycleIntent = { type: "CLOSE_JOB", mode: "invoice_later" };
      const actor: TransitionActor = { userId: completedByUserId, role: "system" };

      try {
        await jobRepository.transitionJobStatus(
          companyId, jobId, job.version, closeIntent, actor
        );
      } catch (err: unknown) {
        // Graceful race handling: if the job was concurrently closed or modified,
        // reload and check — if already terminal, treat as no-op.
        if (
          err instanceof LifecycleTransitionError ||
          (err instanceof Error && (err as any).code === "VERSION_MISMATCH")
        ) {
          const [reloaded] = await db
            .select({ id: jobs.id, status: jobs.status })
            .from(jobs)
            .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)));

          if (reloaded && reloaded.status !== "open") {
            // Already terminal — safe no-op
            return { jobUpdated: false, newJobStatus: reloaded.status, newOpenSubStatus: null };
          }

          // Still open but version changed — retry once with fresh version
          if (reloaded && (err as any).code === "VERSION_MISMATCH") {
            const [fresh] = await db
              .select({ version: jobs.version })
              .from(jobs)
              .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)));

            if (fresh) {
              await jobRepository.transitionJobStatus(
                companyId, jobId, fresh.version, closeIntent, actor
              );
              return { jobUpdated: true, newJobStatus: "completed", newOpenSubStatus: null };
            }
          }

          // LifecycleTransitionError on a still-open job is unexpected — re-throw
          throw err;
        }
        throw err;
      }

      return { jobUpdated: true, newJobStatus: "completed", newOpenSubStatus: null };
    }

    // Rule 2: Needs Follow-Up → keep open + on_hold with required hold reason.
    // 2026-03-18 BP-2 fix: Route through updateJobStatusWithEvent() for version
    // increment and audit trail. Same pattern used by placeJobOnHold().
    await jobRepository.updateJobStatusWithEvent(companyId, jobId, {
      fromStatus: "open",
      toStatus: "open",
      changedBy: completedByUserId,
      note: `Visit reconciliation: outcome=${outcome} — placed on hold (no remaining visits)`,
      meta: { action: "reconcile_hold", outcome, holdReason: effectiveHoldReason },
      additionalUpdates: {
        openSubStatus: "on_hold",
        holdReason: effectiveHoldReason,
        holdNotes: holdNotes || null,
        onHoldAt: new Date(),
      },
    });

    return { jobUpdated: true, newJobStatus: "open", newOpenSubStatus: "on_hold" };
  }

  // Other actionable visits remain — do NOT auto-close parent job
  if (outcome === "needs_parts" || outcome === "needs_followup") {
    // Rule 3: This visit needs follow-up → put parent job on_hold even though other visits exist.
    // 2026-03-18 BP-2 fix: Route through updateJobStatusWithEvent() for version
    // increment and audit trail. Same pattern used by placeJobOnHold().
    await jobRepository.updateJobStatusWithEvent(companyId, jobId, {
      fromStatus: "open",
      toStatus: "open",
      changedBy: completedByUserId,
      note: `Visit reconciliation: outcome=${outcome} — placed on hold (other visits remain)`,
      meta: { action: "reconcile_hold_partial", outcome, holdReason: effectiveHoldReason },
      additionalUpdates: {
        openSubStatus: "on_hold",
        holdReason: effectiveHoldReason,
        holdNotes: holdNotes || null,
        onHoldAt: new Date(),
      },
    });

    return { jobUpdated: true, newJobStatus: "open", newOpenSubStatus: "on_hold" };
  }

  // Rule 4: Completed fully but other visits remain.
  // If the job was on_hold from a prior visit's needs_followup,
  // a subsequent successful completion signals progress — clear the hold.
  // 2026-03-18 BP-2 fix: Route through updateJobStatusWithEvent() for version
  // increment and audit trail. Same pattern used by resumeJob().
  if (job.openSubStatus === "on_hold") {
    await jobRepository.updateJobStatusWithEvent(companyId, jobId, {
      fromStatus: "open",
      toStatus: "open",
      changedBy: completedByUserId,
      note: "Visit reconciliation: subsequent visit completed — hold cleared",
      meta: { action: "reconcile_resume" },
      additionalUpdates: {
        openSubStatus: null,
        holdReason: null,
        holdNotes: null,
        onHoldAt: null,
      },
    });
    return { jobUpdated: true, newJobStatus: "open", newOpenSubStatus: null };
  }

  return { jobUpdated: false, newJobStatus: "open", newOpenSubStatus: null };
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Internal bulk-complete implementation shared by BULK_COMPLETE_VISITS intent
 * and FORCE_CLOSE_JOB's autoCompleteOpenVisits option.
 *
 * Sets structured completion fields on each visit:
 * outcome="completed", completedAt=now, isFollowUpNeeded=false,
 * checkedOutAt (if checkedInAt was set).
 */
async function bulkCompleteVisitsInternal(
  companyId: string,
  jobId: string,
  txHandle?: any,
  changedByUserId?: string,
): Promise<BulkCompleteVisitsResult> {
  const uncompleted = await jobVisitsRepository.getUncompletedVisits(companyId, jobId);
  if (!uncompleted.length) {
    return { completedCount: 0, visits: [] };
  }

  const now = new Date();
  const completedVisits: JobVisit[] = [];

  // Run visit updates in provided transaction or create a new one
  const runVisitUpdates = async (tx: any) => {
    for (const visit of uncompleted) {
      const updates: Record<string, unknown> = {
        status: "completed",
        outcome: "completed",
        completedAt: now,
        isFollowUpNeeded: false,
        // 2026-04-10 micro-patch: clear the cancel-start restore marker on
        // every terminal cleanup path. A paused visit caught up in a force
        // close / bulk complete must not leave a stale previousStatus behind.
        // Mirrors the same clearing in completeVisit (line 459).
        previousStatus: null,
        updatedAt: now,
        version: visit.version + 1,
      };

      if (visit.checkedInAt && !visit.checkedOutAt) {
        updates.checkedOutAt = now;
      } else if (!visit.checkedInAt) {
        updates.checkedOutAt = now;
      }

      const [updated] = await tx
        .update(jobVisits)
        .set(updates)
        .where(and(eq(jobVisits.id, visit.id), eq(jobVisits.companyId, companyId)))
        .returning();

      completedVisits.push(updated);
    }
  };

  if (txHandle) {
    await runVisitUpdates(txHandle);
  } else {
    await db.transaction(runVisitUpdates);
  }

  // 2026-04-05: Stop running time entries for all assigned technicians on completed visits.
  // Runs AFTER visit transaction commits so time entry reads are consistent.
  // Collected unique technician IDs to avoid duplicate stop attempts.
  // 2026-04-12 scalar removal: collect from the crew array on each visit.
  const techIds = new Set<string>();
  for (const v of uncompleted) {
    const crew = Array.isArray((v as any).assignedTechnicianIds) ? (v as any).assignedTechnicianIds : [];
    for (const id of crew) {
      if (id) techIds.add(id);
    }
  }
  for (const techId of Array.from(techIds)) {
    try {
      const running = await timeTrackingRepository.getRunningTimeEntry(companyId, techId);
      if (running && running.jobId === jobId) {
        await timeTrackingRepository.stopTimeEntry(companyId, techId, {
          timeEntryId: running.id,
          at: now,
        });
      }
    } catch {
      // Non-fatal: entry may not exist or already stopped
    }
  }

  // Sync job schedule — pass txHandle so it participates in the outer transaction
  await jobVisitsRepository.syncJobToVisits(companyId, jobId, txHandle);

  // 2026-04-12: Audit the force-close initiator. Actor attribution is the
  // office/dispatcher/admin who triggered the bulk completion — it is
  // explicitly NOT the assigned crew. Technician-side records remain
  // attributed to the acting technician via time_entries.
  if (changedByUserId && completedVisits.length > 0) {
    try {
      await logEventAsync(
        { db, tenantId: companyId, userId: changedByUserId, role: "system" as any },
        {
          eventType: "visit.bulk_completed",
          entityType: "job",
          entityId: jobId,
          summary: `Bulk-completed ${completedVisits.length} visit(s) during force close`,
          meta: {
            jobId,
            completedCount: completedVisits.length,
            changedByUserId,
            visitIds: completedVisits.map((v) => v.id),
          },
        },
      );
    } catch {
      // Non-fatal: event logging must never block job close
    }
  }

  return { completedCount: completedVisits.length, visits: completedVisits };
}

// ============================================================================
// RESCHEDULE_VISIT
// ============================================================================

/**
 * Reschedule a visit — orchestrates the workflow decision between in-place
 * update and complete-and-spawn based on visit state.
 *
 * 2026-03-20: Extracted from storage/scheduling.ts:rescheduleVisit() to
 * move workflow branching out of the storage layer. Storage must not own
 * orchestration-grade decisions. The spawn path sets visit status to
 * "completed" which is a lifecycle mutation owned by this orchestrator.
 */
export async function rescheduleVisit(
  intent: RescheduleVisitIntent
): Promise<RescheduleVisitResult> {
  assertWritableSupportContext("visit.reschedule");
  const { companyId, visitId } = intent;

  // Step 1: Load visit
  const visit = await jobVisitsRepository.getJobVisit(companyId, visitId);
  if (!visit) {
    throw new Error("Visit not found");
  }

  // 2026-04-21 Phase 2 push notifications: snapshot pre-write datetime state
  // from the visit row we already have in scope. Used by the route handler
  // to drive meaningful-delta detection for the schedule-change emitter.
  const previousScheduledStart = visit.scheduledStart
    ? (visit.scheduledStart instanceof Date ? visit.scheduledStart.toISOString() : String(visit.scheduledStart))
    : null;
  const previousScheduledEnd = visit.scheduledEnd
    ? (visit.scheduledEnd instanceof Date ? visit.scheduledEnd.toISOString() : String(visit.scheduledEnd))
    : null;
  const previousIsAllDay = visit.isAllDay === true;

  // Step 2: Load parent job for terminal-status check
  const existingJob = await schedulingRepository.getJobById(companyId, visit.jobId);
  if (!existingJob) {
    throw new Error("Parent job not found");
  }

  // Step 3: Terminal status guard
  if (JOB_TERMINAL_STATUSES.includes(existingJob.status as any)) {
    throw new TerminalJobImmutableError(visit.jobId, existingJob.status);
  }

  // Step 4: Version check
  if (intent.expectedVersion !== undefined && visit.version !== intent.expectedVersion) {
    throw new VersionMismatchError(intent.expectedVersion, visit.version);
  }

  // Step 5: All-day → timed conversion guard
  const wasAllDay = visit.isAllDay === true;
  const isNowTimed = intent.allDay === false && intent.startAt != null;
  if (wasAllDay && isNowTimed) {
    const duration = (existingJob.durationMinutes && existingJob.durationMinutes > 0 && existingJob.durationMinutes <= 480)
      ? existingJob.durationMinutes
      : DEFAULT_VISIT_DURATION_MINUTES;
    intent.endAt = new Date(intent.startAt!.getTime() + duration * 60_000);
  }

  // Step 6: Spawn-on-action decision
  const visitIsActioned = isVisitActioned(visit);
  const shouldSpawn = intent.mode === "complete_and_new" || (visitIsActioned && intent.mode !== "replace");

  if (shouldSpawn) {
    // Handle old visit
    if (intent.mode === "complete_and_new") {
      // Labor unification: actualDurationMinutes deprecated — duration derived from time_entries
      const now = new Date();
      await jobVisitsRepository.updateJobVisit(companyId, visit.id, visit.version, {
        status: "completed",
        outcome: "completed",
        completedAt: now,
        isFollowUpNeeded: false,
        checkedOutAt: now,
      });
    } else {
      await jobVisitsRepository.updateJobVisit(companyId, visit.id, visit.version, {
        isActive: false,
      });
    }

    // Create new visit. Canonical crew: intent's crew if provided, else carry
    // over the current visit's crew.
    const normalized = normalizeScheduleTimes({ allDay: intent.allDay, startAt: intent.startAt, endAt: intent.endAt });
    // 2026-04-12 scalar removal: crew-only. Fall back to the existing visit's
    // crew array when the intent omits crew; no scalar fallback.
    const incomingCrew: string[] | null | undefined = intent.assignedTechnicianIds;
    const crewSource: string[] | null =
      incomingCrew !== undefined
        ? incomingCrew
        : ((visit as any).assignedTechnicianIds ?? []);
    const techAssignment = normalizeVisitCrewWrite(crewSource);

    await jobVisitsRepository.createJobVisit(companyId, visit.jobId, {
      scheduledStart: normalized.scheduledStart,
      scheduledEnd: normalized.scheduledEnd,
      isAllDay: normalized.isAllDay,
      assignedTechnicianIds: techAssignment.assignedTechnicianIds,
      status: "scheduled",
      visitNotes: intent.notes,
    });
  } else {
    // Not actioned: update in place
    const visitUpdate: any = {};
    if (intent.startAt !== undefined || intent.allDay !== undefined) {
      const normalized = normalizeScheduleTimes({ allDay: intent.allDay, startAt: intent.startAt, endAt: intent.endAt });
      visitUpdate.scheduledStart = normalized.scheduledStart;
      visitUpdate.scheduledEnd = normalized.scheduledEnd;
      visitUpdate.isAllDay = normalized.isAllDay;
    }
    if (intent.assignedTechnicianIds !== undefined) {
      const techAssignment = normalizeVisitCrewWrite(intent.assignedTechnicianIds);
      visitUpdate.assignedTechnicianIds = techAssignment.assignedTechnicianIds;
    }
    if (intent.notes !== undefined) visitUpdate.visitNotes = intent.notes;
    if (Object.keys(visitUpdate).length > 0) {
      await jobVisitsRepository.updateJobVisit(companyId, visit.id, visit.version, visitUpdate);
    }
  }

  // Re-fetch job (synced via updateJobVisit/createJobVisit)
  const result = await schedulingRepository.getJobById(companyId, visit.jobId);
  // Re-fetch visit to get updated visit version
  const updatedVisit = await jobVisitsRepository.getJobVisit(companyId, visitId);

  return {
    ...result,
    visitId,
    visitVersion: updatedVisit?.version ?? result?.version,
    // 2026-04-21 Phase 2: pre-write snapshot for schedule-change emitter.
    previousScheduledStart,
    previousScheduledEnd,
    previousIsAllDay,
  };
}

// ============================================================================
// ASSIGN_VISIT_CREW (2026-04-21)
// ============================================================================

/**
 * Replace the crew on a scheduled visit without touching its schedule.
 *
 * Phase 1 canonical visit mutation architecture: the sole crew write path
 * for any office/dispatch surface. The route handler at
 * `PATCH /api/calendar/visit/:visitId/assign-crew` is a thin delegator.
 *
 * Invariants enforced here (previously absent on the direct-storage path):
 *   - terminal job → reject (mirrors `rescheduleVisit` terminal guard)
 *   - terminal visit (completed / cancelled) → reject; use reopen instead
 *   - version check → optimistic locking
 *
 * Actioned-visit policy: we DO allow crew replacement on an actioned visit
 * (e.g., en_route / in_progress). Swapping a tech mid-visit is a legitimate
 * dispatcher action and does not carry the same identity-destruction risk
 * as rescheduling an actioned visit. If that policy ever needs to tighten,
 * the spawn-on-action logic from `rescheduleVisit` is the pattern to reuse.
 */
export async function assignVisitCrew(
  intent: AssignVisitCrewIntent,
): Promise<AssignVisitCrewResult> {
  assertWritableSupportContext("visit.assignCrew");
  const { companyId, visitId, assignedTechnicianIds, expectedVersion } = intent;

  const visit = await jobVisitsRepository.getJobVisit(companyId, visitId);
  if (!visit) {
    throw new Error("Visit not found");
  }

  const existingJob = await schedulingRepository.getJobById(companyId, visit.jobId);
  if (!existingJob) {
    throw new Error("Parent job not found");
  }
  if (JOB_TERMINAL_STATUSES.includes(existingJob.status as any)) {
    throw new TerminalJobImmutableError(visit.jobId, existingJob.status);
  }

  if (visit.status === "completed" || visit.status === "cancelled") {
    throw new Error(`Cannot assign crew to a ${visit.status} visit. Reopen first.`);
  }

  if (visit.version !== expectedVersion) {
    throw new VersionMismatchError(expectedVersion, visit.version);
  }

  const { assignedTechnicianIds: normalized } = normalizeVisitCrewWrite(assignedTechnicianIds);

  // 2026-04-21 Phase 1: capture the crew BEFORE the write. The orchestrator
  // is the only place in the system with a clean before/after pair — we
  // return both so the route can compute the newly-assigned delta for
  // push notifications without re-fetching the visit.
  const previousAssignedTechnicianIds = Array.isArray(visit.assignedTechnicianIds)
    ? [...visit.assignedTechnicianIds]
    : [];

  await jobVisitsRepository.updateJobVisit(companyId, visit.id, visit.version, {
    assignedTechnicianIds: normalized,
  });

  const updatedVisit = await jobVisitsRepository.getJobVisit(companyId, visitId);
  if (!updatedVisit) {
    throw new Error("Visit disappeared during crew assignment");
  }

  return {
    visit: updatedVisit,
    jobId: visit.jobId,
    previousAssignedTechnicianIds,
    jobNumber: existingJob.jobNumber,
  };
}

// ============================================================================
// UNSCHEDULE_VISIT (2026-04-21)
// ============================================================================

/**
 * Unschedule a visit — return it to the backlog.
 *
 * Phase 1 canonical visit mutation architecture: single orchestrator entry
 * point for any "clear schedule fields on a visit" operation. Delegates the
 * actual write to `schedulingRepository.unscheduleVisit()` (which owns
 * terminal-job + terminal-visit + version-check guards already) after
 * adding the actioned-visit guard the direct path does not enforce.
 *
 * Actioned-visit rejection rationale: once a tech has checked in, started
 * travel, or any other non-"scheduled" progression, the visit reflects
 * real-world state that cannot be silently discarded. The office must
 * explicitly cancel the visit (orchestrator `cancelVisit`) or reopen /
 * reschedule it — not "unschedule" it.
 */
export async function unscheduleVisit(
  intent: UnscheduleVisitIntent,
): Promise<UnscheduleVisitResult> {
  assertWritableSupportContext("visit.unschedule");
  const { companyId, visitId, expectedVersion } = intent;

  const visit = await jobVisitsRepository.getJobVisit(companyId, visitId);
  if (!visit) {
    throw new Error("Visit not found");
  }

  if (isVisitActioned(visit)) {
    const err: any = new Error(
      `Cannot unschedule an actioned visit (status=${visit.status}). ` +
      `Cancel or reschedule the visit instead.`,
    );
    err.status = 409;
    err.code = "VISIT_ACTIONED";
    throw err;
  }

  return await schedulingRepository.unscheduleVisit(companyId, visitId, expectedVersion);
}
