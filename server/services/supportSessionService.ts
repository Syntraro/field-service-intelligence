/**
 * Support Session Service — Phase 4.
 *
 * Orchestration layer for /api/platform/support-sessions. Wraps the existing
 * impersonation storage (same physical `impersonation_sessions` table) and
 * the existing `impersonationService` cookie path. The impersonation flow
 * becomes one of two access modes on this service.
 *
 * Does NOT create a parallel session system — it reuses the canonical cookie
 * (`imp_session`), canonical storage, and canonical middleware.
 */

import type { Request, Response } from "express";
import {
  impersonationRepository,
  type SupportAccessMode,
  type SupportSessionStatus,
} from "../storage/impersonation";
import { impersonationService } from "../impersonationService";
import { platformAuditService } from "./platformAuditService";
import { db } from "../db";
import { companies, users } from "@shared/schema";
import { inArray } from "drizzle-orm";
import type { ImpersonationSession } from "@shared/schema";

// Allowed duration buckets per spec: 15 / 30 / 60 minutes.
const ALLOWED_DURATIONS_MIN = [15, 30, 60] as const;
export type AllowedDurationMin = typeof ALLOWED_DURATIONS_MIN[number];

function validateDuration(minutes: number): AllowedDurationMin {
  if (!ALLOWED_DURATIONS_MIN.includes(minutes as AllowedDurationMin)) {
    throw new Error(`durationMinutes must be one of ${ALLOWED_DURATIONS_MIN.join(", ")}`);
  }
  return minutes as AllowedDurationMin;
}

export interface CreateSupportSessionInput {
  tenantId: string;
  accessMode: SupportAccessMode;
  durationMinutes: number;
  reason: string;
  /** Required when accessMode === 'impersonation'. */
  targetUserId?: string | null;
  /** Tenant user who approved the session (optional metadata). */
  approvedByUserId?: string | null;
  /**
   * Phase 5: customer-approval foundation. When 'pending', the session is
   * created but not yet usable — no cookie is set, tenantIsolation will not
   * treat the platform actor as having tenant access. A later `activate`
   * call (typically after customer approval) transitions it to 'active'.
   * Only valid for accessMode='read_only'; impersonation always starts active.
   */
  initialStatus?: SupportSessionStatus;
  actor: { id: string; email: string };
  req: Request;
  res: Response;
}

/**
 * Create a support session. Behavior by mode:
 *
 * - impersonation: delegates to impersonationService.startImpersonation
 *   which writes the DB row, sets the httpOnly cookie, and audits
 *   `impersonation_start`. An additional `support_session_created` audit
 *   is written for Phase 4 continuity.
 *
 * - read_only: creates a pending/active session via storage, sets the
 *   cookie, and audits `support_session_created`. No user swap ever
 *   happens for this mode (see impersonationMiddleware).
 */
async function create(input: CreateSupportSessionInput): Promise<ImpersonationSession> {
  const durationMin = validateDuration(input.durationMinutes);
  const durationMs = durationMin * 60_000;

  let session: ImpersonationSession;

  if (input.accessMode === "impersonation") {
    if (!input.targetUserId) {
      throw new Error("targetUserId is required for impersonation mode");
    }
    // Reuse canonical impersonation start — writes cookie + audit.
    session = await impersonationService.startImpersonation(
      input.req,
      input.res,
      input.actor.id,
      input.actor.email,
      input.targetUserId,
      input.tenantId,
      input.reason,
    );
    // Also record the new Phase 4 lifecycle event so dashboards that query
    // by action name get a consistent view.
    await platformAuditService.logSupportSessionCreated(
      input.actor.id,
      input.actor.email,
      session.id,
      input.tenantId,
      "impersonation",
      input.approvedByUserId ?? null,
      durationMs,
      input.reason,
      input.req,
    );
  } else {
    // Read-only session: no user swap, no target user.
    const initialStatus: SupportSessionStatus =
      input.initialStatus === "pending" ? "pending" : "active";

    session = await impersonationRepository.createSupportSession({
      ownerUserId: input.actor.id,
      targetUserId: null,
      companyId: input.tenantId,
      reason: input.reason,
      accessMode: "read_only",
      approvedByUserId: input.approvedByUserId ?? null,
      durationMs,
      initialStatus,
    });

    // Only set the cookie once the session is actually usable. Pending
    // sessions carry no tenant access until activate transitions them.
    if (initialStatus === "active") {
      setSessionCookie(input.res, session.id, durationMs);
    }

    await platformAuditService.logSupportSessionCreated(
      input.actor.id,
      input.actor.email,
      session.id,
      input.tenantId,
      "read_only",
      input.approvedByUserId ?? null,
      durationMs,
      input.reason,
      input.req,
    );
  }

  return session;
}

export interface ListInput {
  activeOnly?: boolean;
  tenantId?: string;
  ownerUserId?: string;
  accessMode?: SupportAccessMode;
  status?: SupportSessionStatus;
  limit?: number;
  offset?: number;
}

async function list(input: ListInput) {
  const limit = Math.min(Math.max(1, Number(input.limit) || 25), 100);
  const offset = Math.max(0, Number(input.offset) || 0);
  const raw = await impersonationRepository.listSessions({
    activeOnly: !!input.activeOnly,
    companyId: input.tenantId,
    ownerUserId: input.ownerUserId,
    accessMode: input.accessMode,
    status: input.status,
    limit,
    offset,
  });

  if (raw.rows.length === 0) return raw;

  // Usability sprint (2026-04-16): hydrate UUIDs into human-readable
  // tenant + user labels so ops staff aren't squinting at truncated IDs.
  // Two batched queries — one for the distinct companies, one for the
  // distinct users (owners + impersonation targets).
  const companyIds = Array.from(new Set(raw.rows.map((r) => r.companyId)));
  const userIds = Array.from(new Set(
    raw.rows.flatMap((r) => [r.ownerUserId, r.targetUserId].filter(Boolean) as string[]),
  ));

  const [companyRows, userRows] = await Promise.all([
    companyIds.length > 0
      ? db
          .select({
            id: companies.id,
            name: companies.name,
          })
          .from(companies)
          .where(inArray(companies.id, companyIds))
      : Promise.resolve([] as { id: string; name: string }[]),
    userIds.length > 0
      ? db
          .select({
            id: users.id,
            email: users.email,
            fullName: users.fullName,
            firstName: users.firstName,
            lastName: users.lastName,
          })
          .from(users)
          .where(inArray(users.id, userIds))
      : Promise.resolve([] as { id: string; email: string; fullName: string | null; firstName: string | null; lastName: string | null }[]),
  ]);

  const companyById = new Map(companyRows.map((c) => [c.id, c.name]));
  const userById = new Map(userRows.map((u) => [u.id, u]));

  const enrichedRows = raw.rows.map((r) => {
    const owner = userById.get(r.ownerUserId) ?? null;
    const target = r.targetUserId ? (userById.get(r.targetUserId) ?? null) : null;
    const label = (u: typeof owner) =>
      u
        ? (u.fullName?.trim()
            || [u.firstName, u.lastName].filter(Boolean).join(" ").trim()
            || u.email)
        : null;
    return {
      ...r,
      tenantName: companyById.get(r.companyId) ?? null,
      ownerEmail: owner?.email ?? null,
      ownerName: label(owner),
      targetEmail: target?.email ?? null,
      targetName: label(target),
    };
  });

  return { ...raw, rows: enrichedRows };
}

async function activate(
  id: string,
  actor: { id: string; email: string },
  req: Request,
  res?: Response,
): Promise<ImpersonationSession | null> {
  const existing = await impersonationRepository.getActiveSessionById(id);
  if (!existing) return null;
  // Already active: idempotent no-op, still return row so caller can 200.
  if (existing.status === "active") return existing;

  // Hotfix (post-Phase-7): read-only pending sessions MUST be activated by
  // the tenant via /api/support-access/:id/approve. Platform admins cannot
  // self-activate and bypass customer approval.
  if (existing.status === "pending" && existing.accessMode === "read_only") {
    const err: any = new Error("Pending read-only sessions require tenant approval");
    err.status = 409;
    err.code = "REQUIRES_TENANT_APPROVAL";
    throw err;
  }

  const updated = await impersonationRepository.activateSession(id);
  if (!updated) return null;

  // Phase 5: transitioning from 'pending' to 'active' — set the cookie so
  // the session is usable. Only bind the cookie to the caller if they are
  // the owner (the platform admin who originally requested the session).
  // Impersonation-mode pending is not currently supported, so this is
  // relevant only for read_only sessions.
  if (res && updated.ownerUserId === actor.id) {
    const remainingMs = Math.max(0, updated.expiresAt.getTime() - Date.now());
    if (remainingMs > 0) {
      setSessionCookie(res, updated.id, remainingMs);
    }
  }

  await platformAuditService.logSupportSessionActivated(
    actor.id, actor.email, updated.id, updated.companyId, req,
  );
  return updated;
}

async function revoke(
  id: string,
  actor: { id: string; email: string },
  req: Request,
  res: Response,
): Promise<ImpersonationSession | null> {
  const updated = await impersonationRepository.revokeSession(id);
  if (!updated) return null;

  clearSessionCookie(res);

  await platformAuditService.logSupportSessionRevoked(
    actor.id, actor.email, updated.id, updated.companyId, req,
  );
  return updated;
}

async function close(
  id: string,
  actor: { id: string; email: string },
  req: Request,
  res: Response,
): Promise<ImpersonationSession | null> {
  const updated = await impersonationRepository.closeSession(id);
  if (!updated) return null;

  clearSessionCookie(res);

  await platformAuditService.logSupportSessionClosed(
    actor.id, actor.email, updated.id, updated.companyId, req,
  );
  return updated;
}

// ──────────────────────────────────────────────────────────
// Cookie helpers — use the SAME cookie as impersonation so the
// existing middleware picks up both modes.
// ──────────────────────────────────────────────────────────
const COOKIE_NAME = "imp_session";

function setSessionCookie(res: Response, sessionId: string, maxAgeMs: number) {
  res.cookie(COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeMs,
  });
}

function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}

export const supportSessionService = {
  create,
  list,
  activate,
  revoke,
  close,
};
