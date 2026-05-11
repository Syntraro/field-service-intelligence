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
import { TimeEntryRowCompact, type TimeEntryRowCompactDatum } from "./TimeEntryRowCompact";
import { TimesheetEntryCard } from "./TimesheetEntryCard";
import { formatDurationHm } from "@/lib/timeDuration";

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
  onEditEntry: (entry: JobGroupEntry) => void;
  onClockOutEntry: (entryId: string) => void;
  /** Optional click handlers for the header job/location identifiers. */
  onJobClick?: (jobId: string) => void;
  onLocationClick?: (locationId: string) => void;
}

export function JobTimeGroupCard({
  variant,
  jobId,
  jobNumber,
  jobSummary,
  locationName,
  locationId,
  entries,
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
        className="overflow-hidden rounded-md border border-slate-200 border-l-2 border-l-emerald-400 bg-emerald-50/30"
        data-testid={groupTestId}
        data-variant="general"
      >
        <div data-testid={`${groupTestId}-rows`}>
          {entries.map((entry, idx) => (
            <TimesheetEntryCard
              key={entry.id}
              variant="general-flat"
              entry={entry}
              onEdit={() => onEditEntry(entry)}
              onClockOut={() => onClockOutEntry(entry.id)}
              index={idx}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-lg border border-slate-200 border-l-2 border-l-blue-400 bg-white shadow-sm"
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
            className="shrink-0 text-row text-muted-foreground tabular-nums hover:underline disabled:no-underline"
            data-testid="job-group-job-number"
          >
            #{jobNumber ?? "?"}
          </button>
          {locationName && (
            <>
              <span className="shrink-0 text-row text-muted-foreground">—</span>
              <button
                type="button"
                onClick={() => locationId && onLocationClick?.(locationId)}
                disabled={!locationId}
                className="truncate text-row font-medium text-primary hover:underline disabled:no-underline"
                data-testid="job-group-location"
              >
                {locationName}
              </button>
            </>
          )}
          {jobSummary && (
            <>
              <span className="shrink-0 text-row font-medium text-muted-foreground">/</span>
              <span
                className="truncate text-row text-muted-foreground"
                data-testid="job-group-summary"
                title={jobSummary}
              >
                {jobSummary}
              </span>
            </>
          )}
        </div>
        <span className="ml-auto shrink-0 text-helper text-muted-foreground tabular-nums">
          Total{" "}
          <span className="ml-1 font-mono font-semibold tabular-nums text-foreground">
            {formatDurationHm(total)}
          </span>
        </span>
      </div>

      {/* Body — job variant rows. Each row keeps its Drive/On-site chip
          so a single card's mixed rows stay distinguishable. */}
      <div data-testid={`${groupTestId}-rows`}>
        {entries.map((entry) => (
          <TimeEntryRowCompact
            key={entry.id}
            entry={entry}
            onEdit={() => onEditEntry(entry)}
            onClockOut={() => onClockOutEntry(entry.id)}
          />
        ))}
      </div>
    </div>
  );
}
