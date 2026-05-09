/**
 * CompactTimeEntryCard — canonical compact entry renderer for the
 * weekly timesheet stack view (2026-05-09).
 *
 * Supports two variants:
 *
 *   "job"     — bordered card with left blue accent. Top row: job number
 *               (not bold, muted) aligned left + duration aligned right.
 *               Optional second row: client name (medium). Optional third
 *               row: job summary (helper, muted, clamped to 2 lines).
 *
 *   "general" — softer green-tinted row. Single horizontal line:
 *               label left, duration right. Thin green left accent.
 *               Smaller vertical footprint than job cards.
 *
 * This is the SINGLE canonical renderer for WeekStackPage entry rows.
 * It is also the target renderer for a future DayView migration.
 * Do NOT reintroduce inline entry rendering in WeekStackPage.
 *
 * Duration format: colon style ("1:30") via formatHm — matches the
 * week-view footer totals so the eye can compare entry vs day total.
 *
 * Interaction: the whole card is a single <button>. onClick is the sole
 * interaction affordance — callers route to the canonical Day View.
 */

import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatHm } from "@/components/timesheets/stack/buildWeekStackViewModel";

export interface CompactTimeEntryCardProps {
  variant: "job" | "general";
  /** Total minutes for this collapsed row (sum of underlying entries). */
  totalMinutes: number;
  /** Routes the user to the Day View for this day. Whole card is the target. */
  onClick: () => void;
  /** data-testid forwarded to the root <button>. */
  testId?: string;

  // ── Job variant props ───────────────────────────────────────────────
  jobNumber?: number | null;
  locationName?: string | null;
  jobSummary?: string | null;
  /** True when any underlying entry has endAt === null (still running). */
  hasOpenEntry?: boolean;
  /** True for the synthetic unallocated-session row. Changes the label. */
  isUnallocated?: boolean;
}

export function CompactTimeEntryCard({
  variant,
  totalMinutes,
  onClick,
  testId,
  jobNumber,
  locationName,
  jobSummary,
  hasOpenEntry,
  isUnallocated,
}: CompactTimeEntryCardProps) {
  // ── General variant ─────────────────────────────────────────────────
  if (variant === "general") {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "w-full text-left",
          "flex items-center justify-between gap-2",
          "px-2.5 py-1.5",
          "border border-slate-200 border-l-2 border-l-emerald-400",
          "rounded",
          "bg-emerald-50/40 hover:bg-emerald-50/70",
          "transition-colors",
        )}
        data-testid={testId}
      >
        <span className="text-row text-muted-foreground leading-tight">
          {isUnallocated ? "Unallocated" : "General Time"}
        </span>
        <span
          className="text-row font-semibold tabular-nums text-foreground shrink-0"
          data-card-duration
        >
          {formatHm(totalMinutes)}
        </span>
      </button>
    );
  }

  // ── Job variant ─────────────────────────────────────────────────────
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left",
        "px-2.5 py-2",
        "border border-slate-200 border-l-2 border-l-blue-400",
        "rounded",
        "bg-white hover:bg-slate-50",
        "transition-colors",
      )}
      data-testid={testId}
    >
      <div className="grid grid-cols-[1fr_auto] gap-2 items-start">
        <div className="min-w-0">
          {/* Job number — NOT bold per spec. Muted to let client name lead. */}
          <span className="text-row text-muted-foreground tabular-nums leading-tight">
            #{jobNumber ?? "—"}
          </span>
          {locationName && (
            <div
              className="mt-0.5 text-row font-medium text-foreground leading-tight truncate"
              title={locationName}
            >
              {locationName}
            </div>
          )}
          {jobSummary && (
            <div
              className="mt-0.5 text-helper text-muted-foreground leading-tight line-clamp-2"
              title={jobSummary}
            >
              {jobSummary}
            </div>
          )}
          {hasOpenEntry && (
            <div className="mt-1 flex items-center gap-1 text-helper text-amber-600">
              <AlertTriangle className="h-2.5 w-2.5 shrink-0" aria-hidden />
              Unfinished entry
            </div>
          )}
        </div>
        {/* Duration — most visually prominent element, right-aligned. */}
        <span
          className="text-row font-semibold tabular-nums text-foreground shrink-0 leading-tight"
          data-card-duration
        >
          {formatHm(totalMinutes)}
        </span>
      </div>
    </button>
  );
}
