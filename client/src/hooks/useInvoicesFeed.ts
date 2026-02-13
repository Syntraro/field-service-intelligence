/**
 * useInvoicesFeed — Canonical hooks for invoice data.
 *
 * All invoice queries use the ['invoices', ...] family key prefix.
 * This enables family-wide invalidation: queryClient.invalidateQueries({ queryKey: ['invoices'] })
 *
 * Phase 6.2 Step A1: Created as part of Canonical Hook Standardization.
 *
 * Sub-hooks:
 *   useInvoicesFeed(params)    — paginated invoice list
 *   useInvoiceStats()          — aggregated stats by status
 *   useInvoiceByJob(jobId)     — single invoice linked to a job
 *   useDashboardInvoices()     — dashboard widget preset (unpaid, past-due first)
 */
import { useQuery } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Canonical types — mirror server/storage/invoicesFeed.ts
// ---------------------------------------------------------------------------

/** Canonical invoice feed item. All timestamps are ISO strings. */
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

// ---------------------------------------------------------------------------
// Stats types
// ---------------------------------------------------------------------------

/** Raw bucket from GET /api/invoices/stats (server returns byStatus array). */
interface InvoiceStatsBucket {
  status: string;
  count: number;
  totalAmount: number;
}

/** Computed aggregates from the raw byStatus array. */
export interface InvoiceStats {
  outstanding: { amount: number; count: number };
  overdue: { amount: number; count: number };
  byStatus: InvoiceStatsBucket[];
}

const UNPAID_STATUSES = ["awaiting_payment", "sent", "partial_paid"];

/** Compute useful aggregates from the raw byStatus array. */
function computeStats(raw: InvoiceStatsBucket[]): InvoiceStats {
  let outstandingAmount = 0;
  let outstandingCount = 0;

  for (const bucket of raw) {
    if (UNPAID_STATUSES.includes(bucket.status)) {
      outstandingAmount += bucket.totalAmount;
      outstandingCount += bucket.count;
    }
  }

  // Overdue requires per-invoice dueDate comparison — not available from
  // the byStatus aggregate. Stays 0 until the server endpoint is enhanced.
  return {
    outstanding: { amount: outstandingAmount, count: outstandingCount },
    overdue: { amount: 0, count: 0 },
    byStatus: raw,
  };
}

// ---------------------------------------------------------------------------
// Filter params
// ---------------------------------------------------------------------------

export interface InvoiceFeedParams {
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Query key builders
// ---------------------------------------------------------------------------

/** Family key prefix for all invoice queries — use for family-wide invalidation. */
export const INVOICES_FEED_FAMILY_KEY = ["invoices"] as const;

function buildInvoiceFeedKey(params: InvoiceFeedParams): unknown[] {
  return ["invoices", "feed", { offset: params.offset ?? 0, limit: params.limit ?? 200 }];
}

function buildInvoiceFeedUrl(params: InvoiceFeedParams): string {
  return `/api/invoices/list?offset=${params.offset ?? 0}&limit=${params.limit ?? 200}`;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

interface InvoiceFeedResponse {
  data: InvoiceFeedItem[];
  meta: { limit: number; hasMore: boolean; nextOffset?: number };
}

/**
 * Canonical hook for fetching a paginated list of invoices.
 * Uses ['invoices', 'feed', ...] query key for family-wide invalidation.
 */
export function useInvoicesFeed(
  params: InvoiceFeedParams = {},
  options?: { enabled?: boolean },
) {
  const queryKey = buildInvoiceFeedKey(params);
  const url = buildInvoiceFeedUrl(params);

  const query = useQuery<InvoiceFeedResponse, Error, InvoiceFeedItem[]>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch invoices");
      return res.json();
    },
    select: (response) => response.data,
    enabled: options?.enabled ?? true,
  });

  return {
    invoices: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Canonical hook for fetching aggregated invoice stats.
 * Uses ['invoices', 'stats'] query key.
 *
 * Bug fix: InvoicesListPage previously had no queryFn — stats never loaded.
 * This hook provides the correct queryFn and type.
 */
export function useInvoiceStats(options?: { enabled?: boolean }) {
  const query = useQuery<InvoiceStatsBucket[], Error, InvoiceStats>({
    queryKey: ["invoices", "stats"],
    queryFn: async () => {
      const res = await fetch("/api/invoices/stats", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch invoice stats");
      return res.json();
    },
    select: computeStats,
    staleTime: 30_000,
    enabled: options?.enabled ?? true,
  });

  return {
    stats: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
  };
}

/**
 * Canonical hook for fetching the invoice linked to a job.
 * Uses ['invoices', 'by-job', jobId] query key.
 * Returns null if the job has no invoice.
 */
export function useInvoiceByJob(jobId: string | undefined) {
  return useQuery<InvoiceFeedItem | null>({
    queryKey: ["invoices", "by-job", jobId],
    queryFn: async () => {
      const res = await fetch(`/api/invoices/by-job/${jobId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!jobId,
  });
}

/**
 * Canonical hook for the dashboard invoice widget.
 * Uses ['invoices', 'dashboard'] query key.
 * Returns up to 10 unpaid invoices, past-due first.
 */
export function useDashboardInvoices(options?: { enabled?: boolean }) {
  const query = useQuery<{ data: InvoiceFeedItem[] }>({
    queryKey: ["invoices", "dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/invoices/dashboard", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch dashboard invoices");
      return res.json();
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    enabled: options?.enabled ?? true,
  });

  return {
    invoices: query.data?.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
