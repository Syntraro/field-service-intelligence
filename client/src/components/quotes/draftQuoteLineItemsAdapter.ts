/**
 * draftQuoteLineItemsAdapter — local-state line-items adapter for the
 * client-side `/quotes/new` builder (2026-05-06).
 *
 * Lets `<LineItemsCard>` operate against in-memory draft state BEFORE a
 * quote exists. Mirrors the saved-quote adapter on QuoteDetailPage on
 * every capability flag (`showCost: false`, `showTax: false`,
 * `allowReorder: false`, `allowEditExisting: true`) so the user-facing
 * UX is byte-for-byte identical between create and detail surfaces.
 *
 * The live QuoteDetailPage adapter PATCHes each mutation to
 * `/api/quotes/:id/lines/...`; this adapter does NONE of that. saveAll
 * is a no-op that hands the SavePlan back to the caller via `onCommit`
 * so the page can mirror the committed entries into its own
 * `serverItems` state for the eventual `POST /api/quotes` payload (the
 * create endpoint accepts an inline `lines: []` array — see
 * `server/routes/quotes.ts` createQuoteSchema).
 *
 * Mirrors `draftInvoiceLineItemsAdapter.ts` byte-for-byte on its
 * surface-agnostic concerns (validateEntry, hydrateDraft,
 * resolveProduct, saveAll → onCommit). The two only diverge on the
 * surface flag (`"quote"` vs `"invoice"`) and the `allowReorder` flag
 * (false on quote — saved quote has no reorder mutation).
 */
import type {
  LineDraftEntry,
  LineItemsAdapter,
  SavePlan,
} from "@/components/line-items/types";
import type { LineItemDraft } from "@shared/lineItem";
import { parseMoney } from "@shared/lineItem";
import { hydrateDraft, blankDraft } from "@/lib/entities/lineItemMapper";
import type { ProductOption } from "@/lib/entities/productEntity";
import type { QuoteLine } from "@shared/schema";

// ──────────────────────────────────────────────────────────────────────
// Inline-create line wire shape for `POST /api/quotes`
// ──────────────────────────────────────────────────────────────────────

/**
 * Per-line payload accepted by `POST /api/quotes` `lines: []`. Matches
 * `createQuoteSchema.lines` in `server/routes/quotes.ts:66–76`. The page
 * iterates its `serverItems` mirror and projects each `QuoteLine` to
 * this shape directly at the page-level Save boundary.
 */
export interface InlineCreateQuoteLine {
  description: string;
  quantity: string;
  unitPrice: string;
  /**
   * 2026-05-06: cost basis per unit. Optional + nullable. Persists into
   * `quote_lines.unit_cost` so saved quotes preserve Profit / Margin
   * across reload. The page projects from the synthetic mirror's
   * `unitCost`, which carries the draft's cost (typically populated
   * by `useLineItemsDrafts` from the selected product's `items.cost`).
   */
  unitCost?: string | null;
  lineSubtotal?: string;
  taxRate?: string;
  taxAmount?: string;
  lineTotal?: string;
  lineItemType?: "service" | "material" | "fee" | "discount";
  productId?: string | null;
}

// ──────────────────────────────────────────────────────────────────────
// Adapter factory
// ──────────────────────────────────────────────────────────────────────

export interface DraftQuoteLineItemsAdapterOptions {
  /**
   * Called when the user clicks the LineItemsCard "Save" button.
   * Receives the canonical `SavePlan` — the same shape the live adapter
   * receives. The page reconciles its `serverItems` mirror by walking
   * `plan.entriesInFinalOrder` and matching each entry's `serverId`
   * against existing mirror entries.
   *
   * Returning anything is irrelevant — the hook always treats this
   * adapter's saveAll as `ok:true` and clears its drafts after this
   * callback returns.
   */
  onCommit?: (plan: SavePlan) => void;

  /**
   * Open the canonical AddProductModal. Same contract as the live
   * adapter — the modal is mounted by the parent page, not by the
   * adapter.
   */
  requestCreateProduct?: (name: string) => Promise<ProductOption | null>;

  /**
   * Toast handler — adapter owns the toast surface. Called for the
   * "skipped rows" informational toast and the empty-but-tried-to-save
   * case.
   */
  onInformationalToast?: (title: string, description: string) => void;
}

/**
 * Build a `LineItemsAdapter<QuoteLine>` that operates on local draft
 * state only. Capability flags + validation rule mirror the live
 * `QuoteDetailPage` adapter so the user-facing UX is byte-for-byte
 * identical to what they will see on the existing detail page.
 *
 * Differences from the live adapter:
 *   • `saveAll` makes NO API calls. Returns ok:true and hands the
 *     `SavePlan` back via `onCommit` so the page can reconcile its
 *     `serverItems` mirror.
 *   • `hydrateDraft` / `resolveProduct` ARE called when the page
 *     re-enters edit mode after a previous Save (the mirror has
 *     synthetic `QuoteLine` rows by then). They delegate to the
 *     canonical `lib/entities/lineItemMapper` helpers.
 */
export function createDraftQuoteLineItemsAdapter(
  options: DraftQuoteLineItemsAdapterOptions = {},
): LineItemsAdapter<QuoteLine> {
  return {
    surface: "quote",
    // 2026-05-07 Phase A — explicit declaration. Draft-quote flow
    // (CreateQuotePage) accumulates lines in a `serverItemsMirror`
    // local state and POSTs them inline at quote-create time, which
    // requires the legacy edit-mode batch contract.
    interactionMode: "batched",
    showCost: false,
    showTax: false,
    allowReorder: false,
    allowEditExisting: true,
    emptyStateLabel: "No line items yet.",
    emptyStateCtaLabel: "Add line item",

    hydrateDraft: (line) => {
      if (line && typeof (line as unknown as { id?: unknown }).id === "string") {
        return hydrateDraft(line as unknown as Record<string, unknown>);
      }
      return blankDraft();
    },
    resolveProduct: (line) =>
      line && line.productId
        ? {
            id: line.productId,
            name: line.description || "(unnamed item)",
            type: line.lineItemType === "service" ? "service" : "product",
            unitPrice: line.unitPrice,
            cost: null,
          }
        : null,

    // Identical rule to the live QuoteDetailPage adapter. Exposed on
    // the adapter so the page can reuse it from `onCommit` to drop
    // skipped (invalid) new rows during mirror reconciliation.
    validateEntry: (entry: LineDraftEntry) => {
      if (entry.serverId) return null;
      const typed = entry.draft.description.trim();
      const fallback = entry.uiSelectedProduct?.name?.trim() ?? "";
      const finalDesc = typed || fallback;
      const qty = parseMoney(entry.draft.quantity);
      if (!finalDesc || qty <= 0) {
        return "Select or create an item before saving this row.";
      }
      return null;
    },

    saveAll: async (plan) => {
      options.onCommit?.(plan);
      return { ok: true, failures: 0, skipped: plan.skipped };
    },

    requestCreateProduct: options.requestCreateProduct,
    onInformationalToast: options.onInformationalToast,
  };
}

/**
 * Project a mirror QuoteLine row to the inline-create line shape that
 * `POST /api/quotes` accepts. Direct projection (no LineItemDraft
 * round-trip) keeps the page-level Save flow simple.
 */
export function mirrorLineToInlineCreate(line: QuoteLine): InlineCreateQuoteLine {
  // 2026-05-06: `unitCost` flows through the synthetic mirror as a
  // runtime extra field (the page-level `makeMirrorLine` adds it
  // even though `quote_lines` types now formally include it). Read
  // via `(line as any).unitCost` so older mirror entries that
  // pre-date this change don't crash; they yield `undefined` →
  // `null` → server stores NULL → header math treats as 0.
  const cost = (line as { unitCost?: string | null }).unitCost ?? null;
  return {
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    unitCost: cost,
    lineSubtotal: line.lineSubtotal,
    taxRate: line.taxRate,
    taxAmount: line.taxAmount,
    lineTotal: line.lineTotal,
    lineItemType: (line.lineItemType ?? "service") as InlineCreateQuoteLine["lineItemType"],
    productId: line.productId ?? null,
  };
}
