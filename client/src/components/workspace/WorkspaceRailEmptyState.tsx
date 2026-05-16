import type { ElementType } from "react";
import { MousePointerClick } from "lucide-react";
import { cn } from "@/lib/utils";

interface WorkspaceRailEmptyStateProps {
  icon?: ElementType;
  message?: string;
  className?: string;
  "data-testid"?: string;
}

/**
 * Shown in the right rail when no entity is selected.
 * Compact, centered, subdued — not a dashboard empty state.
 */
export function WorkspaceRailEmptyState({
  icon: Icon = MousePointerClick,
  message = "Select an item to see details",
  className,
  "data-testid": testId,
}: WorkspaceRailEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center h-full gap-2 px-4 text-center",
        className,
      )}
      data-testid={testId ?? "workspace-rail-empty-state"}
    >
      <Icon className="h-5 w-5 text-muted-foreground/40" aria-hidden="true" />
      <p className="text-helper text-muted-foreground">{message}</p>
    </div>
  );
}
