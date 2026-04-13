/**
 * Communication Templates — storage layer (Phase 1, 2026-04-12).
 *
 * Tenant-scoped email/SMS templates for outbound messaging.
 * DB access only — no business logic, no validation beyond what the DB
 * constraints enforce. Service layer owns rules + defaults.
 */

import { and, eq, sql } from "drizzle-orm";
import { db as defaultDb } from "../db";
import {
  communicationTemplates,
  type CommunicationTemplate,
  type CommunicationTemplateChannel,
  type CommunicationTemplateEntityType,
} from "@shared/schema";

export interface UpsertCommunicationTemplateRow {
  tenantId: string;
  entityType: CommunicationTemplateEntityType;
  channel: CommunicationTemplateChannel;
  subjectTemplate: string | null;
  bodyTemplate: string;
  isActive?: boolean;
}

export const communicationTemplatesStorage = {
  /**
   * Delete the template row for (tenant, entity, channel). Used by Reset-
   * to-default so the service's fallback behavior takes over again.
   * Returns `true` if a row was removed, `false` if nothing existed.
   */
  async deleteTemplate(
    tenantId: string,
    entityType: CommunicationTemplateEntityType,
    channel: CommunicationTemplateChannel,
    queryDb: typeof defaultDb = defaultDb,
  ): Promise<boolean> {
    const rows = await queryDb
      .delete(communicationTemplates)
      .where(
        and(
          eq(communicationTemplates.tenantId, tenantId),
          eq(communicationTemplates.entityType, entityType),
          eq(communicationTemplates.channel, channel),
        ),
      )
      .returning({ id: communicationTemplates.id });
    return rows.length > 0;
  },

  /**
   * Fetch the single template for a (tenant, entity, channel) tuple.
   * Returns null if none exists.
   */
  async getTemplate(
    tenantId: string,
    entityType: CommunicationTemplateEntityType,
    channel: CommunicationTemplateChannel,
    queryDb: typeof defaultDb = defaultDb,
  ): Promise<CommunicationTemplate | null> {
    const [row] = await queryDb
      .select()
      .from(communicationTemplates)
      .where(
        and(
          eq(communicationTemplates.tenantId, tenantId),
          eq(communicationTemplates.entityType, entityType),
          eq(communicationTemplates.channel, channel),
        ),
      )
      .limit(1);
    return row ?? null;
  },

  /**
   * Upsert a template keyed by the canonical unique constraint
   * (tenant_id, entity_type, channel). Overwrites on conflict — there is at
   * most one template per tuple.
   */
  async upsertTemplate(
    row: UpsertCommunicationTemplateRow,
    queryDb: typeof defaultDb = defaultDb,
  ): Promise<CommunicationTemplate> {
    const now = new Date();
    const [inserted] = await queryDb
      .insert(communicationTemplates)
      .values({
        tenantId: row.tenantId,
        entityType: row.entityType,
        channel: row.channel,
        subjectTemplate: row.subjectTemplate,
        bodyTemplate: row.bodyTemplate,
        isActive: row.isActive ?? true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          communicationTemplates.tenantId,
          communicationTemplates.entityType,
          communicationTemplates.channel,
        ],
        set: {
          subjectTemplate: row.subjectTemplate,
          bodyTemplate: row.bodyTemplate,
          isActive: row.isActive ?? true,
          updatedAt: sql`now()`,
        },
      })
      .returning();
    return inserted;
  },
};
