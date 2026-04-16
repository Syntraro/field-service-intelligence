/**
 * Email Deliveries — storage layer (Phase 10, 2026-04-12).
 *
 * DB-only access. No business logic, no lifecycle rules. The tracking
 * service owns orchestration + status-transition choices.
 */

import { and, desc, eq, lt, sql } from "drizzle-orm";
import { db as defaultDb } from "../db";
import {
  emailDeliveries,
  type DeliveryAttachmentMetadata,
  type EmailDelivery,
  type EmailDeliveryStatus,
  type EmailDeliveryTemplateSource,
  type CommunicationTemplateEntityType,
} from "@shared/schema";

export interface CreateDeliveryAttemptRow {
  tenantId: string;
  entityType: CommunicationTemplateEntityType;
  entityId: string;
  channel?: "email";
  recipients: string[];
  /** 2026-04-13 (Commit C): optional CC list for this send. */
  cc?: string[];
  /**
   * 2026-04-13 (Commit C follow-up): per-attachment metadata for audit /
   * history. Never file bytes. Empty array when the send has no
   * attachments.
   */
  attachments?: DeliveryAttachmentMetadata[];
  subject: string | null;
  bodySnapshot: string | null;
  templateSource: EmailDeliveryTemplateSource;
  provider?: string;
  createdByUserId?: string | null;
  /** Phase 17: set on resend-child rows; points at the original row. */
  retriedFromDeliveryId?: string | null;
}

export interface MarkSentPatch {
  providerMessageId: string | null;
  sentAt?: Date;
}

export interface MarkFailedPatch {
  errorMessage: string;
  failedAt?: Date;
}

export interface MarkWebhookStatusPatch {
  status: EmailDeliveryStatus;
  deliveredAt?: Date | null;
  errorMessage?: string | null;
}

export const emailDeliveriesStorage = {
  /**
   * Create a new delivery row with status = 'queued'. Returns the created row.
   */
  async createDeliveryAttempt(
    row: CreateDeliveryAttemptRow,
    queryDb: typeof defaultDb = defaultDb,
  ): Promise<EmailDelivery> {
    const [inserted] = await queryDb
      .insert(emailDeliveries)
      .values({
        tenantId: row.tenantId,
        entityType: row.entityType,
        entityId: row.entityId,
        channel: row.channel ?? "email",
        recipientCount: row.recipients.length,
        recipientsJson: row.recipients as any,
        ccJson: (row.cc ?? []) as any,
        attachmentsJson: (row.attachments ?? []) as any,
        subject: row.subject,
        bodySnapshot: row.bodySnapshot,
        templateSource: row.templateSource,
        provider: row.provider ?? "resend",
        status: "queued",
        createdByUserId: row.createdByUserId ?? null,
        retriedFromDeliveryId: row.retriedFromDeliveryId ?? null,
      })
      .returning();
    return inserted;
  },

  /**
   * Phase 17: fetch a delivery row by (tenantId, deliveryId). Used by the
   * resend flow to validate eligibility before re-dispatching.
   */
  async getDeliveryById(
    tenantId: string,
    deliveryId: string,
    queryDb: typeof defaultDb = defaultDb,
  ): Promise<EmailDelivery | null> {
    const [row] = await queryDb
      .select()
      .from(emailDeliveries)
      .where(
        and(
          eq(emailDeliveries.id, deliveryId),
          eq(emailDeliveries.tenantId, tenantId),
        ),
      )
      .limit(1);
    return row ?? null;
  },

  /**
   * Phase 17: bump `resend_count` on the original delivery row so the
   * one-retry policy is enforced. Tenant-scoped. Returns the updated row.
   */
  async incrementResendCount(
    tenantId: string,
    deliveryId: string,
    queryDb: typeof defaultDb = defaultDb,
  ): Promise<EmailDelivery | null> {
    const [row] = await queryDb
      .update(emailDeliveries)
      .set({
        resendCount: sql`${emailDeliveries.resendCount} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(emailDeliveries.id, deliveryId),
          eq(emailDeliveries.tenantId, tenantId),
        ),
      )
      .returning();
    return row ?? null;
  },

  /**
   * Transition a delivery row from 'queued' → 'sent'. Updates provider
   * message id + sent_at + updated_at.
   *
   * 2026-04-14 Phase B hardening: state-guarded UPDATE (`WHERE status =
   * 'queued'`) so a webhook-driven transition (e.g. `email.delivered`)
   * that landed first cannot be regressed to `sent` by this call. When
   * the row is no longer `queued`, the UPDATE matches 0 rows and returns
   * null — callers already tolerate that (`.catch(() => {})` on the
   * tracking-service wrapper; see emailDispatchService).
   */
  async markDeliverySent(
    tenantId: string,
    deliveryId: string,
    patch: MarkSentPatch,
    queryDb: typeof defaultDb = defaultDb,
  ): Promise<EmailDelivery | null> {
    const now = patch.sentAt ?? new Date();
    const [row] = await queryDb
      .update(emailDeliveries)
      .set({
        status: "sent",
        providerMessageId: patch.providerMessageId,
        sentAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(emailDeliveries.id, deliveryId),
          eq(emailDeliveries.tenantId, tenantId),
          eq(emailDeliveries.status, "queued"),
        ),
      )
      .returning();
    return row ?? null;
  },

  /**
   * Transition a delivery row to 'failed'. Stores the error string and
   * failed_at. Status can be set from 'queued' or from retries; we do not
   * gate on the prior status here — that's orchestration logic.
   */
  async markDeliveryFailed(
    tenantId: string,
    deliveryId: string,
    patch: MarkFailedPatch,
    queryDb: typeof defaultDb = defaultDb,
  ): Promise<EmailDelivery | null> {
    const now = patch.failedAt ?? new Date();
    const [row] = await queryDb
      .update(emailDeliveries)
      .set({
        status: "failed",
        errorMessage: patch.errorMessage,
        failedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(emailDeliveries.id, deliveryId),
          eq(emailDeliveries.tenantId, tenantId),
        ),
      )
      .returning();
    return row ?? null;
  },

  /**
   * Generic status setter used by webhook ingestion. Supports transitions
   * like sent → delivered, sent → bounced, sent → complained.
   */
  async markDeliveryStatus(
    tenantId: string,
    deliveryId: string,
    patch: MarkWebhookStatusPatch,
    queryDb: typeof defaultDb = defaultDb,
  ): Promise<EmailDelivery | null> {
    const now = new Date();
    const set: Record<string, unknown> = {
      status: patch.status,
      updatedAt: now,
    };
    if (patch.deliveredAt !== undefined) set.deliveredAt = patch.deliveredAt;
    if (patch.errorMessage !== undefined) set.errorMessage = patch.errorMessage;

    const [row] = await queryDb
      .update(emailDeliveries)
      .set(set)
      .where(
        and(
          eq(emailDeliveries.id, deliveryId),
          eq(emailDeliveries.tenantId, tenantId),
        ),
      )
      .returning();
    return row ?? null;
  },

  /**
   * All deliveries for a given entity, newest first. Tenant-scoped.
   * Phase 15.
   */
  async getDeliveriesByEntity(
    tenantId: string,
    entityType: CommunicationTemplateEntityType,
    entityId: string,
    limit = 20,
    queryDb: typeof defaultDb = defaultDb,
  ): Promise<EmailDelivery[]> {
    const rows = await queryDb
      .select()
      .from(emailDeliveries)
      .where(
        and(
          eq(emailDeliveries.tenantId, tenantId),
          eq(emailDeliveries.entityType, entityType),
          eq(emailDeliveries.entityId, entityId),
        ),
      )
      .orderBy(desc(emailDeliveries.createdAt))
      .limit(limit);
    return rows;
  },

  /**
   * Phase A hardening (2026-04-14): return the single `queued` delivery
   * for a (tenant, entity) pair if one exists. Backs the service-level
   * pre-check that prevents concurrent duplicate sends.
   *
   * Uses the `email_deliveries_queued_active_uq` partial unique index
   * (at most one matching row by DB-level guarantee).
   */
  async findActiveQueuedDelivery(
    tenantId: string,
    entityType: CommunicationTemplateEntityType,
    entityId: string,
    queryDb: typeof defaultDb = defaultDb,
  ): Promise<EmailDelivery | null> {
    const [row] = await queryDb
      .select()
      .from(emailDeliveries)
      .where(
        and(
          eq(emailDeliveries.tenantId, tenantId),
          eq(emailDeliveries.entityType, entityType),
          eq(emailDeliveries.entityId, entityId),
          eq(emailDeliveries.status, "queued"),
        ),
      )
      .limit(1);
    return row ?? null;
  },

  /**
   * Lookup by provider message id — tenant-scoped to prevent cross-tenant
   * collisions in the (rare) case provider ids aren't globally unique.
   */
  async getDeliveryByProviderMessageId(
    tenantId: string,
    providerMessageId: string,
    queryDb: typeof defaultDb = defaultDb,
  ): Promise<EmailDelivery | null> {
    const [row] = await queryDb
      .select()
      .from(emailDeliveries)
      .where(
        and(
          eq(emailDeliveries.tenantId, tenantId),
          eq(emailDeliveries.providerMessageId, providerMessageId),
        ),
      )
      .limit(1);
    return row ?? null;
  },

  /**
   * Phase C hardening (2026-04-14): atomically fail any delivery row that
   * has been in `queued` status since before `cutoff`. Returns the rows
   * that were actually transitioned so the caller can emit follow-up
   * notifications.
   *
   * Single UPDATE with `WHERE status = 'queued' AND created_at < cutoff`
   * eliminates the SELECT-then-UPDATE race: any row that transitioned
   * concurrently (markSent / webhook / existing markFailed) is excluded
   * by the WHERE clause and will not be touched.
   */
  async failStaleQueuedDeliveries(
    cutoff: Date,
    queryDb: typeof defaultDb = defaultDb,
  ): Promise<EmailDelivery[]> {
    const now = new Date();
    const rows = await queryDb
      .update(emailDeliveries)
      .set({
        status: "failed",
        errorMessage:
          "Timed out in queued state — no provider response received within threshold.",
        failedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(emailDeliveries.status, "queued"),
          lt(emailDeliveries.createdAt, cutoff),
        ),
      )
      .returning();
    return rows;
  },

  /**
   * 2026-04-14: global lookup by provider message id, used by the
   * Resend webhook receiver. The webhook payload does not carry our
   * tenant id, so we resolve it via the delivery row. Returns the
   * single matching row, or `null`.
   *
   * Provider message ids are generated by Resend per send and are
   * globally unique within their system, so a non-tenant-scoped lookup
   * is safe. Tenant isolation is re-asserted downstream: the returned
   * row's `tenantId` is the only one a caller (e.g. `markWebhookStatus`)
   * can write against.
   */
  async getDeliveryByProviderMessageIdAnyTenant(
    providerMessageId: string,
    queryDb: typeof defaultDb = defaultDb,
  ): Promise<EmailDelivery | null> {
    const [row] = await queryDb
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.providerMessageId, providerMessageId))
      .limit(1);
    return row ?? null;
  },
};
