/**
 * Canonical Line Item Contract
 *
 * Single source of truth for the shape of any editable line item across the
 * application: invoices, quotes, job parts, quote templates, job templates,
 * and the technician PWA.
 *
 * 2026-04-08: Created as P2 of the catalog → line-item canonicalization pass.
 *
 * Layer model:
 *
 *   1. CatalogItem  — normalized read shape returned by the catalog hook for
 *                     any product/service. Source: items table.
 *
 *   2. LineItemDraft — client-side editing shape. Includes UI-only fields
 *                      (id, isNew, isDraft) plus the canonical payload fields.
 *                      Same shape across every surface — no per-page draft
 *                      types, no per-table aliases.
 *
 *   3. canonicalLineItemInput — Zod schema validating what gets sent to the
 *                               server's create-line / update-line endpoints.
 *                               Each route's existing schema becomes
 *                               `canonicalLineItemInput.extend({...routeSpecific})`.
 *
 *   4. CanonicalLineItemInput — TS type derived from the schema, the
 *                               authoritative wire format on the server side
 *                               after validation.
 *
 * Numeric fields: ALWAYS strings on the wire. The schema accepts both string
 * and number for transitional backward compatibility (some client surfaces
 * still send numbers — they will be migrated in P9-P10) and transforms
 * everything to a canonical money-string. JS number precision risk on money
 * values is the reason we land on string here, not number.
 *
 * What this contract does NOT cover:
 *   - DB row shapes (those live in shared/schema.ts as Drizzle tables)
 *   - Per-route extension fields (lineNumber, overrideQboLock, etc.) — those
 *     stay route-local because they are not properties of a line item itself.
 */

import { z } from "zod";

// ============================================================================
// Money helpers
// ============================================================================

/**
 * Money string format: digits with optional fractional part of 1-4 digits.
 * Allows negatives for refund/discount lines. Trailing-zero variants ("100",
 * "100.00", "100.0") are all accepted. The schema normalizes inputs through
 * `.transform(String)` so callers can send numbers during the transition.
 */
const MONEY_STRING_RE = /^-?\d+(\.\d{1,4})?$/;

/**
 * Accepts string | number (and stringifies number for transitional clients),
 * then validates the resulting string is a money-shaped value.
 *
 * Implementation note: uses `z.coerce.string()` so Zod calls `String(input)`
 * automatically and the inferred output type is unambiguously `string`. A
 * `.union([string, number]).transform().pipe(string)` variant leaks the union
 * into the inferred output type; `z.preprocess` infers as unknown. Coerce
 * gives a clean `string` output and accepts both numbers and strings on input.
 */
const moneyString = z.coerce.string().regex(MONEY_STRING_RE, "Invalid money format");

// ============================================================================
// CatalogItem — normalized read shape
// ============================================================================

/**
 * Normalized catalog item returned by the canonical catalog hook.
 *
 * This is the only shape any selector / mapper / draft hydrator should see
 * from a catalog read. Anything that needs additional fields (e.g. QBO sync
 * status, audit timestamps) reads them from the raw `items` row directly,
 * not from this normalized projection.
 */
export interface CatalogItem {
  id: string;
  type: "product" | "service";
  name: string;
  sku: string | null;
  description: string | null;
  /** Cost basis (numeric in DB, serialized as string). May be null. */
  cost: string | null;
  /** Sell price (numeric in DB, serialized as string). May be null. */
  unitPrice: string | null;
  isTaxable: boolean;
  taxCode: string | null;
  category: string | null;
  isActive: boolean;
}

// ============================================================================
// canonicalLineItemInput — wire format Zod schema
// ============================================================================

/**
 * Canonical line-item input schema. Every server route that creates or
 * updates a line item validates against this base (or an extension of it).
 *
 * - Numeric fields are always string on the wire (transitional union for
 *   number-sending clients during migration P9-P10).
 * - `productId` is nullable so manual lines (no catalog link) are supported
 *   uniformly across invoices, quotes, job parts, and templates.
 * - `lineItemType` defaults to "service" matching existing DB defaults.
 * - This base intentionally does NOT include `.strict()` so each route can
 *   `.extend({...})` with its own fields and apply `.strict()` itself.
 */
export const canonicalLineItemInput = z.object({
  description: z.string().min(1).max(500),
  quantity: moneyString.optional().default("1"),
  unitPrice: moneyString.optional().default("0.00"),
  /** Cost basis. Optional everywhere; tracked on invoice_lines and job_parts. */
  unitCost: moneyString.optional(),
  /** Tax rate as a decimal (0.0 to 1.0). */
  taxRate: moneyString.optional().default("0.0000"),
  /** Computed tax amount; routes may recompute server-side. */
  taxAmount: moneyString.optional().default("0.00"),
  /** Computed line subtotal (quantity × unitPrice). */
  lineSubtotal: moneyString.optional().default("0.00"),
  /** Computed line total (subtotal + tax). */
  lineTotal: moneyString.optional().default("0.00"),
  /** Catalog reference. Null for manual lines. */
  productId: z.string().uuid().nullable().optional(),
  /** Line classification — invoice/quote enum. */
  lineItemType: z
    .enum(["service", "material", "fee", "discount"])
    .optional()
    .default("service"),
  /** Where the line originated. */
  source: z
    .enum(["manual", "job", "template", "tech"])
    .optional()
    .default("manual"),
});

/** Server-side type after validation: all money fields are guaranteed strings. */
export type CanonicalLineItemInput = z.infer<typeof canonicalLineItemInput>;

// ============================================================================
// LineItemDraft — client-side editing shape
// ============================================================================

/**
 * Client-side editing draft for a line item.
 *
 * This is the ONLY in-memory shape any client surface should hold for a line
 * item being edited. Per-surface "LocalLineItem" / "LineItemDraft" interfaces
 * across InvoiceDetailPage, PartsBillingCard, QuoteTemplateModal, etc. are
 * deprecated and will be replaced by this type in P9-P10.
 *
 * Per-target wire payloads are produced by `draftToInvoiceLinePayload`,
 * `draftToQuoteLinePayload`, `draftToJobPartPayload` in
 * client/src/lib/entities/lineItemMapper.ts (P3).
 */
export interface LineItemDraft {
  // ── Canonical payload fields (mirror canonicalLineItemInput) ──────────────
  description: string;
  quantity: string;
  unitPrice: string;
  unitCost: string;
  taxRate: string;
  taxAmount: string;
  lineSubtotal: string;
  lineTotal: string;
  productId: string | null;
  lineItemType: "service" | "material" | "fee" | "discount";
  source: "manual" | "job" | "template" | "tech";

  // ── Client-only UI state (never sent to server) ───────────────────────────
  /** Local UUID assigned at row creation; replaced by real id on save. */
  id: string;
  /** True if this row has not yet been persisted. */
  isNew: boolean;
  /** True while the row is being interactively edited but not yet saved. */
  isDraft: boolean;
  /**
   * Catalog item type, when known. Helps surfaces show product vs service
   * affordances without re-fetching the catalog row.
   */
  productType?: "product" | "service";
  /** Optional free-form notes (kept separate from description for some surfaces). */
  notes?: string;
  /** Sortable order (rendered tables use dnd-kit). */
  sortOrder?: number;
}
