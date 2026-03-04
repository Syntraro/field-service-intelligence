/**
 * Event Logger — Canonical server-side event writer.
 *
 * Phase 1 Architecture: Append-only tenant-scoped event log.
 * Used for: Recent Activity feed, entity timelines, analytics.
 *
 * Usage:
 *   import { logEvent } from "../lib/events";
 *   await logEvent(ctx, {
 *     eventType: "job.created",
 *     entityType: "job",
 *     entityId: job.id,
 *     summary: `Created Job #${job.jobNumber}`,
 *     meta: { jobNumber: job.jobNumber, clientName },
 *   });
 *
 * Failures are swallowed (logged to console) — event logging must never break operations.
 */

import { db as defaultDb } from "../db";
import { events } from "@shared/schema";
import type { EventEntityType, EventSeverity } from "@shared/schema";
import type { QueryCtx } from "./queryCtx";

export interface LogEventParams {
  eventType: string;
  entityType: EventEntityType;
  entityId: string;
  summary: string;
  severity?: EventSeverity;
  meta?: Record<string, unknown>;
  /** Override actor (defaults to ctx.userId). Pass null for system events. */
  actorUserId?: string | null;
  actorType?: "user" | "system";
}

/**
 * Append an event to the canonical events table.
 * ctx provides tenantId + userId. Failures are caught and logged.
 */
export async function logEvent(ctx: QueryCtx, params: LogEventParams): Promise<void> {
  try {
    const dbInstance = ctx.db || defaultDb;
    await (dbInstance as any).insert(events).values({
      tenantId: ctx.tenantId,
      actorUserId: params.actorUserId !== undefined ? params.actorUserId : ctx.userId || null,
      actorType: params.actorType || (ctx.userId ? "user" : "system"),
      entityType: params.entityType,
      entityId: params.entityId,
      eventType: params.eventType,
      severity: params.severity || "info",
      summary: params.summary,
      meta: params.meta || null,
    });
  } catch (error) {
    // Event logging must never break operations
    console.error("[logEvent] Failed to write event:", error, params);
  }
}

/**
 * Fire-and-forget variant — doesn't block the caller.
 * Use when event logging shouldn't add latency to the response.
 */
export function logEventAsync(ctx: QueryCtx, params: LogEventParams): void {
  logEvent(ctx, params).catch(() => {});
}
