/**
 * Canonical invalidation helpers for service plan / recurring job mutations.
 *
 * Two template key families exist and are busted together until it is
 * confirmed whether ["/api/pm/templates"] and ["/api/recurring-templates"]
 * return different data. See F-13 in the cache audit.
 */
import type { QueryClient } from "@tanstack/react-query";
import { servicePlanKeys } from "@/lib/queryKeys/servicePlans";

/**
 * Bust all service plan / recurring template caches.
 * Use after template create, update, delete, or generation.
 *
 * Pass companyId to also bust the client-scoped template list
 * (used on ClientDetailPage's maintenance section).
 */
export function invalidateServicePlans(
  qc: QueryClient,
  opts?: { companyId?: string },
): void {
  qc.invalidateQueries({ queryKey: servicePlanKeys.allTemplates() });
  qc.invalidateQueries({ queryKey: servicePlanKeys.pmTemplates() });
  qc.invalidateQueries({ queryKey: servicePlanKeys.templateUpcoming() });

  if (opts?.companyId) {
    qc.invalidateQueries({
      queryKey: servicePlanKeys.templatesForClient(opts.companyId),
    });
  }
}
