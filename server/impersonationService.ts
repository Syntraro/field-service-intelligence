/**
 * Impersonation Service - Database-backed Support Mode
 *
 * Provides secure support mode impersonation with:
 * - Database-backed persistent sessions
 * - HttpOnly cookie for session ID
 * - Automatic expiry and idle timeout enforcement
 * - Full audit logging
 */

import type { Request, Response } from "express";
import { platformAuditService } from "./services/platformAuditService";
import { impersonationRepository, type EndedReason } from "./storage/impersonation";
import type { ImpersonationSession } from "@shared/schema";

// Cookie configuration
const IMPERSONATION_COOKIE_NAME = "imp_session";
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 1000, // 60 minutes (matches session duration)
};

// Re-export session type for backward compatibility
export interface LegacyImpersonationSession {
  sessionId: string;
  platformAdminId: string;
  platformAdminEmail: string;
  targetUserId: string;
  targetCompanyId: string;
  reason: string;
  startedAt: number;
  lastActivityAt: number;
  expiresAt: number;
}

class ImpersonationService {
  /**
   * Start impersonation session
   * Creates DB session and sets httpOnly cookie
   */
  async startImpersonation(
    req: Request,
    res: Response,
    ownerUserId: string,
    ownerEmail: string,
    targetUserId: string,
    targetCompanyId: string,
    reason: string
  ): Promise<ImpersonationSession> {
    // End any existing session for this owner first
    const existing = await impersonationRepository.getActiveSessionByOwner(ownerUserId);
    if (existing) {
      await this.endSessionInternal(existing.id, "manual", ownerUserId, ownerEmail, req);
    }

    // Create new session in DB
    const session = await impersonationRepository.createSession(
      ownerUserId,
      targetUserId,
      targetCompanyId,
      reason
    );

    // Set httpOnly cookie with session ID
    res.cookie(IMPERSONATION_COOKIE_NAME, session.id, COOKIE_OPTIONS);

    // Log the impersonation start
    await platformAuditService.logImpersonationStart(
      ownerUserId,
      ownerEmail,
      targetUserId,
      targetCompanyId,
      reason || "Admin support session",
      req
    );

    return session;
  }

  /**
   * Stop impersonation session
   * Validates that the requester is the original owner
   */
  async stopImpersonation(req: Request, res: Response, requestingOwnerId: string, ownerEmail: string): Promise<void> {
    const sessionId = this.getSessionIdFromCookie(req);
    if (!sessionId) {
      this.clearCookie(res);
      return;
    }

    const session = await impersonationRepository.getActiveSessionById(sessionId);
    if (!session) {
      this.clearCookie(res);
      return;
    }

    // CRITICAL: Verify the requesting owner is the one who started the session
    if (session.ownerUserId !== requestingOwnerId) {
      throw new Error("Unauthorized: Only the original owner can stop this impersonation");
    }

    await this.endSessionInternal(sessionId, "manual", session.ownerUserId, ownerEmail, req);
    this.clearCookie(res);
  }

  /**
   * Check if impersonation is active and valid
   * Returns the session if valid, null otherwise
   * Automatically ends session if expired or idle
   */
  async checkImpersonation(req: Request, res: Response): Promise<ImpersonationSession | null> {
    const sessionId = this.getSessionIdFromCookie(req);
    if (!sessionId) {
      return null;
    }

    const session = await impersonationRepository.getActiveSessionById(sessionId);
    if (!session) {
      this.clearCookie(res);
      return null;
    }

    // Hotfix (post-Phase-7): only `status='active'` sessions authorize access.
    // Pending sessions await tenant approval; revoked/closed/expired must never
    // auth even if a stale cookie is on the wire.
    if (session.status !== "active") {
      this.clearCookie(res);
      return null;
    }

    // Check if session has expired
    if (session.isExpired) {
      await this.endSessionWithTimeout(session, "expiry", req);
      this.clearCookie(res);
      return null;
    }

    // Check if session is idle
    if (session.isIdle) {
      await this.endSessionWithTimeout(session, "idle", req);
      this.clearCookie(res);
      return null;
    }

    // Touch session to update lastSeenAt
    await impersonationRepository.touchSession(sessionId);

    return session;
  }

  /**
   * Get active impersonation session (without validation/touch)
   * Used for status checks without modifying the session
   */
  async getActiveImpersonation(req: Request): Promise<ImpersonationSession | null> {
    const sessionId = this.getSessionIdFromCookie(req);
    if (!sessionId) {
      return null;
    }

    const session = await impersonationRepository.getActiveSessionById(sessionId);
    if (!session || session.isExpired || session.isIdle) {
      return null;
    }

    return session;
  }

  /**
   * Get remaining time for impersonation session
   */
  async getRemainingTime(req: Request): Promise<{ minutes: number; seconds: number } | null> {
    const session = await this.getActiveImpersonation(req);
    if (!session) {
      return null;
    }
    return impersonationRepository.getRemainingTime(session);
  }

  /**
   * Get idle time remaining before auto-logout
   */
  async getIdleTimeRemaining(req: Request): Promise<{ minutes: number; seconds: number } | null> {
    const session = await this.getActiveImpersonation(req);
    if (!session) {
      return null;
    }
    return impersonationRepository.getIdleTimeRemaining(session);
  }

  /**
   * End all sessions for an owner (e.g., on logout)
   */
  async endAllSessionsForOwner(ownerUserId: string, ownerEmail: string, res?: Response): Promise<void> {
    await impersonationRepository.endAllSessionsForOwner(ownerUserId, "logout");
    if (res) {
      this.clearCookie(res);
    }
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private getSessionIdFromCookie(req: Request): string | null {
    return req.cookies?.[IMPERSONATION_COOKIE_NAME] || null;
  }

  private clearCookie(res: Response): void {
    res.clearCookie(IMPERSONATION_COOKIE_NAME, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/",
    });
  }

  private async endSessionInternal(
    sessionId: string,
    reason: EndedReason,
    ownerUserId: string,
    ownerEmail: string,
    req: Request
  ): Promise<void> {
    const session = await impersonationRepository.getActiveSessionById(sessionId);
    if (!session) return;

    await impersonationRepository.endSession(sessionId, reason);

    // Phase 4: only the impersonation mode had an impersonation_stop
    // audit before this phase. Read-only sessions emit support_session_*
    // events via supportSessionService, not here.
    if (session.accessMode === "impersonation" && session.targetUserId) {
      const duration = Date.now() - session.createdAt.getTime();
      await platformAuditService.logImpersonationStop(
        ownerUserId,
        ownerEmail,
        session.targetUserId,
        session.companyId,
        req,
        duration,
      );
    }
  }

  private async endSessionWithTimeout(
    session: ImpersonationSession & { isExpired: boolean; isIdle: boolean },
    timeoutType: "expiry" | "idle",
    req: Request
  ): Promise<void> {
    const reason: EndedReason = timeoutType === "expiry" ? "expired" : "idle";
    await impersonationRepository.endSession(session.id, reason);

    // Phase 4: emit the new support-session lifecycle event alongside the
    // legacy impersonation timeout audit so dashboards on either action key
    // remain consistent.
    await platformAuditService.logSupportSessionExpired(
      session.ownerUserId,
      session.id,
      session.companyId,
      timeoutType,
    );

    // Keep the pre-Phase-4 impersonation timeout audit for continuity, but
    // only when the session was actually an impersonation. Read-only
    // sessions never had an impersonation_auto_timeout event.
    if (session.accessMode === "impersonation" && session.targetUserId) {
      await platformAuditService.logImpersonationTimeout(
        session.ownerUserId,
        "owner", // Email will be in the audit context
        session.targetUserId,
        session.companyId,
        timeoutType
      );
    }
  }
}

export const impersonationService = new ImpersonationService();
