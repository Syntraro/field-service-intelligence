/**
 * Dashboard Navigation Mapping Layer
 *
 * Single source of truth for where each dashboard metric navigates.
 * All dashboard cards, tiles, pipeline rows, and alerts consume this mapping
 * instead of hardcoding inline navigation strings.
 *
 * URL contracts match destination page param conventions:
 *   Jobs:     ?lifecycle=open|completed  &subStatus=on_hold|in_progress  (Jobs.tsx)
 *   Invoices: ?filter=awaiting_payment|overdue|paid|...  (InvoicesListPage.tsx)
 *   Quotes:   ?status=draft|approved|sent|...  (Quotes.tsx)
 *   PM:       ?tab=upcoming  &urgency=overdue|coming_due|upcoming  (PMWorkspacePage.tsx)
 *   Dispatch: /dispatch  (no URL-driven filters yet)
 */

export type DashboardAction =
  // Summary cards
  | "quotes.approved"
  | "quotes.draft"
  | "jobs.unscheduled"
  | "jobs.needsInvoicing"
  | "invoices.outstanding"
  | "invoices.pastDue"
  | "pm.overdue"
  | "pm.comingDue"
  | "pm.upcoming"
  // Today's Operations
  | "ops.activeJobs"
  | "ops.onHold"
  | "ops.needsInvoicing"
  | "ops.overdue"
  // Dispatch Alerts
  | "alerts.overdueJobs"
  | "alerts.unassignedJobs"
  | "alerts.visitAlerts"
  | "alerts.techAlerts"
  // Work Pipeline
  | "pipeline.pmAwaiting"
  | "pipeline.quotesAwaitingApproval"
  | "pipeline.approvedNotConverted"
  | "pipeline.jobsAwaitingScheduling"
  | "pipeline.jobsAwaitingInvoice";

interface DashboardDestination {
  pathname: string;
  search?: string;
}

const DESTINATIONS: Record<DashboardAction, DashboardDestination> = {
  // ── Summary Cards ──
  "quotes.approved":       { pathname: "/quotes", search: "status=approved" },
  "quotes.draft":          { pathname: "/quotes", search: "status=draft" },
  "jobs.unscheduled":      { pathname: "/jobs", search: "lifecycle=open&scheduling=unscheduled" },
  "jobs.needsInvoicing":   { pathname: "/jobs", search: "lifecycle=completed" },
  "invoices.outstanding":  { pathname: "/invoices", search: "filter=awaiting_payment" },
  "invoices.pastDue":      { pathname: "/invoices", search: "filter=overdue" },
  "pm.overdue":            { pathname: "/pm", search: "tab=upcoming&urgency=overdue" },
  "pm.comingDue":          { pathname: "/pm", search: "tab=upcoming&urgency=coming_due" },
  "pm.upcoming":           { pathname: "/pm", search: "tab=upcoming&urgency=upcoming" },

  // ── Today's Operations ──
  "ops.activeJobs":        { pathname: "/dispatch" },
  "ops.onHold":            { pathname: "/jobs", search: "lifecycle=open&subStatus=on_hold" },
  "ops.needsInvoicing":    { pathname: "/jobs", search: "lifecycle=completed" },
  "ops.overdue":           { pathname: "/jobs", search: "lifecycle=open&subStatus=overdue" },

  // ── Dispatch Alerts ──
  "alerts.overdueJobs":    { pathname: "/jobs", search: "lifecycle=open&subStatus=overdue" },
  "alerts.unassignedJobs": { pathname: "/jobs", search: "lifecycle=open&scheduling=unscheduled" },
  "alerts.visitAlerts":    { pathname: "/dispatch" },
  "alerts.techAlerts":     { pathname: "/dispatch" },

  // ── Work Pipeline ──
  "pipeline.pmAwaiting":            { pathname: "/pm", search: "tab=upcoming" },
  "pipeline.quotesAwaitingApproval":{ pathname: "/quotes", search: "status=sent" },
  "pipeline.approvedNotConverted":  { pathname: "/quotes", search: "status=approved" },
  "pipeline.jobsAwaitingScheduling":{ pathname: "/jobs", search: "lifecycle=open&scheduling=unscheduled" },
  "pipeline.jobsAwaitingInvoice":   { pathname: "/jobs", search: "lifecycle=completed" },
};

/**
 * Resolve a dashboard action to a full URL path with search params.
 * Returns a string suitable for wouter setLocation().
 */
export function resolveDashboardNav(action: DashboardAction): string {
  const dest = DESTINATIONS[action];
  if (!dest) return "/";
  return dest.search ? `${dest.pathname}?${dest.search}` : dest.pathname;
}
