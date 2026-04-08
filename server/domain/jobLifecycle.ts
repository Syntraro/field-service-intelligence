/**
 * Job Lifecycle Domain Logic
 *
 * SINGLE SOURCE OF TRUTH for job lifecycle transitions (close, cancel, archive).
 *
 * =============================================================================
 * STATUS MODEL (4 lifecycle values)
 * =============================================================================
 *
 * LIFECYCLE STATES (stored in jobs.status):
 * - "open"      - Active job that can be worked on
 * - "completed" - Work finished (may need invoicing)
 * - "invoiced"  - Invoice created (locked for billing)
 * - "archived"  - Historical archive (includes canceled jobs)
 *
 * WORKFLOW SUB-STATUS (only valid when status = 'open'):
 * - null           - Default, no special workflow state
 * - "in_progress"  - Work actively being performed
 * - "on_hold"      - Job is blocked (requires holdReason)
 * - "on_route"     - Technician traveling to job site
 * - (needs_review: removed — migrated to on_hold)
 *
 * INVARIANT: openSubStatus must be NULL when status !== 'open'
 *
 * =============================================================================
 * Invariants enforced:
 * - Terminal statuses (completed, invoiced, archived) have restricted transitions
 * - When transitioning to terminal: openSubStatus MUST be cleared
 * - All transitions require version checking (optimistic locking)
 * - RBAC: Only Owner/Admin/Dispatcher/Manager can perform lifecycle transitions
 * =============================================================================
 */

import type { JobStatus, Job, OpenSubStatus, InvoiceStatus } from "@shared/schema";

// ============================================================================
// Lifecycle Flow Maps (formerly in statusRules.ts — consolidated 2026-03-19)
// ============================================================================

/**
 * Job Status Flow — valid transitions between lifecycle states.
 * open → completed, invoiced, archived
 * completed → invoiced, archived, open (reopen)
 * invoiced → archived only (must void invoice to reopen)
 * archived → open (reopen, rare)
 */
export const JOB_STATUS_FLOW: Record<JobStatus, JobStatus[]> = {
  open: ["completed", "invoiced", "archived"],
  completed: ["invoiced", "archived", "open"],
  invoiced: ["archived"],
  archived: ["open"],
};

/**
 * Valid transitions for openSubStatus when status = 'open'.
 * null represents no sub-status (default state).
 */
export const OPEN_SUB_STATUS_FLOW: Record<OpenSubStatus | "null", (OpenSubStatus | null)[]> = {
  null: ["in_progress", "on_hold", "on_route"],
  in_progress: [null, "on_hold"],
  on_hold: [null, "in_progress"],
  on_route: [null, "in_progress"],
};

/** States that can be "closed" (via /api/jobs/:id/close) */
export const CLOSEABLE_STATUSES: JobStatus[] = ["open"];

/** States that can be "reopened" — invoiced intentionally excluded */
export const REOPENABLE_STATUSES: JobStatus[] = ["completed", "archived"];

/** Terminal states — jobs considered "finished" */
export const JOB_TERMINAL_STATUSES: JobStatus[] = ["invoiced", "archived"];

/** Active states — jobs in progress */
export const ACTIVE_STATUSES: JobStatus[] = ["open"];

/**
 * Invoice Status Flow — valid transitions between invoice statuses.
 * Terminal states: paid, voided.
 *
 * Notes:
 * - "sent" is a legacy alias for "awaiting_payment". New code should write
 *   "awaiting_payment". The "sent" entries below exist solely so existing
 *   persisted rows continue to behave correctly during transition.
 * - awaiting_payment ↔ draft: also allowed via "undo sent" path for unpaid
 *   issued invoices (enforced by route + amountPaid===0 guard).
 * - partial_paid → awaiting_payment: legal when the last payment is deleted
 *   and amountPaid drops to 0. Used by payment recalc rollback.
 */
export const INVOICE_STATUS_FLOW: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ["awaiting_payment", "sent", "voided"],
  awaiting_payment: ["draft", "partial_paid", "paid", "voided"],
  sent: ["draft", "partial_paid", "paid", "voided", "awaiting_payment"],
  partial_paid: ["awaiting_payment", "paid", "voided"],
  paid: [],
  voided: [],
};

// ============================================================================
// Lifecycle Assertions (formerly in statusRules.ts — consolidated 2026-03-19)
// ============================================================================

/**
 * Assert that a job status transition is valid per the status flow.
 * Throws on invalid transition.
 */
export function assertJobStatusTransition(from: JobStatus | string, to: JobStatus | string) {
  const allowed = JOB_STATUS_FLOW[from as JobStatus] ?? [];
  if (!allowed.includes(to as JobStatus)) {
    throw new Error(`Invalid job status transition: ${from} -> ${to}`);
  }
}

/**
 * Assert that an openSubStatus transition is valid.
 * Only valid when status = 'open'.
 */
export function assertOpenSubStatusTransition(
  from: OpenSubStatus | null,
  to: OpenSubStatus | null
) {
  const fromKey = from === null ? "null" : from;
  const allowed = OPEN_SUB_STATUS_FLOW[fromKey] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(`Invalid openSubStatus transition: ${from} -> ${to}`);
  }
}

/**
 * Assert that an invoice status transition is valid.
 * Throws on invalid transition.
 */
export function assertInvoiceStatusTransition(from: InvoiceStatus, to: InvoiceStatus) {
  const allowed = INVOICE_STATUS_FLOW[from] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(`Invalid invoice status transition: ${from} -> ${to}`);
  }
}

// ============================================================================
// Types
// ============================================================================

/**
 * Lifecycle transition intents
 */
export type LifecycleIntent =
  | { type: "CLOSE_JOB"; mode: "archive" | "invoice_later" | "invoice_now"; invoiceId?: string }
  | { type: "CANCEL_JOB"; reason?: string }
  | { type: "ARCHIVE_JOB" }
  | { type: "REOPEN_JOB"; targetStatus?: JobStatus; targetOpenSubStatus?: OpenSubStatus }
  | { type: "UNDO_CLOSE" }
  | { type: "MARK_INVOICED"; invoiceId: string };

/**
 * Actor performing the transition
 */
export interface TransitionActor {
  userId: string;
  role: string;
}

/**
 * Result of applying a lifecycle transition
 */
export interface LifecycleTransitionResult {
  /** Fields to patch on the job */
  patch: Partial<Job>;
  /** Audit events to record (may be multiple for multi-step transitions) */
  auditEvents: LifecycleAuditEvent[];
  /** Final status after transition */
  finalStatus: JobStatus;
}

/**
 * Audit event for status transition
 */
export interface LifecycleAuditEvent {
  fromStatus: string;
  toStatus: string;
  action: string;
  note?: string;
  meta?: Record<string, unknown>;
}

/**
 * Lifecycle transition error
 */
export class LifecycleTransitionError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(code: string, message: string, statusCode: number = 400) {
    super(message);
    this.name = "LifecycleTransitionError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Roles allowed to perform lifecycle transitions (close/cancel/archive).
 * "system" is used by the orchestrator for automated transitions (e.g.,
 * reconciliation auto-close after last visit completion). It is NOT a
 * user-facing role — it can only be constructed server-side.
 */
export const LIFECYCLE_ROLES = ["owner", "admin", "dispatcher", "manager", "system"] as const;

/**
 * Undo window in milliseconds (20 seconds)
 */
export const UNDO_WINDOW_MS = 20 * 1000;

// ============================================================================
// RBAC Helpers
// ============================================================================

/**
 * Check if actor has permission to perform lifecycle transitions
 */
export function canPerformLifecycleTransition(actor: TransitionActor): boolean {
  return LIFECYCLE_ROLES.includes(actor.role as typeof LIFECYCLE_ROLES[number]);
}

/**
 * Assert actor has permission, throw FORBIDDEN if not
 */
export function assertLifecyclePermission(actor: TransitionActor): void {
  if (!canPerformLifecycleTransition(actor)) {
    throw new LifecycleTransitionError(
      "FORBIDDEN",
      `Role '${actor.role}' cannot perform lifecycle transitions. Required: ${LIFECYCLE_ROLES.join(", ")}`,
      403
    );
  }
}

// ============================================================================
// Status Transition Helpers
// ============================================================================

/**
 * Check if a status transition is valid per the status flow rules
 */
export function isValidTransition(from: JobStatus, to: JobStatus): boolean {
  const allowed = JOB_STATUS_FLOW[from] ?? [];
  return allowed.includes(to);
}

/**
 * Check if job can be closed (is in a closeable state)
 */
export function canClose(status: JobStatus | string): boolean {
  return CLOSEABLE_STATUSES.includes(status as JobStatus);
}

/**
 * Check if status is terminal
 */
export function isTerminalStatus(status: JobStatus | string): boolean {
  return JOB_TERMINAL_STATUSES.includes(status as JobStatus);
}

// ============================================================================
// Scheduling Field Clearing
// ============================================================================

/**
 * Get patch to clear all scheduling-related fields.
 * Called when transitioning to terminal statuses.
 * MODEL A: No calendarAssignmentId - scheduling is on jobs table
 */
export function getScheduleClearingPatch(): Partial<Job> {
  return {
    scheduledStart: null,
    scheduledEnd: null,
    isAllDay: false,
  };
}

/**
 * Get patch to clear openSubStatus and related workflow fields.
 * Called when transitioning away from 'open' status.
 */
export function getOpenSubStatusClearingPatch(): Partial<Job> {
  return {
    openSubStatus: null,
    holdReason: null,
    holdNotes: null,
    nextActionDate: null,
    onHoldAt: null,
  };
}

/**
 * Check if a job has any scheduling fields set
 */
export function hasScheduleFields(job: Partial<Job>): boolean {
  return !!(
    job.scheduledStart ||
    job.scheduledEnd ||
    job.isAllDay
  );
}

// ============================================================================
// Main Transition Engine
// ============================================================================

/**
 * Apply a lifecycle transition to a job.
 *
 * This is the SINGLE entry point for all lifecycle transitions.
 * Routes should call this to get the patch and audit events,
 * then persist via transactional storage.
 *
 * @param job - Current job state
 * @param intent - The transition intent
 * @param actor - The user performing the transition
 * @returns Patch to apply and audit events to record
 * @throws LifecycleTransitionError on invalid transitions
 */
export function applyLifecycleTransition(
  job: Job,
  intent: LifecycleIntent,
  actor: TransitionActor
): LifecycleTransitionResult {
  // RBAC check first
  assertLifecyclePermission(actor);

  const currentStatus = job.status as JobStatus;

  switch (intent.type) {
    case "CLOSE_JOB":
      return applyCloseTransition(job, currentStatus, intent, actor);

    case "CANCEL_JOB":
      return applyCancelTransition(job, currentStatus, intent, actor);

    case "ARCHIVE_JOB":
      return applyArchiveTransition(job, currentStatus, actor);

    case "REOPEN_JOB":
      return applyReopenTransition(job, currentStatus, intent, actor);

    case "UNDO_CLOSE":
      return applyUndoCloseTransition(job, currentStatus, actor);

    case "MARK_INVOICED":
      return applyMarkInvoicedTransition(job, currentStatus, intent, actor);

    default:
      throw new LifecycleTransitionError(
        "INVALID_INTENT",
        `Unknown lifecycle intent: ${(intent as any).type}`
      );
  }
}

// ============================================================================
// Close Transition
// ============================================================================

function applyCloseTransition(
  job: Job,
  currentStatus: JobStatus,
  intent: Extract<LifecycleIntent, { type: "CLOSE_JOB" }>,
  actor: TransitionActor
): LifecycleTransitionResult {
  // Validate current status is closeable
  if (!canClose(currentStatus)) {
    throw new LifecycleTransitionError(
      "INVALID_STATE",
      `Cannot close job in status '${currentStatus}'. Job must be 'open' to close.`
    );
  }

  const auditEvents: LifecycleAuditEvent[] = [];
  let patch: Partial<Job> = {};
  let finalStatus: JobStatus;

  // Clear scheduling fields and openSubStatus for terminal transition
  const schedulePatch = getScheduleClearingPatch();
  const openSubStatusPatch = getOpenSubStatusClearingPatch();

  switch (intent.mode) {
    case "archive":
      // Path: open -> completed -> archived (fast path to archive)
      finalStatus = "archived";
      patch = {
        ...schedulePatch,
        ...openSubStatusPatch,
        status: "archived",
        previousStatus: currentStatus,
        closedAt: new Date(),
        closedBy: actor.userId,
        // Part E: PM billing status on archive — exception if per-visit skipped invoice
        ...(job.pmBillingDisposition === "invoice_on_completion"
          ? { pmBillingStatus: "billing_exception" }
          : job.pmBillingDisposition
            ? { pmBillingStatus: "no_invoice_expected" }
            : {}),
      };

      auditEvents.push({
        fromStatus: currentStatus,
        toStatus: "archived",
        action: "close_and_archive",
        meta: { mode: "archive" },
      });
      break;

    case "invoice_later":
      // Path: open -> completed (requires invoicing)
      finalStatus = "completed";
      patch = {
        ...schedulePatch,
        ...openSubStatusPatch,
        status: "completed",
        previousStatus: currentStatus,
        closedAt: new Date(),
        closedBy: actor.userId,
      };

      auditEvents.push({
        fromStatus: currentStatus,
        toStatus: "completed",
        action: "close",
        meta: { mode: "invoice_later" },
      });
      break;

    case "invoice_now":
      // Path: open -> invoiced (with invoice)
      if (!intent.invoiceId) {
        throw new LifecycleTransitionError(
          "MISSING_INVOICE",
          "invoice_now mode requires invoiceId to be provided"
        );
      }
      finalStatus = "invoiced";
      // 2026-03-18: Harmonized terminal metadata with MARK_INVOICED —
      // previousStatus, closedAt, closedBy were missing (accidental omission).
      // These are required for undo-close window and audit trail consistency.
      patch = {
        ...schedulePatch,
        ...openSubStatusPatch,
        status: "invoiced",
        previousStatus: currentStatus,
        closedAt: new Date(),
        closedBy: actor.userId,
        invoiceId: intent.invoiceId,
        // Part E: Update PM billing status when invoicing a PM job
        ...(job.pmBillingDisposition ? { pmBillingStatus: "invoiced" } : {}),
      };

      auditEvents.push({
        fromStatus: currentStatus,
        toStatus: "invoiced",
        action: "close_and_invoice",
        meta: { mode: "invoice_now", invoiceId: intent.invoiceId },
      });
      break;

    default:
      throw new LifecycleTransitionError(
        "INVALID_MODE",
        `Unknown close mode: ${(intent as any).mode}`
      );
  }

  return { patch, auditEvents, finalStatus };
}

// ============================================================================
// Cancel Transition
// ============================================================================

function applyCancelTransition(
  job: Job,
  currentStatus: JobStatus,
  intent: Extract<LifecycleIntent, { type: "CANCEL_JOB" }>,
  actor: TransitionActor
): LifecycleTransitionResult {
  // Cannot cancel already terminal jobs
  if (isTerminalStatus(currentStatus)) {
    throw new LifecycleTransitionError(
      "ALREADY_TERMINAL",
      `Cannot cancel job in terminal status '${currentStatus}'`
    );
  }

  // Validate transition is allowed
  if (!isValidTransition(currentStatus, "archived")) {
    throw new LifecycleTransitionError(
      "INVALID_TRANSITION",
      `Cannot cancel job from status '${currentStatus}'`
    );
  }

  const schedulePatch = getScheduleClearingPatch();
  const openSubStatusPatch = getOpenSubStatusClearingPatch();

  const patch: Partial<Job> = {
    ...schedulePatch,
    ...openSubStatusPatch,
    status: "archived", // Canceled jobs go to archived
  };

  const auditEvents: LifecycleAuditEvent[] = [{
    fromStatus: currentStatus,
    toStatus: "archived",
    action: "cancel",
    note: intent.reason,
    meta: intent.reason ? { reason: intent.reason, canceledAt: new Date().toISOString() } : { canceledAt: new Date().toISOString() },
  }];

  return { patch, auditEvents, finalStatus: "archived" };
}

// ============================================================================
// Archive Transition
// ============================================================================

function applyArchiveTransition(
  job: Job,
  currentStatus: JobStatus,
  actor: TransitionActor
): LifecycleTransitionResult {
  // Can archive from completed (not from open - use close first)
  if (currentStatus !== "completed") {
    throw new LifecycleTransitionError(
      "INVALID_STATE",
      `Cannot archive job in status '${currentStatus}'. Must be 'completed' first.`
    );
  }

  const patch: Partial<Job> = {
    status: "archived",
  };

  const auditEvents: LifecycleAuditEvent[] = [{
    fromStatus: currentStatus,
    toStatus: "archived",
    action: "archive",
  }];

  return { patch, auditEvents, finalStatus: "archived" };
}

// ============================================================================
// Reopen Transition
// ============================================================================

function applyReopenTransition(
  job: Job,
  currentStatus: JobStatus,
  intent: Extract<LifecycleIntent, { type: "REOPEN_JOB" }>,
  actor: TransitionActor
): LifecycleTransitionResult {
  // Cannot reopen invoiced jobs (must void/credit invoice first)
  if (currentStatus === "invoiced") {
    throw new LifecycleTransitionError(
      "INVOICED_JOB",
      "Cannot reopen invoiced job. Void or credit the invoice first."
    );
  }

  // Must be in a reopenable state
  const reopenableFrom: JobStatus[] = ["completed", "archived"];
  if (!reopenableFrom.includes(currentStatus)) {
    throw new LifecycleTransitionError(
      "INVALID_STATE",
      `Cannot reopen job in status '${currentStatus}'. Must be 'completed' or 'archived'.`
    );
  }

  // Target status is always 'open' (the only active lifecycle status)
  const targetStatus: JobStatus = "open";
  const targetOpenSubStatus = intent.targetOpenSubStatus ?? null;

  const patch: Partial<Job> = {
    status: targetStatus,
    openSubStatus: targetOpenSubStatus,
    // Clear close metadata
    closedAt: null,
    closedBy: null,
    previousStatus: null,
  };

  const auditEvents: LifecycleAuditEvent[] = [{
    fromStatus: currentStatus,
    toStatus: targetStatus,
    action: "reopen",
    meta: { targetOpenSubStatus },
  }];

  return { patch, auditEvents, finalStatus: targetStatus };
}

// ============================================================================
// Undo Close Transition
// ============================================================================

function applyUndoCloseTransition(
  job: Job,
  currentStatus: JobStatus,
  actor: TransitionActor
): LifecycleTransitionResult {
  // Check undo window
  if (!job.closedAt) {
    throw new LifecycleTransitionError(
      "NO_CLOSE_DATA",
      "Job was not closed with undo capability"
    );
  }

  const closedAt = new Date(job.closedAt).getTime();
  const now = Date.now();

  if (now - closedAt > UNDO_WINDOW_MS) {
    throw new LifecycleTransitionError(
      "UNDO_WINDOW_EXPIRED",
      `Undo window expired. Job was closed ${Math.round((now - closedAt) / 1000)}s ago (max: ${UNDO_WINDOW_MS / 1000}s)`
    );
  }

  // Cannot undo if invoiced
  if (currentStatus === "invoiced" || job.invoiceId) {
    throw new LifecycleTransitionError(
      "INVOICED_JOB",
      "Cannot undo close for invoiced job"
    );
  }

  // Must have previousStatus to restore
  if (!job.previousStatus) {
    throw new LifecycleTransitionError(
      "NO_PREVIOUS_STATUS",
      "No previous status to restore"
    );
  }

  // Restore to 'open' (normalize any legacy previousStatus)
  const targetStatus: JobStatus = "open";

  const patch: Partial<Job> = {
    status: targetStatus,
    closedAt: null,
    closedBy: null,
    previousStatus: null,
  };

  const auditEvents: LifecycleAuditEvent[] = [{
    fromStatus: currentStatus,
    toStatus: targetStatus,
    action: "undo_close",
    meta: { restoredFrom: currentStatus },
  }];

  return { patch, auditEvents, finalStatus: targetStatus };
}

// ============================================================================
// Mark Invoiced Transition
// ============================================================================

/**
 * Mark a job as invoiced — standalone canonical lifecycle transition.
 *
 * Unlike CLOSE_JOB mode=invoice_now (which bundles invoice creation + close),
 * this intent transitions a job to "invoiced" status AFTER an invoice has
 * already been created and linked separately.
 *
 * Allowed source states: open, completed
 * Idempotent: returns no-op if already invoiced
 * Forbidden: archived (must reopen first)
 * Requires: invoiceId
 */
function applyMarkInvoicedTransition(
  job: Job,
  currentStatus: JobStatus,
  intent: Extract<LifecycleIntent, { type: "MARK_INVOICED" }>,
  actor: TransitionActor
): LifecycleTransitionResult {
  // Idempotent: already invoiced → no-op
  if (currentStatus === "invoiced") {
    return {
      patch: {},
      auditEvents: [],
      finalStatus: "invoiced",
    };
  }

  // Forbidden: archived jobs cannot be invoiced directly
  if (currentStatus === "archived") {
    throw new LifecycleTransitionError(
      "INVALID_STATE",
      `Cannot mark archived job as invoiced. Reopen the job first.`
    );
  }

  // Allowed: open or completed → invoiced
  if (currentStatus !== "open" && currentStatus !== "completed") {
    throw new LifecycleTransitionError(
      "INVALID_STATE",
      `Cannot mark job as invoiced from status '${currentStatus}'.`
    );
  }

  const schedulePatch = getScheduleClearingPatch();
  const openSubStatusPatch = getOpenSubStatusClearingPatch();

  const patch: Partial<Job> = {
    ...schedulePatch,
    ...openSubStatusPatch,
    status: "invoiced",
    invoiceId: intent.invoiceId,
    previousStatus: currentStatus,
    closedAt: new Date(),
    closedBy: actor.userId,
    ...(job.pmBillingDisposition ? { pmBillingStatus: "invoiced" } : {}),
  };

  const auditEvents: LifecycleAuditEvent[] = [{
    fromStatus: currentStatus,
    toStatus: "invoiced",
    action: "mark_invoiced",
    meta: { invoiceId: intent.invoiceId },
  }];

  return { patch, auditEvents, finalStatus: "invoiced" };
}

// ============================================================================
// Sanity Check Utilities
// ============================================================================

/**
 * Check if a job violates lifecycle invariants.
 * Used by sanity check scripts.
 */
export interface LifecycleViolation {
  jobId: string;
  violation: string;
  currentState: {
    status: string;
    openSubStatus: string | null;
    scheduledStart: Date | null;
    scheduledEnd: Date | null;
    isAllDay: boolean;
  };
}

/**
 * Detect lifecycle violations for a job
 */
export function detectLifecycleViolations(job: Job): LifecycleViolation[] {
  const violations: LifecycleViolation[] = [];
  const status = job.status as JobStatus;

  // Terminal jobs should not have scheduling fields
  if (isTerminalStatus(status) && hasScheduleFields(job)) {
    violations.push({
      jobId: job.id,
      violation: `Terminal job (status=${status}) has scheduling fields`,
      currentState: {
        status: job.status,
        openSubStatus: job.openSubStatus ?? null,
        scheduledStart: job.scheduledStart,
        scheduledEnd: job.scheduledEnd,
        isAllDay: job.isAllDay,
      },
    });
  }

  // INVARIANT: openSubStatus must be NULL when status !== 'open'
  if (status !== "open" && job.openSubStatus) {
    violations.push({
      jobId: job.id,
      violation: `Non-open job (status=${status}) has openSubStatus=${job.openSubStatus}`,
      currentState: {
        status: job.status,
        openSubStatus: job.openSubStatus ?? null,
        scheduledStart: job.scheduledStart,
        scheduledEnd: job.scheduledEnd,
        isAllDay: job.isAllDay,
      },
    });
  }

  return violations;
}

/**
 * Get repair patch for lifecycle violations
 */
export function getLifecycleRepairPatch(job: Job): Partial<Job> | null {
  const status = job.status as JobStatus;
  let patch: Partial<Job> = {};
  let needsRepair = false;

  // Terminal jobs should not have scheduling fields
  if (isTerminalStatus(status) && hasScheduleFields(job)) {
    Object.assign(patch, getScheduleClearingPatch());
    needsRepair = true;
  }

  // Non-open jobs should not have openSubStatus
  if (status !== "open" && job.openSubStatus) {
    Object.assign(patch, getOpenSubStatusClearingPatch());
    needsRepair = true;
  }

  return needsRepair ? patch : null;
}
