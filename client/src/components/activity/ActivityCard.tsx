/**
 * ActivityCard (2026-04-14, refined)
 *
 * Reference history card for the bottom of the right rail on Job Detail
 * and Invoice Detail. Reads the canonical event log via
 * `GET /api/activity/:entityType/:entityId`.
 *
 * Refinements vs. v1:
 *   - Collapsible chrome matching the Job Summary pattern in the same
 *     rail (chevron + slate header). Default expanded.
 *   - Compact two-line rows: humanized title + exact timestamp.
 *   - Server `summary` strings are intentionally NOT rendered by
 *     default — most of them duplicate information that's already on
 *     the page (job/invoice numbers, visit ids). Per-event-type
 *     mappers extract the few useful bits (e.g. payment amount).
 *   - Exact timestamps only (`MMM d, yyyy, h:mm a`); no relative
 *     "X ago" text.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Activity as ActivityIcon, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CardShell } from "@/components/ui/card";
import { RailContentCardMeta } from "@/components/detail-rail/RailContentCard";

interface ActivityItem {
  id: string;
  eventType: string;
  summary: string | null;
  severity?: "info" | "warning" | "important" | string | null;
  actorUserId?: string | null;
  createdAt: string;
  meta?: Record<string, unknown> | null;
}

interface ActivityFeedResponse {
  items: ActivityItem[];
  hasMore: boolean;
  nextCursor?: string | null;
}

interface ActivityCardProps {
  // 2026-04-14: `quote` added — backend already accepts it via
  // `eventEntityTypeEnum` in shared/schema.ts and the generic
  // /api/activity/:entityType/:entityId endpoint. Added to front-end
  // union + title dictionary so Quote Detail can render the same
  // canonical activity surface as Job/Invoice Detail.
  entityType: "invoice" | "job" | "quote";
  entityId: string;
  /** Initial visible count. Default 8. */
  initial?: number;
  /** Items added per "View more" tap. Default 10. */
  pageSize?: number;
}

const TITLE_BY_ENTITY: Record<ActivityCardProps["entityType"], string> = {
  invoice: "Activity",
  job: "Activity",
  quote: "Activity",
};

/** Canonical exact-time format for activity rows. */
const EXACT_DATETIME_FORMAT = "MMM d, yyyy, h:mm a";

const TITLE_DICTIONARY: Record<string, string> = {
  "invoice.created": "Invoice created",
  "invoice.sent": "Invoice emailed",
  "invoice.batch_send": "Invoice emailed",
  "invoice.viewed": "Invoice viewed",
  "invoice.voided": "Invoice voided",
  "invoice.deleted": "Draft deleted",
  "invoice.paid": "Payment received",
  "invoice.partial_paid": "Partial payment received",
  "job.created": "Job created",
  "job.scheduled": "Job scheduled",
  "job.rescheduled": "Job rescheduled",
  "job.assigned": "Technician assigned",
  "job.unassigned": "Technician removed",
  "job.status_changed": "Status changed",
  "job.completed": "Job completed",
  "job.reopened": "Job reopened",
  "visit.started": "Visit started",
  "visit.completed": "Visit completed",
  "visit.reopened": "Visit reopened",
  "tech.arrived": "Technician on site",
  "tech.departed": "Technician departed",
  "note.created": "Note added",
  "task.completed": "Task completed",
  // 2026-04-14 quote events
  "quote.created": "Quote created",
  "quote.sent": "Quote emailed",
  "quote.viewed": "Quote viewed",
  "quote.approved": "Quote approved",
  "quote.declined": "Quote declined",
  "quote.converted": "Converted to job",
  "quote.expired": "Quote expired",
  "quote.template_applied": "Template applied",
};

function humanizeTitle(eventType: string): string {
  if (TITLE_DICTIONARY[eventType]) return TITLE_DICTIONARY[eventType];
  return eventType
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Per-event-type secondary line. Returns `null` when nothing useful to
 * show — keeps the card quiet by default. Only events whose meta carries
 * meaningful, non-redundant data surface a second line.
 */
function detailLine(item: ActivityItem): string | null {
  const meta = (item.meta ?? {}) as Record<string, unknown>;
  if (item.eventType === "invoice.paid" || item.eventType === "invoice.partial_paid") {
    const amount = meta.amount;
    if (typeof amount === "number") return formatMoney(amount);
    if (typeof amount === "string" && amount.length > 0) {
      const n = Number(amount);
      if (Number.isFinite(n)) return formatMoney(n);
    }
  }
  return null;
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(n);
}

export function ActivityCard({
  entityType,
  entityId,
  initial = 8,
  pageSize = 10,
}: ActivityCardProps) {
  const [visibleCount, setVisibleCount] = useState(initial);
  const [open, setOpen] = useState(true);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["/api/activity", entityType, entityId, visibleCount],
    queryFn: () =>
      apiRequest<ActivityFeedResponse>(
        `/api/activity/${entityType}/${entityId}?limit=${visibleCount}`,
      ),
    staleTime: 30_000,
  });

  const items = useMemo(() => data?.items ?? [], [data]);
  const hasMore = !!data?.hasMore;

  // 2026-05-07 Card canonicalization (Tier 1): outer chrome routed
  // through CardShell. The collapsible trigger button retains its
  // distinct background/hover (it's a button, not a static
  // CardShellHeader) but the body divider now uses the canonical
  // border-card-border token. Title color swapped to text-text-primary
  // (resolves to the same slate-900 the literal hex represented).
  return (
    <CardShell data-testid={`activity-card-${entityType}`}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center justify-between px-4 py-2.5 bg-[#f8fafc] hover:bg-slate-100 transition-colors">
            <span className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <ActivityIcon className="h-4 w-4 text-text-muted" />
              {TITLE_BY_ENTITY[entityType]}
            </span>
            {open ? (
              <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
            )}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-card-border px-3 py-2">
            {isLoading ? (
              <RailContentCardMeta className="flex items-center gap-2 px-1 py-2">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading…
              </RailContentCardMeta>
            ) : isError ? (
              <RailContentCardMeta className="px-1 py-2 text-destructive">
                Could not load activity.
              </RailContentCardMeta>
            ) : items.length === 0 ? (
              <RailContentCardMeta className="px-1 py-3">
                No activity yet.
              </RailContentCardMeta>
            ) : (
              <ul className="space-y-2.5">
                {items.map((it) => {
                  const dt = new Date(it.createdAt);
                  const detail = detailLine(it);
                  return (
                    <li
                      key={it.id}
                      className="flex flex-col gap-0"
                      data-testid={`activity-item-${it.id}`}
                    >
                      <span className="text-xs font-medium text-slate-700 truncate">
                        {humanizeTitle(it.eventType)}
                      </span>
                      <span className="text-xs text-slate-500">
                        {format(dt, EXACT_DATETIME_FORMAT)}
                        {detail ? ` · ${detail}` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            {hasMore && (
              <button
                type="button"
                onClick={() => setVisibleCount((n) => n + pageSize)}
                className="w-full mt-3 text-xs text-slate-500 hover:text-slate-700"
                data-testid={`activity-view-more-${entityType}`}
              >
                View more
              </button>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </CardShell>
  );
}
