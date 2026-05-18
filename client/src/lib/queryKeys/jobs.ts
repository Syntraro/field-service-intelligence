/**
 * Canonical query key definitions for job-related queries.
 *
 * Pattern B (semantic) is the primary pattern for jobs.
 * Legacy Pattern A (URL-string) keys for sub-resources are included here
 * so all consumers have a single place to import from.
 *
 * Use these constants — never inline string literals for job queries.
 */

/** Family prefix. invalidateQueries({ queryKey: jobKeys.all() }) busts
 *  every ["jobs", ...] cache entry. */
export const jobKeys = {
  /** ["jobs"] — prefix for all semantic job keys */
  all: () => ["jobs"] as const,

  /** ["jobs", "feed", ...params] — paginated/filtered job list */
  feed: (
    status?: string | null,
    technicianId?: string | null,
    search?: string | null,
    locationId?: string | null,
    scheduledDate?: string | null,
    sortBy?: string | null,
    sortOrder?: string | null,
    limit?: number | null,
    offset?: number | null,
    searchMode?: string | null,
    includeCounts?: boolean | null,
    readyToInvoiceOnly?: boolean | null,
  ) =>
    [
      "jobs",
      "feed",
      status ?? null,
      technicianId ?? null,
      search ?? null,
      locationId ?? null,
      scheduledDate ?? null,
      sortBy ?? null,
      sortOrder ?? null,
      limit ?? null,
      offset ?? null,
      searchMode ?? null,
      includeCounts ?? null,
      readyToInvoiceOnly ?? null,
    ] as const,

  /** ["jobs", "detail", id] — single job header/detail */
  detail: (id: string) => ["jobs", "detail", id] as const,

  /** ["jobs", id, "billable-preview"] — billable line preview before invoice creation */
  billablePreview: (id: string) => ["jobs", id, "billable-preview"] as const,

  // ── Legacy URL-pattern sub-resource keys (Pattern A) ──
  // These are keyed under "/api/jobs" so family invalidation via
  // jobKeys.all() ("jobs") does NOT automatically catch them.
  // Use invalidateJobSubresources() to bust them together.

  /** ["/api/jobs", id, "parts"] — job line items / parts */
  parts: (id: string) => ["/api/jobs", id, "parts"] as const,

  /** ["/api/jobs", id, "expenses"] — job expense rows */
  expenses: (id: string) => ["/api/jobs", id, "expenses"] as const,

  /** ["/api/jobs", id, "time-entries"] — labour time entries */
  timeEntries: (id: string) => ["/api/jobs", id, "time-entries"] as const,

  /** ["/api/jobs", id, "notes"] — job notes */
  notes: (id: string) => ["/api/jobs", id, "notes"] as const,

  /** ["/api/jobs", id, "equipment"] — equipment associated with job */
  equipment: (id: string) => ["/api/jobs", id, "equipment"] as const,

  /** ["/api/jobs"] — URL-pattern family prefix; prefix-matches all sub-resource keys above */
  urlFamily: () => ["/api/jobs"] as const,
};
