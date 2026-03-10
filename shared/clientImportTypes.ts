/**
 * Client CSV Import — Shared Types (v1)
 *
 * Canonical types for the client import pipeline, shared between
 * server and client. One CSV row = one client package:
 *   - one customer_company (deduped by exact name)
 *   - one client_location (primary)
 *   - one optional client_contact (primary)
 *
 * Phase 4C: Create-only, no update/merge, no repeated-row aggregation.
 */

// ============================================================================
// Canonical normalized row — the shape after CSV parsing + mapping + normalization
// ============================================================================

export interface ClientImportRow {
  // Company
  companyName: string;
  legalName?: string | null;
  companyPhone?: string | null;
  companyEmail?: string | null;
  isActive?: boolean | null;

  // Billing address
  billingStreet?: string | null;
  billingCity?: string | null;
  billingProvince?: string | null;
  billingPostalCode?: string | null;
  billingCountry?: string | null;

  // Primary location
  locationName?: string | null;
  serviceStreet?: string | null;
  serviceCity?: string | null;
  serviceProvince?: string | null;
  servicePostalCode?: string | null;
  serviceCountry?: string | null;
  siteCode?: string | null;
  locationNotes?: string | null;
  billWithParent?: boolean | null;

  // Primary contact (optional block)
  contactFirstName?: string | null;
  contactLastName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
}

// ============================================================================
// V1 field allowlist — the mapping targets users can choose from
// ============================================================================

export interface ImportFieldDef {
  key: keyof ClientImportRow;
  label: string;
  group: "company" | "billing" | "location" | "contact";
  required: boolean;
}

export const IMPORT_FIELD_DEFS: ImportFieldDef[] = [
  // Company
  { key: "companyName", label: "Company Name", group: "company", required: true },
  { key: "legalName", label: "Legal Name", group: "company", required: false },
  { key: "companyPhone", label: "Company Phone", group: "company", required: false },
  { key: "companyEmail", label: "Company Email", group: "company", required: false },
  { key: "isActive", label: "Active", group: "company", required: false },
  // Billing
  { key: "billingStreet", label: "Billing Street", group: "billing", required: false },
  { key: "billingCity", label: "Billing City", group: "billing", required: false },
  { key: "billingProvince", label: "Billing Province/State", group: "billing", required: false },
  { key: "billingPostalCode", label: "Billing Postal Code", group: "billing", required: false },
  { key: "billingCountry", label: "Billing Country", group: "billing", required: false },
  // Location
  { key: "locationName", label: "Location Name", group: "location", required: false },
  { key: "serviceStreet", label: "Service Street", group: "location", required: false },
  { key: "serviceCity", label: "Service City", group: "location", required: false },
  { key: "serviceProvince", label: "Service Province/State", group: "location", required: false },
  { key: "servicePostalCode", label: "Service Postal Code", group: "location", required: false },
  { key: "serviceCountry", label: "Service Country", group: "location", required: false },
  { key: "siteCode", label: "Site / Access Code", group: "location", required: false },
  { key: "locationNotes", label: "Location Notes", group: "location", required: false },
  { key: "billWithParent", label: "Bill With Parent", group: "location", required: false },
  // Contact
  { key: "contactFirstName", label: "Contact First Name", group: "contact", required: false },
  { key: "contactLastName", label: "Contact Last Name", group: "contact", required: false },
  { key: "contactEmail", label: "Contact Email", group: "contact", required: false },
  { key: "contactPhone", label: "Contact Phone", group: "contact", required: false },
];

/** Header alias map: common CSV header names → our canonical field keys */
export const HEADER_ALIASES: Record<string, keyof ClientImportRow> = {
  // Company
  "company name": "companyName",
  "company_name": "companyName",
  "client name": "companyName",
  "client_name": "companyName",
  "business name": "companyName",
  "business_name": "companyName",
  "customer name": "companyName",
  "customer_name": "companyName",
  "name": "companyName",
  "legal name": "legalName",
  "legal_name": "legalName",
  "registered name": "legalName",
  "company phone": "companyPhone",
  "company_phone": "companyPhone",
  "main phone": "companyPhone",
  "phone": "companyPhone",
  "company email": "companyEmail",
  "company_email": "companyEmail",
  "main email": "companyEmail",
  "email": "companyEmail",
  "active": "isActive",
  "is_active": "isActive",
  "is active": "isActive",
  "status": "isActive",
  // Billing
  "billing street": "billingStreet",
  "billing_street": "billingStreet",
  "billing address": "billingStreet",
  "billing_address": "billingStreet",
  "billing city": "billingCity",
  "billing_city": "billingCity",
  "billing province": "billingProvince",
  "billing_province": "billingProvince",
  "billing state": "billingProvince",
  "billing_state": "billingProvince",
  "billing postal code": "billingPostalCode",
  "billing_postal_code": "billingPostalCode",
  "billing zip": "billingPostalCode",
  "billing_zip": "billingPostalCode",
  "billing country": "billingCountry",
  "billing_country": "billingCountry",
  // Location
  "location name": "locationName",
  "location_name": "locationName",
  "site name": "locationName",
  "site_name": "locationName",
  "location": "locationName",
  "service street": "serviceStreet",
  "service_street": "serviceStreet",
  "service address": "serviceStreet",
  "service_address": "serviceStreet",
  "street": "serviceStreet",
  "address": "serviceStreet",
  "service city": "serviceCity",
  "service_city": "serviceCity",
  "city": "serviceCity",
  "service province": "serviceProvince",
  "service_province": "serviceProvince",
  "province": "serviceProvince",
  "state": "serviceProvince",
  "service postal code": "servicePostalCode",
  "service_postal_code": "servicePostalCode",
  "postal code": "servicePostalCode",
  "postal_code": "servicePostalCode",
  "zip": "servicePostalCode",
  "zip code": "servicePostalCode",
  "service country": "serviceCountry",
  "service_country": "serviceCountry",
  "country": "serviceCountry",
  "site code": "siteCode",
  "site_code": "siteCode",
  "access code": "siteCode",
  "access_code": "siteCode",
  "roof ladder code": "siteCode",
  "location notes": "locationNotes",
  "location_notes": "locationNotes",
  "notes": "locationNotes",
  "bill with parent": "billWithParent",
  "bill_with_parent": "billWithParent",
  // Contact
  "contact first name": "contactFirstName",
  "contact_first_name": "contactFirstName",
  "first name": "contactFirstName",
  "first_name": "contactFirstName",
  "contact last name": "contactLastName",
  "contact_last_name": "contactLastName",
  "last name": "contactLastName",
  "last_name": "contactLastName",
  "contact email": "contactEmail",
  "contact_email": "contactEmail",
  "contact phone": "contactPhone",
  "contact_phone": "contactPhone",
};

// ============================================================================
// Field mapping — user's column-to-field assignment
// ============================================================================

/** One column mapping: CSV header index → Syntraro field key */
export interface ColumnMapping {
  csvHeader: string;
  csvIndex: number;
  targetField: keyof ClientImportRow | null; // null = "Ignore"
}

// ============================================================================
// Validation result types
// ============================================================================

export type RowStatus = "valid" | "warning" | "blocked";

export interface RowValidationError {
  field: string;
  message: string;
}

export interface ValidatedRow {
  rowIndex: number;
  status: RowStatus;
  errors: RowValidationError[];
  warnings: string[];
  normalized: ClientImportRow;
  /** Whether this row matches an existing customer company */
  matchesExisting: boolean;
  /** Name of existing company if matched */
  existingCompanyName?: string;
}

// ============================================================================
// Preview response — returned by POST /api/client-import/preview
// ============================================================================

export interface ImportPreviewResponse {
  headers: string[];
  suggestedMappings: ColumnMapping[];
  rows: ValidatedRow[];
  summary: {
    totalRows: number;
    validRows: number;
    warningRows: number;
    blockedRows: number;
    matchedExistingCompanies: number;
    newCompanies: number;
  };
}

// ============================================================================
// Execute request/response — POST /api/client-import/execute
// ============================================================================

export interface ImportExecuteRequest {
  rows: ClientImportRow[];
}

export interface ImportRowResult {
  rowIndex: number;
  success: boolean;
  error?: string;
  companyId?: string;
  companyName?: string;
  companyCreated: boolean;
  locationId?: string;
  contactId?: string;
  contactCreated: boolean;
}

export interface ImportExecuteResponse {
  results: ImportRowResult[];
  summary: {
    totalRows: number;
    importedRows: number;
    failedRows: number;
    companiesCreated: number;
    companiesMatched: number;
    locationsCreated: number;
    contactsCreated: number;
  };
}
