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
  billingStreet2?: string | null; // Address line 2 (suite, unit, PO box)
  billingCity?: string | null;
  billingProvince?: string | null;
  billingPostalCode?: string | null;
  billingCountry?: string | null;

  // Primary location
  locationName?: string | null;
  serviceStreet?: string | null;
  serviceStreet2?: string | null; // Address line 2 (suite, unit, floor, bay)
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
  { key: "billingStreet2", label: "Billing Street 2", group: "billing", required: false },
  { key: "billingCity", label: "Billing City", group: "billing", required: false },
  { key: "billingProvince", label: "Billing Province/State", group: "billing", required: false },
  { key: "billingPostalCode", label: "Billing Postal Code", group: "billing", required: false },
  { key: "billingCountry", label: "Billing Country", group: "billing", required: false },
  // Location
  { key: "locationName", label: "Location Name", group: "location", required: false },
  { key: "serviceStreet", label: "Service Street", group: "location", required: false },
  { key: "serviceStreet2", label: "Service Street 2", group: "location", required: false },
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
  // Jobber-specific: E-mails header maps to companyEmail
  "e-mails": "companyEmail",
  "emails": "companyEmail",
  // Billing
  "billing street": "billingStreet",
  "billing_street": "billingStreet",
  "billing address": "billingStreet",
  "billing_address": "billingStreet",
  "billing address 1": "billingStreet",
  "billing address line 1": "billingStreet",
  "billing street 1": "billingStreet",
  "billing_street1": "billingStreet",
  // Billing address line 2
  "billing street 2": "billingStreet2",
  "billing_street2": "billingStreet2",
  "billing street2": "billingStreet2",
  "billing address 2": "billingStreet2",
  "billing_address2": "billingStreet2",
  "billing address line 2": "billingStreet2",
  "billing_address_line_2": "billingStreet2",
  "billing suite": "billingStreet2",
  "billing unit": "billingStreet2",
  "billing city": "billingCity",
  "billing_city": "billingCity",
  "billing province": "billingProvince",
  "billing_province": "billingProvince",
  "billing state": "billingProvince",
  "billing_state": "billingProvince",
  "billing province/state": "billingProvince",
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
  // Jobber-specific: "Property" / "Property Name" columns map to location name
  "property": "locationName",
  "property name": "locationName",
  "property_name": "locationName",
  "service street": "serviceStreet",
  "service_street": "serviceStreet",
  "service address": "serviceStreet",
  "service_address": "serviceStreet",
  "street": "serviceStreet",
  "address": "serviceStreet",
  "address 1": "serviceStreet",
  "address line 1": "serviceStreet",
  "street 1": "serviceStreet",
  "street1": "serviceStreet",
  "addr1": "serviceStreet",
  "service street 1": "serviceStreet",
  "service_street1": "serviceStreet",
  // Jobber-specific: "Property Address" columns map to service address
  "property address": "serviceStreet",
  "property address 1": "serviceStreet",
  "property street": "serviceStreet",
  "property street 1": "serviceStreet",
  // Service address line 2
  "service street 2": "serviceStreet2",
  "service_street2": "serviceStreet2",
  "service address 2": "serviceStreet2",
  "service_address2": "serviceStreet2",
  "service address line 2": "serviceStreet2",
  "service_address_line_2": "serviceStreet2",
  "street 2": "serviceStreet2",
  "street2": "serviceStreet2",
  "address 2": "serviceStreet2",
  "address line 2": "serviceStreet2",
  "addr2": "serviceStreet2",
  "suite": "serviceStreet2",
  "unit": "serviceStreet2",
  "apt": "serviceStreet2",
  "po box": "serviceStreet2",
  "property address 2": "serviceStreet2",
  "property street 2": "serviceStreet2",
  "service city": "serviceCity",
  "service_city": "serviceCity",
  "city": "serviceCity",
  "property city": "serviceCity",
  "service province": "serviceProvince",
  "service_province": "serviceProvince",
  "service province/state": "serviceProvince",
  "province": "serviceProvince",
  "province/state": "serviceProvince",
  "state": "serviceProvince",
  "property province": "serviceProvince",
  "property state": "serviceProvince",
  "property province/state": "serviceProvince",
  "service postal code": "servicePostalCode",
  "service_postal_code": "servicePostalCode",
  "postal code": "servicePostalCode",
  "postal_code": "servicePostalCode",
  "zip": "servicePostalCode",
  "zip code": "servicePostalCode",
  "property postal code": "servicePostalCode",
  "property zip": "servicePostalCode",
  "property zip code": "servicePostalCode",
  "service country": "serviceCountry",
  "service_country": "serviceCountry",
  "country": "serviceCountry",
  "property country": "serviceCountry",
  "site code": "siteCode",
  "site_code": "siteCode",
  "access code": "siteCode",
  "access_code": "siteCode",
  "roof ladder code": "siteCode",
  "roof/ladder code": "siteCode",
  "location notes": "locationNotes",
  "location_notes": "locationNotes",
  "notes": "locationNotes",
  "bill with parent": "billWithParent",
  "bill_with_parent": "billWithParent",
  // Contact
  "contact first name": "contactFirstName",
  "contact_first_name": "contactFirstName",
  "contact name": "contactFirstName",
  "contact_name": "contactFirstName",
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

/** Action taken for an entity during import */
export type ImportEntityAction = "create" | "match" | "skip";

/** Billing address conflict detected during preview */
export interface BillingConflict {
  field: string;
  existing: string;
  incoming: string;
}

export interface ValidatedRow {
  rowIndex: number;
  status: RowStatus;
  errors: RowValidationError[];
  warnings: string[];
  /** Compact warning codes for indexed legend display (e.g. [1, 3, 5]) */
  warningCodes?: number[];
  normalized: ClientImportRow;
  /** Whether this row matches an existing customer company */
  matchesExisting: boolean;
  /** Name of existing company if matched */
  existingCompanyName?: string;
  /** Action for each entity: create, match, or skip */
  companyAction: ImportEntityAction;
  locationAction: ImportEntityAction;
  contactAction: ImportEntityAction;
  /** Billing address conflicts (warning, not blocking) */
  conflicts: BillingConflict[];
}

// ============================================================================
// Preview response — returned by POST /api/client-import/preview
// ============================================================================

export interface ImportPreviewResponse {
  headers: string[];
  suggestedMappings: ColumnMapping[];
  /** First few properly-parsed raw data rows for the mapping UI sample display.
   *  Parsed server-side with quote-aware CSV parser to avoid client-side column shift
   *  from unquoted commas in fields like E-mails or Maintenance Months. */
  sampleData: string[][];
  rows: ValidatedRow[];
  /** Per-row column count warnings (e.g. rows with more columns than headers) */
  columnCountWarnings?: string[];
  /** Warning legend: maps numeric codes to human-readable warning messages.
   *  Rows reference codes via warningCodes[] for compact display. */
  warningLegend?: Record<number, string>;
  summary: {
    totalRows: number;
    validRows: number;
    warningRows: number;
    blockedRows: number;
    matchedExistingCompanies: number;
    newCompanies: number;
    locationsMatched: number;
    contactsMatched: number;
    withinCsvDuplicates: number;
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
  locationCreated: boolean;
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
    locationsMatched: number;
    contactsCreated: number;
    contactsMatched: number;
  };
}
