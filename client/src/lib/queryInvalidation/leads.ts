/**
 * Canonical invalidation helpers for lead-related mutations.
 *
 * All lead keys use Pattern B (semantic). The ["leads"] root prefix
 * catches all lead cache entries via prefix matching.
 */
import type { QueryClient } from "@tanstack/react-query";
import { leadKeys } from "@/lib/queryKeys/leads";

/**
 * Full lead invalidation: family prefix + explicit detail key.
 * Use for status change, header update, archive, and hard delete.
 */
export function invalidateLead(qc: QueryClient, leadId: string): void {
  qc.invalidateQueries({ queryKey: leadKeys.root() });
  qc.invalidateQueries({ queryKey: leadKeys.detail(leadId) });
}

/**
 * List-only lead invalidation.
 * Use for create and delete mutations where no detail key exists.
 */
export function invalidateLeadList(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: leadKeys.root() });
  qc.invalidateQueries({ queryKey: leadKeys.list() });
}

/**
 * Lead visit sub-resource invalidation.
 * Busts the canonical visits key under detail.
 * Call in addition to invalidateLead() after visit create/cancel/reschedule.
 */
export function invalidateLeadVisits(qc: QueryClient, leadId: string): void {
  qc.invalidateQueries({ queryKey: leadKeys.visits(leadId) });
}
