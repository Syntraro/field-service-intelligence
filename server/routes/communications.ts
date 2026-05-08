/**
 * Communications — cross-entity read endpoints (Phase 15, 2026-04-12).
 *
 * Originally exposed delivery history for invoices / quotes / jobs.
 * 2026-05-07 (Communications Hub Phase 2): adds the contact-resolution
 * endpoint that backs the right Details panel — see the
 * `/resolve-contact` handler below.
 */

import { Router } from "express";
import type { Response } from "express";
import { z } from "zod";
import { requireRole } from "../auth/requireRole";
import { RESTRICTED_MANAGER_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";
import { emailDeliveryTrackingService } from "../services/emailDeliveryTrackingService";
import { communicationTemplateEntityTypeEnum } from "@shared/schema";
// 2026-05-07 Phase 2: contact resolution service for the Communications Hub.
import { resolveContactByPhone } from "../services/communications/contactResolution";
// 2026-05-07 Phase 3: durable threads / messages / calls read service.
// 2026-05-07 Phase 4: write paths + manual linking + candidate search.
// 2026-05-07 Phase 4B: list endpoints for the Contacts + Team Chat modules.
// 2026-05-07 Phase 4E: rich contact-detail projection for the right panel.
import {
  CommunicationsWriteError,
  createInternalMessage,
  getCommunicationThread,
  getContactDetail,
  linkThreadToContact,
  listCommunicationCalls,
  listCommunicationMessages,
  listCommunicationThreads,
  listSystemContacts,
  listTeamMembers,
  markThreadRead,
  searchContactCandidates,
  type LinkContactTarget,
} from "../services/communications/threadService";

const router = Router();

const listQuerySchema = z.object({
  entityType: z.enum(communicationTemplateEntityTypeEnum),
  entityId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/**
 * GET /api/communications/deliveries?entityType=...&entityId=...
 * Returns delivery history for a given entity (newest first).
 */
router.get(
  "/deliveries",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const tenantId = req.companyId;
    if (!tenantId) throw createError(401, "Unauthorized");
    const { entityType, entityId, limit } = validateSchema(listQuerySchema, req.query);
    const deliveries = await emailDeliveryTrackingService.getEntityDeliveries({
      tenantId,
      entityType,
      entityId,
      limit,
    });
    res.json(deliveries);
  }),
);

/**
 * POST /api/communications/deliveries/:deliveryId/resend
 * Phase 17 — one-time resend for a failed/bounced delivery. Creates a
 * NEW delivery row, links it to the original via retried_from_delivery_id,
 * and increments the original's resend_count. Policy enforced in
 * `emailDeliveryTrackingService.resendDelivery`.
 */
router.post(
  "/deliveries/:deliveryId/resend",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const tenantId = req.companyId;
    if (!tenantId) throw createError(401, "Unauthorized");
    const result = await emailDeliveryTrackingService.resendDelivery({
      tenantId,
      deliveryId: req.params.deliveryId,
      userId: req.user?.id ?? null,
    });
    res.json(result);
  }),
);

// ============================================================================
// 2026-05-07 — Communications Hub Phase 2: contact resolution
// ============================================================================
//
// GET /api/communications/resolve-contact?phone=...
//
// Tenant-scoped contact lookup over the canonical sources (team users,
// contact_persons, customer_companies, client_locations). The Hub's
// right Details panel calls this when a selected conversation has a
// phone number; future inbound SMS / call webhooks will run the same
// service so an unknown number reaches the same UX path no matter how
// it arrived.
//
// Auth: relies on the global `requireAuth` + `ensureTenantContext`
// middleware mounted in `routes/index.ts`. No `requireRole` gate —
// technicians need this same lookup for the threads they own.
// Cross-tenant safety lives inside the service (every query
// `WHERE company_id = :tenantId`).

const resolveContactQuerySchema = z.object({
  phone: z.string().min(1).max(64),
});

router.get(
  "/resolve-contact",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const tenantId = req.companyId;
    if (!tenantId) {
      // ensureTenantContext guarantees this is set; explicit check so a
      // routing-order regression fails loud instead of silently running
      // a query without a tenant filter.
      throw createError(401, "Missing tenant context");
    }
    const { phone } = validateSchema(resolveContactQuerySchema, req.query);
    const result = await resolveContactByPhone({ tenantId, phone });
    res.json(result);
  }),
);

// ============================================================================
// 2026-05-07 — Communications Hub Phase 3: durable threads / messages / calls
// ============================================================================
//
// READ-only endpoints over the canonical `communication_threads`,
// `communication_messages`, `communication_calls` tables. Visibility is
// enforced server-side via `shared/communicationsAccess.canViewThread`
// — the same predicate the page-level filter runs on the client side.
//
//   GET /api/communications/threads
//   GET /api/communications/threads/:threadId
//   GET /api/communications/threads/:threadId/messages
//   GET /api/communications/calls
//
// Auth: rides on the global `requireAuth` + `ensureTenantContext`. No
// `requireRole` gate — technicians need this for the threads they own.

function requireTenantViewer(req: AuthedRequest) {
  const tenantId = req.companyId;
  if (!tenantId) throw createError(401, "Missing tenant context");
  const userId = req.user?.id ?? null;
  const role = req.user?.role ?? null;
  return { tenantId, viewer: { userId, role } };
}

const listThreadsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

router.get(
  "/threads",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { tenantId, viewer } = requireTenantViewer(req);
    const { limit } = validateSchema(listThreadsQuerySchema, req.query);
    const items = await listCommunicationThreads({ tenantId, viewer, limit });
    res.json({ items });
  }),
);

router.get(
  "/threads/:threadId",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { tenantId, viewer } = requireTenantViewer(req);
    const thread = await getCommunicationThread({
      tenantId,
      viewer,
      threadId: req.params.threadId,
    });
    if (!thread) throw createError(404, "Conversation not found");
    res.json(thread);
  }),
);

const listMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

router.get(
  "/threads/:threadId/messages",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { tenantId, viewer } = requireTenantViewer(req);
    const { limit } = validateSchema(listMessagesQuerySchema, req.query);
    // The service returns [] when the viewer can't see the thread;
    // surface that as 404 so the API contract for "forbidden thread"
    // matches the GET-by-id endpoint.
    const parent = await getCommunicationThread({
      tenantId,
      viewer,
      threadId: req.params.threadId,
    });
    if (!parent) throw createError(404, "Conversation not found");
    const items = await listCommunicationMessages({
      tenantId,
      viewer,
      threadId: req.params.threadId,
      limit,
    });
    res.json({ items });
  }),
);

const listCallsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

router.get(
  "/calls",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { tenantId, viewer } = requireTenantViewer(req);
    const { limit } = validateSchema(listCallsQuerySchema, req.query);
    const items = await listCommunicationCalls({ tenantId, viewer, limit });
    res.json({ items });
  }),
);

// ============================================================================
// 2026-05-07 — Communications Hub Phase 4: write paths + manual linking
// ============================================================================
//
//   POST /threads/:threadId/messages/internal
//   POST /threads/:threadId/read
//   POST /threads/:threadId/link-contact
//   GET  /contact-candidates
//
// All inherit the global `requireAuth` + `ensureTenantContext`. Visibility
// is enforced inside the service via `canViewThread`; a forbidden thread
// always returns 404 (never empty 200) so the API contract for "you
// can't see this" matches the Phase 3 read endpoints.
//
// The service throws `CommunicationsWriteError(status, message)` for
// every business-rule failure (404 forbidden / 400 blank body / 403
// linking restriction). We translate those into HTTP responses below.

function rewriteWriteError(err: unknown): never {
  if (err instanceof CommunicationsWriteError) {
    throw createError(err.status, err.message);
  }
  throw err;
}

const internalMessageBodySchema = z.object({
  body: z.string().min(1).max(20_000),
});

router.post(
  "/threads/:threadId/messages/internal",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const tenantId = req.companyId;
    if (!tenantId) throw createError(401, "Missing tenant context");
    const viewer = { userId: req.user?.id ?? null, role: req.user?.role ?? null };
    const { body } = validateSchema(internalMessageBodySchema, req.body);
    try {
      const message = await createInternalMessage({
        tenantId,
        threadId: req.params.threadId,
        viewer,
        body,
      });
      res.status(201).json(message);
    } catch (err) {
      rewriteWriteError(err);
    }
  }),
);

router.post(
  "/threads/:threadId/read",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const tenantId = req.companyId;
    if (!tenantId) throw createError(401, "Missing tenant context");
    const viewer = { userId: req.user?.id ?? null, role: req.user?.role ?? null };
    try {
      const updated = await markThreadRead({
        tenantId,
        threadId: req.params.threadId,
        viewer,
      });
      res.json(updated);
    } catch (err) {
      rewriteWriteError(err);
    }
  }),
);

const linkContactBodySchema = z.object({
  target: z.object({
    kind: z.enum([
      "contact_person",
      "customer_company",
      "client_location",
      "team_user",
    ]),
    id: z.string().min(1),
  }),
});

router.post(
  "/threads/:threadId/link-contact",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const tenantId = req.companyId;
    if (!tenantId) throw createError(401, "Missing tenant context");
    const viewer = { userId: req.user?.id ?? null, role: req.user?.role ?? null };
    const { target } = validateSchema(linkContactBodySchema, req.body);
    try {
      const updated = await linkThreadToContact({
        tenantId,
        threadId: req.params.threadId,
        viewer,
        target: target as LinkContactTarget,
      });
      res.json(updated);
    } catch (err) {
      rewriteWriteError(err);
    }
  }),
);

const contactCandidatesQuerySchema = z.object({
  query: z.string().min(1).max(120),
});

router.get(
  "/contact-candidates",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const tenantId = req.companyId;
    if (!tenantId) throw createError(401, "Missing tenant context");
    const viewer = { userId: req.user?.id ?? null, role: req.user?.role ?? null };
    const { query } = validateSchema(contactCandidatesQuerySchema, req.query);
    const items = await searchContactCandidates({ tenantId, query, viewer });
    res.json({ items });
  }),
);

// ============================================================================
// 2026-05-07 — Communications Hub Phase 4B: Contacts + Team Chat list views
// ============================================================================
//
//   GET /contacts       — left column for the Contacts module (no query;
//                         returns every active contact across the four
//                         canonical sources, role-filtered).
//   GET /team-members   — left column for the Team Chat module (active
//                         tenant users only).
//
// Both inherit the global `requireAuth` + `ensureTenantContext`. No
// `requireRole` gate — visibility for the Team Chat module itself is
// already enforced by `getVisibleCommunicationsModules` on the client
// rail (technicians can call this endpoint, but they never reach a UI
// surface that uses the response).

const listContactsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

router.get(
  "/contacts",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const tenantId = req.companyId;
    if (!tenantId) throw createError(401, "Missing tenant context");
    const viewer = { userId: req.user?.id ?? null, role: req.user?.role ?? null };
    const { limit } = validateSchema(listContactsQuerySchema, req.query);
    const items = await listSystemContacts({ tenantId, viewer, limit });
    res.json({ items });
  }),
);

router.get(
  "/team-members",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const tenantId = req.companyId;
    if (!tenantId) throw createError(401, "Missing tenant context");
    const items = await listTeamMembers({ tenantId });
    res.json({ items });
  }),
);

// ============================================================================
// 2026-05-07 — Communications Hub Phase 4E: contact-detail projection
// ============================================================================
//
//   GET /contacts/:kind/:id
//
// Rich projection for the right Details panel when a contact is selected
// in the Contacts / Team Chat module. Returns 404 when no row matches in
// the tenant — service does the tenant filter itself, so a forbidden /
// cross-tenant probe always lands on the same shape regardless of cause.

const contactDetailKindSchema = z.enum(["contact_person", "team_user"]);

router.get(
  "/contacts/:kind/:id",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const tenantId = req.companyId;
    if (!tenantId) throw createError(401, "Missing tenant context");
    const parsed = contactDetailKindSchema.safeParse(req.params.kind);
    if (!parsed.success) throw createError(400, "Invalid contact kind");
    const detail = await getContactDetail({
      tenantId,
      kind: parsed.data,
      sourceId: req.params.id,
    });
    if (!detail) throw createError(404, "Contact not found");
    res.json(detail);
  }),
);

export default router;
