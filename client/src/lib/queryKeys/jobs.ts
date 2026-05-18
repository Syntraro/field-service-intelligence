/**
 * Canonical query key definitions for job-related queries.
 *
 * All sub-resources are Pattern B (semantic): ["jobs", "detail", id, sub].
 * The ["jobs"] root prefix matches the entire job cache hierarchy.
 *
 * urlFamily() is a temporary bridge that prefix-matches all legacy
 * URL-pattern keys (["/api/jobs", ...]) until consumer migrations finish.
 *
 * Use these constants — never inline string literals for job queries.
 */

/** Family prefix. invalidateQueries({ queryKey: jobKeys.root() }) busts
 *  every ["jobs", ...] cache entry. */
export const jobKeys = {
  /** ["jobs"] — prefix for all semantic job keys */
  root: () => ["jobs"] as const,
  /** @deprecated Use root(). Kept for backward compat with existing callers. */
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

  /** ["jobs", "picker"] — job picker/search dropdown */
  picker: () => ["jobs", "picker"] as const,

  /** ["jobs", "search", params] — job search results */
  search: (params: Record<string, unknown>) =>
    ["jobs", "search", params] as const,

  /** ["jobs", "list", locationId, scope] — jobs scoped to a location */
  listForLocation: (locationId: string, scope?: string | null) =>
    ["jobs", "list", locationId, scope ?? null] as const,

  /** ["jobs", "detail", id] — single job header/detail */
  detail: (id: string) => ["jobs", "detail", id] as const,

  // ── Sub-resources under detail (canonical Pattern B) ──────────────────────

  /** ["jobs", "detail", id, "parts"] — job line items / parts */
  parts: (id: string) => ["jobs", "detail", id, "parts"] as const,

  /** ["jobs", "detail", id, "expenses"] — job expense rows */
  expenses: (id: string) => ["jobs", "detail", id, "expenses"] as const,

  /** ["jobs", "detail", id, "timeEntries"] — labour time entries */
  timeEntries: (id: string) => ["jobs", "detail", id, "timeEntries"] as const,

  /** ["jobs", "detail", id, "timeSummary"] — aggregated time summary */
  timeSummary: (id: string) => ["jobs", "detail", id, "timeSummary"] as const,

  /** ["jobs", "detail", id, "notes"] — job notes (canonical Pattern B) */
  notes: (id: string) => ["jobs", "detail", id, "notes"] as const,

  /** ["jobs", "detail", id, "equipment"] — equipment associated with job */
  equipment: (id: string) => ["jobs", "detail", id, "equipment"] as const,

  /** ["jobs", "detail", id, "billablePreview"] — billable line preview before invoice creation */
  billablePreview: (id: string) =>
    ["jobs", "detail", id, "billablePreview"] as const,

  /** ["jobs", "detail", id, "requiredSkills"] — skills required for this job */
  requiredSkills: (id: string) =>
    ["jobs", "detail", id, "requiredSkills"] as const,

  /** ["jobs", "detail", id, "statusEvents"] — job status change history */
  statusEvents: (id: string) =>
    ["jobs", "detail", id, "statusEvents"] as const,

  /** ["jobs", "detail", id, "scheduleHistory"] — job scheduling history */
  scheduleHistory: (id: string) =>
    ["jobs", "detail", id, "scheduleHistory"] as const,

  /** ["jobs", "detail", id, "assignmentRecs", date] — assignment recommendations */
  assignmentRecs: (id: string, date?: string | null) =>
    ["jobs", "detail", id, "assignmentRecs", date ?? null] as const,

  /** ["/api/jobs"] — URL-pattern family prefix; prefix-matches legacy sub-resource keys.
   *  Include in helpers until all URL-pattern consumers are migrated to Pattern B. */
  urlFamily: () => ["/api/jobs"] as const,
};
