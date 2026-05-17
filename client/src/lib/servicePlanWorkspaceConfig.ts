/**
 * Shared Service Plans workspace configuration — views, constants, URL helpers,
 * and shared formatters used across list panels, rail cards, and tabs.
 *
 * Single source of truth for the /pm workspace.
 * Neither the page nor its sub-components may define these locally.
 */

// ── View type ─────────────────────────────────────────────────────────────────

export type ServicePlanView =
  // Operational state
  | "all" | "active" | "work_due" | "overdue" | "upcoming"
  | "expiring_soon" | "expired" | "paused"
  // Workflow type
  | "maintenance" | "inspection" | "warranty" | "recurring"
  // Attention
  | "missing_client" | "no_upcoming_visit" | "missing_billing"
  // Setup
  | "templates"
  // Dispatch queue — instance-level
  | "dispatch";

// ── View sets ─────────────────────────────────────────────────────────────────

export const VALID_VIEWS: readonly ServicePlanView[] = [
  "all", "active", "dispatch", "work_due", "overdue", "upcoming",
  "expiring_soon", "expired", "paused",
  "maintenance", "inspection", "warranty", "recurring",
  "missing_client", "no_upcoming_visit", "missing_billing",
  "templates",
];

/** Views shown in the "More" dropdown rather than the primary chip row. */
export const MORE_VIEWS: readonly ServicePlanView[] = [
  "expiring_soon", "expired", "paused", "templates",
];

/** Views shown in the "Type" dropdown. */
export const TYPE_VIEWS: readonly ServicePlanView[] = [
  "maintenance", "inspection", "warranty", "recurring",
];

/** Views shown in the "Attention" dropdown. */
export const ATTENTION_VIEWS: readonly ServicePlanView[] = [
  "missing_client", "no_upcoming_visit", "missing_billing",
];

/** All non-primary-chip views (union of More + Type + Attention). */
export const SECONDARY_VIEWS: readonly ServicePlanView[] = [
  ...MORE_VIEWS,
  ...TYPE_VIEWS,
  ...ATTENTION_VIEWS,
];

// ── URL helpers ───────────────────────────────────────────────────────────────

/** Resolves the active ServicePlanView from the current URL search string. */
export function readViewFromSearch(search: string): ServicePlanView {
  const params = new URLSearchParams(search);
  const view = params.get("view");
  if (view && (VALID_VIEWS as readonly string[]).includes(view)) return view as ServicePlanView;
  return "all";
}

// ── Shared formatters ─────────────────────────────────────────────────────────

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Returns a stacked frequency label: a short headline ("Quarterly") and an
 * optional sub-line of month abbreviations ("Jan • Apr • Jul • Oct").
 * Used by the list panel, templates tab, summary rail card, and dispatch queue.
 */
export function formatFrequencyStacked(
  kind: string,
  interval: number,
  months: number[] | null,
): { headline: string; sub: string | null } {
  const sorted = months?.slice().sort((a, b) => a - b) ?? [];
  const count = sorted.length;

  if (count === 12) return { headline: "Monthly", sub: "All months" };
  if (count === 1) return { headline: "Annual", sub: MONTH_ABBR[sorted[0] - 1] };
  if (count > 0) {
    const labels = sorted.map((m) => MONTH_ABBR[m - 1]);
    if (count === 4) {
      const gaps = sorted.slice(1).map((m, i) => m - sorted[i]);
      if (gaps.every((g) => g === 3)) return { headline: "Quarterly", sub: labels.join(" • ") };
    }
    if (count === 2 && sorted[1] - sorted[0] === 6) {
      return { headline: "Bi-Annual", sub: labels.join(" • ") };
    }
    return { headline: "Custom", sub: labels.join(" • ") };
  }
  if (kind === "weekly") {
    return { headline: interval === 1 ? "Weekly" : `Every ${interval} weeks`, sub: null };
  }
  return { headline: interval === 1 ? "Monthly" : `Every ${interval} months`, sub: null };
}
