import type { ReactNode } from "react";
import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface WorkspaceFiltersPopoverProps {
  /** Number of active secondary filters — shown as a compact badge on the trigger. */
  activeCount?: number;
  /** Clears all secondary filters. Shown only when activeCount > 0. */
  onClear?: () => void;
  /** Trigger button label. Defaults to "Filters". */
  label?: string;
  /** Filter content — use FilterSection from @/components/filters/FiltersButton for labelled groups. */
  children: ReactNode;
  /** Popover alignment relative to trigger. */
  align?: "start" | "center" | "end";
  className?: string;
  "data-testid"?: string;
}

/**
 * Workspace-density secondary-filter popover.
 *
 * Places all secondary filters behind a single compact trigger button so
 * the WorkspaceToolbar filter slot stays single-row even at 5+ filter controls.
 *
 * Usage: put primary filters (status chip, date range) directly in the toolbar
 * `filters` slot; wrap secondary filters (owner, source, tags, lifecycle, etc.)
 * as children here.
 *
 *   <WorkspaceToolbar
 *     filters={
 *       <>
 *         <StatusChip ... />
 *         <DateRangeButton ... />
 *         <WorkspaceFiltersPopover activeCount={2}>
 *           <FilterSection label="Owner">...</FilterSection>
 *           <FilterSection label="Source">...</FilterSection>
 *         </WorkspaceFiltersPopover>
 *       </>
 *     }
 *   />
 *
 * Platform infrastructure — no domain imports.
 */
export function WorkspaceFiltersPopover({
  activeCount = 0,
  onClear,
  label = "Filters",
  children,
  align = "start",
  className,
  "data-testid": testId,
}: WorkspaceFiltersPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-8 gap-1.5 rounded-lg border-slate-200 bg-white text-sm px-3", className)}
          data-testid={testId ?? "workspace-filters-popover"}
        >
          <Filter className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          {label}
          {activeCount > 0 && (
            <span
              className="ml-0.5 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] leading-none tabular-nums min-w-[16px] h-[16px] px-[4px]"
              aria-label={`${activeCount} active filter${activeCount !== 1 ? "s" : ""}`}
            >
              {activeCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-0"
        align={align}
        sideOffset={8}
      >
        <div className="p-3 space-y-3 max-h-[60vh] overflow-y-auto">
          {children}
        </div>
        {activeCount > 0 && onClear && (
          <div className="border-t px-3 py-2 flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClear}
              className="h-7 text-xs gap-1"
              data-testid="workspace-filters-clear-all"
            >
              <X className="h-3 w-3" aria-hidden="true" />
              Clear all
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
