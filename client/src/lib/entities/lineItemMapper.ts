/**
 * Canonical Line Item Mapper
 *
 * Single source of truth for converting between:
 *   - CatalogItem  → LineItemDraft   (when the user picks a product/service)
 *   - blank        → LineItemDraft   (when the user adds an empty row)
 *   - LineItemDraft → wire payload    (when saving to a specific entity table)
 *
 * Every line-item surface in the client (invoice, quote, quote template, job
 * template, job parts, PM template, tech app, edit visit, etc.) is expected
 * to call exactly these helpers. There are NO inline `handleSelectProduct`
 * mappers anywhere else in the codebase after the P9-P10 migration.
 *
 * Why a mapper module instead of one universal payload:
 *   - Each entity table stores a slightly different subset of the canonical
 *     fields (job_parts has no tax columns; invoice_lines stores everything;
 *     quote_lines stores everything but uses string types).
 *   - Per-entity payload adapters keep the wire format right while the
 *     in-memory draft stays uniform.
 *   - The Zod base lives in `shared/lineItem.ts` so the server validates
 *     against the same contract.
 *
 * 2026-04-08: Created as P3 of the catalog → line-item canonicalization pass.
 */

import type {
  CatalogItem,
  LineItemDraft,
  CanonicalLineItemInput,
} from "@shared/lineItem";

// ============================================================================
// Constants
// ============================================================================

const ZERO = "0.00";
const ZERO_TAX = "0.0000";
const ONE = "1";

/**
 * Stable but client-only id generator for new draft rows. Replaced by the
 * server-issued UUID on save.
 */
function newDraftId(): string {
  return `new_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Coerce any nullable string from the catalog to a money string suitable for
 * a draft. NULL/undefined/empty → "0.00". Numbers and parseable strings pass
 * through as-is.
 */
function toMoneyString(value: string | number | null | undefined, fallback = ZERO): string {
  if (value == null || value === "") return fallback;
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : fallback;
  }
  // Already a string. Trust it; the server-side Zod schema validates format.
  return value;
}

// ============================================================================
// Catalog → Draft
// ============================================================================

export interface CatalogToDraftOptions {
  /** Override the default quantity ("1"). */
  quantity?: string;
  /** Where this draft originated. Defaults to "manual". */
  source?: LineItemDraft["source"];
  /** Where this row should sort within the surrounding table. */
  sortOrder?: number;
  /** Override the description (e.g. when a parent row already has notes). */
  description?: string;
}

/**
 * Convert a catalog item into a fully-populated `LineItemDraft`.
 *
 * Field mapping rules (canonical):
 *   - description ← override OR product.name OR product.description OR ""
 *   - quantity    ← override OR "1"
 *   - unitPrice   ← product.unitPrice OR "0.00"
 *   - unitCost    ← product.cost OR "0.00"
 *   - productId   ← product.id
 *   - productType ← product.type
 *   - tax fields  ← zero (server applies tax group at save time)
 *   - line totals ← zero (recomputed when quantity/unitPrice change)
 *   - source      ← override OR "manual"
 *
 * NOTE: This is the only place that resolves "what fields to copy from a
 * catalog row into a draft". Every selector callback in the app is one line:
 *
 *     setDraft(catalogItemToDraft(item, { source: "tech" }));
 */
export function catalogItemToDraft(
  item: CatalogItem,
  options: CatalogToDraftOptions = {},
): LineItemDraft {
  const description =
    options.description ?? item.name ?? item.description ?? "";

  return {
    // Canonical payload fields
    description,
    quantity: options.quantity ?? ONE,
    unitPrice: toMoneyString(item.unitPrice, ZERO),
    unitCost: toMoneyString(item.cost, ZERO),
    taxRate: ZERO_TAX,
    taxAmount: ZERO,
    lineSubtotal: ZERO,
    lineTotal: ZERO,
    productId: item.id,
    lineItemType: "service",
    source: options.source ?? "manual",

    // Client-only UI state
    id: newDraftId(),
    isNew: true,
    isDraft: true,
    productType: item.type,
    notes: "",
    sortOrder: options.sortOrder,
  };
}

// ============================================================================
// Blank draft (manual line)
// ============================================================================

export interface BlankDraftOptions {
  source?: LineItemDraft["source"];
  sortOrder?: number;
  description?: string;
}

/**
 * Create an empty editable draft row (no catalog link). Used when the user
 * clicks "Add line" without picking a product first.
 */
export function blankDraft(options: BlankDraftOptions = {}): LineItemDraft {
  return {
    description: options.description ?? "",
    quantity: ONE,
    unitPrice: ZERO,
    unitCost: ZERO,
    taxRate: ZERO_TAX,
    taxAmount: ZERO,
    lineSubtotal: ZERO,
    lineTotal: ZERO,
    productId: null,
    lineItemType: "service",
    source: options.source ?? "manual",

    id: newDraftId(),
    isNew: true,
    isDraft: true,
    notes: "",
    sortOrder: options.sortOrder,
  };
}

// ============================================================================
// Hydrate draft from a persisted row (server → editor)
// ============================================================================

/**
 * Build a LineItemDraft from any already-persisted line-item row, regardless
 * of the entity table. Used when entering edit mode on an existing row.
 *
 * The input is intentionally loose (`Record<string, unknown>`) because each
 * entity stores a slightly different subset of the canonical fields. Missing
 * fields default to safe zero/empty values; the row keeps its real id and is
 * marked `isNew = false`.
 */
export function hydrateDraft(row: Record<string, unknown>): LineItemDraft {
  const get = <T>(key: string, fallback: T): T => {
    const v = row[key];
    return v == null ? fallback : (v as T);
  };

  return {
    description: get<string>("description", ""),
    quantity: toMoneyString(row.quantity as string | number | null, ONE),
    unitPrice: toMoneyString(row.unitPrice as string | number | null, ZERO),
    unitCost: toMoneyString(row.unitCost as string | number | null, ZERO),
    taxRate: toMoneyString(row.taxRate as string | number | null, ZERO_TAX),
    taxAmount: toMoneyString(row.taxAmount as string | number | null, ZERO),
    lineSubtotal: toMoneyString(row.lineSubtotal as string | number | null, ZERO),
    lineTotal: toMoneyString(row.lineTotal as string | number | null, ZERO),
    productId: get<string | null>("productId", null),
    lineItemType: get<LineItemDraft["lineItemType"]>("lineItemType", "service"),
    source: get<LineItemDraft["source"]>("source", "manual"),

    id: get<string>("id", newDraftId()),
    isNew: false,
    isDraft: false,
    notes: get<string>("notes", ""),
    sortOrder: row.sortOrder as number | undefined,
  };
}

// ============================================================================
// Draft → wire payload (per entity)
// ============================================================================

/**
 * Strip client-only UI state, returning the canonical fields the server will
 * actually validate. Each per-entity adapter starts from this base and adds
 * its own route-specific fields.
 */
function toCanonicalPayload(draft: LineItemDraft): CanonicalLineItemInput {
  return {
    description: draft.description,
    quantity: draft.quantity,
    unitPrice: draft.unitPrice,
    unitCost: draft.unitCost,
    taxRate: draft.taxRate,
    taxAmount: draft.taxAmount,
    lineSubtotal: draft.lineSubtotal,
    lineTotal: draft.lineTotal,
    productId: draft.productId,
    lineItemType: draft.lineItemType,
    source: draft.source,
  };
}

/**
 * Per-entity payload adapters.
 *
 * These are intentionally thin: the canonical mapper does almost all the work,
 * and each adapter just restricts/extends the canonical shape to match the
 * route's specific Zod schema.
 *
 * If a future entity needs different field handling, add an adapter here —
 * never duplicate the canonical mapping logic above.
 */

export interface InvoiceLinePayloadContext {
  /** Optional invoice line number (positional). */
  lineNumber?: number;
  /** Override flags for QBO billing-locked invoices. */
  overrideQboLock?: boolean;
  overrideReason?: string;
}

export function draftToInvoiceLinePayload(
  draft: LineItemDraft,
  context: InvoiceLinePayloadContext = {},
): CanonicalLineItemInput & {
  lineNumber?: number;
  overrideQboLock?: boolean;
  overrideReason?: string;
} {
  return {
    ...toCanonicalPayload(draft),
    ...(context.lineNumber !== undefined && { lineNumber: context.lineNumber }),
    ...(context.overrideQboLock !== undefined && { overrideQboLock: context.overrideQboLock }),
    ...(context.overrideReason !== undefined && { overrideReason: context.overrideReason }),
  };
}

export function draftToQuoteLinePayload(
  draft: LineItemDraft,
): CanonicalLineItemInput {
  // Quote lines accept the canonical shape as-is.
  return toCanonicalPayload(draft);
}

/**
 * Job parts table is the smallest target — it does not store tax fields or
 * line totals. We still send the canonical payload (the server schema accepts
 * it via the canonical base) and the route ignores fields the table doesn't
 * persist.
 */
export function draftToJobPartPayload(
  draft: LineItemDraft,
): CanonicalLineItemInput {
  return toCanonicalPayload(draft);
}
