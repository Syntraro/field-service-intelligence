/**
 * TimesheetEntryCard — canonical day-view entry row renderer.
 *
 * variant "job-row"      → entry inside a job group card. Shows the
 *                          Drive/On-site type label, a nested edit
 *                          button, non-bill indicator, and a clock-out
 *                          button when the entry is running.
 *
 * variant "general-flat" → entry in the general group. Whole row is a
 *                          single edit button; "General Time" text label;
 *                          no clock-out button.
 *
 * EntryTimeRange is the shared time-range pattern for both variants.
 * CompactTimeEntryCard (week view) is a separate component with a
 * different data model (aggregated totals, no time ranges).
 */

import { Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CATEGORY_STYLE, categoryForType } from "./categoryMap";
import { formatDurationCompact, formatTimeOfDay } from "@/lib/timeDuration";

export interface TimesheetEntryCardDatum {
  id: string;
  type: string;
  startAt: string;
  endAt: string | null;
  durationMinutes: number | null;
  billable: boolean;
}

export type TimesheetEntryCardVariant = "job-row" | "general-flat";

export interface TimesheetEntryCardProps {
  variant: TimesheetEntryCardVariant;
  entry: TimesheetEntryCardDatum;
  onEdit: () => void;
  onClockOut: () => void;
  /**
   * job-row only: suppress category label when the parent group header
   * already labels the bucket. Default false.
   */
  hideTypeChip?: boolean;
  /**
   * general-flat only: entry index within the list — drives the
   * border-t separator on every entry after the first.
   */
  index?: number;
}

// Shared time range — "h:mm a → h:mm a" (or "h:mm a → —" for open entries).
function EntryTimeRange({ startAt, endAt }: { startAt: string; endAt: string | null }) {
  return (
    <span className="text-helper font-mono tabular-nums text-muted-foreground">
      {formatTimeOfDay(startAt)} → {formatTimeOfDay(endAt)}
    </span>
  );
}

export function TimesheetEntryCard({
  variant,
  entry,
  onEdit,
  onClockOut,
  hideTypeChip = false,
  index = 0,
}: TimesheetEntryCardProps) {
  const isRunning = entry.endAt == null;

  // ── general-flat variant ───────────────────────────────────────────
  if (variant === "general-flat") {
    return (
      <button
        type="button"
        onClick={onEdit}
        className={cn(
          "w-full flex items-center gap-3 px-3 py-2 text-left text-row transition-colors hover:bg-emerald-50/60",
          index > 0 && "border-t border-slate-100",
        )}
        data-testid={`day-entry-compact-${entry.id}`}
        title="Edit entry"
      >
        <span className="text-helper font-medium text-muted-foreground">General Time</span>
        <EntryTimeRange startAt={entry.startAt} endAt={entry.endAt} />
        <span
          className={cn(
            "ml-auto shrink-0 font-mono text-row font-semibold tabular-nums",
            isRunning && "animate-pulse text-emerald-600",
          )}
          data-testid={`day-entry-compact-duration-${entry.id}`}
        >
          {formatDurationCompact(entry.durationMinutes)}
        </span>
      </button>
    );
  }

  // ── job-row variant ────────────────────────────────────────────────
  const category = categoryForType(entry.type);
  const style = CATEGORY_STYLE[category];

  return (
    <div
      className="group flex items-center gap-2 border-t border-slate-100 px-3 py-2 text-row transition-colors first:border-t-0 hover:bg-slate-50"
      data-testid={`day-entry-compact-${entry.id}`}
      data-category={category}
    >
      <button
        type="button"
        onClick={onEdit}
        className="flex flex-1 items-center gap-2 text-left"
        title="Edit entry"
        data-testid={`day-entry-compact-edit-${entry.id}`}
      >
        {!hideTypeChip && (
          <span
            className="text-helper font-medium text-muted-foreground"
            data-testid={`day-entry-compact-chip-${entry.id}`}
          >
            {style.label}
          </span>
        )}
        <EntryTimeRange startAt={entry.startAt} endAt={entry.endAt} />
        {!entry.billable && category !== "general" && (
          <span className="text-helper text-muted-foreground">non-bill</span>
        )}
      </button>

      <span
        className={cn(
          "shrink-0 font-mono text-row font-semibold tabular-nums",
          isRunning && "animate-pulse text-emerald-600",
        )}
        data-testid={`day-entry-compact-duration-${entry.id}`}
      >
        {formatDurationCompact(entry.durationMinutes)}
      </span>

      {isRunning && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={(e) => {
            e.stopPropagation();
            onClockOut();
          }}
          className="h-7 shrink-0 px-2"
          data-testid={`day-entry-compact-clockout-${entry.id}`}
        >
          <Square className="mr-1 h-3 w-3" />
          Clock out
        </Button>
      )}
    </div>
  );
}
