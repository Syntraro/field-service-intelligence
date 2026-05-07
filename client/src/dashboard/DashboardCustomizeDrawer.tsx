/**
 * DashboardCustomizeDrawer — right-side Sheet for per-user widget
 * visibility + reorder + reset (2026-05-07 RALPH).
 *
 * Composition
 * -----------
 *   <Sheet> (canonical primitive, side="right")
 *     <SheetContent>
 *       <SheetHeader>          Title + description
 *       <DndContext>           @dnd-kit
 *         <SortableContext>    vertical strategy
 *           <DashboardWidgetRenderer> (one per widget)
 *       <SheetFooter>          Reset + Done buttons
 *
 * Behavior
 * --------
 *   • Opens via the page's "Customize Dashboard" button.
 *   • Toggles persist immediately (optimistic update + PUT).
 *   • Drag-end persists the new order (optimistic update + PUT).
 *   • Reset POSTs to /reset and re-pulls the registry defaults.
 *   • While a save is in flight, both controls show the disabled
 *     state — the optimistic cache update means the visible UI
 *     never flickers back to old state on success.
 *
 * Accessibility
 * -------------
 *   • Sheet is a Radix Dialog primitive (keyboard trap + ESC close).
 *   • Drag handles use the canonical @dnd-kit `KeyboardSensor`
 *     pattern (Space to pick up, arrow keys to move, Space to drop)
 *     in addition to the pointer sensor.
 *   • Switches are accessible via Tab + Space.
 */
import { useCallback } from "react";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
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

  // Sensors: mouse + touch + keyboard.
  //
  // 2026-05-07 RALPH (drag fix): switched from a single `PointerSensor`
  // to dedicated `MouseSensor` + `TouchSensor` for iPad/iOS Safari
  // reliability. PointerSensor's touch path is brittle on iOS Safari
  // (a known @dnd-kit/iOS interaction), and the user reported drag
  // not working on iPad. The dedicated sensors give @dnd-kit a clean
  // separation: mouse uses a 4 px movement threshold (so a click on
  // the handle button doesn't accidentally start a drag); touch
  // uses a 200 ms hold + 5 px tolerance (so a finger-press on the
  // handle reliably enters drag mode without breaking scroll).
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = layout.widgets.findIndex(
        (w) => w.widgetKey === active.id,
      );
      const newIndex = layout.widgets.findIndex(
        (w) => w.widgetKey === over.id,
      );
      if (oldIndex < 0 || newIndex < 0) return;
      const reordered = arrayMove(layout.widgets, oldIndex, newIndex);
      layout.setOrder(reordered.map((w) => w.widgetKey));
    },
    [layout],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        // Slightly tighter padding than the Sheet default — matches
        // the settings UI density. The Sheet primitive's default p-6
        // is too airy for a list-of-toggles surface.
        className="p-0 flex flex-col gap-0"
        data-testid="dashboard-customize-drawer"
      >
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-card-border space-y-1">
          <SheetTitle className="text-section-title text-text-primary">
            Customize Dashboard
          </SheetTitle>
          {/* 2026-05-07 RALPH (drag-discoverability fix): explicit copy
              telling users that drag happens via the handle on the
              left of each row + that toggles control visibility.
              Tokenized text-caption only — no inline sizing. */}
          <SheetDescription className="text-caption text-text-muted">
            Drag widgets to reorder. Toggle widgets to show or hide them.
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
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={layout.widgets.map((w) => w.widgetKey)}
                strategy={verticalListSortingStrategy}
              >
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
              </SortableContext>
            </DndContext>
          )}
          {layout.error && (
            <div
              className="mt-3 px-3 py-2 rounded-md bg-danger/10 text-caption text-danger"
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
