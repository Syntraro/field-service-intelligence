import { db } from "../db";
import { eq, and, sql, inArray, gt, desc } from "drizzle-orm";
import { invoices, clientLocations, customerCompanies } from "@shared/schema";
import { BaseRepository } from "./base";
import { locationDisplayNameExpr } from "../lib/queryHelpers";
import { UNPAID_INVOICE_STATUSES } from "@shared/invoiceStatus";

/**
 * Canonical aging-bucket keys. Match `getBillingAggregatesForLocations` in
 * `server/storage/customerCompanies.ts` byte-for-byte so the AR Aging
 * report reconciles with the Client Detail billing aggregates:
 *   - current: not yet due OR no due date
 *   - d30:     1–30 days overdue
 *   - d60:     31–60 days overdue
 *   - d90:     61+ days overdue
 */
export type ARAgingBucketKey = "current" | "d30" | "d60" | "d90";

export interface ARAgingInvoice {
  id: string;
  invoiceNumber: string | null;
  issueDate: string;
  dueDate: string | null;
  status: string;
  total: string;
  balance: string;
  daysOverdue: number;
  agingBucket: ARAgingBucketKey;
  customerCompany: {
    id: string | null;
    name: string | null;
  };
  location: {
    id: string | null;
    companyName: string | null;
    location: string | null;
  };
  /** Phase 5 Step A5: COALESCE'd display name */
  locationDisplayName: string | null;
}

export interface ARAgingBucket {
  bucket: ARAgingBucketKey;
  count: number;
  totalBalance: number;
}

export interface ARAgingReport {
  summary: {
    totalOutstanding: number;
    totalInvoices: number;
    averageDaysOutstanding: number;
  };
  buckets: ARAgingBucket[];
  invoices: ARAgingInvoice[];
}

// ---------------------------------------------------------------------------
// Canonical SQL fragments. 2026-04-19 rewrite: every date boundary resolved
// in the database via `CURRENT_DATE` so server-timezone drift cannot bias
// the bucket assignment. Both fragments are referenced in SELECT + GROUP BY
// + ORDER BY — Drizzle composes the same tree in each slot safely.
// ---------------------------------------------------------------------------

const agingBucketExpr = sql<ARAgingBucketKey>`
  CASE
    WHEN ${invoices.dueDate} IS NULL OR ${invoices.dueDate} >= CURRENT_DATE THEN 'current'
    WHEN ${invoices.dueDate} >= CURRENT_DATE - INTERVAL '30 days' THEN 'd30'
    WHEN ${invoices.dueDate} >= CURRENT_DATE - INTERVAL '60 days' THEN 'd60'
    ELSE 'd90'
  END
`;

// Days overdue: 0 for current / null-dueDate rows; otherwise positive
// integer days past CURRENT_DATE. Uses Postgres native date subtraction.
const daysOverdueExpr = sql<number>`
  GREATEST(
    0,
    CASE
      WHEN ${invoices.dueDate} IS NULL THEN 0
      ELSE (CURRENT_DATE - ${invoices.dueDate}::date)
    END
  )::int
`;

export class ReportsRepository extends BaseRepository {
  /**
   * 2026-04-19 rewrite — AR Aging report.
   *
   * Correctness fixes over the previous JS-driven implementation:
   *   1. Status filter uses canonical `UNPAID_INVOICE_STATUSES` from
   *      `@shared/invoiceStatus` so `awaiting_payment` (the primary
   *      canonical issued status) is no longer silently excluded.
   *   2. Aging math is entirely server-side (`CURRENT_DATE`,
   *      `INTERVAL '30 days'`); no local-timezone `new Date()` drift.
   *   3. Canonical bucket keys (`current / d30 / d60 / d90`) match the
   *      Client Detail `getBillingAggregatesForLocations` aggregate so
   *      the two surfaces reconcile row-for-row on the same tenant.
   *   4. Summary + bucket totals are computed via a SQL aggregate
   *      GROUP BY over the full filtered invoice set. They are NOT
   *      derived from iterating the detail rows, so the numbers stay
   *      correct at any tenant volume even if the route paginates the
   *      `invoices` array.
   *   5. Status predicate (unpaid + balance > 0) automatically excludes
   *      draft / paid / voided rows — no extra client-side filtering.
   *
   * The JSON shape returned by the route is unchanged except for the
   * bucket key rename (see caller note in the route file).
   */
  async getARAgingReport(companyId: string): Promise<ARAgingReport> {
    this.assertCompanyId(companyId);

    // Shared WHERE: tenant-scoped, canonical unpaid set, positive balance.
    // balance > 0 guards against invoices whose status stayed on an
    // unpaid value but have been fully collected via offsetting rows.
    const baseWhere = and(
      eq(invoices.companyId, companyId),
      inArray(invoices.status, UNPAID_INVOICE_STATUSES),
      gt(sql`CAST(${invoices.balance} AS DECIMAL)`, 0),
    );

    // Two parallel queries:
    //   - aggregate: one row per bucket with count + total + sum-of-days
    //   - detail:    row-per-invoice with bucket + daysOverdue computed in SQL
    // The aggregate drives the summary so totals are always correct
    // regardless of how many detail rows the route ultimately returns.
    const [aggregateRows, detailRows] = await Promise.all([
      db
        .select({
          bucket: agingBucketExpr.as("bucket"),
          count: sql<number>`COUNT(*)::int`.as("count"),
          totalBalance: sql<string>`COALESCE(SUM(CAST(${invoices.balance} AS numeric)), 0)::text`.as("total_balance"),
          totalDaysOverdue: sql<string>`COALESCE(SUM(${daysOverdueExpr}), 0)::text`.as("total_days_overdue"),
        })
        .from(invoices)
        .where(baseWhere)
        .groupBy(agingBucketExpr),

      db
        .select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          issueDate: invoices.issueDate,
          dueDate: invoices.dueDate,
          status: invoices.status,
          total: invoices.total,
          balance: invoices.balance,
          daysOverdue: daysOverdueExpr.as("days_overdue"),
          agingBucket: agingBucketExpr.as("aging_bucket"),
          locationId: clientLocations.id,
          locationCompanyName: clientLocations.companyName,
          locationName: clientLocations.location,
          customerCompanyId: customerCompanies.id,
          customerCompanyName: customerCompanies.name,
          locationDisplayName: locationDisplayNameExpr,
        })
        .from(invoices)
        // LEFT JOIN keeps invoices with no/deleted locations visible in the report.
        .leftJoin(clientLocations, eq(invoices.locationId, clientLocations.id))
        .leftJoin(customerCompanies, eq(clientLocations.parentCompanyId, customerCompanies.id))
        .where(baseWhere)
        .orderBy(desc(daysOverdueExpr)),
    ]);

    // Materialize all four bucket keys so the response shape is stable
    // (zero-filled when a tenant has no invoices in a given bucket).
    const bucketTotals: Record<ARAgingBucketKey, { count: number; totalBalance: number }> = {
      current: { count: 0, totalBalance: 0 },
      d30:     { count: 0, totalBalance: 0 },
      d60:     { count: 0, totalBalance: 0 },
      d90:     { count: 0, totalBalance: 0 },
    };

    let totalInvoices = 0;
    let totalOutstanding = 0;
    let totalDaysOutstanding = 0;

    for (const r of aggregateRows) {
      const key = r.bucket as ARAgingBucketKey;
      const count = Number(r.count ?? 0);
      const balance = parseFloat(r.totalBalance ?? "0");
      const days = parseFloat(r.totalDaysOverdue ?? "0");

      if (bucketTotals[key]) {
        bucketTotals[key] = { count, totalBalance: balance };
      }
      totalInvoices += count;
      totalOutstanding += balance;
      totalDaysOutstanding += days;
    }

    const buckets: ARAgingBucket[] = [
      { bucket: "current", count: bucketTotals.current.count, totalBalance: bucketTotals.current.totalBalance },
      { bucket: "d30",     count: bucketTotals.d30.count,     totalBalance: bucketTotals.d30.totalBalance     },
      { bucket: "d60",     count: bucketTotals.d60.count,     totalBalance: bucketTotals.d60.totalBalance     },
      { bucket: "d90",     count: bucketTotals.d90.count,     totalBalance: bucketTotals.d90.totalBalance     },
    ];

    const processedInvoices: ARAgingInvoice[] = detailRows.map((row) => ({
      id: row.id,
      invoiceNumber: row.invoiceNumber,
      issueDate: row.issueDate,
      dueDate: row.dueDate,
      status: row.status,
      total: row.total,
      balance: row.balance,
      daysOverdue: Number(row.daysOverdue ?? 0),
      agingBucket: row.agingBucket as ARAgingBucketKey,
      customerCompany: {
        id: row.customerCompanyId,
        name: row.customerCompanyName,
      },
      location: {
        id: row.locationId ?? null,
        companyName: row.locationCompanyName ?? null,
        location: row.locationName ?? null,
      },
      locationDisplayName: row.locationDisplayName ?? null,
    }));

    const averageDaysOutstanding = totalInvoices > 0
      ? Math.round(totalDaysOutstanding / totalInvoices)
      : 0;

    return {
      summary: {
        totalOutstanding: Math.round(totalOutstanding * 100) / 100,
        totalInvoices,
        averageDaysOutstanding,
      },
      buckets,
      invoices: processedInvoices,
    };
  }
}

export const reportsRepository = new ReportsRepository();
