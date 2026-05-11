/**
 * One row in the global Activity Feed drawer.
 *
 * Layout (compact — vertically stacked content column):
 *
 *   [icon]  Title (semibold)
 *           Subtitle (muted)
 *           Detail   (muted)
 *           Timestamp (muted, last line)
 *
 * The timestamp is rendered as the FINAL line inside the content column —
 * NOT as a right-aligned column. This matches the spec'd Jobber-style
 * compact rail.
 *
 * The displayed copy comes from `formatActivityEvent()` — we never
 * render the raw `summary` from the events table because legacy
 * emitters wrote engineering-shaped strings ("outcome=…") into it.
 *
 * No financial amounts are rendered here. The activity feed is visible
 * to roles that may not have permission to view paid / partial / failed
 * payment values (see `formatActivityEvent.ts` rule 5).
 */

import { Link } from "wouter";
import {
  getActivityEventDefinition,
  type ActivityFeedEventType,
} from "@shared/activityFeedRegistry";
import {
  ACTIVITY_FALLBACK_ICON,
  ACTIVITY_ICON_MAP,
  ACTIVITY_TONE_CLASSES,
  formatActivityTimestamp,
} from "./activityFeedVisuals";
import { formatActivityEvent } from "./formatActivityEvent";
import type { ActivityFeedItem as ActivityFeedItemData } from "./useActivityFeed";
import { cn } from "@/lib/utils";

interface ActivityFeedItemProps {
  item: ActivityFeedItemData;
  onNavigate?: () => void;
}

/**
 * Resolve a deep link for a feed event. Returns null for any event that
 * does not map to a confirmed supported detail route — those rows render
 * as non-interactive divs with no hover affordance.
 *
 * Allowlist (explicit — add entries only when the route is confirmed valid):
 *   job.created  + entityType=job     → /jobs/:entityId
 *   quote.created + entityType=quote  → /quotes/:entityId
 *   entityType=invoice                → /invoices/:entityId
 *   entityType=lead                   → /leads/:entityId
 *   visit.completed + meta.jobId      → /jobs/:jobId
 *
 * Intentionally NOT linked: timesheet.clocked_in/out, tech.arrived,
 * visit.started, visit.on_route, note.created, payment events.
 */
function resolveEntityHref(item: ActivityFeedItemData): string | null {
  const meta = item.meta as Record<string, unknown> | null;

  if (item.eventType === "job.created" && item.entityType === "job" && item.entityId) {
    return `/jobs/${item.entityId}`;
  }
  if (item.eventType === "quote.created" && item.entityType === "quote" && item.entityId) {
    return `/quotes/${item.entityId}`;
  }
  if (item.entityType === "invoice" && item.entityId) {
    return `/invoices/${item.entityId}`;
  }
  if (item.entityType === "lead" && item.entityId) {
    return `/leads/${item.entityId}`;
  }
  if (item.eventType === "visit.completed") {
    const jobId = (meta?.jobId as string | undefined) ?? null;
    return jobId ? `/jobs/${jobId}` : null;
  }
  return null;
}

export function ActivityFeedItem({ item, onNavigate }: ActivityFeedItemProps) {
  const definition = getActivityEventDefinition(item.eventType as ActivityFeedEventType);
  const Icon = definition ? ACTIVITY_ICON_MAP[definition.icon] : ACTIVITY_FALLBACK_ICON;
  const tone = definition ? ACTIVITY_TONE_CLASSES[definition.tone] : ACTIVITY_TONE_CLASSES.gray;

  const display = formatActivityEvent(item);
  const href = resolveEntityHref(item);
  const timestamp = formatActivityTimestamp(item.createdAt);

  const body = (
    <div
      className="flex items-start gap-3 px-4 py-2.5 transition-colors"
      data-testid={`activity-feed-item-${item.eventType}`}
    >
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1",
          tone.bg,
          tone.ring,
        )}
      >
        <Icon className={cn("h-3.5 w-3.5", tone.fg)} />
      </div>
      {/*
        Typography is anchored on canonical Phase E tokens so this row
        feels like a compact operational log, not a notification card:
          - Title:                          text-row-emphasis (15px / 500)
          - Subtitle / Detail / Timestamp:  text-helper (13px / lh 16px)
        Same size for the three muted lines so the column reads as one
        stacked detail block; position alone does the hierarchy work.
        No raw legacy ramp classes and no heavier weights here — see
        the row-hierarchy test pin in tests/activity-feed-drawer.test.ts.
      */}
      <div className="min-w-0 flex-1">
        <div
          className="text-row-emphasis text-foreground line-clamp-2"
          data-testid="activity-feed-item-title"
        >
          {display.title}
        </div>

        {display.subtitle && (
          <div
            className="mt-0.5 truncate text-helper font-medium text-foreground/75"
            data-testid="activity-feed-item-subtitle"
          >
            {display.subtitle}
          </div>
        )}

        {display.detail && (
          <div
            className="mt-0.5 truncate text-helper text-muted-foreground"
            data-testid="activity-feed-item-detail"
          >
            {display.detail}
          </div>
        )}

        <div
          className="mt-0.5 text-helper text-muted-foreground"
          data-testid="activity-feed-item-timestamp"
        >
          {timestamp}
        </div>
      </div>
    </div>
  );

  if (href) {
    return (
      <Link
        href={href}
        onClick={onNavigate}
        className="block border-b border-border/60 last:border-b-0 no-underline text-current cursor-pointer hover:bg-accent transition-colors"
      >
        {body}
      </Link>
    );
  }
  return <div className="border-b border-border/60 last:border-b-0">{body}</div>;
}
