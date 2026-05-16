import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TOOLBAR_H } from "./workspace.constants";

interface WorkspaceToolbarProps {
  /** Search input slot — typically an Input with a leading Search icon. */
  search?: ReactNode;
  /** Filter controls slot — FiltersButton, DateRangeButton, status chips. */
  filters?: ReactNode;
  /** Right-side action slot — batch buttons, secondary controls. */
  actions?: ReactNode;
  className?: string;
  "data-testid"?: string;
}

/**
 * Canonical workspace toolbar row.
 * Three named slots: search, filters, actions.
 * No opinion on slot contents — fully domain-supplied.
 */
export function WorkspaceToolbar({
  search,
  filters,
  actions,
  className,
  "data-testid": testId,
}: WorkspaceToolbarProps) {
  return (
    <div
      className={cn("shrink-0 flex items-center gap-3 px-4", className)}
      style={{ height: TOOLBAR_H }}
      data-testid={testId ?? "workspace-toolbar"}
    >
      {search && <div className="shrink-0">{search}</div>}
      {filters && <div className="flex items-center gap-2 flex-1 min-w-0">{filters}</div>}
      {actions && <div className="shrink-0 ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}
