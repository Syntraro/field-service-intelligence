/**
 * Zod schemas for the historical-job import contract.
 *
 * Imported jobs are ALWAYS created as archived historical records. Every
 * field here is nullable/optional except those the server needs to
 * deterministically match the target tenant record (job number, title,
 * client name).
 */

import { z } from "zod";

export const jobImportRowSchema = z.object({
  // Job identity
  jobNumber: z.string().nullable(),
  title: z.string().nullable(),

  // Client (matching only — companies are never auto-created via job import)
  clientName: z.string().nullable(),
  clientEmail: z.string().nullable(),
  clientPhone: z.string().nullable(),

  // Billing address (context, not persisted as part of job)
  billingStreet: z.string().nullable(),
  billingCity: z.string().nullable(),
  billingProvince: z.string().nullable(),
  billingPostalCode: z.string().nullable(),

  // Service location
  serviceStreet: z.string().nullable(),
  serviceCity: z.string().nullable(),
  serviceProvince: z.string().nullable(),
  servicePostalCode: z.string().nullable(),
  locationName: z.string().nullable(),
  roofCode: z.string().nullable(),

  // Dates (stored as raw strings in the normalized payload; the adapter's
  // date normalizer converts at commit time using the tenant timezone)
  createdDate: z.string().nullable(),
  scheduledStartDate: z.string().nullable(),
  closedDate: z.string().nullable(),

  // Metadata (narrative preservation — attached as a job note)
  leadSource: z.string().nullable(),
  salesperson: z.string().nullable(),
  onlineBooking: z.string().nullable(),
  lineItems: z.string().nullable(),
  visitsAssignedTo: z.string().nullable(),
  invoiceNumbers: z.string().nullable(),
  quoteNumber: z.string().nullable(),
  supplierInvoiceNumber: z.string().nullable(),
  pmInfo: z.string().nullable(),

  // Financial summary (stored in billing_notes)
  expensesTotal: z.string().nullable(),
  timeTracked: z.string().nullable(),
  labourCostTotal: z.string().nullable(),
  lineItemCostTotal: z.string().nullable(),
  totalCosts: z.string().nullable(),
  quoteDiscount: z.string().nullable(),
  totalRevenue: z.string().nullable(),
  profit: z.string().nullable(),
  profitPercent: z.string().nullable(),
});

export type JobImportRow = z.infer<typeof jobImportRowSchema>;

/** Per-row adapter details shown alongside the disposition. */
export interface JobImportDetails {
  companyLabel?: string;
  locationLabel?: string;
  jobNumberParsed?: number;
  /** True when the adapter will create a new location under the matched company. */
  willCreateLocation: boolean;
}

export const jobCommitRequestSchema = z.object({
  rows: z.array(jobImportRowSchema).min(1),
});

/** Field defs — shared by the backend adapter and the frontend config. */
export const JOB_FIELD_DEFS = [
  { key: "jobNumber", label: "Job #", group: "Job", required: true },
  { key: "title", label: "Title", group: "Job", required: true },
  { key: "clientName", label: "Client name", group: "Client", required: true },
  { key: "clientEmail", label: "Client email", group: "Client", required: false },
  { key: "clientPhone", label: "Client phone", group: "Client", required: false },
  { key: "billingStreet", label: "Billing street", group: "Billing", required: false },
  { key: "billingCity", label: "Billing city", group: "Billing", required: false },
  { key: "billingProvince", label: "Billing province/state", group: "Billing", required: false },
  { key: "billingPostalCode", label: "Billing postal/ZIP", group: "Billing", required: false },
  { key: "locationName", label: "Location/property name", group: "Location", required: false },
  { key: "serviceStreet", label: "Service street", group: "Location", required: false },
  { key: "serviceCity", label: "Service city", group: "Location", required: false },
  { key: "serviceProvince", label: "Service province/state", group: "Location", required: false },
  { key: "servicePostalCode", label: "Service postal/ZIP", group: "Location", required: false },
  { key: "roofCode", label: "Roof code", group: "Location", required: false },
  { key: "createdDate", label: "Created date", group: "Dates", required: false },
  { key: "scheduledStartDate", label: "Schedule start date", group: "Dates", required: false },
  { key: "closedDate", label: "Closed date", group: "Dates", required: false },
  { key: "leadSource", label: "Lead source", group: "Metadata", required: false },
  { key: "salesperson", label: "Salesperson", group: "Metadata", required: false },
  { key: "onlineBooking", label: "Online booking", group: "Metadata", required: false },
  { key: "lineItems", label: "Line items", group: "Metadata", required: false },
  { key: "visitsAssignedTo", label: "Visits assigned to", group: "Metadata", required: false },
  { key: "invoiceNumbers", label: "Invoice #s", group: "Metadata", required: false },
  { key: "quoteNumber", label: "Quote #", group: "Metadata", required: false },
  { key: "supplierInvoiceNumber", label: "Supplier invoice #", group: "Metadata", required: false },
  { key: "pmInfo", label: "PM info", group: "Metadata", required: false },
  { key: "expensesTotal", label: "Expenses total ($)", group: "Financial", required: false },
  { key: "timeTracked", label: "Time tracked", group: "Financial", required: false },
  { key: "labourCostTotal", label: "Labour cost total ($)", group: "Financial", required: false },
  { key: "lineItemCostTotal", label: "Line item cost total ($)", group: "Financial", required: false },
  { key: "totalCosts", label: "Total costs ($)", group: "Financial", required: false },
  { key: "quoteDiscount", label: "Quote discount ($)", group: "Financial", required: false },
  { key: "totalRevenue", label: "Total revenue ($)", group: "Financial", required: false },
  { key: "profit", label: "Profit ($)", group: "Financial", required: false },
  { key: "profitPercent", label: "Profit %", group: "Financial", required: false },
] as const;
