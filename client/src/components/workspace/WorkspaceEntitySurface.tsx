import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface WorkspaceEntitySurfaceProps {
  /** Pinned bar above the list — bulk selection controls, batch actions. */
  selectionBar?: ReactNode;
  /** Pinned footer below the list — load-more, pagination. */
  footer?: ReactNode;
  /** The entity list (EntityListTable or its domain wrapper). */
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}

/**
 * Canonical list-area container for operational workspaces.
 *
 * Owns: the flex column structure and overflow contract for the center
 * pane list area. Does NOT own empty/loading/error states — those are
 * passed into EntityListTable by the domain list component.
 *
 * EntityListTable is always a child, never a direct dependency of this
 * component. WorkspaceEntitySurface wraps the list; EntityListTable
 * remains dumb/canonical.
 */
export function WorkspaceEntitySurface({
  selectionBar,
  footer,
  children,
  className,
  "data-testid": testId,
}: WorkspaceEntitySurfaceProps) {
  return (
    <div
      className={cn("flex flex-col flex-1 min-h-0 overflow-hidden", className)}
      data-testid={testId ?? "workspace-entity-surface"}
    >
      {selectionBar && (
        <div className="shrink-0">{selectionBar}</div>
      )}
      <div className="flex-1 min-h-0 overflow-hidden">
        {children}
      </div>
      {footer && (
        <div className="shrink-0">{footer}</div>
      )}
    </div>
  );
}
