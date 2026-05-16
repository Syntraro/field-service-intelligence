import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WorkspaceViewItem<T extends string = string> {
  value: T;
  label: string;
  /** Any icon component (LucideIcon, custom SVG). Optional — omit for icon-free items. */
  icon?: React.ElementType;
  /** Live count badge. Rendered only when > 0. */
  count?: number;
}

export interface WorkspaceViewGroup<T extends string = string> {
  /** Section header. Omit for an unlabelled group. */
  label?: string;
  items: WorkspaceViewItem<T>[];
}

interface WorkspaceViewRailProps<T extends string> {
  groups: WorkspaceViewGroup<T>[];
  activeView: T;
  onChange: (view: T) => void;
  /** Accessible nav label. */
  "aria-label"?: string;
  /**
   * Prefix for button data-testid attributes.
   * Button testId = `${testIdPrefix}-${item.value}` (e.g. "job-view-all").
   * Omit to skip testId generation.
   */
  testIdPrefix?: string;
  "data-testid"?: string;
}

// ── ViewButton ─────────────────────────────────────────────────────────────────

function ViewButton<T extends string>({
  item,
  isActive,
  onChange,
  testIdPrefix,
}: {
  item: WorkspaceViewItem<T>;
  isActive: boolean;
  onChange: (view: T) => void;
  testIdPrefix?: string;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={() => onChange(item.value)}
      aria-current={isActive ? "page" : undefined}
      data-testid={testIdPrefix ? `${testIdPrefix}-${item.value}` : undefined}
      className={cn(
        "flex items-center gap-2 w-full h-8 rounded-md px-[10px] text-left transition-colors",
        "text-row",
        isActive
          ? "bg-primary/10 text-primary font-medium"
          : "text-foreground/80 hover:bg-muted/50 hover:text-foreground",
      )}
    >
      {Icon && (
        <Icon
          className={cn(
            "h-4 w-4 shrink-0",
            isActive ? "text-primary" : "text-muted-foreground",
          )}
          aria-hidden="true"
        />
      )}
      <span className="truncate flex-1">{item.label}</span>
      {item.count != null && item.count > 0 && (
        <span
          className={cn(
            "ml-1 tabular-nums rounded-full text-[11px] leading-none",
            "flex items-center justify-center min-w-[18px] h-[18px] px-[5px]",
            isActive
              ? "bg-primary/15 text-primary"
              : "bg-muted text-muted-foreground",
          )}
        >
          {item.count > 999 ? "999+" : item.count}
        </span>
      )}
    </button>
  );
}

// ── WorkspaceViewRail ──────────────────────────────────────────────────────────

/**
 * Canonical view-rail primitive for operational workspaces.
 *
 * Owns: section grouping, section labels, view button chrome, count badges,
 * active-state rendering, keyboard accessibility.
 *
 * Does NOT own: domain view definitions, counts data, icon sets, view labels.
 * All content is supplied via the `groups` prop — zero domain knowledge here.
 *
 * Platform infrastructure — no domain imports.
 */
export function WorkspaceViewRail<T extends string>({
  groups,
  activeView,
  onChange,
  "aria-label": ariaLabel,
  testIdPrefix,
  "data-testid": testId,
}: WorkspaceViewRailProps<T>): ReactNode {
  return (
    <nav
      className="flex flex-col gap-0.5 py-2.5 px-2.5"
      aria-label={ariaLabel ?? "Views"}
      data-testid={testId ?? "workspace-view-rail"}
    >
      {groups.flatMap((group, groupIdx) => {
        const nodes: ReactNode[] = [];

        if (group.label) {
          nodes.push(
            <div
              key={`label-${groupIdx}`}
              className={cn(
                "text-[11px] font-medium text-muted-foreground/70 tracking-[0.01em] mb-[3px] px-[10px]",
                groupIdx > 0 && "mt-[10px]",
              )}
            >
              {group.label}
            </div>,
          );
        }

        for (const item of group.items) {
          nodes.push(
            <ViewButton
              key={item.value}
              item={item}
              isActive={activeView === item.value}
              onChange={onChange}
              testIdPrefix={testIdPrefix}
            />,
          );
        }

        return nodes;
      })}
    </nav>
  );
}
