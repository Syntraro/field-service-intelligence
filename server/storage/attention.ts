/**
 * Attention Repository — Read layer for the attention_items table.
 *
 * Phase 1 Architecture: Event Log + Attention Queue.
 * Provides filtered reads, summary counts, and entity-level queries.
 */

import { db } from "../db";
import { attentionItems, jobs } from "@shared/schema";
import { eq, and, desc, sql, isNull, isNotNull } from "drizzle-orm";
import { clampLimit } from "./base";

export interface AttentionFeedOptions {
  tenantId: string;
  entityType?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

/**
 * Get attention items with optional filters.
 */
export async function getAttentionItems(opts: AttentionFeedOptions) {
  const limit = clampLimit(opts.limit || 50, 200);
  const offset = opts.offset || 0;

  const conditions = [eq(attentionItems.tenantId, opts.tenantId)];
  if (opts.entityType) {
    conditions.push(eq(attentionItems.entityType, opts.entityType));
  }
  if (opts.status) {
    conditions.push(eq(attentionItems.status, opts.status));
  }

  const rows = await db
    .select()
    .from(attentionItems)
    .where(and(...conditions))
    .orderBy(desc(attentionItems.lastDetectedAt))
    .limit(limit)
    .offset(offset);

  return rows;
}

/**
 * Get summary counts by ruleType (for dashboard).
 * Only counts open items.
 */
export async function getAttentionSummary(tenantId: string) {
  // For job-type attention items, join to jobs table to exclude orphaned rows
  // (jobs that were hard-deleted or soft-deleted but whose attention items persist).
  // Non-job attention items are counted directly.
  const jobRows = await db
    .select({
      ruleType: attentionItems.ruleType,
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(attentionItems)
    .innerJoin(jobs, eq(attentionItems.entityId, jobs.id))
    .where(and(
      eq(attentionItems.tenantId, tenantId),
      eq(attentionItems.status, "open"),
      eq(attentionItems.entityType, "job"),
      isNull(jobs.deletedAt),
      eq(jobs.isActive, true),
    ))
    .groupBy(attentionItems.ruleType);

  const nonJobRows = await db
    .select({
      ruleType: attentionItems.ruleType,
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(attentionItems)
    .where(and(
      eq(attentionItems.tenantId, tenantId),
      eq(attentionItems.status, "open"),
      sql`${attentionItems.entityType} != 'job'`,
    ))
    .groupBy(attentionItems.ruleType);

  const summary: Record<string, number> = {};
  for (const row of [...jobRows, ...nonJobRows]) {
    summary[row.ruleType] = (summary[row.ruleType] ?? 0) + Number(row.count);
  }
  return summary;
}

/**
 * Get attention items for a specific entity.
 */
export async function getEntityAttentionItems(tenantId: string, entityType: string, entityId: string) {
  return db
    .select()
    .from(attentionItems)
    .where(and(
      eq(attentionItems.tenantId, tenantId),
      eq(attentionItems.entityType, entityType),
      eq(attentionItems.entityId, entityId),
    ))
    .orderBy(desc(attentionItems.lastDetectedAt));
}
