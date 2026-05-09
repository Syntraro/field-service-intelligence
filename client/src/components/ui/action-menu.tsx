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
 *   destructive → text-destructive / focus:text-destructive              (semantic token)
 *   success     → text-success / focus:text-success                      (semantic token)
 *   warning     → text-warning-foreground / focus:text-warning-foreground (dark amber, ~4.88:1)
 *   info        → text-info / focus:text-info                            (semantic token)
 *
 * Token system (2026-05-09 Phase 3.1 — gap closed; fix applied same date):
 *   --success-foreground, --warning-foreground, --info-foreground defined in index.css
 *   and registered in tailwind.config.ts as foreground sub-keys.
 *   warning uses text-warning-foreground (dark amber) not text-warning (amber fill = 2.18:1,
 *   fails WCAG AA). success/info use DEFAULT fill as tonal text — both pass WCAG AA directly.
 */

import { Fragment, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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
  warning:     "text-warning-foreground focus:text-warning-foreground",
  info:        "text-info focus:text-info",
};

// ── Component ─────────────────────────────────────────────────────────────

interface ActionMenuProps {
  items: ActionMenuItemDescriptor[];
  /** Custom trigger element. When omitted, renders a ghost MoreHorizontal icon button.
   *  The element must be a single React element — it is wrapped by DropdownMenuTrigger asChild.
   *  Must be a DOM element or a React.forwardRef component so Radix can attach its
   *  positioning ref to the actual DOM node. */
  trigger?: ReactNode;
  align?: "start" | "end";
  /** Additional class on the DropdownMenuContent panel (e.g., "w-52"). */
  contentClassName?: string;
  /** Optional muted section header rendered above all items (e.g. "CREATE NEW"). */
  header?: string;
  /** Extra className merged onto every DropdownMenuItem (e.g. "py-2" for more row spacing). */
  itemClassName?: string;
}

export function ActionMenu({ items, trigger, align = "end", contentClassName, header, itemClassName }: ActionMenuProps) {
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
        {header && (
          <DropdownMenuLabel className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase px-2 pt-1.5 pb-1">
            {header}
          </DropdownMenuLabel>
        )}
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
                className={cn(itemClassName, toneClass)}
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
