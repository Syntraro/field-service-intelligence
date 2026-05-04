/**
 * Platform Tenant Teardown Routes (2026-05-04).
 *
 * Mounted at /api/platform/tenants/:companyId/teardown/* — see
 * `server/routes/platform.ts`. All routes run BEHIND the parent
 * `requirePlatformRole()` gate AND a per-route capability gate. The
 * capabilities are deliberately split so a single role cannot drive
 * the full deletion workflow end-to-end:
 *
 *   GET    /preview                  — platform:tenant_teardown_preview
 *   POST   /request                  — platform:tenant_teardown_request
 *   POST   /approve/:requestId       — platform:tenant_teardown_approve
 *                                      (PLUS password re-entry)
 *   POST   /cancel/:requestId        — initiator OR
 *                                      platform:tenant_teardown_approve
 *   GET    /requests                 — platform:tenant_teardown_preview
 *   GET    /requests/:requestId      — platform:tenant_teardown_preview
 *
 * Audit invariants:
 *   • Every successful action writes a `platform_tenant_teardown_*`
 *     audit row with `targetCompanyId` set, regardless of whether the
 *     downstream service raised or succeeded.
 *   • Every reauth FAILURE on /approve writes a dedicated
 *     `platform_tenant_teardown_approve_reauth_failed` row so brute-
 *     force attempts on the approval surface are visible.
 *
 * No business logic lives here — every route delegates to
 * `tenantDeletionRequestService`. Audit + capability gating only.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { requireCapability, requireAnyCapability } from "../auth/requireCapability";
import { platformAuditService } from "../services/platformAuditService";
import {
  runPreview,
  createRequest,
  approveRequest,
  cancelRequest,
  listRequestsForCompany,
  getRequest,
  TeardownRequestError,
  PREVIEW_FRESHNESS_MS,
  REQUEST_EXPIRY_MS,
  EXECUTION_DELAY_MS,
  REASON_MIN_LENGTH,
  CONFIRMATION_PHRASE,
} from "../services/tenantDeletionRequestService";
import { verifyPlatformPassword } from "../services/platformTenantTeardownAuth";

const router = Router({ mergeParams: true });

// ── Validation schemas ──────────────────────────────────────────────────────

const companyIdParamSchema = z.object({
  companyId: z.string().min(1, "companyId required"),
});

const requestIdParamSchema = z.object({
  companyId: z.string().min(1, "companyId required"),
  requestId: z.string().uuid("requestId must be a UUID"),
});

const createRequestBodySchema = z.object({
  previewHash: z.string().regex(/^[a-f0-9]{64}$/i, "previewHash must be hex SHA-256"),
  previewGeneratedAt: z.string().min(1),
  // Trust the service's deeper structural validation — schema only checks
  // the shape is roughly an object so the JSON parse didn't hand us a
  // null/array/string here.
  previewPayload: z.record(z.string(), z.any()),
  reason: z.string().min(1),
  confirmations: z.object({
    tenantName: z.string().min(1),
    tenantId: z.string().min(1),
    phrase: z.string().min(1),
  }),
});

const approveBodySchema = z.object({
  password: z.string().min(1, "Password is required to approve"),
});

const cancelBodySchema = z.object({
  // Optional free-text reason; no length floor — cancellation is the
  // safety valve, we don't gate it on a reason essay.
  reason: z.string().max(500).optional(),
});

// ── Helpers ─────────────────────────────────────────────────────────────────

interface PlatformActor {
  id: string;
  email: string;
  capabilities: readonly string[];
}

function getPlatformActor(req: Request): PlatformActor {
  const u = (req as any).platformUser as
    | { id?: string; email?: string; capabilities?: readonly string[] }
    | undefined;
  if (!u?.id) throw createError(401, "Not authenticated");
  return {
    id: u.id,
    email: u.email ?? "unknown",
    capabilities: u.capabilities ?? [],
  };
}

function clientIp(req: Request): string | null {
  const xff = (req.headers["x-forwarded-for"] as string | undefined)?.split(
    ",",
  )[0]?.trim();
  return xff || req.ip || null;
}

/** Map a TeardownRequestError onto an HTTP error consistently. */
function mapTeardownError(e: unknown): never {
  if (e instanceof TeardownRequestError) {
    throw createError(e.status, e.message, e.code);
  }
  throw e;
}

// ── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /api/platform/tenants/:companyId/teardown/preview
 *
 * Read-only feasibility check. Runs `tenantTeardownService` with
 * dryRun=true and returns the inventory + canonical preview hash. The
 * caller submits the same hash + payload back on POST /request.
 */
router.get(
  "/preview",
  requireCapability("platform:tenant_teardown_preview"),
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = validateSchema(companyIdParamSchema, req.params);
    const actor = getPlatformActor(req);

    let preview;
    try {
      preview = await runPreview({ companyId });
    } catch (e) {
      mapTeardownError(e);
    }

    await platformAuditService
      .log({
        platformAdminId: actor.id,
        platformAdminEmail: actor.email,
        action: "platform_tenant_teardown_preview",
        targetCompanyId: companyId,
        req,
        details: {
          previewHash: preview.previewHash,
          totalFkRows: preview.hashable.totalFkRows,
          r2Enabled: preview.hashable.r2.enabled,
          r2ObjectCount: preview.hashable.r2.objectCount,
        },
      })
      .catch((err) => {
        console.error("[platformTenantTeardown] preview audit failed:", err);
      });

    res.json({
      companyId: preview.companyId,
      company: preview.company,
      inventory: preview.inventory,
      hashable: preview.hashable,
      previewHash: preview.previewHash,
      generatedAt: preview.generatedAt,
      providerRetentions: preview.providerRetentions,
      // Surface tunables so the UI can show the real freshness window
      // and the typed-confirmation phrase without hardcoding them.
      policy: {
        previewFreshnessMs: PREVIEW_FRESHNESS_MS,
        requestExpiryMs: REQUEST_EXPIRY_MS,
        executionDelayMs: EXECUTION_DELAY_MS,
        reasonMinLength: REASON_MIN_LENGTH,
        confirmationPhrase: CONFIRMATION_PHRASE,
      },
    });
  }),
);

/**
 * POST /api/platform/tenants/:companyId/teardown/request
 *
 * Phase 2: persist a `pending` deletion request. Service validates
 * the preview hash + freshness, typed confirmations, reason length,
 * and the no-active-request rate limit.
 */
router.post(
  "/request",
  requireCapability("platform:tenant_teardown_request"),
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = validateSchema(companyIdParamSchema, req.params);
    const body = validateSchema(createRequestBodySchema, req.body);
    const actor = getPlatformActor(req);

    let created;
    try {
      created = await createRequest({
        companyId,
        previewHash: body.previewHash,
        previewGeneratedAt: body.previewGeneratedAt,
        previewPayload: body.previewPayload as any,
        reason: body.reason,
        confirmations: body.confirmations,
        initiator: { id: actor.id, email: actor.email },
        ip: clientIp(req),
        userAgent: req.headers["user-agent"] ?? null,
      });
    } catch (e) {
      // Audit even the failure path — failed requests are a security
      // signal (someone tried to craft a teardown that the service
      // rejected). Best-effort write; never block the error response.
      const code =
        e instanceof TeardownRequestError ? e.code : "UNCAUGHT_EXCEPTION";
      const message = e instanceof Error ? e.message : String(e);
      platformAuditService
        .log({
          platformAdminId: actor.id,
          platformAdminEmail: actor.email,
          action: "platform_tenant_teardown_request_failed",
          targetCompanyId: companyId,
          req,
          details: { code, message },
        })
        .catch((err) => {
          console.error(
            "[platformTenantTeardown] request_failed audit failed:",
            err,
          );
        });
      mapTeardownError(e);
    }

    await platformAuditService
      .log({
        platformAdminId: actor.id,
        platformAdminEmail: actor.email,
        action: "platform_tenant_teardown_request_created",
        targetCompanyId: companyId,
        reason: created.reason,
        req,
        details: {
          requestId: created.id,
          previewHash: created.previewHash,
          companyNameSnapshot: created.companyNameSnapshot,
          expiresAt: created.expiresAt.toISOString(),
        },
      })
      .catch((err) => {
        console.error(
          "[platformTenantTeardown] request_created audit failed:",
          err,
        );
      });

    res.status(201).json({ request: created });
  }),
);

/**
 * POST /api/platform/tenants/:companyId/teardown/approve/:requestId
 *
 * Phase 3: approval. Caller must:
 *   • hold `platform:tenant_teardown_approve` (super admin only)
 *   • supply the password belonging to their CURRENT platform session
 *   • not be the initiator (separation of duties; service-enforced)
 *
 * On success, the service transitions the row to `approved` and
 * sets `executionScheduledAt = now + EXECUTION_DELAY_MS` — that's the
 * intervention window during which a cancel can still rescue it.
 */
router.post(
  "/approve/:requestId",
  requireCapability("platform:tenant_teardown_approve"),
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId, requestId } = validateSchema(
      requestIdParamSchema,
      req.params,
    );
    const { password } = validateSchema(approveBodySchema, req.body);
    const actor = getPlatformActor(req);

    // Belt-and-braces: confirm the request actually belongs to this
    // tenant — prevents a confused-deputy attack where an attacker
    // gives us /tenants/A/teardown/approve/<requestForB>.
    const existing = await getRequest(requestId);
    if (!existing || existing.companyId !== companyId) {
      throw createError(404, "Deletion request not found", "REQUEST_NOT_FOUND");
    }

    // Re-auth gate. Failure leaves a dedicated audit row so brute-force
    // attempts on a compromised approver session are visible.
    const reauth = await verifyPlatformPassword({
      userId: actor.id,
      email: actor.email,
      password,
    });
    if (!reauth.ok) {
      platformAuditService
        .log({
          platformAdminId: actor.id,
          platformAdminEmail: actor.email,
          action: "platform_tenant_teardown_approve_reauth_failed",
          targetCompanyId: companyId,
          req,
          details: { requestId, code: reauth.code },
        })
        .catch((err) => {
          console.error(
            "[platformTenantTeardown] reauth_failed audit failed:",
            err,
          );
        });
      if (reauth.code === "ACCOUNT_DISABLED") {
        throw createError(403, "Account is disabled", "ACCOUNT_DISABLED");
      }
      throw createError(401, "Invalid password", "INVALID_PASSWORD");
    }

    let updated;
    try {
      updated = await approveRequest({
        requestId,
        approver: { id: actor.id, email: actor.email },
      });
    } catch (e) {
      mapTeardownError(e);
    }

    await platformAuditService
      .log({
        platformAdminId: actor.id,
        platformAdminEmail: actor.email,
        action: "platform_tenant_teardown_approved",
        targetCompanyId: companyId,
        req,
        details: {
          requestId: updated.id,
          previewHash: updated.previewHash,
          executionScheduledAt:
            updated.executionScheduledAt?.toISOString() ?? null,
          initiatedByEmail: updated.initiatedByEmail,
        },
      })
      .catch((err) => {
        console.error("[platformTenantTeardown] approved audit failed:", err);
      });

    res.json({ request: updated });
  }),
);

/**
 * POST /api/platform/tenants/:companyId/teardown/cancel/:requestId
 *
 * Cancel a pending or approved request. Callers allowed:
 *   • the original initiator (regardless of role drift since)
 *   • anyone holding `platform:tenant_teardown_approve`
 *
 * Cancelling an `executing` row is rejected at the service layer —
 * the worker is mid-flight and the only safe move is to let it
 * finish (or fail) and audit the outcome.
 */
router.post(
  "/cancel/:requestId",
  // Capability gate: any user who could PREVIEW can attempt to cancel.
  // The service layer enforces "must be initiator OR super admin".
  requireAnyCapability(
    "platform:tenant_teardown_preview",
    "platform:tenant_teardown_approve",
  ),
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId, requestId } = validateSchema(
      requestIdParamSchema,
      req.params,
    );
    const body = validateSchema(cancelBodySchema, req.body ?? {});
    const actor = getPlatformActor(req);

    const existing = await getRequest(requestId);
    if (!existing || existing.companyId !== companyId) {
      throw createError(404, "Deletion request not found", "REQUEST_NOT_FOUND");
    }

    let cancelled;
    try {
      cancelled = await cancelRequest({
        requestId,
        actor: {
          id: actor.id,
          email: actor.email,
          capabilities: actor.capabilities,
        },
      });
    } catch (e) {
      mapTeardownError(e);
    }

    await platformAuditService
      .log({
        platformAdminId: actor.id,
        platformAdminEmail: actor.email,
        action: "platform_tenant_teardown_cancelled",
        targetCompanyId: companyId,
        reason: body.reason,
        req,
        details: {
          requestId: cancelled.id,
          previousStatus: existing.status,
          initiatedByEmail: cancelled.initiatedByEmail,
        },
      })
      .catch((err) => {
        console.error("[platformTenantTeardown] cancelled audit failed:", err);
      });

    res.json({ request: cancelled });
  }),
);

/**
 * GET /api/platform/tenants/:companyId/teardown/requests
 *
 * History list (newest first). Terminal rows never disappear — this is
 * the audit / forensic surface for "show me every teardown attempt
 * against this tenant".
 */
router.get(
  "/requests",
  requireCapability("platform:tenant_teardown_preview"),
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = validateSchema(companyIdParamSchema, req.params);
    const requests = await listRequestsForCompany(companyId);
    res.json({ requests });
  }),
);

/**
 * GET /api/platform/tenants/:companyId/teardown/requests/:requestId
 *
 * Single-request status read — used by the UI to poll while a row is
 * pending/approved/executing.
 */
router.get(
  "/requests/:requestId",
  requireCapability("platform:tenant_teardown_preview"),
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId, requestId } = validateSchema(
      requestIdParamSchema,
      req.params,
    );
    const request = await getRequest(requestId);
    if (!request || request.companyId !== companyId) {
      throw createError(404, "Deletion request not found", "REQUEST_NOT_FOUND");
    }
    res.json({ request });
  }),
);

export default router;
