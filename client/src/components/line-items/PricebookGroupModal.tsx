/**
 * PricebookGroupModal — canonical New / Edit Group dialog mounted
 * from the Pricebook Picker's right rail (2026-05-07 RALPH).
 *
 * Domain wrapper (modal taxonomy rule #4). Mounts the canonical
 * `<ModalShell>` + ModalHeader / ModalFooter primitives. Owns its own
 * width — `ModalShell` stays width-neutral.
 *
 * Two modes:
 *   • mode === "create" (default) → POSTs to /api/pricebook-groups
 *     and fires `onCreated(id)` on success.
 *   • mode === "edit" → PATCHes /api/pricebook-groups/:id and fires
 *     `onUpdated(id)` on success. The caller passes the current
 *     `group` summary; the modal preloads name / description / child
 *     items + quantities from it.
 *
 * Behavior contract (both modes):
 *   - Required: name (non-empty), at least one child item.
 *   - Optional: description.
 *   - Item search uses the canonical `/api/items?q=…` endpoint;
 *     +/− adds child items with quantity. Same UX vocabulary as the
 *     parent picker so the modal feels of-a-piece.
 *   - On Save: errors surface inline (`mutation.error.message`).
 *     Closes on success; the parent rail picks up the change via
 *     query invalidation in the canonical hooks.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Minus, Plus, Search } from "lucide-react";

import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalFooter,
  ModalPrimaryAction,
  ModalSecondaryAction,
} from "@/components/ui/modal";
import {
  FormField,
  FormLabel,
  FormHelperText,
  FormErrorText,
} from "@/components/ui/form-field";
import {
  normalizeProductRow,
  type ProductOption,
} from "@/lib/entities/productEntity";
import { formatCurrency } from "@/lib/formatters";
import {
  useCreatePricebookGroup,
  useUpdatePricebookGroup,
} from "@/lib/pricebook/usePricebookGroups";
import type { PricebookGroupSummaryDto } from "./pricebookHelpers";
import { PickerShell } from "@/components/ui/picker-shell";

export type PricebookGroupModalMode = "create" | "edit";

interface PricebookGroupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: PricebookGroupModalMode;
  /** Group being edited. REQUIRED when `mode === "edit"`. The modal
   *  preloads name / description / children from this snapshot and
   *  PATCHes back through `useUpdatePricebookGroup`. */
  group?: PricebookGroupSummaryDto | null;
  /** Fires after a successful create. Useful when the host wants
   *  to auto-select the new group on the rail. */
  onCreated?: (groupId: string) => void;
  /** Fires after a successful edit save. */
  onUpdated?: (groupId: string) => void;
}

/** Reuses the picker's items endpoint (same query shape). */
function useItemSearch(searchText: string) {
  return useQuery<ProductOption[]>({
    queryKey: ["/api/items", "group-modal", searchText],
    queryFn: async () => {
      const trimmed = searchText.trim();
      const qs = trimmed
        ? `?q=${encodeURIComponent(trimmed)}&limit=100`
        : "?sort=most_used&limit=100";
      const res = await apiRequest<any>(`/api/items${qs}`);
      const rows = Array.isArray(res) ? res : (res?.data ?? res?.items ?? []);
      return rows.map(normalizeProductRow);
    },
    staleTime: 30_000,
  });
}

interface ChildEntry {
  product: ProductOption;
  quantity: number;
}

/** Build the initial children Map from a preloaded group summary.
 *  Each child carries its full ProductOption snapshot so the
 *  rendering path matches the create-mode flow without a follow-up
 *  catalog fetch. Quantity is parsed from the persisted numeric
 *  string ("2.00" → 2). */
function childrenFromGroup(
  group: PricebookGroupSummaryDto | null | undefined,
): Map<string, ChildEntry> {
  const out = new Map<string, ChildEntry>();
  if (!group) return out;
  for (const child of group.children) {
    if (!child.itemId) continue;
    const qty = Number(child.quantity);
    out.set(child.itemId, {
      product: {
        id: child.itemId,
        name: child.name ?? "",
        type: child.type,
        unitPrice: child.unitPrice,
        cost: child.cost,
        description: child.description,
        isTaxable: child.isTaxable ?? true,
      },
      quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
    });
  }
  return out;
}

export function PricebookGroupModal({
  open,
  onOpenChange,
  mode = "create",
  group,
  onCreated,
  onUpdated,
}: PricebookGroupModalProps) {
  const isEdit = mode === "edit" && Boolean(group);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [search, setSearch] = useState("");
  const [children, setChildren] = useState<Map<string, ChildEntry>>(new Map());

  const createMutation = useCreatePricebookGroup();
  const updateMutation = useUpdatePricebookGroup();
  const activeMutation = isEdit ? updateMutation : createMutation;
  const { data: items = [], isLoading } = useItemSearch(search);

  // Preload state on (re)open. The mode + group identity together
  // form the dependency: switching from "create" to "edit Group X"
  // on the same mount must reset the form. Guarded by `open` so a
  // closed-but-mounted modal doesn't churn its state.
  useEffect(() => {
    if (!open) return;
    if (isEdit && group) {
      setName(group.name);
      setDescription(group.description ?? "");
      setChildren(childrenFromGroup(group));
    } else {
      setName("");
      setDescription("");
      setChildren(new Map());
    }
    setSearch("");
    createMutation.reset();
    updateMutation.reset();
    // We exclude the mutation refs from deps — `reset()` is
    // referentially stable on the same mutation instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isEdit, group?.id]);

  const itemTotal = useMemo(() => {
    let total = 0;
    children.forEach(({ product, quantity }) => {
      const price = Number(product.unitPrice ?? 0);
      if (Number.isFinite(price)) total += quantity * price;
    });
    return total;
  }, [children]);

  const incrementChild = (item: ProductOption) => {
    setChildren((prev) => {
      const next = new Map(prev);
      const existing = next.get(item.id);
      if (existing) {
        next.set(item.id, { ...existing, quantity: existing.quantity + 1 });
      } else {
        next.set(item.id, { product: item, quantity: 1 });
      }
      return next;
    });
  };

  const decrementChild = (itemId: string) => {
    setChildren((prev) => {
      const next = new Map(prev);
      const existing = next.get(itemId);
      if (!existing) return prev;
      if (existing.quantity <= 1) {
        next.delete(itemId);
      } else {
        next.set(itemId, { ...existing, quantity: existing.quantity - 1 });
      }
      return next;
    });
  };

  const trimmedName = name.trim();
  const childCount = children.size;
  const canSave =
    trimmedName.length > 0 && childCount > 0 && !activeMutation.isPending;

  // The catalog search lists ALL items, but in edit mode we want
  // every preloaded child to remain visible at the top so the user
  // can adjust its quantity without typing the name. Build a merged
  // "displayed items" list: preloaded children first (in their
  // ChildEntry order) + the remaining catalog hits with no overlap.
  const displayedItems = useMemo<ProductOption[]>(() => {
    const seen = new Set<string>();
    const out: ProductOption[] = [];
    children.forEach(({ product }) => {
      if (seen.has(product.id)) return;
      seen.add(product.id);
      out.push(product);
    });
    for (const it of items) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      out.push(it);
    }
    return out;
  }, [children, items]);

  const handleSave = async () => {
    if (!canSave) return;
    const childArray = Array.from(children.values()).map((c, idx) => ({
      itemId: c.product.id,
      quantity: String(c.quantity),
      sortOrder: idx,
    }));
    try {
      if (isEdit && group) {
        const updated = await updateMutation.mutateAsync({
          id: group.id,
          body: {
            name: trimmedName,
            description: description.trim() || null,
            children: childArray,
          },
        });
        onUpdated?.(updated.id);
      } else {
        const created = await createMutation.mutateAsync({
          name: trimmedName,
          description: description.trim() || null,
          children: childArray,
        });
        onCreated?.(created.id);
      }
      onOpenChange(false);
    } catch {
      // Error is already attached to the active mutation; the inline
      // alert below renders it. Swallow here so the modal stays open.
    }
  };

  const titleText = isEdit ? "Edit Pricebook Group" : "New Pricebook Group";
  const saveLabel = activeMutation.isPending
    ? "Saving…"
    : isEdit
      ? "Save changes"
      : "Save group";

  return (
    <ModalShell
      open={open}
      onOpenChange={(next) => {
        if (!next && activeMutation.isPending) return;
        onOpenChange(next);
      }}
      // Slightly narrower than the picker — this modal sits on top of
      // the picker so it should feel like a smaller, focused dialog.
      className="w-[min(720px,calc(100vw-32px))] max-w-[720px] sm:max-w-[720px] sm:h-[min(640px,calc(100vh-80px))] flex flex-col"
      data-testid={
        isEdit ? "pricebook-group-edit-modal" : "pricebook-group-create-modal"
      }
    >
      <ModalHeader className="space-y-2">
        <div className="space-y-1.5 pr-8">
          <ModalTitle>{titleText}</ModalTitle>
          <ModalDescription>
            {isEdit
              ? "Update the bundle's name, description, or items."
              : "Bundle commonly-paired items so they can be added in one click."}
          </ModalDescription>
        </div>
      </ModalHeader>

      <div
        className="flex-1 sm:min-h-[400px] max-h-[min(540px,calc(100vh-220px))] overflow-y-auto px-4 py-3 bg-app-bg space-y-4"
        data-testid="pricebook-group-modal-body"
      >
        <FormField>
          <FormLabel htmlFor="group-name" required>
            Group name
          </FormLabel>
          <Input
            id="group-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Service Call"
            data-testid="pricebook-group-modal-name"
            disabled={activeMutation.isPending}
          />
        </FormField>

        <FormField>
          <FormLabel htmlFor="group-description">Description</FormLabel>
          <Textarea
            id="group-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional one-liner shown in the picker rail"
            rows={2}
            data-testid="pricebook-group-modal-description"
            disabled={activeMutation.isPending}
          />
        </FormField>

        <FormField>
          <FormLabel>Items in this group</FormLabel>
          <FormHelperText>
            Add at least one. Quantity is preserved when the group expands.
          </FormHelperText>
          <div className="relative mt-1.5">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search pricebook items"
              className="pl-8 text-sm"
              data-testid="pricebook-group-modal-search"
              disabled={activeMutation.isPending}
            />
          </div>

          <PickerShell asChild>
            <ul
              className="mt-2 max-h-[260px] border-card-border bg-white divide-slate-100"
              data-testid="pricebook-group-modal-items"
            >
            {isLoading && children.size === 0 ? (
              <li className="p-2 space-y-1.5">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-7 w-full" />
                ))}
              </li>
            ) : displayedItems.length === 0 ? (
              <li className="px-3 py-3 text-xs text-slate-500 text-center">
                No items match.
              </li>
            ) : (
              displayedItems.map((item) => {
                const child = children.get(item.id);
                const qty = child?.quantity ?? 0;
                const priceLabel = formatCurrency(
                  Number(item.unitPrice ?? 0) || 0,
                );
                return (
                  <li
                    key={item.id}
                    className="flex items-center gap-2 px-3 py-1.5"
                    data-testid={`pricebook-group-modal-row-${item.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-slate-900 truncate">
                        {item.name}
                      </div>
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        {priceLabel}
                      </div>
                    </div>
                    {qty > 0 ? (
                      <div className="flex items-center gap-0.5">
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-7 w-7 shrink-0"
                          onClick={() => decrementChild(item.id)}
                          aria-label={`Decrease ${item.name}`}
                          data-testid={`pricebook-group-modal-decrement-${item.id}`}
                          disabled={activeMutation.isPending}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="min-w-[1.5rem] text-center text-xs font-semibold tabular-nums text-slate-900">
                          {qty}
                        </span>
                        <Button
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          onClick={() => incrementChild(item)}
                          aria-label={`Increase ${item.name}`}
                          data-testid={`pricebook-group-modal-increment-${item.id}`}
                          disabled={activeMutation.isPending}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() => incrementChild(item)}
                        aria-label={`Add ${item.name}`}
                        data-testid={`pricebook-group-modal-add-${item.id}`}
                        disabled={activeMutation.isPending}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    )}
                  </li>
                );
              })
            )}
            </ul>
          </PickerShell>
        </FormField>

        {activeMutation.isError ? (
          <FormErrorText>
            {(activeMutation.error as Error)?.message ??
              (isEdit
                ? "Could not save changes. Please try again."
                : "Could not create group. Please try again.")}
          </FormErrorText>
        ) : null}
      </div>

      <ModalFooter className="justify-between">
        <ModalSecondaryAction
          onClick={() => onOpenChange(false)}
          disabled={activeMutation.isPending}
          data-testid="pricebook-group-modal-cancel"
        >
          Cancel
        </ModalSecondaryAction>
        <div className="flex items-center gap-3">
          <span
            className="text-xs text-slate-600 tabular-nums"
            data-testid="pricebook-group-modal-summary"
          >
            {childCount === 0
              ? "No items selected"
              : `${childCount} item${childCount === 1 ? "" : "s"} · ${formatCurrency(itemTotal)}`}
          </span>
          <ModalPrimaryAction
            onClick={handleSave}
            disabled={!canSave}
            data-testid="pricebook-group-modal-save"
          >
            {saveLabel}
          </ModalPrimaryAction>
        </div>
      </ModalFooter>
    </ModalShell>
  );
}
