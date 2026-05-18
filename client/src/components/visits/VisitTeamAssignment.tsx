/**
 * VisitTeamAssignment — canonical team/crew selector for visit assignment.
 *
 * 2026-04-12 UI consistency pass: one visit-assignment UX everywhere.
 * 2026-05-17 Phase 4 Skill-Aware Dispatch: optional `jobId` prop enables
 *   ranked recommendations above the standard technician list. When `jobId`
 *   is provided, the popover shows a "Recommended" section (via
 *   AssignmentRecommendationPanel) before the full technician list.
 *   Recommendations are transparent (score + icons) and never auto-assign.
 *
 * Data shape: `string[]` of technician user IDs. No `primaryTechnicianId`
 * concept — jobs don't own a primary, and visits carry the crew as an array.
 */

import { Plus, User, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";
import { getMemberDisplayName } from "@/lib/displayName";
import { AssignmentRecommendationPanel } from "@/components/dispatch/AssignmentRecommendationPanel";

export interface VisitTeamAssignmentProps {
  /** Canonical crew list — the visit's `assignedTechnicianIds`. */
  value: string[];
  /** Commit a new crew list. Caller owns state. */
  onChange: (next: string[]) => void;
  /** Optional section label. Defaults to "Team" to match Edit Visit modal. */
  label?: string;
  /** Optional wrapper className override (defaults to Edit-Visit styling). */
  className?: string;
  /**
   * When provided, the popover shows ranked assignment recommendations
   * derived from the job's skill requirements and candidate utilization.
   * Pass the job's ID (not the visit ID). Optional — omit for skill-agnostic
   * assignment surfaces.
   */
  jobId?: string;
  /**
   * Target date for availability checking in recommendations (YYYY-MM-DD).
   * Defaults to today when omitted.
   */
  visitDate?: string;
}

export function VisitTeamAssignment({
  value,
  onChange,
  label = "Team",
  className,
  jobId,
  visitDate,
}: VisitTeamAssignmentProps) {
  const { teamMembers } = useTechniciansDirectory();
  const techOptions = teamMembers.map((t) => ({
    id: t.id,
    displayName: getMemberDisplayName(t),
  }));

  const handleAdd = (id: string) => {
    if (value.includes(id)) return;
    onChange([...value, id]);
  };
  const handleRemove = (id: string) => {
    onChange(value.filter((t) => t !== id));
  };

  const available = techOptions.filter((t) => !value.includes(t.id));

  return (
    <div className={className ?? "rounded-lg border border-slate-200 bg-white px-4 py-2.5"}>
      <div className="flex items-center justify-between mb-1.5">
        <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
          {label}
        </h3>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 flex items-center gap-0.5"
              data-testid="button-assign-technician"
            >
              <Plus className="h-3 w-3" />
              Assign
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-1" align="end">
            <TooltipProvider delayDuration={300}>
              {/* ── Recommendations section (when jobId provided) ──── */}
              {jobId && (
                <AssignmentRecommendationPanel
                  jobId={jobId}
                  date={visitDate}
                  onSelect={handleAdd}
                  selectedIds={value}
                />
              )}

              {/* ── All technicians ───────────────────────────────── */}
              <div className="text-xs font-medium text-slate-400 px-2 py-1.5 border-b mb-1">
                {jobId ? "All team members" : "Select team member"}
              </div>
              {available.length === 0 ? (
                <div className="text-xs text-slate-400 px-2 py-2">No available</div>
              ) : (
                available.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleAdd(t.id)}
                    className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-slate-100 flex items-center gap-2"
                    data-testid={`option-technician-${t.id}`}
                  >
                    <User className="h-3.5 w-3.5 text-slate-400" />
                    {t.displayName}
                  </button>
                ))
              )}
            </TooltipProvider>
          </PopoverContent>
        </Popover>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {value.length === 0 && (
          <span className="text-xs text-slate-400 italic">Unassigned</span>
        )}
        {value.map((tid) => {
          const tech = techOptions.find((t) => t.id === tid);
          if (!tech) return null;
          return (
            <span
              key={tid}
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 pl-2.5 pr-1 py-0.5 text-xs font-medium text-slate-700"
              data-testid={`chip-technician-${tid}`}
            >
              {tech.displayName}
              <button
                type="button"
                onClick={() => handleRemove(tid)}
                className="h-3.5 w-3.5 rounded-full hover:bg-slate-300/50 flex items-center justify-center"
                aria-label={`Remove ${tech.displayName}`}
              >
                <X className="h-2 w-2" />
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}
