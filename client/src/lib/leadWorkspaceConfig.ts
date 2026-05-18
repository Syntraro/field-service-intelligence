/**
 * Shared Leads workspace configuration — views, URL helpers, and shared types.
 * Single source of truth for LeadsPage and LeadListPanel.
 * Neither may define these locally.
 */

import type { Lead } from "@shared/schema";

// ── Shared types ──────────────────────────────────────────────────────────────

/** Lead row enriched with display fields joined server-side. */
export interface EnrichedLead extends Lead {
  locationDisplayName: string | null;
  locationSiteName: string | null;
  locationCity: string | null;
}

// ── Views ─────────────────────────────────────────────────────────────────────

// needs_action is a composite client-side view (status "new" | "contacted").
// It is NOT a stored DB status — do not add a server-side filter for it.
export const VALID_LEAD_VIEWS = [
  "all",
  "needs_action",
  "quoted",
  "won",
  "lost",
] as const;

export type LeadView = (typeof VALID_LEAD_VIEWS)[number];

// ── URL helpers ───────────────────────────────────────────────────────────────

/**
 * Resolves the active LeadView from the current URL search string.
 *
 * "needs_action" is the canonical internal key. "needs-action" (hyphen) is
 * accepted as a URL alias so that externally-generated links using the
 * hyphenated form still land on the correct chip. handleViewChange always
 * writes "needs_action" to the URL.
 */
export function readLeadViewFromSearch(search: string): LeadView {
  const raw = new URLSearchParams(search).get("view");
  // Normalise the hyphenated alias before validation.
  const view = raw === "needs-action" ? "needs_action" : raw;
  if (view && (VALID_LEAD_VIEWS as readonly string[]).includes(view)) {
    return view as LeadView;
  }
  return "all";
}

// ── Labels ────────────────────────────────────────────────────────────────────

export function leadFilterLabel(view: LeadView): string {
  switch (view) {
    case "all":          return "All";
    case "needs_action": return "Needs Action";
    case "quoted":       return "Quoted";
    case "won":          return "Won";
    case "lost":         return "Lost";
  }
}
