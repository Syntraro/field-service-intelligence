import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  RIGHT_RAIL_COLLAPSED_W,
  RIGHT_RAIL_EXPANDED_W,
  RIGHT_RAIL_TRANSITION,
} from "./workspace.constants";

interface WorkspaceRightRailProps {
  expanded: boolean;
  children: ReactNode;
  collapsedWidth?: number;
  expandedWidth?: number;
  /** Override the default bg-card background. */
  className?: string;
  "data-testid"?: string;
}

/**
 * Selection-driven right rail container for operational workspaces.
 * Owns width geometry and transition only — content is always mounted
 * so domain children handle their own empty/loading states.
 */
export function WorkspaceRightRail({
  expanded,
  children,
  collapsedWidth = RIGHT_RAIL_COLLAPSED_W,
  expandedWidth = RIGHT_RAIL_EXPANDED_W,
  className,
  "data-testid": testId,
}: WorkspaceRightRailProps) {
  return (
    <div
      className={cn("shrink-0 overflow-hidden bg-card", className)}
      style={{
        width: expanded ? expandedWidth : collapsedWidth,
        transition: RIGHT_RAIL_TRANSITION,
      }}
      data-testid={testId ?? "workspace-right-rail"}
    >
      {children}
    </div>
  );
}
