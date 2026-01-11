import { auditRepository } from "./storage/audit";
import type { InsertAuditLog } from "@shared/schema";
import type { Request } from "express";

export type AuditAction =
  | "impersonation_start"
  | "impersonation_stop"
  | "impersonation_auto_timeout"
  | "cross_tenant_read"
  | "cross_tenant_write"
  | "auth_failure"
  | "billing_adjustment"
  | "trial_adjustment"
  | "company_status_change";

interface AuditLogParams {
  platformAdminId: string;
  platformAdminEmail: string;
  action: AuditAction;
  targetCompanyId?: string;
  targetUserId?: string;
  reason?: string;
  details?: Record<string, any>;
  req?: Request;
}

/**
 * Audit service for platform-level audit logging.
 * Uses auditRepository for all database operations.
 */
class AuditService {
  /**
   * Create an audit log entry
   */
  async log(params: AuditLogParams): Promise<void> {
    const {
      platformAdminId,
      platformAdminEmail,
      action,
      targetCompanyId,
      targetUserId,
      reason,
      details,
      req,
    } = params;

    // Validate that impersonation actions include a reason
    if (
      action.startsWith("impersonation") &&
      action !== "impersonation_auto_timeout" &&
      !reason
    ) {
      throw new Error("Reason is required for impersonation actions");
    }

    const auditLogData: InsertAuditLog = {
      platformAdminId,
      platformAdminEmail,
      action,
      targetCompanyId: targetCompanyId || null,
      targetUserId: targetUserId || null,
      reason: reason || null,
      details: details ? JSON.stringify(details) : null,
      ipAddress: req ? auditRepository.getIpAddress(req) : null,
      userAgent: req?.headers["user-agent"] || null,
    };

    await auditRepository.writePlatformAuditLog(auditLogData);
  }

  /**
   * Log impersonation start
   */
  async logImpersonationStart(
    platformAdminId: string,
    platformAdminEmail: string,
    targetUserId: string,
    targetCompanyId: string,
    reason: string,
    req: Request
  ): Promise<void> {
    await this.log({
      platformAdminId,
      platformAdminEmail,
      action: "impersonation_start",
      targetCompanyId,
      targetUserId,
      reason,
      req,
      details: {
        expiresIn: "60 minutes",
        idleTimeout: "15 minutes",
      },
    });
  }

  /**
   * Log impersonation stop (manual)
   */
  async logImpersonationStop(
    platformAdminId: string,
    platformAdminEmail: string,
    targetUserId: string,
    targetCompanyId: string,
    req: Request,
    duration?: number
  ): Promise<void> {
    await this.log({
      platformAdminId,
      platformAdminEmail,
      action: "impersonation_stop",
      targetCompanyId,
      targetUserId,
      req,
      details: {
        durationMinutes: duration ? Math.round(duration / 60000) : undefined,
      },
    });
  }

  /**
   * Log impersonation auto-timeout
   */
  async logImpersonationTimeout(
    platformAdminId: string,
    platformAdminEmail: string,
    targetUserId: string,
    targetCompanyId: string,
    timeoutType: "expiry" | "idle"
  ): Promise<void> {
    await this.log({
      platformAdminId,
      platformAdminEmail,
      action: "impersonation_auto_timeout",
      targetCompanyId,
      targetUserId,
      details: {
        timeoutType,
      },
    });
  }

  /**
   * Log cross-tenant read operation
   */
  async logCrossTenantRead(
    platformAdminId: string,
    platformAdminEmail: string,
    targetCompanyId: string,
    resource: string,
    req: Request
  ): Promise<void> {
    await this.log({
      platformAdminId,
      platformAdminEmail,
      action: "cross_tenant_read",
      targetCompanyId,
      req,
      details: {
        resource,
      },
    });
  }

  /**
   * Log cross-tenant write operation
   */
  async logCrossTenantWrite(
    platformAdminId: string,
    platformAdminEmail: string,
    targetCompanyId: string,
    resource: string,
    operation: string,
    req: Request
  ): Promise<void> {
    await this.log({
      platformAdminId,
      platformAdminEmail,
      action: "cross_tenant_write",
      targetCompanyId,
      req,
      details: {
        resource,
        operation,
      },
    });
  }

  /**
   * Log failed authorization attempt
   */
  async logAuthFailure(
    userId: string,
    userEmail: string,
    attemptedAction: string,
    req: Request,
    reason?: string
  ): Promise<void> {
    await this.log({
      platformAdminId: userId,
      platformAdminEmail: userEmail,
      action: "auth_failure",
      req,
      details: {
        attemptedAction,
        failureReason: reason,
      },
    });
  }

  /**
   * Log billing adjustment
   */
  async logBillingAdjustment(
    platformAdminId: string,
    platformAdminEmail: string,
    targetCompanyId: string,
    adjustment: Record<string, any>,
    req: Request
  ): Promise<void> {
    await this.log({
      platformAdminId,
      platformAdminEmail,
      action: "billing_adjustment",
      targetCompanyId,
      req,
      details: adjustment,
    });
  }

  /**
   * Log trial adjustment
   */
  async logTrialAdjustment(
    platformAdminId: string,
    platformAdminEmail: string,
    targetCompanyId: string,
    adjustment: Record<string, any>,
    req: Request
  ): Promise<void> {
    await this.log({
      platformAdminId,
      platformAdminEmail,
      action: "trial_adjustment",
      targetCompanyId,
      req,
      details: adjustment,
    });
  }

  /**
   * Get audit logs for a platform admin
   */
  async getLogsForAdmin(platformAdminId: string, limit = 100) {
    return auditRepository.getLogsForAdmin(platformAdminId, limit);
  }

  /**
   * Get audit logs for a company
   */
  async getLogsForCompany(companyId: string, limit = 100) {
    return auditRepository.getLogsForCompany(companyId, limit);
  }

  /**
   * Get recent audit logs (all)
   */
  async getRecentLogs(limit = 100) {
    return auditRepository.getRecentLogs(limit);
  }
}

export const auditService = new AuditService();
