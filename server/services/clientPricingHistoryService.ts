/**
 * Canonical Client Pricing History — derived read service.
 *
 * Returns the most recent priced line items for a single client (location)
 * across canonical billing/quoting sources:
 *   - invoice_lines  (sourceType: "invoice")
 *   - quote_lines    (sourceType: "quote")
 *
 * `job_parts` is intentionally NOT a source. Job parts can represent
 * internal/staged data (PM template seeds, in-progress tech edits) before
 * a job is invoiced, so the prices on them do not constitute confirmed
 * customer pricing. Pricing history surfaces only what the customer has
 * been billed (invoices) or formally quoted (quotes).
 *
 * No new persistent table — every row is derived from the existing line
 * tables. The service NEVER mutates state and is NOT involved in
 * job-to-invoice conversion (no pricing-difference warnings, no overrides,
 * no fuzzy matching). Callers can use the response shape to surface
 * historical pricing in future UI without changing any write path.
 *
 * Tenant isolation is enforced on every SELECT by `companyId = ctx.tenantId`.
 * The route layer is responsible for verifying the requested client belongs
 * to the tenant before calling here (mirrors the existing
 * `getClientBillingSummary` / `getClientBillingHistory` contract).
 *
 * ─── Response contract (locked) ───────────────────────────────────────────
 *  - All money fields (`unitPrice`, `total`) are strings — matches the rest
 *    of the app, where `numeric` columns surface as decimal-precision
 *    strings (see invoiceFeed / billingHistory). NEVER convert to number.
 *  - `quantity` is a string too (the underlying column is `text` so it can
 *    hold fractional units like "1.5").
 *  - `date` is always an ISO 8601 timestamp string — sortable lexicographic.
 *  - `itemId`, `category`, `sourceNumber`, `locationId` are nullable; every
 *    other key is always present on every item.
 *  - `sourceType` is the literal union `"invoice" | "quote"` only.
 *  - The result envelope is `{ items: PricingHistoryItem[] }`. Empty history
 *    is `{ items: [] }`, never `null` and never an error.
 *  - Order: newest-first across all sources, then capped to `limit`.
 *  - `limit` default is 50; service clamps to [1, 200]. Route layer
 *    additionally rejects `limit` query params that fail to parse to a
 *    positive integer.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { and, eq, ilike, ne, or } from "drizzle-orm";
import {
  invoices,
  invoiceLines,
  quotes,
  quoteLines,
  items,
  clientLocations,
} from "@shared/schema";
import type { QueryCtx } from "../lib/queryCtx";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PricingHistorySourceType = "invoice" | "quote";

export interface PricingHistoryItem {
  clientId: string;
  locationId: string | null;
  /** Display name of the client/location — populated by getItemPricingContext,
   *  null in getClientPricingHistory (all results are the same client). */
  locationName: string | null;
  itemId: string | null;
  itemName: string;
  category: string | null;
  sourceType: PricingHistorySourceType;
  sourceId: string;
  sourceNumber: string | null;
  unitPrice: string;
  quantity: string;
  total: string;
  /** ISO 8601 timestamp string. */
  date: string;
}

export interface PricingHistoryFilters {
  /** Default 50, clamped to [1, 200]. */
  limit?: number;
  /** Filter to a single product/service ID — matches invoice/quote line productId. */
  itemId?: string;
  /** ILIKE match against the line description / item name. */
  search?: string;
  /**
   * Restrict to a specific location ID. By default, the resolver already
   * scopes by the requested clientId; this is here so future callers can
   * extend pricing history beyond a single location without changing the
   * service signature.
   */
  locationId?: string;
  /** Restrict to a single source type. */
  sourceType?: PricingHistorySourceType;
}

export interface PricingHistoryResult {
  items: PricingHistoryItem[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function clampLimit(raw: number | undefined): number {
  if (!raw || !Number.isFinite(raw)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(raw)));
}

function toIso(val: Date | string | null | undefined): string {
  if (!val) return new Date(0).toISOString();
  if (val instanceof Date) return val.toISOString();
  // Accept ISO/date strings as-is; normalize date-only to midnight UTC ISO.
  const d = new Date(val);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  return String(val);
}

function moneyString(val: string | number | null | undefined): string {
  if (val === null || val === undefined || val === "") return "0.00";
  const n = typeof val === "string" ? Number(val) : val;
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

function quantityString(val: string | number | null | undefined): string {
  if (val === null || val === undefined || val === "") return "0";
  return String(val);
}

// ---------------------------------------------------------------------------
// Canonical resolver
// ---------------------------------------------------------------------------

/**
 * Read recent pricing history for one client (location).
 *
 * @param ctx       Tenant-scoped query context (`tenantId` is enforced).
 * @param clientId  client_locations.id — the location whose history we want.
 * @param filters   Optional limit / itemId / search / sourceType filters.
 *
 * Returns rows newest-first. Returns an empty array when there is no
 * history for the client; never throws on "no data".
 */
export async function getClientPricingHistory(
  ctx: QueryCtx,
  clientId: string,
  filters: PricingHistoryFilters = {},
): Promise<PricingHistoryResult> {
  const limit = clampLimit(filters.limit);
  const sourceType = filters.sourceType;
  const includeInvoice = !sourceType || sourceType === "invoice";
  const includeQuote = !sourceType || sourceType === "quote";

  const locationFilter = filters.locationId ?? clientId;
  const search = filters.search?.trim();
  const searchPattern = search ? `%${search}%` : null;

  // --- Invoice line items -------------------------------------------------
  const invoicePromise = includeInvoice
    ? ctx.db
        .select({
          lineId: invoiceLines.id,
          productId: invoiceLines.productId,
          description: invoiceLines.description,
          unitPrice: invoiceLines.unitPrice,
          quantity: invoiceLines.quantity,
          lineTotal: invoiceLines.lineTotal,
          invoiceId: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          locationId: invoices.locationId,
          issueDate: invoices.issueDate,
          createdAt: invoices.createdAt,
          itemCategory: items.category,
          itemName: items.name,
        })
        .from(invoiceLines)
        .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
        .leftJoin(items, eq(invoiceLines.productId, items.id))
        .where(
          and(
            eq(invoices.companyId, ctx.tenantId),
            eq(invoiceLines.companyId, ctx.tenantId),
            eq(invoices.locationId, locationFilter),
            filters.itemId ? eq(invoiceLines.productId, filters.itemId) : undefined,
            searchPattern
              ? or(
                  ilike(invoiceLines.description, searchPattern),
                  ilike(items.name, searchPattern),
                )
              : undefined,
          ),
        )
    : Promise.resolve([] as any[]);

  // --- Quote line items ---------------------------------------------------
  const quotePromise = includeQuote
    ? ctx.db
        .select({
          lineId: quoteLines.id,
          productId: quoteLines.productId,
          description: quoteLines.description,
          unitPrice: quoteLines.unitPrice,
          quantity: quoteLines.quantity,
          lineTotal: quoteLines.lineTotal,
          quoteId: quotes.id,
          quoteNumber: quotes.quoteNumber,
          locationId: quotes.locationId,
          issueDate: quotes.issueDate,
          createdAt: quotes.createdAt,
          itemCategory: items.category,
          itemName: items.name,
        })
        .from(quoteLines)
        .innerJoin(quotes, eq(quoteLines.quoteId, quotes.id))
        .leftJoin(items, eq(quoteLines.productId, items.id))
        .where(
          and(
            eq(quotes.companyId, ctx.tenantId),
            eq(quoteLines.companyId, ctx.tenantId),
            eq(quotes.locationId, locationFilter),
            filters.itemId ? eq(quoteLines.productId, filters.itemId) : undefined,
            searchPattern
              ? or(
                  ilike(quoteLines.description, searchPattern),
                  ilike(items.name, searchPattern),
                )
              : undefined,
          ),
        )
    : Promise.resolve([] as any[]);

  const [invoiceRows, quoteRows] = await Promise.all([invoicePromise, quotePromise]);

  const result: PricingHistoryItem[] = [];

  for (const r of invoiceRows as any[]) {
    const row = r;
    result.push({
      clientId,
      locationId: row.locationId ?? null,
      locationName: null,
      itemId: row.productId ?? null,
      itemName: row.description ?? row.itemName ?? "",
      category: row.itemCategory ?? null,
      sourceType: "invoice",
      sourceId: row.invoiceId,
      sourceNumber: row.invoiceNumber ?? null,
      unitPrice: moneyString(row.unitPrice),
      quantity: quantityString(row.quantity),
      total: moneyString(row.lineTotal),
      date: toIso(row.issueDate ?? row.createdAt),
    });
  }

  for (const r of quoteRows as any[]) {
    const row = r;
    result.push({
      clientId,
      locationId: row.locationId ?? null,
      locationName: null,
      itemId: row.productId ?? null,
      itemName: row.description ?? row.itemName ?? "",
      category: row.itemCategory ?? null,
      sourceType: "quote",
      sourceId: row.quoteId,
      sourceNumber: row.quoteNumber ?? null,
      unitPrice: moneyString(row.unitPrice),
      quantity: quantityString(row.quantity),
      total: moneyString(row.lineTotal),
      date: toIso(row.issueDate ?? row.createdAt),
    });
  }

  // Newest-first across all sources, then cap to limit.
  result.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return { items: result.slice(0, limit) };
}

/**
 * Company-wide pricing context for a single catalog item.
 *
 * Returns recent invoice_lines + quote_lines for `itemId` across ALL
 * locations in the tenant, optionally excluding one location (used by
 * Invoice Detail "Most Recent Elsewhere" to exclude the current client).
 *
 * Same response envelope as `getClientPricingHistory` — callers can
 * render the result with the same component.
 */
export async function getItemPricingContext(
  ctx: QueryCtx,
  itemId: string,
  opts: { excludeLocationId?: string; limit?: number } = {},
): Promise<PricingHistoryResult> {
  const limit = clampLimit(opts.limit);

  const invoicePromise = ctx.db
    .select({
      lineId: invoiceLines.id,
      productId: invoiceLines.productId,
      description: invoiceLines.description,
      unitPrice: invoiceLines.unitPrice,
      quantity: invoiceLines.quantity,
      lineTotal: invoiceLines.lineTotal,
      invoiceId: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      locationId: invoices.locationId,
      issueDate: invoices.issueDate,
      createdAt: invoices.createdAt,
      itemCategory: items.category,
      itemName: items.name,
      locationName: clientLocations.companyName,
    })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
    .leftJoin(items, eq(invoiceLines.productId, items.id))
    .leftJoin(clientLocations, eq(invoices.locationId, clientLocations.id))
    .where(
      and(
        eq(invoices.companyId, ctx.tenantId),
        eq(invoiceLines.companyId, ctx.tenantId),
        eq(invoiceLines.productId, itemId),
        opts.excludeLocationId
          ? ne(invoices.locationId, opts.excludeLocationId)
          : undefined,
      ),
    );

  const quotePromise = ctx.db
    .select({
      lineId: quoteLines.id,
      productId: quoteLines.productId,
      description: quoteLines.description,
      unitPrice: quoteLines.unitPrice,
      quantity: quoteLines.quantity,
      lineTotal: quoteLines.lineTotal,
      quoteId: quotes.id,
      quoteNumber: quotes.quoteNumber,
      locationId: quotes.locationId,
      issueDate: quotes.issueDate,
      createdAt: quotes.createdAt,
      itemCategory: items.category,
      itemName: items.name,
      locationName: clientLocations.companyName,
    })
    .from(quoteLines)
    .innerJoin(quotes, eq(quoteLines.quoteId, quotes.id))
    .leftJoin(items, eq(quoteLines.productId, items.id))
    .leftJoin(clientLocations, eq(quotes.locationId, clientLocations.id))
    .where(
      and(
        eq(quotes.companyId, ctx.tenantId),
        eq(quoteLines.companyId, ctx.tenantId),
        eq(quoteLines.productId, itemId),
        opts.excludeLocationId
          ? ne(quotes.locationId, opts.excludeLocationId)
          : undefined,
      ),
    );

  const [invoiceRows, quoteRows] = await Promise.all([invoicePromise, quotePromise]);

  const result: PricingHistoryItem[] = [];

  for (const r of invoiceRows as any[]) {
    result.push({
      clientId: r.locationId ?? "",
      locationId: r.locationId ?? null,
      locationName: r.locationName ?? null,
      itemId: r.productId ?? null,
      itemName: r.description ?? r.itemName ?? "",
      category: r.itemCategory ?? null,
      sourceType: "invoice",
      sourceId: r.invoiceId,
      sourceNumber: r.invoiceNumber ?? null,
      unitPrice: moneyString(r.unitPrice),
      quantity: quantityString(r.quantity),
      total: moneyString(r.lineTotal),
      date: toIso(r.issueDate ?? r.createdAt),
    });
  }

  for (const r of quoteRows as any[]) {
    result.push({
      clientId: r.locationId ?? "",
      locationId: r.locationId ?? null,
      locationName: r.locationName ?? null,
      itemId: r.productId ?? null,
      itemName: r.description ?? r.itemName ?? "",
      category: r.itemCategory ?? null,
      sourceType: "quote",
      sourceId: r.quoteId,
      sourceNumber: r.quoteNumber ?? null,
      unitPrice: moneyString(r.unitPrice),
      quantity: quantityString(r.quantity),
      total: moneyString(r.lineTotal),
      date: toIso(r.issueDate ?? r.createdAt),
    });
  }

  result.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return { items: result.slice(0, limit) };
}
