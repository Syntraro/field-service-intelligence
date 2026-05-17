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
  /**
   * Additional class(es) appended to the center pane wrapper. Primarily used
   * to override overflow behaviour — e.g. "overflow-x-auto overflow-y-hidden"
   * for workspaces that need horizontal scroll in the header area.
   * Defaults to "overflow-hidden" when omitted.
   */
  centerClassName?: string;
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
  /** Forwarded to WorkspaceRightRail as data-testid. */
  rightRailTestId?: string;
  /**
   * Whether to render a divide-x separator between the center pane and the rail.
   * Defaults to true. Set to false when the rail provides its own conditional border
   * (e.g. collapsedWidth=0 workspaces where a permanent divider is never desired).
   */
  showRailDivider?: boolean;
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
  centerClassName,
  rightRailExpanded,
  rightRail,
  rightCollapsedWidth = RIGHT_RAIL_COLLAPSED_W,
  rightExpandedWidth = RIGHT_RAIL_EXPANDED_W,
  rightRailClassName,
  rightRailTestId,
  showRailDivider = true,
  "data-testid": testId,
}: OperationalWorkspaceProps) {
  const hasRail = rightRail != null;
  return (
    <div
      className={cn(
        "flex h-full min-h-0",
        hasRail && showRailDivider && "divide-x divide-slate-100",
      )}
      data-testid={testId ?? "operational-workspace"}
    >
      {/* Center pane — fills available width */}
      <div className={cn("flex-1 min-w-0 min-h-0 flex flex-col", centerClassName ?? "overflow-hidden")}>
        {center}
      </div>

      {hasRail && (
        <WorkspaceRightRail
          expanded={rightRailExpanded}
          collapsedWidth={rightCollapsedWidth}
          expandedWidth={rightExpandedWidth}
          className={rightRailClassName}
          data-testid={rightRailTestId}
        >
          {rightRail}
        </WorkspaceRightRail>
      )}
    </div>
  );
}
