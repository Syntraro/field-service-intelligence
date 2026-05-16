import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { WorkspaceRightRail } from "./WorkspaceRightRail";
import {
  RIGHT_RAIL_COLLAPSED_W,
  RIGHT_RAIL_EXPANDED_W,
} from "./workspace.constants";

interface OperationalWorkspaceProps {
  // ── Center pane ────────────────────────────────────────────────────────────
  /** Domain-provided center content. Compose WorkspaceCenterPane here. */
  center: ReactNode;
  // ── Right rail ─────────────────────────────────────────────────────────────
  rightRailExpanded: boolean;
  /**
   * Domain-provided right rail content.
   * Pass null/undefined to hide the rail entirely (no reserved width, no divider).
   * Pass a ReactNode to always mount the rail (collapsed/expanded via rightRailExpanded).
   */
  rightRail?: ReactNode;
  rightCollapsedWidth?: number;
  rightExpandedWidth?: number;
  /** Forwarded to WorkspaceRightRail — use to override the canonical bg-card default. */
  rightRailClassName?: string;
  "data-testid"?: string;
}

/**
 * Two-pane operational workspace shell (center + contextual right rail).
 *
 * The secondary left views rail has been replaced by WorkspaceFilterBar,
 * rendered above this component inside each workspace tab.
 *
 * Right rail is optional: when rightRail is null/undefined the center pane
 * fills the full width and no divider is rendered.
 *
 * Platform infrastructure — contains zero domain logic.
 */
export function OperationalWorkspace({
  center,
  rightRailExpanded,
  rightRail,
  rightCollapsedWidth = RIGHT_RAIL_COLLAPSED_W,
  rightExpandedWidth = RIGHT_RAIL_EXPANDED_W,
  rightRailClassName,
  "data-testid": testId,
}: OperationalWorkspaceProps) {
  const hasRail = rightRail != null;
  return (
    <div
      className={cn(
        "flex h-full min-h-0",
        hasRail && "divide-x divide-slate-100",
      )}
      data-testid={testId ?? "operational-workspace"}
    >
      {/* Center pane — fills available width */}
      <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
        {center}
      </div>

      {hasRail && (
        <WorkspaceRightRail
          expanded={rightRailExpanded}
          collapsedWidth={rightCollapsedWidth}
          expandedWidth={rightExpandedWidth}
          className={rightRailClassName}
        >
          {rightRail}
        </WorkspaceRightRail>
      )}
    </div>
  );
}
