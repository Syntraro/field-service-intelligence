import { db } from "../db";
import { eq, desc, and } from "drizzle-orm";
import { companyAuditLogs, auditLogs, type InsertAuditLog } from "@shared/schema";
import { BaseRepository, clampLimit } from "./base";
import type { Request } from "express";

/**
 * Audit repository - handles all audit log database operations.
 * Two types of audit logs:
 * 1. companyAuditLogs - tenant-scoped audit logs for company actions
 * 2. auditLogs - platform-level audit logs for admin/impersonation actions
 */
export class AuditRepository extends BaseRepository {
  // ========================================
  // COMPANY AUDIT LOGS (tenant-scoped)
  // ========================================

  /**
   * Write a company-scoped audit log entry
   */
  async writeCompanyAuditLog({
    companyId,
    userId,
    action,
    entity,
    entityId,
    metadata,
  }: {
    companyId: string;
    userId?: string;
    action: string;
    entity: string;
    entityId?: string;
    metadata?: any;
  }) {
    this.assertCompanyId(companyId);

    await db.insert(companyAuditLogs).values({
      companyId,
      userId,
      action,
      entity,
      entityId,
      metadata,
    });
  }

  /**
   * Get company audit logs
   */
  async getCompanyAuditLogs(companyId: string, limit = 100) {
    this.assertCompanyId(companyId);
    const safeLimit = clampLimit(limit, 500);

    return await db
      .select()
      .from(companyAuditLogs)
      .where(eq(companyAuditLogs.companyId, companyId))
      .orderBy(desc(companyAuditLogs.createdAt))
      .limit(safeLimit);
  }

  // ========================================
  // PLATFORM AUDIT LOGS (admin actions)
  // ========================================

  /**
   * Write a platform-level audit log entry
   */
  async writePlatformAuditLog(data: InsertAuditLog) {
    try {
      await db.insert(auditLogs).values(data);
    } catch (error) {
      // Log error but don't throw - audit failures shouldn't break operations
      console.error("Platform audit logging failed:", error);
    }
  }

  /**
   * Get audit logs for a specific platform admin
   */
  async getLogsForAdmin(platformAdminId: string, limit = 100) {
    const safeLimit = clampLimit(limit, 500);

    return await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.platformAdminId, platformAdminId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(safeLimit);
  }

  /**
   * Get audit logs for a target company
   */
  async getLogsForCompany(companyId: string, limit = 100) {
    this.assertCompanyId(companyId);
    const safeLimit = clampLimit(limit, 500);

    return await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.targetCompanyId, companyId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(safeLimit);
  }

  /**
   * Get recent audit logs (all) - platform admin only
   */
  async getRecentLogs(limit = 100) {
    const safeLimit = clampLimit(limit, 500);

    return await db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(safeLimit);
  }

  /**
   * Helper: Extract IP address from request
   */
  getIpAddress(req: Request): string {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string") {
      return forwarded.split(",")[0].trim();
    }
    return req.ip || req.socket.remoteAddress || "unknown";
  }
}

export const auditRepository = new AuditRepository();
