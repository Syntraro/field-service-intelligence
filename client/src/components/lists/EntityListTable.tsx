/**
 * EntityListTable — canonical grid-based list table for core entity list
 * pages (Leads, Quotes, Invoices in V1; Jobs / Clients / Suppliers /
 * Locations follow in later passes).
 *
 * Why this exists:
 *   The Invoices list page used a hand-tuned `gridTemplateColumns` string
 *   with bare fractional tracks (`0.7fr`, `0.9fr`, …). At moderate
 *   desktop widths the "Awaiting Payment" status badge — `whitespace-nowrap
 *   inline-flex` — became the longest intrinsic content in its track and
 *   forced CSS Grid's track-sizing algorithm to shrink the lowest-weight
 *   fractional tracks (Total / Balance) to satisfy it. Other list pages
 *   (Quotes, Leads) avoided this only because they used shadcn's semantic
 *   `<Table>` whose browser-driven auto-layout uses a different algorithm.
 *
 *   The fix has been applied in two places: (1) the immediate Invoices
 *   page got explicit `minmax(<floor>, fr)` floors, and (2) this
 *   component bakes those floors into the API so a caller cannot
 *   accidentally re-introduce the bug. Every fractional track passes
 *   through `kindToTrack()` which always emits `minmax(<floor>, fr)`,
 *   never bare `Nfr`.
 *
 * V1 scope (matches Leads + Quotes + Invoices):
 *   - column kinds: select / primary / text / status / date / money / badge
 *   - row click navigation
 *   - explicit empty / loading slots
 *   - selectable highlight row
 *
 * V1 deliberately does NOT support: row actions / kebabs (per product
 * direction — core lists are navigational, detail pages own actions),
 * grouping (Clients-only need), keyboard navigation (Jobs-only),
 * infinite scroll (Jobs-only), pagination, sorting, drag/drop,
 * virtualization. Each is an opt-in slot that can land later without
 * breaking the V1 callers.
 *
 * Hard rules baked into the renderer (callers cannot break them):
 *   - Track sizing always emits `minmax(<floor>, ratio*fr)` for fractional
 *     kinds; bare `Nfr` is impossible.
 *   - Money cells are right-aligned, `whitespace-nowrap`, `tabular-nums`.
 *   - Date cells are `whitespace-nowrap`.
 *   - Status cells use a `flex flex-wrap min-w-0` container so multi-badge
 *     compositions (Invoices + QboSyncBadge, Quotes + assessment badges)
 *     wrap within the cell instead of pushing neighbours.
 *   - Primary / text cells get `min-w-0 truncate` so they yield space
 *     to fixed-floor neighbours.
 *   - Select cells stop click propagation so checkbox clicks don't fire
 *     `onRowClick`.
 *
 * Caller composition pattern (see InvoicesListPage post-migration for
 * the full example): callers declare a `EntityListColumn[]` array,
 * provide `rows` + `rowKey` + `onRowClick`, and supply their own custom
 * `render(row)` for each cell. The component owns layout, sizing, and
 * the navigation gesture; the caller owns content.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import {
  listSurfaceClass,
  listHeaderRowClass,
  tableRowClass,
} from "@/components/ui/list-surface";

// ─── Types ──────────────────────────────────────────────────────────────────

export type EntityListColumnKind =
  | "select"
  | "primary"
  | "text"
  | "status"
  | "date"
  | "money"
  | "badge";

export interface EntityListColumn<Row> {
  /** Stable id used as React key for header/cell elements. */
  id: string;
  /** Header content. The component never renders a default — callers
   *  supply the full ReactNode. For `select` columns this is typically
   *  a "select-all" Checkbox; for `money` this is a right-aligned
   *  label. */
  header: React.ReactNode;
  /** Drives default track-sizing, alignment, nowrap, and wrap behavior.
   *  See the kind table in `kindToTrack` and `kindCellClasses` below. */
  kind: EntityListColumnKind;
  /** Cell renderer. Receives the row; returns the cell's inner content.
   *  The component wraps the result in a div with the kind-appropriate
   *  classes (truncate / nowrap / right-align / flex-wrap), so callers
   *  do NOT need to add those manually. */
  render: (row: Row) => React.ReactNode;
  /** Fractional weight (`fr`). Defaults per kind. Ignored for `select`
   *  (always 40px exact). */
  ratio?: number;
  /** Minimum-width floor in px. Overrides the kind default. Required
   *  protective floor for money/date/status; bare `0` is rejected for
   *  fractional kinds at runtime by `kindToTrack`. */
  minWidthPx?: number;
  /** Extra classes applied to BOTH header and cell wrappers. Use
   *  `headerClassName` / `cellClassName` for one-side overrides. */
  className?: string;
  headerClassName?: string;
  cellClassName?: string;
}

export interface EntityListTableProps<Row> {
  rows: Row[];
  columns: EntityListColumn<Row>[];
  /** Stable per-row key (e.g., row.id). Used for React keys + the
   *  `selectedRowKey` highlight comparison. */
  rowKey: (row: Row) => string;
  /** When set, the row container becomes clickable and navigates via
   *  this handler. The renderer adds the standard hover-bg utility from
   *  `tableRowClass`. Pass `undefined` to render rows non-interactive. */
  onRowClick?: (row: Row) => void;
  /** Highlights the row whose key matches. Caller decides what
   *  "selected" means (e.g., last-opened detail). */
  selectedRowKey?: string;
  /** Replaces the rows region when `rows.length === 0` and not loading. */
  emptyState?: React.ReactNode;
  /** Replaces the rows region while parent's data is loading. */
  loadingState?: React.ReactNode;
  /** Outer wrapper extra classes. Applied AFTER `listSurfaceClass`. */
  className?: string;
  /**
   * 2026-05-03 grouping API (V1 — minimal, 1-level only):
   * Optional grouping. When supplied, rows with the same key are
   * collected into a bucket and a header row is rendered before each
   * bucket. Buckets appear in the order their first row appeared in
   * the input `rows` array (no sorting). Group headers are inert: they
   * span all columns, are NOT clickable, do NOT receive `onRowClick`,
   * and are NOT part of selection logic. Rows inside a group render
   * exactly as ungrouped rows do — same `rowKey`, same `onRowClick`,
   * same select-cell propagation guard. Nesting / collapse / sorting
   * are deliberately out of V1.
   *
   * Returning `null` from `groupBy` for a given row puts it in a
   * synthetic "ungrouped" bucket whose header is suppressed (no header
   * row rendered for null-keyed buckets) — this preserves the option
   * for callers to mix grouped + ungrouped rows in one list without
   * forcing the latter to live under a header.
   */
  groupBy?: (row: Row) => string | null;
  /**
   * Custom group-header content. Called once per non-null group key
   * with the bucket's rows. If omitted, the component falls back to
   * rendering the raw `groupKey` as a bold label. Has no effect when
   * `groupBy` is undefined.
   */
  renderGroupHeader?: (groupKey: string, rows: Row[]) => React.ReactNode;
}

// ─── Default per-kind track sizing + cell classes ───────────────────────────

interface KindTrackDefaults {
  ratio: number;       // default fr weight
  minWidthPx: number;  // default min-width floor
}

const KIND_DEFAULTS: Record<Exclude<EntityListColumnKind, "select">, KindTrackDefaults> = {
  // `primary` and `text` use `0` floor so they're free to shrink and
  // truncate. They MUST shrink for fixed-floor money/date columns to
  // stay at their minimums.
  primary: { ratio: 1.5, minWidthPx: 0 },
  text:    { ratio: 1.0, minWidthPx: 0 },
  // `status` is the column that historically caused the bug. 120px is
  // wide enough for typical badges ("Awaiting Payment" ≈ 110-120px);
  // long labels still wrap inside the cell's flex-wrap container.
  status:  { ratio: 0.9, minWidthPx: 120 },
  // `date` floor accommodates the canonical "MMM d, yyyy" formatter
  // (~100px in the project's text-row size) without truncation.
  date:    { ratio: 0.8, minWidthPx: 100 },
  // `money` floor accommodates currency-formatted strings up to ~7 digits.
  money:   { ratio: 0.7, minWidthPx: 96 },
  // `badge` is intrinsic; no floor pressure.
  badge:   { ratio: 0.7, minWidthPx: 0 },
};

const SELECT_TRACK_PX = 40;

/** Resolve a column to its CSS Grid track string. Always emits
 *  `minmax(<px>, <fr>)` for fractional kinds — never bare `Nfr`. */
function kindToTrack(col: EntityListColumn<unknown>): string {
  if (col.kind === "select") {
    return `${SELECT_TRACK_PX}px`;
  }
  const defaults = KIND_DEFAULTS[col.kind];
  const ratio = col.ratio ?? defaults.ratio;
  const minPx = col.minWidthPx ?? defaults.minWidthPx;
  return `minmax(${minPx}px, ${ratio}fr)`;
}

/**
 * Cell classes applied by kind. The renderer adds these on top of any
 * `cellClassName` / `className` the caller supplied.
 *
 * 2026-05-03 typography normalization: typography is now baked in here
 * so no migrated page needs to reapply `text-row` / `text-row-emphasis`
 * / body color classes inside its `render` functions. Pages that need a
 * specific override (a muted placeholder, a colored balance, a darker
 * primary line) wrap the inner content in a span with the override —
 * the cascade picks it up correctly because cell classes set the base.
 *
 * Token map (project semantic tokens, established in Typography Phase D
 * — see `client/src/components/ui/list-surface.tsx` header comment):
 *   text-row           → body baseline
 *   text-caption       → 14px — also the operational-density primary-name
 *                        size after the 2026-05-07 recalibration (paired
 *                        with `font-medium` for weight 500)
 *   text-label         → label/header (cascades from `listHeaderRowClass`
 *                        on the header row; cell wrappers don't restate it)
 *
 * 2026-05-07 operational-density recalibration:
 *   The primary cell previously baked `text-row-emphasis` (15px / 500).
 *   It now composes `text-caption font-medium` (14px / 500) so it
 *   inherits the same density as the canonical `ENTITY_NAME_CLASS`
 *   primitive in `client/src/components/ui/typography.tsx` — the
 *   reference baseline is the row labels in the dashboard's
 *   `OperationalAlertsCard`. Every list page mounted via this primitive
 *   (Clients / Jobs / Invoices / Quotes / Leads / Locations / Suppliers)
 *   inherits the tighter density automatically with no per-screen patch.
 *
 * Hard rules baked in here (callers cannot override the size, only the
 * color/weight via inner spans):
 *   - primary: `text-caption font-medium text-slate-800` — operational
 *     primary-name density. Sub-lines must explicitly set
 *     `font-normal text-helper text-slate-500` (or similar) to break
 *     the medium-weight cascade.
 *   - text / date / money: `text-row text-slate-700` — body color.
 *   - status / badge: `text-row` only — no color (caller controls
 *     because Badge / StatusPill ship their own typography).
 *   - select: no typography (checkbox cell).
 */
function kindCellClasses(kind: EntityListColumnKind): string {
  switch (kind) {
    case "select":
      return "px-4 py-2.5 flex items-center";
    case "primary":
      // `min-w-0` is critical: without it, a flex/grid child with content
      // (text) wider than the column won't shrink, defeating the
      // truncate. With it, the text yields and `truncate` kicks in.
      // Typography matches the canonical `ENTITY_NAME_CLASS` primitive
      // (text-caption font-medium = 14px / 500) — see file-level docs.
      return "px-4 py-2.5 min-w-0 text-caption font-medium text-slate-800";
    case "text":
      return "px-4 py-2.5 min-w-0 text-row text-slate-700";
    case "status":
      // Cell wraps badges in a flex-wrap container so multi-badge
      // compositions wrap to a second line inside the cell instead of
      // pushing the column wider. Color/weight come from the rendered
      // Badge / StatusPill / inline span — the cell only contributes
      // the size baseline.
      return "px-4 py-2.5 min-w-0 text-row";
    case "date":
      return "px-4 py-2.5 whitespace-nowrap text-row text-slate-700";
    case "money":
      return "px-4 py-2.5 whitespace-nowrap tabular-nums text-right text-row text-slate-700";
    case "badge":
      // `badge` is a layout marker for inline pill content. Pills
      // (Badge / EntityNumber) carry their own typography; the cell
      // only contributes the size baseline for any sub-line text the
      // caller stacks under the pill (see Jobs `Job` column).
      return "px-4 py-2.5 text-row";
  }
}

/** Header classes applied by kind. */
function kindHeaderClasses(kind: EntityListColumnKind): string {
  switch (kind) {
    case "select":
      return "px-4 flex items-center";
    case "money":
      return "px-4 text-right";
    default:
      return "px-4";
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Build the `gridTemplateColumns` string from a columns array. Stable
 * across renders for the same column shape.
 */
function buildGridTemplate(columns: EntityListColumn<unknown>[]): string {
  return columns.map(kindToTrack).join(" ");
}

export function EntityListTable<Row>({
  rows,
  columns,
  rowKey,
  onRowClick,
  selectedRowKey,
  emptyState,
  loadingState,
  className,
  groupBy,
  renderGroupHeader,
}: EntityListTableProps<Row>) {
  // The columns array is typically a stable ref from the caller, but we
  // memoize the grid template anyway because rendering the rows below
  // also reads it — re-computing on every render is fine but cheap to
  // avoid.
  const gridTemplate = React.useMemo(
    () => buildGridTemplate(columns as EntityListColumn<unknown>[]),
    [columns],
  );

  // Loading state replaces the rows but still shows the surface chrome.
  // Empty state replaces the rows when the parent has finished loading
  // and there's nothing to show. Header is always rendered so the page
  // doesn't visually jump when state flips.
  const showLoading = loadingState !== undefined && rows.length === 0;
  const showEmpty = !showLoading && emptyState !== undefined && rows.length === 0;

  return (
    <div className={cn(listSurfaceClass, "overflow-hidden", className)} data-testid="entity-list-table">
      {/* Header */}
      <div
        className={cn(listHeaderRowClass)}
        style={{ gridTemplateColumns: gridTemplate }}
      >
        {columns.map((col) => (
          <div
            key={col.id}
            className={cn(
              kindHeaderClasses(col.kind),
              col.className,
              col.headerClassName,
            )}
          >
            {col.header}
          </div>
        ))}
      </div>

      {/* Body */}
      {showLoading ? (
        loadingState
      ) : showEmpty ? (
        emptyState
      ) : groupBy ? (
        renderGroupedBody({
          rows,
          columns,
          rowKey,
          onRowClick,
          selectedRowKey,
          gridTemplate,
          groupBy,
          renderGroupHeader,
        })
      ) : (
        rows.map((row) =>
          renderRow({ row, columns, rowKey, onRowClick, selectedRowKey, gridTemplate }),
        )
      )}
    </div>
  );
}

// ─── Row + group renderers ──────────────────────────────────────────────────

interface RenderRowArgs<Row> {
  row: Row;
  columns: EntityListColumn<Row>[];
  rowKey: (row: Row) => string;
  onRowClick?: (row: Row) => void;
  selectedRowKey?: string;
  gridTemplate: string;
}

function renderRow<Row>({
  row,
  columns,
  rowKey,
  onRowClick,
  selectedRowKey,
  gridTemplate,
}: RenderRowArgs<Row>): React.ReactNode {
  const key = rowKey(row);
  const isSelected = selectedRowKey === key;
  const interactive = Boolean(onRowClick);
  return (
    <div
      key={key}
      className={cn(
        "grid items-center",
        // Reuse canonical row styling. tableRowClass already includes
        // `cursor-pointer hover:bg-... border-b ...` — perfect when
        // interactive. When not interactive, we still want the border/
        // hover but not the cursor; the shared utility's hover is
        // harmless on non-clickable rows so we keep one source of truth.
        tableRowClass,
        isSelected && "bg-slate-50",
      )}
      style={{ gridTemplateColumns: gridTemplate }}
      onClick={interactive ? () => onRowClick!(row) : undefined}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              // Enter triggers row click. Space intentionally not
              // bound to avoid hijacking checkbox space-toggle.
              if (e.key === "Enter") {
                e.preventDefault();
                onRowClick!(row);
              }
            }
          : undefined
      }
      data-testid={`entity-list-row-${key}`}
    >
      {columns.map((col) => {
        const isSelectCell = col.kind === "select";
        return (
          <div
            key={col.id}
            className={cn(
              kindCellClasses(col.kind),
              col.className,
              col.cellClassName,
            )}
            onClick={
              // Stop propagation on select cells so checkbox clicks
              // don't bubble to row navigation.
              isSelectCell ? (e) => e.stopPropagation() : undefined
            }
          >
            {col.kind === "status" ? (
              // Status cell wrapper: flex-wrap so multi-badge
              // compositions wrap inside the cell rather than pushing
              // the column wider.
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                {col.render(row)}
              </div>
            ) : col.kind === "primary" || col.kind === "text" ? (
              // Primary/text cells get truncation by default. Callers
              // can override with `cellClassName` if they want a multi-
              // line/secondary-text layout — they already opt-out by
              // rendering their own block-level structure inside
              // `render`.
              <div className="min-w-0 truncate">{col.render(row)}</div>
            ) : (
              col.render(row)
            )}
          </div>
        );
      })}
    </div>
  );
}

interface RenderGroupedBodyArgs<Row> {
  rows: Row[];
  columns: EntityListColumn<Row>[];
  rowKey: (row: Row) => string;
  onRowClick?: (row: Row) => void;
  selectedRowKey?: string;
  gridTemplate: string;
  groupBy: (row: Row) => string | null;
  renderGroupHeader?: (groupKey: string, rows: Row[]) => React.ReactNode;
}

/**
 * Walks `rows` once in input order, accumulates buckets keyed by
 * `groupBy(row)`, and emits a header row before each non-null bucket
 * followed by its rows. Null-keyed buckets render their rows without a
 * header. Order of buckets matches first-appearance order in the input.
 *
 * Group header layout: a div whose `gridColumn: 1 / -1` spans all
 * columns of the surrounding grid, but it lives inside the same
 * `listSurfaceClass` parent so borders / hover styling stay consistent.
 * The header row's grid template is set to a single full-width track so
 * its content layout doesn't fight the column grid.
 */
function renderGroupedBody<Row>(args: RenderGroupedBodyArgs<Row>): React.ReactNode {
  const { rows, rowKey, gridTemplate, groupBy, renderGroupHeader } = args;

  // Preserve first-appearance order via a parallel array of bucket keys.
  const bucketOrder: (string | null)[] = [];
  const buckets = new Map<string | null, Row[]>();
  for (const row of rows) {
    const key = groupBy(row);
    if (!buckets.has(key)) {
      bucketOrder.push(key);
      buckets.set(key, []);
    }
    buckets.get(key)!.push(row);
  }

  return bucketOrder.map((groupKey) => {
    const groupRows = buckets.get(groupKey)!;
    // Stable React key per bucket. For null buckets we use a sentinel.
    const headerKey = groupKey === null ? "__ungrouped__" : `__group__${groupKey}`;
    return (
      <React.Fragment key={headerKey}>
        {groupKey !== null && (
          <div
            className={cn(
              // Visual: bold, faint background, slightly tighter padding.
              // Matches `listHeaderRowClass` flavour but is intentionally
              // distinct (no uppercase tracking, no full header border).
              "border-b border-[#e5e7eb] dark:border-gray-800 px-4 py-2 text-row-emphasis text-slate-700 bg-slate-50/70 dark:bg-gray-900/40",
            )}
            // Span all columns by collapsing the surrounding grid track
            // template to a single full-width track for this row only.
            // The parent grid's track template only applies via inline
            // style on each row, so giving this row a different style
            // is enough — no stray empty cells from the column grid.
            style={{ gridTemplateColumns: "1fr" }}
            data-testid={`entity-list-group-${groupKey}`}
            // Inert: not clickable, no role, no key handlers, no select
            // logic. Group headers are pure presentation.
            aria-hidden={false}
          >
            {renderGroupHeader ? renderGroupHeader(groupKey, groupRows) : (
              <span className="font-semibold">{groupKey}</span>
            )}
          </div>
        )}
        {groupRows.map((row) =>
          renderRow({
            row,
            columns: args.columns,
            rowKey,
            onRowClick: args.onRowClick,
            selectedRowKey: args.selectedRowKey,
            gridTemplate,
          }),
        )}
      </React.Fragment>
    );
  });
}
