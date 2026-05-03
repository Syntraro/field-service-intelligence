/**
 * Reports — tenant-isolation regression coverage.
 *
 * Closes the test gap identified in the launch-readiness audit:
 * every report aggregator filters by `companyId` correctly, but no
 * test locked that invariant at runtime. A future helper edit could
 * silently drop a `where` predicate in a join branch and ship
 * undetected.
 *
 * Strategy — execution-level, two complementary layers:
 *
 *   Layer 1 — BOGUS-TENANT NEGATIVE TEST. Every aggregator runs with a
 *   well-formed UUID that no real tenant owns. The expected output:
 *   every metric flips `hasData=false`, every collection (`items` /
 *   `points` / `buckets`) is empty or all-zero. If a filter is
 *   missing, the aggregator would surface real data and this test
 *   fails loudly.
 *
 *   Layer 2 — REAL-TENANT ID-OWNERSHIP TEST. Pick the first tenant in
 *   the DB; run every ID-returning aggregator with that tenant's id;
 *   for each entity id surfaced in the response, verify the entity's
 *   row in the database has the requested `companyId`. Catches the
 *   subtler case where the filter exists but a join leaks foreign
 *   rows.
 *
 * Heavy fixture seeding is intentionally NOT used. The dev DB
 * already carries multi-tenant data; the negative test catches
 * filter-missing regressions, and the ownership test catches join-
 * leak regressions. If the DB has zero tenants the ownership tier
 * skips (but the bogus-tenant tier still runs).
 *
 * No business calculations changed. No new SQL. The only purpose of
 * this file is to detect cross-tenant leakage in future edits.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";

import { db } from "../server/db";
import {
  companies,
  invoices,
  jobs,
  jobVisits,
  clientLocations,
  users,
  items,
  payments,
} from "@shared/schema";

import { getCompanySnapshot } from "../server/storage/reportsSnapshot";
import { getCompanyFinancial } from "../server/storage/reportsFinancial";
import { getCompanyOperations } from "../server/storage/reportsOperations";
import { getCompanySales } from "../server/storage/reportsSales";
import { getCompanyAR } from "../server/storage/reportsAR";
import { getCompanyRevenue } from "../server/storage/reportsRevenue";
import { getCompanyJobs } from "../server/storage/reportsJobs";
import { getCompanySalesFunnel } from "../server/storage/reportsSalesFunnel";
import { getCompanyTeam } from "../server/storage/reportsTeam";
import { getCompanyPartsForecast } from "../server/storage/reportsPartsForecast";

import type { MetricCard } from "@shared/reports/snapshot";

// ---------------------------------------------------------------------------
// Test fixtures — kept minimal: a bogus UUID for the negative tier and the
// first real tenant from the DB for the ownership tier. No row insertions.
// ---------------------------------------------------------------------------

const BOGUS_TENANT_ID = "00000000-0000-0000-0000-000000000000";

let realTenantId: string | null = null;

beforeAll(async () => {
  const rows = await db
    .select({ id: companies.id })
    .from(companies)
    .limit(1);
  realTenantId = rows[0]?.id ?? null;
});

// ---------------------------------------------------------------------------
// Helper: assert every metric in an array has hasData=false. Used by the
// bogus-tenant tier to verify the metrics correctly degrade under "no data".
// ---------------------------------------------------------------------------

function expectAllMetricsEmpty(metrics: MetricCard[], label: string): void {
  for (const m of metrics) {
    expect(
      m.hasData,
      `${label}: metric '${m.key}' should have hasData=false for bogus tenant`,
    ).toBe(false);
  }
}

// ---------------------------------------------------------------------------
// Helper: lookup an entity by id and assert its companyId matches expected.
// Returns silently if the row does not exist (entity may have been deleted
// between the aggregator call and this verification — not a failure).
// ---------------------------------------------------------------------------

async function expectEntityCompanyId(
  table: typeof clientLocations | typeof jobs | typeof jobVisits | typeof users | typeof items | typeof invoices,
  id: string,
  expectedCompanyId: string,
  label: string,
): Promise<void> {
  // @ts-expect-error — drizzle column inference across heterogeneous tables
  const rows = await db.select({ companyId: table.companyId }).from(table).where(eq(table.id, id)).limit(1);
  if (rows.length === 0) return;
  expect(
    rows[0].companyId,
    `${label}: entity ${id} belongs to ${rows[0].companyId}, expected ${expectedCompanyId}`,
  ).toBe(expectedCompanyId);
}

/** Payments don't carry a `companyId` column — they're scoped via the
 *  invoice they pay. Two-step lookup: payment → invoice.companyId. */
async function expectPaymentCompanyId(
  paymentId: string,
  expectedCompanyId: string,
  label: string,
): Promise<void> {
  const paymentRows = await db
    .select({ invoiceId: payments.invoiceId })
    .from(payments)
    .where(eq(payments.id, paymentId))
    .limit(1);
  if (paymentRows.length === 0) return;
  const invoiceId = paymentRows[0].invoiceId;
  if (!invoiceId) return;
  const invRows = await db
    .select({ companyId: invoices.companyId })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (invRows.length === 0) return;
  expect(
    invRows[0].companyId,
    `${label}: payment ${paymentId} belongs to invoice ${invoiceId} of company ${invRows[0].companyId}, expected ${expectedCompanyId}`,
  ).toBe(expectedCompanyId);
}

// ---------------------------------------------------------------------------
// LAYER 1 — BOGUS-TENANT NEGATIVE TEST
// ---------------------------------------------------------------------------

describe("Reports tenant isolation — bogus tenant returns zero data", () => {
  it("getCompanySnapshot — every metric hasData=false; every AR bucket zero", async () => {
    const snap = await getCompanySnapshot(BOGUS_TENANT_ID, "last_30_days");
    expectAllMetricsEmpty(snap.revenueCashFlow.metrics, "snapshot.revenueCashFlow");
    expectAllMetricsEmpty(snap.jobsOperations.metrics, "snapshot.jobsOperations");
    expectAllMetricsEmpty(snap.sales.metrics, "snapshot.sales");
    for (const b of snap.accountsReceivable.buckets) {
      expect(b.amount, `bucket ${b.key} amount`).toBe(0);
      expect(b.invoiceCount, `bucket ${b.key} count`).toBe(0);
    }
  });

  it("getCompanyFinancial — every section empty / hasData=false", async () => {
    const fin = await getCompanyFinancial(BOGUS_TENANT_ID, "last_30_days");
    expectAllMetricsEmpty(fin.kpis.metrics, "financial.kpis");
    expect(fin.revenueTrend.points).toEqual([]);
    expect(fin.revenueTrend.hasData).toBe(false);
    expect(fin.paymentBreakdown.items).toEqual([]);
    expect(fin.paymentBreakdown.hasData).toBe(false);
    expect(fin.topOutstandingClients.items).toEqual([]);
    expect(fin.topOutstandingClients.hasData).toBe(false);
    for (const b of fin.arAging.buckets) {
      expect(b.amount).toBe(0);
      expect(b.invoiceCount).toBe(0);
    }
    for (const s of fin.invoiceStatus.items) {
      expect(s.count).toBe(0);
    }
  });

  it("getCompanyOperations — every section empty / hasData=false", async () => {
    const ops = await getCompanyOperations(BOGUS_TENANT_ID, "last_30_days");
    expectAllMetricsEmpty(ops.kpis.metrics, "operations.kpis");
    expect(ops.completionTrend.points).toEqual([]);
    expect(ops.completionTrend.hasData).toBe(false);
    for (const s of ops.jobStatus.items) {
      expect(s.count).toBe(0);
    }
    expect(ops.avgJobValueTrend.points).toEqual([]);
    expect(ops.avgJobValueTrend.hasData).toBe(false);
    expect(ops.unbillableBreakdown.items).toEqual([]);
    expect(ops.unbillableBreakdown.hasData).toBe(false);
  });

  it("getCompanySales — every section empty / hasData=false", async () => {
    const sales = await getCompanySales(BOGUS_TENANT_ID, "last_30_days");
    expectAllMetricsEmpty(sales.kpis.metrics, "sales.kpis");
    expect(sales.leadCreationTrend.points).toEqual([]);
    expect(sales.leadConversionTrend.points).toEqual([]);
    expect(sales.quoteCreationTrend.points).toEqual([]);
    expect(sales.quoteConversionTrend.points).toEqual([]);
    for (const item of sales.leadStatusBreakdown.items) {
      expect(item.count).toBe(0);
    }
    for (const item of sales.quoteStatusBreakdown.items) {
      expect(item.count).toBe(0);
    }
  });

  it("getCompanyAR — every section empty / hasData=false", async () => {
    const ar = await getCompanyAR(BOGUS_TENANT_ID, "last_30_days");
    expectAllMetricsEmpty(ar.kpis.metrics, "ar.kpis");
    for (const b of ar.aging.buckets) {
      expect(b.amount).toBe(0);
      expect(b.invoiceCount).toBe(0);
    }
    expect(ar.overdueInvoices.items).toEqual([]);
    expect(ar.overdueInvoices.hasData).toBe(false);
    expect(ar.topOutstandingClients.items).toEqual([]);
    expect(ar.paymentTimeTrend.points).toEqual([]);
  });

  it("getCompanyRevenue — every section empty / hasData=false", async () => {
    const rev = await getCompanyRevenue(BOGUS_TENANT_ID, "last_30_days");
    expectAllMetricsEmpty(rev.kpis.metrics, "revenue.kpis");
    expect(rev.revenueTrend.points).toEqual([]);
    // Revenue contract calls this section `paymentMethods` (the
    // Financial tab calls the same shape `paymentBreakdown` — the
    // contract field name is what we assert against here).
    expect(rev.paymentMethods.items).toEqual([]);
    expect(rev.revenueByClient.items).toEqual([]);
    expect(rev.recentPayments.items).toEqual([]);
    // monthComparison carries the two calendar-month totals — both
    // must be zero for a bogus tenant.
    expect(rev.monthComparison.currentMonthRevenue).toBe(0);
    expect(rev.monthComparison.previousMonthRevenue).toBe(0);
  });

  it("getCompanyJobs — every section empty / hasData=false", async () => {
    const j = await getCompanyJobs(BOGUS_TENANT_ID, "last_30_days");
    expectAllMetricsEmpty(j.kpis.metrics, "jobs.kpis");
    expect(j.completionTrend.points).toEqual([]);
    for (const s of j.jobStatus.items) {
      expect(s.count).toBe(0);
    }
    expect(j.avgJobValueTrend.points).toEqual([]);
    expect(j.unbillableBreakdown.items).toEqual([]);
    expect(j.completedJobs.items).toEqual([]);
    expect(j.completedJobs.hasData).toBe(false);
  });

  it("getCompanySalesFunnel — every section empty / hasData=false", async () => {
    const f = await getCompanySalesFunnel(BOGUS_TENANT_ID, "last_30_days");
    expectAllMetricsEmpty(f.kpis.metrics, "salesFunnel.kpis");
    for (const stage of f.funnel.stages) {
      expect(stage.count).toBe(0);
    }
    expect(f.funnel.hasData).toBe(false);
    expect(f.leadCreationTrend.points).toEqual([]);
    expect(f.quoteCreationTrend.points).toEqual([]);
    expect(f.conversionLag.leads.count).toBe(0);
    expect(f.conversionLag.quotes.count).toBe(0);
    expect(f.conversionLag.hasData).toBe(false);
  });

  it("getCompanyTeam — every section empty / hasData=false", async () => {
    const t = await getCompanyTeam(BOGUS_TENANT_ID, "last_30_days");
    expectAllMetricsEmpty(t.kpis.metrics, "team.kpis");
    expect(t.hoursByUser.items).toEqual([]);
    expect(t.hoursByUser.hasData).toBe(false);
    expect(t.unbillableByUser.items).toEqual([]);
    expect(t.jobsByUser.items).toEqual([]);
    expect(t.timeDistribution.totalHours).toBe(0);
    expect(t.timeDistribution.hasData).toBe(false);
  });

  it("getCompanyPartsForecast — every section empty / hasData=false", async () => {
    const pf = await getCompanyPartsForecast(BOGUS_TENANT_ID, "next_30_days");
    expect(pf.kpis.totalPartsRequired).toBe(0);
    expect(pf.kpis.uniquePartTypes).toBe(0);
    expect(pf.kpis.locationsRequiringParts).toBe(0);
    expect(pf.kpis.pmVisitsRequiringParts).toBe(0);
    expect(pf.kpis.hasData).toBe(false);
    expect(pf.partsNeeded.items).toEqual([]);
    expect(pf.partsByLocation.items).toEqual([]);
    expect(pf.missingPartsData.items).toEqual([]);
    expect(pf.orderingList.items).toEqual([]);
    // partsByTechnician is structurally inert for ALL tenants — confirm.
    expect(pf.partsByTechnician.hasData).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LAYER 2 — REAL-TENANT ID-OWNERSHIP TEST
// ---------------------------------------------------------------------------
//
// For each aggregator that surfaces entity IDs in its response, verify that
// every returned ID belongs to the requested tenant. This catches join-leak
// regressions that the bogus-tenant test cannot reach (because the bogus
// tenant simply has no rows on either side of the join).

describe("Reports tenant isolation — real-tenant entity IDs are owned by requested tenant", () => {
  it("skip-or-run guard — real tenant must exist in the DB", () => {
    if (!realTenantId) {
      console.warn(
        "[reports-tenant-isolation] no companies in DB — ownership tier skipped",
      );
    }
    // No assertion fails when realTenantId is null — the per-aggregator
    // tests below short-circuit gracefully.
    expect(true).toBe(true);
  });

  it("Financial.topOutstandingClients[*].clientId belongs to tenant", async () => {
    if (!realTenantId) return;
    const fin = await getCompanyFinancial(realTenantId, "last_30_days");
    for (const row of fin.topOutstandingClients.items) {
      await expectEntityCompanyId(
        clientLocations,
        row.clientId,
        realTenantId,
        "Financial.topOutstandingClients",
      );
    }
  });

  it("AR.overdueInvoices[*].invoiceId + .clientId belong to tenant", async () => {
    if (!realTenantId) return;
    const ar = await getCompanyAR(realTenantId, "last_30_days");
    for (const row of ar.overdueInvoices.items) {
      await expectEntityCompanyId(
        invoices,
        row.invoiceId,
        realTenantId,
        "AR.overdueInvoices.invoiceId",
      );
      if (row.clientId) {
        await expectEntityCompanyId(
          clientLocations,
          row.clientId,
          realTenantId,
          "AR.overdueInvoices.clientId",
        );
      }
    }
    for (const row of ar.topOutstandingClients.items) {
      await expectEntityCompanyId(
        clientLocations,
        row.clientId,
        realTenantId,
        "AR.topOutstandingClients",
      );
    }
  });

  it("Revenue.recentPayments[*].id, invoiceId, clientId belong to tenant", async () => {
    if (!realTenantId) return;
    const rev = await getCompanyRevenue(realTenantId, "last_30_days");
    for (const row of rev.recentPayments.items) {
      await expectPaymentCompanyId(
        row.id,
        realTenantId,
        "Revenue.recentPayments.id",
      );
      await expectEntityCompanyId(
        invoices,
        row.invoiceId,
        realTenantId,
        "Revenue.recentPayments.invoiceId",
      );
      await expectEntityCompanyId(
        clientLocations,
        row.clientId,
        realTenantId,
        "Revenue.recentPayments.clientId",
      );
    }
    for (const row of rev.revenueByClient.items) {
      await expectEntityCompanyId(
        clientLocations,
        row.clientId,
        realTenantId,
        "Revenue.revenueByClient",
      );
    }
  });

  it("Jobs.completedJobs[*].jobId belongs to tenant", async () => {
    if (!realTenantId) return;
    const j = await getCompanyJobs(realTenantId, "last_30_days");
    for (const row of j.completedJobs.items) {
      await expectEntityCompanyId(
        jobs,
        row.jobId,
        realTenantId,
        "Jobs.completedJobs",
      );
    }
  });

  it("Team.hoursByUser/unbillableByUser/jobsByUser[*].userId belongs to tenant", async () => {
    if (!realTenantId) return;
    const t = await getCompanyTeam(realTenantId, "last_30_days");
    for (const row of t.hoursByUser.items) {
      await expectEntityCompanyId(
        users,
        row.userId,
        realTenantId,
        "Team.hoursByUser",
      );
    }
    for (const row of t.unbillableByUser.items) {
      await expectEntityCompanyId(
        users,
        row.userId,
        realTenantId,
        "Team.unbillableByUser",
      );
    }
    for (const row of t.jobsByUser.items) {
      await expectEntityCompanyId(
        users,
        row.userId,
        realTenantId,
        "Team.jobsByUser",
      );
    }
  });

  it("PartsForecast.partsByLocation/missingPartsData IDs belong to tenant", async () => {
    if (!realTenantId) return;
    const pf = await getCompanyPartsForecast(realTenantId, "next_30_days");
    for (const visit of pf.partsByLocation.items) {
      await expectEntityCompanyId(
        jobVisits,
        visit.visitId,
        realTenantId,
        "PartsForecast.partsByLocation.visitId",
      );
      await expectEntityCompanyId(
        jobs,
        visit.jobId,
        realTenantId,
        "PartsForecast.partsByLocation.jobId",
      );
      await expectEntityCompanyId(
        clientLocations,
        visit.locationId,
        realTenantId,
        "PartsForecast.partsByLocation.locationId",
      );
      for (const part of visit.parts) {
        await expectEntityCompanyId(
          items,
          part.productId,
          realTenantId,
          "PartsForecast.partsByLocation.parts.productId",
        );
      }
    }
    for (const row of pf.missingPartsData.items) {
      await expectEntityCompanyId(
        jobVisits,
        row.visitId,
        realTenantId,
        "PartsForecast.missingPartsData.visitId",
      );
      await expectEntityCompanyId(
        jobs,
        row.jobId,
        realTenantId,
        "PartsForecast.missingPartsData.jobId",
      );
      await expectEntityCompanyId(
        clientLocations,
        row.locationId,
        realTenantId,
        "PartsForecast.missingPartsData.locationId",
      );
    }
    for (const row of pf.partsNeeded.items) {
      await expectEntityCompanyId(
        items,
        row.productId,
        realTenantId,
        "PartsForecast.partsNeeded.productId",
      );
    }
    for (const row of pf.orderingList.items) {
      await expectEntityCompanyId(
        items,
        row.productId,
        realTenantId,
        "PartsForecast.orderingList.productId",
      );
    }
  });
});
