/**
 * EntityListTable — canonical grid-based list table for core entity list
 * pages (Jobs, Invoices, Quotes, Leads, Clients, Locations, Suppliers,
 * Inventory, PMWorkspacePage).
 *
 * Architecture (2026-05-08 canonical refactor):
 *   The component is a TRUE canonical renderer, not just a shared shell.
 *   Columns declare WHAT to render via the typed `EntityListCell<Row>`
 *   discriminated union — the component handles the HOW. Common patterns
 *   (primary name + secondary, plain text, entity number, status chip,
 *   date, money) are first-class typed descriptors; `customRender` is the
 *   named escape hatch for one-off compositions.
 *
 * Cell type → rendering contract:
 *   entity-primary — two-line name/secondary block; `secondary` and `testId` optional.
 *   entity-text    — single truncated text line; inherits `min-w-0` from kind.
 *   entity-number  — EntityNumber variant="primary" blue pill.
 *   entity-status  — StatusChip (tone + label from meta function).
 *   entity-date    — formatDate(value) string; optional isActive/overdueWhen for conditional states.
 *   entity-money   — formatCurrency(value) string.
 *   customRender   — caller-owned ReactNode; escape hatch; visible in code.
 *
 * Canonical sort:
 *   Add `sortKey` to a column and `sortField/sortDirection/onSort` to the
 *   table to get a canonical sort button in the header. Replaces page-local
 *   SortableHeaderCell / SortHeader components.
 *
 * `align` prop:
 *   "left" (default) | "right" | "center". Replaces cellClassName /
 *   headerClassName overrides for alignment. Money kind defaults to right.
 *
 * Hard rules baked into the renderer (callers cannot break them):
 *   - Track sizing always emits `minmax(<floor>, ratio*fr)` for fractional
 *     kinds; bare `Nfr` is impossible.
 *   - Money cells are right-aligned, `whitespace-nowrap`, `tabular-nums`.
 *   - Date cells are `whitespace-nowrap`.
 *   - Status cells wrap content in `flex flex-wrap min-w-0` (for multi-
 *     badge compositions).
 *   - Select cells stop click propagation and center their content.
 */
import * as React from "react";
import { ChevronUp, ChevronDown, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  listSurfaceClass,
  listHeaderRowClass,
  tableRowClass,
  ENTITY_SECONDARY_CLASS,
} from "@/components/ui/list-surface";
import { StatusChip } from "@/components/ui/chip";
import { EntityNumber } from "@/components/common/EntityNumber";
import { formatDate, formatCurrency } from "@/lib/formatters";
import { StateBlock, type StateBlockProps } from "@/components/ui/state-block";

// ─── Cell type system ────────────────────────────────────────────────────────

/**
 * Typed cell descriptor — the core of the canonical renderer contract.
 * Each type maps to a canonical rendering in the component; `customRender`
 * is the visible escape hatch for surfaces that don't fit a typed descriptor.
 */
export type EntityListCell<Row> =
  | {
      type: "entity-primary";
      /** Primary text — rendered with text-list-primary (15px/20px/500). */
      value: (row: Row) => string | null | undefined;
      /** Optional secondary line — rendered with ENTITY_SECONDARY_CLASS. */
      secondary?: (row: Row) => string | null | undefined;
      /** Optional data-testid applied directly to the primary line element. */
      testId?: (row: Row) => string;
    }
  | {
      type: "entity-text";
      /** Truncated text line — inherits `min-w-0` from the kind wrapper. */
      value: (row: Row) => string | null | undefined;
    }
  | {
      type: "entity-number";
      /** Entity number string or number — rendered as EntityNumber primary pill. */
      value: (row: Row) => string | number | null | undefined;
    }
  | {
      type: "entity-status";
      /** Returns `{ label, tone }` — rendered as StatusChip. */
      getStatusMeta: (row: Row) => { label: string; tone: string };
    }
  | {
      type: "entity-date";
      /** ISO date string — formatted via canonical formatDate(). */
      value: (row: Row) => string | Date | null | undefined;
      /**
       * Optional: when provided and returns false for a row, the cell renders
       * "Inactive" in muted style instead of the date value.
       */
      isActive?: (row: Row) => boolean;
      /**
       * Optional: when provided and returns true, the cell renders "Overdue"
       * in red/semibold style. Evaluated only when isActive is absent or true.
       */
      overdueWhen?: (row: Row) => boolean;
    }
  | {
      type: "entity-money";
      /** Numeric or string amount — formatted via canonical formatCurrency(). */
      value: (row: Row) => string | number | null | undefined;
    }
  | {
      type: "customRender";
      /**
       * Required justification. customRender is an escape hatch — before using
       * it, confirm that no existing descriptor fits (entity-primary,
       * entity-text, entity-status, entity-date, entity-money, entity-number).
       * Add a reason and update the allowlist in tests/entity-list-canonical.test.ts.
       */
      reason: string;
      /** Caller-owned render function. The caller is responsible for truncation,
       *  min-w-0, and all typography since the component adds no wrapper. */
      render: (row: Row) => React.ReactNode;
    };

// ─── Column + table interfaces ───────────────────────────────────────────────

export type EntityListColumnKind =
  | "select"
  | "primary"
  | "text"
  | "status"
  | "date"
  | "money"
  | "badge"
  | "body";

export interface EntityListColumn<Row> {
  /** Stable id used as React key for header/cell elements. */
  id: string;
  /** Header content. Plain strings are styled by listHeaderRowClass.
   *  When `sortKey` is set, the component wraps this in a sort button. */
  header: React.ReactNode;
  /** Drives track-sizing, padding, alignment, and nowrap/wrap behavior. */
  kind: EntityListColumnKind;
  /** Typed cell descriptor — replaces the old open `render()` function. */
  cell: EntityListCell<Row>;
  /** Fractional weight (`fr`). Kind defaults apply when omitted. */
  ratio?: number;
  /** Minimum-width floor in px. Overrides the kind default. */
  minWidthPx?: number;
  /** Extra classes on BOTH header and cell wrappers. */
  className?: string;
  /**
   * Cell + header alignment override.
   * `money` kind defaults to "right"; all others default to "left".
   * "center" is for icon-only cells (Active column, etc.).
   */
  align?: "left" | "right" | "center";
  /**
   * Sort key for canonical sort. When set AND the table receives `onSort`,
   * the header renders as a clickable sort button with chevron indicators.
   * Replaces page-local SortableHeaderCell / SortHeader components.
   */
  sortKey?: string;
}

export interface EntityListTableProps<Row> {
  rows: Row[];
  columns: EntityListColumn<Row>[];
  /** Stable per-row key (e.g., row.id). Used for React keys + selected highlight. */
  rowKey: (row: Row) => string;
  /** Row click handler. Adds hover-bg and cursor-pointer from `tableRowClass`. */
  onRowClick?: (row: Row) => void;
  /** Highlights the row whose key matches. */
  selectedRowKey?: string;
  /**
   * Typed empty-state descriptor rendered by StateBlock when rows.length === 0
   * and no loading/error state is active. Replaces the former ReactNode slot.
   * Use legacyEmptyStateNode only for callers that can't yet migrate.
   */
  emptyState?: StateBlockProps;
  /**
   * Loading state descriptor.
   *   true              → canonical StateBlock kind="loading" title="Loading…"
   *   StateBlockProps   → that descriptor (add kind/title/testId as needed)
   *   undefined / false → no loading state shown
   * Use legacyLoadingStateNode for skeleton-row patterns that are intentionally
   * better UX than a spinner (e.g., Inventory tabs).
   */
  loadingState?: boolean | StateBlockProps;
  /** Error state descriptor. Shown when rows === 0, not loading, not empty. */
  errorState?: StateBlockProps;
  /** Back-compat: ReactNode empty state for callers not yet migrated. */
  legacyEmptyStateNode?: React.ReactNode;
  /** Back-compat: ReactNode loading state for skeleton patterns (Inventory). */
  legacyLoadingStateNode?: React.ReactNode;
  /** Outer wrapper extra classes. Applied AFTER `listSurfaceClass`. */
  className?: string;
  /**
   * When true, the table outer div becomes a flex column so it can participate
   * in a fill-height layout. State blocks (loading/empty/error) are wrapped in
   * a flex-1 centering div so they appear vertically centered rather than
   * cramped at the top. Pass this when the table sits inside a flex-1 container.
   */
  fillHeight?: boolean;
  /**
   * Tailwind class(es) applied to the selected row's outer div.
   * Defaults to "bg-slate-50". Override to "bg-blue-50" in workspaces where the
   * selected row represents an active focus (e.g. Receivables center panel).
   */
  selectedHighlightClass?: string;
  /**
   * Optional grouping. Rows with the same key are rendered under a group
   * header. `null` keys render without a header (ungrouped bucket).
   * Group headers span all columns and are NOT clickable.
   */
  groupBy?: (row: Row) => string | null;
  /** Custom group-header content. Falls back to the raw `groupKey` string. */
  renderGroupHeader?: (groupKey: string, rows: Row[]) => React.ReactNode;
  /**
   * Canonical sort props. Pass all three together:
   *   `sortField`    — active sort key (matches a column's `sortKey`).
   *   `sortDirection` — "asc" | "desc".
   *   `onSort`       — called with the clicked column's `sortKey`.
   * Sort logic stays entirely in the page (compare function, state). The
   * component only renders the sort indicator + fires onSort.
   */
  sortField?: string;
  sortDirection?: "asc" | "desc";
  onSort?: (key: string) => void;
  /**
   * Optional inline row detail renderer (receivables workspace).
   * Called for each row after it renders. When it returns a non-null node,
   * that node is rendered immediately below the row in document flow.
   * The detail spans the full container width naturally (block flow).
   */
  inlineRowDetail?: (row: Row, rowKey: string) => React.ReactNode | null | undefined;
  /**
   * Optional ref callback invoked when a row mounts or unmounts.
   * Receives the row key and the DOM element (or null on unmount).
   * Used by receivables mode to track row positions for auto-scroll.
   */
  rowRef?: (key: string, el: HTMLElement | null) => void;
  /**
   * Optional per-row extra className injected after all other row classes.
   * Receives the row and whether it is currently selected.
   * Used by receivables workspace for focused-selection dim/blur effect.
   */
  getRowClassName?: (row: Row, isSelected: boolean) => string;
  /**
   * Vertical padding class applied to every data cell (default "py-1.5").
   * Pass "py-2.5" in workspaces that want taller rows.
   */
  cellPy?: string;
}

// ─── Default per-kind track sizing ──────────────────────────────────────────

interface KindTrackDefaults {
  ratio: number;
  minWidthPx: number;
}

const KIND_DEFAULTS: Record<Exclude<EntityListColumnKind, "select">, KindTrackDefaults> = {
  primary: { ratio: 1.5, minWidthPx: 0 },
  text:    { ratio: 1.0, minWidthPx: 0 },
  body:    { ratio: 1.0, minWidthPx: 0 },
  status:  { ratio: 0.9, minWidthPx: 120 },
  date:    { ratio: 0.8, minWidthPx: 100 },
  money:   { ratio: 0.7, minWidthPx: 96 },
  badge:   { ratio: 0.7, minWidthPx: 0 },
};

const SELECT_TRACK_PX = 40;

function kindToTrack(col: EntityListColumn<unknown>): string {
  if (col.kind === "select") return `${SELECT_TRACK_PX}px`;
  const defaults = KIND_DEFAULTS[col.kind];
  const ratio = col.ratio ?? defaults.ratio;
  const minPx = col.minWidthPx ?? defaults.minWidthPx;
  return `minmax(${minPx}px, ${ratio}fr)`;
}

/**
 * Cell classes applied by kind.
 *
 * Typography tokens (locked — cannot be overridden at the cell level):
 *   text-list-primary       → primary (15px / 20px / 500)
 *   text-list-body          → text, body, date, money (15px / 20px / 400)
 *   text-row                → status, badge (14px — pills bring their own)
 *   (none)                  → select
 *
 * Secondary sub-lines (entity-primary secondary:) use ENTITY_SECONDARY_CLASS
 * (text-helper 13px / 400) — intentionally smaller to subordinate them to
 * the primary line. This is the only remaining text-helper path.
 *
 * 2026-05-09 normalization: text / date / money bumped from text-helper (13px)
 * to text-list-body (15px / 20px / 400) for visual consistency with primary.
 */
function kindCellClasses(kind: EntityListColumnKind, align?: "left" | "right" | "center", cellPy = "py-1.5"): string {
  const alignCls = align === "center" ? " justify-center text-center"
    : align === "right" ? " text-right"
    : "";

  switch (kind) {
    case "select":
      // Centered checkbox; stop-propagation added in renderRow.
      return `px-4 ${cellPy} flex items-center justify-center`;
    case "primary":
      return `px-4 ${cellPy} min-w-0 text-list-primary text-slate-800${alignCls}`;
    case "body":
      return `px-4 ${cellPy} min-w-0 text-list-body text-slate-700${alignCls}`;
    case "text":
      return `px-4 ${cellPy} min-w-0 text-list-body text-slate-700${alignCls}`;
    case "status":
      return `px-4 ${cellPy} min-w-0 text-row${alignCls}`;
    case "date":
      return `px-4 ${cellPy} whitespace-nowrap text-list-body text-slate-700${alignCls}`;
    case "money":
      // Money defaults to right; caller can override via `align`.
      return `px-4 ${cellPy} whitespace-nowrap tabular-nums text-right text-list-body text-slate-700${align === "left" || align === "center" ? alignCls : ""}`;
    case "badge":
      return `px-4 ${cellPy} text-row${alignCls}`;
  }
}

/** Header classes applied by kind. When `hasSortButton` is true, the sort
 *  button inside supplies its own `px-4` — suppress the kind padding. */
function kindHeaderClasses(
  kind: EntityListColumnKind,
  align?: "left" | "right" | "center",
  hasSortButton?: boolean,
): string {
  const padding = hasSortButton ? "" : "px-4";
  const alignCls = align === "center" ? " text-center"
    : align === "right" ? " text-right"
    : "";

  switch (kind) {
    case "select":
      return `${padding} flex items-center justify-center`;
    case "money":
      // Money defaults to right.
      return `${padding}${align === "left" || align === "center" ? alignCls : " text-right"}`;
    default:
      return `${padding}${alignCls}`;
  }
}

// ─── Cell content renderer ───────────────────────────────────────────────────

function renderCellContent<Row>(
  cell: EntityListCell<Row>,
  row: Row,
  kind: EntityListColumnKind,
): React.ReactNode {
  switch (cell.type) {
    case "entity-primary": {
      const val = cell.value(row);
      const sec = cell.secondary?.(row);
      return (
        <div className="min-w-0">
          <div
            className="text-list-primary truncate"
            data-testid={cell.testId ? cell.testId(row) : undefined}
          >{val ?? "—"}</div>
          {sec ? <div className={ENTITY_SECONDARY_CLASS}>{sec}</div> : null}
        </div>
      );
    }
    case "entity-text":
      return <div className="truncate">{cell.value(row) ?? "—"}</div>;
    case "entity-number":
      return (
        <EntityNumber variant="primary">
          {cell.value(row)}
        </EntityNumber>
      );
    case "entity-status": {
      const meta = cell.getStatusMeta(row);
      return (
        <StatusChip tone={meta.tone as Parameters<typeof StatusChip>[0]["tone"]}>
          {meta.label}
        </StatusChip>
      );
    }
    case "entity-date": {
      if (cell.isActive && !cell.isActive(row)) {
        return <span className="text-muted-foreground">Inactive</span>;
      }
      const val = cell.value(row);
      if (!val) return <span className="text-muted-foreground">—</span>;
      if (cell.overdueWhen?.(row)) {
        return <span className="text-red-700 font-semibold">Overdue</span>;
      }
      return formatDate(val instanceof Date ? val.toISOString() : (val as string | null | undefined));
    }
    case "entity-money":
      return formatCurrency(cell.value(row));
    case "customRender":
      return cell.render(row);
  }
}

// ─── Grid template ───────────────────────────────────────────────────────────

function buildGridTemplate(columns: EntityListColumn<unknown>[]): string {
  return columns.map(kindToTrack).join(" ");
}

// ─── Sort header ─────────────────────────────────────────────────────────────

function SortButton({
  children,
  active,
  direction,
  onClick,
  align,
}: {
  children: React.ReactNode;
  active: boolean;
  direction?: "asc" | "desc";
  onClick: () => void;
  align?: "left" | "right" | "center";
}) {
  const justifyCls = align === "right" ? "justify-end"
    : align === "center" ? "justify-center"
    : "justify-start";
  return (
    <button
      type="button"
      className={cn(
        "flex items-center gap-1 px-4 w-full text-left hover:text-foreground select-none cursor-pointer",
        justifyCls,
      )}
      onClick={onClick}
    >
      {children}
      {active ? (
        direction === "asc"
          ? <ChevronUp className="h-3 w-3 shrink-0" />
          : <ChevronDown className="h-3 w-3 shrink-0" />
      ) : (
        <ArrowUpDown className="h-3 w-3 shrink-0 opacity-30" />
      )}
    </button>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export function EntityListTable<Row>({
  rows,
  columns,
  rowKey,
  onRowClick,
  selectedRowKey,
  emptyState,
  loadingState,
  errorState,
  legacyEmptyStateNode,
  legacyLoadingStateNode,
  className,
  fillHeight,
  selectedHighlightClass,
  groupBy,
  renderGroupHeader,
  sortField,
  sortDirection,
  onSort,
  inlineRowDetail,
  rowRef,
  getRowClassName,
  cellPy = "py-1.5",
}: EntityListTableProps<Row>) {
  const gridTemplate = React.useMemo(
    () => buildGridTemplate(columns as EntityListColumn<unknown>[]),
    [columns],
  );

  // Typed loading wins over legacy loading; both gate on rows.length === 0.
  const showTypedLoading  = !!loadingState && rows.length === 0;
  const showLegacyLoading = !showTypedLoading && !!legacyLoadingStateNode && rows.length === 0;
  const isLoadingAny      = showTypedLoading || showLegacyLoading;
  const showError  = !!errorState && !isLoadingAny && rows.length === 0;
  const showEmpty  = !isLoadingAny && !showError && rows.length === 0 &&
                     (!!emptyState || !!legacyEmptyStateNode);

  // When fillHeight=true and showing a state, the outer div becomes a flex
  // column so the state block can fill and vertically center within its parent.
  const showingState = showTypedLoading || showLegacyLoading || showError || showEmpty;

  return (
    <div
      className={cn(
        listSurfaceClass,
        "overflow-hidden",
        fillHeight && showingState && "flex flex-col",
        className,
      )}
      data-testid="entity-list-table"
    >
      {/* Header */}
      <div className={cn(listHeaderRowClass)} style={{ gridTemplateColumns: gridTemplate }}>
        {columns.map((col) => {
          const hasSortButton = Boolean(col.sortKey && onSort);
          return (
            <div
              key={col.id}
              className={cn(
                kindHeaderClasses(col.kind, col.align, hasSortButton),
                col.className,
              )}
            >
              {hasSortButton ? (
                <SortButton
                  active={sortField === col.sortKey}
                  direction={sortField === col.sortKey ? sortDirection : undefined}
                  onClick={() => onSort!(col.sortKey!)}
                  align={col.align}
                >
                  {col.header}
                </SortButton>
              ) : (
                col.header
              )}
            </div>
          );
        })}
      </div>

      {/* Body — state priority: loading > error > empty > rows */}
      {showTypedLoading ? (
        fillHeight ? (
          <div className="flex-1 flex items-center justify-center">
            {loadingState === true
              ? <StateBlock kind="loading" title="Loading…" />
              : <StateBlock {...(loadingState as StateBlockProps)} />}
          </div>
        ) : loadingState === true
          ? <StateBlock kind="loading" title="Loading…" />
          : <StateBlock {...(loadingState as StateBlockProps)} />
      ) : showLegacyLoading ? (
        legacyLoadingStateNode
      ) : showError ? (
        fillHeight
          ? <div className="flex-1 flex items-center justify-center"><StateBlock {...errorState!} /></div>
          : <StateBlock {...errorState!} />
      ) : showEmpty ? (
        fillHeight
          ? <div className="flex-1 flex items-center justify-center">{legacyEmptyStateNode ?? <StateBlock {...emptyState!} />}</div>
          : (legacyEmptyStateNode ?? <StateBlock {...emptyState!} />)
      ) : groupBy ? (
        renderGroupedBody({
          rows,
          columns,
          rowKey,
          onRowClick,
          selectedRowKey,
          selectedHighlightClass,
          gridTemplate,
          groupBy,
          renderGroupHeader,
          sortField,
          sortDirection,
          cellPy,
        })
      ) : (
        rows.map((row) => {
          const key = rowKey(row);
          const rowNode = renderRow({ row, columns, rowKey, onRowClick, selectedRowKey, selectedHighlightClass, gridTemplate, rowRef, getRowClassName, cellPy });
          if (!inlineRowDetail) return rowNode;
          const detail = inlineRowDetail(row, key);
          if (!detail) return rowNode;
          return (
            <React.Fragment key={key}>
              {rowNode}
              {detail}
            </React.Fragment>
          );
        })
      )}
    </div>
  );
}

// ─── Row renderer ────────────────────────────────────────────────────────────

interface RenderRowArgs<Row> {
  row: Row;
  columns: EntityListColumn<Row>[];
  rowKey: (row: Row) => string;
  onRowClick?: (row: Row) => void;
  selectedRowKey?: string;
  selectedHighlightClass?: string;
  gridTemplate: string;
  rowRef?: (key: string, el: HTMLElement | null) => void;
  getRowClassName?: (row: Row, isSelected: boolean) => string;
  cellPy?: string;
}

function renderRow<Row>({
  row,
  columns,
  rowKey,
  onRowClick,
  selectedRowKey,
  selectedHighlightClass,
  gridTemplate,
  rowRef,
  getRowClassName,
  cellPy = "py-1.5",
}: RenderRowArgs<Row>): React.ReactNode {
  const key = rowKey(row);
  const isSelected = selectedRowKey === key;
  const interactive = Boolean(onRowClick);
  return (
    <div
      key={key}
      ref={rowRef ? (el) => rowRef(key, el) : undefined}
      className={cn(
        "grid items-center",
        tableRowClass,
        isSelected && (selectedHighlightClass ?? "bg-slate-50"),
        getRowClassName?.(row, isSelected),
      )}
      style={{ gridTemplateColumns: gridTemplate }}
      onClick={interactive ? () => onRowClick!(row) : undefined}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
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
        const content = renderCellContent(col.cell, row, col.kind);

        // Status cells always wrap in flex-wrap for multi-badge compositions.
        const wrappedContent =
          col.kind === "status" ? (
            <div className="flex items-center gap-2 flex-wrap min-w-0">{content}</div>
          ) : (
            content
          );

        return (
          <div
            key={col.id}
            className={cn(kindCellClasses(col.kind, col.align, cellPy), col.className)}
            onClick={isSelectCell ? (e) => e.stopPropagation() : undefined}
          >
            {wrappedContent}
          </div>
        );
      })}
    </div>
  );
}

// ─── Grouped body renderer ───────────────────────────────────────────────────

interface RenderGroupedBodyArgs<Row> {
  rows: Row[];
  columns: EntityListColumn<Row>[];
  rowKey: (row: Row) => string;
  onRowClick?: (row: Row) => void;
  selectedRowKey?: string;
  selectedHighlightClass?: string;
  gridTemplate: string;
  groupBy: (row: Row) => string | null;
  renderGroupHeader?: (groupKey: string, rows: Row[]) => React.ReactNode;
  sortField?: string;
  sortDirection?: "asc" | "desc";
  cellPy?: string;
}

function renderGroupedBody<Row>(args: RenderGroupedBodyArgs<Row>): React.ReactNode {
  const { rows, rowKey, gridTemplate, groupBy, renderGroupHeader, selectedHighlightClass, cellPy } = args;

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
    const headerKey = groupKey === null ? "__ungrouped__" : `__group__${groupKey}`;
    return (
      <React.Fragment key={headerKey}>
        {groupKey !== null && (
          <div
            className={cn(
              "border-b border-[#e5e7eb] dark:border-gray-800 px-4 py-2 text-emphasis text-slate-700 bg-slate-50/70 dark:bg-gray-900/40",
            )}
            style={{ gridTemplateColumns: "1fr" }}
            data-testid={`entity-list-group-${groupKey}`}
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
            selectedHighlightClass,
            gridTemplate,
            cellPy,
          }),
        )}
      </React.Fragment>
    );
  });
}
