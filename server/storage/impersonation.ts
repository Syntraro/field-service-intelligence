/**
 * Impersonation Session Repository
 *
 * Persistent storage for support mode impersonation sessions.
 * Replaces in-memory Map storage with database-backed sessions.
 */

import { db } from "../db";
import { eq, and, desc, isNull, or, sql, type SQL } from "drizzle-orm";
import { impersonationSessions } from "@shared/schema";
import type { ImpersonationSession, InsertImpersonationSession } from "@shared/schema";

/** Phase 4 — canonical access-mode type for support sessions. */
export type SupportAccessMode = "read_only" | "impersonation";
/** Phase 4 — canonical lifecycle status. */
export type SupportSessionStatus = "pending" | "active" | "expired" | "revoked" | "closed";

// Session duration constants (in milliseconds)
const SESSION_DURATION_MS = 60 * 60 * 1000; // 60 minutes
const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

export type EndedReason = "manual" | "expired" | "idle" | "logout";

export interface ActiveSession extends ImpersonationSession {
  isExpired: boolean;
  isIdle: boolean;
}

class ImpersonationRepository {
  /**
   * Create a new impersonation session (legacy single-mode entry point used
   * by the existing /api/impersonation flow). Always creates access_mode =
   * 'impersonation', status = 'active'.
   */
  async createSession(
    ownerUserId: string,
    targetUserId: string,
    companyId: string,
    reason?: string
  ): Promise<ImpersonationSession> {
    return this.createSupportSession({
      ownerUserId,
      targetUserId,
      companyId,
      reason: reason ?? null,
      accessMode: "impersonation",
      approvedByUserId: null,
      durationMs: SESSION_DURATION_MS,
      initialStatus: "active",
    });
  }

  /**
   * Phase 4 — canonical support-session create. Mode-aware entry point.
   */
  async createSupportSession(opts: {
    ownerUserId: string;
    targetUserId: string | null;
    companyId: string;
    reason: string | null;
    accessMode: SupportAccessMode;
    approvedByUserId: string | null;
    durationMs: number;
    initialStatus: SupportSessionStatus;
  }): Promise<ImpersonationSession> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + opts.durationMs);

    const [session] = await db
      .insert(impersonationSessions)
      .values({
        ownerUserId: opts.ownerUserId,
        targetUserId: opts.targetUserId,
        companyId: opts.companyId,
        reason: opts.reason,
        expiresAt,
        accessMode: opts.accessMode,
        approvedByUserId: opts.approvedByUserId,
        status: opts.initialStatus,
        startedAt: opts.initialStatus === "active" ? now : null,
        requestedDurationMinutes: Math.round(opts.durationMs / 60_000),
      })
      .returning();

    return session;
  }

  /**
   * Phase 7 — sweep stale pending sessions on read. Any `status='pending'`
   * whose `expires_at` has already passed is converted to `status='expired'`
   * so listings (for both the platform dashboard and the tenant approval
   * surface) never show a pending request the customer can still act on
   * when no usable time remains.
   *
   * Fire-and-forget from the caller's perspective — inexpensive (indexed)
   * and idempotent.
   */
  async sweepExpiredPending(): Promise<string[]> {
    const now = new Date();
    const rows = await db
      .update(impersonationSessions)
      .set({ status: "expired", endedAt: now, endedReason: "expired" })
      .where(and(
        eq(impersonationSessions.status, "pending"),
        sql`${impersonationSessions.expiresAt} < ${now}`,
      ))
      .returning({ id: impersonationSessions.id, companyId: impersonationSessions.companyId, ownerUserId: impersonationSessions.ownerUserId });

    // Hotfix (post-Phase-7): emit one audit row per converted record so the
    // transition is discoverable in the existing support_session_expired feed.
    // Dynamic import breaks the circular dep between storage ↔ services.
    if (rows.length > 0) {
      try {
        const { platformAuditService } = await import("../services/platformAuditService");
        await Promise.all(rows.map((r) =>
          platformAuditService.logSupportSessionExpired(
            r.ownerUserId, r.id, r.companyId, "expiry",
          ).catch(() => { /* never block sweep on audit I/O */ })
        ));
      } catch {
        // ignore — audit is best-effort
      }
    }

    return rows.map((r) => r.id);
  }

  /**
   * Get active session by ID (not ended, not expired). "Active" here means
   * the session is not terminated — it may still have status='pending' for
   * the newer read-only workflow. Caller is responsible for status check.
   */
  async getActiveSessionById(id: string): Promise<ActiveSession | null> {
    const [session] = await db
      .select()
      .from(impersonationSessions)
      .where(
        and(
          eq(impersonationSessions.id, id),
          isNull(impersonationSessions.endedAt)
        )
      )
      .limit(1);

    if (!session) {
      return null;
    }

    const now = new Date();
    const isExpired = now > session.expiresAt;
    const isIdle = session.lastSeenAt
      ? now.getTime() - session.lastSeenAt.getTime() > IDLE_TIMEOUT_MS
      : false;

    return {
      ...session,
      isExpired,
      isIdle,
    };
  }

  /**
   * Get active session for an owner (in case they have one)
   */
  async getActiveSessionByOwner(ownerUserId: string): Promise<ActiveSession | null> {
    const [session] = await db
      .select()
      .from(impersonationSessions)
      .where(
        and(
          eq(impersonationSessions.ownerUserId, ownerUserId),
          isNull(impersonationSessions.endedAt)
        )
      )
      .limit(1);

    if (!session) {
      return null;
    }

    const now = new Date();
    const isExpired = now > session.expiresAt;
    const isIdle = session.lastSeenAt
      ? now.getTime() - session.lastSeenAt.getTime() > IDLE_TIMEOUT_MS
      : false;

    return {
      ...session,
      isExpired,
      isIdle,
    };
  }

  /**
   * Update lastSeenAt timestamp (touch session to prevent idle timeout)
   */
  async touchSession(id: string): Promise<void> {
    await db
      .update(impersonationSessions)
      .set({ lastSeenAt: new Date() })
      .where(
        and(
          eq(impersonationSessions.id, id),
          isNull(impersonationSessions.endedAt)
        )
      );
  }

  /**
   * End a session with a reason. Also flips the Phase 4 `status` field so
   * the two stay consistent — the legacy `endedAt`/`endedReason` columns
   * remain the source of truth for existing dashboards.
   */
  async endSession(id: string, endedReason: EndedReason): Promise<void> {
    const now = new Date();
    const newStatus: SupportSessionStatus =
      endedReason === "expired" || endedReason === "idle" ? "expired" : "closed";

    await db
      .update(impersonationSessions)
      .set({
        endedAt: now,
        endedReason,
        status: newStatus,
      })
      .where(eq(impersonationSessions.id, id));
  }

  // ──────────────────────────────────────────────────────────
  // Phase 4 — Support Session lifecycle helpers
  // ──────────────────────────────────────────────────────────

  /**
   * List sessions with optional filters (ops portal). Runs a stale-pending
   * sweep up front so callers never see a pending request that is already
   * past its expiry.
   */
  async listSessions(filter: {
    companyId?: string;
    ownerUserId?: string;
    accessMode?: SupportAccessMode;
    status?: SupportSessionStatus;
    activeOnly?: boolean;
    limit: number;
    offset: number;
  }): Promise<{ rows: ImpersonationSession[]; total: number }> {
    await this.sweepExpiredPending();
    const preds: SQL[] = [];
    if (filter.companyId) preds.push(eq(impersonationSessions.companyId, filter.companyId));
    if (filter.ownerUserId) preds.push(eq(impersonationSessions.ownerUserId, filter.ownerUserId));
    if (filter.accessMode) preds.push(eq(impersonationSessions.accessMode, filter.accessMode));
    if (filter.status) preds.push(eq(impersonationSessions.status, filter.status));
    if (filter.activeOnly) {
      preds.push(or(
        eq(impersonationSessions.status, "active"),
        eq(impersonationSessions.status, "pending"),
      )!);
      preds.push(isNull(impersonationSessions.endedAt));
    }

    const where = preds.length === 0 ? undefined : preds.length === 1 ? preds[0] : and(...preds);

    const rowsQuery = db.select().from(impersonationSessions);
    const totalQuery = db.select({ count: sql<number>`count(*)::int` }).from(impersonationSessions);

    const [rows, totals] = await Promise.all([
      (where ? rowsQuery.where(where) : rowsQuery)
        .orderBy(desc(impersonationSessions.createdAt))
        .limit(filter.limit)
        .offset(filter.offset),
      where ? totalQuery.where(where) : totalQuery,
    ]);

    return { rows, total: totals[0]?.count ?? 0 };
  }

  /** Transition pending → active. */
  async activateSession(id: string): Promise<ImpersonationSession | null> {
    const [row] = await db
      .update(impersonationSessions)
      .set({ status: "active", startedAt: new Date() })
      .where(and(eq(impersonationSessions.id, id), eq(impersonationSessions.status, "pending")))
      .returning();
    return row ?? null;
  }

  /**
   * Phase 6 — tenant approves a pending session. Transitions pending →
   * active, stamps approvedByUserId, and RESETS expiresAt to now +
   * remainingMs so the customer doesn't burn duration while deciding.
   */
  async approvePendingSession(
    id: string,
    approvedByUserId: string,
    freshExpiresAt: Date,
  ): Promise<ImpersonationSession | null> {
    const now = new Date();
    const [row] = await db
      .update(impersonationSessions)
      .set({
        status: "active",
        startedAt: now,
        approvedByUserId,
        expiresAt: freshExpiresAt,
        lastSeenAt: now,
      })
      .where(and(eq(impersonationSessions.id, id), eq(impersonationSessions.status, "pending")))
      .returning();
    return row ?? null;
  }

  /**
   * Phase 6 — tenant denies a pending session. Moves pending → revoked.
   * Not the same as revokeSession (which accepts any non-ended session).
   */
  async denyPendingSession(id: string): Promise<ImpersonationSession | null> {
    const now = new Date();
    const [row] = await db
      .update(impersonationSessions)
      .set({
        status: "revoked",
        revokedAt: now,
        endedAt: now,
        endedReason: "manual",
      })
      .where(and(eq(impersonationSessions.id, id), eq(impersonationSessions.status, "pending")))
      .returning();
    return row ?? null;
  }

  /**
   * List pending + active support sessions for a given tenant (customer
   * surface). Sweeps stale pending rows first so the tenant never sees a
   * ghost request.
   */
  async listForTenant(tenantId: string): Promise<ImpersonationSession[]> {
    await this.sweepExpiredPending();
    return db
      .select()
      .from(impersonationSessions)
      .where(and(
        eq(impersonationSessions.companyId, tenantId),
        isNull(impersonationSessions.endedAt),
      ))
      .orderBy(desc(impersonationSessions.createdAt));
  }

  /** Transition to revoked — immediate and permanent. */
  async revokeSession(id: string): Promise<ImpersonationSession | null> {
    const now = new Date();
    const [row] = await db
      .update(impersonationSessions)
      .set({
        status: "revoked",
        revokedAt: now,
        endedAt: now,
        endedReason: "manual",
      })
      .where(and(eq(impersonationSessions.id, id), isNull(impersonationSessions.endedAt)))
      .returning();
    return row ?? null;
  }

  /** Transition to closed — manual, clean exit. */
  async closeSession(id: string): Promise<ImpersonationSession | null> {
    const now = new Date();
    const [row] = await db
      .update(impersonationSessions)
      .set({
        status: "closed",
        endedAt: now,
        endedReason: "manual",
      })
      .where(and(eq(impersonationSessions.id, id), isNull(impersonationSessions.endedAt)))
      .returning();
    return row ?? null;
  }

  /**
   * End all active sessions for an owner (cleanup on logout)
   */
  async endAllSessionsForOwner(ownerUserId: string, endedReason: EndedReason): Promise<number> {
    const result = await db
      .update(impersonationSessions)
      .set({
        endedAt: new Date(),
        endedReason,
      })
      .where(
        and(
          eq(impersonationSessions.ownerUserId, ownerUserId),
          isNull(impersonationSessions.endedAt)
        )
      )
      .returning({ id: impersonationSessions.id });

    return result.length;
  }

  /**
   * Get session duration in milliseconds
   */
  getSessionDurationMs(): number {
    return SESSION_DURATION_MS;
  }

  /**
   * Get idle timeout in milliseconds
   */
  getIdleTimeoutMs(): number {
    return IDLE_TIMEOUT_MS;
  }

  /**
   * Calculate remaining time before expiry
   */
  getRemainingTime(session: ImpersonationSession): { minutes: number; seconds: number } {
    const now = Date.now();
    const expiresAt = session.expiresAt.getTime();
    const remainingMs = Math.max(0, expiresAt - now);

    return {
      minutes: Math.floor(remainingMs / 60000),
      seconds: Math.floor((remainingMs % 60000) / 1000),
    };
  }

  /**
   * Calculate remaining idle time before timeout
   */
  getIdleTimeRemaining(session: ImpersonationSession): { minutes: number; seconds: number } {
    const now = Date.now();
    const lastSeen = session.lastSeenAt.getTime();
    const idleTime = now - lastSeen;
    const remainingMs = Math.max(0, IDLE_TIMEOUT_MS - idleTime);

    return {
      minutes: Math.floor(remainingMs / 60000),
      seconds: Math.floor((remainingMs % 60000) / 1000),
    };
  }
}

export const impersonationRepository = new ImpersonationRepository();
