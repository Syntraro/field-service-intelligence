import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface WorkspaceCenterPaneProps {
  /** Toolbar row — WorkspaceToolbar or custom. Rendered shrink-0. */
  toolbar?: ReactNode;
  /** List area — WorkspaceEntitySurface wrapping the domain list. Fills remaining height. */
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}

/**
 * Center pane shell for operational workspaces.
 * Stacks toolbar (shrink-0) above list area (flex-1 min-h-0).
 */
export function WorkspaceCenterPane({
  toolbar,
  children,
  className,
  "data-testid": testId,
}: WorkspaceCenterPaneProps) {
  return (
    <div
      className={cn("flex-1 min-w-0 flex flex-col overflow-hidden bg-card", className)}
      data-testid={testId ?? "workspace-center-pane"}
    >
      {toolbar}
      <div className="flex-1 min-h-0 overflow-hidden">
        {children}
      </div>
    </div>
  );
}
