/**
 * Canonical query key definitions for lead-related queries.
 *
 * Leads use Pattern B for the detail query and Pattern A for the
 * visits sub-resource. Family invalidation via leadKeys.all()
 * does NOT catch the URL-pattern visits key — use
 * invalidateLeadVisits() explicitly when mutations affect visits.
 */

export const leadKeys = {
  /** ["leads"] — semantic family prefix */
  all: () => ["leads"] as const,

  /** ["leads", "detail", id] — single lead detail */
  detail: (id: string) => ["leads", "detail", id] as const,

  /**
   * ["/api/leads", id, "visits"] — lead visit list (Pattern A / URL-pattern).
   * NOT caught by leadKeys.all() prefix-matching; must be invalidated separately
   * when a mutation creates, cancels, or reschedules a lead visit.
   */
  visits: (id: string) => ["/api/leads", id, "visits"] as const,
};
