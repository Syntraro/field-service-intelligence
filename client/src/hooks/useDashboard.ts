/**
 * useDashboard — Canonical hooks for dashboard data.
 *
 * All dashboard queries use the ['dashboard', ...] family key prefix.
 * This enables family-wide invalidation: queryClient.invalidateQueries({ queryKey: ['dashboard'] })
 *
 * Phase 6.2 Step B2: Created as part of Canonical Hook Standardization.
 *
 * Sub-hooks:
 *   useWorkflowSummary()       — workflow strip counts
 *   useNeedsAttention(params)  — jobs needing attention (overdue, on hold, etc.)
 */
import { useQuery } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Canonical types — mirror server/storage/dashboard.ts
// ---------------------------------------------------------------------------

/** Workflow summary for the Dashboard strip. */
export interface WorkflowSummary {
  quotes: { approvedCount: number; draftCount: number };
  jobs: { requiresInvoicingCount: number; activeCount: number; onHoldCount: number };
  invoices: { outstandingCount: number; pastDueCount: number };
  fourth: null;
}

/** Dashboard job item with attention classification. */
export interface DashboardJobItem {
  id: string;
  jobNumber: number;
  summary: string;
  status: string;
  scheduledStart: string | null;
  locationName: string | null;
  locationDisplayName: string | null;
  location: {
    companyName: string | null;
    location: string | null;
  } | null;
  attentionType: "overdue" | "on_hold" | "requires_invoicing" | "other";
}

// ---------------------------------------------------------------------------
// Query key
// ---------------------------------------------------------------------------

/** Family key prefix for all dashboard queries — use for family-wide invalidation. */
export const DASHBOARD_FAMILY_KEY = ["dashboard"] as const;

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Canonical hook for the workflow summary strip.
 * Uses ['dashboard', 'workflow'] query key.
 */
export function useWorkflowSummary(options?: { enabled?: boolean; staleTime?: number }) {
  const query = useQuery<WorkflowSummary>({
    queryKey: ["dashboard", "workflow"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/workflow", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch workflow summary");
      return res.json();
    },
    staleTime: options?.staleTime ?? 60_000,
    refetchOnWindowFocus: false,
    enabled: options?.enabled ?? true,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/** Params for the needs-attention query. */
export interface NeedsAttentionParams {
  date?: string;
  limit?: number;
}

/**
 * Canonical hook for the needs-attention job list.
 * Uses ['dashboard', 'needs-attention', { date }] query key.
 */
export function useNeedsAttention(
  params?: NeedsAttentionParams,
  options?: { enabled?: boolean; staleTime?: number },
) {
  const date = params?.date ?? new Date().toISOString().slice(0, 10);
  const limit = params?.limit ?? 5;

  const query = useQuery<{ data: DashboardJobItem[] }>({
    queryKey: ["dashboard", "needs-attention", { date }],
    queryFn: async () => {
      const res = await fetch(
        `/api/dashboard/needs-attention?date=${date}&limit=${limit}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to fetch needs-attention jobs");
      return res.json();
    },
    staleTime: options?.staleTime ?? 60_000,
    refetchOnWindowFocus: false,
    enabled: options?.enabled ?? true,
  });

  return {
    jobs: query.data?.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
