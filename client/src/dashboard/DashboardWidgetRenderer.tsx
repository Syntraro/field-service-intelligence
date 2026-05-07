/**
 * DashboardWidgetRenderer — sortable row used INSIDE the customize
 * drawer (2026-05-07 RALPH).
 *
 * Each row in the customize drawer is a sortable @dnd-kit element
 * with a drag handle, the widget's title + optional description, and
 * a Switch for visibility. Drag mechanics are isolated to this
 * component so the live dashboard grid (`DashboardWidgetGrid`)
 * stays simple and presentation-only.
 *
 * Accessibility
 * -------------
 * The drag handle is a keyboard-focusable button (@dnd-kit's
 * KeyboardSensor activates with Space/Enter on a button). The
 * Switch primitive is already accessible via Tab + Space. The
 * description, when present, is associated with the row via
 * `aria-describedby`.
 *
 * Visual contract
 * ---------------
 * Single row layout:
 *   ⋮⋮  Title                                    [   ●━━ ]
 *       Description (optional, text-caption muted)
 *
 * Spacing matches the canonical settings pattern (px-3 py-2.5,
 * gap-3). Typography uses the existing tokens — no one-off classes.
 */
import { GripVertical } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { DashboardLayoutResponseEntry } from "./dashboardLayoutSchemas";

interface DashboardWidgetRendererProps {
  widget: DashboardLayoutResponseEntry;
  onToggleVisibility: (widgetKey: string, visible: boolean) => void;
  /** Disable interactions while a save is in flight. */
  disabled?: boolean;
}

export function DashboardWidgetRenderer({
  widget,
  onToggleVisibility,
  disabled,
}: DashboardWidgetRendererProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: widget.widgetKey });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // While a row is being dragged, lift it slightly above the
    // others so sibling rows visibly slide into the vacated slot.
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.85 : 1,
  };

  const descriptionId = widget.description
    ? `dashboard-widget-${widget.widgetKey}-description`
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-start gap-3 px-3 py-2.5 rounded-md border border-card-border bg-card",
        // Slight visual cue while dragging — same shadow rhythm as
        // other elevated states elsewhere in the app.
        isDragging && "shadow-card",
      )}
      data-testid={`dashboard-customize-row-${widget.widgetKey}`}
    >
      {/* Drag handle.
          2026-05-07 RALPH (visible-affordance fix): the previous
          version was a 32×32 box with `text-text-muted` and NO
          default background — the GripVertical icon disappeared
          against the card-bg row, so users said "there is no drag
          handle." This iteration gives the button a visible default
          surface (`bg-surface-subtle` + `border border-card-border`)
          and a darker icon (`text-text-secondary`) so the handle
          reads as a button at a glance. Hover/active darken further
          to confirm grab-ability. Hit area, sensors, listeners,
          touch-action, and the unchanged `<GripVertical h-4 w-4>`
          icon are all preserved from the prior fix. */}
      <button
        type="button"
        aria-label={`Reorder ${widget.title}`}
        className={cn(
          "shrink-0 inline-flex items-center justify-center h-8 w-8 rounded",
          // Visible default surface — the affordance fix.
          "bg-surface-subtle border border-card-border text-text-secondary",
          "hover:text-text-primary hover:bg-card-border/60",
          "cursor-grab active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          // Touch-action: prevent the browser from scrolling while
          // the user is starting a drag from the handle. Without
          // this, iPad Safari treats the touch-press as a scroll
          // gesture instead of a drag.
          "touch-none select-none",
          disabled && "opacity-50 cursor-not-allowed pointer-events-none",
        )}
        disabled={disabled}
        title="Drag to reorder"
        data-testid={`dashboard-customize-handle-${widget.widgetKey}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Title + optional description. */}
      <div className="flex-1 min-w-0">
        <div className="text-row text-text-primary truncate">
          {widget.title}
        </div>
        {widget.description && (
          <div
            id={descriptionId}
            className="text-caption text-text-muted mt-0.5"
          >
            {widget.description}
          </div>
        )}
      </div>

      {/* Visibility toggle. */}
      <Switch
        checked={widget.visible}
        onCheckedChange={(next) =>
          onToggleVisibility(widget.widgetKey, !!next)
        }
        disabled={disabled}
        aria-label={`Show ${widget.title}`}
        aria-describedby={descriptionId}
        data-testid={`dashboard-customize-toggle-${widget.widgetKey}`}
      />
    </div>
  );
}
