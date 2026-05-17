/**
 * Shared Jobs workspace configuration — views and URL helpers.
 * Single source of truth for JobsWorkspaceTab and future Jobs workspace pages.
 * Neither may define these locally.
 */

// ── Views ─────────────────────────────────────────────────────────────────────

export const VALID_VIEWS = [
  // Operational State
  "all",
  "needs-scheduling",
  "scheduled-today",
  "in-progress",
  "awaiting-follow-up",
  "waiting-for-parts",
  "ready-to-invoice",
  "completed-not-invoiced",
  "overdue",
  "unassigned",
  // Workflow Type
  "service",
  "maintenance",
  "install",
  "warranty",
  "emergency",
  "recurring",
  // Attention
  "missing-labor",
  "missing-notes",
  "missing-line-items",
  "no-future-visit",
  "return-visit-required",
  "technician-flagged",
] as const;

export type JobView = (typeof VALID_VIEWS)[number];

// ── URL helpers ───────────────────────────────────────────────────────────────

/** Resolves the active JobView from the current URL search string. */
export function readViewFromSearch(search: string): JobView {
  const params = new URLSearchParams(search);
  const view = params.get("view");
  if (view && (VALID_VIEWS as readonly string[]).includes(view)) return view as JobView;
  return "all";
}
