/**
 * Shared quote workspace configuration — views, filters, URL helpers.
 * Single source of truth for the /quotes workspace.
 */

// ── View types ────────────────────────────────────────────────────────────────

export type QuoteView =
  | "all" | "draft" | "sent" | "awaiting-approval"
  | "expiring-soon" | "approved" | "expired" | "declined"
  | "converted" | "needs-assessment" | "assessment-scheduled";

export interface QuoteViewCounts {
  all?: number;
  draft?: number;
  sent?: number;
  awaitingApproval?: number;
  expiringSoon?: number;
  approved?: number;
  expired?: number;
  declined?: number;
  converted?: number;
  needsAssessment?: number;
  assessmentScheduled?: number;
}

// ── Status filter ─────────────────────────────────────────────────────────────

export type QuoteStatusFilter =
  | "all" | "draft" | "sent" | "approved" | "declined" | "expired" | "converted";

export const QUOTE_STATUS_FILTERS: readonly QuoteStatusFilter[] = [
  "all", "draft", "sent", "approved", "declined", "expired", "converted",
];

// ── Views ─────────────────────────────────────────────────────────────────────

export const VALID_VIEWS: readonly QuoteView[] = [
  "all", "draft", "sent", "awaiting-approval", "expiring-soon",
  "approved", "expired", "declined", "converted",
  "needs-assessment", "assessment-scheduled",
];

/** Views shown in the Filters dropdown rather than the primary chip row. */
export const SECONDARY_VIEWS: readonly QuoteView[] = [
  "expiring-soon", "needs-assessment", "assessment-scheduled", "expired", "declined", "converted",
];

// ── URL helpers ───────────────────────────────────────────────────────────────

export function readQuoteViewFromSearch(search: string): QuoteView {
  const params = new URLSearchParams(search);
  const view = params.get("view");
  if (view && (VALID_VIEWS as readonly string[]).includes(view)) return view as QuoteView;
  return "all";
}

export function filterLabel(f: QuoteStatusFilter): string {
  if (f === "all") return "All";
  return f.charAt(0).toUpperCase() + f.slice(1);
}
