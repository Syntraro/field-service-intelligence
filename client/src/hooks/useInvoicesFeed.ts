/**
 * Canonical Invoice Feed Hooks — Phase 5 Part A (Steps A6-A7)
 *
 * Client-side hooks for the canonical invoice query family.
 * Family prefix: ['invoices']
 *
 * Hooks:
 *   useInvoicesFeed(filters)  → ['invoices', 'feed', ...]
 *   useInvoiceStats()         → ['invoices', 'stats']
 */

import { useQuery } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types (mirror server/storage/invoicesFeed.ts)
// ---------------------------------------------------------------------------

export interface InvoiceFeedFilters {
  status?: string;
  statuses?: string[];
  excludeStatuses?: string[];
  jobId?: string;
  locationId?: string;
  customerCompanyId?: string;
  unpaidOnly?: boolean;
  overdue?: boolean;
  search?: string;
  dateRange?: { start: string; end: string };
  qboSyncStatus?: string;
  qboOutOfSync?: boolean;
  limit?: number;
  offset?: number;
  sortBy?: "createdAt" | "dueDate" | "issueDate" | "total" | "balance" | "invoiceNumber";
  sortOrder?: "asc" | "desc";
}

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
  locationDisplayName: string | null;
  locationName: string | null;
  isPastDue: boolean;
  qboInvoiceId: string | null;
  qboSyncStatus: string | null;
  qboOutOfSync: boolean | null;
  discountType: string | null;
  discountPercent: string | null;
  discountAmount: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  isActive: boolean | null;
  version: number;
  createdAt: string;
  updatedAt: string | null;
}

export interface InvoiceStatsResult {
  byStatus: Array<{ status: string; count: number; totalAmount: number }>;
  outstandingCount: number;
  overdueCount: number;
  draftCount: number;
  totalOutstanding: number;
}

/** Family key for all invoice queries — use for invalidation. */
export const INVOICES_FEED_FAMILY_KEY = ["invoices"] as const;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildInvoicesFeedKey(filters: InvoiceFeedFilters) {
  return [
    "invoices",
    "feed",
    filters.status ?? null,
    filters.statuses?.join(",") ?? null,
    filters.jobId ?? null,
    filters.locationId ?? null,
    filters.unpaidOnly ?? null,
    filters.overdue ?? null,
    filters.search ?? null,
    filters.limit ?? null,
    filters.offset ?? null,
    filters.sortBy ?? null,
    filters.sortOrder ?? null,
  ];
}

function buildInvoicesFeedUrl(filters: InvoiceFeedFilters): string {
  const params = new URLSearchParams();
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.offset) params.set("offset", String(filters.offset));
  return `/api/invoices/list?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useInvoicesFeed(
  filters: InvoiceFeedFilters = {},
  options: { enabled?: boolean } = {}
) {
  const { enabled = true } = options;

  return useQuery<{ data: InvoiceFeedItem[]; pagination?: any }>({
    queryKey: buildInvoicesFeedKey(filters),
    queryFn: async () => {
      const url = buildInvoicesFeedUrl(filters);
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch invoices");
      return res.json();
    },
    enabled,
    staleTime: 30_000,
  });
}

export function useInvoiceStats(options: { enabled?: boolean } = {}) {
  const { enabled = true } = options;

  return useQuery<InvoiceStatsResult>({
    queryKey: ["invoices", "stats"],
    queryFn: async () => {
      const res = await fetch("/api/invoices/stats", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch invoice stats");
      return res.json();
    },
    enabled,
    staleTime: 30_000,
  });
}
