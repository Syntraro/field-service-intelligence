/**
 * Activity Feed Routes — Global Activity Feed drawer endpoints.
 *
 * Reads from the existing canonical `events` table (no duplicate event
 * log). Filters to the canonical operational event_types and respects
 * per-user toggles in `activity_feed_preferences`.
 *
 *   GET  /api/activity-feed                — paginated feed for current user
 *   GET  /api/activity-feed/preferences    — current user's enabled event_types
 *   PUT  /api/activity-feed/preferences    — replace the user's enabled set
 */

import { Router } from "express";
import type { Response } from "express";
import { z } from "zod";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import type { AuthedRequest } from "../auth/tenantIsolation";
import { db } from "../db";
import { events, activityFeedPreferences, users } from "@shared/schema";
import {
  ACTIVITY_FEED_EVENT_TYPES,
  DEFAULT_ENABLED_EVENT_TYPES,
  isCanonicalActivityEventType,
  type ActivityFeedEventType,
} from "@shared/activityFeedRegistry";
import { resolveTechnicianName } from "../lib/resolveTechnicianName";

const router = Router();

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Resolve the effective enabled set for a user — DB row if present,
 * canonical defaults otherwise. Returns only canonical event_types
 * (orphaned/unknown stored values are silently ignored on read).
 */
async function getEnabledEventTypes(userId: string, tenantId: string): Promise<ActivityFeedEventType[]> {
  const [row] = await db
    .select({ enabledEventTypes: activityFeedPreferences.enabledEventTypes })
    .from(activityFeedPreferences)
    .where(
      and(
        eq(activityFeedPreferences.userId, userId),
        eq(activityFeedPreferences.tenantId, tenantId),
      ),
    )
    .limit(1);

  if (!row || !Array.isArray(row.enabledEventTypes)) {
    return [...DEFAULT_ENABLED_EVENT_TYPES];
  }

  const stored = row.enabledEventTypes as unknown[];
  return stored.filter(
    (k): k is ActivityFeedEventType =>
      typeof k === "string" && isCanonicalActivityEventType(k),
  );
}

// ─── Preferences ────────────────────────────────────────────────────

const putPreferencesSchema = z.object({
  enabledEventTypes: z.array(z.string()).max(64),
});

router.get(
  "/preferences",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const userId = req.user!.id;
    const tenantId = req.companyId!;
    const enabled = await getEnabledEventTypes(userId, tenantId);
    res.json({
      enabledEventTypes: enabled,
      availableEventTypes: ACTIVITY_FEED_EVENT_TYPES,
      defaultEnabledEventTypes: DEFAULT_ENABLED_EVENT_TYPES,
    });
  }),
);

router.put(
  "/preferences",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const userId = req.user!.id;
    const tenantId = req.companyId!;
    const validated = validateSchema(putPreferencesSchema, req.body);

    // Reject unknown event_type keys at 400 so a stale client cannot
    // persist orphans forward. Mirrors the dashboard widget pattern.
    const unknown = validated.enabledEventTypes.filter((k) => !isCanonicalActivityEventType(k));
    if (unknown.length > 0) {
      throw createError(400, `Unknown activity event type(s): ${unknown.join(", ")}`);
    }

    // Deduplicate while preserving canonical order.
    const dedupedSet = new Set<ActivityFeedEventType>(
      validated.enabledEventTypes.filter(isCanonicalActivityEventType),
    );
    const deduped = ACTIVITY_FEED_EVENT_TYPES.filter((k) => dedupedSet.has(k));

    const [existing] = await db
      .select({ id: activityFeedPreferences.id })
      .from(activityFeedPreferences)
      .where(eq(activityFeedPreferences.userId, userId))
      .limit(1);

    if (existing) {
      await db
        .update(activityFeedPreferences)
        .set({
          enabledEventTypes: deduped,
          updatedAt: new Date(),
          tenantId, // refresh in case user moved tenants (defensive)
        })
        .where(eq(activityFeedPreferences.id, existing.id));
    } else {
      await db.insert(activityFeedPreferences).values({
        userId,
        tenantId,
        enabledEventTypes: deduped,
      });
    }

    res.json({
      enabledEventTypes: deduped,
      availableEventTypes: ACTIVITY_FEED_EVENT_TYPES,
      defaultEnabledEventTypes: DEFAULT_ENABLED_EVENT_TYPES,
    });
  }),
);

// ─── Feed ───────────────────────────────────────────────────────────

router.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const userId = req.user!.id;
    const tenantId = req.companyId!;
    const limit = Math.min(parseInt(String(req.query.limit ?? "30"), 10) || 30, 100);
    const cursor = req.query.cursor ? String(req.query.cursor) : null;

    const enabled = await getEnabledEventTypes(userId, tenantId);
    if (enabled.length === 0) {
      // No canonical types enabled → empty feed (don't run a no-op query).
      return res.json({ items: [], hasMore: false, nextCursor: null });
    }

    const conditions = [
      eq(events.tenantId, tenantId),
      inArray(events.eventType, enabled),
    ];
    if (cursor) {
      conditions.push(lt(events.createdAt, new Date(cursor)));
    }

    // LEFT JOIN users so each row carries an `actor.name` for the client
    // formatter. We join only the name-shape columns the canonical
    // `resolveTechnicianName` helper needs — no PII beyond what the
    // client would derive from a user lookup anyway. The actor row is
    // null when the event was emitted by the system or when the user
    // has been deleted (FK ON DELETE SET NULL).
    const rows = await db
      .select({
        id: events.id,
        tenantId: events.tenantId,
        actorUserId: events.actorUserId,
        actorType: events.actorType,
        entityType: events.entityType,
        entityId: events.entityId,
        eventType: events.eventType,
        severity: events.severity,
        summary: events.summary,
        meta: events.meta,
        createdAt: events.createdAt,
        actorFullName: users.fullName,
        actorFirstName: users.firstName,
        actorLastName: users.lastName,
        actorEmail: users.email,
      })
      .from(events)
      .leftJoin(users, eq(users.id, events.actorUserId))
      .where(and(...conditions))
      .orderBy(desc(events.createdAt))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    const items = sliced.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      actorUserId: r.actorUserId,
      actorType: r.actorType,
      entityType: r.entityType,
      entityId: r.entityId,
      eventType: r.eventType,
      severity: r.severity,
      summary: r.summary,
      meta: r.meta,
      createdAt: r.createdAt,
      actor: r.actorUserId
        ? {
            id: r.actorUserId,
            name: resolveTechnicianName({
              fullName: r.actorFullName,
              firstName: r.actorFirstName,
              lastName: r.actorLastName,
              email: r.actorEmail,
            }),
          }
        : null,
    }));
    const nextCursor =
      items.length > 0 ? items[items.length - 1].createdAt?.toISOString() ?? null : null;

    res.json({ items, hasMore, nextCursor });
  }),
);

export default router;
