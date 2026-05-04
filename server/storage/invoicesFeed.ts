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

import { eq, and, sql, desc, asc, or, isNull, isNotNull, inArray, ilike, gt, lt } from "drizzle-orm";
import { db } from "../db";
import { invoices, clients, customerCompanies, jobs, payments } from "@shared/schema";
import { UNPAID_INVOICE_STATUSES as SHARED_UNPAID_INVOICE_STATUSES } from "@shared/invoiceStatus";
import type { QueryCtx } from "../lib/queryCtx";
import { activeJobFilter } from "./jobFilters";
import { locationDisplayNameExpr } from "../lib/queryHelpers";

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
  /** invoices.workDescription — work performed / job summary */
  workDescription: string | null;
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
  /** SUM(invoice.total) for unpaid invoices. Pre-existing. */
  totalOutstanding: number;
  /** 2026-04-18 Phase 9: SUM(invoice.balance) for UNPAID + PAST-DUE
   *  invoices only. Accurate overdue $ for dashboard A/R signals;
   *  replaces the pre-Phase-9 "overdue uses outstanding total"
   *  approximation on the route layer. */
  totalOverdue: number;
}

// ---------------------------------------------------------------------------
// Internal: shared select fields and helpers
// ---------------------------------------------------------------------------

/**
 * Canonical unpaid/outstanding invoice statuses — invoices awaiting or
 * with pending payment. Re-exported from `@shared/invoiceStatus` so the
 * same list is visible to the client runtime.
 */
export const UNPAID_INVOICE_STATUSES: string[] = SHARED_UNPAID_INVOICE_STATUSES;

/** Raw SQL fragment derived from UNPAID_INVOICE_STATUSES for hand-written queries. */
export const UNPAID_INVOICE_STATUS_SQL = UNPAID_INVOICE_STATUSES.map(s => `'${s}'`).join(", ");

// 2026-04-09: activeInvoiceFilter() REMOVED — invoices have no soft-delete state
// under the permanent-delete model. The is_active and deleted_at columns are
// dropped in migrations/2026_04_09_invoice_permanent_delete.sql. All callers
// in this file no longer add the filter to their WHERE clauses; tenant
// isolation by company_id is unchanged.

/**
 * Compute isPastDue: payment-eligible status + balance > 0 + dueDate < today.
 * 2026-03-18: Removed "draft" — draft invoices have not been sent to the customer
 * and cannot be meaningfully past due. Matches dashboard pastDueCount SQL predicate.
 */
function computeIsPastDue(
  status: string | null,
  dueDate: string | Date | null,
  balance: string | number | null
): boolean {
  if (!status || !UNPAID_INVOICE_STATUSES.includes(status)) return false;

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
  workDescription: invoices.workDescription,
  // Phase 5: canonical COALESCE for location display name — uses canonical helper
  locationDisplayName: locationDisplayNameExpr,
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
    workDescription: row.workDescription ?? null,
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
    // 2026-03-18: Filter joined jobs for active status — prevents soft-deleted job data leaking into invoice feed
    .leftJoin(jobs, and(eq(invoices.jobId, jobs.id), activeJobFilter()))
    .where(
      and(
        eq(invoices.companyId, ctx.tenantId)
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
  // 2026-05-01 strict-search: parented invoices match only against the
  // parent customer company's current name. Standalone-location
  // invoices fall back to the location's own `companyName`. The
  // legacy denormalized child column is NOT searchable for parented
  // rows. Invoice number + location label continue to match unchanged.
  if (search) {
    const pattern = `%${search}%`;
    query = query.where(
      or(
        ilike(invoices.invoiceNumber, pattern),
        sql`(${clients.parentCompanyId} IS NOT NULL AND ${customerCompanies.name} ILIKE ${pattern})`,
        sql`(${clients.parentCompanyId} IS NULL AND ${clients.companyName} ILIKE ${pattern})`,
        ilike(clients.location, pattern)
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
        eq(invoices.companyId, ctx.tenantId)
      )
    )
    .groupBy(invoices.status);

  // Compute convenience aggregates
  let outstandingCount = 0;
  let totalOutstanding = 0;
  let overdueCount = 0;
  let draftCount = 0;

  for (const row of rows) {
    if (UNPAID_INVOICE_STATUSES.includes(row.status ?? "")) {
      outstandingCount += Number(row.count);
      totalOutstanding += Number(row.totalAmount);
    }
    if (row.status === "draft") {
      draftCount = Number(row.count);
    }
  }

  // 2026-04-18 Phase 9: overdue count AND total in one aggregate query.
  // SUMs `invoice.balance` (the receivable side) rather than `invoice.total`
  // so the dashboard A/R figure reflects what the customer actually owes
  // today, net of any partial payments.
  const overdueRows = await ctx.db
    .select({
      count: sql<number>`count(*)::int`,
      total: sql<number>`COALESCE(SUM(CAST(${invoices.balance} AS numeric)), 0)`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.companyId, ctx.tenantId),
        sql`CAST(${invoices.balance} AS numeric) > 0`,
        inArray(invoices.status, UNPAID_INVOICE_STATUSES),
        sql`${invoices.dueDate} < CURRENT_DATE`
      )
    );

  overdueCount = Number(overdueRows[0]?.count ?? 0);
  const totalOverdue = Number(overdueRows[0]?.total ?? 0);

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
    totalOverdue,
  };
}

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

// 2026-04-09: activeInvoiceFilter no longer exported — function removed.
export { computeIsPastDue };

// ---------------------------------------------------------------------------
// Reminder sweep (2026-04-16) — used by invoiceReminderWorker + manual path.
// Returns invoice IDs ready for a reminder based on tenant cadence config.
// ---------------------------------------------------------------------------

export interface ReminderSweepConfig {
  firstDelayDays: number;        // first reminder fires when due_date < now() - firstDelayDays
  repeatEveryDays: number;       // subsequent reminders fire every N days after the last
  // 2026-04-16 product correction: `maxCount` removed. Reminders continue
  // on cadence until paid, voided, paused, or snoozed. The schema column
  // `tenant_features.invoice_reminder_max_count` is deprecated.
}

export interface ReminderCandidate {
  id: string;
  companyId: string;
  /** 2026-05-03: renamed from `reminderCount`. Now counts every
   *  outbound invoice email (manual + automated). The cadence still
   *  uses it as the "have we sent before?" signal — every send,
   *  reminder or otherwise, advances the cadence by one notch. */
  emailSendCount: number;
  dueDate: string | Date | null;
  lastEmailedAt: Date | null;
}

/**
 * Return invoices for a single tenant that are due for an automated
 * reminder.
 *
 * Rules (matching `computeIsPastDue` semantics exactly):
 *   - status IN ('awaiting_payment', 'partial_paid', 'sent')
 *   - balance > 0
 *   - remindersPaused = false
 *   - reminderSnoozeUntil is null OR in the past
 *   - If emailSendCount = 0: due_date < now() - firstDelayDays
 *     Else: last_emailed_at < now() - repeatEveryDays
 */
export async function getInvoicesDueForReminder(
  companyId: string,
  config: ReminderSweepConfig,
): Promise<ReminderCandidate[]> {
  const rows = await db
    .select({
      id: invoices.id,
      companyId: invoices.companyId,
      emailSendCount: invoices.emailSendCount,
      dueDate: invoices.dueDate,
      lastEmailedAt: invoices.lastEmailedAt,
    })
    .from(invoices)
    .where(and(
      eq(invoices.companyId, companyId),
      inArray(invoices.status, UNPAID_INVOICE_STATUSES),
      sql`${invoices.balance}::numeric > 0`,
      eq(invoices.remindersPaused, false),
      or(
        isNull(invoices.reminderSnoozeUntil),
        sql`${invoices.reminderSnoozeUntil} < NOW()`,
      ),
      or(
        // First reminder: due date has passed by firstDelayDays.
        and(
          eq(invoices.emailSendCount, 0),
          isNotNull(invoices.dueDate),
          sql`${invoices.dueDate} < (CURRENT_DATE - (${config.firstDelayDays} || ' days')::interval)`,
        ),
        // Subsequent reminders: repeat cadence elapsed since last send.
        and(
          sql`${invoices.emailSendCount} > 0`,
          isNotNull(invoices.lastEmailedAt),
          sql`${invoices.lastEmailedAt} < (NOW() - (${config.repeatEveryDays} || ' days')::interval)`,
        ),
      ),
    ));

  return rows.map((r) => ({
    id: r.id,
    companyId: r.companyId,
    emailSendCount: r.emailSendCount,
    dueDate: r.dueDate,
    lastEmailedAt: r.lastEmailedAt,
  }));
}

// ---------------------------------------------------------------------------
// 2026-04-18 Client billing — canonical per-client aggregates
// ---------------------------------------------------------------------------
// Backend support for the client billing/account page. Two read-only
// aggregators that reuse the existing invoices + payments tables; no schema
// change, no provider-specific logic in the storage layer (Stripe / QBO are
// surfaced only as display-only flags on the summary + history rows).
//
// Scope is a discriminated union keyed on `customerCompanyId` vs `locationId`
// so every caller has to pick exactly one. Tenant isolation is enforced by
// `companyId = ctx.tenantId` on every SELECT; scope ownership is assumed to
// be verified at the route layer (existing repo checks), so these methods
// accept the id as-is.
// ---------------------------------------------------------------------------

/** Exactly one of the fields must be set. */
export type ClientBillingScope =
  | { customerCompanyId: string; locationId?: never }
  | { locationId: string; customerCompanyId?: never };

export interface ClientBillingSummary {
  scope: "company" | "location";
  scopeId: string;
  currency: string | null;
  totals: {
    /** SUM(balance) over unpaid open invoices in scope. Money string. */
    outstanding: string;
    /** SUM(balance) over unpaid + past-due invoices in scope. Money string. */
    overdue: string;
    overdueCount: number;
    /** COUNT(*) over unpaid open invoices in scope. */
    openCount: number;
    /** Always `null` today — no credits table. Never "0" (avoids false zero). */
    credits: string | null;
    lastPayment: {
      paymentId: string;
      invoiceId: string;
      amount: string;
      receivedAt: string;
    } | null;
  };
  /** Display-only flags; never mix into save payloads. */
  providerHints: {
    hasStripe: boolean;
    hasQboSync: boolean;
  };
}

export interface ClientBillingHistoryRow {
  kind: "invoice_issued" | "payment" | "refund" | "reversal";
  occurredAt: string;
  /** Signed delta against the client's AR: +invoice_issued, -payment, +refund, +reversal. */
  signedDelta: string;
  /** Server-computed running AR balance, accumulated over occurredAt ASC. */
  runningBalance: string;
  label: string;
  invoiceId?: string;
  paymentId?: string;
  providerSource?: "manual" | "stripe" | "qbo";
}

/** Internal: resolve scope → (SQL filter, kind, id). */
function resolveBillingScope(scope: ClientBillingScope) {
  if (scope.customerCompanyId) {
    return {
      filter: eq(invoices.customerCompanyId, scope.customerCompanyId),
      kind: "company" as const,
      id: scope.customerCompanyId,
    };
  }
  return {
    filter: eq(invoices.locationId, scope.locationId!),
    kind: "location" as const,
    id: scope.locationId!,
  };
}

/**
 * Canonical client-level billing summary.
 *
 * Derives every metric from existing columns:
 *   - outstanding / overdue: SUM(invoices.balance) over unpaid-set, with a
 *     second filter for past-due.
 *   - openCount / overdueCount: COUNT(*) with matching filters.
 *   - hasQboSync: BOOL_OR(invoices.qboInvoiceId IS NOT NULL) across ALL
 *     invoices in scope (not just unpaid).
 *   - lastPayment: MAX(receivedAt) via ORDER BY + LIMIT 1 over payment rows
 *     with paymentType='payment' (ignores refund/reversal).
 *   - hasStripe: existence check against payments.providerSource='stripe'.
 *   - credits: intentionally null — no credits table exists in the schema.
 *
 * Three parallel queries. No schema change. No provider-specific logic.
 */
export async function getClientBillingSummary(
  ctx: QueryCtx,
  scope: ClientBillingScope,
): Promise<ClientBillingSummary> {
  const { filter: scopeFilter, kind: scopeKind, id: scopeId } = resolveBillingScope(scope);
  // Inline unpaid-status list for FILTER aggregates. UNPAID_INVOICE_STATUS_SQL
  // is a compile-time constant (no user input) — safe to raw-interpolate.
  const unpaidList = sql.raw(UNPAID_INVOICE_STATUS_SQL);

  const [aggResults, lastPaymentResults, stripeResults] = await Promise.all([
    ctx.db
      .select({
        openCount: sql<number>`COUNT(*) FILTER (WHERE ${invoices.status} IN (${unpaidList}) AND CAST(${invoices.balance} AS numeric) > 0)::int`,
        outstanding: sql<string>`COALESCE(SUM(CAST(${invoices.balance} AS numeric)) FILTER (WHERE ${invoices.status} IN (${unpaidList}) AND CAST(${invoices.balance} AS numeric) > 0), 0)::text`,
        overdueCount: sql<number>`COUNT(*) FILTER (WHERE ${invoices.status} IN (${unpaidList}) AND CAST(${invoices.balance} AS numeric) > 0 AND ${invoices.dueDate} < CURRENT_DATE)::int`,
        overdueTotal: sql<string>`COALESCE(SUM(CAST(${invoices.balance} AS numeric)) FILTER (WHERE ${invoices.status} IN (${unpaidList}) AND CAST(${invoices.balance} AS numeric) > 0 AND ${invoices.dueDate} < CURRENT_DATE), 0)::text`,
        hasQboSync: sql<boolean>`COALESCE(BOOL_OR(${invoices.qboInvoiceId} IS NOT NULL), false)`,
        currency: sql<string | null>`MAX(${invoices.currency})`,
      })
      .from(invoices)
      .where(and(eq(invoices.companyId, ctx.tenantId), scopeFilter)),
    ctx.db
      .select({
        id: payments.id,
        amount: payments.amount,
        receivedAt: payments.receivedAt,
        invoiceId: payments.invoiceId,
      })
      .from(payments)
      .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
      .where(and(
        eq(invoices.companyId, ctx.tenantId),
        scopeFilter,
        eq(payments.paymentType, "payment"),
      ))
      .orderBy(desc(payments.receivedAt))
      .limit(1),
    ctx.db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(payments)
      .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
      .where(and(
        eq(invoices.companyId, ctx.tenantId),
        scopeFilter,
        eq(payments.providerSource, "stripe"),
      ))
      .limit(1),
  ]);

  const agg = aggResults[0];
  const lastPaymentRow = lastPaymentResults[0];
  const stripeRow = stripeResults[0];

  return {
    scope: scopeKind,
    scopeId,
    currency: agg?.currency ?? null,
    totals: {
      outstanding: agg?.outstanding ?? "0",
      overdue: agg?.overdueTotal ?? "0",
      overdueCount: Number(agg?.overdueCount ?? 0),
      openCount: Number(agg?.openCount ?? 0),
      credits: null,
      lastPayment: lastPaymentRow
        ? {
            paymentId: lastPaymentRow.id,
            // INNER JOIN on invoices.id = payments.invoice_id filters out
            // null-invoice rows (multi-invoice payments, post-2026-05-03).
            // Coerce to string for the public API contract.
            invoiceId: lastPaymentRow.invoiceId ?? "",
            amount: lastPaymentRow.amount ?? "0",
            receivedAt: toISOOrNull(lastPaymentRow.receivedAt) ?? "",
          }
        : null,
    },
    providerHints: {
      hasStripe: Number(stripeRow?.cnt ?? 0) > 0,
      hasQboSync: Boolean(agg?.hasQboSync ?? false),
    },
  };
}

/**
 * Canonical client-level billing history / ledger.
 *
 * Returns a unified stream of:
 *   - invoice_issued events (status != 'draft'; occurredAt = sent/issue/created, first non-null)
 *   - payment / refund / reversal events from `payments`
 *
 * `signedDelta` is the AR-relative delta:
 *   - invoice_issued: +total (AR increases when billed)
 *   - payment:        -amount (payment amount is stored positive; AR decreases)
 *   - refund:         -amount (amount is stored negative; double-negative = +)
 *   - reversal:       -amount (same)
 *
 * `runningBalance` is computed server-side over occurredAt ASC so the client
 * never re-aggregates. Rows are returned DESC (most recent first). `limit`
 * caps the response size.
 *
 * Three source columns for "issued at" (COALESCE sentAt → issueDate → createdAt)
 * tolerate the full lifecycle of in-schema state (legacy invoices with only
 * createdAt, modern ones with sentAt set at the send event). issueDate is a
 * `date` column so cast to timestamp before COALESCE.
 */
export async function getClientBillingHistory(
  ctx: QueryCtx,
  scope: ClientBillingScope,
  options: { limit?: number } = {},
): Promise<ClientBillingHistoryRow[]> {
  const { filter: scopeFilter } = resolveBillingScope(scope);
  const limit = Math.max(1, Math.min(options.limit ?? 200, 500));

  const [invoiceRows, paymentRows] = await Promise.all([
    ctx.db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        total: invoices.total,
        occurredAt: sql<Date | string | null>`COALESCE(${invoices.sentAt}, ${invoices.issueDate}::timestamp, ${invoices.createdAt})`,
        qboInvoiceId: invoices.qboInvoiceId,
      })
      .from(invoices)
      .where(and(
        eq(invoices.companyId, ctx.tenantId),
        scopeFilter,
        sql`${invoices.status} <> 'draft'`,
      )),
    ctx.db
      .select({
        id: payments.id,
        invoiceId: payments.invoiceId,
        amount: payments.amount,
        paymentType: payments.paymentType,
        method: payments.method,
        providerSource: payments.providerSource,
        receivedAt: payments.receivedAt,
        invoiceNumber: invoices.invoiceNumber,
      })
      .from(payments)
      .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
      .where(and(
        eq(invoices.companyId, ctx.tenantId),
        scopeFilter,
      )),
  ]);

  type RawEvent = {
    kind: ClientBillingHistoryRow["kind"];
    occurredAtMs: number;
    occurredAt: string;
    delta: number;
    label: string;
    invoiceId?: string;
    paymentId?: string;
    providerSource?: ClientBillingHistoryRow["providerSource"];
  };

  const toMs = (v: Date | string | null | undefined): number => {
    if (!v) return 0;
    if (v instanceof Date) return v.getTime();
    return new Date(v).getTime();
  };

  const events: RawEvent[] = [];

  for (const r of invoiceRows) {
    const ms = toMs(r.occurredAt as any);
    events.push({
      kind: "invoice_issued",
      occurredAtMs: ms,
      occurredAt: toISOOrNull(r.occurredAt as any) ?? new Date(ms || Date.now()).toISOString(),
      delta: Number(r.total ?? "0"),
      label: r.invoiceNumber ? `Invoice #${r.invoiceNumber}` : "Invoice",
      invoiceId: r.id,
      providerSource: r.qboInvoiceId ? "qbo" : undefined,
    });
  }

  for (const p of paymentRows) {
    const amt = Number(p.amount ?? "0");
    const kind = (p.paymentType ?? "payment") as ClientBillingHistoryRow["kind"];
    const invoiceRef = p.invoiceNumber ? `Invoice #${p.invoiceNumber}` : "Invoice";
    const providerLabel =
      p.providerSource === "stripe"
        ? "Stripe"
        : p.providerSource === "qbo"
          ? "QuickBooks"
          : p.method ?? "manual";
    const baseLabel =
      kind === "payment" ? "Payment" : kind === "refund" ? "Refund" : "Reversal";
    const ms = toMs(p.receivedAt as any);
    events.push({
      kind,
      occurredAtMs: ms,
      occurredAt: toISOOrNull(p.receivedAt as any) ?? new Date(ms || Date.now()).toISOString(),
      delta: -amt, // see docstring: signedDelta = -amount for every payment kind
      label: `${baseLabel} (${providerLabel}) · ${invoiceRef}`,
      // INNER JOIN on invoices.id = payments.invoice_id above filters out
      // null-invoice rows; the `?? undefined` is a TS-only narrowing.
      invoiceId: p.invoiceId ?? undefined,
      paymentId: p.id,
      providerSource: (p.providerSource ?? "manual") as ClientBillingHistoryRow["providerSource"],
    });
  }

  // Accumulate running balance over ASC order, then reverse for DESC output.
  events.sort((a, b) => a.occurredAtMs - b.occurredAtMs);
  let running = 0;
  const asc: ClientBillingHistoryRow[] = events.map((e) => {
    running += e.delta;
    return {
      kind: e.kind,
      occurredAt: e.occurredAt,
      signedDelta: e.delta.toFixed(2),
      runningBalance: running.toFixed(2),
      label: e.label,
      invoiceId: e.invoiceId,
      paymentId: e.paymentId,
      providerSource: e.providerSource,
    };
  });

  return asc.reverse().slice(0, limit);
}

// ---------------------------------------------------------------------------
// Phase 10 (2026-04-18) — Reconciliation signals
//
// Detects invoices whose persisted status + money fields have diverged
// from each other. Canonical truth is `recalculateInvoiceBalance` —
// this helper does NOT recompute or mutate, it only surfaces rows
// that look inconsistent so a manager can reconcile them manually.
//
// Three suspicious shapes we detect:
//   1) status = 'paid'              but balance > 0       (marked paid, still owed)
//   2) balance <= 0 && amountPaid>0 but status IN unpaid  (fully collected, status stuck)
//   3) status = 'partial_paid'      but amountPaid <= 0   (partial label, no payment rows)
//
// These arise from edge cases: QBO sync races, manual status edits,
// or a payment delete that wasn't followed by recalculation. The
// UI surfaces this as a banner so the user can click through and
// trigger a fresh recalculation / correction.
// ---------------------------------------------------------------------------

export type ReconciliationIssueKind =
  | "paid_with_balance"
  | "zero_balance_still_unpaid"
  | "partial_without_payment";

export interface ReconciliationIssue {
  invoiceId: string;
  invoiceNumber: string | null;
  status: string | null;
  total: string | null;
  amountPaid: string | null;
  balance: string | null;
  jobId: string | null;
  locationDisplayName: string | null;
  kind: ReconciliationIssueKind;
}

export async function getReconciliationIssues(
  ctx: QueryCtx,
  limit: number = 50,
): Promise<ReconciliationIssue[]> {
  const rows = await ctx.db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      status: invoices.status,
      total: invoices.total,
      amountPaid: invoices.amountPaid,
      balance: invoices.balance,
      jobId: invoices.jobId,
      locationDisplayName: locationDisplayNameExpr,
    })
    .from(invoices)
    .leftJoin(clients, eq(invoices.locationId, clients.id))
    .leftJoin(customerCompanies, eq(invoices.customerCompanyId, customerCompanies.id))
    .where(
      and(
        eq(invoices.companyId, ctx.tenantId),
        or(
          and(
            eq(invoices.status, "paid"),
            sql`CAST(${invoices.balance} AS numeric) > 0`,
          ),
          and(
            inArray(invoices.status, UNPAID_INVOICE_STATUSES),
            sql`CAST(${invoices.balance} AS numeric) <= 0`,
            sql`CAST(${invoices.amountPaid} AS numeric) > 0`,
          ),
          and(
            eq(invoices.status, "partial_paid"),
            sql`CAST(${invoices.amountPaid} AS numeric) <= 0`,
          ),
        ),
      ),
    )
    .limit(limit);

  return rows.map((r) => {
    const balanceNum = parseFloat(r.balance ?? "0");
    const paidNum = parseFloat(r.amountPaid ?? "0");
    let kind: ReconciliationIssueKind;
    if (r.status === "paid" && balanceNum > 0) {
      kind = "paid_with_balance";
    } else if (r.status === "partial_paid" && paidNum <= 0) {
      kind = "partial_without_payment";
    } else {
      kind = "zero_balance_still_unpaid";
    }
    return {
      invoiceId: r.id,
      invoiceNumber: r.invoiceNumber ?? null,
      status: r.status ?? null,
      total: r.total ?? null,
      amountPaid: r.amountPaid ?? null,
      balance: r.balance ?? null,
      jobId: r.jobId ?? null,
      locationDisplayName: (r as any).locationDisplayName ?? null,
      kind,
    };
  });
}

