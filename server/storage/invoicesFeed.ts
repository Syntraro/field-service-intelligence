/**
 * Canonical Invoices Feed — Phase 5 Part A
 *
 * Single source of truth for all invoice list and stats queries.
 * Uses the QueryCtx pattern from Phase 3 for tenant isolation.
 *
 * Key improvements over the old divergent queries:
 *   - All queries join customerCompanies with COALESCE for locationDisplayName
 *   - isPastDue computed consistently via shared helper
 *   - Composable filters cover list, dashboard, and by-job use cases
 *   - Timestamps normalized to ISO strings for API consumers
 *
 * Mutation methods (create, update, lines, etc.) remain in invoices.ts
 * — this module is read-only queries.
 */

import { eq, and, sql, desc, asc, or, isNull, inArray, ilike, gt, lt } from "drizzle-orm";
import { invoices, clients, customerCompanies, jobs } from "@shared/schema";
import type { QueryCtx } from "../lib/queryCtx";

// ---------------------------------------------------------------------------
// Step A1: InvoiceFeedFilters
// ---------------------------------------------------------------------------

/**
 * Composable filter interface covering all invoice query use cases:
 *   - List page: status, search, sort, pagination
 *   - Dashboard widget: statuses + unpaidOnly + limit
 *   - By-job lookup: jobId
 *   - AR aging: statuses + unpaidOnly
 */
export interface InvoiceFeedFilters {
  status?: string;
  statuses?: string[];
  excludeStatuses?: string[];
  jobId?: string;
  locationId?: string;
  customerCompanyId?: string;
  /** Only invoices with balance > 0 */
  unpaidOnly?: boolean;
  /** Only overdue invoices (unpaid + past due date) */
  overdue?: boolean;
  /** ILIKE search on invoice number, job number, location name */
  search?: string;
  /** Filter by issue date or due date range */
  dateRange?: { start: string; end: string };
  /** QBO sync status filter */
  qboSyncStatus?: string;
  qboOutOfSync?: boolean;
  limit?: number;
  offset?: number;
  sortBy?: "createdAt" | "dueDate" | "issueDate" | "total" | "balance" | "invoiceNumber";
  sortOrder?: "asc" | "desc";
}

// ---------------------------------------------------------------------------
// Step A3: InvoiceFeedItem and InvoiceStatsResult types
// ---------------------------------------------------------------------------

/** Canonical invoice feed item — all timestamps as ISO strings. */
export interface InvoiceFeedItem {
  id: string;
  companyId: string;
  locationId: string;
  customerCompanyId: string | null;
  invoiceNumber: string | null;
  status: string | null;
  issueDate: string | null;
  dueDate: string | null;
  currency: string | null;
  subtotal: string | null;
  taxTotal: string | null;
  total: string | null;
  amountPaid: string | null;
  balance: string | null;
  jobId: string | null;
  jobNumber: number | null;
  /** COALESCE(customerCompanies.name, clients.companyName) */
  locationDisplayName: string | null;
  /** clients.location (site name) */
  locationName: string | null;
  /** Computed: unpaid + past due date */
  isPastDue: boolean;
  // QBO fields
  qboInvoiceId: string | null;
  qboSyncStatus: string | null;
  qboOutOfSync: boolean | null;
  // Discount fields
  discountType: string | null;
  discountPercent: string | null;
  discountAmount: string | null;
  // Timestamps
  sentAt: string | null;
  viewedAt: string | null;
  isActive: boolean | null;
  version: number;
  createdAt: string;
  updatedAt: string | null;
}

/** Aggregated invoice statistics by status. */
export interface InvoiceStatsResult {
  byStatus: Array<{
    status: string;
    count: number;
    totalAmount: number;
  }>;
  /** Convenience aggregates */
  outstandingCount: number;
  overdueCount: number;
  draftCount: number;
  totalOutstanding: number;
}

// ---------------------------------------------------------------------------
// Internal: shared select fields and helpers
// ---------------------------------------------------------------------------

const UNPAID_STATUSES = ["awaiting_payment", "sent", "partial_paid"];

/** Standard soft-delete filter for invoices (handles legacy NULL isActive). */
function activeInvoiceFilter() {
  return and(
    or(eq(invoices.isActive, true), isNull(invoices.isActive)),
    isNull(invoices.deletedAt)
  );
}

/** Compute isPastDue: unpaid status + balance > 0 + dueDate < today. */
function computeIsPastDue(
  status: string | null,
  dueDate: string | Date | null,
  balance: string | number | null
): boolean {
  const unpaidStatuses = ["draft", "awaiting_payment", "sent", "partial_paid"];
  if (!status || !unpaidStatuses.includes(status)) return false;

  const balanceNum = typeof balance === "string" ? parseFloat(balance) : (balance ?? 0);
  if (balanceNum <= 0) return false;

  if (!dueDate) return false;
  const dueDateObj = typeof dueDate === "string" ? new Date(dueDate) : new Date(dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  dueDateObj.setHours(0, 0, 0, 0);
  return dueDateObj < today;
}

function toISOOrNull(val: Date | string | null | undefined): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  return val;
}

/** Feed-level select fields with COALESCE location name. */
const feedSelectFields = {
  id: invoices.id,
  companyId: invoices.companyId,
  locationId: invoices.locationId,
  customerCompanyId: invoices.customerCompanyId,
  invoiceNumber: invoices.invoiceNumber,
  status: invoices.status,
  issueDate: invoices.issueDate,
  dueDate: invoices.dueDate,
  currency: invoices.currency,
  subtotal: invoices.subtotal,
  taxTotal: invoices.taxTotal,
  total: invoices.total,
  amountPaid: invoices.amountPaid,
  balance: invoices.balance,
  jobId: invoices.jobId,
  jobNumber: jobs.jobNumber,
  // Phase 5: canonical COALESCE for location display name
  locationDisplayName: sql<string>`COALESCE(${customerCompanies.name}, ${clients.companyName})`,
  locationName: clients.location,
  // QBO fields
  qboInvoiceId: invoices.qboInvoiceId,
  qboSyncStatus: invoices.qboSyncStatus,
  qboOutOfSync: invoices.qboOutOfSync,
  // Discount fields
  discountType: invoices.discountType,
  discountPercent: invoices.discountPercent,
  discountAmount: invoices.discountAmount,
  // Timestamps
  sentAt: invoices.sentAt,
  viewedAt: invoices.viewedAt,
  isActive: invoices.isActive,
  version: invoices.version,
  createdAt: invoices.createdAt,
  updatedAt: invoices.updatedAt,
};

/** Map a raw DB row to InvoiceFeedItem with ISO strings. */
function mapFeedRow(row: any): InvoiceFeedItem {
  return {
    id: row.id,
    companyId: row.companyId,
    locationId: row.locationId,
    customerCompanyId: row.customerCompanyId ?? null,
    invoiceNumber: row.invoiceNumber ?? null,
    status: row.status ?? null,
    issueDate: row.issueDate ?? null,
    dueDate: row.dueDate ?? null,
    currency: row.currency ?? null,
    subtotal: row.subtotal ?? null,
    taxTotal: row.taxTotal ?? null,
    total: row.total ?? null,
    amountPaid: row.amountPaid ?? null,
    balance: row.balance ?? null,
    jobId: row.jobId ?? null,
    jobNumber: row.jobNumber ?? null,
    locationDisplayName: row.locationDisplayName ?? null,
    locationName: row.locationName ?? null,
    isPastDue: computeIsPastDue(row.status, row.dueDate, row.balance),
    qboInvoiceId: row.qboInvoiceId ?? null,
    qboSyncStatus: row.qboSyncStatus ?? null,
    qboOutOfSync: row.qboOutOfSync ?? null,
    discountType: row.discountType ?? null,
    discountPercent: row.discountPercent ?? null,
    discountAmount: row.discountAmount ?? null,
    sentAt: toISOOrNull(row.sentAt),
    viewedAt: toISOOrNull(row.viewedAt),
    isActive: row.isActive ?? null,
    version: row.version ?? 0,
    createdAt: toISOOrNull(row.createdAt) || new Date().toISOString(),
    updatedAt: toISOOrNull(row.updatedAt),
  };
}

// ---------------------------------------------------------------------------
// Step A2: getInvoicesFeed — canonical list query
// ---------------------------------------------------------------------------

/**
 * Canonical invoice list query with composable filters.
 * Always scopes by tenant, applies soft-delete guard, and joins
 * clientLocations + customerCompanies for correct display name.
 */
export async function getInvoicesFeed(
  ctx: QueryCtx,
  filters: InvoiceFeedFilters = {}
): Promise<{ items: InvoiceFeedItem[]; total?: number }> {
  const {
    status,
    statuses,
    excludeStatuses,
    jobId,
    locationId,
    customerCompanyId,
    unpaidOnly,
    overdue,
    search,
    dateRange,
    qboSyncStatus,
    qboOutOfSync,
    limit = 200,
    offset = 0,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = filters;

  let query = ctx.db
    .select(feedSelectFields)
    .from(invoices)
    .leftJoin(clients, eq(invoices.locationId, clients.id))
    .leftJoin(customerCompanies, eq(clients.parentCompanyId, customerCompanies.id))
    .leftJoin(jobs, eq(invoices.jobId, jobs.id))
    .where(
      and(
        eq(invoices.companyId, ctx.tenantId),
        activeInvoiceFilter()
      )
    )
    .$dynamic();

  // --- Composable filters ---
  if (status) {
    query = query.where(eq(invoices.status, status));
  }
  if (statuses?.length) {
    query = query.where(inArray(invoices.status, statuses));
  }
  if (excludeStatuses?.length) {
    query = query.where(
      sql`${invoices.status} NOT IN (${sql.join(excludeStatuses.map(s => sql`${s}`), sql`, `)})`
    );
  }
  if (jobId) {
    query = query.where(eq(invoices.jobId, jobId));
  }
  if (locationId) {
    query = query.where(eq(invoices.locationId, locationId));
  }
  if (customerCompanyId) {
    query = query.where(eq(invoices.customerCompanyId, customerCompanyId));
  }
  if (unpaidOnly) {
    query = query.where(sql`CAST(${invoices.balance} AS numeric) > 0`);
  }
  if (search) {
    const pattern = `%${search}%`;
    query = query.where(
      or(
        ilike(invoices.invoiceNumber, pattern),
        ilike(clients.companyName, pattern),
        ilike(clients.location, pattern),
        ilike(customerCompanies.name, pattern)
      )
    );
  }
  if (dateRange) {
    query = query.where(
      and(
        sql`${invoices.issueDate} >= ${dateRange.start}`,
        sql`${invoices.issueDate} <= ${dateRange.end}`
      )
    );
  }
  if (qboSyncStatus) {
    query = query.where(eq(invoices.qboSyncStatus, qboSyncStatus));
  }
  if (qboOutOfSync !== undefined) {
    query = query.where(eq(invoices.qboOutOfSync, qboOutOfSync));
  }

  // --- Sort ---
  const dir = sortOrder === "asc" ? asc : desc;
  const sortColumn = {
    createdAt: invoices.createdAt,
    dueDate: invoices.dueDate,
    issueDate: invoices.issueDate,
    total: invoices.total,
    balance: invoices.balance,
    invoiceNumber: invoices.invoiceNumber,
  }[sortBy] ?? invoices.createdAt;
  query = query.orderBy(dir(sortColumn), desc(invoices.id));

  // --- Pagination ---
  query = query.limit(limit).offset(offset);

  const rows = await query;
  const items = rows.map(mapFeedRow);

  // Post-filter: overdue (requires computed isPastDue)
  if (overdue) {
    return { items: items.filter(i => i.isPastDue) };
  }

  return { items };
}

// ---------------------------------------------------------------------------
// Step A2: getInvoiceStats — canonical stats query
// ---------------------------------------------------------------------------

/**
 * Aggregated invoice statistics by status.
 * Uses same tenant scoping and soft-delete filter as feed.
 */
export async function getInvoiceStats(
  ctx: QueryCtx
): Promise<InvoiceStatsResult> {
  const rows = await ctx.db
    .select({
      status: invoices.status,
      count: sql<number>`count(*)::int`,
      totalAmount: sql<number>`COALESCE(sum(CAST(${invoices.total} AS numeric)), 0)`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.companyId, ctx.tenantId),
        activeInvoiceFilter()
      )
    )
    .groupBy(invoices.status);

  // Compute convenience aggregates
  let outstandingCount = 0;
  let totalOutstanding = 0;
  let overdueCount = 0;
  let draftCount = 0;

  for (const row of rows) {
    if (UNPAID_STATUSES.includes(row.status ?? "")) {
      outstandingCount += Number(row.count);
      totalOutstanding += Number(row.totalAmount);
    }
    if (row.status === "draft") {
      draftCount = Number(row.count);
    }
  }

  // Overdue count requires a separate query since isPastDue depends on dueDate
  const overdueRows = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(invoices)
    .where(
      and(
        eq(invoices.companyId, ctx.tenantId),
        activeInvoiceFilter(),
        sql`CAST(${invoices.balance} AS numeric) > 0`,
        inArray(invoices.status, UNPAID_STATUSES),
        sql`${invoices.dueDate} < CURRENT_DATE`
      )
    );

  overdueCount = Number(overdueRows[0]?.count ?? 0);

  return {
    byStatus: rows.map(r => ({
      status: r.status ?? "unknown",
      count: Number(r.count),
      totalAmount: Number(r.totalAmount),
    })),
    outstandingCount,
    overdueCount,
    draftCount,
    totalOutstanding,
  };
}

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

export { computeIsPastDue, activeInvoiceFilter };
