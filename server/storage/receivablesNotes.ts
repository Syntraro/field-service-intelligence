import { db } from "../db";
import { and, eq, desc, isNotNull } from "drizzle-orm";
import {
  receivablesNotes,
  invoices,
  payments,
  customerCompanies,
  users,
  receivablesNoteTypeEnum,
  type ReceivablesNoteType,
} from "@shared/schema";
import { BaseRepository, clampLimit } from "./base";

// ============================================================================
// RECEIVABLES NOTES REPOSITORY (2026-05-13 Phase 2A)
// ============================================================================
//
// Customer/account-scoped collections activity log.
//
// Invariants enforced here (not at route layer):
//   1. companyId and userId always come from session context — never client body.
//   2. customerCompanyId must belong to companyId.
//   3. invoiceId (when provided) must belong to companyId and to the same
//      customerCompanyId when invoice.customerCompanyId is set.
//   4. paymentId (when provided) must belong to companyId.
//   5. promise_to_pay requires promisedAt.
//   6. Creating a promise_to_pay note with invoiceId updates
//      invoices.promised_payment_at in the same transaction.
//   7. Creating a dispute note with invoiceId sets invoices.is_disputed = true
//      in the same transaction.
//   8. Deleting a note does NOT automatically clear invoice workflow flags.

export interface ListReceivablesNotesFilters {
  customerCompanyId?: string;
  invoiceId?: string;
  paymentId?: string;
  noteType?: ReceivablesNoteType;
  limit?: number;
}

export interface CreateReceivablesNoteInput {
  customerCompanyId: string;
  invoiceId?: string | null;
  paymentId?: string | null;
  noteType: ReceivablesNoteType;
  noteText: string;
  promisedAt?: string | null;
  contactMethod?: string | null;
  outcome?: string | null;
  contactPersonId?: string | null;
  communicatedAt?: string | null;
  createdBySystem?: boolean;
}

export interface LogCommunicationInput {
  outcome: string;
  contactPersonId?: string | null;
  contactedName?: string | null;
  method?: string | null;
  communicatedAt: string;
  notes?: string;
  promiseToPay?: {
    enabled: boolean;
    promisedAt?: string;
  };
  followUp?: {
    enabled: boolean;
    followUpAt?: string;
  };
}

export interface UpdateReceivablesNoteInput {
  noteText?: string;
  noteType?: ReceivablesNoteType;
  promisedAt?: string | null;
  contactMethod?: string | null;
  outcome?: string | null;
  contactPersonId?: string | null;
  communicatedAt?: string | null;
}

export class ReceivablesNotesRepository extends BaseRepository {
  /**
   * List receivables notes for a company, optionally filtered by
   * customerCompanyId, invoiceId, paymentId, or noteType.
   * Returns newest-first.
   */
  async listReceivablesNotes(
    companyId: string,
    filters: ListReceivablesNotesFilters = {},
  ) {
    this.assertCompanyId(companyId);
    const safeLimit = clampLimit(filters.limit ?? 100, 500);

    const predicates = [eq(receivablesNotes.companyId, companyId)];

    if (filters.customerCompanyId) {
      this.validateUUID(filters.customerCompanyId, "customerCompanyId");
      predicates.push(eq(receivablesNotes.customerCompanyId, filters.customerCompanyId));
    }
    if (filters.invoiceId) {
      this.validateUUID(filters.invoiceId, "invoiceId");
      predicates.push(eq(receivablesNotes.invoiceId, filters.invoiceId));
    }
    if (filters.paymentId) {
      this.validateUUID(filters.paymentId, "paymentId");
      predicates.push(eq(receivablesNotes.paymentId, filters.paymentId));
    }
    if (filters.noteType) {
      predicates.push(eq(receivablesNotes.noteType, filters.noteType));
    }

    const rows = await db
      .select({
        id: receivablesNotes.id,
        companyId: receivablesNotes.companyId,
        customerCompanyId: receivablesNotes.customerCompanyId,
        invoiceId: receivablesNotes.invoiceId,
        paymentId: receivablesNotes.paymentId,
        noteType: receivablesNotes.noteType,
        noteText: receivablesNotes.noteText,
        promisedAt: receivablesNotes.promisedAt,
        contactMethod: receivablesNotes.contactMethod,
        outcome: receivablesNotes.outcome,
        contactPersonId: receivablesNotes.contactPersonId,
        communicatedAt: receivablesNotes.communicatedAt,
        createdBySystem: receivablesNotes.createdBySystem,
        createdAt: receivablesNotes.createdAt,
        updatedAt: receivablesNotes.updatedAt,
        user: {
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(receivablesNotes)
      .leftJoin(users, eq(receivablesNotes.userId, users.id))
      .where(and(...predicates))
      .orderBy(desc(receivablesNotes.createdAt))
      .limit(safeLimit);

    return rows;
  }

  /**
   * Create a receivables note.
   *
   * Atomic side effects (same DB transaction):
   *   - note_type = "promise_to_pay" + invoiceId → sets invoices.promised_payment_at
   *   - note_type = "dispute" + invoiceId        → sets invoices.is_disputed = true
   */
  async createReceivablesNote(
    companyId: string,
    userId: string | null,
    input: CreateReceivablesNoteInput,
  ) {
    this.assertCompanyId(companyId);
    if (userId) this.validateUUID(userId, "userId");
    this.validateUUID(input.customerCompanyId, "customerCompanyId");

    // Validate noteType.
    if (!(receivablesNoteTypeEnum as readonly string[]).includes(input.noteType)) {
      throw this.validationError(`Invalid noteType: ${input.noteType}`);
    }

    // promise_to_pay requires promisedAt.
    if (input.noteType === "promise_to_pay" && !input.promisedAt) {
      throw this.validationError("promisedAt is required for promise_to_pay notes");
    }

    // Verify customerCompanyId belongs to companyId.
    const [customerCompany] = await db
      .select({ id: customerCompanies.id })
      .from(customerCompanies)
      .where(
        and(
          eq(customerCompanies.id, input.customerCompanyId),
          eq(customerCompanies.companyId, companyId),
        ),
      )
      .limit(1);

    if (!customerCompany) {
      throw this.forbiddenError("Customer company not found or not accessible");
    }

    // Verify invoiceId (if provided) belongs to companyId + matches customerCompanyId.
    if (input.invoiceId) {
      this.validateUUID(input.invoiceId, "invoiceId");
      const [invoice] = await db
        .select({ id: invoices.id, customerCompanyId: invoices.customerCompanyId })
        .from(invoices)
        .where(
          and(
            eq(invoices.id, input.invoiceId),
            eq(invoices.companyId, companyId),
          ),
        )
        .limit(1);

      if (!invoice) {
        throw this.forbiddenError("Invoice not found or not accessible");
      }

      // Cross-company guard: when invoice.customerCompanyId is set it must
      // match the note's customerCompanyId.
      if (
        invoice.customerCompanyId &&
        invoice.customerCompanyId !== input.customerCompanyId
      ) {
        throw this.validationError(
          "Invoice does not belong to the specified customer company",
        );
      }
    }

    // Verify paymentId (if provided) belongs to companyId.
    if (input.paymentId) {
      this.validateUUID(input.paymentId, "paymentId");
      const [payment] = await db
        .select({ id: payments.id })
        .from(payments)
        .where(
          and(
            eq(payments.id, input.paymentId),
            eq(payments.companyId, companyId),
          ),
        )
        .limit(1);

      if (!payment) {
        throw this.forbiddenError("Payment not found or not accessible");
      }
    }

    return db.transaction(async (tx) => {
      const [note] = await tx
        .insert(receivablesNotes)
        .values({
          companyId,
          customerCompanyId: input.customerCompanyId,
          invoiceId: input.invoiceId ?? null,
          paymentId: input.paymentId ?? null,
          userId: userId ?? null,
          noteType: input.noteType,
          noteText: input.noteText,
          promisedAt: input.promisedAt ? new Date(input.promisedAt) : null,
          contactMethod: input.contactMethod ?? null,
          outcome: input.outcome ?? null,
          contactPersonId: input.contactPersonId ?? null,
          communicatedAt: input.communicatedAt ? new Date(input.communicatedAt) : null,
          createdBySystem: input.createdBySystem ?? false,
        })
        .returning();

      // Atomic invoice workflow-field updates.
      if (input.invoiceId) {
        if (input.noteType === "promise_to_pay" && input.promisedAt) {
          await tx
            .update(invoices)
            .set({ promisedPaymentAt: new Date(input.promisedAt), updatedAt: new Date() })
            .where(
              and(eq(invoices.id, input.invoiceId), eq(invoices.companyId, companyId)),
            );
        } else if (input.noteType === "dispute") {
          await tx
            .update(invoices)
            .set({ isDisputed: true, updatedAt: new Date() })
            .where(
              and(eq(invoices.id, input.invoiceId), eq(invoices.companyId, companyId)),
            );
        }
      }

      return note;
    });
  }

  /**
   * Update a receivables note.
   *
   * Rules:
   *   - Manager/admin (isManager=true) may edit any note within the tenant.
   *     All receivables routes are behind MANAGER_ROLES, so isManager is
   *     always true on the route-initiated path — this is intentional product
   *     behavior for operational workflow.
   *   - Non-manager callers are restricted to their own notes (userId match).
   *   - Changing noteType to promise_to_pay requires promisedAt.
   *   - Invoice workflow fields are NOT automatically updated on edit to avoid
   *     conflicting with other notes or direct user actions. Use the dedicated
   *     invoice workflow routes to change followUpAt / promisedPaymentAt / isDisputed.
   *   - createdBy/userId is never overwritten by this method — attribution is preserved.
   */
  async updateReceivablesNote(
    companyId: string,
    noteId: string,
    userId: string,
    input: UpdateReceivablesNoteInput,
    opts: { isManager?: boolean } = {},
  ) {
    this.assertCompanyId(companyId);
    this.validateUUID(noteId, "noteId");
    this.validateUUID(userId, "userId");

    const ownerPredicate = opts.isManager
      ? and(eq(receivablesNotes.id, noteId), eq(receivablesNotes.companyId, companyId))
      : and(
          eq(receivablesNotes.id, noteId),
          eq(receivablesNotes.companyId, companyId),
          eq(receivablesNotes.userId, userId),
        );

    const [existing] = await db
      .select()
      .from(receivablesNotes)
      .where(ownerPredicate)
      .limit(1);

    if (!existing) {
      throw this.notFoundError("Receivables note");
    }

    if (input.noteType) {
      if (!(receivablesNoteTypeEnum as readonly string[]).includes(input.noteType)) {
        throw this.validationError(`Invalid noteType: ${input.noteType}`);
      }
      // If changing to promise_to_pay, require promisedAt.
      const effectivePromisedAt = input.promisedAt !== undefined
        ? input.promisedAt
        : existing.promisedAt?.toISOString() ?? null;
      if (input.noteType === "promise_to_pay" && !effectivePromisedAt) {
        throw this.validationError("promisedAt is required for promise_to_pay notes");
      }
    }

    const setFields: Record<string, any> = { updatedAt: new Date() };
    if (input.noteText !== undefined) setFields.noteText = input.noteText;
    if (input.noteType !== undefined) setFields.noteType = input.noteType;
    if (input.promisedAt !== undefined) {
      setFields.promisedAt = input.promisedAt ? new Date(input.promisedAt) : null;
    }
    if (input.contactMethod !== undefined) setFields.contactMethod = input.contactMethod;
    if (input.outcome !== undefined) setFields.outcome = input.outcome;
    if (input.contactPersonId !== undefined) setFields.contactPersonId = input.contactPersonId;
    if (input.communicatedAt !== undefined) {
      setFields.communicatedAt = input.communicatedAt ? new Date(input.communicatedAt) : null;
    }

    const [updated] = await db
      .update(receivablesNotes)
      .set(setFields)
      .where(and(eq(receivablesNotes.id, noteId), eq(receivablesNotes.companyId, companyId)))
      .returning();

    return updated;
  }

  /**
   * Delete a receivables note.
   *
   * Rules:
   *   - Manager/admin (isManager=true) may delete any note within the tenant.
   *     All receivables routes are behind MANAGER_ROLES, so isManager is
   *     always true on the route-initiated path — this is intentional product
   *     behavior for operational workflow.
   *   - Non-manager callers are restricted to their own notes (userId match).
   *   - Deleting a note does NOT clear invoice workflow flags (isDisputed,
   *     promisedPaymentAt). Those are explicit user actions via dedicated routes.
   */
  async deleteReceivablesNote(
    companyId: string,
    noteId: string,
    userId: string,
    opts: { isManager?: boolean } = {},
  ) {
    this.assertCompanyId(companyId);
    this.validateUUID(noteId, "noteId");
    this.validateUUID(userId, "userId");

    const ownerPredicate = opts.isManager
      ? and(eq(receivablesNotes.id, noteId), eq(receivablesNotes.companyId, companyId))
      : and(
          eq(receivablesNotes.id, noteId),
          eq(receivablesNotes.companyId, companyId),
          eq(receivablesNotes.userId, userId),
        );

    const [existing] = await db
      .select({ id: receivablesNotes.id })
      .from(receivablesNotes)
      .where(ownerPredicate)
      .limit(1);

    if (!existing) {
      throw this.notFoundError("Receivables note");
    }

    await db
      .delete(receivablesNotes)
      .where(and(eq(receivablesNotes.id, noteId), eq(receivablesNotes.companyId, companyId)));

    return { success: true };
  }

  // ==========================================================================
  // INVOICE WORKFLOW ACTIONS
  // ==========================================================================

  /**
   * Set (or clear) the follow-up timestamp on an invoice.
   * Does NOT create a receivables note — follow-up scheduling is not an event.
   */
  async setInvoiceFollowUp(
    companyId: string,
    invoiceId: string,
    followUpAt: string | null,
  ) {
    this.assertCompanyId(companyId);
    this.validateUUID(invoiceId, "invoiceId");

    const [invoice] = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)))
      .limit(1);

    if (!invoice) throw this.notFoundError("Invoice");

    const [updated] = await db
      .update(invoices)
      .set({
        followUpAt: followUpAt ? new Date(followUpAt) : null,
        updatedAt: new Date(),
      })
      .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)))
      .returning({ id: invoices.id, followUpAt: invoices.followUpAt });

    return updated;
  }

  /**
   * Record a promise to pay.
   * Creates a promise_to_pay receivables note and sets invoices.promised_payment_at
   * in the same transaction.
   */
  async promiseToPay(
    companyId: string,
    invoiceId: string,
    userId: string,
    input: { promisedAt: string; noteText: string; contactMethod?: string | null },
  ) {
    this.assertCompanyId(companyId);
    this.validateUUID(invoiceId, "invoiceId");
    this.validateUUID(userId, "userId");

    const [invoice] = await db
      .select({ id: invoices.id, customerCompanyId: invoices.customerCompanyId })
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)))
      .limit(1);

    if (!invoice) throw this.notFoundError("Invoice");
    if (!invoice.customerCompanyId) {
      throw this.validationError(
        "Invoice has no customer company — cannot create receivables note",
      );
    }

    return db.transaction(async (tx) => {
      const [note] = await tx
        .insert(receivablesNotes)
        .values({
          companyId,
          customerCompanyId: invoice.customerCompanyId!,
          invoiceId,
          userId,
          noteType: "promise_to_pay",
          noteText: input.noteText,
          promisedAt: new Date(input.promisedAt),
          contactMethod: input.contactMethod ?? null,
          createdBySystem: false,
        })
        .returning();

      await tx
        .update(invoices)
        .set({ promisedPaymentAt: new Date(input.promisedAt), updatedAt: new Date() })
        .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)));

      return note;
    });
  }

  /**
   * Mark an invoice as disputed.
   * Creates a dispute receivables note and sets invoices.is_disputed = true
   * in the same transaction.
   */
  async markDisputed(
    companyId: string,
    invoiceId: string,
    userId: string,
    input: { noteText: string; contactMethod?: string | null },
  ) {
    this.assertCompanyId(companyId);
    this.validateUUID(invoiceId, "invoiceId");
    this.validateUUID(userId, "userId");

    const [invoice] = await db
      .select({ id: invoices.id, customerCompanyId: invoices.customerCompanyId })
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)))
      .limit(1);

    if (!invoice) throw this.notFoundError("Invoice");
    if (!invoice.customerCompanyId) {
      throw this.validationError(
        "Invoice has no customer company — cannot create receivables note",
      );
    }

    return db.transaction(async (tx) => {
      const [note] = await tx
        .insert(receivablesNotes)
        .values({
          companyId,
          customerCompanyId: invoice.customerCompanyId!,
          invoiceId,
          userId,
          noteType: "dispute",
          noteText: input.noteText,
          contactMethod: input.contactMethod ?? null,
          createdBySystem: false,
        })
        .returning();

      await tx
        .update(invoices)
        .set({ isDisputed: true, updatedAt: new Date() })
        .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)));

      return note;
    });
  }

  /**
   * Log a communication with a client.
   *
   * Atomically in one transaction:
   *   1. Inserts a "communication" receivables note.
   *   2. Sets invoices.last_contacted_at to the communication timestamp.
   *   3. If followUp.enabled: sets invoices.follow_up_at.
   *   4. If promiseToPay.enabled: inserts a promise_to_pay note and sets
   *      invoices.promised_payment_at.
   */
  async logCommunication(
    companyId: string,
    invoiceId: string,
    userId: string,
    input: LogCommunicationInput,
  ) {
    this.assertCompanyId(companyId);
    this.validateUUID(invoiceId, "invoiceId");
    this.validateUUID(userId, "userId");

    const [invoice] = await db
      .select({ id: invoices.id, customerCompanyId: invoices.customerCompanyId })
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)))
      .limit(1);

    if (!invoice) throw this.notFoundError("Invoice");
    if (!invoice.customerCompanyId) {
      throw this.validationError(
        "Invoice has no customer company — cannot create receivables note",
      );
    }

    const communicatedAt = new Date(input.communicatedAt);
    const noteText =
      input.notes?.trim() ||
      (input.method
        ? `${outcomeLabel(input.outcome)} via ${methodLabel(input.method)}.`
        : `${outcomeLabel(input.outcome)}.`);

    return db.transaction(async (tx) => {
      // 1. Insert communication note.
      const [note] = await tx
        .insert(receivablesNotes)
        .values({
          companyId,
          customerCompanyId: invoice.customerCompanyId!,
          invoiceId,
          userId,
          noteType: "communication",
          noteText,
          contactMethod: input.method ?? null,
          outcome: input.outcome,
          contactPersonId: input.contactPersonId ?? null,
          communicatedAt,
          createdBySystem: false,
        })
        .returning();

      // 2. Advance last_contacted_at.
      await tx
        .update(invoices)
        .set({ lastContactedAt: communicatedAt, updatedAt: new Date() })
        .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)));

      // 3. Optionally set follow-up.
      if (input.followUp?.enabled && input.followUp.followUpAt) {
        await tx
          .update(invoices)
          .set({ followUpAt: new Date(input.followUp.followUpAt), updatedAt: new Date() })
          .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)));
      }

      // 4. Optionally record promise to pay.
      if (input.promiseToPay?.enabled && input.promiseToPay.promisedAt) {
        const promisedAt = new Date(input.promiseToPay.promisedAt);
        await tx
          .insert(receivablesNotes)
          .values({
            companyId,
            customerCompanyId: invoice.customerCompanyId!,
            invoiceId,
            userId,
            noteType: "promise_to_pay",
            noteText: `Promised to pay by ${promisedAt.toLocaleDateString()}.`,
            promisedAt,
            contactMethod: input.method ?? null,
            createdBySystem: false,
          });

        await tx
          .update(invoices)
          .set({ promisedPaymentAt: promisedAt, updatedAt: new Date() })
          .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)));
      }

      return note;
    });
  }
}

function outcomeLabel(outcome: string): string {
  const labels: Record<string, string> = {
    spoke_with: "Spoke with client",
    left_message: "Left message",
    no_answer: "No answer",
    email_sent: "Email sent",
    text_sent: "Text sent",
    other: "Contacted client",
  };
  return labels[outcome] ?? "Contacted client";
}

function methodLabel(method: string): string {
  const labels: Record<string, string> = {
    phone_call: "Phone Call",
    email: "Email",
    text_message: "Text Message",
    in_person: "In Person",
    other: "Other",
  };
  return labels[method] ?? method;
}

export const receivablesNotesRepository = new ReceivablesNotesRepository();
