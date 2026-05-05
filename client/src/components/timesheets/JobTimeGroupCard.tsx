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
import { Briefcase } from "lucide-react";
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

  return (
    <div
      className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
      data-testid={groupTestId}
      data-variant={variant}
    >
      {/* Header */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-2 border-b px-3 py-2",
          variant === "general"
            ? "bg-slate-50/80 border-slate-200"
            : "bg-slate-50/60 border-slate-100",
        )}
      >
        {variant === "general" ? (
          <>
            <Briefcase className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-sm font-semibold text-slate-700">
              General / Unbillable
            </span>
          </>
        ) : (
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
        )}
        <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
          Total{" "}
          <strong className="ml-1 font-mono text-foreground">
            {formatMinutes(total)}
          </strong>
        </span>
      </div>

      {/* Body — compact rows. Edit-on-click opens the focused
          TimeEntryEditModal (DayView owns the modal mount); we no
          longer render an inline editor in place of the row. */}
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
