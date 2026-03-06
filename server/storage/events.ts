/**
 * Events Repository — Read layer for the canonical events table.
 *
 * Phase 1 Architecture: Event Log + Attention Queue.
 * Provides paginated reads for activity feed and entity timelines.
 */

import { db } from "../db";
import { events } from "@shared/schema";
import { eq, and, or, desc, lt } from "drizzle-orm";
import { clampLimit } from "./base";

export interface EventFeedOptions {
  tenantId: string;
  limit?: number;
  /** Cursor-based pagination: pass createdAt of last item */
  cursor?: string;
}

export interface EntityTimelineOptions {
  tenantId: string;
  entityType: string;
  entityId: string;
  limit?: number;
  cursor?: string;
}

/**
 * Get recent events for a tenant (activity feed).
 */
export async function getActivityFeed(opts: EventFeedOptions) {
  const limit = clampLimit(opts.limit || 50, 200);

  const conditions = [eq(events.tenantId, opts.tenantId)];
  if (opts.cursor) {
    conditions.push(lt(events.createdAt, new Date(opts.cursor)));
  }

  const rows = await db
    .select()
    .from(events)
    .where(and(...conditions))
    .orderBy(desc(events.createdAt))
    .limit(limit + 1); // Fetch one extra to determine hasMore

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = items.length > 0 ? items[items.length - 1].createdAt?.toISOString() : null;

  return { items, hasMore, nextCursor };
}

export interface DispatchTimelineOptions {
  tenantId: string;
  jobId: string;
  visitId: string;
  limit?: number;
}

/**
 * Get combined timeline for a job + visit pair (dispatch panel).
 * Fetches events where (entityType=job AND entityId=jobId)
 * OR (entityType=visit AND entityId=visitId), ordered by most recent.
 */
export async function getDispatchTimeline(opts: DispatchTimelineOptions) {
  const limit = clampLimit(opts.limit || 6, 20);

  const rows = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.tenantId, opts.tenantId),
        or(
          and(eq(events.entityType, "job"), eq(events.entityId, opts.jobId)),
          and(eq(events.entityType, "visit"), eq(events.entityId, opts.visitId)),
        ),
      ),
    )
    .orderBy(desc(events.createdAt))
    .limit(limit);

  return { items: rows };
}

/**
 * Get events for a specific entity (entity timeline).
 */
export async function getEntityTimeline(opts: EntityTimelineOptions) {
  const limit = clampLimit(opts.limit || 50, 200);

  const conditions = [
    eq(events.tenantId, opts.tenantId),
    eq(events.entityType, opts.entityType),
    eq(events.entityId, opts.entityId),
  ];
  if (opts.cursor) {
    conditions.push(lt(events.createdAt, new Date(opts.cursor)));
  }

  const rows = await db
    .select()
    .from(events)
    .where(and(...conditions))
    .orderBy(desc(events.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = items.length > 0 ? items[items.length - 1].createdAt?.toISOString() : null;

  return { items, hasMore, nextCursor };
}
