/**
 * Zod schemas for the canonical invoice import contract.
 *
 * 2026-04-22: first-pass importer — generic across sources, Jobber is the
 * first preset. Every field is nullable so the generic CSV mapping UI can
 * accept arbitrary columns; the adapter enforces the minimum required
 * set at validate-time (customer name + issue date + totals).
 *
 * We intentionally keep field definitions narrow: only canonical invoice
 * attributes that the current storage layer actually persists. Raw source
 * detail (multi-line line-item text, provider-specific ids) round-trips
 * into a notes snapshot on the invoice — no custom fields required.
 */

import { z } from "zod";

export const invoiceImportRowSchema = z.object({
  // Invoice identity
  invoiceNumber: z.string().nullable(),
  subject: z.string().nullable(),
  status: z.string().nullable(),

  // Dates (raw strings — adapter converts at commit via parseDate)
  createdDate: z.string().nullable(),
  issuedDate: z.string().nullable(),
  dueDate: z.string().nullable(),
  paidDate: z.string().nullable(),

  // Customer matching (invoice import never auto-creates customers)
  clientName: z.string().nullable(),
  clientEmail: z.string().nullable(),
  clientPhone: z.string().nullable(),

  // Billing address (informational — not persisted on invoice row directly)
  billingStreet: z.string().nullable(),
  billingCity: z.string().nullable(),
  billingProvince: z.string().nullable(),
  billingPostalCode: z.string().nullable(),

  // Service address — drives location match under the matched customer
  serviceStreet: z.string().nullable(),
  serviceCity: z.string().nullable(),
  serviceProvince: z.string().nullable(),
  servicePostalCode: z.string().nullable(),

  // Optional job linkage (raw string — may contain multiple numbers)
  jobNumbers: z.string().nullable(),

  // Raw line-item text (preserved verbatim in notes + summarized line)
  lineItemsText: z.string().nullable(),

  // Financials — source of truth for the imported invoice totals
  subtotal: z.string().nullable(),
  taxAmount: z.string().nullable(),
  taxPercent: z.string().nullable(),
  total: z.string().nullable(),
  balance: z.string().nullable(),
  deposit: z.string().nullable(),
  discount: z.string().nullable(),

  // Narrative preserved in notes
  visitsAssignedTo: z.string().nullable(),
});

export type InvoiceImportRow = z.infer<typeof invoiceImportRowSchema>;

/** Per-row adapter details shown alongside the disposition. */
export interface InvoiceImportDetails {
  /** Label used in the preview "Match" column (e.g. "Acme Corp — 123 Main St"). */
  customerLabel?: string;
  locationLabel?: string;
  /** Canonical job id linked at commit (invoice.jobId). Undefined → no link. */
  linkedJobId?: string;
  /** Diagnostic: first Job # parsed from the "Job #s" cell. */
  jobNumberParsed?: number;
  /** Canonical status the source string mapped to. */
  statusMapped?: string;
  /** Source invoice number will be written to notes if it would collide. */
  invoiceNumberCollision?: boolean;
}

export const invoiceCommitRequestSchema = z.object({
  rows: z.array(invoiceImportRowSchema).min(1),
});

/**
 * Field defs — shared by the backend adapter and the frontend config.
 * Groups drive the Map-step rendering order.
 */
export const INVOICE_FIELD_DEFS = [
  { key: "invoiceNumber", label: "Invoice #", group: "Invoice", required: false },
  { key: "subject", label: "Subject / description", group: "Invoice", required: false },
  { key: "status", label: "Status", group: "Invoice", required: false },
  { key: "createdDate", label: "Created date", group: "Dates", required: false },
  { key: "issuedDate", label: "Issued date", group: "Dates", required: true },
  { key: "dueDate", label: "Due date", group: "Dates", required: false },
  { key: "paidDate", label: "Marked paid date", group: "Dates", required: false },
  { key: "clientName", label: "Client / customer name", group: "Customer", required: true },
  { key: "clientEmail", label: "Client email", group: "Customer", required: false },
  { key: "clientPhone", label: "Client phone", group: "Customer", required: false },
  { key: "billingStreet", label: "Billing street", group: "Billing", required: false },
  { key: "billingCity", label: "Billing city", group: "Billing", required: false },
  { key: "billingProvince", label: "Billing province/state", group: "Billing", required: false },
  { key: "billingPostalCode", label: "Billing postal/ZIP", group: "Billing", required: false },
  { key: "serviceStreet", label: "Service street", group: "Service address", required: false },
  { key: "serviceCity", label: "Service city", group: "Service address", required: false },
  { key: "serviceProvince", label: "Service province/state", group: "Service address", required: false },
  { key: "servicePostalCode", label: "Service postal/ZIP", group: "Service address", required: false },
  { key: "jobNumbers", label: "Linked job #(s)", group: "Linkage", required: false },
  { key: "lineItemsText", label: "Line items (raw text)", group: "Line items", required: false },
  { key: "subtotal", label: "Pre-tax total ($)", group: "Financial", required: false },
  { key: "taxAmount", label: "Tax amount ($)", group: "Financial", required: false },
  { key: "taxPercent", label: "Tax %", group: "Financial", required: false },
  { key: "total", label: "Total ($)", group: "Financial", required: false },
  { key: "balance", label: "Balance ($)", group: "Financial", required: false },
  { key: "deposit", label: "Deposit ($)", group: "Financial", required: false },
  { key: "discount", label: "Discount ($)", group: "Financial", required: false },
  { key: "visitsAssignedTo", label: "Visits assigned to", group: "Metadata", required: false },
] as const;
