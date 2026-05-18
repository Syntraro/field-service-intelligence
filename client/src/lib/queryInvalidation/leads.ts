/**
 * Canonical invalidation helpers for lead-related mutations.
 *
 * Lead detail uses Pattern B (["leads", "detail", id]).
 * Lead visits use Pattern A (["/api/leads", id, "visits"]).
 *
 * Family invalidation via ["leads"] prefix catches the semantic detail
 * key, but does NOT catch the URL-pattern visits key. Mutations that
 * affect visits must call invalidateLeadVisits() in addition.
 */
import type { QueryClient } from "@tanstack/react-query";
import { leadKeys } from "@/lib/queryKeys/leads";

/**
 * Full lead invalidation: family prefix + explicit detail key.
 * Use for status change, header update, archive, and hard delete.
 * The explicit detail key is belt-and-suspenders in case the detail
 * key diverges from the family prefix in a future refactor.
 */
export function invalidateLead(qc: QueryClient, leadId: string): void {
  qc.invalidateQueries({ queryKey: leadKeys.all() });
  qc.invalidateQueries({ queryKey: leadKeys.detail(leadId) });
}

/**
 * Lead visit sub-resource invalidation.
 * NOT covered by invalidateLead() — must be called separately when
 * a mutation creates, cancels, or reschedules a lead visit.
 */
export function invalidateLeadVisits(qc: QueryClient, leadId: string): void {
  qc.invalidateQueries({ queryKey: leadKeys.visits(leadId) });
}
