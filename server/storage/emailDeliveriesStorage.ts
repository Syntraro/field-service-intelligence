/**
 * Email Deliveries — storage layer (Phase 10, 2026-04-12).
 *
 * DB-only access. No business logic, no lifecycle rules. The tracking
 * service owns orchestration + status-transition choices.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db as defaultDb } from "../db";
import {
  emailDeliveries,
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
};
