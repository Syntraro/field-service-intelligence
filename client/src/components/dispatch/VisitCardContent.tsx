/**
 * VisitCardContent — shared visit content renderer for all dispatch card surfaces.
 *
 * Pure presentation component: no hooks, no state, no side effects.
 * Renders the inner content rows (name, summary, duration, location, job number,
 * team badge, status indicators) in a canonical hierarchy.
 *
 * Layout containers, interaction (drag/resize/click), and positioning remain
 * in the surface-specific wrapper components.
 *
 * Variants:
 *   - "timeline-wide":  2-row; name + team badge, summary + duration
 *   - "timeline-narrow": 1-row compressed; name only
 *   - "unscheduled":    2–3 rows; name + priority, summary, location + duration + job#
 *   - "week":           1-row compressed; dot + name + team badge + duration
 */
import { memo } from "react";
import type { DispatchVisit } from "./dispatchPreviewTypes";
import { visitStatusDot, formatDuration, isCompletedStatus } from "./dispatchPreviewUtils";
import { Clock, Users, CheckCircle2 } from "lucide-react";

export type VisitCardVariant = "timeline-wide" | "timeline-narrow" | "unscheduled" | "week";

interface VisitCardContentProps {
  visit: DispatchVisit;
  variant: VisitCardVariant;
  /** Override duration display (e.g., during resize preview) */
  displayDuration?: number;
}

/** Canonical team badge — identical rendering across all surfaces */
function TeamBadge({ count }: { count: number }) {
  return (
    <span className="flex items-center gap-0.5 rounded bg-emerald-100 px-1 py-px text-[8px] font-semibold text-emerald-700 flex-shrink-0">
      <Users className="h-2 w-2" />{count}
    </span>
  );
}

export const VisitCardContent = memo(function VisitCardContent({
  visit,
  variant,
  displayDuration,
}: VisitCardContentProps) {
  // A visit looks "done" only when the PARENT JOB is closed (completed/invoiced/archived).
  // A completed visit on an active job should NOT appear grayed-out.
  const jobClosed = visit.jobStatus === "completed" || visit.jobStatus === "invoiced" || visit.jobStatus === "archived";
  const isCompleted = isCompletedStatus(visit.status) && jobClosed;
  const isTeamVisit = visit.technicianIds.length > 1;
  const duration = displayDuration ?? visit.durationMinutes;
  const nameStrike = isCompleted ? "line-through" : "";

  // Concise location line: locationName (if distinct from customerName), else street address
  const locationLine = visit.locationName && visit.locationName !== visit.customerName
    ? visit.locationName
    : visit.locationAddress
      ? [visit.locationAddress, visit.locationCity].filter(Boolean).join(", ")
      : null;

  // ── Timeline Wide: 2 rows ──
  if (variant === "timeline-wide") {
    return (
      <>
        <div className="flex items-center gap-1 truncate">
          {isCompleted && <CheckCircle2 className="h-3 w-3 flex-shrink-0 text-slate-400" />}
          <span className={`truncate text-[11px] font-semibold ${nameStrike}`}>{visit.customerName}</span>
          {locationLine && <span className="truncate text-[10px] text-muted-foreground">— {locationLine}</span>}
          {isTeamVisit && <TeamBadge count={visit.technicianIds.length} />}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="truncate">{visit.summary}</span>
          <span className="flex items-center gap-0.5 whitespace-nowrap">
            <Clock className="h-2.5 w-2.5" />{formatDuration(duration)}
          </span>
        </div>
      </>
    );
  }

  // ── Timeline Narrow: 1 row ──
  if (variant === "timeline-narrow") {
    return (
      <div className="flex items-center gap-1 truncate">
        {isCompleted && <CheckCircle2 className="h-2.5 w-2.5 flex-shrink-0 text-slate-400" />}
        <span className={`truncate text-[10px] font-semibold ${nameStrike}`}>{visit.customerName}</span>
      </div>
    );
  }

  // ── Unscheduled: 2–3 rows ──
  if (variant === "unscheduled") {
    return (
      <div className="min-w-0 flex-1">
        {/* Row 1: status dot + name + priority */}
        <div className="flex items-center gap-1 leading-tight">
          {isCompleted
            ? <CheckCircle2 className="h-3 w-3 flex-shrink-0 text-slate-400" />
            : <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${visitStatusDot(visit.status)}`} />
          }
          <span className={`truncate text-[11px] font-semibold text-foreground ${nameStrike}`}>{visit.customerName}</span>
          {visit.priority !== "normal" && (
            <span className={`rounded px-1 py-px text-[8px] font-bold uppercase flex-shrink-0 ${
              visit.priority === "urgent" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
            }`}>{visit.priority === "urgent" ? "!" : "H"}</span>
          )}
        </div>
        {/* Row 2: summary (if present) */}
        {visit.summary && (
          <p className="truncate text-[10px] text-muted-foreground leading-tight mt-px pl-2.5">{visit.summary}</p>
        )}
        {/* Row 3: location · duration · #jobNumber */}
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground leading-tight mt-px pl-2.5">
          <span className="truncate">{visit.locationName}</span>
          <span className="text-slate-300 flex-shrink-0">&middot;</span>
          <span className="whitespace-nowrap flex-shrink-0 font-medium text-slate-500">{formatDuration(duration)}</span>
          <span className="text-slate-300 flex-shrink-0">&middot;</span>
          <span className="text-slate-400 flex-shrink-0 text-[9px]">#{visit.jobNumber}</span>
        </div>
      </div>
    );
  }

  // ── Week: 1 row compressed ──
  // variant === "week"
  return (
    <>
      {isCompleted
        ? <CheckCircle2 className="h-2.5 w-2.5 flex-shrink-0 text-slate-400" />
        : <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${visitStatusDot(visit.status)}`} />
      }
      <span className={`truncate text-[10px] font-semibold ${isCompleted ? `${nameStrike} text-muted-foreground` : "text-foreground"}`}>{visit.customerName}</span>
      {locationLine && <span className="truncate text-[9px] text-muted-foreground">— {locationLine}</span>}
      {isTeamVisit && <TeamBadge count={visit.technicianIds.length} />}
      <span className="text-[9px] text-muted-foreground whitespace-nowrap flex-shrink-0">
        {formatDuration(duration)}
      </span>
    </>
  );
});
