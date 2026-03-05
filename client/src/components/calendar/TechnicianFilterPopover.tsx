/**
 * TechnicianFilterPopover - Technician visibility filter for calendar header
 *
 * Phase 5 of Calendar Page UI Rewrite (2026-03-04)
 * Fix (2026-03-05): Names as primary text, color dot secondary.
 * Uses tech.fullName || tech.displayName || `${firstName} ${lastName}` for robust name resolution.
 */

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Users } from "lucide-react";
import { TECHNICIAN_COLORS } from "./calendarUtils";

/** Resolve technician display name with fallbacks */
function getTechName(tech: any): string {
  if (tech.fullName) return tech.fullName;
  if (tech.displayName) return tech.displayName;
  if (tech.name) return tech.name;
  const first = tech.firstName || "";
  const last = tech.lastName || "";
  const combined = `${first} ${last}`.trim();
  return combined || tech.email || "(Unnamed)";
}

interface TechnicianFilterPopoverProps {
  technicians: any[];
  hiddenTechnicianIds: Set<string>;
  onToggleTechnicianVisibility: (techId: string) => void;
}

export function TechnicianFilterPopover({
  technicians,
  hiddenTechnicianIds,
  onToggleTechnicianVisibility,
}: TechnicianFilterPopoverProps) {
  const visibleCount = technicians.filter((t) => !hiddenTechnicianIds.has(t.id)).length +
    (hiddenTechnicianIds.has("unassigned") ? 0 : 1);
  const totalCount = technicians.length + 1; // +1 for Unassigned

  const handleAll = () => {
    technicians.forEach((t) => {
      if (hiddenTechnicianIds.has(t.id)) onToggleTechnicianVisibility(t.id);
    });
    if (hiddenTechnicianIds.has("unassigned")) onToggleTechnicianVisibility("unassigned");
  };

  const handleNone = () => {
    technicians.forEach((t) => {
      if (!hiddenTechnicianIds.has(t.id)) onToggleTechnicianVisibility(t.id);
    });
    if (!hiddenTechnicianIds.has("unassigned")) onToggleTechnicianVisibility("unassigned");
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
          <Users className="h-3.5 w-3.5" />
          Technicians ({visibleCount}/{totalCount})
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="end">
        {/* Quick actions */}
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-xs font-medium text-muted-foreground">Filter technicians</span>
          <div className="flex gap-1">
            <button onClick={handleAll} className="text-[11px] text-primary hover:underline">All</button>
            <span className="text-[11px] text-muted-foreground">/</span>
            <button onClick={handleNone} className="text-[11px] text-primary hover:underline">None</button>
          </div>
        </div>

        {/* Technician checkboxes — name is primary, color dot is secondary */}
        <div className="space-y-0.5 max-h-[320px] overflow-y-auto">
          {technicians.map((tech, index) => {
            const color = TECHNICIAN_COLORS[index % TECHNICIAN_COLORS.length];
            const isVisible = !hiddenTechnicianIds.has(tech.id);
            return (
              <label
                key={tech.id}
                className="flex items-center gap-2.5 px-1.5 py-2 rounded hover:bg-muted/50 cursor-pointer"
              >
                <Checkbox
                  checked={isVisible}
                  onCheckedChange={() => onToggleTechnicianVisibility(tech.id)}
                />
                <span className="text-sm font-medium flex-1 truncate">
                  {getTechName(tech)}
                </span>
                <div className={`w-2 h-2 rounded-full shrink-0 ${color.dot}`} title="Calendar color" />
              </label>
            );
          })}

          {/* Unassigned row */}
          <label className="flex items-center gap-2.5 px-1.5 py-2 rounded hover:bg-muted/50 cursor-pointer">
            <Checkbox
              checked={!hiddenTechnicianIds.has("unassigned")}
              onCheckedChange={() => onToggleTechnicianVisibility("unassigned")}
            />
            <span className="text-sm text-muted-foreground italic flex-1">Unassigned</span>
          </label>
        </div>
      </PopoverContent>
    </Popover>
  );
}
