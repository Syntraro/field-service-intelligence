/**
 * Tenant-Side Support Access Routes — Phase 6 (Customer Approval).
 *
 * Mounted at /api/support-access. These are TENANT endpoints (not platform).
 * A tenant admin/owner can:
 *   - GET    /pending     — pending support requests for their company
 *   - GET    /active      — active support sessions currently touching their company
 *   - POST   /:id/approve — approve a pending request (activates; expiry restarts)
 *   - POST   /:id/deny    — deny a pending request (revokes)
 *   - POST   /:id/revoke  — tenant revokes an already-active session
 *
 * Every route validates:
 *   - tenant caller is owner/admin
 *   - session.companyId === req.companyId (no cross-tenant manipulation)
 *
 * Audits to the existing `audit_logs` table via platformAuditService.
 */

import { Router, type Response } from "express";
import { z } from "zod";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { requireRole } from "../auth/requireRole";
import { ADMIN_ROLES } from "../auth/roles";
import { impersonationRepository } from "../storage/impersonation";
import { platformAuditService } from "../services/platformAuditService";
import { userRepository } from "../storage/users";
import type { AuthedRequest } from "../auth/tenantIsolation";
import type { ImpersonationSession } from "@shared/schema";

const router = Router();

const idParamSchema = z.object({ id: z.string().min(1) });

/**
 * Phase 7 — enrich session rows with the requesting user's name/email and,
 * for impersonation mode, the target user's identity. Keeps the tenant
 * approval UI informative without extra round-trips.
 */
async function enrichForTenant(rows: ImpersonationSession[]) {
  const userIds = new Set<string>();
  for (const r of rows) {
    userIds.add(r.ownerUserId);
    if (r.targetUserId) userIds.add(r.targetUserId);
  }
  const userMap = new Map<string, { id: string; email: string | null; fullName: string | null }>();
  await Promise.all(Array.from(userIds).map(async (id) => {
    const u = await userRepository.getUser(id);
    if (u) userMap.set(id, { id: u.id, email: u.email ?? null, fullName: (u as any).fullName ?? null });
  }));
  return rows.map((r) => ({
    ...r,
    requestingUser: userMap.get(r.ownerUserId) ?? null,
    targetUser: r.targetUserId ? userMap.get(r.targetUserId) ?? null : null,
  }));
}

// GET /api/support-access/pending — pending requests for this tenant
router.get(
  "/pending",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const rows = await impersonationRepository.listForTenant(req.companyId);
    res.json(await enrichForTenant(rows.filter((r) => r.status === "pending")));
  }),
);

// GET /api/support-access/active — currently-active sessions for this tenant
router.get(
  "/active",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const rows = await impersonationRepository.listForTenant(req.companyId);
    res.json(await enrichForTenant(rows.filter((r) => r.status === "active")));
  }),
);

function assertTenantOwns(sessionCompanyId: string, reqCompanyId: string) {
  if (sessionCompanyId !== reqCompanyId) {
    throw createError(404, "Support session not found");
  }
}

// POST /api/support-access/:id/approve
router.post(
  "/:id/approve",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { id } = validateSchema(idParamSchema, req.params);
    const existing = await impersonationRepository.getActiveSessionById(id);
    if (!existing || existing.status !== "pending") {
      throw createError(404, "Pending support request not found");
    }
    assertTenantOwns(existing.companyId, req.companyId);

    // Hotfix (post-Phase-7): if the sweep hasn't run yet, a pending row whose
    // expires_at has already passed could otherwise be approved. Close the
    // TOCTOU window here.
    if (existing.expiresAt.getTime() < Date.now()) {
      throw createError(410, "This support request has expired", "EXPIRED");
    }

    // Phase 6 hardening: expiry starts NOW, not at creation time — customer
    // doesn't burn duration while deciding.
    // Phase 7: prefer the canonical `requestedDurationMinutes` column over
    // the pre-Phase-7 (expires_at - created_at) derivation.
    const durationMs =
      existing.requestedDurationMinutes && existing.requestedDurationMinutes > 0
        ? existing.requestedDurationMinutes * 60_000
        : Math.max(15 * 60_000, existing.expiresAt.getTime() - existing.createdAt.getTime());
    const freshExpiresAt = new Date(Date.now() + durationMs);

    const updated = await impersonationRepository.approvePendingSession(
      id,
      req.user!.id,
      freshExpiresAt,
    );
    if (!updated) throw createError(409, "Support request could not be approved");

    await platformAuditService.logTenantApprovedSupport(
      req.user!.id,
      req.user!.email ?? "unknown",
      updated.id,
      updated.companyId,
      req,
    );
    res.json(updated);
  }),
);

// POST /api/support-access/:id/deny
router.post(
  "/:id/deny",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { id } = validateSchema(idParamSchema, req.params);
    const existing = await impersonationRepository.getActiveSessionById(id);
    if (!existing || existing.status !== "pending") {
      throw createError(404, "Pending support request not found");
    }
    assertTenantOwns(existing.companyId, req.companyId);

    const updated = await impersonationRepository.denyPendingSession(id);
    if (!updated) throw createError(409, "Support request could not be denied");

    await platformAuditService.logTenantDeniedSupport(
      req.user!.id,
      req.user!.email ?? "unknown",
      updated.id,
      updated.companyId,
      req,
    );
    res.json(updated);
  }),
);

// POST /api/support-access/:id/revoke — tenant ends an already-active session
router.post(
  "/:id/revoke",
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { id } = validateSchema(idParamSchema, req.params);
    const existing = await impersonationRepository.getActiveSessionById(id);
    if (!existing) throw createError(404, "Support session not found");
    assertTenantOwns(existing.companyId, req.companyId);

    const updated = await impersonationRepository.revokeSession(id);
    if (!updated) throw createError(409, "Support session could not be revoked");

    await platformAuditService.logTenantRevokedSupport(
      req.user!.id,
      req.user!.email ?? "unknown",
      updated.id,
      updated.companyId,
      req,
    );
    res.json(updated);
  }),
);

export default router;
