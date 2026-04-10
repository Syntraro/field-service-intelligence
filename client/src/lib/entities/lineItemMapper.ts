/**
 * Canonical Line Item Mapper
 *
 * Single source of truth for converting between:
 *   - CatalogItem  → LineItemDraft   (when the user picks a product/service)
 *   - blank        → LineItemDraft   (when the user adds an empty row)
 *   - persisted row → LineItemDraft   (when entering edit mode)
 *   - LineItemDraft → wire payload    (when saving to a specific entity table)
 *
 * Every line-item surface in the client (invoice, quote, quote template, job
 * template, job parts, PM template, tech app, edit visit, etc.) is expected
 * to call exactly these helpers. There are NO inline `handleSelectProduct`
 * mappers anywhere else in the codebase after the P9-P10 migration.
 *
 * GUARDRAIL — read before adding a new selector or save path:
 *   - Never call `setDraft({...})` with a hand-built object literal in a
 *     selector callback. Always go through `catalogItemToDraft(item, opts)`
 *     or `blankDraft(opts)`.
 *   - Never POST a hand-built line-item payload. Always project a draft
 *     through `draftToInvoiceLinePayload`, `draftToQuoteLinePayload`, or
 *     `draftToJobPartPayload`.
 *   - Money fields cross the boundary as canonical strings only. The
 *     `formatMoney` helper from `@shared/lineItem` is the only sanctioned
 *     number → string converter; `parseMoney` is the only sanctioned
 *     string → number converter.
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
 * 2026-04-08: Stabilization pass — money helpers consolidated, hydrateDraft
 *             id contract tightened, description fallback hardened, payload
 *             adapters use explicit assignment instead of conditional spread.
 */

import {
  type CatalogItem,
  type LineItemDraft,
  type CanonicalLineItemInput,
  parseMoney,
  formatMoney,
} from "@shared/lineItem";

// ============================================================================
// Constants
// ============================================================================

const ZERO = "0.00";
const ZERO_TAX = "0.0000";
const ONE = "1";
const UNTITLED = "(unnamed item)";

/**
 * Stable but client-only id generator for new draft rows. Replaced by the
 * server-issued UUID on save.
 */
function newDraftId(): string {
  return `new_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Coerce any nullable string|number from a catalog or persisted row to a
 * canonical money string. Always emits a well-formed money string — never
 * `"NaN"`, never `"undefined"`, never empty.
 *
 * Decimals: 2 for prices/totals/amounts, 4 for tax rates. The default of 2
 * matches the regex used by every money field except `taxRate`.
 *
 * Implementation: parses through the canonical `parseMoney` helper, then
 * formats through the canonical `formatMoney` helper. This guarantees that
 * a value like `0.1 + 0.2` (which JS returns as 0.30000000000000004) becomes
 * `"0.30"`, not the float string. It also normalizes `"100"` → `"100.00"`.
 */
function toMoneyString(
  value: string | number | null | undefined,
  fallback: string = ZERO,
  decimals: 2 | 4 = 2,
): string {
  if (value == null || value === "") return fallback;
  const n = parseMoney(value);
  return formatMoney(n, decimals);
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
 *   - description ← override OR product.name OR product.description OR sku OR "(unnamed item)"
 *   - quantity    ← override OR "1"
 *   - unitPrice   ← formatMoney(product.unitPrice) (defaults to "0.00")
 *   - unitCost    ← formatMoney(product.cost)      (defaults to "0.00")
 *   - productId   ← product.id
 *   - productType ← product.type
 *   - tax fields  ← "0.0000" / "0.00" (server applies tax group at save time)
 *   - line totals ← "0.00" (recomputed when quantity/unitPrice change)
 *   - source      ← override OR "manual"
 *
 * The description fallback walks `name → description → sku → "(unnamed item)"`
 * because the canonical Zod schema requires `description.length >= 1` on save;
 * an empty fallback would silently produce a draft that fails validation when
 * the user clicks Save. The chain guarantees the resulting draft is always
 * server-acceptable as long as the catalog row has at least an id.
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
    options.description?.trim() ||
    item.name?.trim() ||
    item.description?.trim() ||
    item.sku?.trim() ||
    UNTITLED;

  return {
    // Canonical payload fields
    description,
    quantity: options.quantity ?? ONE,
    unitPrice: toMoneyString(item.unitPrice, ZERO, 2),
    unitCost: toMoneyString(item.cost, ZERO, 2),
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
 * clicks "Add line" without picking a product first. The draft will fail
 * server validation until the user fills in a description (≥ 1 char) — that
 * is the intended behavior for blank rows.
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
 * Build a `LineItemDraft` from a persisted line-item row, regardless of which
 * entity table the row came from. Used when entering edit mode on an existing
 * line.
 *
 * Contract:
 *   - The input row MUST have a non-empty `id` field. Hydrating a row that
 *     looks persisted (`isNew = false`) but lacks a real id is a contract
 *     violation that would silently corrupt downstream save logic; the
 *     function throws to surface the bug at the call site.
 *   - Money fields are canonicalized through `toMoneyString` so missing /
 *     malformed values become safe defaults.
 *   - `taxRate` uses 4-decimal formatting; everything else uses 2.
 *   - The input is intentionally loose (`Record<string, unknown>`) because
 *     each entity table stores a slightly different subset of the canonical
 *     fields. Missing fields default to safe zero/empty values.
 */
export function hydrateDraft(row: Record<string, unknown>): LineItemDraft {
  const id = row.id;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(
      "hydrateDraft: row is missing required `id` field — cannot hydrate a persisted-row draft without a real id",
    );
  }

  const get = <T>(key: string, fallback: T): T => {
    const v = row[key];
    return v == null ? fallback : (v as T);
  };

  return {
    description: get<string>("description", ""),
    quantity: toMoneyString(row.quantity as string | number | null | undefined, ONE, 2),
    unitPrice: toMoneyString(row.unitPrice as string | number | null | undefined, ZERO, 2),
    unitCost: toMoneyString(row.unitCost as string | number | null | undefined, ZERO, 2),
    taxRate: toMoneyString(row.taxRate as string | number | null | undefined, ZERO_TAX, 4),
    taxAmount: toMoneyString(row.taxAmount as string | number | null | undefined, ZERO, 2),
    lineSubtotal: toMoneyString(row.lineSubtotal as string | number | null | undefined, ZERO, 2),
    lineTotal: toMoneyString(row.lineTotal as string | number | null | undefined, ZERO, 2),
    productId: get<string | null>("productId", null),
    lineItemType: get<LineItemDraft["lineItemType"]>("lineItemType", "service"),
    source: get<LineItemDraft["source"]>("source", "manual"),

    id,
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
 *
 * The output type is the canonical `CanonicalLineItemInput`, the SAME shape
 * the server's Zod schema validates. Client and server agree on the contract
 * by construction.
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
  // Explicit assignment instead of conditional spread — easier to read and
  // avoids `false && {...}` spread quirks.
  const out: CanonicalLineItemInput & {
    lineNumber?: number;
    overrideQboLock?: boolean;
    overrideReason?: string;
  } = toCanonicalPayload(draft);
  if (context.lineNumber !== undefined) out.lineNumber = context.lineNumber;
  if (context.overrideQboLock !== undefined) out.overrideQboLock = context.overrideQboLock;
  if (context.overrideReason !== undefined) out.overrideReason = context.overrideReason;
  return out;
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
 * it) and the SERVER projects it down to the persisted subset via
 * `canonicalToJobPartFields` in `server/routes/jobs.ts`. Anything in the
 * canonical shape that isn't in that subset is silently dropped server-side.
 *
 * GUARDRAIL: Do NOT inline the projection here. The "job parts is a subset"
 * decision is enforced server-side at exactly one place. Sending the full
 * canonical payload is correct.
 */
export function draftToJobPartPayload(
  draft: LineItemDraft,
): CanonicalLineItemInput {
  return toCanonicalPayload(draft);
}
