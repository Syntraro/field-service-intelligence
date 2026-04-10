/**
 * Canonical Visit Status Display — SINGLE SOURCE OF TRUTH
 *
 * All UI surfaces must import visit status display semantics from this module.
 * Do NOT define local STATUS_LABELS, VISIT_STATUS_LABELS, STATUS_COLORS, etc.
 *
 * Implementation delegates to dispatchPreviewUtils.ts which contains the
 * canonical normalization logic (e.g., "on_site" → "In Progress").
 *
 * 2026-03-18: Created to eliminate proven display drift where "on_site"
 * rendered as "On Site" on 9 surfaces and "In Progress" on 3 surfaces.
 * Canonical decision: "on_site" → "In Progress" everywhere.
 */

// Re-export canonical display functions from dispatch preview utils
export {
  visitStatusLabel,
  visitStatusColor,
  visitStatusDot,
  normalizeVisitStatusForDisplay,
} from "@/components/dispatch/dispatchPreviewUtils";

/**
 * Canonical visit status options for dropdowns/selects.
 *
 * Note: "on_site" is intentionally omitted — it is a legacy DB value
 * normalized to "in_progress" for display. Dropdowns should present
 * the canonical display statuses only.
 */
/**
 * Visit status color classes for tech field pages (bold 100-series palette).
 * Distinct from visitStatusColor() which uses the dispatch palette (subtle 50-series).
 */
export function visitStatusColorTech(status: string): string {
  switch (status) {
    case "scheduled":   return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
    case "dispatched":  return "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300";
    case "en_route":    return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
    case "on_site":     return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
    case "in_progress": return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
    // 2026-04-10: tech-side pause state, distinct from on_hold (office dispatch hold).
    case "paused":      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
    case "completed":   return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
    case "cancelled":   return "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400";
    default:            return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
  }
}

export const VISIT_STATUS_OPTIONS = [
  { value: "scheduled",   label: "Scheduled" },
  { value: "dispatched",  label: "Dispatched" },
  { value: "en_route",    label: "En Route" },
  { value: "in_progress", label: "In Progress" },
  // 2026-04-10: paused added to dispatch-side filter dropdown for office parity.
  { value: "paused",      label: "Paused" },
  { value: "on_hold",     label: "On Hold" },
  { value: "completed",   label: "Completed" },
  { value: "cancelled",   label: "Cancelled" },
] as const;
