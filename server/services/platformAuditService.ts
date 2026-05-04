import { auditRepository } from "../storage/audit";
import type { InsertAuditLog } from "@shared/schema";
import type { Request } from "express";

/**
 * Platform audit service — platform-admin actions that cross tenants
 * and/or touch subscription/billing state. Writes to the `auditLogs`
 * table via `auditRepository.writePlatformAuditLog`.
 *
 * 2026-04-14 Phase 3 clean-surfaces: moved from `server/auditService.ts`
 * into `server/services/` so all audit surfaces live in one folder. The
 * file/class/export were renamed to disambiguate from
 * `server/services/auditService.ts` (team/company-scoped audit events,
 * different table). No behavior change, no schema change.
 */
export type AuditAction =
  | "impersonation_start"
  | "impersonation_stop"
  | "impersonation_auto_timeout"
  | "cross_tenant_read"
  | "cross_tenant_write"
  | "auth_failure"
  | "billing_adjustment"
  | "trial_adjustment"
  | "company_status_change"
  | "qbo_replay_one"
  | "qbo_replay_all_failed"
  // Phase 1 (Platform Admin Foundation): denial audit actions
  | "platform_role_denied"
  | "platform_tenant_access_denied"
  // Phase 2 (Ops Portal Core): tenant feature flag mutation via platform portal
  | "tenant_features_updated"
  // Phase 3 (Ops Portal Feedback + Issue System)
  | "feedback_status_changed"
  | "feedback_assigned"
  | "issue_created"
  | "issue_severity_changed"
  | "issue_closed"
  // Phase 4 (Support Sessions)
  | "support_session_created"
  | "support_session_activated"
  | "support_session_revoked"
  | "support_session_closed"
  | "support_session_expired"
  | "read_only_mutation_blocked"
  // Phase 6 (Customer Approval)
  | "support_session_tenant_approved"
  | "support_session_tenant_denied"
  | "support_session_tenant_revoked"
  // 2026-04-19 Entitlement system — canonical plan/feature/override mutations
  | "entitlement_feature_created"
  | "entitlement_feature_updated"
  | "entitlement_plan_created"
  | "entitlement_plan_updated"
  | "entitlement_plan_feature_upsert"
  | "entitlement_plan_metadata_updated"
  | "entitlement_tenant_plan_assigned"
  | "entitlement_tenant_override_upsert"
  | "entitlement_tenant_override_removed"
  // 2026-04-22 Phase 1 Platform Auth Separation — login + logout audit
  // events emitted by `server/routes/platformAuth.ts`. Previously logged
  // via `as any` casts; now first-class members of the union so future
  // typos surface at compile time.
  | "platform_login"
  | "platform_login_failed"
  | "platform_login_rejected_non_platform"
  | "platform_logout"
  // 2026-05-03 Platform-only password reset flow — request + completion
  // audit events emitted by the new platform reset endpoints.
  | "platform_password_reset_requested"
  | "platform_password_reset_completed"
  // 2026-05-04 Tenant teardown / hard-delete — every phase of the secure
  // 4-phase deletion workflow leaves an immutable audit row. Read by ops
  // forensics + the future "tenant audit timeline" surface.
  | "platform_tenant_teardown_preview"
  | "platform_tenant_teardown_request_created"
  | "platform_tenant_teardown_request_failed"
  | "platform_tenant_teardown_approved"
  | "platform_tenant_teardown_approve_reauth_failed"
  | "platform_tenant_teardown_cancelled"
  // 2026-05-04 F1 hardening — worker transitions previously emitted only
  // alerts; these audit rows close the gap so audit_logs reflects the
  // entire lifecycle.
  | "platform_tenant_teardown_execute_started"
  | "platform_tenant_teardown_executed"
  | "platform_tenant_teardown_execute_failed"
  | "platform_tenant_teardown_expired";

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
 * Platform audit service for platform-level audit logging.
 * Uses auditRepository for all database operations.
 */
class PlatformAuditService {
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
   * Log QBO single job replay
   */
  async logQboReplayOne(
    platformAdminId: string,
    platformAdminEmail: string,
    jobId: string,
    jobCompanyId: string,
    entityType: string,
    entityId: string,
    previousStatus: string,
    req: Request
  ): Promise<void> {
    await this.log({
      platformAdminId,
      platformAdminEmail,
      action: "qbo_replay_one",
      targetCompanyId: jobCompanyId,
      req,
      details: {
        jobId,
        entityType,
        entityId,
        previousStatus,
        newStatus: "QUEUED",
      },
    });
  }

  /**
   * Log QBO bulk failed jobs replay
   */
  async logQboReplayAllFailed(
    platformAdminId: string,
    platformAdminEmail: string,
    affectedCount: number,
    affectedCompanyIds: string[],
    filterCompanyId: string | undefined,
    req: Request
  ): Promise<void> {
    await this.log({
      platformAdminId,
      platformAdminEmail,
      action: "qbo_replay_all_failed",
      targetCompanyId: filterCompanyId,
      req,
      details: {
        affectedJobsCount: affectedCount,
        affectedCompanyIds,
        filterCompanyId: filterCompanyId || "all_tenants",
        previousStatus: "FAILED",
        newStatus: "QUEUED",
      },
    });
  }

  /**
   * Log a denial when a user attempts a platform-gated route without
   * a valid platform role. Phase 1 (Platform Admin Foundation).
   */
  async logPlatformRoleDenied(
    userId: string,
    userEmail: string,
    attemptedPath: string,
    userRole: string | null,
    req: Request
  ): Promise<void> {
    await this.log({
      platformAdminId: userId,
      platformAdminEmail: userEmail,
      action: "platform_role_denied",
      req,
      details: { attemptedPath, userRole },
    });
  }

  /**
   * Log a denial when a platform-role user attempts to access tenant
   * data without an active support/impersonation session.
   * Phase 1 (Platform Admin Foundation).
   */
  async logPlatformTenantAccessDenied(
    platformAdminId: string,
    platformAdminEmail: string,
    attemptedPath: string,
    req: Request
  ): Promise<void> {
    await this.log({
      platformAdminId,
      platformAdminEmail,
      action: "platform_tenant_access_denied",
      req,
      details: { attemptedPath },
    });
  }

  /**
   * Log a tenant feature-flag mutation initiated from the platform Ops Portal.
   * Phase 2 (Ops Portal Core).
   */
  async logTenantFeaturesUpdated(
    platformAdminId: string,
    platformAdminEmail: string,
    targetCompanyId: string,
    changedFlags: Record<string, { before: unknown; after: unknown }>,
    req: Request,
  ): Promise<void> {
    await this.log({
      platformAdminId,
      platformAdminEmail,
      action: "tenant_features_updated",
      targetCompanyId,
      req,
      details: { changedFlags },
    });
  }

  /**
   * Phase 3 — feedback / issue audit helpers. All write to `audit_logs`.
   */
  async logFeedbackStatusChanged(
    platformAdminId: string,
    platformAdminEmail: string,
    feedbackId: string,
    tenantId: string | null,
    before: string,
    after: string,
    req: Request,
  ): Promise<void> {
    await this.log({
      platformAdminId,
      platformAdminEmail,
      action: "feedback_status_changed",
      targetCompanyId: tenantId ?? undefined,
      req,
      details: { feedbackId, before, after },
    });
  }

  async logFeedbackAssigned(
    platformAdminId: string,
    platformAdminEmail: string,
    feedbackId: string,
    tenantId: string | null,
    before: string | null,
    after: string | null,
    req: Request,
  ): Promise<void> {
    await this.log({
      platformAdminId,
      platformAdminEmail,
      action: "feedback_assigned",
      targetCompanyId: tenantId ?? undefined,
      req,
      details: { feedbackId, before, after },
    });
  }

  async logIssueCreated(
    platformAdminId: string,
    platformAdminEmail: string,
    issueId: string,
    tenantId: string | null,
    title: string,
    severity: string,
    req: Request,
  ): Promise<void> {
    await this.log({
      platformAdminId,
      platformAdminEmail,
      action: "issue_created",
      targetCompanyId: tenantId ?? undefined,
      req,
      details: { issueId, title, severity },
    });
  }

  async logIssueSeverityChanged(
    platformAdminId: string,
    platformAdminEmail: string,
    issueId: string,
    tenantId: string | null,
    before: string,
    after: string,
    req: Request,
  ): Promise<void> {
    await this.log({
      platformAdminId,
      platformAdminEmail,
      action: "issue_severity_changed",
      targetCompanyId: tenantId ?? undefined,
      req,
      details: { issueId, before, after },
    });
  }

  async logIssueClosed(
    platformAdminId: string,
    platformAdminEmail: string,
    issueId: string,
    tenantId: string | null,
    req: Request,
  ): Promise<void> {
    await this.log({
      platformAdminId,
      platformAdminEmail,
      action: "issue_closed",
      targetCompanyId: tenantId ?? undefined,
      req,
      details: { issueId },
    });
  }

  /**
   * Phase 4 — support-session lifecycle audit helpers.
   */
  async logSupportSessionCreated(
    platformAdminId: string,
    platformAdminEmail: string,
    sessionId: string,
    tenantId: string,
    accessMode: string,
    approvedByUserId: string | null,
    durationMs: number,
    reason: string | null,
    req: Request,
  ): Promise<void> {
    await this.log({
      platformAdminId,
      platformAdminEmail,
      action: "support_session_created",
      targetCompanyId: tenantId,
      reason: reason ?? undefined,
      req,
      details: { sessionId, accessMode, approvedByUserId, durationMinutes: Math.round(durationMs / 60000) },
    });
  }

  async logSupportSessionActivated(
    platformAdminId: string, platformAdminEmail: string,
    sessionId: string, tenantId: string, req: Request,
  ): Promise<void> {
    await this.log({
      platformAdminId, platformAdminEmail,
      action: "support_session_activated",
      targetCompanyId: tenantId, req, details: { sessionId },
    });
  }

  async logSupportSessionRevoked(
    platformAdminId: string, platformAdminEmail: string,
    sessionId: string, tenantId: string, req: Request,
  ): Promise<void> {
    await this.log({
      platformAdminId, platformAdminEmail,
      action: "support_session_revoked",
      targetCompanyId: tenantId, req, details: { sessionId },
    });
  }

  async logSupportSessionClosed(
    platformAdminId: string, platformAdminEmail: string,
    sessionId: string, tenantId: string, req: Request,
  ): Promise<void> {
    await this.log({
      platformAdminId, platformAdminEmail,
      action: "support_session_closed",
      targetCompanyId: tenantId, req, details: { sessionId },
    });
  }

  async logSupportSessionExpired(
    platformAdminId: string,
    sessionId: string,
    tenantId: string,
    timeoutType: "expiry" | "idle",
  ): Promise<void> {
    await this.log({
      platformAdminId,
      platformAdminEmail: "system",
      action: "support_session_expired",
      targetCompanyId: tenantId,
      details: { sessionId, timeoutType },
    });
  }

  async logReadOnlyMutationBlocked(
    platformAdminId: string, platformAdminEmail: string,
    sessionId: string, tenantId: string,
    method: string, path: string,
    req?: Request,
  ): Promise<void> {
    await this.log({
      platformAdminId, platformAdminEmail,
      action: "read_only_mutation_blocked",
      targetCompanyId: tenantId, req,
      details: { sessionId, method, path },
    });
  }

  /**
   * Phase 6 — tenant-side approval lifecycle. Actor is the tenant admin
   * (not a platform admin), recorded in the legacy `platformAdminId` /
   * `platformAdminEmail` fields since `audit_logs` has no separate tenant
   * actor column; `details.tenantActor = true` disambiguates.
   */
  async logTenantApprovedSupport(
    tenantUserId: string, tenantUserEmail: string,
    sessionId: string, tenantId: string, req: Request,
  ): Promise<void> {
    await this.log({
      platformAdminId: tenantUserId,
      platformAdminEmail: tenantUserEmail,
      action: "support_session_tenant_approved",
      targetCompanyId: tenantId, req,
      details: { sessionId, tenantActor: true },
    });
  }

  async logTenantDeniedSupport(
    tenantUserId: string, tenantUserEmail: string,
    sessionId: string, tenantId: string, req: Request,
  ): Promise<void> {
    await this.log({
      platformAdminId: tenantUserId,
      platformAdminEmail: tenantUserEmail,
      action: "support_session_tenant_denied",
      targetCompanyId: tenantId, req,
      details: { sessionId, tenantActor: true },
    });
  }

  async logTenantRevokedSupport(
    tenantUserId: string, tenantUserEmail: string,
    sessionId: string, tenantId: string, req: Request,
  ): Promise<void> {
    await this.log({
      platformAdminId: tenantUserId,
      platformAdminEmail: tenantUserEmail,
      action: "support_session_tenant_revoked",
      targetCompanyId: tenantId, req,
      details: { sessionId, tenantActor: true },
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

export const platformAuditService = new PlatformAuditService();
