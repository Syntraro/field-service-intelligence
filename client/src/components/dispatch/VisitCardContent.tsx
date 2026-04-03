/**
 * VisitCardContent — shared visit content renderer for all dispatch card surfaces.
 *
 * Pure presentation component: no hooks, no state, no side effects.
 * Renders the inner content rows in a canonical hierarchy.
 *
 * Layout containers, interaction (drag/resize/click), and positioning remain
 * in the surface-specific wrapper components.
 *
 * Variants:
 *   - "timeline-wide":  2-line max; Company (bold) — description (lighter) clamped
 *   - "timeline-narrow": 1-line; Company (bold) — description (lighter) truncated
 *   - "unscheduled":    2–3 rows; name + priority, summary
 *   - "week-calendar":  natural wrap; Company (bold) — description (lighter) fills card height
 *   - "week":           1-line compressed; Company (bold) — description (lighter) truncated
 *   - "month":          2-line max; name + summary (matches Unscheduled typography)
 *
 * 2026-03-31: Day/Week variants simplified to "Company — description" across
 * 2 lines max. Address and duration removed from visible card body.
 * Month completed jobs now show clear strikethrough treatment.
 */
import { memo } from "react";
import type { DispatchVisit } from "./dispatchPreviewTypes";
import { visitStatusDot, isCompletedStatus } from "./dispatchPreviewUtils";
import { Users, CheckCircle2 } from "lucide-react";

export type VisitCardVariant = "timeline-wide" | "timeline-narrow" | "unscheduled" | "week" | "week-calendar" | "month";

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
}: VisitCardContentProps) {
  // A visit looks "done" only when the PARENT JOB is closed (completed/invoiced/archived).
  // A completed visit on an active job should NOT appear grayed-out.
  const jobClosed = visit.jobStatus === "completed" || visit.jobStatus === "invoiced" || visit.jobStatus === "archived";
  const isCompleted = isCompletedStatus(visit.status) && jobClosed;
  const isTeamVisit = visit.technicianIds.length > 1;
  const nameStrike = isCompleted ? "line-through" : "";

  // ── Timeline Wide: 2-line company + description ──
  // Pure inline text inside -webkit-box for correct line clamping.
  // No flex/block children inside the clamp container.
  if (variant === "timeline-wide") {
    return (
      <>
        <p className={`text-[13px] leading-snug m-0 min-w-0 overflow-hidden break-words ${nameStrike}`}
           style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>
          <span className="font-semibold text-slate-900">{visit.customerName}</span>
          {visit.summary && <span className="text-slate-600"> — {visit.summary}</span>}
        </p>
        {isTeamVisit && <TeamBadge count={visit.technicianIds.length} />}
      </>
    );
  }

  // ── Timeline Narrow: 1-line company + description truncated ──
  if (variant === "timeline-narrow") {
    return (
      <p className={`text-[11px] leading-snug m-0 truncate ${nameStrike}`}>
        <span className="font-semibold text-slate-900">{visit.customerName}</span>
        {visit.summary && <span className="text-slate-600"> — {visit.summary}</span>}
      </p>
    );
  }

  // ── Unscheduled: 2 rows — company name + summary only ──
  if (variant === "unscheduled") {
    return (
      <div className="min-w-0 flex-1">
        {/* Row 1: status dot + name + priority */}
        <div className="flex items-center gap-1 leading-snug">
          {isCompleted
            ? <CheckCircle2 className="h-3 w-3 flex-shrink-0 text-slate-400" />
            : <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${visitStatusDot(visit.status)}`} />
          }
          <span className={`truncate text-[13px] font-semibold text-slate-900 ${nameStrike}`}>{visit.customerName}</span>
          {visit.priority !== "normal" && (
            <span className={`rounded px-1 py-px text-[9px] font-bold uppercase flex-shrink-0 ${
              visit.priority === "urgent" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
            }`}>{visit.priority === "urgent" ? "!" : "H"}</span>
          )}
        </div>
        {/* Row 2: summary (if present) */}
        {visit.summary && (
          <p className={`truncate text-[13px] text-slate-600 leading-snug mt-0.5 pl-2.5 ${nameStrike}`}>{visit.summary}</p>
        )}
      </div>
    );
  }

  // ── Week Calendar: natural wrap within card height ──
  // No line-clamp — text wraps downward to fill available card space.
  // break-words ensures long company names wrap within narrow week columns.
  if (variant === "week-calendar") {
    return (
      <>
        <p className={`text-[13px] leading-snug m-0 min-w-0 overflow-hidden break-words ${nameStrike}`}>
          <span className="font-semibold text-slate-900">{visit.customerName}</span>
          {visit.summary && <span className="text-slate-600"> — {visit.summary}</span>}
        </p>
        {isTeamVisit && <TeamBadge count={visit.technicianIds.length} />}
      </>
    );
  }

  // ── Month: compact 2-line — name + summary ──
  // Typography matches Unscheduled variant. Completed jobs show strikethrough on all text.
  if (variant === "month") {
    return (
      <div className="min-w-0 overflow-hidden" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>
        <div className="flex items-center gap-1 leading-snug">
          {isCompleted
            ? <CheckCircle2 className="h-3 w-3 flex-shrink-0 text-slate-400" />
            : <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${visitStatusDot(visit.status)}`} />
          }
          <span className={`text-[13px] font-semibold ${nameStrike} ${isCompleted ? "text-muted-foreground" : "text-slate-900"}`}>
            {visit.customerName}
          </span>
          {visit.priority !== "normal" && (
            <span className={`rounded px-0.5 py-px text-[8px] font-bold uppercase flex-shrink-0 ${
              visit.priority === "urgent" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
            }`}>{visit.priority === "urgent" ? "!" : "H"}</span>
          )}
        </div>
        {visit.summary && (
          <p className={`truncate text-[13px] leading-snug pl-2.5 ${nameStrike} ${isCompleted ? "text-muted-foreground" : "text-slate-600"}`}>{visit.summary}</p>
        )}
      </div>
    );
  }

  // ── Week: 1-line company + description truncated ──
  // variant === "week" — renders into parent's flex row
  return (
    <>
      {isCompleted
        ? <CheckCircle2 className="h-2.5 w-2.5 flex-shrink-0 text-slate-400" />
        : <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${visitStatusDot(visit.status)}`} />
      }
      <p className={`truncate text-[10px] m-0 min-w-0 ${nameStrike}`}>
        <span className={`font-semibold ${isCompleted ? "text-muted-foreground" : "text-foreground"}`}>{visit.customerName}</span>
        {visit.summary && <span className={`${isCompleted ? "text-muted-foreground" : "text-slate-500"}`}> — {visit.summary}</span>}
      </p>
      {isTeamVisit && <TeamBadge count={visit.technicianIds.length} />}
    </>
  );
});
