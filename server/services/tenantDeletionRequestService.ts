/**
 * tenantDeletionRequestService — orchestrator for the secure 4-phase
 * tenant teardown workflow (2026-05-04).
 *
 * Phases:
 *
 *   1. PREVIEW   — `runPreview()` runs `tenantTeardownService` with
 *                  dryRun=true and computes a deterministic
 *                  `previewHash`. Nothing is persisted at this phase.
 *
 *   2. REQUEST   — `createRequest()` validates that:
 *                    • the supplied previewPayload re-hashes to the
 *                      supplied previewHash AND matches a fresh
 *                      preview re-run (preview must be ≤5 minutes old)
 *                    • typed confirmations match (tenant name + id +
 *                      "DELETE TENANT" phrase)
 *                    • reason is ≥20 chars
 *                    • no other active request exists for the tenant
 *                  On success, persists a `pending` row.
 *
 *   3. APPROVE   — `approveRequest()` validates that:
 *                    • approver != initiator (different actor)
 *                    • request is `pending` AND not expired
 *                    • re-auth verified (the route already verified
 *                      the password before calling this service)
 *                  On success, transitions to `approved` and sets
 *                  `executionScheduledAt = now + EXECUTION_DELAY_MS`.
 *
 *   4. EXECUTE   — `executeRequest()` is called ONLY by the background
 *                  worker. Re-runs the preview, recomputes the hash,
 *                  refuses on mismatch (saves as `failed`), otherwise
 *                  invokes `tenantTeardownService` with confirm=true
 *                  and transitions to `completed`.
 *
 * Cancellation + expiration are first-class transitions handled here
 * too. Every transition routes through the repository's conditional
 * UPDATE so concurrent calls can't both believe they advanced the row.
 */

import {
  teardownTenant,
  type TenantTeardownInput,
  type TenantTeardownResult,
  type TenantInventory,
} from "./tenantTeardownService";
import {
  computePreviewHash,
  hashableInventory,
  type HashableTenantInventory,
} from "./platformTenantTeardownPreviewHash";
import { tenantDeletionRequestsRepository } from "../storage/tenantDeletionRequests";
import type {
  TenantDeletionRequest,
  TenantDeletionRequestStatus,
} from "@shared/schema";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { sendTeardownAlert } from "./platformTenantTeardownAlerts";
import { storage } from "../storage/index";
// 2026-05-04 F1 hardening: worker transitions emit audit rows alongside
// alerts so audit_logs reflects the full lifecycle.
import {
  platformAuditService,
  type AuditAction,
} from "./platformAuditService";

// ─── Tunables ──────────────────────────────────────────────────────────────

/** A preview must be ≤5 minutes old at request time (anti-replay). */
export const PREVIEW_FRESHNESS_MS = 5 * 60 * 1000;
/** Pending requests expire after this window if no one approves. */
export const REQUEST_EXPIRY_MS = 60 * 60 * 1000; // 60 min
/** Minimum delay between approval and execution (intervention window). */
export const EXECUTION_DELAY_MS = 30 * 60 * 1000; // 30 min
/** Reason must be at least this long. */
export const REASON_MIN_LENGTH = 20;
/** Required confirmation phrase. */
export const CONFIRMATION_PHRASE = "DELETE TENANT";
/**
 * 2026-05-04 F2 hardening: a row that has been `status='executing'`
 * longer than this is treated as stuck (the worker died mid-flight) and
 * marked `failed`. The threshold is INTENTIONALLY long — a real teardown
 * with 100k+ R2 objects can run several minutes, so we want to avoid
 * tripping the reaper on a slow but healthy run.
 *
 * SECURITY NOTE: stale rows are NEVER flipped back to `approved`. Re-
 * executing a partially-completed teardown could double-delete (idempotent
 * for the underlying service, but the audit story is muddier). Failed is
 * the safer terminal — the operator can inspect what state the tenant is
 * in and file a fresh request if cleanup needs to continue.
 */
export const STALE_EXECUTING_AFTER_MS = 60 * 60 * 1000; // 60 min

// ─── Errors ────────────────────────────────────────────────────────────────

export class TeardownRequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, opts: { status: number; code: string }) {
    super(message);
    this.status = opts.status;
    this.code = opts.code;
  }
}

const err = (status: number, code: string, message: string) =>
  new TeardownRequestError(message, { status, code });

// ─── Public surface ────────────────────────────────────────────────────────

export interface PreviewActor {
  id: string;
  email: string;
  capabilities: readonly string[];
}

export interface PreviewResult {
  /** Echo of the resolved tenant id (defensive — caller should re-verify). */
  companyId: string;
  /** Snapshot of the company row at preview time. */
  company: {
    id: string;
    name: string;
    email: string | null;
  };
  /** Full inventory the teardown service produced. */
  inventory: TenantInventory;
  /** Hashable projection (sorted/cleaned) used as the hash input. */
  hashable: HashableTenantInventory;
  /** SHA-256 hex of canonical(hashable). */
  previewHash: string;
  /** ISO timestamp the preview was generated. Bound by PREVIEW_FRESHNESS_MS. */
  generatedAt: string;
  /** Provider retention notes carried forward from the teardown service. */
  providerRetentions: TenantTeardownResult["providerRetentions"];
}

export interface CreateRequestInput {
  companyId: string;
  /** Echo of the previewPayload the operator approved. */
  previewPayload: HashableTenantInventory;
  /** Hex SHA-256 the operator submitted. Must match a fresh recompute. */
  previewHash: string;
  /** ISO timestamp the preview was generated client-side. */
  previewGeneratedAt: string;
  /** Required reason, ≥REASON_MIN_LENGTH chars. */
  reason: string;
  /** Typed confirmations — must MATCH the live company state. */
  confirmations: {
    tenantName: string;
    tenantId: string;
    phrase: string;
  };
  initiator: { id: string; email: string };
  ip?: string | null;
  userAgent?: string | null;
}

export interface ApproveRequestInput {
  requestId: string;
  approver: { id: string; email: string };
}

export interface CancelRequestInput {
  requestId: string;
  actor: { id: string; email: string; capabilities: readonly string[] };
}

// ─── Internals ─────────────────────────────────────────────────────────────

async function loadCompanySnapshot(
  companyId: string,
): Promise<{ id: string; name: string; email: string | null } | null> {
  // Use a thin SELECT — we only want the snapshot fields. Going through
  // `storage` keeps this provider-neutral.
  const r = await db.execute(
    sql`SELECT id, name, email FROM companies WHERE id = ${companyId} LIMIT 1`,
  );
  const row = (r.rows as Array<{
    id: string;
    name: string;
    email: string | null;
  }>)[0];
  return row ? { id: row.id, name: row.name, email: row.email } : null;
}

function envSnapshot(): Record<string, unknown> {
  let dbHost = "(unparsed)";
  try {
    if (process.env.DATABASE_URL) {
      dbHost = new URL(process.env.DATABASE_URL).hostname;
    }
  } catch {
    /* ignore */
  }
  return {
    nodeEnv: process.env.NODE_ENV ?? "(unset)",
    dbHost,
    r2Bucket: process.env.R2_BUCKET ?? null,
    serverTime: new Date().toISOString(),
  };
}

/**
 * 2026-05-04 F1 hardening: write a worker-side audit row.
 *
 * Worker actions don't have a human actor — the platform admin id/email
 * fields are filled with the literal `"system"` so the row is machine-
 * identifiable. The originating human (initiator + approver) is captured
 * in `details` so a reader can still attribute the lifecycle to people.
 *
 * Sensitive payloads are NEVER copied:
 *   • `previewPayloadJson` — could contain sample R2 keys / PII / tenant
 *     row data. Stays in `tenant_deletion_requests.preview_payload_json`,
 *     which is the system of record for forensic re-construction.
 *   • `r2DeleteErrors[].key` — bucket key paths can leak tenant content
 *     paths; only the COUNT is recorded.
 *   • `requestUserAgent` — already deliberately stripped from alerts;
 *     same rule applies here.
 *   • Provider tokens / refresh tokens / client secrets — never read in
 *     this layer; impossible to leak.
 *
 * The write is fire-and-forget — never blocks or fails the worker
 * decision. Failures are logged loudly so ops sees the gap.
 */
async function writeWorkerAudit(
  action: AuditAction,
  request: TenantDeletionRequest,
  extra: Record<string, unknown> = {},
): Promise<void> {
  try {
    await platformAuditService.log({
      platformAdminId: "system",
      platformAdminEmail: "system",
      action,
      targetCompanyId: request.companyId,
      details: {
        requestId: request.id,
        companyId: request.companyId,
        companyNameSnapshot: request.companyNameSnapshot,
        previewHash: request.previewHash,
        initiatedByEmail: request.initiatedByEmail,
        approvedByEmail: request.approvedByEmail ?? null,
        environment: envSnapshot(),
        ...extra,
      },
    });
  } catch (err) {
    console.error(`[teardown-audit] write failed for ${action}:`, err);
  }
}

// ─── Phase 1: PREVIEW ──────────────────────────────────────────────────────

export async function runPreview(input: {
  companyId: string;
}): Promise<PreviewResult> {
  const company = await loadCompanySnapshot(input.companyId);
  if (!company) {
    throw err(404, "COMPANY_NOT_FOUND", "Company not found");
  }
  const dryRunInput: TenantTeardownInput = {
    companyId: input.companyId,
    dryRun: true,
  };
  const result = await teardownTenant(dryRunInput);
  const hashable = hashableInventory(result.inventory);
  const previewHash = computePreviewHash(hashable);
  return {
    companyId: input.companyId,
    company,
    inventory: result.inventory,
    hashable,
    previewHash,
    generatedAt: new Date().toISOString(),
    providerRetentions: result.providerRetentions,
  };
}

// ─── Phase 2: REQUEST ──────────────────────────────────────────────────────

export async function createRequest(
  input: CreateRequestInput,
): Promise<TenantDeletionRequest> {
  // Reason length.
  const reason = (input.reason ?? "").trim();
  if (reason.length < REASON_MIN_LENGTH) {
    throw err(
      400,
      "REASON_TOO_SHORT",
      `Reason must be at least ${REASON_MIN_LENGTH} characters`,
    );
  }

  // Confirmation phrase.
  if (input.confirmations.phrase !== CONFIRMATION_PHRASE) {
    throw err(
      400,
      "INVALID_CONFIRMATION_PHRASE",
      `Type "${CONFIRMATION_PHRASE}" exactly to confirm.`,
    );
  }

  // Tenant id confirmation must match the URL param.
  if (input.confirmations.tenantId !== input.companyId) {
    throw err(
      400,
      "INVALID_TENANT_ID_CONFIRMATION",
      "Typed tenant id does not match.",
    );
  }

  // Preview age check (anti-replay).
  const generatedAt = Date.parse(input.previewGeneratedAt);
  if (!Number.isFinite(generatedAt)) {
    throw err(400, "INVALID_PREVIEW_TIMESTAMP", "Preview timestamp is invalid.");
  }
  const ageMs = Date.now() - generatedAt;
  if (ageMs < 0 || ageMs > PREVIEW_FRESHNESS_MS) {
    throw err(
      400,
      "PREVIEW_STALE",
      `Preview is older than ${PREVIEW_FRESHNESS_MS / 60000} minutes — refresh and try again.`,
    );
  }

  // Recompute the hash on the canonical projection of what the
  // operator supplied — this rejects payload tampering even if the
  // hash was forwarded faithfully.
  const recomputed = computePreviewHash(input.previewPayload);
  if (recomputed !== input.previewHash) {
    throw err(400, "PREVIEW_HASH_MISMATCH", "Preview hash does not match payload.");
  }

  // Run a FRESH preview right now and compare. Catches two attacks:
  //   • replayed payload from earlier (state has since changed)
  //   • tampered payload that happens to canonicalize to the same hash
  //     (cryptographically impossible but defended in depth)
  const live = await runPreview({ companyId: input.companyId });
  if (live.previewHash !== input.previewHash) {
    throw err(
      400,
      "PREVIEW_DRIFT",
      "Tenant state changed since preview — refresh and confirm.",
    );
  }

  // Tenant-name confirmation against the live snapshot.
  if (input.confirmations.tenantName.trim() !== live.company.name) {
    throw err(
      400,
      "INVALID_TENANT_NAME_CONFIRMATION",
      "Typed tenant name does not match.",
    );
  }

  // Active-request rate limit (DB partial-unique index is the safety net,
  // but bouncing here gives a clean 409 rather than a 23505).
  const existing =
    await tenantDeletionRequestsRepository.getActiveForCompany(input.companyId);
  if (existing) {
    throw err(
      409,
      "ACTIVE_REQUEST_EXISTS",
      `An active deletion request already exists for this tenant (id=${existing.id}, status=${existing.status}).`,
    );
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + REQUEST_EXPIRY_MS);

  const created = await tenantDeletionRequestsRepository.createPending({
    companyId: input.companyId,
    companyNameSnapshot: live.company.name,
    companyEmailSnapshot: live.company.email,
    previewHash: input.previewHash,
    previewPayloadJson: input.previewPayload,
    initiatedByUserId: input.initiator.id,
    initiatedByEmail: input.initiator.email,
    reason,
    expiresAt,
    environmentSnapshot: envSnapshot(),
    requestIp: input.ip ?? null,
    requestUserAgent: input.userAgent ?? null,
    status: "pending",
  });

  void sendTeardownAlert({
    event: "request_created",
    requestId: created.id,
    companyId: created.companyId,
    companyName: created.companyNameSnapshot,
    initiatedByEmail: created.initiatedByEmail,
    reason: created.reason,
    previewHash: created.previewHash,
    occurredAt: created.createdAt.toISOString(),
  });

  return created;
}

// ─── Phase 3: APPROVE ──────────────────────────────────────────────────────

export async function approveRequest(
  input: ApproveRequestInput,
): Promise<TenantDeletionRequest> {
  const existing = await tenantDeletionRequestsRepository.getById(
    input.requestId,
  );
  if (!existing) {
    throw err(404, "REQUEST_NOT_FOUND", "Deletion request not found.");
  }
  if (existing.status !== "pending") {
    throw err(
      409,
      "REQUEST_NOT_PENDING",
      `Cannot approve a request in status "${existing.status}".`,
    );
  }
  if (new Date(existing.expiresAt).getTime() <= Date.now()) {
    throw err(
      409,
      "REQUEST_EXPIRED",
      "Request has expired and cannot be approved.",
    );
  }
  if (existing.initiatedByUserId === input.approver.id) {
    throw err(
      403,
      "SELF_APPROVAL_FORBIDDEN",
      "Approver must be a different user than the initiator.",
    );
  }

  const executionScheduledAt = new Date(Date.now() + EXECUTION_DELAY_MS);
  const updated = await tenantDeletionRequestsRepository.transitionToApproved(
    input.requestId,
    {
      approvedByUserId: input.approver.id,
      approvedByEmail: input.approver.email,
      executionScheduledAt,
    },
  );
  if (!updated) {
    // Lost-update race — another caller transitioned the row first.
    throw err(
      409,
      "REQUEST_NOT_PENDING",
      "Request status changed; refresh and retry.",
    );
  }

  void sendTeardownAlert({
    event: "approved",
    requestId: updated.id,
    companyId: updated.companyId,
    companyName: updated.companyNameSnapshot,
    initiatedByEmail: updated.initiatedByEmail,
    approvedByEmail: updated.approvedByEmail,
    reason: updated.reason,
    previewHash: updated.previewHash,
    occurredAt: (updated.approvedAt ?? new Date()).toISOString(),
    executionScheduledAt: executionScheduledAt.toISOString(),
  });

  return updated;
}

// ─── Phase 4: EXECUTE (worker only) ────────────────────────────────────────

export async function executeRequest(
  requestId: string,
): Promise<{
  request: TenantDeletionRequest;
  result: TenantTeardownResult | null;
  outcome: "completed" | "failed";
  failureReason: string | null;
}> {
  const initial = await tenantDeletionRequestsRepository.getById(requestId);
  if (!initial) {
    throw err(404, "REQUEST_NOT_FOUND", "Request not found");
  }
  if (initial.status !== "approved") {
    throw err(
      409,
      "REQUEST_NOT_APPROVED",
      `Cannot execute a request in status "${initial.status}".`,
    );
  }
  if (
    !initial.executionScheduledAt ||
    new Date(initial.executionScheduledAt).getTime() > Date.now()
  ) {
    throw err(
      409,
      "EXECUTION_NOT_DUE",
      "Execution window has not opened yet.",
    );
  }

  // Atomic transition to executing — guards against two workers picking
  // up the same row in parallel.
  const claimed =
    await tenantDeletionRequestsRepository.transitionToExecuting(requestId);
  if (!claimed) {
    throw err(
      409,
      "REQUEST_NOT_APPROVED",
      "Another worker may have claimed this request.",
    );
  }

  void sendTeardownAlert({
    event: "execution_started",
    requestId: claimed.id,
    companyId: claimed.companyId,
    companyName: claimed.companyNameSnapshot,
    initiatedByEmail: claimed.initiatedByEmail,
    approvedByEmail: claimed.approvedByEmail,
    reason: claimed.reason,
    previewHash: claimed.previewHash,
    occurredAt: new Date().toISOString(),
    r2Prefix: `tenants/${claimed.companyId}/`,
  });
  // 2026-05-04 F1 hardening — audit row paired with the alert.
  void writeWorkerAudit("platform_tenant_teardown_execute_started", claimed, {
    transition: "approved → executing",
    executionScheduledAt: claimed.executionScheduledAt?.toISOString() ?? null,
    executionStartedAt:
      claimed.executionStartedAt?.toISOString() ?? new Date().toISOString(),
  });

  // Re-run the preview and recompute the hash. Drift = abort.
  let livePreview: PreviewResult;
  try {
    livePreview = await runPreview({ companyId: claimed.companyId });
  } catch (e: unknown) {
    return await failExecution(
      claimed,
      `Preview failed pre-execution: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (livePreview.previewHash !== claimed.previewHash) {
    return await failExecution(
      claimed,
      `Preview hash drift detected — refusing to delete (snapshot=${claimed.previewHash} live=${livePreview.previewHash}).`,
    );
  }

  // Hash matched — invoke the teardown service.
  let result: TenantTeardownResult;
  try {
    result = await teardownTenant({
      companyId: claimed.companyId,
      reason: claimed.reason,
      actor: `tenant-deletion-request:${claimed.id}`,
      dryRun: false,
    });
  } catch (e: unknown) {
    return await failExecution(
      claimed,
      `Teardown service threw: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (result.verification && result.verification.fkTablesWithRows.length > 0) {
    return await failExecution(
      claimed,
      `Tenant-scoped DB rows still present post-delete: ${JSON.stringify(
        result.verification.fkTablesWithRows,
      )}`,
    );
  }

  const completed =
    await tenantDeletionRequestsRepository.transitionToCompleted(requestId);

  void sendTeardownAlert({
    event: "execution_completed",
    requestId,
    companyId: claimed.companyId,
    companyName: claimed.companyNameSnapshot,
    initiatedByEmail: claimed.initiatedByEmail,
    approvedByEmail: claimed.approvedByEmail,
    reason: claimed.reason,
    previewHash: claimed.previewHash,
    occurredAt: new Date().toISOString(),
    r2Prefix: result.inventory.r2.prefix,
  });
  // 2026-05-04 F1 hardening — execution-completed audit row.
  // Summary carries COUNTS only (no R2 keys, no error messages with
  // tenant paths, no provider tokens). The system of record for the
  // full result lives in worker logs + the `tenant_deletion_requests`
  // row itself.
  void writeWorkerAudit(
    "platform_tenant_teardown_executed",
    completed ?? claimed,
    {
      transition: "executing → completed",
      executedAt: (completed?.executedAt ?? new Date()).toISOString(),
      summary: {
        r2DeletedObjects: result.executed.r2DeletedObjects,
        r2DeletedBytes: result.executed.r2DeletedBytes,
        r2DeleteErrorCount: result.executed.r2DeleteErrors.length,
        qboRevokeAttempted: result.executed.qboRevokeAttempted,
        qboRevokeSuccess: result.executed.qboRevokeSuccess,
        sessionsDeleted: result.executed.sessionsDeleted,
        dbCascadeRowsApprox: result.executed.dbCascadeRowsApprox,
        verification: result.verification
          ? {
              companiesRemaining: result.verification.companiesRemaining,
              userIdsRemaining: result.verification.userIdsRemaining,
              fkTablesWithRowsCount: result.verification.fkTablesWithRows.length,
              r2ObjectsRemaining: result.verification.r2ObjectsRemaining,
            }
          : null,
      },
    },
  );

  return {
    request: completed ?? claimed,
    result,
    outcome: "completed",
    failureReason: null,
  };
}

async function failExecution(
  claimed: TenantDeletionRequest,
  reason: string,
): Promise<{
  request: TenantDeletionRequest;
  result: null;
  outcome: "failed";
  failureReason: string;
}> {
  const failed = await tenantDeletionRequestsRepository.transitionToFailed(
    claimed.id,
    reason,
  );
  void sendTeardownAlert({
    event: "execution_failed",
    requestId: claimed.id,
    companyId: claimed.companyId,
    companyName: claimed.companyNameSnapshot,
    initiatedByEmail: claimed.initiatedByEmail,
    approvedByEmail: claimed.approvedByEmail,
    reason: claimed.reason,
    previewHash: claimed.previewHash,
    occurredAt: new Date().toISOString(),
    failureReason: reason,
  });
  // 2026-05-04 F1 hardening — execution-failed audit row.
  void writeWorkerAudit(
    "platform_tenant_teardown_execute_failed",
    failed ?? claimed,
    {
      transition: `${claimed.status} → failed`,
      failureReason: reason,
      failedAt: new Date().toISOString(),
    },
  );
  return {
    request: failed ?? claimed,
    result: null,
    outcome: "failed",
    failureReason: reason,
  };
}

// ─── Cancellation ──────────────────────────────────────────────────────────

const SUPER_ADMIN_CAP = "platform:tenant_teardown_approve";

export async function cancelRequest(
  input: CancelRequestInput,
): Promise<TenantDeletionRequest> {
  const existing = await tenantDeletionRequestsRepository.getById(
    input.requestId,
  );
  if (!existing) {
    throw err(404, "REQUEST_NOT_FOUND", "Deletion request not found.");
  }
  if (existing.status === "executing") {
    throw err(
      409,
      "EXECUTING_NOT_CANCELLABLE",
      "Cannot cancel a request that is already executing.",
    );
  }
  if (existing.status !== "pending" && existing.status !== "approved") {
    throw err(
      409,
      "TERMINAL_NOT_CANCELLABLE",
      `Cannot cancel a request in status "${existing.status}".`,
    );
  }
  // Allowed by:
  //   • the initiator
  //   • any user with the approve capability (super admin)
  const isInitiator = existing.initiatedByUserId === input.actor.id;
  const isSuperAdmin = input.actor.capabilities.includes(SUPER_ADMIN_CAP);
  if (!isInitiator && !isSuperAdmin) {
    throw err(
      403,
      "CANCEL_NOT_PERMITTED",
      "Only the initiator or a super admin can cancel this request.",
    );
  }

  const cancelled =
    await tenantDeletionRequestsRepository.transitionToCancelled(
      input.requestId,
      {
        cancelledByUserId: input.actor.id,
        cancelledByEmail: input.actor.email,
      },
    );
  if (!cancelled) {
    throw err(
      409,
      "REQUEST_RACE",
      "Request status changed; refresh and retry.",
    );
  }

  void sendTeardownAlert({
    event: "cancelled",
    requestId: cancelled.id,
    companyId: cancelled.companyId,
    companyName: cancelled.companyNameSnapshot,
    initiatedByEmail: cancelled.initiatedByEmail,
    approvedByEmail: cancelled.approvedByEmail,
    reason: cancelled.reason,
    previewHash: cancelled.previewHash,
    occurredAt: (cancelled.cancelledAt ?? new Date()).toISOString(),
  });
  return cancelled;
}

// ─── Expiration (worker) ───────────────────────────────────────────────────

export async function expireOnePending(
  request: TenantDeletionRequest,
): Promise<TenantDeletionRequest | null> {
  const expired = await tenantDeletionRequestsRepository.transitionToExpired(
    request.id,
  );
  if (!expired) return null;
  void sendTeardownAlert({
    event: "expired",
    requestId: expired.id,
    companyId: expired.companyId,
    companyName: expired.companyNameSnapshot,
    initiatedByEmail: expired.initiatedByEmail,
    reason: expired.reason,
    previewHash: expired.previewHash,
    occurredAt: new Date().toISOString(),
  });
  // 2026-05-04 F1 hardening — expired audit row.
  void writeWorkerAudit("platform_tenant_teardown_expired", expired, {
    transition: "pending → expired",
    expiredAt: new Date().toISOString(),
    originalExpiresAt: expired.expiresAt.toISOString(),
  });
  return expired;
}

// ─── Stale-executing reaper (F2) ───────────────────────────────────────────

/**
 * 2026-05-04 F2 hardening: mark a stuck `executing` row as `failed`.
 *
 * "Stuck" means the row entered executing more than STALE_EXECUTING_AFTER_MS
 * ago and the worker that claimed it never wrote `completed` or `failed`.
 * This happens when the worker process is killed (SIGKILL, crash, OOM)
 * between the `transitionToExecuting` write and the cascade commit.
 *
 * Failure mode chosen:
 *   • Mark `failed` with a distinctive reason — operator-readable.
 *   • DO NOT flip back to `approved`. Re-execution could double-delete
 *     R2 objects / DB rows. The underlying `tenantTeardownService` is
 *     idempotent enough to survive that, but the audit story would be
 *     muddier and a row could appear to have two execution attempts.
 *   • DO NOT auto-retry. If cleanup is incomplete, the operator files
 *     a fresh request after inspecting tenant state.
 *
 * The transition uses `transitionToFailed`'s conditional UPDATE
 * (`WHERE status IN ('executing','approved')`) so a worker that DID
 * eventually finish the cascade and is about to write `completed` will
 * race-win against the reaper — the reaper's UPDATE returns null and
 * we silently skip. Either way the row reaches a terminal state exactly
 * once.
 */
export const STALE_FAILURE_REASON =
  "Execution marked failed after stale executing timeout";

export async function reapStaleExecuting(
  request: TenantDeletionRequest,
): Promise<TenantDeletionRequest | null> {
  const failed = await tenantDeletionRequestsRepository.transitionToFailed(
    request.id,
    STALE_FAILURE_REASON,
  );
  if (!failed) {
    // Race: row finished or was already terminal before our UPDATE
    // landed. Nothing to alert / audit.
    return null;
  }
  void sendTeardownAlert({
    event: "execution_failed",
    requestId: failed.id,
    companyId: failed.companyId,
    companyName: failed.companyNameSnapshot,
    initiatedByEmail: failed.initiatedByEmail,
    approvedByEmail: failed.approvedByEmail,
    reason: failed.reason,
    previewHash: failed.previewHash,
    occurredAt: new Date().toISOString(),
    failureReason: STALE_FAILURE_REASON,
  });
  // Audit row — distinctive `staleTimeoutMs` field so a reader can tell
  // a stale-reaper failure apart from a teardown-throw failure.
  void writeWorkerAudit(
    "platform_tenant_teardown_execute_failed",
    failed,
    {
      transition: "executing → failed",
      failureReason: STALE_FAILURE_REASON,
      stale: true,
      staleTimeoutMs: STALE_EXECUTING_AFTER_MS,
      executionStartedAt: request.executionStartedAt?.toISOString() ?? null,
      reapedAt: new Date().toISOString(),
    },
  );
  return failed;
}

// ─── Helpers exposed for routes ────────────────────────────────────────────

export async function listRequestsForCompany(
  companyId: string,
): Promise<TenantDeletionRequest[]> {
  return tenantDeletionRequestsRepository.listByCompany(companyId);
}

export async function getRequest(
  requestId: string,
): Promise<TenantDeletionRequest | null> {
  return tenantDeletionRequestsRepository.getById(requestId);
}

// Keep storage import warm so the bundler doesn't drop it.
void storage;

export const __test__ = {
  PREVIEW_FRESHNESS_MS,
  REQUEST_EXPIRY_MS,
  EXECUTION_DELAY_MS,
  REASON_MIN_LENGTH,
  CONFIRMATION_PHRASE,
  STALE_EXECUTING_AFTER_MS,
  STALE_FAILURE_REASON,
};
