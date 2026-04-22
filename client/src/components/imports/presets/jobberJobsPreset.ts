/**
 * Jobber Jobs export preset (2026-04-22, explicit-source)
 *
 * Applied when the user picks `source = "jobber"` on a historical-jobs
 * import. Never auto-detected. The Jobber Jobs report — `Work → Jobs →
 * Export` — is the primary and only Jobber Jobs source. The Jobber
 * Visits report is a separate future enrichment flow; do not upload it
 * here.
 *
 * Architecture invariants mirrored from the existing JobImportAdapter:
 *   - Clients must exist before jobs can be imported; rows whose client
 *     can't be matched are flagged in Preview.
 *   - Jobs are imported as archived historical records. No live visits.
 *     No dispatch KPIs are touched.
 *   - Location match strategy is the adapter's existing 4-tier: full
 *     address → street+city → location-name → field-swap. Locations
 *     auto-create only when address context is complete.
 *   - Dedupe by `jobNumber` within CSV + within tenant.
 */

import type { ProviderPreset } from "./types";

export const jobberJobsPreset: ProviderPreset = {
  id: "jobber-jobs",
  source: "jobber",
  entity: "jobs",
  label: "Jobber Jobs export",

  description:
    "Columns mapped from the Jobber Jobs report. Imported jobs are archived — they don't create visits and don't affect live KPIs. Clients must already exist; any row whose client can't be matched will be flagged in the preview.",

  fieldAliases: {
    // Identity.
    jobNumber: ["Job #"],
    title: ["Title"],

    // Client match (company must pre-exist per the adapter's contract).
    clientName: ["Client name"],
    clientEmail: ["Client email"],
    clientPhone: ["Client phone"],

    // Billing address snapshot.
    billingStreet: ["Billing street"],
    billingCity: ["Billing city"],
    billingProvince: ["Billing province"],
    billingPostalCode: ["Billing ZIP"],

    // Service property / location.
    locationName: ["Service property name", "Location Name"],
    serviceStreet: ["Service street"],
    serviceCity: ["Service city"],
    serviceProvince: ["Service province"],
    servicePostalCode: ["Service ZIP"],
    roofCode: ["Roof Code"],

    // Dates — adapter parses via parseDate(val, timezone) at commit.
    createdDate: ["Created date"],
    scheduledStartDate: ["Scheduled start date"],
    closedDate: ["Closed date"],

    // Metadata (preserved as strings; not linked to live entities).
    leadSource: ["Lead source"],
    salesperson: ["Salesperson"],
    onlineBooking: ["Online booking"],
    lineItems: ["Line items"],
    visitsAssignedTo: ["Visits assigned to"],
    invoiceNumbers: ["Invoice #s"],
    quoteNumber: ["Quote #"],
    supplierInvoiceNumber: ["Supplier Invoice #"],
    pmInfo: ["PM Info"],

    // Financial snapshot — parsed via parseMoney on commit.
    expensesTotal: ["Expenses total ($)"],
    timeTracked: ["Time tracked"],
    labourCostTotal: ["Labour cost total ($)"],
    lineItemCostTotal: ["Line item cost total ($)"],
    totalCosts: ["Total costs ($)"],
    quoteDiscount: ["Quote discount ($)"],
    totalRevenue: ["Total revenue ($)"],
    profit: ["Profit ($)"],
    profitPercent: ["Profit %"],
  },

  limitations: [
    "Clients must be imported first. Rows whose `Client name` can't be matched are flagged in the preview and skipped.",
    "`Visits assigned to` is saved as a free-text snapshot — it does NOT link to live technicians.",
    "Use the Jobber Jobs export (not the Visits export) as the source for historical jobs.",
  ],
};
