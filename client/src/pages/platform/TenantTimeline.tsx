/**
 * TenantTimeline — chronological operator view of everything that has
 * happened to a single tenant.
 *
 * 2026-04-22 Admin Phase A1: consumes the canonical
 * `GET /api/platform/tenants/:id/timeline` read service. No cross-reads,
 * no derivation — server owns the normalization; this component owns the
 * presentation (chips, severity color, relative time, expand-for-details).
 *
 * Pagination: `useInfiniteQuery` with a simple `before` ISO cursor. Pages
 * are stitched newest-first; "Load older" fetches one more page.
 */
import { useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronDown,
  ChevronRight,
  CircleDot,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { formatDistanceToNowStrict, format } from "date-fns";

// ── Canonical types (mirror server TimelineEvent) ─────────────────────────

type Severity = "info" | "success" | "warning" | "danger";

interface TimelineActor {
  id?: string | null;
  email?: string | null;
  role?: string | null;
}

interface TimelineEvent {
  id: string;
  timestamp: string;
  kind: string;
  title: string;
  subtitle: string | null;
  actor: TimelineActor | null;
  severity: Severity;
  metadata: Record<string, unknown>;
  sourceTable: string;
}

interface TimelineResponse {
  tenantId: string;
  events: TimelineEvent[];
  hasMore: boolean;
  nextBefore: string | null;
}

// ── Filter chip groups ────────────────────────────────────────────────────

const GROUPS: Array<{ key: string; label: string }> = [
  { key: "subscription", label: "Subscription" },
  { key: "audit",        label: "Audit" },
  { key: "support",      label: "Support" },
  { key: "impersonation", label: "Impersonation" },
  { key: "entitlement",  label: "Overrides" },
  { key: "feedback",     label: "Feedback" },
  { key: "issue",        label: "Issues" },
];

function kindGroup(kind: string): string {
  const dot = kind.indexOf(".");
  return dot < 0 ? kind : kind.slice(0, dot);
}

// ── Severity presentation ─────────────────────────────────────────────────

const severityConfig: Record<
  Severity,
  { dot: string; badge: string; Icon: typeof CircleDot }
> = {
  info:    { dot: "bg-slate-400",     badge: "bg-slate-100 text-slate-700",     Icon: CircleDot },
  success: { dot: "bg-emerald-500",   badge: "bg-emerald-100 text-emerald-800", Icon: CheckCircle2 },
  warning: { dot: "bg-amber-500",     badge: "bg-amber-100 text-amber-800",     Icon: AlertTriangle },
  danger:  { dot: "bg-red-500",       badge: "bg-red-100 text-red-800",         Icon: AlertCircle },
};

// ── Main component ────────────────────────────────────────────────────────

export function TenantTimeline({ tenantId }: { tenantId: string }) {
  const [activeGroups, setActiveGroups] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleGroup = (key: string) => {
    setActiveGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const kindsParam = useMemo(() => {
    if (activeGroups.size === 0) return "";
    return Array.from(activeGroups)
      .map((k) => `kinds[]=${encodeURIComponent(k)}`)
      .join("&");
  }, [activeGroups]);

  const query = useInfiniteQuery<TimelineResponse>({
    queryKey: ["/api/platform/tenants", tenantId, "timeline", kindsParam],
    enabled: !!tenantId,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const parts: string[] = ["limit=50"];
      if (pageParam) parts.push(`before=${encodeURIComponent(pageParam as string)}`);
      if (kindsParam) parts.push(kindsParam);
      const qs = parts.join("&");
      return apiRequest<TimelineResponse>(
        `/api/platform/tenants/${tenantId}/timeline?${qs}`,
      );
    },
    getNextPageParam: (last) => (last.hasMore && last.nextBefore ? last.nextBefore : undefined),
  });

  const events: TimelineEvent[] = useMemo(
    () => query.data?.pages.flatMap((p) => p.events) ?? [],
    [query.data],
  );

  return (
    <Card data-testid="tenant-timeline" className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>Timeline</span>
          {query.isFetching && !query.isFetchingNextPage && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </CardTitle>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {GROUPS.map((g) => {
            const on = activeGroups.size === 0 || activeGroups.has(g.key);
            return (
              <Badge
                key={g.key}
                variant={on ? "default" : "outline"}
                className="cursor-pointer text-xs"
                onClick={() => toggleGroup(g.key)}
                data-testid={`timeline-chip-${g.key}`}
              >
                {g.label}
              </Badge>
            );
          })}
          {activeGroups.size > 0 && (
            <Badge
              variant="outline"
              className="cursor-pointer text-xs text-muted-foreground border-dashed"
              onClick={() => setActiveGroups(new Set())}
              data-testid="timeline-clear-filters"
            >
              Clear
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {query.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No events for this tenant yet.
          </p>
        ) : (
          <ul className="divide-y divide-border" data-testid="timeline-list">
            {events.map((e) => (
              <TimelineRow
                key={e.id}
                event={e}
                expanded={expanded.has(e.id)}
                onToggle={() => toggleExpanded(e.id)}
              />
            ))}
          </ul>
        )}

        {query.hasNextPage && (
          <div className="flex justify-center pt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
              data-testid="timeline-load-older"
            >
              {query.isFetchingNextPage && (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              )}
              Load older
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Row component ─────────────────────────────────────────────────────────

function TimelineRow({
  event,
  expanded,
  onToggle,
}: {
  event: TimelineEvent;
  expanded: boolean;
  onToggle: () => void;
}) {
  const sev = severityConfig[event.severity];
  const ts = new Date(event.timestamp);
  const relative = formatDistanceToNowStrict(ts, { addSuffix: true });
  const absolute = format(ts, "yyyy-MM-dd HH:mm:ss");
  const group = kindGroup(event.kind);
  const groupLabel = GROUPS.find((g) => g.key === group)?.label ?? group;

  const actorDisplay =
    event.actor?.email || event.actor?.id || null;

  return (
    <li
      className="py-2.5 flex gap-3 items-start cursor-pointer hover-elevate px-2 -mx-2 rounded"
      onClick={onToggle}
      data-testid={`timeline-row-${event.id}`}
      data-kind={event.kind}
    >
      <div className="flex flex-col items-center pt-1.5">
        <span className={`inline-block h-2 w-2 rounded-full ${sev.dot}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${sev.badge}`}>
            {groupLabel}
          </span>
          <span className="text-sm font-medium truncate">{event.title}</span>
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          )}
        </div>
        {event.subtitle && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {event.subtitle}
          </p>
        )}
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
          <span title={absolute}>{relative}</span>
          {actorDisplay && (
            <>
              <span>·</span>
              <span className="truncate">by {actorDisplay}</span>
            </>
          )}
          <span>·</span>
          <code className="text-[10px] opacity-70">{event.kind}</code>
        </div>
        {expanded && (
          <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted/40 p-2 text-[11px] leading-snug font-mono whitespace-pre-wrap">
            {JSON.stringify(event.metadata, null, 2)}
          </pre>
        )}
      </div>
    </li>
  );
}
