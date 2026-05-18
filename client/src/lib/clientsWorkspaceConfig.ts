/**
 * Shared Clients workspace configuration — views, shared types, and URL helpers.
 * Single source of truth for ClientsWorkspacePage and ClientsWorkspaceTab.
 * Neither may define these locally.
 */

// ── Views ─────────────────────────────────────────────────────────────────────

export const VALID_CLIENT_VIEWS = ["all", "active"] as const;

export type ClientView = (typeof VALID_CLIENT_VIEWS)[number];

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * One row in the Clients workspace list.
 * Represents a customer company (parent entity), aggregating its locations.
 */
export interface CompanyGroup {
  companyId: string;
  companyName: string;
  primaryContact: string;
  primaryLocationId: string;
  address: string;
  locationCount: number;
  hasActiveLocation: boolean;
  allInactive: boolean;
}

/**
 * Context passed to the right rail when a client row is selected.
 * Carries all fields needed for the rail's immediate render (before overview loads)
 * so the summary card is never blank on open.
 *
 * Tags are NOT included here — ClientActionsRail fetches /api/tags/assignments
 * independently (React Query cache hit; no extra network request since the list
 * page already populated the cache with the same query key).
 */
export interface SelectedClientContext {
  companyId: string;
  primaryLocationId: string;
  companyName: string;
  locationCount: number;
  hasActiveLocation: boolean;
  allInactive: boolean;
  address: string;
}

/** Tag assignment row from GET /api/tags/assignments */
export interface TagAssignment {
  customerCompanyId: string;
  tagId: string;
  tagName: string;
  tagColor: string;
}

export type SortField = "name" | "address" | "tags" | "status";
export type SortDir = "asc" | "desc";

// ── URL helpers ───────────────────────────────────────────────────────────────

/** Resolves the active ClientView from the current URL search string. */
export function readClientViewFromSearch(search: string): ClientView {
  const params = new URLSearchParams(search);
  const view = params.get("view");
  if (view && (VALID_CLIENT_VIEWS as readonly string[]).includes(view)) {
    return view as ClientView;
  }
  return "all";
}

// ── View predicate ────────────────────────────────────────────────────────────

/**
 * Applies the active view filter to the full company group list.
 * Phase 3 views return an empty array — their empty state is handled in the tab.
 */
export function applyClientViewFilter(
  groups: CompanyGroup[],
  view: ClientView,
): CompanyGroup[] {
  switch (view) {
    case "all":
      return groups;
    case "active":
      return groups.filter((g) => g.hasActiveLocation);
    default:
      return groups;
  }
}
