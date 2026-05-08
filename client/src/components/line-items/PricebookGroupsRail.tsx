/**
 * PricebookGroupsRail — right-side rail inside the Pricebook Picker
 * (2026-05-07 RALPH).
 *
 * Lists saved Pricebook Groups with toggle-to-select semantics. The
 * rail is fixed-width on desktop / iPad landscape; on narrow screens
 * the picker body wraps the rail below the items grid.
 *
 * Behavior contract:
 *   - Click a group card body -> selects / deselects (single-click
 *     toggle).
 *   - Per-card Edit / Delete icon buttons in the top-right corner.
 *     They DO NOT toggle selection — every action handler calls
 *     `event.stopPropagation()` so the click never bubbles up to the
 *     card-level toggle.
 *   - "New" button at the top opens the create modal.
 *   - No per-group Add CTA. Footer CTA is the only finalization
 *     path.
 *   - Order comes from `/api/pricebook-groups?sort=most_used`. Used
 *     groups sort first; unused groups sort to the bottom alphabetical.
 *
 * Group card display (2026-05-07 RALPH polish):
 *   - Group name + optional one-line description
 *   - Item count + total estimate
 *   - "Includes:" preview of the first 3 children
 *     (`Item Name ×N`); when more than 3 exist, the 4th+ collapse into
 *     a `+N more` summary line
 *   - Edit (Pencil) + Delete (Trash) icon buttons in the top-right
 *     corner. Both stop propagation.
 *
 * Visual contract: same surface tokens as the items grid (white card,
 * slate borders, emerald selected state). The action buttons sit in a
 * small cluster above the selected-state checkmark.
 */
import { memo, useCallback, type MouseEvent } from "react";
import { FolderPlus, ListTree, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/formatters";
import type {
  PricebookGroupSelections,
  PricebookGroupSummaryDto,
} from "./pricebookHelpers";

interface PricebookGroupsRailProps {
  groups: ReadonlyArray<PricebookGroupSummaryDto>;
  isLoading?: boolean;
  isError?: boolean;
  selectedGroupIds: PricebookGroupSelections;
  onToggleGroup: (groupId: string) => void;
  onNewGroup: () => void;
  /** Open the canonical edit-mode modal for this group. The handler
   *  receives the current summary so the parent can preload state
   *  without re-fetching. */
  onEditGroup: (group: PricebookGroupSummaryDto) => void;
  /** Open the canonical AlertDialog for delete confirmation. The
   *  parent owns the dialog state + the actual archive call. */
  onDeleteGroup: (group: PricebookGroupSummaryDto) => void;
  /** Disable controls while a save is in flight. */
  disabled?: boolean;
}

export function PricebookGroupsRail({
  groups,
  isLoading,
  isError,
  selectedGroupIds,
  onToggleGroup,
  onNewGroup,
  onEditGroup,
  onDeleteGroup,
  disabled,
}: PricebookGroupsRailProps) {
  return (
    <aside
      className="shrink-0 w-full md:w-[260px] md:border-l md:border-slate-200 md:pl-3 flex flex-col min-h-0"
      data-testid="pricebook-groups-rail"
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
          <ListTree className="h-3.5 w-3.5" />
          Groups
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          onClick={onNewGroup}
          disabled={disabled}
          data-testid="pricebook-groups-new"
        >
          <FolderPlus className="h-3.5 w-3.5 mr-1" />
          New
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-1.5">
        {isLoading ? (
          <>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[120px] w-full rounded-md" />
            ))}
          </>
        ) : isError ? (
          <div
            className="rounded-md border border-rose-200 bg-rose-50 px-3 py-3 text-center"
            data-testid="pricebook-groups-error"
          >
            <p className="text-xs text-rose-700">Couldn't load groups.</p>
          </div>
        ) : groups.length === 0 ? (
          <div
            className="rounded-md border border-slate-200 bg-white px-3 py-4 text-center"
            data-testid="pricebook-groups-empty"
          >
            <p className="text-xs text-slate-600">No saved groups yet.</p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Bundle commonly-paired items so the next visit takes one click.
            </p>
          </div>
        ) : (
          groups.map((g) => (
            <PricebookGroupCard
              key={g.id}
              group={g}
              selected={selectedGroupIds.has(g.id)}
              onToggle={onToggleGroup}
              onEdit={onEditGroup}
              onDelete={onDeleteGroup}
              disabled={disabled}
            />
          ))
        )}
      </div>
    </aside>
  );
}

interface PricebookGroupCardProps {
  group: PricebookGroupSummaryDto;
  selected: boolean;
  onToggle: (groupId: string) => void;
  onEdit: (group: PricebookGroupSummaryDto) => void;
  onDelete: (group: PricebookGroupSummaryDto) => void;
  disabled?: boolean;
}

/** Render the first up-to-3 children, then a "+N more" summary line
 *  when the group has more children than fit. Quantity is rendered
 *  as `×N` next to each item's name. Quantity strings come from the
 *  numeric column ("1.00", "2.50") — strip a trailing `.00` when
 *  present so the preview reads `×1` not `×1.00`. Decimals are kept
 *  for non-whole quantities. */
function formatChildQty(qty: string): string {
  const trimmed = qty.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  return trimmed.endsWith(".") ? trimmed.slice(0, -1) : trimmed;
}

const MAX_PREVIEW_CHILDREN = 3;

const PricebookGroupCard = memo(function PricebookGroupCard({
  group,
  selected,
  onToggle,
  onEdit,
  onDelete,
  disabled,
}: PricebookGroupCardProps) {
  const handleCardClick = useCallback(() => {
    if (disabled) return;
    onToggle(group.id);
  }, [disabled, onToggle, group.id]);

  // Action handlers stop propagation so the card-level toggle never
  // fires when the user clicks Edit or Delete.
  const handleEditClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      if (disabled) return;
      onEdit(group);
    },
    [disabled, onEdit, group],
  );
  const handleDeleteClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      if (disabled) return;
      onDelete(group);
    },
    [disabled, onDelete, group],
  );

  const totalLabel = formatCurrency(Number(group.totalEstimate) || 0);
  const childrenLabel = `${group.itemCount} item${group.itemCount === 1 ? "" : "s"}`;
  const previewChildren = group.children.slice(0, MAX_PREVIEW_CHILDREN);
  const overflowCount = Math.max(
    0,
    group.children.length - previewChildren.length,
  );

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={handleCardClick}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle(group.id);
        }
      }}
      data-testid={`pricebook-group-${group.id}`}
      data-selected={selected ? "true" : "false"}
      aria-pressed={selected}
      className={
        "relative w-full text-left rounded-md border bg-white p-2.5 transition-colors flex flex-col cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
        (selected
          ? "border-emerald-500 ring-1 ring-emerald-200 bg-emerald-50/40"
          : "border-card-border hover:border-slate-300 hover:bg-slate-50") +
        (disabled ? " opacity-60 pointer-events-none" : "")
      }
    >
      {/* Top row: title + action cluster (Edit / Delete + selected mark). */}
      <div className="flex items-start justify-between gap-2 min-w-0">
        <h4 className="text-sm font-semibold text-slate-900 truncate min-w-0 flex-1">
          {group.name}
        </h4>
        <div className="shrink-0 flex items-center gap-0.5">
          {/*
            Action buttons. `stopPropagation` is mandatory — without
            it, clicking Edit / Delete would also toggle the group's
            selection state and produce a confusing UX.
          */}
          <button
            type="button"
            onClick={handleEditClick}
            aria-label={`Edit ${group.name}`}
            title="Edit group"
            data-testid={`pricebook-group-${group.id}-edit`}
            disabled={disabled}
            className="inline-flex items-center justify-center h-6 w-6 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={handleDeleteClick}
            aria-label={`Delete ${group.name}`}
            title="Delete group"
            data-testid={`pricebook-group-${group.id}-delete`}
            disabled={disabled}
            className="inline-flex items-center justify-center h-6 w-6 rounded text-slate-500 hover:text-rose-600 hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <Trash2 className="h-3 w-3" />
          </button>
          {selected ? (
            <span
              className="ml-1 inline-flex items-center justify-center h-5 w-5 rounded-full bg-emerald-500 text-white"
              aria-hidden
            >
              <Plus className="h-3 w-3 rotate-45" />
            </span>
          ) : null}
        </div>
      </div>

      {group.description ? (
        <p
          className="mt-0.5 text-[11px] text-slate-600 leading-snug overflow-hidden"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 1,
            WebkitBoxOrient: "vertical",
          }}
        >
          {group.description}
        </p>
      ) : null}

      <div className="mt-1.5 flex items-center justify-between gap-1.5 text-[11px]">
        <span
          className="text-slate-500"
          data-testid={`pricebook-group-${group.id}-itemcount`}
        >
          {childrenLabel}
        </span>
        <span
          className="font-semibold tabular-nums text-slate-900"
          data-testid={`pricebook-group-${group.id}-total`}
        >
          {totalLabel}
        </span>
      </div>

      {/* Child preview. Hidden entirely when the group has no
          children (a malformed group; the picker still allows the
          user to edit/delete it). */}
      {group.children.length > 0 ? (
        <ul
          className="mt-1.5 pt-1.5 border-t border-slate-100 space-y-0.5"
          data-testid={`pricebook-group-${group.id}-children-preview`}
        >
          {previewChildren.map((child) => (
            <li
              key={child.id}
              className="flex items-center gap-1 text-[11px] text-slate-600 min-w-0"
              data-testid={`pricebook-group-${group.id}-child-${child.itemId}`}
            >
              <span className="truncate min-w-0 flex-1">
                {child.name ?? "Unnamed item"}
              </span>
              <span className="shrink-0 text-slate-500 tabular-nums">
                ×{formatChildQty(child.quantity)}
              </span>
            </li>
          ))}
          {overflowCount > 0 ? (
            <li
              className="text-[11px] text-slate-500 italic"
              data-testid={`pricebook-group-${group.id}-children-overflow`}
            >
              + {overflowCount} more
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
});
