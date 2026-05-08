/**
 * DashboardWidgetGrid — canonical 3-column card system for the
 * customizable dashboard (2026-05-07 RALPH).
 *
 * Mental model
 * ------------
 * The dashboard is a 3-column grid at desktop. Every widget occupies
 * 1, 2, or 3 of those columns ("widthUnits"). The grid packs visible
 * widgets greedy into rows of <= 3 units. Widget widths are STRICT:
 * a 1-unit card is always 1/3 wide on desktop, a 2-unit card is
 * always 2/3 wide, a 3-unit card is always full. We never stretch a
 * card to fill leftover space — empty space is preferable to drift.
 *
 *   widthUnits 1 → col-span-12 md:col-span-6 xl:col-span-4
 *   widthUnits 2 → col-span-12 xl:col-span-8
 *   widthUnits 3 → col-span-12
 *
 * Drag-and-drop (2026-05-07 RALPH — relocated from drawer to live grid)
 * --------------------------------------------------------------------
 * Reorder happens HERE, on the live dashboard — not in the Customize
 * drawer. The grid wraps every visible cell in `useSortable` keyed by
 * `widgetKey`. A small drag-handle button is absolutely positioned in
 * the top-right of each cell (so the host card chrome stays
 * untouched) and carries the @dnd-kit listeners. The handle is
 * `touch-none` for iPad reliability and uses MouseSensor /
 * TouchSensor / KeyboardSensor so desktop, touch, and keyboard users
 * all reach the same reorder UX. Dropping a card calls the page-
 * supplied `onReorder(orderedKeys)` once; the page wires it to
 * `useDashboardLayout.setOrder`.
 *
 * Hidden widgets are NOT in `widgets` (the page passes
 * `layout.visibleWidgets`), so the SortableContext only sees visible
 * keys. The hook's `setOrder` preserves any hidden widgets the
 * caller didn't include via its append-any-omitted loop, so hidden
 * widgets keep their relative order automatically.
 *
 * Source-of-truth mapping (preset → units)
 * ----------------------------------------
 *   third      → 1
 *   two-thirds → 2
 *   full       → 3
 *
 * Today's Schedule width override
 * -------------------------------
 * Today's Schedule supports a runtime `widthUnitsOverride` (1 | 2 | 3)
 * threaded into <DashboardWidgetGrid> from the page when the schedule
 * card has fewer than 3 visible team members. This keeps the schedule
 * card from stretching wider than the data inside it warrants.
 *
 * NO equal-split rebalancing
 * --------------------------
 * Slack rows render with empty trailing space rather than stretching
 * surviving cards. See the original brief.
 */
import { Fragment, useCallback, useMemo, type ReactNode } from "react";
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
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DashboardLayoutResponseEntry } from "./dashboardLayoutSchemas";

/** Width unit on the canonical 3-column card grid. */
export type DashboardWidgetWidthUnits = 1 | 2 | 3;

/** Registry preset → canonical width units. The single source of
 *  truth for "how wide does this widget want to be?" Exposed for
 *  tests so the mapping is pinnable without rendering. */
export const PRESET_WIDTH_UNITS: Record<
  DashboardLayoutResponseEntry["sizePreset"],
  DashboardWidgetWidthUnits
> = {
  third: 1,
  "two-thirds": 2,
  full: 3,
};

/** Tailwind class for the widget's NATURAL responsive span — applied
 *  when the row's visible units sum to exactly 3 (so the row is
 *  "intact" and we honour each widget's intent). */
const NATURAL_SPAN_CLASSES: Record<
  DashboardWidgetWidthUnits,
  string
> = {
  // Each preset is a single class string applied to the wrapper div.
  // Tailwind compiles them at build time via class-name presence in
  // this file — DO NOT compose them dynamically.
  1: "col-span-12 md:col-span-6 xl:col-span-4",
  2: "col-span-12 xl:col-span-8",
  3: "col-span-12",
};

/** Per-heightPreset Tailwind height class. */
const HEIGHT_CLASSES: Record<
  NonNullable<DashboardLayoutResponseEntry["heightPreset"]>,
  string
> = {
  summary: "h-[300px]",
  large: "h-[440px]",
  compact: "",
  auto: "",
};

/** Resolve a widget's effective width units — runtime override wins
 *  over the registry preset. Exposed for tests. */
export function widthUnitsFor(
  widget: DashboardLayoutResponseEntry,
  overrides: Readonly<Record<string, DashboardWidgetWidthUnits>> = {},
): DashboardWidgetWidthUnits {
  const override = overrides[widget.widgetKey];
  if (override === 1 || override === 2 || override === 3) {
    return override;
  }
  return PRESET_WIDTH_UNITS[widget.sizePreset];
}

/** Row-span unit for the dashboard grid. 1 = standard single-row
 *  card. 2 = card spans two row tracks (used by Today's Schedule
 *  in stacked mode when content exceeds the standard card height). */
export type DashboardWidgetRowSpan = 1 | 2;

/** Resolve a widget's effective row span. */
export function rowSpanFor(
  widget: DashboardLayoutResponseEntry,
  overrides: Readonly<Record<string, DashboardWidgetRowSpan>> = {},
): DashboardWidgetRowSpan {
  const override = overrides[widget.widgetKey];
  if (override === 1 || override === 2) return override;
  return 1;
}

/** Resolve a widget's effective height preset. */
export function heightPresetFor(
  widget: DashboardLayoutResponseEntry,
  overrides: Readonly<
    Record<string, NonNullable<DashboardLayoutResponseEntry["heightPreset"]>>
  > = {},
): NonNullable<DashboardLayoutResponseEntry["heightPreset"]> {
  const override = overrides[widget.widgetKey];
  if (
    override === "summary" ||
    override === "large" ||
    override === "compact" ||
    override === "auto"
  ) {
    return override;
  }
  return widget.heightPreset ?? "auto";
}

/** Greedy-pack visible widgets into rows of <= 3 units. */
export function packDashboardRows(
  widgets: DashboardLayoutResponseEntry[],
  overrides: Readonly<Record<string, DashboardWidgetWidthUnits>> = {},
): DashboardLayoutResponseEntry[][] {
  const rows: DashboardLayoutResponseEntry[][] = [];
  let row: DashboardLayoutResponseEntry[] = [];
  let units = 0;
  for (const w of widgets) {
    const u = widthUnitsFor(w, overrides);
    if (units + u > 3) {
      if (row.length) rows.push(row);
      row = [w];
      units = u;
    } else {
      row.push(w);
      units += u;
    }
  }
  if (row.length) rows.push(row);
  return rows;
}

/** Pick the col-span class for one widget. */
export function spanClassFor(
  widget: DashboardLayoutResponseEntry,
  _row: DashboardLayoutResponseEntry[],
  overrides: Readonly<Record<string, DashboardWidgetWidthUnits>> = {},
): string {
  return NATURAL_SPAN_CLASSES[widthUnitsFor(widget, overrides)];
}

interface DashboardWidgetGridProps {
  /** Resolved + visible widget entries in order. */
  widgets: DashboardLayoutResponseEntry[];
  /** PAGE-owned renderer map. */
  renderers: Record<string, ReactNode>;
  /** Optional per-widget runtime width overrides. */
  widthOverrides?: Readonly<Record<string, DashboardWidgetWidthUnits>>;
  /** Optional per-widget runtime height-preset overrides. */
  heightOverrides?: Readonly<
    Record<string, NonNullable<DashboardLayoutResponseEntry["heightPreset"]>>
  >;
  /** Optional per-widget row-span overrides. */
  rowSpanOverrides?: Readonly<Record<string, DashboardWidgetRowSpan>>;
  /** Optional class on the outer grid container. */
  className?: string;
  /** Test id forwarded to the container. */
  testId?: string;
  /**
   * Drag-end handler. The grid calls this once with the FULL list of
   * VISIBLE widget keys in their new order. The page wires this to
   * `useDashboardLayout.setOrder`. When omitted, drag is disabled
   * (cells render without sortable wrappers — useful for tests + any
   * read-only consumer).
   *
   * The hook's `setOrder` already preserves hidden widgets' relative
   * order: it accepts a partial visible-only list and appends the
   * unmentioned widgets behind. So passing only the visible-widget
   * keys here is correct.
   */
  onReorder?: (orderedKeys: string[]) => void;
}

export function DashboardWidgetGrid({
  widgets,
  renderers,
  widthOverrides,
  heightOverrides,
  rowSpanOverrides,
  className,
  testId,
  onReorder,
}: DashboardWidgetGridProps) {
  const rows = useMemo(
    () => packDashboardRows(widgets, widthOverrides),
    [widgets, widthOverrides],
  );

  // Sensors: mouse + touch + keyboard.
  // - Mouse: 4 px movement threshold so a click on a card's internal
  //   button (e.g., "Open" toggle, action chevron) doesn't accidentally
  //   start a drag.
  // - Touch: 200 ms hold + 5 px tolerance — finger-press on the
  //   handle reliably enters drag mode without breaking page scroll
  //   on iPad Safari.
  // - Keyboard: Space to pick up, arrow keys to move, Space to drop.
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
      if (!onReorder) return;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = widgets.findIndex(
        (w) => w.widgetKey === active.id,
      );
      const newIndex = widgets.findIndex(
        (w) => w.widgetKey === over.id,
      );
      if (oldIndex < 0 || newIndex < 0) return;
      const reordered = arrayMove(widgets, oldIndex, newIndex);
      onReorder(reordered.map((w) => w.widgetKey));
    },
    [widgets, onReorder],
  );

  const sortableIds = useMemo(
    () => widgets.map((w) => w.widgetKey),
    [widgets],
  );

  const gridContent = (
    <div
      className={`grid grid-cols-12 grid-flow-row-dense gap-3 ${className ?? ""}`.trim()}
      data-testid={testId ?? "dashboard-widget-grid"}
    >
      {rows.flatMap((row, rowIndex) =>
        row.map((w) => {
          const node = renderers[w.widgetKey];
          if (!node) {
            if (
              typeof window !== "undefined" &&
              process.env.NODE_ENV !== "production"
            ) {
              // eslint-disable-next-line no-console
              console.warn(
                `[DashboardWidgetGrid] No renderer for widget "${w.widgetKey}". ` +
                  `Widget will render nothing. Add it to the page's renderers map.`,
              );
            }
            return <Fragment key={w.widgetKey} />;
          }
          const resolvedHeight = heightPresetFor(w, heightOverrides);
          const resolvedRowSpan = rowSpanFor(w, rowSpanOverrides);
          const heightClass =
            resolvedRowSpan === 2 ? "" : HEIGHT_CLASSES[resolvedHeight];
          const rowSpanClass =
            resolvedRowSpan === 2 ? "row-span-2" : "";
          const totalUnits = row.reduce(
            (s, x) => s + widthUnitsFor(x, widthOverrides),
            0,
          );
          const cellClass = `${spanClassFor(w, row, widthOverrides)} ${heightClass} ${rowSpanClass} overflow-hidden`
            .replace(/\s+/g, " ")
            .trim();
          return (
            <SortableWidgetCell
              key={w.widgetKey}
              widget={w}
              cellClass={cellClass}
              draggable={Boolean(onReorder)}
              data-dashboard-row={rowIndex}
              data-dashboard-row-size={row.length}
              data-dashboard-row-units={totalUnits}
              data-dashboard-width-units={widthUnitsFor(w, widthOverrides)}
              data-dashboard-height-preset={resolvedHeight}
              data-dashboard-row-span={resolvedRowSpan}
            >
              {node}
            </SortableWidgetCell>
          );
        }),
      )}
    </div>
  );

  if (!onReorder) {
    return gridContent;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
        {gridContent}
      </SortableContext>
    </DndContext>
  );
}

interface SortableWidgetCellProps {
  widget: DashboardLayoutResponseEntry;
  cellClass: string;
  draggable: boolean;
  children: ReactNode;
  "data-dashboard-row": number;
  "data-dashboard-row-size": number;
  "data-dashboard-row-units": number;
  "data-dashboard-width-units": DashboardWidgetWidthUnits;
  "data-dashboard-height-preset": NonNullable<
    DashboardLayoutResponseEntry["heightPreset"]
  >;
  "data-dashboard-row-span": DashboardWidgetRowSpan;
}

/** One sortable grid cell. The cell wrapper carries the @dnd-kit
 *  transform/transition; the drag handle is absolutely positioned in
 *  the cell's top-right corner so the host widget's card chrome stays
 *  untouched. The handle is the ONLY DnD activator — `attributes` and
 *  `listeners` are spread on the button, NOT on the cell itself, so
 *  clicks anywhere else on the card (including internal buttons,
 *  chevrons, action rows) behave normally and never start a drag. */
function SortableWidgetCell({
  widget,
  cellClass,
  draggable,
  children,
  ...dataAttrs
}: SortableWidgetCellProps) {
  const sortable = useSortable({
    id: widget.widgetKey,
    disabled: !draggable,
  });
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = sortable;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        cellClass,
        "relative",
        // Subtle elevation while dragging so the lifted card reads
        // above its peers without being aggressive.
        isDragging && "scale-[1.02] shadow-lg",
        // Smooth return-to-rest. The transform animation is owned by
        // @dnd-kit; this transition class only affects the shadow /
        // scale snap on drag-start / drag-end.
        "transition-shadow duration-150",
      )}
      data-testid={`dashboard-widget-${widget.widgetKey}`}
      {...dataAttrs}
    >
      {draggable && (
        <button
          type="button"
          aria-label={`Reorder ${widget.title}`}
          title="Drag to reorder"
          className={cn(
            "absolute top-1.5 right-1.5 z-10",
            "inline-flex items-center justify-center h-7 w-7 rounded",
            "bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm",
            "border border-card-border text-text-muted",
            "opacity-40 hover:opacity-100 focus-visible:opacity-100",
            "hover:text-text-primary hover:bg-white dark:hover:bg-gray-900",
            "cursor-grab active:cursor-grabbing",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            // touch-none keeps iPad Safari from interpreting the
            // press-and-drag as a scroll gesture.
            "touch-none select-none",
            "transition-opacity",
          )}
          data-testid={`dashboard-widget-drag-handle-${widget.widgetKey}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      )}
      {children}
    </div>
  );
}
