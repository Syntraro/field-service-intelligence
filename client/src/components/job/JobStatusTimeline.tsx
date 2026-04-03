import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow, format } from "date-fns";
import { Clock, ChevronDown, ChevronRight, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { getJobStatusDisplay } from "@/components/job/jobUtils";
import type { JobStatusEvent } from "@shared/schema";

interface JobStatusTimelineProps {
  jobId: string;
  defaultOpen?: boolean;
}

// Extended type for display events that may be collapsed
interface DisplayEvent {
  id: string;
  fromStatus: string;
  toStatus: string;
  changedAt: Date | string;
  note: string | null;
  meta: Record<string, unknown> | null;
  // For collapsed events, track the original from_status
  collapsedFrom?: string;
  isCollapsed?: boolean;
}

/**
 * Collapse system auto-step events with their following close events.
 * Pattern: event A (to_status=completed, meta.system=true, meta.via=close)
 *          followed by event B (from_status=completed, meta.via=close)
 * Result: Single event showing original_from -> final_to with collapsed meta
 */
function collapseCloseEvents(events: JobStatusEvent[]): DisplayEvent[] {
  const result: DisplayEvent[] = [];

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const meta = event.meta as Record<string, unknown> | null;

    // Check if this is a system auto-step close event
    const isAutoStep = meta?.system === true &&
      meta?.via === "close" &&
      meta?.step === "auto_completed" &&
      event.toStatus === "completed";

    if (isAutoStep) {
      // Look for the next event (the "real" close event)
      const nextEvent = events[i + 1];
      const nextMeta = nextEvent?.meta as Record<string, unknown> | null;

      // Check if next event is the corresponding close final event
      const isCloseFollowUp = nextEvent &&
        nextEvent.fromStatus === "completed" &&
        nextMeta?.via === "close";

      if (isCloseFollowUp) {
        // Collapse both events into one
        result.push({
          id: nextEvent.id, // Use the final event's ID
          fromStatus: event.fromStatus, // Original status before close
          toStatus: nextEvent.toStatus, // Final status after close
          changedAt: nextEvent.changedAt,
          note: nextEvent.note,
          meta: { ...nextMeta, collapsedAutoStep: true },
          collapsedFrom: event.fromStatus,
          isCollapsed: true,
        });
        i++; // Skip the next event since we've merged it
        continue;
      }
    }

    // Regular event - pass through
    result.push({
      id: event.id,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      changedAt: event.changedAt,
      note: event.note,
      meta: meta,
    });
  }

  return result;
}

export function JobStatusTimeline({ jobId, defaultOpen = false }: JobStatusTimelineProps) {
  const { data: events, isLoading } = useQuery<JobStatusEvent[]>({
    queryKey: ["/api/jobs", jobId, "status-events"],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/status-events`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch status events");
      return res.json();
    },
  });

  // Collapse system auto-step events for cleaner display
  const displayEvents = useMemo(() => {
    if (!events) return [];
    return collapseCloseEvents(events);
  }, [events]);

  if (isLoading) {
    return (
      <Card>
        <div className="p-4">
          <div className="animate-pulse h-4 bg-muted rounded w-24" />
        </div>
      </Card>
    );
  }

  const hasEvents = displayEvents.length > 0;
  const rawEventCount = events?.length || 0;

  return (
    <Collapsible defaultOpen={defaultOpen}>
      <Card className="rounded-xl border-[#e5e7eb] bg-[#ffffff]">
        <CollapsibleTrigger asChild>
          <button
            className="w-full flex items-center justify-between px-5 py-4 bg-[#f8fafc] hover:bg-slate-100 transition-colors border-b border-[#e2e8f0]"
            data-testid="trigger-status-timeline"
          >
            <span className="text-sm font-semibold text-[#0f172a] flex items-center gap-2">
              <Clock className="h-4 w-4 text-[#64748b]" />
              Status Timeline
              {hasEvents && (
                <span className="text-xs text-muted-foreground font-normal">
                  ({displayEvents.length})
                </span>
              )}
            </span>
            <ChevronRight className="h-4 w-4 text-[#64748b] group-data-[state=open]:hidden" />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t px-4 pb-4 pt-3">
            {!hasEvents ? (
              <p className="text-xs text-muted-foreground">No status changes recorded yet.</p>
            ) : (
              <ul className="space-y-3">
                {displayEvents.map((event) => (
                  <TimelineEvent key={event.id} event={event} />
                ))}
              </ul>
            )}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function TimelineEvent({ event }: { event: DisplayEvent }) {
  const fromDisplay = getJobStatusDisplay({ status: event.fromStatus });
  const toDisplay = getJobStatusDisplay({ status: event.toStatus });
  const changedAt = new Date(event.changedAt);
  const relativeTime = formatDistanceToNow(changedAt, { addSuffix: true });
  const exactTime = format(changedAt, "MMM d, yyyy h:mm a");

  // Parse meta for additional context
  const meta = event.meta;
  const action = meta?.action as string | undefined;
  const via = meta?.via as string | undefined;
  const mode = meta?.mode as string | undefined;
  // Legacy support for closeMode
  const closeMode = meta?.closeMode as string | undefined;

  // Determine event description
  let description = "";
  if (action === "reopen") {
    description = "Reopened job";
  } else if (action === "undo_close") {
    description = "Undo close";
  } else if (action === "escalate") {
    description = "Escalated";
  } else if (action === "update_action_required_fields") {
    const changedFields = meta?.changedFields as string[] | undefined;
    description = changedFields ? `Updated: ${changedFields.join(", ")}` : "Updated action required fields";
  } else if (via === "close" && mode) {
    // New close event format with via/mode
    const modeLabels: Record<string, string> = {
      archive: "Archived",
      invoice_later: "Closed (invoice later)",
      invoice_now: "Closed & invoiced",
    };
    description = modeLabels[mode] || `Closed (${mode})`;
  } else if (closeMode) {
    // Legacy closeMode format
    const modeLabels: Record<string, string> = {
      archive: "Archived",
      invoice_later: "Closed (invoice later)",
      invoice_now: "Closed & invoiced",
    };
    description = modeLabels[closeMode] || `Closed (${closeMode})`;
  } else if (event.note) {
    description = event.note;
  }

  return (
    <li className="flex items-start gap-2 text-xs">
      <span className="mt-1 h-2 w-2 rounded-full bg-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 flex-wrap">
          <StatusBadge label={fromDisplay.label} variant={fromDisplay.variant} />
          <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
          <StatusBadge label={toDisplay.label} variant={toDisplay.variant} />
        </div>
        {description && (
          <p className="text-muted-foreground mt-0.5">{description}</p>
        )}
        <p className="text-muted-foreground mt-0.5" title={exactTime}>
          {relativeTime}
        </p>
      </div>
    </li>
  );
}

function StatusBadge({ label, variant }: { label: string; variant: string }) {
  // Map variants to colors
  const variantClasses: Record<string, string> = {
    default: "bg-muted text-muted-foreground",
    secondary: "bg-secondary text-secondary-foreground",
    outline: "bg-background text-foreground border border-border",
    destructive: "bg-destructive/10 text-destructive",
    warning: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    success: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  };

  const classes = variantClasses[variant] || variantClasses.default;

  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${classes}`}>
      {label}
    </span>
  );
}
