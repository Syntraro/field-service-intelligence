/**
 * Canonical invalidation helpers for quote-related mutations.
 *
 * Bridge period: busts both canonical and legacy key shapes so queries can be
 * migrated call-site-by-call-site without leaving stale cache entries.
 *
 * Canonical keys busted:
 *   - ["quotes"]               — root prefix (busts detail, list, stats, viewCounts)
 *
 * Legacy keys busted explicitly (not caught by canonical prefix):
 *   - ["quote", id]            — old detailBroad prefix (busts old detail + notes)
 *   - ["/api/quotes"]          — URL-pattern list
 *   - ["/api/quotes/list"]     — alternate URL-pattern list
 *   - ["quotes", "stats"]      — KPI strip stats (was missing from original helper)
 *   - ["quotes", "views", "counts"] — view-tab counts (was missing from original helper)
 *
 * After full migration remove the legacy.* bust calls.
 */
import type { QueryClient } from "@tanstack/react-query";
import { quoteKeys } from "@/lib/queryKeys/quotes";

/**
 * Full quote invalidation: canonical detail + all lists + stats + viewCounts.
 * Use for any mutation that changes quote content, status, assignment, or lines.
 */
export function invalidateQuote(
  qc: QueryClient,
  quoteId: string | undefined,
): void {
  if (!quoteId) return;
  // Canonical — prefix busts detail, list, stats, viewCounts
  qc.invalidateQueries({ queryKey: quoteKeys.root() });
  // Legacy bridge
  qc.invalidateQueries({ queryKey: quoteKeys.legacy.detailBroad(quoteId) });
  qc.invalidateQueries({ queryKey: quoteKeys.legacy.all() });
  qc.invalidateQueries({ queryKey: quoteKeys.legacy.list() });
}

/**
 * List-only invalidation: busts all list/stats/counts without targeting a
 * specific detail. Use after bulk actions or when the quote is deleted.
 */
export function invalidateQuoteList(qc: QueryClient): void {
  // Canonical
  qc.invalidateQueries({ queryKey: quoteKeys.root() });
  // Legacy bridge
  qc.invalidateQueries({ queryKey: quoteKeys.legacy.all() });
  qc.invalidateQueries({ queryKey: quoteKeys.legacy.list() });
}
