/**
 * Jobber Invoices export preset (2026-04-22)
 *
 * Applied when the user picks `source = "jobber"` on an Invoices import.
 * Maps Jobber's invoice CSV column set onto the canonical invoice-import
 * field definitions (`shared/importPipeline/zod/invoice.ts`).
 *
 * The invoice importer is generic — every alias here is a mapping
 * convenience, not a policy. A user can re-map anything in the Map step.
 *
 * Known limitations are listed below so they appear next to the preset
 * chip in the wizard.
 */

import type { ProviderPreset } from "./types";

export const jobberInvoicesPreset: ProviderPreset = {
  id: "jobber-invoices",
  source: "jobber",
  entity: "invoices",
  label: "Jobber Invoices export",

  description:
    "Columns have been auto-mapped from the Jobber Invoices export shape. " +
    "Review any unmapped columns below, then continue.",

  fieldAliases: {
    invoiceNumber: ["Invoice #"],
    subject: ["Subject"],
    status: ["Status"],

    createdDate: ["Created date"],
    issuedDate: ["Issued date", "Issue date"],
    dueDate: ["Due date"],
    paidDate: ["Marked paid date"],

    clientName: ["Client name", "Client", "Customer"],
    clientEmail: ["Client email"],
    clientPhone: ["Client phone"],

    billingStreet: ["Billing street"],
    billingCity: ["Billing city"],
    billingProvince: ["Billing province", "Billing state"],
    billingPostalCode: ["Billing ZIP", "Billing postal code", "Billing Zip code"],

    serviceStreet: ["Service street"],
    serviceCity: ["Service city"],
    serviceProvince: ["Service province", "Service state"],
    servicePostalCode: ["Service ZIP", "Service postal code", "Service Zip code"],

    jobNumbers: ["Job #s", "Job #"],
    lineItemsText: ["Line items"],

    subtotal: ["Pre-tax total ($)", "Pre-tax total"],
    taxAmount: ["Tax amount ($)", "Tax amount"],
    taxPercent: ["Tax (%)", "Tax %"],
    total: ["Total ($)", "Total"],
    balance: ["Balance ($)", "Balance"],
    deposit: ["Deposit $", "Deposit ($)"],
    discount: ["Discount ($)", "Discount"],

    visitsAssignedTo: ["Visits assigned to"],
  },

  limitations: [
    'Jobber\'s "Line items" column is parsed into one canonical invoice line per item when every item matches the "<description> (qty, $amount)" shape AND the parsed amounts sum to the invoice pre-tax total. Anything else falls back to one summarized line with the raw text preserved in internal notes.',
    "Per-line cost is not imported (Jobber invoices do not expose a line-item cost on the invoice export).",
    "When Job #s contains more than one number, only the first is considered for job linkage — the full list is preserved in notes.",
    "If a source Invoice # collides with an existing invoice, the new invoice is assigned a fresh number and the source number is kept in notes.",
    "Unknown status strings fall back to a balance-derived status (Paid / Partial paid / Awaiting payment / Draft) and a preview warning is emitted.",
  ],
};
