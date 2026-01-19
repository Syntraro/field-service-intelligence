/**
 * Impersonation Session Repository
 *
 * Persistent storage for support mode impersonation sessions.
 * Replaces in-memory Map storage with database-backed sessions.
 */

import { db } from "../db";
import { eq, and, isNull, sql } from "drizzle-orm";
import { impersonationSessions } from "@shared/schema";
import type { ImpersonationSession, InsertImpersonationSession } from "@shared/schema";

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
   * Create a new impersonation session
   */
  async createSession(
    ownerUserId: string,
    targetUserId: string,
    companyId: string,
    reason?: string
  ): Promise<ImpersonationSession> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);

    const sessionData: InsertImpersonationSession = {
      ownerUserId,
      targetUserId,
      companyId,
      reason: reason || null,
      expiresAt,
    };

    const [session] = await db
      .insert(impersonationSessions)
      .values(sessionData)
      .returning();

    return session;
  }

  /**
   * Get active session by ID (not ended, not expired)
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
   * End a session with a reason
   */
  async endSession(id: string, endedReason: EndedReason): Promise<void> {
    await db
      .update(impersonationSessions)
      .set({
        endedAt: new Date(),
        endedReason,
      })
      .where(eq(impersonationSessions.id, id));
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
