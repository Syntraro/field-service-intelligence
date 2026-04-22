/**
 * Zod schemas for the client (customer-company + location + contact) import.
 *
 * One CSV row = a "client package": one customer company (created or
 * matched), one service location (created or matched), and one optional
 * contact. Every field is nullable except the company name.
 */

import { z } from "zod";

export const clientImportRowSchema = z.object({
  // Company
  companyName: z.string().min(1, "Company name is required"),
  legalName: z.string().nullable(),
  companyPhone: z.string().nullable(),
  companyEmail: z.string().nullable(),
  isActive: z.boolean().nullable(),

  // Billing address
  billingStreet: z.string().nullable(),
  billingStreet2: z.string().nullable(),
  billingCity: z.string().nullable(),
  billingProvince: z.string().nullable(),
  billingPostalCode: z.string().nullable(),
  billingCountry: z.string().nullable(),

  // Service location
  locationName: z.string().nullable(),
  serviceStreet: z.string().nullable(),
  serviceStreet2: z.string().nullable(),
  serviceCity: z.string().nullable(),
  serviceProvince: z.string().nullable(),
  servicePostalCode: z.string().nullable(),
  serviceCountry: z.string().nullable(),
  siteCode: z.string().nullable(),
  locationNotes: z.string().nullable(),
  billWithParent: z.boolean().nullable(),

  // Contact
  contactFirstName: z.string().nullable(),
  contactLastName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
});

export type ClientImportRow = z.infer<typeof clientImportRowSchema>;

/** Per-entity action within a single client-import row. */
export type ClientEntityAction = "create" | "match" | "skip";

export interface ClientImportDetails {
  existingCompanyName?: string;
  companyAction: ClientEntityAction;
  locationAction: ClientEntityAction;
  contactAction: ClientEntityAction;
  /** Conflicts surface non-blocking billing-field mismatches for preview. */
  billingConflicts?: { field: string; existing: string; incoming: string }[];
}

export const clientCommitRequestSchema = z.object({
  rows: z.array(clientImportRowSchema).min(1),
});

/** Field defs — shared by the backend adapter and the frontend config. */
export const CLIENT_FIELD_DEFS = [
  { key: "companyName", label: "Company name", group: "Company", required: true },
  { key: "legalName", label: "Legal name", group: "Company", required: false },
  { key: "companyPhone", label: "Company phone", group: "Company", required: false },
  { key: "companyEmail", label: "Company email", group: "Company", required: false },
  { key: "isActive", label: "Active", group: "Company", required: false },
  { key: "billingStreet", label: "Billing street", group: "Billing", required: false },
  { key: "billingStreet2", label: "Billing street 2", group: "Billing", required: false },
  { key: "billingCity", label: "Billing city", group: "Billing", required: false },
  { key: "billingProvince", label: "Billing province/state", group: "Billing", required: false },
  { key: "billingPostalCode", label: "Billing postal/ZIP", group: "Billing", required: false },
  { key: "billingCountry", label: "Billing country", group: "Billing", required: false },
  { key: "locationName", label: "Location name", group: "Location", required: false },
  { key: "serviceStreet", label: "Service street", group: "Location", required: false },
  { key: "serviceStreet2", label: "Service street 2", group: "Location", required: false },
  { key: "serviceCity", label: "Service city", group: "Location", required: false },
  { key: "serviceProvince", label: "Service province/state", group: "Location", required: false },
  { key: "servicePostalCode", label: "Service postal/ZIP", group: "Location", required: false },
  { key: "serviceCountry", label: "Service country", group: "Location", required: false },
  { key: "siteCode", label: "Site / roof code", group: "Location", required: false },
  { key: "locationNotes", label: "Location notes", group: "Location", required: false },
  { key: "billWithParent", label: "Bill with parent", group: "Location", required: false },
  { key: "contactFirstName", label: "Contact first name", group: "Contact", required: false },
  { key: "contactLastName", label: "Contact last name", group: "Contact", required: false },
  { key: "contactEmail", label: "Contact email", group: "Contact", required: false },
  { key: "contactPhone", label: "Contact phone", group: "Contact", required: false },
] as const;
