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
 *   PM:       ?view=overdue|work_due|upcoming|dispatch  (ServicePlansPage)
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
  | "invoices.draft"
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
  | "pipeline.jobsAwaitingInvoice"
  // 2026-05-06 RALPH actionable Pipeline destinations.
  | "pipeline.leadsFollowUp"
  | "pipeline.quotesNotSent"
  | "pipeline.quotesAwaitingResponse"
  | "pipeline.staleOpportunities";

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
  "invoices.outstanding":  { pathname: "/invoices", search: "view=awaiting-payment" },
  "invoices.pastDue":      { pathname: "/invoices", search: "view=overdue" },
  "invoices.draft":        { pathname: "/invoices", search: "view=drafts" },
  "pm.overdue":            { pathname: "/pm", search: "view=overdue" },
  "pm.comingDue":          { pathname: "/pm", search: "view=dispatch" },
  "pm.upcoming":           { pathname: "/pm", search: "view=upcoming" },

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
  "pipeline.pmAwaiting":            { pathname: "/pm", search: "view=dispatch" },
  "pipeline.quotesAwaitingApproval":{ pathname: "/quotes", search: "status=sent" },
  "pipeline.approvedNotConverted":  { pathname: "/quotes", search: "status=approved" },
  "pipeline.jobsAwaitingScheduling":{ pathname: "/jobs", search: "lifecycle=open&scheduling=unscheduled" },
  "pipeline.jobsAwaitingInvoice":   { pathname: "/jobs", search: "lifecycle=completed" },

  // 2026-05-06 RALPH actionable Pipeline destinations.
  "pipeline.leadsFollowUp":           { pathname: "/leads" },
  "pipeline.quotesNotSent":           { pathname: "/quotes", search: "status=draft" },
  "pipeline.quotesAwaitingResponse":  { pathname: "/quotes", search: "status=sent" },
  "pipeline.staleOpportunities":      { pathname: "/leads" },
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
