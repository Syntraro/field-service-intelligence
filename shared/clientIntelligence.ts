/**
 * Shared ClientIntelligenceData type — consumed by both the server storage
 * function and the frontend components.
 *
 * Kept in shared/ so the frontend does not need to import from server/.
 */

export interface ClientIntelligenceData {
  // KPI Strip
  avgDaysToPay: number | null;
  companyAvgDaysToPay: number | null;
  outstandingBalance: number;
  outstandingInvoiceCount: number;
  lifetimeRevenue: number;
  customerSinceDate: string | null;
  lifetimeGrossMarginPct: number | null;
  lifetimeGrossProfit: number | null;
  quotesApproved: number;
  quotesTotalRated: number;
  quoteApprovalRate: number | null;
  lastServiceDate: string | null;
  lastServiceDaysAgo: number | null;
  maintenancePlanActive: boolean;
  maintenancePlanCount: number;

  // Client Health
  totalJobs: number;
  totalInvoices: number;
  lastJobDate: string | null;
  lastInvoiceDate: string | null;
  avgServiceFrequencyMonths: number | null;
  avgJobValue: number | null;

  // Financial Performance
  last30Days: {
    grossRevenue: number;
    invoiceCount: number;
    avgInvoiceValue: number | null;
    grossMarginPct: number | null;
  };
  last12Months: {
    grossRevenue: number;
    invoiceCount: number;
    avgInvoiceValue: number | null;
    grossMarginPct: number | null;
    prev12GrossRevenue: number;
  };
  revenueTrend: { month: string; gross: number }[];

  // Payment Behavior
  pctInvoicesOverdue: number | null;
  largestOverdueAmount: number | null;
  paymentTrend: { month: string; avgDays: number }[];

  // Revenue Categories
  revenueByCategory: { category: string; amount: number; pct: number }[];

  // At A Glance
  mostCommonJobType: string | null;
  totalEquipment: number;
  openQuotesValue: number;
  workCompletionPct: number | null;
}
