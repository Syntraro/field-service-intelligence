/**
 * JobTimeGroupCard — Grouped-by-job card for the Day View
 * (2026-05-04 v3 UX refinement). One card per job, plus a single
 * "general" variant for entries with no jobId (or general-type entries
 * per spec).
 *
 * Header: job number + client/location + group total.
 * Body: ordered TimeEntryRowCompact rows, no duplicate job/client text.
 *
 * Edit-on-click is handled by the parent (DayView) which mounts a
 * focused `TimeEntryEditModal`. This card never expands inline.
 */
import { format, parseISO } from "date-fns";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { TimeEntryRowCompact, type TimeEntryRowCompactDatum } from "./TimeEntryRowCompact";

export interface JobGroupEntry extends TimeEntryRowCompactDatum {
  jobId: string | null;
  jobNumber: number | null;
  jobSummary: string | null;
  locationName: string | null;
  locationId: string | null;
  notes: string | null;
}

export interface JobTimeGroupCardProps {
  /** "general" group rendered with the special title; otherwise "job". */
  variant: "job" | "general";
  /** Job-context fields only used when variant === "job". */
  jobId?: string | null;
  jobNumber?: number | null;
  jobSummary?: string | null;
  locationName?: string | null;
  locationId?: string | null;
  /** Already-sorted entries belonging to this group. */
  entries: JobGroupEntry[];
  isEntryLocked: (entry: JobGroupEntry) => boolean;
  onEditEntry: (entry: JobGroupEntry) => void;
  onClockOutEntry: (entryId: string) => void;
  /** Optional click handlers for the header job/location identifiers. */
  onJobClick?: (jobId: string) => void;
  onLocationClick?: (locationId: string) => void;
}

function formatMinutes(minutes: number): string {
  if (minutes === 0) return "0h 0m";
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hrs}h ${mins}m`;
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

export function JobTimeGroupCard({
  variant,
  jobId,
  jobNumber,
  jobSummary,
  locationName,
  locationId,
  entries,
  isEntryLocked,
  onEditEntry,
  onClockOutEntry,
  onJobClick,
  onLocationClick,
}: JobTimeGroupCardProps) {
  const total = entries.reduce((sum, e) => sum + (e.durationMinutes ?? 0), 0);
  const groupTestId =
    variant === "general"
      ? "day-group-general"
      : `day-group-job-${jobId ?? "unknown"}`;

  // 2026-05-05: General variant collapsed from "header + body rows" to a
  // single flat row per entry. Each row carries the "General" label inline,
  // start→end time range, lock indicator (when applicable), and total
  // duration right-aligned. No card header, no separate body section.
  if (variant === "general") {
    return (
      <div
        className="overflow-hidden rounded-md border border-slate-200 bg-white"
        data-testid={groupTestId}
        data-variant="general"
      >
        <div data-testid={`${groupTestId}-rows`}>
          {entries.map((entry, idx) => {
            const locked = isEntryLocked(entry);
            const isRunning = entry.endAt == null;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => onEditEntry(entry)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50",
                  idx > 0 && "border-t border-slate-100",
                  locked && "opacity-75",
                )}
                data-testid={`day-entry-compact-${entry.id}`}
                title={locked ? "Open locked entry" : "Edit entry"}
              >
                <span className="text-sm font-semibold text-slate-700">General</span>
                <span className="font-mono tabular-nums text-foreground/70">
                  {formatTime(entry.startAt)} → {formatTime(entry.endAt)}
                </span>
                {locked && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600">
                    <Lock className="h-3 w-3" /> Locked
                  </span>
                )}
                <span
                  className={cn(
                    "ml-auto shrink-0 font-mono text-sm font-bold tabular-nums",
                    isRunning && "animate-pulse text-emerald-600",
                  )}
                  data-testid={`day-entry-compact-duration-${entry.id}`}
                >
                  {formatDurationCompact(entry.durationMinutes)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
      data-testid={groupTestId}
      data-variant={variant}
    >
      {/* Header — job variant only. */}
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 bg-slate-50/60 border-slate-100">
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5 truncate">
          <button
            type="button"
            onClick={() => jobId && onJobClick?.(jobId)}
            disabled={!jobId}
            className="shrink-0 text-sm font-bold text-primary hover:underline disabled:no-underline tabular-nums"
            data-testid="job-group-job-number"
          >
            #{jobNumber ?? "?"}
          </button>
          {locationName && (
            <>
              <span className="shrink-0 text-sm font-semibold text-slate-400">—</span>
              <button
                type="button"
                onClick={() => locationId && onLocationClick?.(locationId)}
                disabled={!locationId}
                className="truncate text-sm font-semibold text-primary hover:underline disabled:no-underline"
                data-testid="job-group-location"
              >
                {locationName}
              </button>
            </>
          )}
          {jobSummary && (
            <>
              <span className="shrink-0 text-sm font-medium text-slate-400">/</span>
              <span
                className="truncate text-sm text-slate-600"
                data-testid="job-group-summary"
                title={jobSummary}
              >
                {jobSummary}
              </span>
            </>
          )}
        </div>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
          Total{" "}
          <strong className="ml-1 font-mono text-foreground">
            {formatMinutes(total)}
          </strong>
        </span>
      </div>

      {/* Body — job variant rows. Each row keeps its Drive/On-site chip
          so a single card's mixed rows stay distinguishable. */}
      <div data-testid={`${groupTestId}-rows`}>
        {entries.map((entry) => (
          <TimeEntryRowCompact
            key={entry.id}
            entry={entry}
            isLocked={isEntryLocked(entry)}
            onEdit={() => onEditEntry(entry)}
            onClockOut={() => onClockOutEntry(entry.id)}
          />
        ))}
      </div>
    </div>
  );
}
