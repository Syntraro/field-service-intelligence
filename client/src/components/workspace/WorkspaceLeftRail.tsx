import type { ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LEFT_RAIL_COLLAPSED_W,
  LEFT_RAIL_EXPANDED_W,
  LEFT_RAIL_TRANSITION,
} from "./workspace.constants";

interface WorkspaceLeftRailProps {
  collapsed: boolean;
  onToggle: () => void;
  /** Vertical label shown when the rail is collapsed. */
  label: string;
  /** Content rendered in the expanded state (domain view rail). */
  children: ReactNode;
  collapsedWidth?: number;
  expandedWidth?: number;
  "data-testid"?: string;
}

/**
 * Collapsible left rail shell for operational workspaces.
 *
 * Owns: collapse/expand geometry, transition, collapsed strip affordance,
 * PanelLeft icons, and vertical label. Domain provides children (view rail).
 *
 * Two absolute-positioned layers cross-fade on collapse/expand so neither
 * layer fights for space during the width transition.
 */
export function WorkspaceLeftRail({
  collapsed,
  onToggle,
  label,
  children,
  collapsedWidth = LEFT_RAIL_COLLAPSED_W,
  expandedWidth = LEFT_RAIL_EXPANDED_W,
  "data-testid": testId,
}: WorkspaceLeftRailProps) {
  return (
    <div
      className="relative shrink-0 overflow-hidden bg-white"
      style={{
        width: collapsed ? collapsedWidth : expandedWidth,
        transition: LEFT_RAIL_TRANSITION,
      }}
      data-testid={testId ?? "workspace-left-rail"}
    >
      {/* Collapsed strip — fades in when collapsed */}
      <div
        aria-hidden={!collapsed}
        className={cn(
          "absolute inset-0 flex flex-col items-center pt-3 gap-2",
          "transition-opacity duration-200 motion-reduce:transition-none",
          collapsed ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          title={`Expand ${label}`}
          tabIndex={collapsed ? 0 : -1}
          className="flex items-center justify-center h-7 w-7 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
          data-testid="workspace-left-rail-expand"
        >
          <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
        </button>
        <span
          className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.04em]"
          style={{ writingMode: "vertical-lr", textOrientation: "mixed" }}
        >
          {label}
        </span>
      </div>

      {/* Expanded content — fades in when expanded */}
      <div
        aria-hidden={collapsed}
        className={cn(
          "absolute inset-0 flex flex-col overflow-hidden",
          "transition-opacity duration-200 motion-reduce:transition-none",
          collapsed ? "opacity-0 pointer-events-none" : "opacity-100",
        )}
      >
        {/* Collapse button — top-right over the content */}
        <div className="absolute top-2 right-2 z-10">
          <button
            type="button"
            onClick={onToggle}
            title={`Collapse ${label}`}
            tabIndex={collapsed ? -1 : 0}
            className="flex items-center justify-center h-6 w-6 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
            data-testid="workspace-left-rail-collapse"
          >
            <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-none">
          {children}
        </div>
      </div>
    </div>
  );
}
