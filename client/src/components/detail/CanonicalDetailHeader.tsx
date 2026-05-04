/**
 * CanonicalDetailHeader (2026-05-01)
 *
 * Single canonical compact header for every detail-page surface
 * (Job Detail, Invoice Detail, future Quote Detail). Slot-based and
 * purely presentational — owns NO data fetching, NO mutations, NO
 * state. Each consumer page passes the title, status, metadata items,
 * and action buttons it owns; this component is responsible only for
 * the layout and consistent styling.
 *
 * Visual contract (2026-05-03 layout v2):
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ Title [Status]      Item₁ │ Item₂ │ … │ Itemₙ [✎]      Actions… │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 *   - Full-width strip; sits directly under the dark app top bar.
 *   - Three regions on one row:
 *       LEFT   = title + status (natural width, left-justified)
 *       CENTER = metadata items + optional edit pencil. Centered in
 *                the leftover horizontal space via `mx-auto` so the
 *                items read as their own informational group, not as
 *                an extension of the right-side actions.
 *       RIGHT  = actions cluster (natural width, right-justified).
 *   - Subtle vertical dividers between metadata items only — there is
 *     no divider between the center items and the right actions
 *     anymore (they're already separated by the auto-margin gutter).
 *   - On narrow widths the row wraps via `flex-wrap`; each row keeps
 *     its grouping (items still center in the leftover space).
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
   *  dates / em-dash placeholders. The component does not hide items
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
}

export interface CanonicalDetailHeaderProps {
  /** Primary title (large bold). Renders as `<h1>`. */
  title: ReactNode;
  /** Status badge — already-styled element (e.g. `<StatusPill>`). */
  statusBadge?: ReactNode;
  /** Metadata items rendered with vertical dividers between them. */
  items: DetailHeaderItem[];
  /** Edit pencil click handler. Pencil hidden when undefined.
   *  Must dispatch the consumer's existing edit flow — this
   *  component does not own edit state. */
  onEdit?: () => void;
  /** Optional aria-label for the edit pencil. Default: "Edit". */
  editAriaLabel?: string;
  /** Right-side actions cluster (rendered after a vertical divider).
   *  Each consumer composes its own buttons here. */
  actions?: ReactNode;
  /** Page-level edit-mode flag. When true, items that supply an
   *  `editNode` swap their `value` for that node. Items without an
   *  `editNode` stay read-only. */
  isEditing?: boolean;
  /** Test ID prefix; defaults to "detail-header". Items are tagged
   *  `${testId}-item-${item.key}`; edit is `${testId}-edit`. */
  testId?: string;
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
}: CanonicalDetailHeaderProps) {
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
    //   `CanonicalDetailHeader` (JobDetailPage, InvoiceDetailPage via
    //   InvoiceDetailShell, etc.) inherits this surface flip without
    //   per-page overrides.
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
