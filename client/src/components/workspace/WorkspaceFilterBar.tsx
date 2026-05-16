import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ── WorkspaceFilterBar ────────────────────────────────────────────────────────

interface WorkspaceFilterBarProps {
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}

/**
 * Horizontal filter/view bar for operational workspaces.
 * Replaces the secondary left-side views rail.
 * Horizontally scrollable on narrow widths.
 */
export function WorkspaceFilterBar({
  children,
  className,
  "data-testid": testId,
}: WorkspaceFilterBarProps) {
  return (
    <div
      className={cn(
        "shrink-0 flex items-center gap-2 px-4 py-2.5 bg-inset-surface border-b border-card-border/60",
        "overflow-x-auto scrollbar-none min-h-[48px]",
        className,
      )}
      data-testid={testId ?? "workspace-filter-bar"}
    >
      {children}
    </div>
  );
}

// ── WorkspaceViewChip ─────────────────────────────────────────────────────────

interface WorkspaceViewChipProps {
  active: boolean;
  onClick: () => void;
  count?: number | null;
  children: ReactNode;
  /**
   * "sm" (default) — compact 28px chip, used by all workspaces.
   * "md" — 32px pill with visible border on inactive, used by Invoices workspace.
   */
  size?: "sm" | "md";
  "data-testid"?: string;
}

/** Single clickable view chip. Shows a count badge when count > 0. */
export function WorkspaceViewChip({
  active,
  onClick,
  count,
  children,
  size = "sm",
  "data-testid": testId,
}: WorkspaceViewChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md whitespace-nowrap shrink-0 transition-colors",
        size === "md" ? "h-8 px-4 text-sm" : "h-7 px-3 text-row",
        active
          ? "bg-primary/10 text-primary font-medium border border-primary/25"
          : size === "md"
            ? "bg-white border border-slate-200/60 text-slate-600 hover:bg-slate-50 hover:text-slate-800"
            : "text-foreground/70 hover:bg-muted/50 hover:text-foreground border border-transparent",
      )}
    >
      {children}
      {count != null && count > 0 && (
        <span
          className={cn(
            "tabular-nums leading-none rounded-full flex items-center justify-center",
            size === "md"
              ? "text-[11px] min-w-[20px] h-4 px-1.5"
              : "text-[11px] min-w-[18px] h-[14px] px-1",
            active
              ? "bg-primary/15 text-primary"
              : size === "md" ? "bg-slate-100 text-slate-500" : "bg-muted/80 text-muted-foreground",
          )}
        >
          {count > 999 ? "999+" : count}
        </span>
      )}
    </button>
  );
}

// ── WorkspaceFilterBarSeparator ───────────────────────────────────────────────

/** Thin vertical divider between chip groups. */
export function WorkspaceFilterBarSeparator() {
  return <div className="w-px h-4 bg-border-default mx-1 shrink-0" aria-hidden="true" />;
}

// ── WorkspaceViewMoreDropdown ─────────────────────────────────────────────────

interface WorkspaceViewMoreDropdownProps {
  /** Trigger label (e.g. "More", "Workflow", "Attention"). */
  label?: string;
  /** Highlight the trigger when the active view lives inside this dropdown. */
  activeInDropdown?: boolean;
  /** Matches WorkspaceViewChip size — "sm" (default) or "md". */
  size?: "sm" | "md";
  children: ReactNode;
}

/**
 * Dropdown trigger for secondary/grouped views.
 * Renders a pill-shaped button that opens a DropdownMenu.
 * Use WorkspaceViewDropdownItem for menu items.
 */
export function WorkspaceViewMoreDropdown({
  label = "More",
  activeInDropdown = false,
  size = "sm",
  children,
}: WorkspaceViewMoreDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1 rounded-md whitespace-nowrap shrink-0 transition-colors",
            size === "md" ? "h-8 px-4 text-sm" : "h-7 px-3 text-row",
            activeInDropdown
              ? "bg-primary/10 text-primary font-medium border border-primary/25"
              : size === "md"
                ? "bg-white border border-slate-200/60 text-slate-600 hover:bg-slate-50 hover:text-slate-800"
                : "text-foreground/70 hover:bg-muted/50 hover:text-foreground border border-transparent",
          )}
        >
          {label}
          <ChevronDown className="h-3 w-3 opacity-60 shrink-0" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[200px]">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── WorkspaceViewDropdownItem ─────────────────────────────────────────────────

interface WorkspaceViewDropdownItemProps {
  active: boolean;
  onClick: () => void;
  count?: number | null;
  children: ReactNode;
}

/** DropdownMenuItem with active highlight and optional count. */
export function WorkspaceViewDropdownItem({
  active,
  onClick,
  count,
  children,
}: WorkspaceViewDropdownItemProps) {
  return (
    <DropdownMenuItem
      onClick={onClick}
      className={cn(
        "flex items-center justify-between gap-4",
        active && "bg-primary/5 text-primary font-medium focus:bg-primary/10 focus:text-primary",
      )}
    >
      <span>{children}</span>
      {count != null && count > 0 && (
        <span className="text-[11px] tabular-nums text-muted-foreground shrink-0">
          {count > 999 ? "999+" : count}
        </span>
      )}
    </DropdownMenuItem>
  );
}
