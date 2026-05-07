/**
 * Lead status → badge color mapping. Extracted from LeadDetailPage so the
 * detail page and the create page render identical status pills via
 * `getLeadStatusColors`.
 *
 * Note: this map is the SOURCE used by lead detail surfaces. The list-page
 * `getLeadStatusMeta` (lib/statusBadges.ts) is a separate canonical
 * surface for the EntityListTable status cell — they share semantics but
 * different visual densities. Do not consolidate without a UX review.
 *
 * The map and its row interface are intentionally NOT exported — the
 * single public API is `getLeadStatusColors` so callers cannot read or
 * fork the map directly.
 */
interface LeadStatusBadgeColors {
  bg: string;
  text: string;
}

const STATUS_BADGE: Record<string, LeadStatusBadgeColors> = {
  new: { bg: "bg-blue-100", text: "text-blue-700" },
  contacted: { bg: "bg-amber-100", text: "text-amber-700" },
  // 2026-05-05 Lead Visits: rendered after the last open lead visit
  // completes. Office reviews and decides whether to convert to a quote.
  needs_review: { bg: "bg-violet-100", text: "text-violet-700" },
  quoted: { bg: "bg-purple-100", text: "text-purple-700" },
  won: { bg: "bg-emerald-100", text: "text-emerald-700" },
  lost: { bg: "bg-slate-100", text: "text-slate-500" },
};

export function getLeadStatusColors(status: string): LeadStatusBadgeColors {
  return STATUS_BADGE[status] ?? STATUS_BADGE.new;
}
