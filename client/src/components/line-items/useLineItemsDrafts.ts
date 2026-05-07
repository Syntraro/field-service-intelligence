/**
 * useLineItemsDrafts — canonical draft-lifecycle hook for the shared
 * `LineItemsCard` shell.
 *
 * Owns:
 *   - the `lineDrafts: LineDraftEntry[] | null` state machine
 *   - edit-mode entry / cancel / save orchestration
 *   - per-row mutations (update / select-product / show-description /
 *     mark-deleted / remove-new / append-new / reorder-local)
 *   - the "is-this-entry-dirty" diff used by the save planner
 *   - the default carry-over rule on product-change (preserves user
 *     overrides for existing rows; resets to catalog values for new
 *     rows). Adapter can override.
 *   - the save plan builder (creates / updates / deletes / reorder)
 *
 * Does NOT own:
 *   - the actual save mutations (adapter.saveAll executes them)
 *   - tax / discount / totals (rendered via card slots)
 *   - the create-product modal mount (adapter.requestCreateProduct
 *     opens it, adapter owns the toast)
 *
 * 2026-04-29 (Phase 1) — extracted from InvoiceDetailPage.
 */
import { useCallback, useMemo, useState } from "react";
import { type LineItemDraft, parseMoney, formatMoney } from "@shared/lineItem";
import {
  blankDraft,
  catalogItemToDraft,
} from "@/lib/entities/lineItemMapper";
import {
  productOptionToCatalogItem,
  type ProductOption,
} from "@/lib/entities/productEntity";
import type {
  HeaderMetrics,
  LineDraftEntry,
  LineItemsAdapter,
  SavePlan,
} from "./types";

interface UseLineItemsDraftsOptions<TServerLine extends { id: string }> {
  adapter: LineItemsAdapter<TServerLine>;
  serverItems: TServerLine[];
}

function newClientKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `new-${crypto.randomUUID()}`;
  }
  return `new-${Math.random().toString(36).slice(2)}`;
}

function isEntryDirty(a: LineItemDraft, b: LineItemDraft): boolean {
  return (
    a.description !== b.description ||
    a.quantity !== b.quantity ||
    a.unitPrice !== b.unitPrice ||
    a.unitCost !== b.unitCost ||
    a.productId !== b.productId
  );
}

/**
 * Default carry-over rule on product-change. Identical to the rule that
 * was inline in InvoiceDetailPage's `SortableLineRowEditCells` and
 * `AddLineItemRow.handleSelectProduct`. Adapters can override via
 * `applyProductCarryOver`.
 *
 *   • New rows (original === null): adopt every field from the catalog
 *     item via the canonical `catalogItemToDraft` mapper. Description
 *     adopts the catalog description ONLY if it's "real" (non-empty AND
 *     different from the product name); otherwise empty so the textarea
 *     stays hidden behind "+ Add description".
 *   • Existing rows: preserve any field the user has manually edited
 *     (current value differs from `original`). Adopt the new product's
 *     value only on untouched fields. Description follows the same
 *     "real description" check.
 */
function defaultCarryOver(
  current: LineItemDraft,
  original: LineItemDraft | null,
  product: ProductOption,
): Partial<LineItemDraft> {
  const catalogDesc = product.description?.trim() ?? "";
  const productName = product.name?.trim() ?? "";
  const isRealDescription =
    catalogDesc.length > 0 &&
    catalogDesc.toLowerCase() !== productName.toLowerCase();

  if (!original) {
    // New row — full canonical projection.
    const baseDraft = catalogItemToDraft(productOptionToCatalogItem(product), {
      quantity: current.quantity,
    });
    return {
      ...baseDraft,
      description: isRealDescription ? catalogDesc : "",
    };
  }

  // Existing row — preserve user overrides.
  const updates: Partial<LineItemDraft> = {
    productId: product.id,
    productType: product.type === "service" ? "service" : "product",
  };
  if (current.unitPrice === original.unitPrice) {
    updates.unitPrice = formatMoney(parseMoney(product.unitPrice ?? "0"));
  }
  if (current.unitCost === original.unitCost) {
    updates.unitCost = formatMoney(parseMoney(product.cost ?? "0"));
  }
  if (current.description === original.description) {
    updates.description = isRealDescription ? catalogDesc : "";
  }
  return updates;
}

export function useLineItemsDrafts<TServerLine extends { id: string }>({
  adapter,
  serverItems,
}: UseLineItemsDraftsOptions<TServerLine>) {
  const [drafts, setDrafts] = useState<LineDraftEntry[] | null>(null);
  const [saving, setSaving] = useState(false);
  const editing = drafts !== null;

  // ── Lifecycle ──────────────────────────────────────────────────────

  const enterEdit = useCallback(() => {
    const sorted = [...serverItems].sort((a, b) => {
      // Most surfaces have a `lineNumber` field; fall back to insertion
      // order if not present.
      const aN = (a as any).lineNumber;
      const bN = (b as any).lineNumber;
      if (typeof aN === "number" && typeof bN === "number") return aN - bN;
      return 0;
    });
    setDrafts(
      sorted.map((line) => {
        const draft = adapter.hydrateDraft(line);
        const uiSelectedProduct = adapter.resolveProduct?.(line) ?? null;
        const uiShowDescription = ((line as any).description ?? "").trim().length > 0;
        return {
          clientKey: line.id,
          serverId: line.id,
          draft,
          original: { ...draft },
          isDeleted: false,
          uiSelectedProduct,
          uiDescriptionFromProduct: false,
          uiShowDescription,
        } satisfies LineDraftEntry;
      }),
    );
  }, [adapter, serverItems]);

  const cancel = useCallback(() => {
    setDrafts(null);
  }, []);

  // ── Per-entry mutations ────────────────────────────────────────────

  const updateDraft = useCallback((clientKey: string, patch: Partial<LineItemDraft>) => {
    setDrafts((prev) =>
      prev?.map((e) => {
        if (e.clientKey !== clientKey) return e;
        const nextDraft = { ...e.draft, ...patch };
        // 2026-05-01: when quantity OR unitPrice is part of the patch,
        // recompute lineSubtotal so the saved draft persists the correct
        // qty × price total. Prior behavior left lineSubtotal at its
        // initial blank-draft value ("0.00") because the LineItemRow /
        // AddLineItemForm onChange handlers only displayed the multiplied
        // total — they never wrote it back into the draft. Server-side
        // POST /api/invoices/:id/lines reads `lineData.lineSubtotal`
        // from the payload (server/routes/invoices.ts:707), so a draft
        // with lineSubtotal="0.00" persisted as $0 even though qty/rate
        // were correct. Fix is centralized at this single canonical
        // choke point — both LineItemRow and AddLineItemForm route
        // every patch through this hook's `updateDraft` (see
        // LineItemsCard.tsx:286, 306). No component-level changes
        // needed; no server contract change needed.
        if ("quantity" in patch || "unitPrice" in patch) {
          const qty = parseMoney(nextDraft.quantity);
          const price = parseMoney(nextDraft.unitPrice);
          nextDraft.lineSubtotal = formatMoney(qty * price);
        }
        return { ...e, draft: nextDraft };
      }) ?? null,
    );
  }, []);

  const setShowDescription = useCallback((clientKey: string, value: boolean) => {
    setDrafts((prev) =>
      prev?.map((e) =>
        e.clientKey === clientKey ? { ...e, uiShowDescription: value } : e,
      ) ?? null,
    );
  }, []);

  const removeNewDraft = useCallback((clientKey: string) => {
    setDrafts((prev) => prev?.filter((e) => e.clientKey !== clientKey) ?? null);
  }, []);

  const markDeleted = useCallback((clientKey: string) => {
    setDrafts((prev) =>
      prev?.map((e) =>
        e.clientKey === clientKey ? { ...e, isDeleted: true } : e,
      ) ?? null,
    );
  }, []);

  const appendNew = useCallback((initialDraft?: LineItemDraft) => {
    setDrafts((prev) => [
      ...(prev ?? []),
      {
        clientKey: newClientKey(),
        serverId: null,
        draft: initialDraft ?? blankDraft(),
        original: null,
        isDeleted: false,
        uiSelectedProduct: null,
        uiDescriptionFromProduct: false,
        uiShowDescription: false,
      },
    ]);
  }, []);

  // 2026-05-07: bulk append for the Pricebook picker. One state update
  // adds N drafts at once instead of N round-trips through `appendNew`.
  // Each entry can carry its own resolved `ProductOption` so the chip
  // renders without a follow-up catalog fetch — same shape `enterEdit`
  // hydrates server rows into. New rows only; no `original` snapshot.
  const appendMany = useCallback(
    (
      entries: Array<{
        draft: LineItemDraft;
        product?: ProductOption | null;
        showDescription?: boolean;
      }>,
    ) => {
      if (entries.length === 0) return;
      setDrafts((prev) => [
        ...(prev ?? []),
        ...entries.map((entry) => ({
          clientKey: newClientKey(),
          serverId: null as string | null,
          draft: entry.draft,
          original: null,
          isDeleted: false,
          uiSelectedProduct: entry.product ?? null,
          // The Pricebook picker's "real description" detection happens
          // at draft-creation time, so we don't re-derive here. If the
          // draft has a non-empty description, surface the textarea so
          // the user can edit it without an extra "+ Add description"
          // click.
          uiDescriptionFromProduct: !!entry.product && (entry.draft.description ?? "").length > 0,
          uiShowDescription:
            entry.showDescription ?? (entry.draft.description ?? "").length > 0,
        })),
      ]);
    },
    [],
  );

  const selectProduct = useCallback(
    (clientKey: string, product: ProductOption | null) => {
      setDrafts((prev) => {
        if (!prev) return prev;
        return prev.map((e) => {
          if (e.clientKey !== clientKey) return e;

          if (!product) {
            // Change clicked — clear the binding. New rows reset to a
            // search-only state; existing rows just drop the productId
            // so the user can pick a replacement (other fields preserved).
            if (e.serverId == null) {
              return {
                ...e,
                uiSelectedProduct: null,
                uiDescriptionFromProduct: false,
                uiShowDescription: false,
                draft: {
                  ...e.draft,
                  productId: null,
                  productType: undefined,
                  unitPrice: "0.00",
                  unitCost: "0.00",
                  description: e.uiDescriptionFromProduct ? "" : e.draft.description,
                },
              };
            }
            return {
              ...e,
              uiSelectedProduct: null,
              uiDescriptionFromProduct: false,
              draft: { ...e.draft, productId: null, productType: undefined },
            };
          }

          // Pick a product. Apply adapter's carry-over rule (or default).
          const updates = adapter.applyProductCarryOver
            ? adapter.applyProductCarryOver(e.draft, e.original, product)
            : defaultCarryOver(e.draft, e.original, product);

          // The carry-over rule already sets description to "" when the
          // catalog desc is just the name; honor that in the show-flag.
          const catalogDesc = product.description?.trim() ?? "";
          const productName = product.name?.trim() ?? "";
          const isRealDescription =
            catalogDesc.length > 0 &&
            catalogDesc.toLowerCase() !== productName.toLowerCase();

          return {
            ...e,
            uiSelectedProduct: product,
            uiDescriptionFromProduct: isRealDescription,
            // Reveal the textarea on real catalog text. Preserve the
            // existing flag if it was already shown by user action.
            uiShowDescription: isRealDescription || e.uiShowDescription || false,
            draft: { ...e.draft, ...updates },
          };
        });
      });
    },
    [adapter],
  );

  const reorderLocal = useCallback((oldIndex: number, newIndex: number) => {
    setDrafts((prev) => {
      if (!prev) return prev;
      if (oldIndex < 0 || newIndex < 0 || oldIndex >= prev.length || newIndex >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(oldIndex, 1);
      next.splice(newIndex, 0, moved);
      return next;
    });
  }, []);

  // ── Save plan + execute ────────────────────────────────────────────

  const buildSavePlan = useCallback((): SavePlan => {
    if (!drafts) return { creates: [], updates: [], deletes: [], entriesInFinalOrder: [], skipped: 0 };
    const creates: LineItemDraft[] = [];
    const updates: { serverId: string; draft: LineItemDraft }[] = [];
    const deletes: string[] = [];
    let skipped = 0;

    for (const entry of drafts) {
      if (entry.isDeleted) {
        if (entry.serverId) deletes.push(entry.serverId);
        // New + deleted → no server work; not skipped (user explicitly
        // discarded an in-progress add).
        continue;
      }

      // Adapter validates. Default validation: new rows need a name +
      // qty>0. Existing rows are always allowed.
      const error = adapter.validateEntry?.(entry);
      const hasError =
        error !== null && error !== undefined && typeof error === "string";

      if (!entry.serverId) {
        if (hasError) {
          skipped += 1;
          continue;
        }
        // Description fallback at save time so the server's
        // description.length >= 1 constraint is satisfied even when
        // the user never typed in the textarea.
        const typed = entry.draft.description.trim();
        const fallback = entry.uiSelectedProduct?.name?.trim() ?? "";
        const finalDesc = typed || fallback;
        const qty = parseMoney(entry.draft.quantity);
        const price = parseMoney(entry.draft.unitPrice);
        const subtotal = formatMoney(qty * price);
        creates.push({
          ...entry.draft,
          description: finalDesc,
          lineSubtotal: subtotal,
          lineTotal: subtotal,
        });
      } else if (entry.original && isEntryDirty(entry.draft, entry.original)) {
        updates.push({ serverId: entry.serverId, draft: entry.draft });
      }
    }

    // Reorder detection — only when the adapter allows it AND the
    // persisted-row order changed.
    let reorder: { serverIds: string[] } | undefined;
    if (adapter.allowReorder) {
      const currentOrder = drafts
        .filter((e) => !e.isDeleted && e.serverId)
        .map((e) => e.serverId!) as string[];
      const originalOrder = serverItems
        .slice()
        .sort((a, b) => {
          const aN = (a as any).lineNumber;
          const bN = (b as any).lineNumber;
          if (typeof aN === "number" && typeof bN === "number") return aN - bN;
          return 0;
        })
        .map((l) => l.id);
      const orderChanged =
        currentOrder.length === originalOrder.length &&
        currentOrder.some((id, i) => id !== originalOrder[i]);
      if (orderChanged) reorder = { serverIds: currentOrder };
    }

    // 2026-04-29 (Phase 3): expose the full ordered (non-deleted) entry
    // list so adapters that need to build a unified reorder payload
    // (Job Parts) can iterate everything in current order. Invoice /
    // Quote ignore this field.
    const entriesInFinalOrder = drafts.filter((e) => !e.isDeleted);

    return { creates, updates, deletes, reorder, entriesInFinalOrder, skipped };
  }, [drafts, adapter, serverItems]);

  const save = useCallback(async (): Promise<{ ok: boolean; skipped: number }> => {
    if (!drafts) return { ok: true, skipped: 0 };
    const plan = buildSavePlan();
    const totalWork =
      plan.creates.length + plan.updates.length + plan.deletes.length;

    if (totalWork === 0) {
      // Either nothing changed AND nothing skipped → exit edit cleanly,
      // OR every new row was incomplete → adapter toasts; stay in edit.
      if (plan.skipped > 0) {
        adapter.onInformationalToast?.(
          "Nothing to save yet",
          "Select or create an item before saving this row.",
        );
        return { ok: false, skipped: plan.skipped };
      }
      setDrafts(null);
      return { ok: true, skipped: 0 };
    }

    setSaving(true);
    try {
      const result = await adapter.saveAll(plan);
      if (result.ok) {
        setDrafts(null);
      }
      return { ok: result.ok, skipped: result.skipped };
    } catch (err) {
      // Defensive — adapter.saveAll should swallow per-mutation errors
      // and return ok:false. If it threw, surface a destructive toast
      // via the adapter and stay in edit.
      // eslint-disable-next-line no-console
      console.error("[useLineItemsDrafts] adapter.saveAll threw:", err);
      return { ok: false, skipped: plan.skipped };
    } finally {
      setSaving(false);
    }
  }, [drafts, buildSavePlan, adapter]);

  // ── Header metrics (revenue / cost / profit / margin) ──────────────
  // Computed from the LIVE drafts when editing, otherwise from the
  // hydrated server items. Always emits numeric cost / profit / margin
  // so every consuming surface (quote, invoice, job — pricing surfaces
  // all) renders the canonical Full Line Revenue / Profit / Profit
  // Margin tile cluster on the shared <LineItemsCard>.
  //
  // 2026-05-06: cost defaults to 0 when no line carries a unitCost
  // (quote_lines today has no unit_cost column; invoice / job parts
  // do — see shared/schema.ts). The previous behavior returned null
  // cost/profit/margin, which the card then used to hide Profit +
  // Profit Margin entirely on quote / invoice surfaces. That's wrong
  // for pricing surfaces where margin visibility is the whole point.
  // If a row truly has no cost data, profit equals revenue and margin
  // is 100% — an honest reflection of "no cost recorded yet" rather
  // than silently dropping the KPIs.

  const headerMetrics: HeaderMetrics = useMemo(() => {
    const source: Array<{ quantity: string; unitPrice: string; unitCost?: string | null }> =
      drafts
        ? drafts
            .filter((e) => !e.isDeleted)
            .map((e) => ({
              quantity: e.draft.quantity,
              unitPrice: e.draft.unitPrice,
              unitCost: e.draft.unitCost,
            }))
        : serverItems.map((line: any) => ({
            quantity: line.quantity ?? "0",
            unitPrice: line.unitPrice ?? "0",
            unitCost: line.unitCost,
          }));

    let revenue = 0;
    let cost = 0;
    for (const row of source) {
      const qty = parseMoney(row.quantity);
      const price = parseMoney(row.unitPrice);
      revenue += qty * price;
      // Treat absent / blank unitCost as zero — pricing surfaces
      // (quote / invoice) without a persisted cost column still
      // produce a valid (revenue − 0 = revenue, margin 100%) row.
      // Negative or non-numeric values clamp to 0 via parseMoney.
      if (row.unitCost != null && row.unitCost !== "") {
        const c = parseMoney(row.unitCost);
        if (c > 0) cost += qty * c;
      }
    }

    const profit = revenue - cost;
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
    return { revenue, cost, profit, margin };
  }, [drafts, serverItems]);

  return {
    drafts,
    editing,
    saving,
    headerMetrics,
    enterEdit,
    cancel,
    save,
    appendNew,
    appendMany,
    updateDraft,
    selectProduct,
    setShowDescription,
    removeNewDraft,
    markDeleted,
    reorderLocal,
    buildSavePlan,
  };
}

export type LineItemsDraftsAPI = ReturnType<typeof useLineItemsDrafts>;
