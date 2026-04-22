/**
 * VisitTeamAssignment — canonical team/crew selector for visit assignment.
 *
 * 2026-04-12 UI consistency pass: one visit-assignment UX everywhere.
 *
 * Lifted verbatim from the Visit Edit modal's inline "Team" block so the
 * Schedule Visit modal (AddVisitDialog) and any future visit-assignment
 * surface share a single selector pattern:
 *   - "Assign" popover lists available technicians (hides already-selected)
 *   - Selected technicians render as removable chips with name labels
 *   - Empty state reads "Unassigned"
 *   - Multi-select by construction — single-select is just a crew of 1
 *
 * Data shape: `string[]` of technician user IDs. No `primaryTechnicianId`
 * concept — jobs don't own a primary, and visits carry the crew as an array.
 */

import { Plus, User, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";
import { getMemberDisplayName } from "@/lib/displayName";

export interface VisitTeamAssignmentProps {
  /** Canonical crew list — the visit's `assignedTechnicianIds`. */
  value: string[];
  /** Commit a new crew list. Caller owns state. */
  onChange: (next: string[]) => void;
  /** Optional section label. Defaults to "Team" to match Edit Visit modal. */
  label?: string;
  /** Optional wrapper className override (defaults to Edit-Visit styling). */
  className?: string;
}

export function VisitTeamAssignment({
  value,
  onChange,
  label = "Team",
  className,
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
          <PopoverContent className="w-48 p-1" align="end">
            <div className="text-xs font-medium text-slate-400 px-2 py-1.5 border-b mb-1">
              Select team member
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
