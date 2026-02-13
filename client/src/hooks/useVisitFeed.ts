/**
 * useVisitFeed — Canonical hook for the visit feed API.
 *
 * All visit list queries use the ['visits', ...] family key prefix.
 * This enables family-wide invalidation: queryClient.invalidateQueries({ queryKey: ['visits'] })
 *
 * RBAC is server-side: technicians automatically see only their assigned visits.
 * Office users see all visits (can filter by technicianId).
 *
 * Phase 3 Step D1: Created as part of Canonical Visit Feed Migration.
 */
import { useQuery } from "@tanstack/react-query";

/** Mirrors server VisitFeedItem — all timestamps are ISO strings. */
export interface VisitFeedItem {
  id: string;
  visitNumber: number;
  jobId: string;
  companyId: string;
  status: string;
  isActive: boolean;
  isAllDay: boolean;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  assignedTechnicianId: string | null;
  assignedTechnicianIds: string[];
  visitNotes: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  actualDurationMinutes: number | null;
  estimatedDurationMinutes: number | null;
  createdAt: string;
  updatedAt: string;
  job: {
    id: string;
    jobNumber: number;
    summary: string;
    jobType: string;
    description?: string | null;
    priority?: string | null;
  };
  location: {
    id: string;
    companyName: string | null;
    location?: string | null;
    address?: string | null;
    city?: string | null;
    province?: string | null;
    postalCode?: string | null;
    phone?: string | null;
  } | null;
}

interface VisitFeedResponse {
  visits: VisitFeedItem[];
  count: number;
}

/** Filter params for the visit feed query. */
export interface VisitFeedParams {
  from?: string;
  to?: string;
  technicianId?: string;
  status?: string;
  excludeStatuses?: string[];
  unscheduled?: boolean;
  jobId?: string;
  locationId?: string;
}

/**
 * Build a stable query key from VisitFeedParams.
 * Family prefix: ['visits', ...] for family-wide invalidation.
 */
function buildVisitFeedKey(params: VisitFeedParams): unknown[] {
  return [
    "visits",
    params.from ?? null,
    params.to ?? null,
    params.technicianId ?? null,
    params.status ?? null,
    // Phase 4 pre-flight: include excludeStatuses to prevent cache collisions
    params.excludeStatuses?.length ? params.excludeStatuses.join(",") : null,
    params.unscheduled ?? null,
    params.jobId ?? null,
    params.locationId ?? null,
  ];
}

/**
 * Build the URL with query params for GET /api/visits.
 */
function buildVisitFeedUrl(params: VisitFeedParams): string {
  const searchParams = new URLSearchParams();
  if (params.from) searchParams.set("from", params.from);
  if (params.to) searchParams.set("to", params.to);
  if (params.technicianId) searchParams.set("technicianId", params.technicianId);
  if (params.status) searchParams.set("status", params.status);
  if (params.excludeStatuses?.length) {
    searchParams.set("excludeStatuses", params.excludeStatuses.join(","));
  }
  if (params.unscheduled) searchParams.set("unscheduled", "true");
  if (params.jobId) searchParams.set("jobId", params.jobId);
  if (params.locationId) searchParams.set("locationId", params.locationId);

  const qs = searchParams.toString();
  return qs ? `/api/visits?${qs}` : "/api/visits";
}

/**
 * Hook to fetch visits from the canonical visit feed.
 *
 * @param params - Filter params (dates, technician, status, etc.)
 * @param options - Additional query options (enabled, refetchInterval, etc.)
 */
export function useVisitFeed(
  params: VisitFeedParams,
  options?: { enabled?: boolean; refetchInterval?: number }
) {
  const queryKey = buildVisitFeedKey(params);
  const url = buildVisitFeedUrl(params);

  const query = useQuery<VisitFeedResponse>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch visits");
      return res.json();
    },
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval,
  });

  return {
    visits: query.data?.visits ?? [],
    count: query.data?.count ?? 0,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

/** Re-export the family key prefix for invalidation helpers. */
export const VISIT_FEED_FAMILY_KEY = ["visits"] as const;
