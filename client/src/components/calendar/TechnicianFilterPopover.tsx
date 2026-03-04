/**
 * TechnicianFilterPopover - Replaces color-dot chips row in calendar header
 *
 * Phase 5 of Calendar Page UI Rewrite (2026-03-04)
 *
 * Uses shadcn Popover + Checkbox for technician visibility toggle.
 * Includes "All" / "None" quick-action buttons.
 */

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Users } from "lucide-react";
import { TECHNICIAN_COLORS } from "./calendarUtils";

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
    // Show all: remove all hidden IDs
    technicians.forEach((t) => {
      if (hiddenTechnicianIds.has(t.id)) onToggleTechnicianVisibility(t.id);
    });
    if (hiddenTechnicianIds.has("unassigned")) onToggleTechnicianVisibility("unassigned");
  };

  const handleNone = () => {
    // Hide all: add all IDs to hidden
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
      <PopoverContent className="w-56 p-2" align="end">
        {/* Quick actions */}
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-xs font-medium text-muted-foreground">Filter</span>
          <div className="flex gap-1">
            <button onClick={handleAll} className="text-[11px] text-primary hover:underline">All</button>
            <span className="text-[11px] text-muted-foreground">/</span>
            <button onClick={handleNone} className="text-[11px] text-primary hover:underline">None</button>
          </div>
        </div>

        {/* Technician checkboxes */}
        <div className="space-y-1 max-h-[280px] overflow-y-auto">
          {technicians.map((tech, index) => {
            const color = TECHNICIAN_COLORS[index % TECHNICIAN_COLORS.length];
            const isVisible = !hiddenTechnicianIds.has(tech.id);
            return (
              <label
                key={tech.id}
                className="flex items-center gap-2 px-1 py-1 rounded hover:bg-muted/50 cursor-pointer"
              >
                <Checkbox
                  checked={isVisible}
                  onCheckedChange={() => onToggleTechnicianVisibility(tech.id)}
                />
                <div className={`w-2.5 h-2.5 rounded-full ${color.dot}`} />
                <span className="text-xs truncate">
                  {tech.firstName} {tech.lastName}
                </span>
              </label>
            );
          })}

          {/* Unassigned row */}
          <label className="flex items-center gap-2 px-1 py-1 rounded hover:bg-muted/50 cursor-pointer">
            <Checkbox
              checked={!hiddenTechnicianIds.has("unassigned")}
              onCheckedChange={() => onToggleTechnicianVisibility("unassigned")}
            />
            <div className="w-2.5 h-2.5 rounded-full bg-muted-foreground/40" />
            <span className="text-xs">Unassigned</span>
          </label>
        </div>
      </PopoverContent>
    </Popover>
  );
}
