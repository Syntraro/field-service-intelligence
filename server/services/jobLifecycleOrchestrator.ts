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
import { and, eq, notInArray, isNull, isNotNull, or, sql } from "drizzle-orm";
import { jobVisits, jobs, jobNotes } from "@shared/schema";
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
  normalizeTechnicianAssignment,
  TerminalJobImmutableError,
  VersionMismatchError,
} from "../domain/scheduling";
import { jobRepository } from "../storage/jobs";
import { jobVisitsRepository, isVisitActioned } from "../storage/jobVisits";
import { schedulingRepository, DEFAULT_VISIT_DURATION_MINUTES } from "../storage/scheduling";
import { reconciliationActionableVisitFilter } from "../lib/visitPredicates";

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
  /** Optional free-text note from the tech. When provided, the orchestrator
   *  appends it to visitNotes and auto-creates a job note documenting the outcome. */
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
}

/** Mark a visit as en_route (tech traveling to job site). */
export interface SetVisitEnRouteIntent {
  type: "SET_VISIT_EN_ROUTE";
  companyId: string;
  visitId: string;
  jobId: string;
  /** Timestamp override (e.g. from mobile device clock). Defaults to server now. */
  at?: Date;
}

/** Start a visit (tech on-site, work beginning). Sets checkedInAt if not already set. */
export interface StartVisitIntent {
  type: "START_VISIT";
  companyId: string;
  visitId: string;
  jobId: string;
  /** Timestamp override (e.g. from mobile device clock). Defaults to server now. */
  at?: Date;
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
  technicianUserId?: string | null;
  startAt?: Date;
  endAt?: Date;
  notes?: string;
  allDay?: boolean;
  expectedVersion?: number;
  mode?: "replace" | "complete_and_new";
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
  | RescheduleVisitIntent
  | ReopenVisitIntent;

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

  // Step 2: Visit update + optional job note run in a single transaction.
  const now = new Date();
  const trimmedNote = outcomeNote?.trim() || null;

  const updatedVisit = await db.transaction(async (tx) => {
    const visitUpdates: Record<string, unknown> = {
      status: "completed",
      outcome,
      completedAt: now,
      completedByUserId,
      isFollowUpNeeded: isFollowUpNeeded ?? (outcome !== "completed"),
      updatedAt: now,
      version: existing.version + 1,
    };

    // Auto check-out if checked in but not yet checked out
    // Labor unification: actualDurationMinutes deprecated — duration derived from time_entries
    if (existing.checkedInAt && !existing.checkedOutAt) {
      visitUpdates.checkedOutAt = now;
    }

    // Include outcome note in visitNotes if provided
    if (trimmedNote) {
      visitUpdates.visitNotes = [
        existing.visitNotes,
        `[OUTCOME: ${outcome}] ${trimmedNote}`,
        `[COMPLETED_BY: ${completedByUserId}]`,
      ].filter(Boolean).join("\n");
    }

    const [visit] = await tx
      .update(jobVisits)
      .set(visitUpdates)
      .where(and(eq(jobVisits.id, visitId), eq(jobVisits.companyId, companyId)))
      .returning();

    // Auto-create job note documenting the outcome (if note provided)
    if (trimmedNote) {
      const outcomeLabels: Record<string, string> = {
        completed: "Completed",
        needs_parts: "Needs parts",
        needs_followup: "Needs follow-up",
      };
      const label = visitNumber ? `Visit #${visitNumber}` : "Visit";
      await tx.insert(jobNotes).values({
        id: sql`gen_random_uuid()`,
        companyId,
        jobId,
        userId: completedByUserId,
        noteText: `${label} — ${outcomeLabels[outcome] ?? outcome}: ${trimmedNote}`,
        createdAt: now,
        updatedAt: now,
      });
    }

    return visit;
  });

  // Step 3: Reconcile parent job AFTER visit transaction commits.
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

  // Step 4: Sync job schedule from visits AFTER transaction commits.
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
  intent: ForceCloseJobIntent
): Promise<ForceCloseJobResult> {
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

  // Step 1: Bulk-complete open visits if requested
  if (autoCompleteOpenVisits) {
    const result = await bulkCompleteVisitsInternal(companyId, jobId);
    autoCompletedVisitCount = result.completedCount;
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
    version,
    lifecycleIntent,
    actor
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
 */
export async function undoCloseJob(
  intent: UndoCloseJobIntent
): Promise<UndoCloseJobResult> {
  const { companyId, jobId, version, actor } = intent;

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
  intent: MarkInvoicedIntent
): Promise<MarkInvoicedResult> {
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
    actor
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
// SET_VISIT_EN_ROUTE
// ============================================================================

/**
 * Mark a visit as en_route — tech is traveling to the job site.
 *
 * 2026-03-18 BP-3 fix: Moved from route-level direct db.update(jobVisits) in
 * techField.ts to canonical orchestrator ownership. Validation, mutation, and
 * schedule sync are now centralized here.
 */
export async function setVisitEnRoute(
  intent: SetVisitEnRouteIntent
): Promise<SetVisitEnRouteResult> {
  const { companyId, visitId, jobId, at } = intent;
  const now = at ?? new Date();

  // Step 1: Load and validate visit
  const existing = await jobVisitsRepository.getJobVisit(companyId, visitId);
  if (!existing) {
    throw new Error(`Visit ${visitId} not found for company ${companyId}`);
  }
  if (existing.status === "completed" || existing.status === "cancelled") {
    throw new Error(`Cannot update a ${existing.status} visit`);
  }

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
  const { companyId, visitId, jobId, at } = intent;
  const now = at ?? new Date();

  // Step 1: Load and validate visit
  const existing = await jobVisitsRepository.getJobVisit(companyId, visitId);
  if (!existing) {
    throw new Error(`Visit ${visitId} not found for company ${companyId}`);
  }
  if (existing.status === "completed" || existing.status === "cancelled") {
    throw new Error(`Cannot start a ${existing.status} visit`);
  }

  // Step 2: Apply visit workflow mutation
  // Preserve existing checkedInAt if already set (idempotent check-in)
  const [updated] = await db
    .update(jobVisits)
    .set({
      status: "in_progress",
      checkedInAt: existing.checkedInAt ?? now,
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
// CANCEL_VISIT
// ============================================================================

/**
 * Cancel a single visit, then sync the parent job's schedule fields.
 */
export async function cancelVisit(
  intent: CancelVisitIntent
): Promise<CancelVisitResult> {
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
  return bulkCompleteVisitsInternal(intent.companyId, intent.jobId);
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
      meta: { action: "reconcile_hold", outcome, holdReason: holdReason || "other" },
      additionalUpdates: {
        openSubStatus: "on_hold",
        holdReason: holdReason || "other",
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
      meta: { action: "reconcile_hold_partial", outcome, holdReason: holdReason || "other" },
      additionalUpdates: {
        openSubStatus: "on_hold",
        holdReason: holdReason || "other",
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
  jobId: string
): Promise<BulkCompleteVisitsResult> {
  const uncompleted = await jobVisitsRepository.getUncompletedVisits(companyId, jobId);
  if (!uncompleted.length) {
    return { completedCount: 0, visits: [] };
  }

  const now = new Date();
  const completedVisits: JobVisit[] = [];

  // Wrap all visit updates in a single transaction (eliminates N separate implicit transactions)
  await db.transaction(async (tx) => {
    for (const visit of uncompleted) {
      const updates: Record<string, unknown> = {
        status: "completed",
        outcome: "completed",
        completedAt: now,
        isFollowUpNeeded: false,
        updatedAt: now,
        version: visit.version + 1,
      };

      // Auto check-out if checked in but not yet checked out
      // Labor unification: actualDurationMinutes deprecated — duration derived from time_entries
      if (visit.checkedInAt && !visit.checkedOutAt) {
        updates.checkedOutAt = now;
      } else if (!visit.checkedInAt) {
        // Never checked in — still set checkedOutAt for audit completeness
        updates.checkedOutAt = now;
      }

      const [updated] = await tx
        .update(jobVisits)
        .set(updates)
        .where(and(eq(jobVisits.id, visit.id), eq(jobVisits.companyId, companyId)))
        .returning();

      completedVisits.push(updated);
    }
  });

  // Sync job schedule once after all visits are completed (outside transaction — same semantic position)
  await jobVisitsRepository.syncJobToVisits(companyId, jobId);

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
  const { companyId, visitId } = intent;

  // Step 1: Load visit
  const visit = await jobVisitsRepository.getJobVisit(companyId, visitId);
  if (!visit) {
    throw new Error("Visit not found");
  }

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

    // Create new visit
    const normalized = normalizeScheduleTimes({ allDay: intent.allDay, startAt: intent.startAt, endAt: intent.endAt });
    const techAssignment = intent.technicianUserId !== undefined
      ? normalizeTechnicianAssignment(intent.technicianUserId || null)
      : normalizeTechnicianAssignment(visit.assignedTechnicianId || null);

    await jobVisitsRepository.createJobVisit(companyId, visit.jobId, {
      scheduledStart: normalized.scheduledStart,
      scheduledEnd: normalized.scheduledEnd,
      isAllDay: normalized.isAllDay,
      assignedTechnicianId: techAssignment.primaryTechnicianId,
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
    if (intent.technicianUserId !== undefined) {
      const techAssignment = normalizeTechnicianAssignment(intent.technicianUserId || null);
      visitUpdate.assignedTechnicianId = techAssignment.primaryTechnicianId;
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

  return { ...result, visitId, visitVersion: updatedVisit?.version ?? result?.version };
}
