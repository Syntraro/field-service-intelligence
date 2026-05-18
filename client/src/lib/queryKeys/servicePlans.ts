/**
 * Canonical query key definitions for service plan / recurring job queries.
 *
 * Two URL patterns currently coexist for templates:
 *   - ["/api/recurring-templates", ...] — used by ClientDetailPage and PM scheduling
 *   - ["/api/pm/templates"] — used by PMDetailPage / PM workspace
 *
 * It is currently unconfirmed whether both endpoints return the same data.
 * Until that is resolved, both key families are captured here and
 * invalidation helpers bust both. See F-13 in the cache audit.
 */

export const servicePlanKeys = {
  // ── Recurring templates ──

  /** ["/api/recurring-templates"] — template list family prefix */
  allTemplates: () => ["/api/recurring-templates"] as const,

  /** ["/api/recurring-templates", "for-client", companyId] — templates scoped to a client */
  templatesForClient: (companyId: string) =>
    ["/api/recurring-templates", "for-client", companyId] as const,

  /** ["/api/recurring-templates/preview"] — preview of generated visits */
  templatePreview: () => ["/api/recurring-templates/preview"] as const,

  /** ["/api/recurring-templates/upcoming"] — upcoming scheduled PM visits */
  templateUpcoming: () => ["/api/recurring-templates/upcoming"] as const,

  // ── PM workspace templates (may overlap with recurring-templates above) ──

  /** ["/api/pm/templates"] — PM workspace template list */
  pmTemplates: () => ["/api/pm/templates"] as const,
};
