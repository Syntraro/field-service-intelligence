/**
 * Canonical Line Item Contract
 *
 * Single source of truth for the shape of any editable line item across the
 * application: invoices, quotes, job parts, quote templates, job templates,
 * and the technician PWA.
 *
 * ============================================================================
 * GUARDRAILS — read these before adding code that touches a line item.
 * ============================================================================
 *
 * Rule 1 — One catalog source.
 *   Read products/services through the canonical catalog hook in
 *   `client/src/lib/entities/productEntity.ts` (or its successor in P9). Do
 *   not introduce a new `useQuery(["/api/items", ...])` in any component.
 *
 * Rule 2 — One mapper.
 *   Build a `LineItemDraft` only via `catalogItemToDraft`, `blankDraft`, or
 *   `hydrateDraft` in `client/src/lib/entities/lineItemMapper.ts`. Do not
 *   construct draft object literals in selector callbacks.
 *
 * Rule 3 — One draft shape.
 *   The `LineItemDraft` interface in this file is the in-memory editing shape
 *   for every line-item surface. Do not declare a per-page `LineItemDraft` /
 *   `LocalLineItem` interface anywhere else.
 *
 * Rule 4 — One selector system.
 *   Catalog selection goes through the shared selector
 *   (`CreateOrSelectField` + canonical productEntity adapter) on every
 *   surface. Custom row pickers, custom comboboxes, and ad-hoc fetch calls
 *   are out of scope after P11.
 *
 * Rule 5 — Job parts are a SUBSET persistence model.
 *   The `job_parts` table only stores description/productId/quantity/unitCost/
 *   unitPrice. The canonical line-item input is still the right wire shape
 *   (so every surface speaks one language). The `canonicalToJobPartFields`
 *   helper in `server/routes/jobs.ts` projects the input down to the
 *   persisted subset; everything else is silently dropped server-side. Do
 *   NOT add tax/total fields to job_parts without an explicit schema
 *   migration AND updating that helper.
 *
 * Rule 6 — Tech ref-based add stays separate.
 *   `POST /api/tech/visits/:visitId/parts` accepts a thin `{ productId,
 *   quantity, equipmentId }` payload and the SERVER hydrates the line item
 *   from the catalog. This is intentional — it lets technicians add parts
 *   without computing prices client-side. Do NOT migrate this route to the
 *   full canonical input shape; the server-side hydration is the right
 *   contract for field use.
 *
 * Rule 7 — Money-boundary discipline.
 *   Math is done in JS numbers via `parseMoney`. Values cross the wire and
 *   the DB boundary as canonical money strings via `formatMoney`. Never
 *   concatenate raw money strings; never `Number()` a money string outside
 *   `parseMoney`; never `String()` a money number outside `formatMoney`.
 *
 * ============================================================================
 *
 * 2026-04-08: Created as P2 of the catalog → line-item canonicalization pass.
 * 2026-04-08: Stabilization pass — added parseMoney/formatMoney helpers,
 *             tightened canonical schema output type, codified the rules
 *             above as guardrails.
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
 *
 * 2026-04-09: Exported so route-local schemas (e.g. `updateInvoiceLineSchema`)
 * can extend their partial-update validation with the canonical money shape
 * instead of redefining `z.number()` per field — closes the PATCH schema
 * drift identified in the payment-system audit.
 */
export const moneyString = z.coerce.string().regex(MONEY_STRING_RE, "Invalid money format");

// ============================================================================
// Money helpers — the only sanctioned way to cross the string ↔ number boundary
// ----------------------------------------------------------------------------
// Rule: math is done in JS numbers; values cross the wire and DB boundary as
// canonical money strings. These two helpers are the only sanctioned conversion
// points. Every route handler that does line-item math should import them.
//
// Adding these here (next to the canonical Zod schema) keeps the contract in
// one file: schema = wire format, helpers = how to leave/enter the wire format.
// ============================================================================

/**
 * Parse a canonical money value (string from the wire/DB, or a number from
 * legacy callers) into a JS number suitable for arithmetic. NULL/undefined,
 * empty strings, NaN, and unparseable strings all coerce to 0 — never NaN.
 * Never throws.
 */
export function parseMoney(value: string | number | null | undefined): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Format a JS number back to a canonical money string for the wire/DB.
 *
 * `decimals` defaults to 2 (for prices/totals/amounts). Use 4 for tax rates,
 * which the canonical schema permits up to 4 decimal places (e.g. "0.1300").
 *
 * Non-finite numbers (NaN, Infinity) become a zero-valued canonical string
 * — never `"NaN"`, never `"undefined"`, never empty.
 */
export function formatMoney(value: number, decimals: 2 | 4 = 2): string {
  if (!Number.isFinite(value)) return decimals === 4 ? "0.0000" : "0.00";
  return value.toFixed(decimals);
}

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
// 2026-04-08 stabilization: Use `.default()` WITHOUT `.optional()`. In Zod v3,
// `.default(x)` already makes the field optional on input AND narrows the
// output type to non-undefined; chaining `.optional().default()` leaks
// `string | undefined` into the inferred output type, which makes downstream
// helpers (e.g. `canonicalToJobPartFields` in server/routes/jobs.ts) impossible
// to type strictly. `.default()` alone gives a clean `string` output type.
export const canonicalLineItemInput = z.object({
  description: z.string().min(1).max(500),
  quantity: moneyString.default("1"),
  unitPrice: moneyString.default("0.00"),
  /** Cost basis. Optional everywhere; tracked on invoice_lines and job_parts. */
  unitCost: moneyString.optional(),
  /** Tax rate as a decimal (0.0 to 1.0). */
  taxRate: moneyString.default("0.0000"),
  /** Computed tax amount; routes may recompute server-side. */
  taxAmount: moneyString.default("0.00"),
  /** Computed line subtotal (quantity × unitPrice). */
  lineSubtotal: moneyString.default("0.00"),
  /** Computed line total (subtotal + tax). */
  lineTotal: moneyString.default("0.00"),
  /** Catalog reference. Null for manual lines. */
  productId: z.string().uuid().nullable().optional(),
  /** Line classification — invoice/quote enum. */
  lineItemType: z
    .enum(["service", "material", "fee", "discount"])
    .default("service"),
  /** Where the line originated. */
  source: z
    .enum(["manual", "job", "template", "tech"])
    .default("manual"),
  /** Service template attribution. Only present on quote lines created via apply-template. */
  serviceTemplateId: z.string().uuid().nullable().optional(),
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
  /** Service template attribution. Preserved through edits; does not affect totals. */
  serviceTemplateId?: string | null;
}
