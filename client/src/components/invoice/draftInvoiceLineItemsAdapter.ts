/**
 * draftInvoiceLineItemsAdapter — local-state line-items adapter for the
 * client-side `/invoices/new` builder (Audit #2 invoice-flow Phases 4 +
 * 6, 2026-05-02).
 *
 * Lets `<LineItemsCard>` operate against in-memory draft state BEFORE an
 * invoice exists. The live `InvoiceDetailPage` adapter PATCHes each
 * mutation to `/api/invoices/:id/lines/...`; this adapter does NONE of
 * that. saveAll is a no-op that hands the SavePlan back to the caller
 * so the page can mirror the committed entries into its own
 * `serverItems` state for the eventual `POST /api/invoices/atomic`
 * payload.
 *
 * No live-invoice behavior is changed by this file. It introduces no
 * API calls, no mutations, and no `invoiceId` dependency.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Architecture notes
 * ─────────────────────────────────────────────────────────────────────
 *
 * 1. `useLineItemsDrafts` already owns the draft lifecycle (entries,
 *    edit / cancel / save, per-row mutations, reorder, validation,
 *    carry-over). Draft mode reuses the hook unchanged; only the
 *    adapter changes. That is the entire point of this adapter — keep
 *    the shell + hook canonical, swap the adapter for "no backend yet".
 *
 * 2. saveAll lifecycle: when the user clicks the LineItemsCard "Save"
 *    button, `useLineItemsDrafts.save()` calls `adapter.saveAll(plan)`
 *    and clears `drafts` to null on `ok:true`. Without a live invoice,
 *    that would visually wipe the user's lines because `serverItems`
 *    is empty. The page MUST reconcile its `serverItems` mirror by
 *    matching `entry.serverId` against existing mirror entries — so
 *    extension columns (jobLineItemId / technicianId / date) carried
 *    on the synthetic mirror line are preserved across edit-Save
 *    cycles. The page's reconciliation handler is the `onCommit`
 *    callback below.
 *
 * 3. Why `onCommit(plan: SavePlan)` instead of an array of projected
 *    atomic lines: the adapter needs to give the page enough
 *    information to (a) drop "skipped" invalid new rows, (b) preserve
 *    stable mirror ids across edits via serverId reconciliation, and
 *    (c) carry the description-fallback rule for new rows. The plan
 *    payload contains all of that in canonical form. The page projects
 *    to atomic lines at the page-level "Save Invoice" boundary, where
 *    the projection target is well-defined.
 *
 * 4. `surface = "invoice"` matches the live adapter so any code
 *    inspecting `adapter.surface` for invoice-specific behavior
 *    continues to work in draft mode.
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
import type { InvoiceLine } from "@shared/schema";

// ──────────────────────────────────────────────────────────────────────
// Atomic-line wire shape (re-exported helper for the page-level Save)
// ──────────────────────────────────────────────────────────────────────

/**
 * Per-line payload accepted by `POST /api/invoices/atomic`. Mirrors the
 * shape produced by `server/routes/invoices.ts:401–412` (the route's
 * coalescing map after Zod validation). The page-level Save iterates
 * its `serverItems` mirror and projects each `InvoiceLine` to this
 * shape directly — the per-line columns (`jobLineItemId`, `date`,
 * `technicianId`) live on the synthetic mirror line, NOT on the
 * canonical `LineItemDraft`, so projection from `InvoiceLine → AtomicCreateLine`
 * is straightforward at the page boundary.
 *
 * Kept explicit (not `z.infer<typeof atomicLineSchema>`) because Zod's
 * inference around `.default(...)` still surfaces `string | undefined`
 * in some chains; the literal-string defaults below are what the route
 * actually receives at runtime.
 */
export interface AtomicCreateLine {
  description: string;
  quantity: string;
  unitPrice: string;
  unitCost: string | null;
  productId: string | null;
  lineItemType: LineItemDraft["lineItemType"];
  source: LineItemDraft["source"];
  jobLineItemId: string | null;
  date: string | null;
  technicianId: string | null;
}

/**
 * Project a `LineItemDraft` into the atomic-line wire shape, ignoring
 * the extension columns (which live on the page's synthetic mirror
 * line, not on the canonical draft). Pure; never throws. Reserved for
 * page-level callers that already have an extension lookup at the
 * mirror layer; for the typical "project mirror line → atomic" path,
 * the page projects from `InvoiceLine` directly without going through
 * this helper.
 */
export function draftToAtomicLine(draft: LineItemDraft): AtomicCreateLine {
  return {
    description: draft.description,
    quantity: draft.quantity,
    unitPrice: draft.unitPrice,
    unitCost: draft.unitCost ?? null,
    productId: draft.productId ?? null,
    lineItemType: draft.lineItemType,
    source: draft.source,
    jobLineItemId: null,
    date: null,
    technicianId: null,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Adapter factory
// ──────────────────────────────────────────────────────────────────────

export interface DraftInvoiceLineItemsAdapterOptions {
  /**
   * Called when the user clicks the LineItemsCard "Save" button. Receives
   * the canonical `SavePlan` — the same shape the live adapter receives.
   * The page reconciles its `serverItems` mirror by walking
   * `plan.entriesInFinalOrder` and matching each entry's `serverId`
   * against existing mirror entries; extension columns are preserved
   * from the matched mirror entry. Skipped (invalid new) rows are not
   * removed from `plan.entriesInFinalOrder`, so the page applies the
   * same validation rule the adapter exposes via `validateEntry` to
   * filter them.
   *
   * Returning anything is irrelevant — the hook always treats this
   * adapter's saveAll as `ok:true` and clears its drafts after this
   * callback returns.
   */
  onCommit?: (plan: SavePlan) => void;

  /**
   * Open the canonical AddProductModal. Same contract as the live
   * invoice adapter — the modal is mounted by the parent page, not by
   * the adapter.
   */
  requestCreateProduct?: (name: string) => Promise<ProductOption | null>;

  /**
   * Toast handler — adapter owns the toast surface. Called for the
   * "skipped rows" informational toast and the empty-but-tried-to-save
   * case. Mirrors the live invoice adapter.
   */
  onInformationalToast?: (title: string, description: string) => void;
}

/**
 * Build a `LineItemsAdapter<InvoiceLine>` that operates on local draft
 * state only. Capability flags + validation rule mirror the live
 * `InvoiceDetailPage` adapter so the user-facing UX is byte-for-byte
 * identical to what they will see on the existing detail page.
 *
 * Differences from the live adapter:
 *   • `saveAll` makes NO API calls. Returns ok:true and hands the
 *     `SavePlan` back to the caller via `onCommit` so the page can
 *     reconcile its `serverItems` mirror.
 *   • `onReorder` is omitted — `useLineItemsDrafts.reorderLocal`
 *     already mutates the local entry list before the adapter callback
 *     fires (LineItemsCard.tsx:125), so there is no separate
 *     persistence step to trigger in draft mode.
 *   • `hydrateDraft` / `resolveProduct` ARE called when the page
 *     re-enters edit mode after a previous Save (the mirror has
 *     synthetic `InvoiceLine` rows by then). They delegate to the
 *     canonical `lib/entities/lineItemMapper` helpers.
 */
export function createDraftInvoiceLineItemsAdapter(
  options: DraftInvoiceLineItemsAdapterOptions = {},
): LineItemsAdapter<InvoiceLine> {
  return {
    surface: "invoice",
    // 2026-05-07 Phase A — explicit declaration. Draft-invoice flow
    // (NewInvoicePage) accumulates lines in a `serverItemsMirror`
    // local state and POSTs them inline at invoice-create time,
    // which requires the legacy edit-mode batch contract.
    interactionMode: "batched",
    showCost: false,
    showTax: false,
    allowReorder: true,
    allowEditExisting: true,
    emptyStateLabel: "No line items yet.",
    emptyStateCtaLabel: "Add line item",

    // serverItems IS non-empty in draft mode after the user has Saved at
    // least once (the page populates the mirror from billable previews
    // or from prior saveAll commits), so these helpers DO run on
    // re-edit. Delegate to canonical mappers.
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
            cost: line.unitCost ?? null,
          }
        : null,

    // Identical rule to the live adapter (InvoiceDetailPage). Exposed
    // on the adapter so the page can reuse it from `onCommit` to drop
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
