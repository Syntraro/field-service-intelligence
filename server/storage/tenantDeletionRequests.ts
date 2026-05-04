/**
 * Tenant deletion requests — data layer (2026-05-04).
 *
 * Pure data access for the `tenant_deletion_requests` table. The state
 * machine + business rules live in `tenantDeletionRequestService`; this
 * module only persists / reads / atomically transitions rows.
 *
 * Concurrency note: every state transition method goes through a single
 * conditional UPDATE with a status predicate (e.g.
 * `WHERE id = $1 AND status = 'pending'`) so two concurrent callers
 * cannot both believe they transitioned the same row. The service
 * inspects `rowCount` to detect lost-update races.
 */
import { db } from "../db";
import { and, eq, lt, sql, inArray } from "drizzle-orm";
import { tenantDeletionRequests } from "@shared/schema";
import type {
  InsertTenantDeletionRequest,
  TenantDeletionRequest,
  TenantDeletionRequestStatus,
} from "@shared/schema";

const ACTIVE_STATUSES: TenantDeletionRequestStatus[] = [
  "pending",
  "approved",
  "executing",
];

class TenantDeletionRequestsRepository {
  /** Insert a fresh `pending` request. The unique partial index on
   *  (company_id) WHERE status IN active enforces "at most one active
   *  request per tenant" at the DB level — a duplicate raises 23505. */
  async createPending(
    data: InsertTenantDeletionRequest,
  ): Promise<TenantDeletionRequest> {
    const [row] = await db
      .insert(tenantDeletionRequests)
      .values({ ...data, status: "pending" })
      .returning();
    return row;
  }

  async getById(id: string): Promise<TenantDeletionRequest | null> {
    const [row] = await db
      .select()
      .from(tenantDeletionRequests)
      .where(eq(tenantDeletionRequests.id, id))
      .limit(1);
    return row ?? null;
  }

  /** Single active request for a company (if any). Used for rate-limit
   *  precheck on the request route. */
  async getActiveForCompany(
    companyId: string,
  ): Promise<TenantDeletionRequest | null> {
    const [row] = await db
      .select()
      .from(tenantDeletionRequests)
      .where(
        and(
          eq(tenantDeletionRequests.companyId, companyId),
          inArray(tenantDeletionRequests.status, ACTIVE_STATUSES),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** List requests for a company, newest first. Used by the audit /
   *  forensic surface — terminal states never disappear. */
  async listByCompany(companyId: string): Promise<TenantDeletionRequest[]> {
    return await db
      .select()
      .from(tenantDeletionRequests)
      .where(eq(tenantDeletionRequests.companyId, companyId))
      .orderBy(sql`${tenantDeletionRequests.createdAt} DESC`);
  }

  /** Worker hot-path: pending rows whose expiration has passed. */
  async listExpiredPending(now: Date): Promise<TenantDeletionRequest[]> {
    return await db
      .select()
      .from(tenantDeletionRequests)
      .where(
        and(
          eq(tenantDeletionRequests.status, "pending"),
          lt(tenantDeletionRequests.expiresAt, now),
        ),
      );
  }

  /** Worker hot-path: approved rows whose execution window opened. */
  async listReadyToExecute(now: Date): Promise<TenantDeletionRequest[]> {
    return await db
      .select()
      .from(tenantDeletionRequests)
      .where(
        and(
          eq(tenantDeletionRequests.status, "approved"),
          lt(tenantDeletionRequests.executionScheduledAt, now),
        ),
      );
  }

  /**
   * 2026-05-04 F2 hardening: stale-executing reaper hot-path.
   *
   * Rows that have been `status='executing'` longer than STALE_EXECUTING_AFTER_MS
   * are returned. The service marks them `failed` (never `approved` — re-execution
   * could double-delete) so an operator can inspect and decide.
   *
   * `executionStartedAt` is set atomically by `transitionToExecuting`. A row
   * with NULL executionStartedAt + status='executing' would be a Phase 1 row
   * that pre-dates the column; the migration backfills those, but we still
   * exclude NULL with the partial index predicate so the reaper never trips
   * on a row whose anchor is missing.
   */
  async listStaleExecuting(
    cutoff: Date,
  ): Promise<TenantDeletionRequest[]> {
    return await db
      .select()
      .from(tenantDeletionRequests)
      .where(
        and(
          eq(tenantDeletionRequests.status, "executing"),
          lt(tenantDeletionRequests.executionStartedAt, cutoff),
        ),
      );
  }

  // ── Conditional state transitions ────────────────────────────────────────
  // Each method updates the row only if it is in the expected source
  // state. Returns the post-update row, or `null` when the predicate
  // didn't match (i.e. someone else moved the row first). The service
  // treats `null` as "lost update — rerun decision logic".

  async transitionToApproved(
    id: string,
    fields: {
      approvedByUserId: string;
      approvedByEmail: string;
      executionScheduledAt: Date;
    },
  ): Promise<TenantDeletionRequest | null> {
    const [row] = await db
      .update(tenantDeletionRequests)
      .set({
        status: "approved",
        approvedByUserId: fields.approvedByUserId,
        approvedByEmail: fields.approvedByEmail,
        approvedAt: new Date(),
        executionScheduledAt: fields.executionScheduledAt,
      })
      .where(
        and(
          eq(tenantDeletionRequests.id, id),
          eq(tenantDeletionRequests.status, "pending"),
        ),
      )
      .returning();
    return row ?? null;
  }

  async transitionToExecuting(
    id: string,
  ): Promise<TenantDeletionRequest | null> {
    const [row] = await db
      .update(tenantDeletionRequests)
      .set({
        status: "executing",
        // 2026-05-04 F2: set the stale-executing anchor at the same
        // moment status flips. The reaper relies on this timestamp to
        // identify rows whose worker died mid-flight.
        executionStartedAt: new Date(),
      })
      .where(
        and(
          eq(tenantDeletionRequests.id, id),
          eq(tenantDeletionRequests.status, "approved"),
        ),
      )
      .returning();
    return row ?? null;
  }

  async transitionToCompleted(
    id: string,
  ): Promise<TenantDeletionRequest | null> {
    const [row] = await db
      .update(tenantDeletionRequests)
      .set({ status: "completed", executedAt: new Date() })
      .where(
        and(
          eq(tenantDeletionRequests.id, id),
          eq(tenantDeletionRequests.status, "executing"),
        ),
      )
      .returning();
    return row ?? null;
  }

  async transitionToFailed(
    id: string,
    failureReason: string,
  ): Promise<TenantDeletionRequest | null> {
    const [row] = await db
      .update(tenantDeletionRequests)
      .set({ status: "failed", failureReason })
      .where(
        and(
          eq(tenantDeletionRequests.id, id),
          inArray(tenantDeletionRequests.status, ["executing", "approved"]),
        ),
      )
      .returning();
    return row ?? null;
  }

  async transitionToCancelled(
    id: string,
    fields: { cancelledByUserId: string; cancelledByEmail: string },
  ): Promise<TenantDeletionRequest | null> {
    // Cancellation is allowed only from pending or approved — never from
    // executing (the worker is mid-flight) and never from terminal states.
    const [row] = await db
      .update(tenantDeletionRequests)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        cancelledByUserId: fields.cancelledByUserId,
        cancelledByEmail: fields.cancelledByEmail,
      })
      .where(
        and(
          eq(tenantDeletionRequests.id, id),
          inArray(tenantDeletionRequests.status, ["pending", "approved"]),
        ),
      )
      .returning();
    return row ?? null;
  }

  async transitionToExpired(id: string): Promise<TenantDeletionRequest | null> {
    const [row] = await db
      .update(tenantDeletionRequests)
      .set({ status: "expired" })
      .where(
        and(
          eq(tenantDeletionRequests.id, id),
          eq(tenantDeletionRequests.status, "pending"),
        ),
      )
      .returning();
    return row ?? null;
  }
}

export const tenantDeletionRequestsRepository =
  new TenantDeletionRequestsRepository();
