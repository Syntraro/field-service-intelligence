/**
 * StateBlock — canonical renderer for empty, no-results, loading, error,
 * and permission states.
 *
 * 2026-05-09: Created as the single canonical state renderer for the app.
 * Absorbs the prior EmptyState (partial), CanonicalEmpty (InventoryPage-local),
 * and all hand-rolled centered loading/error blocks across list pages.
 *
 * Architecture contract:
 *   Caller provides:  kind, title, description, icon key, tone, size, layout,
 *                     action descriptors, testId.
 *   Renderer owns:    spacing, typography (Phase H1 tokens), icon sizing,
 *                     tone/color, loading visual (Loader2 animate-spin),
 *                     retry/action button placement.
 *
 * Pages must NEVER hand-roll: centered loading divs, "No X found" blocks,
 * "Failed to load" spans, or Permission denied text — use StateBlock instead.
 */
import * as React from "react";
import {
  Loader2,
  Search,
  FileText,
  AlertCircle,
  Lock,
  Calendar,
  Boxes,
  Wrench,
  Inbox,
  BarChart2,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// ─── Public types ─────────────────────────────────────────────────────────────

export type StateBlockKind =
  | "empty"
  | "no-results"
  | "loading"
  | "error"
  | "permission";

export type StateBlockIcon =
  | "search"
  | "file"
  | "alert"
  | "lock"
  | "calendar"
  | "box"
  | "wrench"
  | "inbox"
  | "chart"
  | "users";

export type StateBlockSize = "compact" | "default" | "page";
export type StateBlockTone = "neutral" | "warning" | "danger" | "info";
export type StateBlockLayout = "inline" | "card";

export interface StateBlockAction {
  label: string;
  onClick: () => void;
  variant?: "default" | "outline";
}

export interface StateBlockProps {
  kind: StateBlockKind;
  title: string;
  description?: string;
  icon?: StateBlockIcon;
  tone?: StateBlockTone;
  size?: StateBlockSize;
  layout?: StateBlockLayout;
  primaryAction?: StateBlockAction;
  secondaryAction?: StateBlockAction;
  testId?: string;
  /** Escape hatch for one-off Lucide icons not in the canonical key set. */
  customIcon?: LucideIcon;
}

// ─── Internal maps (renderer-owned, not exported) ─────────────────────────────

const ICON_MAP: Record<StateBlockIcon, LucideIcon> = {
  search:   Search,
  file:     FileText,
  alert:    AlertCircle,
  lock:     Lock,
  calendar: Calendar,
  box:      Boxes,
  wrench:   Wrench,
  inbox:    Inbox,
  chart:    BarChart2,
  users:    Users,
};

// Default icon key per kind — renderer resolves, callers never import Lucide for this.
const KIND_DEFAULT_ICON: Partial<Record<StateBlockKind, StateBlockIcon>> = {
  error:        "alert",
  permission:   "lock",
  "no-results": "search",
};

// Default tone per kind.
const KIND_DEFAULT_TONE: Partial<Record<StateBlockKind, StateBlockTone>> = {
  error: "danger",
};

// Renderer-owned icon size per component size.
const ICON_SIZE: Record<StateBlockSize, string> = {
  compact: "h-5 w-5",
  default: "h-6 w-6",
  page:    "h-8 w-8",
};

// Renderer-owned outer spacing per component size.
const OUTER_PAD: Record<StateBlockSize, string> = {
  compact: "py-6",
  default: "py-12",
  page:    "py-16",
};

// Renderer-owned icon color per tone (semantic tokens only — no text-slate/red/rose).
function iconColor(tone: StateBlockTone): string {
  switch (tone) {
    case "danger":  return "text-destructive";
    case "warning": return "text-amber-500";
    case "info":    return "text-sky-500";
    default:        return "text-muted-foreground/60";
  }
}

// Title color: danger overrides to destructive; all others use Phase H1 secondary token.
function titleColor(tone: StateBlockTone): string {
  return tone === "danger" ? "text-destructive" : "text-text-secondary";
}

// ─── Component ────────────────────────────────────────────────────────────────

export function StateBlock({
  kind,
  title,
  description,
  icon,
  tone: toneProp,
  size = "default",
  layout = "inline",
  primaryAction,
  secondaryAction,
  testId,
  customIcon,
}: StateBlockProps) {
  const tone       = toneProp ?? KIND_DEFAULT_TONE[kind] ?? "neutral";
  const iconKey    = icon ?? KIND_DEFAULT_ICON[kind];
  const IconComp   = customIcon ?? (iconKey ? ICON_MAP[iconKey] : undefined);

  return (
    <div
      className={cn(
        "text-center px-4",
        OUTER_PAD[size],
        layout === "card" && "rounded-md border border-card-border bg-card shadow-sm",
      )}
      data-testid={testId}
    >
      {/* Loading spinner (kind="loading" always uses Loader2 animate-spin). */}
      {kind === "loading" ? (
        <Loader2
          className={cn("mx-auto mb-3 animate-spin", ICON_SIZE[size], iconColor(tone))}
        />
      ) : IconComp ? (
        <IconComp
          className={cn("mx-auto mb-3", ICON_SIZE[size], iconColor(tone))}
        />
      ) : null}

      {/* Title — Phase H1 text-row token; danger overrides color. */}
      <p className={cn("text-row", titleColor(tone))}>{title}</p>

      {/* Description — Phase H1 text-helper token. */}
      {description && (
        <p className="text-helper text-text-muted mt-1">{description}</p>
      )}

      {/* Actions — primary first, secondary ghost. */}
      {(primaryAction || secondaryAction) && (
        <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
          {primaryAction && (
            <Button
              size="sm"
              variant={primaryAction.variant ?? "default"}
              onClick={primaryAction.onClick}
            >
              {primaryAction.label}
            </Button>
          )}
          {secondaryAction && (
            <Button
              size="sm"
              variant="ghost"
              onClick={secondaryAction.onClick}
            >
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
