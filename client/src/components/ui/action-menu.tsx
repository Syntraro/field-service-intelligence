/**
 * ActionMenu — canonical descriptor-driven action menu primitive (2026-05-09).
 *
 * Single source of truth for action-menu rendering. Callers build a typed
 * ActionMenuItemDescriptor[] array; this component owns all DropdownMenuItem
 * JSX, icon rendering, and tone-to-class mapping. No caller ever writes raw
 * DropdownMenuItem JSX or passes className on individual items.
 *
 * Icon rendering:
 *   Icons are rendered with NO explicit size or margin class. DropdownMenuItem's
 *   base class bakes `gap-2` (8px flex gap) and `[&_svg]:size-4` (auto-size any
 *   SVG child to 16px). Adding `mr-2` or `h-4 w-4` would double the spacing.
 *
 * Tone map (centralised here, nowhere else):
 *   destructive → text-destructive / focus:text-destructive  (semantic token)
 *   success     → text-success / focus:text-success          (semantic token)
 *   warning     → text-warning / focus:text-warning          (semantic token)
 *   info        → text-info / focus:text-info                (semantic token)
 *
 * Token gap (2026-05-09):
 *   The --success, --warning, --info CSS variables are defined in index.css and
 *   generate valid Tailwind text-* utilities via tailwind.config.ts. However,
 *   they have no paired *-foreground token (only --destructive-foreground exists
 *   in the design system). The text-* classes resolve correctly today, but a
 *   future token-cleanup pass should add --success-foreground, --warning-foreground,
 *   --info-foreground and update TONE_CLASSES to use those instead.
 */

import { Fragment, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ── Types ─────────────────────────────────────────────────────────────────

export type ActionMenuTone = "default" | "destructive" | "success" | "warning" | "info";

export interface ActionMenuItemDescriptor {
  id: string;
  label: string;
  /** Lucide icon component. Rendered without explicit size/margin — DropdownMenuItem
   *  handles sizing ([&_svg]:size-4) and spacing (gap-2) automatically. */
  icon?: React.ComponentType<{ className?: string }>;
  tone?: ActionMenuTone;
  disabled?: boolean;
  /** Native title tooltip shown on hover when the item is disabled. */
  disabledHint?: string;
  hidden?: boolean;
  /** When true, a DropdownMenuSeparator is rendered above this item. */
  separator?: boolean;
  onSelect: () => void;
  testId?: string;
}

// ── Tone map (single canonical source) ───────────────────────────────────

// TONE_CLASSES — the only place in the codebase where menu-item tonal classes
// are defined. Do not duplicate in callers. Add new tones here first.
const TONE_CLASSES: Record<ActionMenuTone, string> = {
  default:     "",
  destructive: "text-destructive focus:text-destructive",
  success:     "text-success focus:text-success",
  warning:     "text-warning focus:text-warning",
  info:        "text-info focus:text-info",
};

// ── Component ─────────────────────────────────────────────────────────────

interface ActionMenuProps {
  items: ActionMenuItemDescriptor[];
  /** Custom trigger element. When omitted, renders a ghost MoreHorizontal icon button.
   *  The element must be a single React element — it is wrapped by DropdownMenuTrigger asChild. */
  trigger?: ReactNode;
  align?: "start" | "end";
  /** Additional class on the DropdownMenuContent panel (e.g., "w-52"). */
  contentClassName?: string;
}

export function ActionMenu({ items, trigger, align = "end", contentClassName }: ActionMenuProps) {
  const visible = items.filter((i) => !i.hidden);
  if (visible.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="icon">
            <MoreHorizontal />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className={contentClassName}>
        {visible.map((item) => {
          const toneClass = item.tone && item.tone !== "default"
            ? TONE_CLASSES[item.tone]
            : undefined;
          return (
            <Fragment key={item.id}>
              {item.separator && <DropdownMenuSeparator />}
              <DropdownMenuItem
                onClick={item.onSelect}
                disabled={item.disabled}
                title={item.disabled && item.disabledHint ? item.disabledHint : undefined}
                className={toneClass}
                data-testid={item.testId}
              >
                {item.icon && <item.icon />}
                {item.label}
              </DropdownMenuItem>
            </Fragment>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
