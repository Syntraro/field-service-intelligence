/**
 * Reports library catalog.
 *
 * Single source of truth for the "View all reports" library page
 * (`/reports/library`) AND the per-tab section deep-link mapping.
 *
 * Each `LibraryReport` entry describes ONE renderable section in the
 * Reports page:
 *   - `id`            stable kebab-cased identifier; used as the
 *                     library row's React key + `data-testid` slug.
 *   - `title`         user-facing card title; matches the in-tab
 *                     `SectionCard` title verbatim.
 *   - `description`   short factual sentence describing what the
 *                     section computes. Drawn from the same backend
 *                     contract the section consumes — NOT marketing
 *                     copy. New entries should answer "what value
 *                     does this section show?" in one sentence.
 *   - `tab`           which Reports tab renders the section.
 *   - `sectionTestId` the SectionCard's `testId` prop. Used by the
 *                     Reports page deep-link logic to scroll the
 *                     section into view after switching tabs.
 *   - `status`        `"active"` when the section ships today,
 *                     `"coming_soon"` when the underlying tab/section
 *                     is not implemented yet. UI must visibly mark
 *                     coming-soon items as disabled.
 *
 * No business logic lives here — this is UI configuration. The list
 * is exhaustive over what the Reports page currently renders so the
 * library and the tabs can never drift; tests assert that every
 * `data-testid="…-section-…"` SectionCard has a matching catalog
 * entry.
 */

export type LibraryReportTab =
  | "snapshot"
  | "financial"
  | "operations"
  | "sales"
  | "team"
  | "equipment";

export type LibraryReportStatus = "active" | "coming_soon";

export interface LibraryReport {
  /** Stable kebab-cased identifier (used as React key + test id slug). */
  id: string;
  title: string;
  description: string;
  tab: LibraryReportTab;
  /** Test id of the SectionCard the deep-link should scroll into view.
   *  Empty string when the report is `coming_soon` OR when the report
   *  has its own dedicated page (`href` set). */
  sectionTestId: string;
  /** Direct route override. When set, the library navigates here
   *  instead of building a `/reports?tab=…&section=…` deep-link.
   *  Used for reports that have their own page (e.g. the AR
   *  deep-report at `/reports/ar`). */
  href?: string;
  status: LibraryReportStatus;
}

export interface LibraryCategory {
  /** Kebab-cased category slug used as a React key + test id slug. */
  id: "financial" | "operations" | "sales" | "team" | "equipment";
  label: string;
  reports: LibraryReport[];
}

export const REPORTS_LIBRARY: LibraryCategory[] = [
  {
    id: "financial",
    label: "Financial Reports",
    reports: [
      {
        id: "revenue",
        title: "Revenue",
        description:
          "Cash-basis revenue with payment-method breakdown, top clients, recent payments, and month-over-month change.",
        tab: "financial",
        sectionTestId: "",
        href: "/reports/revenue",
        status: "active",
      },
      {
        id: "revenue-trend",
        title: "Revenue trend",
        description:
          "Daily cash-basis revenue over the selected period from payments received.",
        tab: "financial",
        sectionTestId: "financial-section-revenue-trend",
        status: "active",
      },
      {
        id: "payments-breakdown",
        title: "Payments breakdown",
        description: "Total amount and share of payments by method for the period.",
        tab: "financial",
        sectionTestId: "financial-section-payment-breakdown",
        status: "active",
      },
      {
        id: "ar-aging",
        title: "Accounts receivable",
        description:
          "Outstanding invoice balances bucketed by days past due (current, 1–30, 31–60, 61+).",
        tab: "financial",
        sectionTestId: "financial-section-ar",
        status: "active",
      },
      {
        id: "ar-deep",
        title: "Accounts receivable (deep report)",
        description:
          "Full AR drill-down — overdue invoices table, top outstanding clients, payment-time trend.",
        tab: "financial",
        sectionTestId: "",
        href: "/reports/ar",
        status: "active",
      },
      {
        id: "invoice-status",
        title: "Invoice status",
        description:
          "Invoice counts and totals by status (draft, sent, partial, paid, overdue).",
        tab: "financial",
        sectionTestId: "financial-section-invoice-status",
        status: "active",
      },
      {
        id: "payment-time",
        title: "Payment time",
        description:
          "Average days from invoice issue to fully-paid status, with prior-period comparisons.",
        tab: "financial",
        sectionTestId: "financial-section-payment-time",
        status: "active",
      },
    ],
  },
  {
    id: "operations",
    label: "Operations Reports",
    reports: [
      {
        id: "jobs",
        title: "Job Performance",
        description:
          "Full job drill-down — completion trend, status mix, invoice values, unbillable time, and recently completed jobs.",
        tab: "operations",
        sectionTestId: "",
        href: "/reports/jobs",
        status: "active",
      },
      {
        id: "parts-forecast",
        title: "Parts Forecast",
        description:
          "Forward-looking parts demand for the next 30 days of scheduled PM visits — sourced from location parts templates only.",
        tab: "operations",
        sectionTestId: "",
        href: "/reports/parts-forecast",
        status: "active",
      },
      {
        id: "job-completion-trend",
        title: "Job completion trend",
        description:
          "Daily count of jobs transitioning to completed, sourced from job status events.",
        tab: "operations",
        sectionTestId: "operations-section-completion-trend",
        status: "active",
      },
      {
        id: "job-status-breakdown",
        title: "Job status breakdown",
        description:
          "Active jobs grouped by status (open, completed, invoiced, archived) with share of total.",
        tab: "operations",
        sectionTestId: "operations-section-job-status",
        status: "active",
      },
      {
        id: "avg-job-value-trend",
        title: "Avg job value trend",
        description:
          "Daily average of invoice totals for invoices linked to jobs.",
        tab: "operations",
        sectionTestId: "operations-section-avg-value-trend",
        status: "active",
      },
      {
        id: "unbillable-time-breakdown",
        title: "Unbillable time breakdown",
        description:
          "Cost of unbillable time entries grouped by activity type (admin, travel, on-site, etc.).",
        tab: "operations",
        sectionTestId: "operations-section-unbillable-breakdown",
        status: "active",
      },
    ],
  },
  {
    id: "sales",
    label: "Sales Reports",
    reports: [
      {
        id: "sales-funnel",
        title: "Sales Funnel",
        description:
          "Full pipeline drill-down — funnel stages, lead/quote trends and conversion, status mix, and time-to-conversion.",
        tab: "sales",
        sectionTestId: "",
        href: "/reports/sales-funnel",
        status: "active",
      },
      {
        id: "lead-creation-trend",
        title: "Lead creation trend",
        description: "Daily count of leads created in the selected period.",
        tab: "sales",
        sectionTestId: "sales-section-lead-creation",
        status: "active",
      },
      {
        id: "lead-conversion-trend",
        title: "Lead conversion",
        description:
          "Daily share of created leads that converted (status won or convertedAt set).",
        tab: "sales",
        sectionTestId: "sales-section-lead-conversion",
        status: "active",
      },
      {
        id: "quote-creation-trend",
        title: "Quote creation trend",
        description: "Daily count of quotes created in the selected period.",
        tab: "sales",
        sectionTestId: "sales-section-quote-creation",
        status: "active",
      },
      {
        id: "quote-conversion-trend",
        title: "Quote conversion",
        description:
          "Daily share of created quotes that converted (status converted/approved or convertedAt set).",
        tab: "sales",
        sectionTestId: "sales-section-quote-conversion",
        status: "active",
      },
      {
        id: "lead-status-breakdown",
        title: "Lead status breakdown",
        description: "Active leads grouped by status (new, contacted, quoted, won, lost).",
        tab: "sales",
        sectionTestId: "sales-section-lead-status",
        status: "active",
      },
      {
        id: "quote-status-breakdown",
        title: "Quote status breakdown",
        description:
          "Quotes grouped by status (draft, sent, approved, declined, expired, converted).",
        tab: "sales",
        sectionTestId: "sales-section-quote-status",
        status: "active",
      },
    ],
  },
  {
    id: "team",
    label: "Team Reports",
    reports: [
      {
        id: "team",
        title: "Team Performance",
        description:
          "Per-user hours (billable / unbillable), unbillable cost, and completed jobs — based on FK-clean attribution only.",
        tab: "team",
        sectionTestId: "",
        href: "/reports/team",
        status: "active",
      },
    ],
  },
  {
    id: "equipment",
    label: "Equipment Reports",
    reports: [
      {
        id: "equipment-overview",
        title: "Equipment service history",
        description: "Service frequency, parts usage, and lifecycle metrics by equipment.",
        tab: "equipment",
        sectionTestId: "",
        status: "coming_soon",
      },
    ],
  },
];

/**
 * Build the canonical deep-link path for a library entry.
 *
 *   - `href` set      → navigate directly there (dedicated page, e.g.
 *                       `/reports/ar` for the AR deep-report).
 *   - `tab` + `section` → `/reports?tab=…&section=…`. The Reports page
 *                       reads those params, switches the active tab,
 *                       and scrolls the matching section into view.
 *   - `coming_soon`    → bare `/reports`. The library's click handler
 *                       short-circuits before this is used; the path
 *                       is a defensive fallback that won't crash the
 *                       router if a future caller bypasses the guard.
 */
export function reportLinkFor(report: LibraryReport): string {
  if (report.status !== "active") return "/reports";
  if (report.href) return report.href;
  return `/reports?tab=${encodeURIComponent(report.tab)}&section=${encodeURIComponent(report.sectionTestId)}`;
}
