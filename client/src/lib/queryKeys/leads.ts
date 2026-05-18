/**
 * Canonical query key definitions for lead-related queries.
 *
 * All keys use Pattern B (semantic arrays). The ["leads"] root prefix
 * matches the entire leads cache hierarchy including visits and notes.
 *
 * Use these constants — never inline string literals for lead queries.
 */

export const leadKeys = {
  /** ["leads"] — prefix for all semantic lead keys */
  root: () => ["leads"] as const,

  /** ["leads", "list", filter] — lead list with optional filter */
  list: (filter?: Record<string, unknown>) =>
    ["leads", "list", filter ?? null] as const,

  /** ["leads", "detail", id] — single lead detail */
  detail: (id: string) => ["leads", "detail", id] as const,

  /** ["leads", "detail", id, "notes"] — notes for a lead */
  notes: (id: string) => ["leads", "detail", id, "notes"] as const,

  /** ["leads", "detail", id, "visits"] — pre-sales visits for a lead */
  visits: (id: string) => ["leads", "detail", id, "visits"] as const,
};
