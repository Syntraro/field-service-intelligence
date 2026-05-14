/**
 * DashboardCustomizeDrawer — right-side Sheet for per-user widget
 * visibility + reset (2026-05-07 RALPH).
 *
 * Composition
 * -----------
 *   <Sheet> (canonical primitive, side="right")
 *     <SheetContent>
 *       <SheetHeader>          Title + description
 *       <DashboardWidgetRenderer> (one per widget — toggle row)
 *       <SheetFooter>          Reset + Done buttons
 *
 * Behavior
 * --------
 *   • Opens via the page's "Customize Dashboard" button.
 *   • Toggles persist immediately (optimistic update + PUT).
 *   • Reset POSTs to /reset and re-pulls the registry defaults.
 *   • Reorder is NOT done here — users drag widgets directly on the
 *     dashboard grid (see `DashboardWidgetGrid`'s sortable cell
 *     wrappers). The drawer is a static toggle list.
 *   • While a save is in flight, controls show the disabled state —
 *     the optimistic cache update means the visible UI never flickers
 *     back to old state on success.
 *
 * Accessibility
 * -------------
 *   • Sheet is a Radix Dialog primitive (keyboard trap + ESC close).
 *   • Switches are accessible via Tab + Space.
 */
import { RotateCcw } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useDashboardLayout } from "./useDashboardLayout";
import { DashboardWidgetRenderer } from "./DashboardWidgetRenderer";

interface DashboardCustomizeDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which dashboard the drawer is editing. Drives the API
   *  read/write target. */
  dashboardKey: string;
}

export function DashboardCustomizeDrawer({
  open,
  onOpenChange,
  dashboardKey,
}: DashboardCustomizeDrawerProps) {
  const layout = useDashboardLayout(dashboardKey);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="p-0 flex flex-col gap-0"
        data-testid="dashboard-customize-drawer"
      >
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-card-border space-y-1">
          <SheetTitle className="text-header text-text-primary">
            Customize Dashboard
          </SheetTitle>
          {/* 2026-05-07 RALPH (drag relocation): drag/reorder lives on
              the dashboard grid itself now. The drawer is a pure
              toggle surface. Copy reflects the new split: toggle here,
              reorder out there. */}
          <SheetDescription className="text-row text-text-muted">
            Drag widgets directly on the dashboard to reorder. Toggle widgets to show or hide them.
          </SheetDescription>
        </SheetHeader>

        <div
          className="flex-1 overflow-y-auto px-5 py-4"
          data-testid="dashboard-customize-list"
        >
          {layout.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-14 rounded-md bg-surface-subtle animate-pulse"
                />
              ))}
            </div>
          ) : layout.widgets.length === 0 ? (
            <div className="text-row text-text-muted text-center py-8">
              No widgets available.
            </div>
          ) : (
            <div className="space-y-2">
              {layout.widgets.map((w) => (
                <DashboardWidgetRenderer
                  key={w.widgetKey}
                  widget={w}
                  onToggleVisibility={layout.setVisibility}
                  disabled={layout.isSaving}
                />
              ))}
            </div>
          )}
          {layout.error && (
            <div
              className="mt-3 px-3 py-2 rounded-md bg-danger/10 text-row text-danger"
              role="alert"
              data-testid="dashboard-customize-error"
            >
              {layout.error.message}
            </div>
          )}
        </div>

        <SheetFooter className="px-5 py-3 border-t border-card-border flex !flex-row !justify-between items-center gap-2 !space-x-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => layout.reset()}
            disabled={layout.isSaving}
            data-testid="dashboard-customize-reset"
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            Reset to defaults
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => onOpenChange(false)}
            data-testid="dashboard-customize-done"
          >
            Done
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
