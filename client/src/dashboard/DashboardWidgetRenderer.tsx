/**
 * DashboardWidgetRenderer — toggle row used INSIDE the customize
 * drawer (2026-05-07 RALPH).
 *
 * Each row in the customize drawer is a static toggle row: title +
 * optional description on the left, visibility Switch on the right.
 * Reorder happens on the live dashboard grid, NOT in this drawer —
 * see `DashboardWidgetGrid`'s sortable cell wrappers.
 *
 * Accessibility
 * -------------
 * The Switch primitive is accessible via Tab + Space. The
 * description, when present, is associated with the switch via
 * `aria-describedby`.
 *
 * Visual contract
 * ---------------
 * Single row layout:
 *   Title                                              [   ●━━ ]
 *   Description (optional, text-row muted)
 *
 * Spacing matches the canonical settings pattern (px-3 py-2.5,
 * gap-3). Typography uses the existing tokens — no one-off classes.
 */
import { Switch } from "@/components/ui/switch";
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
  const descriptionId = widget.description
    ? `dashboard-widget-${widget.widgetKey}-description`
    : undefined;

  return (
    <div
      className="flex items-start gap-3 px-3 py-2.5 rounded-md border border-card-border bg-card"
      data-testid={`dashboard-customize-row-${widget.widgetKey}`}
    >
      <div className="flex-1 min-w-0">
        <div className="text-row text-text-primary truncate">
          {widget.title}
        </div>
        {widget.description && (
          <div
            id={descriptionId}
            className="text-row text-text-muted mt-0.5"
          >
            {widget.description}
          </div>
        )}
      </div>

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
