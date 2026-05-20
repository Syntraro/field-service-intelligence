/**
 * Canonical query key definitions for quote-related queries.
 *
 * NEW canonical key shapes (Pattern B, use these going forward):
 *   - quoteKeys.root()          → ["quotes"]
 *   - quoteKeys.list(filters?)  → ["quotes", "list", filters ?? null]
 *   - quoteKeys.detail(id)      → ["quotes", "detail", id]
 *   - quoteKeys.notes(id)       → ["quotes", "detail", id, "notes"]
 *   - quoteKeys.viewCounts()    → ["quotes", "views", "counts"]
 *
 * LEGACY key shapes (still live in queries — busted via quoteKeys.legacy.*):
 *   - legacy.all()              → ["/api/quotes"]
 *   - legacy.list()             → ["/api/quotes/list"]
 *   - legacy.detail(id)         → ["quote", id, "details"]
 *   - legacy.detailBroad(id)    → ["quote", id]
 *   - legacy.notes(id)          → ["quote", id, "notes"]
 *
 * Bridge period: invalidation helpers bust BOTH canonical and legacy keys until
 * all query call sites are migrated and legacy.* is removed.
 */

export const quoteKeys = {
  // ── Canonical keys ───────────────────────────────────────────────────────

  /** ["quotes"] — semantic family root; prefix-matches all canonical quote keys */
  root: () => ["quotes"] as const,

  /** ["quotes", "list", filters] — list with optional filter fingerprint */
  list: (filters?: unknown) =>
    ["quotes", "list", filters ?? null] as const,

  /** ["quotes", "detail", id] — canonical detail */
  detail: (id: string) => ["quotes", "detail", id] as const,

  /** ["quotes", "detail", id, "notes"] — detail sub-resource (deferred migration) */
  notes: (id: string) => ["quotes", "detail", id, "notes"] as const,

  /** ["quotes", "views", "counts"] — canonical quote aggregate: badge counts + KPI fields */
  viewCounts: () => ["quotes", "views", "counts"] as const,

  // ── Legacy keys (bridge period only — remove after full migration) ────────
  legacy: {
    /** ["/api/quotes"] — URL-pattern list key */
    all: () => ["/api/quotes"] as const,

    /** ["/api/quotes/list"] — alternate URL-pattern list key */
    list: () => ["/api/quotes/list"] as const,

    /** ["quote", id, "details"] — old detail key */
    detail: (id: string) => ["quote", id, "details"] as const,

    /** ["quote", id] — old broad prefix (prefix-matches legacy detail + notes) */
    detailBroad: (id: string) => ["quote", id] as const,

    /** ["quote", id, "notes"] — old notes sub-resource key */
    notes: (id: string) => ["quote", id, "notes"] as const,
  },
};
