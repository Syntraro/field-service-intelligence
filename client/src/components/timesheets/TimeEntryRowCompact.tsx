/**
 * TimeEntryRowCompact — Compact entry row for use inside JobTimeGroupCard
 * (2026-05-04 v2). One line per entry: [type pill] start → end · duration.
 * No duplicate job number / client text — the group card header carries
 * those; the row keeps a single reading direction.
 *
 * Whole row is the click target. Caller routes locked entries to the
 * existing TimeEntryModal for the manager-override flow; unlocked
 * entries open the inline editor.
 */
import { format, parseISO } from "date-fns";
import { Lock, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CATEGORY_STYLE, categoryForType } from "./categoryMap";

export interface TimeEntryRowCompactDatum {
  id: string;
  type: string;
  startAt: string;
  endAt: string | null;
  durationMinutes: number | null;
  billable: boolean;
}

export interface TimeEntryRowCompactProps {
  entry: TimeEntryRowCompactDatum;
  isLocked: boolean;
  onEdit: () => void;
  onClockOut: () => void;
  /**
   * 2026-05-05: when the parent group already labels the bucket
   * (e.g. the General card header reads "General"), suppress the
   * per-row category chip to avoid duplicate hierarchy. Default false
   * preserves the existing job-card behaviour where rows show their
   * Drive / On-site chip alongside the job header.
   */
  hideTypeChip?: boolean;
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return format(parseISO(iso), "h:mm a");
}

function formatDurationCompact(minutes: number | null): string {
  if (minutes == null) return "Live";
  if (minutes === 0) return "0m";
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs === 0) return `${mins}m`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

export function TimeEntryRowCompact({
  entry,
  isLocked,
  onEdit,
  onClockOut,
  hideTypeChip = false,
}: TimeEntryRowCompactProps) {
  const category = categoryForType(entry.type);
  const style = CATEGORY_STYLE[category];
  const isRunning = entry.endAt == null;

  return (
    <div
      className={cn(
        "group flex items-center gap-2 border-t border-slate-100 px-3 py-2 text-sm transition-colors first:border-t-0 hover:bg-slate-50",
        isLocked && "opacity-75",
      )}
      data-testid={`day-entry-compact-${entry.id}`}
      data-category={category}
    >
      <button
        type="button"
        onClick={onEdit}
        className="flex flex-1 items-center gap-2 text-left"
        title={isLocked ? "Open locked entry" : "Edit entry"}
        data-testid={`day-entry-compact-edit-${entry.id}`}
      >
        {!hideTypeChip && (
          <span
            className={cn(
              "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
              style.chip,
            )}
            data-testid={`day-entry-compact-chip-${entry.id}`}
          >
            {style.label}
          </span>
        )}
        <span className="font-mono tabular-nums text-foreground/70">
          {formatTime(entry.startAt)} → {formatTime(entry.endAt)}
        </span>
        {!entry.billable && category !== "general" && (
          <span className="text-[11px] text-muted-foreground">non-bill</span>
        )}
        {isLocked && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600">
            <Lock className="h-3 w-3" /> Locked
          </span>
        )}
      </button>

      <span
        className={cn(
          "shrink-0 font-mono text-sm font-bold tabular-nums",
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
          className="h-7 shrink-0 px-2 text-xs"
          data-testid={`day-entry-compact-clockout-${entry.id}`}
        >
          <Square className="mr-1 h-3 w-3" />
          Clock out
        </Button>
      )}
    </div>
  );
}
