/**
 * useJobsFeed — Canonical hook for the jobs feed API.
 *
 * All job list queries use the ['jobs', ...] family key prefix.
 * This enables family-wide invalidation: queryClient.invalidateQueries({ queryKey: ['jobs'] })
 *
 * Phase 4 Steps C1 + A4: Types mirror server JobFeedItem/JobHeaderDetail.
 */
import { useQuery } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Canonical types — mirror server/storage/jobsFeed.ts
// ---------------------------------------------------------------------------

/** Canonical job list item. All timestamps are ISO strings.
 * PERF-02: Fields not needed by list pages are optional (present in detail response only). */
export interface JobFeedItem {
  id: string;
  jobNumber: number;
  summary: string;
  jobType: string;
  status: string;
  openSubStatus: string | null;
  priority: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  isAllDay: boolean;
  durationMinutes: number | null;
  locationId: string;
  locationDisplayName: string | null;
  locationName: string | null;
  locationAddress: string | null;
  locationCity: string | null;
  primaryTechnicianId: string | null;
  assignedTechnicianIds: string[] | null;
  onHoldAt: string | null;
  // Fields below are only present in detail response, not in feed
  companyId?: string;
  description?: string | null;
  isActive?: boolean;
  version?: number;
  createdAt?: string;
  updatedAt?: string | null;
  holdReason?: string | null;
  holdNotes?: string | null;
  nextActionDate?: string | null;
  invoiceId?: string | null;
  closedAt?: string | null;
}

/** Canonical single-job detail header. Extends feed item with detail-only fields.
 * PERF-02: Fields removed from feed are re-declared here as required. */
export interface JobHeaderDetail extends JobFeedItem {
  // PERF-02: Fields removed from feed, required for detail
  companyId: string;
  description: string | null;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string | null;
  holdReason: string | null;
  holdNotes: string | null;
  nextActionDate: string | null;
  invoiceId: string | null;
  closedAt: string | null;
  // Detail-only fields
  accessInstructions: string | null;
  billingNotes: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  travelStartedAt: string | null;
  arrivedOnSiteAt: string | null;
  qboInvoiceId: string | null;
  recurringSeriesId: string | null;
  recurrenceTemplateId: string | null;
  recurrenceInstanceDate: string | null;
  // PM Billing Disposition fields
  pmBillingModel: string | null;
  pmBillingDisposition: string | null;
  pmBillingStatus: string | null;
  pmBillingLabel: string | null;
  deletedAt: string | null;
  previousStatus: string | null;
  closedBy: string | null;
  location: {
    id: string;
    companyName: string | null;
    location: string | null;
    address: string | null;
    address2: string | null;
    city: string | null;
    province: string | null;
    postalCode: string | null;
    parentCompanyId: string | null;
  } | null;
  parentCompany: {
    id: string;
    name: string;
  } | null;
}

// ---------------------------------------------------------------------------
// Filter params
// ---------------------------------------------------------------------------

export interface JobFeedParams {
  status?: string;
  technicianId?: string;
  search?: string;
  locationId?: string;
  scheduledDate?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  limit?: number;
  offset?: number;
  /** Hybrid search: "history" searches all job history server-side */
  searchMode?: "history";
  /** P3-05: Request true aggregate counts alongside feed data */
  includeCounts?: boolean;
}

/** P3-05: True aggregate job counts (mirrors server JobCounts) */
export interface JobCounts {
  lifecycle: {
    open: number;
    completed: number;
    invoiced: number;
    archived: number;
  };
  openSubStatus: {
    in_progress: number;
    on_route: number;
    on_hold: number;
  };
  total: number;
}

// ---------------------------------------------------------------------------
// Query key builders
// ---------------------------------------------------------------------------

/** Family key prefix for all job queries — use for family-wide invalidation. */
export const JOBS_FEED_FAMILY_KEY = ["jobs"] as const;

function buildJobsFeedKey(params: JobFeedParams): unknown[] {
  return [
    "jobs",
    "feed",
    params.status ?? null,
    params.technicianId ?? null,
    params.search ?? null,
    params.locationId ?? null,
    params.scheduledDate ?? null,
    params.sortBy ?? null,
    params.sortOrder ?? null,
    params.limit ?? null,
    params.offset ?? null,
    params.searchMode ?? null,
    params.includeCounts ?? null, // P3-05: cache isolation for counts consumers
  ];
}

function buildJobsFeedUrl(params: JobFeedParams): string {
  const sp = new URLSearchParams();
  if (params.status) sp.set("status", params.status);
  if (params.technicianId) sp.set("technicianId", params.technicianId);
  if (params.search) sp.set("search", params.search);
  if (params.locationId) sp.set("locationId", params.locationId);
  if (params.scheduledDate) sp.set("scheduledDate", params.scheduledDate);
  if (params.sortBy) sp.set("sortBy", params.sortBy);
  if (params.sortOrder) sp.set("sortOrder", params.sortOrder);
  if (params.searchMode) sp.set("searchMode", params.searchMode);
  if (params.includeCounts) sp.set("includeCounts", "true"); // P3-05
  sp.set("offset", String(params.offset ?? 0));
  sp.set("limit", String(params.limit ?? 200));
  const qs = sp.toString();
  return `/api/jobs?${qs}`;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

interface JobsFeedResponse {
  data: JobFeedItem[];
  meta: { limit: number; hasMore: boolean; nextOffset?: number };
  /** P3-05: Present only when includeCounts=true was requested */
  counts?: JobCounts;
}

/**
 * Canonical hook for fetching a list of jobs.
 * Uses ['jobs', 'feed', ...] query key for family-wide invalidation.
 *
 * P3-05: When params.includeCounts is true, response includes a `counts`
 * block with true aggregate counts (not capped by feed limit).
 */
export function useJobsFeed(
  params: JobFeedParams = {},
  options?: { enabled?: boolean }
) {
  const queryKey = buildJobsFeedKey(params);
  const url = buildJobsFeedUrl(params);

  const query = useQuery<JobsFeedResponse>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch jobs");
      return res.json();
    },
    enabled: options?.enabled ?? true,
  });

  return {
    jobs: query.data?.data ?? [],
    counts: query.data?.counts ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Canonical hook for fetching a single job's detail header.
 * Uses ['jobs', 'detail', jobId] query key.
 */
export function useJobHeader(jobId: string | undefined) {
  return useQuery<JobHeaderDetail>({
    queryKey: ["jobs", "detail", jobId],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}`, { credentials: "include" });
      if (!res.ok) {
        if (res.status === 404) throw new Error("Job not found");
        throw new Error("Failed to fetch job");
      }
      return res.json();
    },
    enabled: !!jobId,
  });
}
