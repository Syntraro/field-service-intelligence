import { db } from "../db";
import { eq, and, sql, inArray, gt } from "drizzle-orm";
import { invoices, clientLocations, customerCompanies } from "@shared/schema";
import { BaseRepository } from "./base";

export interface ARAgingInvoice {
  id: string;
  invoiceNumber: string | null;
  issueDate: string;
  dueDate: string | null;
  status: string;
  total: string;
  balance: string;
  daysOverdue: number;
  agingBucket: "0-30" | "31-60" | "61-90" | "90+";
  customerCompany: {
    id: string | null;
    name: string | null;
  };
  location: {
    id: string;
    companyName: string;
    location: string | null;
  };
}

export interface ARAgingBucket {
  bucket: "0-30" | "31-60" | "61-90" | "90+";
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

export class ReportsRepository extends BaseRepository {
  /**
   * Get AR Aging report data
   * Includes invoices with status 'sent' or 'partial_paid' and balance > 0
   * Computes aging buckets based on due date (or issue date if no due date)
   */
  async getARAgingReport(companyId: string): Promise<ARAgingReport> {
    this.assertCompanyId(companyId);

    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];

    // Single query with JOIN to avoid N+1 - fetch invoices with location and customer company
    const rows = await db
      .select({
        // Invoice fields
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        issueDate: invoices.issueDate,
        dueDate: invoices.dueDate,
        status: invoices.status,
        total: invoices.total,
        balance: invoices.balance,
        // Location fields
        locationId: clientLocations.id,
        locationCompanyName: clientLocations.companyName,
        locationName: clientLocations.location,
        // Customer company fields
        customerCompanyId: customerCompanies.id,
        customerCompanyName: customerCompanies.name,
      })
      .from(invoices)
      .innerJoin(clientLocations, eq(invoices.locationId, clientLocations.id))
      .leftJoin(customerCompanies, eq(invoices.customerCompanyId, customerCompanies.id))
      .where(
        and(
          eq(invoices.companyId, companyId),
          eq(invoices.isActive, true),
          inArray(invoices.status, ["sent", "partial_paid"]),
          gt(sql`CAST(${invoices.balance} AS DECIMAL)`, 0)
        )
      );

    // Process rows to compute aging
    const processedInvoices: ARAgingInvoice[] = [];
    const bucketTotals: Record<string, { count: number; total: number }> = {
      "0-30": { count: 0, total: 0 },
      "31-60": { count: 0, total: 0 },
      "61-90": { count: 0, total: 0 },
      "90+": { count: 0, total: 0 },
    };

    let totalBalance = 0;
    let totalDaysOutstanding = 0;

    for (const row of rows) {
      // Use dueDate if available, otherwise issueDate
      const referenceDate = row.dueDate || row.issueDate;
      const refDateObj = new Date(referenceDate);
      const daysOverdue = Math.floor(
        (today.getTime() - refDateObj.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Determine aging bucket
      let agingBucket: "0-30" | "31-60" | "61-90" | "90+";
      if (daysOverdue <= 30) {
        agingBucket = "0-30";
      } else if (daysOverdue <= 60) {
        agingBucket = "31-60";
      } else if (daysOverdue <= 90) {
        agingBucket = "61-90";
      } else {
        agingBucket = "90+";
      }

      const balanceNum = parseFloat(row.balance || "0");
      totalBalance += balanceNum;
      totalDaysOutstanding += Math.max(0, daysOverdue);

      bucketTotals[agingBucket].count++;
      bucketTotals[agingBucket].total += balanceNum;

      processedInvoices.push({
        id: row.id,
        invoiceNumber: row.invoiceNumber,
        issueDate: row.issueDate,
        dueDate: row.dueDate,
        status: row.status,
        total: row.total,
        balance: row.balance,
        daysOverdue: Math.max(0, daysOverdue),
        agingBucket,
        customerCompany: {
          id: row.customerCompanyId,
          name: row.customerCompanyName,
        },
        location: {
          id: row.locationId,
          companyName: row.locationCompanyName,
          location: row.locationName,
        },
      });
    }

    // Sort invoices by days overdue (most overdue first)
    processedInvoices.sort((a, b) => b.daysOverdue - a.daysOverdue);

    // Build bucket summaries
    const buckets: ARAgingBucket[] = [
      { bucket: "0-30", count: bucketTotals["0-30"].count, totalBalance: bucketTotals["0-30"].total },
      { bucket: "31-60", count: bucketTotals["31-60"].count, totalBalance: bucketTotals["31-60"].total },
      { bucket: "61-90", count: bucketTotals["61-90"].count, totalBalance: bucketTotals["61-90"].total },
      { bucket: "90+", count: bucketTotals["90+"].count, totalBalance: bucketTotals["90+"].total },
    ];

    const avgDaysOutstanding =
      processedInvoices.length > 0
        ? Math.round(totalDaysOutstanding / processedInvoices.length)
        : 0;

    return {
      summary: {
        totalOutstanding: Math.round(totalBalance * 100) / 100,
        totalInvoices: processedInvoices.length,
        averageDaysOutstanding: avgDaysOutstanding,
      },
      buckets,
      invoices: processedInvoices,
    };
  }
}

export const reportsRepository = new ReportsRepository();
