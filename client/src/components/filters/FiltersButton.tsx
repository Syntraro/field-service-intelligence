/**
 * FiltersButton — Generic filter popover for list pages.
 * Single "Filters" button with active count badge. Opens a popover
 * with page-specific filter sections passed as children.
 *
 * List Pages Refactor (2026-03-04)
 */

import * as React from "react";
import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface FiltersButtonProps {
  /** Number of active filters — shown as a badge on the trigger */
  activeCount?: number;
  /** Callback to clear all filters */
  onClear?: () => void;
  /** Custom button label (defaults to "Filters") */
  label?: string;
  /** Filter sections (use FilterSection for labelled groups) */
  children: React.ReactNode;
  className?: string;
  /** Popover alignment */
  align?: "start" | "center" | "end";
}

export function FiltersButton({
  activeCount = 0,
  onClear,
  label = "Filters",
  children,
  className,
  align = "start",
}: FiltersButtonProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-9 gap-1.5", className)}
          data-testid="filters-button"
        >
          <Filter className="h-3.5 w-3.5" />
          {label}
          {activeCount > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-[11px] ml-0.5">
              {activeCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align={align} sideOffset={8}>
        <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {children}
        </div>
        {activeCount > 0 && onClear && (
          <div className="border-t px-4 py-3 flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClear}
              className="h-7 text-xs"
              data-testid="clear-all-filters"
            >
              <X className="h-3 w-3 mr-1" />
              Clear all
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Labelled filter section inside the popover */
export function FilterSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground mb-2">{label}</div>
      {children}
    </div>
  );
}
