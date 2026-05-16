/**
 * Receivables routes (Phase 2A — 2026-05-13)
 *
 * Backend-only. No UI wiring in Phase 2A.
 *
 * Mounts at /api/receivables:
 *   GET    /api/receivables/views/counts
 *   GET    /api/receivables/invoices?view=<view>
 *   GET    /api/receivables/notes
 *   POST   /api/receivables/notes
 *   PATCH  /api/receivables/notes/:id
 *   DELETE /api/receivables/notes/:id
 *   PATCH  /api/receivables/invoices/:id/follow-up
 *   PATCH  /api/receivables/invoices/:id/promise-to-pay
 *   PATCH  /api/receivables/invoices/:id/mark-disputed
 */

import { Router, type Response } from "express";
import { z } from "zod";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { AuthedRequest } from "../auth/tenantIsolation";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { receivablesNoteTypeEnum } from "@shared/schema";
import { receivablesNotesRepository, type LogCommunicationInput } from "../storage/receivablesNotes";
import { getInvoicesFeed } from "../storage/invoicesFeed";
import { getQueryCtx } from "../lib/queryCtx";

const router = Router();

// All receivables routes require manager role.
router.use(requireRole(MANAGER_ROLES));

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const createNoteSchema = z
  .object({
    customerCompanyId: z.string().uuid(),
    invoiceId: z.string().uuid().nullable().optional(),
    paymentId: z.string().uuid().nullable().optional(),
    noteType: z.enum(receivablesNoteTypeEnum),
    noteText: z.string().min(1).max(5000),
    promisedAt: z.string().datetime({ offset: true }).nullable().optional(),
    contactMethod: z.string().max(100).nullable().optional(),
  })
  .strict();

const updateNoteSchema = z
  .object({
    noteText: z.string().min(1).max(5000).optional(),
    noteType: z.enum(receivablesNoteTypeEnum).optional(),
    promisedAt: z.string().datetime({ offset: true }).nullable().optional(),
    contactMethod: z.string().max(100).nullable().optional(),
  })
  .strict();

const followUpSchema = z
  .object({
    followUpAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

const promiseToPaySchema = z
  .object({
    promisedAt: z.string().datetime({ offset: true }),
    noteText: z.string().min(1).max(5000),
    contactMethod: z.string().max(100).nullable().optional(),
  })
  .strict();

const markDisputedSchema = z
  .object({
    noteText: z.string().min(1).max(5000),
    contactMethod: z.string().max(100).nullable().optional(),
  })
  .strict();

const COMMUNICATION_OUTCOMES = [
  "spoke_with",
  "left_message",
  "no_answer",
  "email_sent",
  "text_sent",
  "other",
] as const;

const COMMUNICATION_METHODS = [
  "phone_call",
  "email",
  "text_message",
  "in_person",
  "other",
] as const;

const communicateSchema = z
  .object({
    outcome: z.enum(COMMUNICATION_OUTCOMES),
    contactPersonId: z.string().uuid().nullable().optional(),
    contactedName: z.string().max(200).nullable().optional(),
    method: z.enum(COMMUNICATION_METHODS).optional(),
    communicatedAt: z.string().datetime({ offset: true }),
    notes: z.string().max(500).optional(),
    promiseToPay: z
      .object({
        enabled: z.boolean(),
        promisedAt: z.string().datetime({ offset: true }).optional(),
      })
      .optional(),
    followUp: z
      .object({
        enabled: z.boolean(),
        followUpAt: z.string().datetime({ offset: true }).optional(),
      })
      .optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.promiseToPay?.enabled && !val.promiseToPay.promisedAt) {
      ctx.addIssue({
        code: "custom",
        path: ["promiseToPay", "promisedAt"],
        message: "promisedAt is required when promiseToPay.enabled is true",
      });
    }
    if (val.followUp?.enabled && !val.followUp.followUpAt) {
      ctx.addIssue({
        code: "custom",
        path: ["followUp", "followUpAt"],
        message: "followUpAt is required when followUp.enabled is true",
      });
    }
  });

// ============================================================================
// VIEW COUNTS
// ============================================================================

const HIGH_BALANCE_THRESHOLD_DEFAULT = "1000.00";
const NO_RECENT_CONTACT_DAYS = 30;
const SENT_THIS_WEEK_DAYS = 7;

/**
 * GET /api/receivables/views/counts
 *
 * Returns badge counts for all Receivables left-rail views.
 * Query param: threshold (optional, default 1000) for highBalance view.
 * Every count is scoped to the authenticated company.
 */
router.get(
  "/views/counts",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.user!.companyId;
    const threshold = (req.query.threshold as string) ?? HIGH_BALANCE_THRESHOLD_DEFAULT;

    const thresholdNum = parseFloat(threshold);
    if (isNaN(thresholdNum) || thresholdNum < 0) {
      throw createError(400, "threshold must be a non-negative number");
    }

    // Single compound query — all counts in one round-trip using conditional
    // aggregation. Each view is a FILTER clause so the planner can share the
    // same table scan across all views.
    const result = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (
          WHERE company_id = ${companyId}
          AND status != 'voided'
        )::int AS "all",

        COUNT(*) FILTER (
          WHERE company_id = ${companyId}
          AND status NOT IN ('draft', 'paid', 'voided')
          AND balance > 0
          AND due_date < CURRENT_DATE
        )::int AS "overdue",

        COUNT(*) FILTER (
          WHERE company_id = ${companyId}
          AND status IN ('awaiting_payment', 'sent', 'partial_paid')
          AND balance > 0
        )::int AS "awaitingPayment",

        COUNT(*) FILTER (
          WHERE company_id = ${companyId}
          AND status = 'draft'
        )::int AS "drafts",

        COUNT(*) FILTER (
          WHERE company_id = ${companyId}
          AND status = 'paid'
        )::int AS "paid",

        COUNT(*) FILTER (
          WHERE company_id = ${companyId}
          AND follow_up_at <= NOW()
          AND status NOT IN ('draft', 'paid', 'voided')
        )::int AS "needsFollowUp",

        COUNT(*) FILTER (
          WHERE company_id = ${companyId}
          AND sent_at >= NOW() - (${SENT_THIS_WEEK_DAYS} || ' days')::interval
        )::int AS "sentThisWeek",

        COUNT(*) FILTER (
          WHERE company_id = ${companyId}
          AND balance > 0
          AND status NOT IN ('draft', 'paid', 'voided')
          AND (
            COALESCE(last_contacted_at, last_emailed_at) IS NULL
            OR COALESCE(last_contacted_at, last_emailed_at) < NOW() - (${NO_RECENT_CONTACT_DAYS} || ' days')::interval
          )
        )::int AS "noRecentContact",

        COUNT(*) FILTER (
          WHERE company_id = ${companyId}
          AND balance >= ${thresholdNum.toFixed(2)}::numeric
          AND status NOT IN ('draft', 'paid', 'voided')
        )::int AS "highBalance",

        COUNT(*) FILTER (
          WHERE company_id = ${companyId}
          AND is_disputed = true
          AND status NOT IN ('paid', 'voided')
        )::int AS "disputed",

        COUNT(*) FILTER (
          WHERE company_id = ${companyId}
          AND promised_payment_at IS NOT NULL
          AND balance > 0
          AND status NOT IN ('paid', 'voided')
        )::int AS "promisedPayment"

      FROM invoices
      WHERE company_id = ${companyId}
    `);

    res.json(result.rows[0]);
  }),
);

// ============================================================================
// RECEIVABLES INVOICE LIST (optional Phase 2A view-based list)
// ============================================================================

// Valid view values that map to backend predicates.
const RECEIVABLES_VIEWS = [
  "all",
  "overdue",
  "awaiting-payment",
  "drafts",
  "paid",
  "needs-follow-up",
  "sent-this-week",
  "no-recent-contact",
  "high-balance",
  "disputed",
  "promised-payment",
] as const;
type ReceivablesView = (typeof RECEIVABLES_VIEWS)[number];

/**
 * GET /api/receivables/invoices?view=<view>&threshold=<n>&offset=<n>&limit=<n>
 *
 * Returns the same shape as GET /api/invoices/list (InvoicesFeed row shape).
 * All view predicates are applied as SQL inside getInvoicesFeed before
 * limit/offset — no JS post-filtering, no over-fetch.
 *
 * View-predicate semantics are defined in InvoiceFeedFilters (invoicesFeed.ts)
 * and mirror the FILTER clauses in GET /views/counts.
 */
router.get(
  "/invoices",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const view = (req.query.view as string) ?? "all";
    if (!RECEIVABLES_VIEWS.includes(view as ReceivablesView)) {
      throw createError(400, `Unknown view: ${view}. Valid values: ${RECEIVABLES_VIEWS.join(", ")}`);
    }

    const limit = Math.min(parseInt((req.query.limit as string) ?? "200", 10), 200);
    const offset = parseInt((req.query.offset as string) ?? "0", 10);
    const threshold = parseFloat((req.query.threshold as string) ?? HIGH_BALANCE_THRESHOLD_DEFAULT);

    const ctx = getQueryCtx(req as any);

    let feedFilters: Parameters<typeof getInvoicesFeed>[1] = {};

    switch (view as ReceivablesView) {
      case "all":
        feedFilters = { excludeStatuses: ["voided"] };
        break;

      case "overdue":
        feedFilters = { overdue: true };
        break;

      case "awaiting-payment":
        feedFilters = { statuses: ["awaiting_payment", "sent", "partial_paid"], unpaidOnly: true };
        break;

      case "drafts":
        feedFilters = { statuses: ["draft"] };
        break;

      case "paid":
        feedFilters = { statuses: ["paid"] };
        break;

      case "needs-follow-up":
        feedFilters = { followUpDue: true };
        break;

      case "sent-this-week":
        feedFilters = { sentSince: new Date(Date.now() - SENT_THIS_WEEK_DAYS * 86_400_000) };
        break;

      case "no-recent-contact":
        feedFilters = { noContactBefore: new Date(Date.now() - NO_RECENT_CONTACT_DAYS * 86_400_000) };
        break;

      case "high-balance":
        feedFilters = { minBalance: threshold.toFixed(2) };
        break;

      case "disputed":
        feedFilters = { disputedOnly: true };
        break;

      case "promised-payment":
        feedFilters = { promisedPaymentOnly: true };
        break;
    }

    const feedResult = await getInvoicesFeed(ctx, { ...feedFilters, limit, offset });

    res.json({
      data: feedResult.items,
      meta: {
        view,
        limit,
        offset,
        returned: feedResult.items.length,
      },
    });
  }),
);

// ============================================================================
// RECEIVABLES NOTES CRUD
// ============================================================================

/**
 * GET /api/receivables/notes
 * Query params: customerCompanyId, invoiceId, paymentId, noteType, limit
 */
router.get(
  "/notes",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.user!.companyId;
    const { customerCompanyId, invoiceId, paymentId, limit } = req.query as Record<string, string>;

    if (!customerCompanyId && !invoiceId && !paymentId) {
      throw createError(400, "Provide at least one of: customerCompanyId, invoiceId, paymentId");
    }

    // Validate noteType query param before passing to repository.
    const noteTypeRaw = req.query.noteType as string | undefined;
    let noteType: (typeof receivablesNoteTypeEnum)[number] | undefined;
    if (noteTypeRaw !== undefined) {
      const noteTypeResult = z.enum(receivablesNoteTypeEnum).safeParse(noteTypeRaw);
      if (!noteTypeResult.success) {
        throw createError(
          400,
          `Invalid noteType: "${noteTypeRaw}". Valid values: ${receivablesNoteTypeEnum.join(", ")}`,
        );
      }
      noteType = noteTypeResult.data;
    }

    const notes = await receivablesNotesRepository.listReceivablesNotes(companyId, {
      customerCompanyId,
      invoiceId,
      paymentId,
      noteType,
      limit: limit ? parseInt(limit, 10) : undefined,
    });

    res.json(notes);
  }),
);

/**
 * POST /api/receivables/notes
 */
router.post(
  "/notes",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.user!.companyId;
    const userId = req.user!.id;

    const parsed = createNoteSchema.safeParse(req.body);
    if (!parsed.success) {
      throw createError(400, parsed.error.issues[0]?.message ?? "Invalid input");
    }

    const note = await receivablesNotesRepository.createReceivablesNote(
      companyId,
      userId,
      parsed.data as any,
    );

    res.status(201).json(note);
  }),
);

/**
 * PATCH /api/receivables/notes/:id
 */
router.patch(
  "/notes/:id",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.user!.companyId;
    const userId = req.user!.id;
    const noteId = req.params.id;
    const isManager = MANAGER_ROLES.includes(req.user!.role as any);

    const parsed = updateNoteSchema.safeParse(req.body);
    if (!parsed.success) {
      throw createError(400, parsed.error.issues[0]?.message ?? "Invalid input");
    }

    const updated = await receivablesNotesRepository.updateReceivablesNote(
      companyId,
      noteId,
      userId,
      parsed.data,
      { isManager },
    );

    res.json(updated);
  }),
);

/**
 * DELETE /api/receivables/notes/:id
 */
router.delete(
  "/notes/:id",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.user!.companyId;
    const userId = req.user!.id;
    const noteId = req.params.id;
    const isManager = MANAGER_ROLES.includes(req.user!.role as any);

    const result = await receivablesNotesRepository.deleteReceivablesNote(
      companyId,
      noteId,
      userId,
      { isManager },
    );

    res.json(result);
  }),
);

// ============================================================================
// INVOICE WORKFLOW ACTIONS
// ============================================================================

/**
 * PATCH /api/receivables/invoices/:id/follow-up
 * Body: { followUpAt: ISO timestamp | null }
 * Sets or clears the follow-up timestamp. Does not create a note.
 */
router.patch(
  "/invoices/:id/follow-up",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.user!.companyId;
    const invoiceId = req.params.id;

    const parsed = followUpSchema.safeParse(req.body);
    if (!parsed.success) {
      throw createError(400, parsed.error.issues[0]?.message ?? "Invalid input");
    }

    const updated = await receivablesNotesRepository.setInvoiceFollowUp(
      companyId,
      invoiceId,
      parsed.data.followUpAt,
    );

    res.json(updated);
  }),
);

/**
 * PATCH /api/receivables/invoices/:id/promise-to-pay
 * Body: { promisedAt, noteText, contactMethod? }
 * Creates a promise_to_pay note + sets invoices.promised_payment_at atomically.
 */
router.patch(
  "/invoices/:id/promise-to-pay",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.user!.companyId;
    const userId = req.user!.id;
    const invoiceId = req.params.id;

    const parsed = promiseToPaySchema.safeParse(req.body);
    if (!parsed.success) {
      throw createError(400, parsed.error.issues[0]?.message ?? "Invalid input");
    }

    const note = await receivablesNotesRepository.promiseToPay(
      companyId,
      invoiceId,
      userId,
      parsed.data,
    );

    res.status(201).json(note);
  }),
);

/**
 * PATCH /api/receivables/invoices/:id/mark-disputed
 * Body: { noteText, contactMethod? }
 * Creates a dispute note + sets invoices.is_disputed = true atomically.
 */
router.patch(
  "/invoices/:id/mark-disputed",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.user!.companyId;
    const userId = req.user!.id;
    const invoiceId = req.params.id;

    const parsed = markDisputedSchema.safeParse(req.body);
    if (!parsed.success) {
      throw createError(400, parsed.error.issues[0]?.message ?? "Invalid input");
    }

    const note = await receivablesNotesRepository.markDisputed(
      companyId,
      invoiceId,
      userId,
      parsed.data,
    );

    res.status(201).json(note);
  }),
);

/**
 * POST /api/receivables/invoices/:id/communicate
 * Body: LogCommunicationInput schema.
 *
 * Single-transaction endpoint for the Contact Client modal:
 *   - Creates a "communication" receivables note.
 *   - Sets invoices.last_contacted_at.
 *   - Optionally sets invoices.follow_up_at.
 *   - Optionally creates a promise_to_pay note + sets invoices.promised_payment_at.
 */
router.post(
  "/invoices/:id/communicate",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.user!.companyId;
    const userId = req.user!.id;
    const invoiceId = req.params.id;

    const parsed = communicateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw createError(400, parsed.error.issues[0]?.message ?? "Invalid input");
    }

    const input: LogCommunicationInput = {
      outcome: parsed.data.outcome,
      contactPersonId: parsed.data.contactPersonId ?? null,
      contactedName: parsed.data.contactedName ?? null,
      method: parsed.data.method ?? null,
      communicatedAt: parsed.data.communicatedAt,
      notes: parsed.data.notes,
      promiseToPay: parsed.data.promiseToPay,
      followUp: parsed.data.followUp,
    };

    const note = await receivablesNotesRepository.logCommunication(
      companyId,
      invoiceId,
      userId,
      input,
    );

    res.status(201).json(note);
  }),
);

export default router;
