/**
 * Job CSV Import Types — patterned after shared/clientImportTypes.ts.
 * Defines the row shape, header aliases, and field definitions for Jobber job CSV imports.
 */

// ============================================================================
// Normalized row produced after CSV column mapping
// ============================================================================

export interface JobImportRow {
  // Job identity
  jobNumber: string | null;  // Parsed to integer during validation
  title: string | null;      // -> jobs.summary

  // Client/company (for matching, NOT creation)
  clientName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;

  // Billing address (for company matching context)
  billingStreet: string | null;
  billingCity: string | null;
  billingProvince: string | null;
  billingPostalCode: string | null;

  // Service location (for location matching/creation)
  serviceStreet: string | null;
  serviceCity: string | null;
  serviceProvince: string | null;
  servicePostalCode: string | null;
  locationName: string | null;    // "Service property name" or "Location Name"
  roofCode: string | null;

  // Dates
  createdDate: string | null;
  scheduledStartDate: string | null;
  closedDate: string | null;

  // Metadata (stored in description/billing_notes/job_notes)
  leadSource: string | null;
  salesperson: string | null;
  onlineBooking: string | null;
  lineItems: string | null;
  visitsAssignedTo: string | null;
  invoiceNumbers: string | null;
  quoteNumber: string | null;
  supplierInvoiceNumber: string | null;
  pmInfo: string | null;

  // Financial (stored in billing_notes)
  expensesTotal: string | null;
  timeTracked: string | null;
  labourCostTotal: string | null;
  lineItemCostTotal: string | null;
  totalCosts: string | null;
  quoteDiscount: string | null;
  totalRevenue: string | null;
  profit: string | null;
  profitPercent: string | null;
}

// ============================================================================
// Field definitions for column mapping UI
// ============================================================================

export interface JobImportFieldDef {
  key: keyof JobImportRow;
  label: string;
  group: "job" | "client" | "billing" | "location" | "dates" | "metadata" | "financial";
  required: boolean;
}

export const JOB_IMPORT_FIELD_DEFS: JobImportFieldDef[] = [
  // Job
  { key: "jobNumber", label: "Job #", group: "job", required: true },
  { key: "title", label: "Title", group: "job", required: true },

  // Client
  { key: "clientName", label: "Client Name", group: "client", required: true },
  { key: "clientEmail", label: "Client Email", group: "client", required: false },
  { key: "clientPhone", label: "Client Phone", group: "client", required: false },

  // Billing address
  { key: "billingStreet", label: "Billing Street", group: "billing", required: false },
  { key: "billingCity", label: "Billing City", group: "billing", required: false },
  { key: "billingProvince", label: "Billing Province/State", group: "billing", required: false },
  { key: "billingPostalCode", label: "Billing Postal/ZIP", group: "billing", required: false },

  // Service location
  { key: "locationName", label: "Location/Property Name", group: "location", required: false },
  { key: "serviceStreet", label: "Service Street", group: "location", required: false },
  { key: "serviceCity", label: "Service City", group: "location", required: false },
  { key: "serviceProvince", label: "Service Province/State", group: "location", required: false },
  { key: "servicePostalCode", label: "Service Postal/ZIP", group: "location", required: false },
  { key: "roofCode", label: "Roof Code", group: "location", required: false },

  // Dates
  { key: "createdDate", label: "Created Date", group: "dates", required: false },
  { key: "scheduledStartDate", label: "Schedule Start Date", group: "dates", required: false },
  { key: "closedDate", label: "Closed Date", group: "dates", required: false },

  // Metadata
  { key: "leadSource", label: "Lead Source", group: "metadata", required: false },
  { key: "salesperson", label: "Salesperson", group: "metadata", required: false },
  { key: "onlineBooking", label: "Online Booking", group: "metadata", required: false },
  { key: "lineItems", label: "Line Items", group: "metadata", required: false },
  { key: "visitsAssignedTo", label: "Visits Assigned To", group: "metadata", required: false },
  { key: "invoiceNumbers", label: "Invoice #s", group: "metadata", required: false },
  { key: "quoteNumber", label: "Quote #", group: "metadata", required: false },
  { key: "supplierInvoiceNumber", label: "Supplier Invoice #", group: "metadata", required: false },
  { key: "pmInfo", label: "PM Info", group: "metadata", required: false },

  // Financial
  { key: "expensesTotal", label: "Expenses Total ($)", group: "financial", required: false },
  { key: "timeTracked", label: "Time Tracked", group: "financial", required: false },
  { key: "labourCostTotal", label: "Labour Cost Total ($)", group: "financial", required: false },
  { key: "lineItemCostTotal", label: "Line Item Cost Total ($)", group: "financial", required: false },
  { key: "totalCosts", label: "Total Costs ($)", group: "financial", required: false },
  { key: "quoteDiscount", label: "Quote Discount ($)", group: "financial", required: false },
  { key: "totalRevenue", label: "Total Revenue ($)", group: "financial", required: false },
  { key: "profit", label: "Profit ($)", group: "financial", required: false },
  { key: "profitPercent", label: "Profit %", group: "financial", required: false },
];

// ============================================================================
// Header aliases: common Jobber CSV column names -> our canonical field keys
// ============================================================================

export const JOB_HEADER_ALIASES: Record<string, keyof JobImportRow> = {
  // Job identity
  "job #": "jobNumber",
  "job number": "jobNumber",
  "job_number": "jobNumber",
  "#": "jobNumber",
  "number": "jobNumber",
  "title": "title",
  "job title": "title",
  "job_title": "title",
  "subject": "title",

  // Client
  "client name": "clientName",
  "client_name": "clientName",
  "client": "clientName",
  "company": "clientName",
  "company name": "clientName",
  "customer": "clientName",
  "customer name": "clientName",
  "client email": "clientEmail",
  "client_email": "clientEmail",
  "email": "clientEmail",
  "client phone": "clientPhone",
  "client_phone": "clientPhone",
  "phone": "clientPhone",

  // Billing address
  "billing street": "billingStreet",
  "billing_street": "billingStreet",
  "billing address": "billingStreet",
  "billing address 1": "billingStreet",
  "billing city": "billingCity",
  "billing_city": "billingCity",
  "billing province": "billingProvince",
  "billing_province": "billingProvince",
  "billing state": "billingProvince",
  "billing province/state": "billingProvince",
  "billing zip": "billingPostalCode",
  "billing_zip": "billingPostalCode",
  "billing postal code": "billingPostalCode",
  "billing postal": "billingPostalCode",

  // Service location
  "service property name": "locationName",
  "property name": "locationName",
  "property": "locationName",
  "location name": "locationName",
  "location": "locationName",
  "site name": "locationName",
  "service street": "serviceStreet",
  "service_street": "serviceStreet",
  "service address": "serviceStreet",
  "property address": "serviceStreet",
  "property address 1": "serviceStreet",
  "service city": "serviceCity",
  "service_city": "serviceCity",
  "property city": "serviceCity",
  "service province": "serviceProvince",
  "service_province": "serviceProvince",
  "service province/state": "serviceProvince",
  "service state": "serviceProvince",
  "property province": "serviceProvince",
  "property state": "serviceProvince",
  "property province/state": "serviceProvince",
  "service zip": "servicePostalCode",
  "service_zip": "servicePostalCode",
  "service postal code": "servicePostalCode",
  "service postal": "servicePostalCode",
  "property postal code": "servicePostalCode",
  "property zip": "servicePostalCode",
  "roof code": "roofCode",
  "roof/ladder code": "roofCode",
  "roof_ladder_code": "roofCode",
  "site code": "roofCode",

  // Dates
  "created date": "createdDate",
  "created_date": "createdDate",
  "created": "createdDate",
  "date created": "createdDate",
  "schedule start date": "scheduledStartDate",
  "scheduled start": "scheduledStartDate",
  "scheduled start date": "scheduledStartDate",
  "start date": "scheduledStartDate",
  "scheduled_start": "scheduledStartDate",
  "closed date": "closedDate",
  "closed_date": "closedDate",
  "date closed": "closedDate",
  "completed date": "closedDate",

  // Metadata
  "lead source": "leadSource",
  "lead_source": "leadSource",
  "source": "leadSource",
  "salesperson": "salesperson",
  "sales person": "salesperson",
  "sales_person": "salesperson",
  "assigned to": "salesperson",
  "online booking": "onlineBooking",
  "online_booking": "onlineBooking",
  "line items": "lineItems",
  "line_items": "lineItems",
  "services": "lineItems",
  "items": "lineItems",
  "visits assigned to": "visitsAssignedTo",
  "visit assigned to": "visitsAssignedTo",
  "technician": "visitsAssignedTo",
  "assigned technician": "visitsAssignedTo",
  "invoice #s": "invoiceNumbers",
  "invoice numbers": "invoiceNumbers",
  "invoice_numbers": "invoiceNumbers",
  "invoices": "invoiceNumbers",
  "quote #": "quoteNumber",
  "quote number": "quoteNumber",
  "quote_number": "quoteNumber",
  "supplier invoice #": "supplierInvoiceNumber",
  "supplier invoice": "supplierInvoiceNumber",
  "supplier_invoice": "supplierInvoiceNumber",
  "pm info": "pmInfo",
  "pm_info": "pmInfo",
  "preventive maintenance": "pmInfo",

  // Financial
  "expenses total ($)": "expensesTotal",
  "expenses total": "expensesTotal",
  "expenses": "expensesTotal",
  "time tracked": "timeTracked",
  "time_tracked": "timeTracked",
  "labour cost total ($)": "labourCostTotal",
  "labour cost total": "labourCostTotal",
  "labor cost total ($)": "labourCostTotal",
  "labor cost total": "labourCostTotal",
  "labour cost": "labourCostTotal",
  "labor cost": "labourCostTotal",
  "line item cost total ($)": "lineItemCostTotal",
  "line item cost total": "lineItemCostTotal",
  "line item cost": "lineItemCostTotal",
  "total costs ($)": "totalCosts",
  "total costs": "totalCosts",
  "total cost": "totalCosts",
  "quote discount ($)": "quoteDiscount",
  "quote discount": "quoteDiscount",
  "discount": "quoteDiscount",
  "total revenue ($)": "totalRevenue",
  "total revenue": "totalRevenue",
  "revenue": "totalRevenue",
  "total": "totalRevenue",
  "profit ($)": "profit",
  "profit": "profit",
  "profit %": "profitPercent",
  "profit (%)": "profitPercent",
  "average profit (%)": "profitPercent",
  "average profit": "profitPercent",
  "margin": "profitPercent",
};

// ============================================================================
// Column mapping type (same structure as client import)
// ============================================================================

export interface JobColumnMapping {
  csvHeader: string;
  csvIndex: number;
  targetField: keyof JobImportRow | null;
}

// ============================================================================
// Province/state normalization for matching
// ============================================================================

/** Normalize province/state to a canonical lowercase abbreviation for comparison. */
const PROVINCE_STATE_MAP: Record<string, string> = {
  // Canadian provinces
  "alberta": "ab", "ab": "ab", "alta": "ab", "alta.": "ab",
  "british columbia": "bc", "bc": "bc", "b.c.": "bc",
  "manitoba": "mb", "mb": "mb", "man": "mb", "man.": "mb",
  "new brunswick": "nb", "nb": "nb", "n.b.": "nb",
  "newfoundland and labrador": "nl", "newfoundland": "nl", "nl": "nl", "nf": "nl", "nfld": "nl",
  "nova scotia": "ns", "ns": "ns", "n.s.": "ns",
  "ontario": "on", "on": "on", "ont": "on", "ont.": "on",
  "prince edward island": "pe", "pe": "pe", "pei": "pe", "p.e.i.": "pe",
  "quebec": "qc", "qc": "qc", "que": "qc", "que.": "qc", "qu\u00e9bec": "qc",
  "saskatchewan": "sk", "sk": "sk", "sask": "sk", "sask.": "sk",
  // Canadian territories
  "northwest territories": "nt", "nt": "nt", "n.w.t.": "nt", "nwt": "nt",
  "nunavut": "nu", "nu": "nu",
  "yukon": "yt", "yt": "yt",
  // US states (most common for cross-border HVAC clients)
  "alabama": "al", "al": "al",
  "alaska": "ak", "ak": "ak",
  "arizona": "az", "az": "az",
  "arkansas": "ar", "ar": "ar",
  "california": "ca", "ca": "ca", "calif": "ca",
  "colorado": "co", "co": "co",
  "connecticut": "ct", "ct": "ct",
  "delaware": "de", "de": "de",
  "florida": "fl", "fl": "fl", "fla": "fl",
  "georgia": "ga", "ga": "ga",
  "hawaii": "hi", "hi": "hi",
  "idaho": "id", "id": "id",
  "illinois": "il", "il": "il",
  "indiana": "in", "in": "in",
  "iowa": "ia", "ia": "ia",
  "kansas": "ks", "ks": "ks",
  "kentucky": "ky", "ky": "ky",
  "louisiana": "la", "la": "la",
  "maine": "me", "me": "me",
  "maryland": "md", "md": "md",
  "massachusetts": "ma", "ma": "ma", "mass": "ma",
  "michigan": "mi", "mi": "mi", "mich": "mi",
  "minnesota": "mn", "mn": "mn", "minn": "mn",
  "mississippi": "ms", "ms": "ms",
  "missouri": "mo", "mo": "mo",
  "montana": "mt", "mt": "mt",
  "nebraska": "ne", "ne": "ne",
  "nevada": "nv", "nv": "nv",
  "new hampshire": "nh", "nh": "nh",
  "new jersey": "nj", "nj": "nj",
  "new mexico": "nm", "nm": "nm",
  "new york": "ny", "ny": "ny",
  "north carolina": "nc", "nc": "nc",
  "north dakota": "nd", "nd": "nd",
  "ohio": "oh", "oh": "oh",
  "oklahoma": "ok", "ok": "ok",
  "oregon": "or", "or": "or",
  "pennsylvania": "pa", "pa": "pa",
  "rhode island": "ri", "ri": "ri",
  "south carolina": "sc", "sc": "sc",
  "south dakota": "sd", "sd": "sd",
  "tennessee": "tn", "tn": "tn", "tenn": "tn",
  "texas": "tx", "tx": "tx",
  "utah": "ut", "ut": "ut",
  "vermont": "vt", "vt": "vt",
  "virginia": "va", "va": "va",
  "washington": "wa", "wa": "wa", "wash": "wa",
  "west virginia": "wv", "wv": "wv",
  "wisconsin": "wi", "wi": "wi", "wis": "wi",
  "wyoming": "wy", "wy": "wy",
  "district of columbia": "dc", "dc": "dc", "d.c.": "dc",
};

export function normalizeProvinceState(val: string | null | undefined): string {
  if (!val) return "";
  const key = val.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");
  return PROVINCE_STATE_MAP[key] ?? PROVINCE_STATE_MAP[val.trim().toLowerCase()] ?? key;
}
