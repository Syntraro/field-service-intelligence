/**
 * ListToolbar — Consistent toolbar for list/table pages.
 * Left: search input. Right: children slot for FiltersButton + quick actions.
 *
 * List Pages Refactor (2026-03-04)
 */

import * as React from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface ListToolbarProps {
  /** Current search value */
  searchValue: string;
  /** Search change handler */
  onSearchChange: (value: string) => void;
  /** Placeholder text for search input */
  searchPlaceholder?: string;
  /** data-testid for the search input */
  searchTestId?: string;
  /** Right-side elements: FiltersButton, quick actions, etc. */
  children?: React.ReactNode;
  className?: string;
}

export function ListToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search...",
  searchTestId,
  children,
  className,
}: ListToolbarProps) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={searchPlaceholder}
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9"
          data-testid={searchTestId}
        />
      </div>
      {children}
    </div>
  );
}
