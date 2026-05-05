/**
 * TimelineRail — Chronological dot-and-line rail for the Day View
 * (2026-05-04 v2: grouped-cards refactor).
 *
 * Independent of card layout. Renders one labeled dot per entry start
 * time, ordered chronologically, color-coded by UI category. The right-
 * hand column displays the same data grouped by job, but the rail keeps
 * the "what did the day look like in time" reading.
 *
 * Pure / no fetch — caller passes pre-sorted entries.
 */
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { CATEGORY_STYLE, categoryForType } from "./categoryMap";

export interface TimelineRailEntry {
  id: string;
  type: string;
  startAt: string;
  endAt: string | null;
}

export interface TimelineRailProps {
  entries: TimelineRailEntry[];
  className?: string;
}

function formatTimeLabel(iso: string): string {
  return format(parseISO(iso), "h:mm a");
}

export function TimelineRail({ entries, className }: TimelineRailProps) {
  // Defensive sort — caller is expected to pass sorted, but pinning here
  // protects against rail-vs-cards drift if a future refactor forgets.
  const sorted = [...entries].sort(
    (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
  );

  if (sorted.length === 0) {
    return (
      <div
        className={cn(
          "flex shrink-0 flex-col items-center justify-center px-3 py-6 text-xs text-muted-foreground",
          className,
        )}
        data-testid="day-timeline-rail"
      >
        —
      </div>
    );
  }

  return (
    <div
      className={cn("relative flex shrink-0 flex-col items-end gap-3 pr-3", className)}
      data-testid="day-timeline-rail"
      aria-label="Time entries timeline"
    >
      {/* The vertical line behind the dots. Anchored to the dot column
          so it visually connects all dots without being card-aligned. */}
      <span
        aria-hidden
        className="pointer-events-none absolute right-[5px] top-1.5 bottom-1.5 w-px bg-slate-200"
      />
      {sorted.map((entry) => {
        const cat = categoryForType(entry.type);
        const style = CATEGORY_STYLE[cat];
        const isRunning = entry.endAt == null;
        return (
          <div
            key={entry.id}
            className="flex items-center gap-2 z-[1]"
            data-testid={`rail-marker-${entry.id}`}
            data-category={cat}
          >
            <span className="text-[11px] font-mono tabular-nums text-muted-foreground">
              {formatTimeLabel(entry.startAt)}
            </span>
            <span
              className={cn(
                "h-2.5 w-2.5 rounded-full ring-2 ring-white",
                style.dot,
                isRunning && "animate-pulse",
              )}
              aria-hidden
            />
          </div>
        );
      })}
    </div>
  );
}
