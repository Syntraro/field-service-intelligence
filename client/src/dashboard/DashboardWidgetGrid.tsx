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
 * Why width units (not 12-col math)
 * ---------------------------------
 * The earlier implementation packed widgets on a raw 12-col grid with
 * preset weights of 4 / 8 / 12. The math worked, but it leaked CSS-
 * grid concerns into the layout algorithm. The unit model collapses
 * those concerns: every preset is 1, 2, or 3 units, every row is at
 * most 3 units, and the algorithm reads like the brief.
 *
 * Source-of-truth mapping (preset → units)
 * ----------------------------------------
 *   third      → 1
 *   two-thirds → 2
 *   full       → 3
 *
 * Today's Schedule width override
 * -------------------------------
 * Today's Schedule is the one widget whose useful width depends on
 * runtime data (number of visible team members). Per the brief:
 *   1 visible team member  → 1 unit
 *   2 visible team members → 2 units
 *   3+ visible team members → 3 units (with internal scroll if > 3)
 * The PAGE supplies this via `widthOverrides[widgetKey]`. The grid
 * uses the override when present, falls back to the registry preset
 * otherwise. This keeps the registry stable (the static preset is
 * still the default) while letting the page reflow when the team
 * filter changes inside the schedule card.
 *
 * NO equal-split rebalancing
 * --------------------------
 * Earlier iterations of this file stretched slack rows (sum < 3
 * units) to fill the row — 1 alone became `col-span-12`, 2 became
 * `md:col-span-6` halves. That broke the 3-card mental model: hiding
 * a single peer turned the surviving cards into oversized strips,
 * and users found it disorienting. Per the latest brief, consistent
 * widths beat pixel-fill: a row with 1 visible 1-unit widget renders
 * as a 1/3-width card with 2/3 of empty trailing space, and a row
 * with 2 visible 1-unit widgets renders as two 1/3 cards with the
 * final 1/3 empty. Responsive stacking on smaller breakpoints still
 * uses the natural responsive curve baked into NATURAL_SPAN_CLASSES.
 *
 * The grid does NO drag-and-drop. Reordering happens inside the
 * customize drawer (DashboardCustomizeDrawer.tsx). The grid is
 * presentation-only.
 */
import { Fragment, useMemo, type ReactNode } from "react";
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

/** Per-heightPreset Tailwind height class.
 *
 *  2026-05-07 RALPH: `summary` is a FIXED height — `h-[300px]` —
 *  shorter than the previous 420px iteration. The shorter card lets
 *  more dashboard content sit above the fold; Today's Schedule's
 *  body still scrolls internally if a busy day overflows. Every
 *  default dashboard widget uses `summary`, so every card lands on
 *  the same visual rhythm regardless of content.
 *
 *  `large` / `compact` / `auto` remain in the type union as escape
 *  hatches for future widgets that genuinely need a different
 *  height — they're not used by any widget today. */
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
 *  in stacked mode when content exceeds the standard card height).
 *  No widget exceeds 2 today. */
export type DashboardWidgetRowSpan = 1 | 2;

/** Resolve a widget's effective row span — runtime override wins
 *  over the registry default (which is always 1). Exposed for tests. */
export function rowSpanFor(
  widget: DashboardLayoutResponseEntry,
  overrides: Readonly<Record<string, DashboardWidgetRowSpan>> = {},
): DashboardWidgetRowSpan {
  const override = overrides[widget.widgetKey];
  if (override === 1 || override === 2) return override;
  return 1;
}

/** Resolve a widget's effective height preset — runtime override wins
 *  over the registry preset. Used for widgets like Today's Schedule
 *  whose useful height changes with the visible team count: at 1
 *  visible tech the card is summary-sized; at 2+ it grows to large. */
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

/** Greedy-pack visible widgets into rows of <= 3 units. Order is
 *  preserved exactly — the user's drag-reordered order maps 1:1 to
 *  the rendered order. Exposed for tests. */
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

/** Pick the col-span class for one widget. ALWAYS the natural class
 *  for the widget's width units — leftover row space is preserved
 *  empty rather than stretched. The `row` argument is retained for
 *  the call signature so call sites that still pass the resolved row
 *  don't break, but the natural class no longer depends on it. */
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
  /** PAGE-owned renderer map. Keys MUST match the registry's widget
   *  keys; missing keys are silently skipped (warning in dev console)
   *  so a partial rollout doesn't crash the page. */
  renderers: Record<string, ReactNode>;
  /** Optional per-widget runtime width overrides keyed by `widgetKey`.
   *  The page can use this to size a widget based on runtime data
   *  (e.g., Today's Schedule shrinks when the team filter narrows
   *  the visible technician set). When omitted, every widget uses
   *  its registry preset. */
  widthOverrides?: Readonly<Record<string, DashboardWidgetWidthUnits>>;
  /** Optional per-widget runtime height-preset overrides keyed by
   *  `widgetKey`. Mirrors `widthOverrides` for content-height. Use
   *  this when a widget's useful height depends on runtime data —
   *  e.g., Today's Schedule is `summary` at 1 visible tech and
   *  `large` at 2+ techs. When omitted, the registry's heightPreset
   *  is used (or `"auto"` if unset). */
  heightOverrides?: Readonly<
    Record<string, NonNullable<DashboardLayoutResponseEntry["heightPreset"]>>
  >;
  /** Optional per-widget row-span overrides keyed by `widgetKey`.
   *  When `2`, the cell occupies two grid row tracks AND drops its
   *  fixed height so it stretches to fill the 2-track area (≈ 612 px
   *  with a 12 px row gap). Combined with the grid's
   *  `grid-flow-row-dense` flag, smaller cards naturally backfill
   *  the empty slots beside the taller widget. Used by Today's
   *  Schedule in stacked mode when the schedule content exceeds the
   *  standard 300 px card height. */
  rowSpanOverrides?: Readonly<Record<string, DashboardWidgetRowSpan>>;
  /** Optional class on the outer grid container. */
  className?: string;
  /** Test id forwarded to the container. */
  testId?: string;
}

export function DashboardWidgetGrid({
  widgets,
  renderers,
  widthOverrides,
  heightOverrides,
  rowSpanOverrides,
  className,
  testId,
}: DashboardWidgetGridProps) {
  const rows = useMemo(
    () => packDashboardRows(widgets, widthOverrides),
    [widgets, widthOverrides],
  );

  return (
    // 2026-05-07 RALPH: `grid-flow-row-dense` lets smaller cards
    // backfill empty slots next to a row-span-2 widget (Today's
    // Schedule in stacked + content-overflow mode). Without dense
    // flow, CSS Grid would leave the empty slots blank rather than
    // fill them with later items.
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
          // 2026-05-07 RALPH: row-span-2 cells DROP the fixed
          // `h-[300px]` so they stretch to fill the 2-track area
          // (the surrounding cells in those tracks declare
          // `h-[300px]` each, so each track is 300 px → the
          // row-span-2 cell ends up ≈ 612 px with the 12 px gap).
          // For row-span 1, the canonical fixed height applies.
          const heightClass =
            resolvedRowSpan === 2 ? "" : HEIGHT_CLASSES[resolvedHeight];
          const rowSpanClass =
            resolvedRowSpan === 2 ? "row-span-2" : "";
          const totalUnits = row.reduce(
            (s, x) => s + widthUnitsFor(x, widthOverrides),
            0,
          );
          // `overflow-hidden` on the grid cell is the canonical
          // height clamp. Without it, CSS-grid items with declared
          // heights can still visually overflow when their inner
          // content grows past the declared value, stretching the
          // row track. The card chrome inside (DashCard / CardShell)
          // handles its own internal scroll via
          // `flex-1 min-h-0 overflow-y-auto` on the body.
          return (
            <div
              key={w.widgetKey}
              className={`${spanClassFor(w, row, widthOverrides)} ${heightClass} ${rowSpanClass} overflow-hidden`
                .replace(/\s+/g, " ")
                .trim()}
              data-testid={`dashboard-widget-${w.widgetKey}`}
              data-dashboard-row={rowIndex}
              data-dashboard-row-size={row.length}
              data-dashboard-row-units={totalUnits}
              data-dashboard-width-units={widthUnitsFor(w, widthOverrides)}
              data-dashboard-height-preset={resolvedHeight}
              data-dashboard-row-span={resolvedRowSpan}
            >
              {node}
            </div>
          );
        }),
      )}
    </div>
  );
}
