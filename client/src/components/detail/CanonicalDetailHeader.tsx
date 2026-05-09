/**
 * CanonicalDetailHeader (2026-05-01, card layout extended 2026-05-08)
 *
 * Single canonical compact header for every detail-page surface
 * (Job Detail, Invoice Detail, future Quote Detail). Slot-based and
 * purely presentational — owns NO data fetching, NO mutations, NO
 * state. Each consumer page passes the title, status, metadata items,
 * and action buttons it owns; this component is responsible only for
 * the layout and consistent styling.
 *
 * Two layout variants
 * -------------------
 * layout="strip" (default — backward-compat for InvoiceDetailPage):
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ Title [Status]      Item₁ │ Item₂ │ … │ Itemₙ [✎]      Actions… │
 *   └──────────────────────────────────────────────────────────────────┘
 *   Full-width strip; sits directly under the dark app top bar.
 *   Three regions on one row:
 *     LEFT   = title + status (natural width, left-justified)
 *     CENTER = metadata items + optional edit pencil (mx-auto)
 *     RIGHT  = actions cluster (natural width, right-justified)
 *
 * layout="card" (2026-05-08 — content-only two-column layout):
 *   ┌─────────────────────────────────┬──────────────────────────────┐
 *   │ H1 title           [Status]     │                 Actions…     │
 *   │ Client name                     │  Label  Label  Label         │
 *   │ Service Address                 │  Value  Value  Value         │
 *   └─────────────────────────────────┴──────────────────────────────┘
 *   No card chrome — caller wraps in CardShell (or equivalent).
 *   The component renders `<div className="px-5 pt-4 pb-4">` and the
 *   two-column flex layout inside. On narrow viewports the right
 *   column drops below the left (`lg:flex-row` breakpoint).
 *   Card-mode metadata grid:
 *     - Items render right-aligned (items-end) under the actions.
 *     - Items with `hidden: true` are filtered out in read mode so
 *       optional fields don't consume space when empty.
 *     - Items with `editNode` are always shown in edit mode (lets the
 *       user fill in a field that was previously empty).
 *
 * Migration state (2026-05-08)
 * ----------------------------
 *   InvoiceDetailPage — strip layout (already canonical, no change)
 *   JobDetailPage     — card layout (migrated 2026-05-08)
 *   QuoteDetailPage   — next (QuoteHeaderCard identity section)
 *   LeadDetailPage    — next (LeadSummaryCard, draft-mode complexity)
 */

import { Fragment, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface DetailHeaderItem {
  /** Stable key — used as React key + appended to data-testid */
  key: string;
  /** Top label, e.g. "Job #", "Scheduled" */
  label: string;
  /** Read-mode value. ReactNode so callers can pass links / formatted
   *  dates / em-dash placeholders. The strip layout does not hide items
   *  with empty/null values — pass an explicit `<span>—</span>` for
   *  the muted-dash placeholder per the canonical layout contract. */
  value: ReactNode;
  /** Edit-mode override. When the parent's `isEditing` is true AND
   *  this item supplies an `editNode`, the header renders the
   *  editNode in place of `value`. Pages own all state; this slot
   *  receives whatever input/picker the page already wires elsewhere
   *  in its edit form. Items without an `editNode` stay read-only
   *  even in edit mode. */
  editNode?: ReactNode;
  /** Card mode only: when true and NOT editing, this item is not
   *  rendered. When editing AND `editNode` is set, always shown so the
   *  user can fill in a field that was previously empty. Use for
   *  optional metadata that should not consume space when empty. */
  hidden?: boolean;
}

export interface CanonicalDetailHeaderProps {
  /** Primary title. Strip mode wraps in `<h1>`; card mode renders as-is
   *  (callers provide the H1 or textarea element directly, allowing the
   *  edit-mode textarea swap without a wrapper mutation). */
  title: ReactNode;
  /** Status badge — already-styled element (e.g. `<StatusChip>`). */
  statusBadge?: ReactNode;
  /** Metadata items. Strip: rendered with vertical dividers in center.
   *  Card: rendered as right-aligned label/value pairs under actions;
   *  items with `hidden: true` are filtered in read mode. */
  items: DetailHeaderItem[];
  /** Strip mode only: edit pencil click handler. Pencil hidden when
   *  undefined. Must dispatch the consumer's existing edit flow. */
  onEdit?: () => void;
  /** Optional aria-label for the strip-mode edit pencil. Default: "Edit". */
  editAriaLabel?: string;
  /** Right-side actions cluster. Strip: after a vertical divider.
   *  Card: top of the right column above the meta grid. */
  actions?: ReactNode;
  /** Page-level edit-mode flag. Strip: items with editNode swap their
   *  value. Card: additionally, hidden items with editNode are shown. */
  isEditing?: boolean;
  /** Test ID prefix. Strip/card outer div gets `${testId}`;
   *  items wrapper gets `${testId}-items`; each item gets
   *  `${testId}-item-${item.key}`; actions get `${testId}-actions`;
   *  card right column gets `${testId}-right`. Defaults to "detail-header". */
  testId?: string;

  /** Layout variant.
   *  - "strip" (default): compact single-row. Backward-compat surface.
   *  - "card": two-column content layout (no card chrome). Caller wraps
   *    in CardShell. Adds `clientSlot` and `addressSlot` support. */
  layout?: "strip" | "card";
  /** Card layout only: client entity link / name rendered under the
   *  title+status row (left column, row 2). */
  clientSlot?: ReactNode;
  /** Card layout only: address block rendered under the client name
   *  (left column, row 2, below clientSlot). */
  addressSlot?: ReactNode;
}

export function CanonicalDetailHeader({
  title,
  statusBadge,
  items,
  onEdit,
  editAriaLabel = "Edit",
  actions,
  isEditing = false,
  testId = "detail-header",
  layout = "strip",
  clientSlot,
  addressSlot,
}: CanonicalDetailHeaderProps) {
  // ─── Card layout ─────────────────────────────────────────────────
  if (layout === "card") {
    // Filter hidden items: in read mode, skip hidden; in edit mode,
    // always show items that have an editNode (so user can fill them in).
    const visibleItems = items.filter(
      (it) => !it.hidden || (isEditing && it.editNode !== undefined),
    );
    return (
      // 2026-05-08: content-only wrapper. Card chrome (bg-white border
      // rounded-md shadow-sm) lives on the caller's CardShell so the
      // description section and edit footer (CardShell siblings) share
      // the same card boundary without extra nesting.
      <div className="px-5 pt-4 pb-4" data-testid={testId}>
        {/* 2-column responsive flex: column on mobile, row on lg.
            `lg:items-start` keeps both columns top-aligned even when
            the title or meta grid grows taller than the other side. */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">

          {/* ── LEFT: title + status (row 1), client + address (row 2) */}
          {/* `flex-1 min-w-0 max-w-2xl`: grows to fill available space
              but caps at 2xl so the title doesn't run wall-to-wall on
              ultra-wide viewports; `min-w-0` enables text truncation. */}
          <div className="flex-1 min-w-0 max-w-2xl">
            {/* Row 1: title element + status badge */}
            <div className="flex items-start gap-3 flex-wrap">
              {title}
              {statusBadge && (
                <div className="shrink-0 mt-1" data-testid={`${testId}-status`}>
                  {statusBadge}
                </div>
              )}
            </div>
            {/* Row 2: client name link + address (both optional) */}
            {(clientSlot || addressSlot) && (
              <div className="mt-2 space-y-2">
                {clientSlot}
                {addressSlot && <div>{addressSlot}</div>}
              </div>
            )}
          </div>

          {/* ── RIGHT: actions (top) + meta grid (below) ─────────── */}
          {/* `shrink-0`: right column never shrinks — it keeps its
              natural width determined by the widest action/meta row. */}
          <div
            className="shrink-0 flex flex-col items-end gap-3"
            data-testid={`${testId}-right`}
          >
            {/* Actions cluster — edit pencil, overflow menu, primary CTA */}
            {actions && (
              <div
                className="flex items-center gap-2"
                data-testid={`${testId}-actions`}
              >
                {actions}
              </div>
            )}
            {/* Meta grid — right-aligned label/value pairs. Wraps on
                narrow widths via flex-wrap; justify-end keeps the
                right-edge alignment even when items wrap to two rows. */}
            {visibleItems.length > 0 && (
              <div
                className="flex items-start gap-x-6 gap-y-3 flex-wrap justify-end"
                data-testid={`${testId}-items`}
              >
                {visibleItems.map((it) => {
                  const renderEdit = isEditing && it.editNode !== undefined;
                  return (
                    <div
                      key={it.key}
                      className="flex flex-col items-end min-w-0"
                      data-testid={`${testId}-item-${it.key}`}
                    >
                      <span className="text-label uppercase text-text-muted">
                        {it.label}
                      </span>
                      <span className="mt-1 text-row font-medium text-text-primary truncate leading-tight">
                        {renderEdit ? it.editNode : it.value}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      </div>
    );
  }

  // ─── Strip layout (default — backward-compat for InvoiceDetailPage) ─
  return (
    // 2026-05-02 spacing rhythm:
    //   - Outer row uses gap-4 + flex-wrap so narrow viewports wrap the
    //     items cluster + actions onto a second line cleanly without
    //     overflow. gap-y-2 keeps wrapped rows readable.
    //   - Items cluster also uses gap-4. Dividers are siblings of the
    //     items via Fragment, so the gap-4 applies symmetrically on
    //     both sides of every divider — no mixed one-off spacing.
    // 2026-05-03 surface change: header background flipped from
    //   `bg-card` (white surface) to `bg-app-bg` so the canonical
    //   detail header blends into the page background rather than
    //   reading as a separate card. The bottom border was a card-edge
    //   cue that no longer applies — removed. White cards BELOW the
    //   header keep their own `bg-card` and don't change.
    //   Single source of truth: every page that mounts
    //   `CanonicalDetailHeader` (InvoiceDetailPage) inherits this
    //   surface flip without per-page overrides.
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3 bg-app-bg"
      data-testid={testId}
    >
      {/* ── LEFT region: title + status ───────────────────────── */}
      {/* 2026-05-03 wrap-not-push fix: cap the LEFT region's width and
          let the title wrap onto multiple lines instead of truncating
          to a single line that would otherwise allow the rest of the
          header to be pushed sideways via the outer flex-wrap. The
          right-side metadata + actions stay aligned at their natural
          right-justified position. The cap (`max-w-xl` = 576px) leaves
          comfortable space for the center metadata cluster + right
          actions even on standard 1280-1440px desktop widths. On
          truly narrow viewports the outer `flex-wrap` still kicks in
          as a safety net. */}
      <div className="flex items-start gap-3 min-w-0 max-w-xl shrink">
        <h1
          className="m-0 text-xl font-bold leading-tight text-text-primary break-words min-w-0"
          data-testid={`${testId}-title`}
        >
          {title}
        </h1>
        {statusBadge && (
          <div className="shrink-0 mt-0.5" data-testid={`${testId}-status`}>
            {statusBadge}
          </div>
        )}
      </div>

      {/* ── CENTER region: metadata items (+ optional edit pencil)
           Centered in the leftover horizontal space via `mx-auto`,
           so the items read as their own informational group rather
           than an extension of the right-side actions. The render
           condition unifies the two old conditions (items.length > 0
           OR onEdit) — when neither is set, the region is omitted
           and the row falls back to title-vs-actions only.        */}
      {(items.length > 0 || onEdit) && (
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-2 min-w-0 mx-auto"
          data-testid={`${testId}-items`}
        >
          {items.map((it, idx) => {
            // Edit-mode swap: if the page is editing AND this item
            // carries an editNode, render the editor in place of the
            // read-mode value. Items without an editNode stay
            // read-only even while editing (e.g. derived/linked
            // values like Scheduled, Job # link on Invoice page).
            const renderEdit = isEditing && it.editNode !== undefined;
            return (
              <Fragment key={it.key}>
                {idx > 0 && (
                  <span
                    className="h-7 w-px bg-card-border shrink-0"
                    aria-hidden="true"
                  />
                )}
                <div
                  className="flex flex-col min-w-0"
                  data-testid={`${testId}-item-${it.key}`}
                >
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted leading-none">
                    {it.label}
                  </span>
                  <span className="mt-1 text-sm font-medium text-text-primary truncate leading-tight">
                    {renderEdit ? it.editNode : it.value}
                  </span>
                </div>
              </Fragment>
            );
          })}
          {/* Edit pencil — sits adjacent to the rightmost metadata
              item, inside the same center cluster (icon-only per
              spec). Both detail pages currently render without this
              prop today; kept for forward use on Quote Detail. */}
          {onEdit && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={onEdit}
              data-testid={`${testId}-edit`}
              aria-label={editAriaLabel}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}

      {/* ── RIGHT region: actions cluster ──────────────────────── */}
      {actions && (
        <div
          className="flex items-center gap-2 shrink-0"
          data-testid={`${testId}-actions`}
        >
          {actions}
        </div>
      )}
    </div>
  );
}
