import { db } from "../db";
import { auditEvents, type AuditAction, type InsertAuditEvent } from "@shared/schema";
import type { Request } from "express";

/**
 * Audit Service - logs sensitive team management actions
 * for security and compliance purposes.
 */

interface AuditLogOptions {
  companyId: string;
  actorUserId: string;
  targetUserId?: string;
  action: AuditAction;
  metadata?: Record<string, unknown>;
  req?: Request; // Optional request to extract IP and user agent
}

/**
 * Log an audit event
 */
export async function logAuditEvent(options: AuditLogOptions): Promise<void> {
  const { companyId, actorUserId, targetUserId, action, metadata, req } = options;

  const ipAddress = req
    ? (req.ip || (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || null)
    : null;
  const userAgent = req?.headers["user-agent"] || null;

  try {
    await db.insert(auditEvents).values({
      companyId,
      actorUserId,
      targetUserId: targetUserId || null,
      action,
      metadata: metadata || null,
      ipAddress,
      userAgent,
    });
  } catch (error) {
    // Don't let audit failures break the main operation
    console.error("[AuditService] Failed to log audit event:", error);
  }
}

/**
 * Convenience functions for specific audit actions
 */

export async function logTeamMemberCreated(
  req: Request,
  companyId: string,
  actorUserId: string,
  targetUserId: string,
  metadata: { email: string; fullName: string; role?: string }
): Promise<void> {
  await logAuditEvent({
    companyId,
    actorUserId,
    targetUserId,
    action: "TEAM_MEMBER_CREATED",
    metadata,
    req,
  });
}

export async function logEmailChanged(
  req: Request,
  companyId: string,
  actorUserId: string,
  targetUserId: string,
  metadata: { oldEmail: string; newEmail: string }
): Promise<void> {
  await logAuditEvent({
    companyId,
    actorUserId,
    targetUserId,
    action: "EMAIL_CHANGED",
    metadata,
    req,
  });
}

export async function logPasswordReset(
  req: Request,
  companyId: string,
  actorUserId: string,
  targetUserId: string
): Promise<void> {
  await logAuditEvent({
    companyId,
    actorUserId,
    targetUserId,
    action: "PASSWORD_RESET",
    metadata: { resetBy: actorUserId === targetUserId ? "self" : "admin" },
    req,
  });
}

export async function logRoleChanged(
  req: Request,
  companyId: string,
  actorUserId: string,
  targetUserId: string,
  metadata: { oldRole?: string; newRole: string; oldRoleId?: string; newRoleId?: string }
): Promise<void> {
  await logAuditEvent({
    companyId,
    actorUserId,
    targetUserId,
    action: "ROLE_CHANGED",
    metadata,
    req,
  });
}

export async function logUserEnabled(
  req: Request,
  companyId: string,
  actorUserId: string,
  targetUserId: string
): Promise<void> {
  await logAuditEvent({
    companyId,
    actorUserId,
    targetUserId,
    action: "USER_ENABLED",
    req,
  });
}

export async function logUserDisabled(
  req: Request,
  companyId: string,
  actorUserId: string,
  targetUserId: string
): Promise<void> {
  await logAuditEvent({
    companyId,
    actorUserId,
    targetUserId,
    action: "USER_DISABLED",
    req,
  });
}

export async function logInvitationCreated(
  req: Request,
  companyId: string,
  actorUserId: string,
  metadata: { email: string; role: string; expiresAt?: string | Date }
): Promise<void> {
  await logAuditEvent({
    companyId,
    actorUserId,
    action: "INVITATION_CREATED",
    metadata,
    req,
  });
}

export async function logInvitationResent(
  req: Request,
  companyId: string,
  actorUserId: string,
  metadata: { invitationId: string; expiresAt?: string | Date }
): Promise<void> {
  await logAuditEvent({
    companyId,
    actorUserId,
    action: "INVITATION_RESENT",
    metadata,
    req,
  });
}
