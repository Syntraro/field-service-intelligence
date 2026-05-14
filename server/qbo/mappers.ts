import type { CustomerCompany, Client, Invoice, InvoiceLine, Payment, QboMappingConfig } from "@shared/schema";

// QBO Customer/Sub-Customer JSON payload interfaces
export interface QBOAddress {
  Line1?: string;
  Line2?: string; // Address line 2 (suite, unit, PO box)
  City?: string;
  CountrySubDivisionCode?: string; // Province/State
  PostalCode?: string;
  Country?: string;
}

export interface QBOParentRef {
  value: string; // QBO Customer.Id of the parent
}

export interface QBOCustomerPayload {
  Id?: string; // Only for updates
  SyncToken?: string; // Required for updates
  DisplayName: string;
  CompanyName?: string;
  GivenName?: string;
  FamilyName?: string;
  PrimaryPhone?: { FreeFormNumber: string };
  PrimaryEmailAddr?: { Address: string };
  BillAddr?: QBOAddress;
  Active: boolean;
  // Sub-customer specific fields
  ParentRef?: QBOParentRef;
  BillWithParent?: boolean;
  Job?: boolean; // Set to true for sub-customers
}

export interface QBOCustomerResponse {
  Id: string;
  SyncToken: string;
  DisplayName: string;
  CompanyName?: string;
  PrimaryPhone?: { FreeFormNumber: string };
  PrimaryEmailAddr?: { Address: string };
  BillAddr?: QBOAddress;
  ShipAddr?: QBOAddress; // Shipping/service address (used for location import)
  Active: boolean;
  ParentRef?: QBOParentRef;
  BillWithParent?: boolean;
  MetaData?: {
    CreateTime: string;
    LastUpdatedTime: string;
  };
}

// ============================================================
// APP -> QBO MAPPERS
// ============================================================

/**
 * Maps a CustomerCompany (parent) to a QBO Customer payload
 * Used when creating or updating a QBO Customer
 */
export function mapCustomerCompanyToQBO(
  company: CustomerCompany,
  forUpdate: boolean = false
): QBOCustomerPayload {
  const payload: QBOCustomerPayload = {
    DisplayName: company.name ?? "",
    CompanyName: company.legalName || (company.name ?? ""),
    Active: company.isActive,
  };

  // Add phone if present
  if (company.phone) {
    payload.PrimaryPhone = { FreeFormNumber: company.phone };
  }

  // Add email if present
  if (company.email) {
    payload.PrimaryEmailAddr = { Address: company.email };
  }

  // Add billing address if any field is present
  if (company.billingStreet || company.billingCity || company.billingProvince || company.billingPostalCode) {
    payload.BillAddr = {
      Line1: company.billingStreet || undefined,
      Line2: company.billingStreet2 || undefined, // Address line 2 (suite, unit, PO box)
      City: company.billingCity || undefined,
      CountrySubDivisionCode: company.billingProvince || undefined,
      PostalCode: company.billingPostalCode || undefined,
      Country: company.billingCountry || undefined,
    };
  }

  // For updates, include Id and SyncToken
  if (forUpdate && company.qboCustomerId && company.qboSyncToken) {
    payload.Id = company.qboCustomerId;
    payload.SyncToken = company.qboSyncToken;
  }

  return payload;
}

/**
 * Maps a Client (location/child) to a QBO Sub-Customer payload
 * Requires the parent company name for building the DisplayName
 */
export function mapClientToQBOSubCustomer(
  client: Client,
  parentCompanyName: string,
  parentQboCustomerId: string,
  forUpdate: boolean = false
): QBOCustomerPayload {
  // Build DisplayName as "ParentName: LocationName" per QBO convention
  const locationName = client.location || client.companyName;
  const displayName = `${parentCompanyName}: ${locationName}`;

  const payload: QBOCustomerPayload = {
    DisplayName: displayName,
    CompanyName: client.companyName ?? undefined,
    Active: !client.inactive,
    Job: true, // Marks this as a sub-customer in QBO
    ParentRef: { value: parentQboCustomerId },
    BillWithParent: client.billWithParent,
  };

  // Add contact name if present
  if (client.contactName) {
    const nameParts = client.contactName.split(" ");
    payload.GivenName = nameParts[0] || undefined;
    payload.FamilyName = nameParts.slice(1).join(" ") || undefined;
  }

  // Add phone if present
  if (client.phone) {
    payload.PrimaryPhone = { FreeFormNumber: client.phone };
  }

  // Add email if present
  if (client.email) {
    payload.PrimaryEmailAddr = { Address: client.email };
  }

  // Add service address as billing address
  if (client.address || client.city || client.province || client.postalCode) {
    payload.BillAddr = {
      Line1: client.address || undefined,
      Line2: client.address2 || undefined,
      City: client.city || undefined,
      CountrySubDivisionCode: client.province || undefined,
      PostalCode: client.postalCode || undefined,
    };
  }

  // For updates, include Id and SyncToken
  if (forUpdate && client.qboCustomerId && client.qboSyncToken) {
    payload.Id = client.qboCustomerId;
    payload.SyncToken = client.qboSyncToken;
  }

  return payload;
}

/**
 * Maps a standalone Client (no parent) to a QBO Customer payload
 * Used for clients that don't belong to a parent company
 */
export function mapStandaloneClientToQBO(
  client: Client,
  forUpdate: boolean = false
): QBOCustomerPayload {
  const companyLabel = client.companyName ?? "";
  const displayName = client.location
    ? `${companyLabel}: ${client.location}`
    : companyLabel;

  const payload: QBOCustomerPayload = {
    DisplayName: displayName,
    CompanyName: client.companyName ?? undefined,
    Active: !client.inactive,
  };

  // Add contact name if present
  if (client.contactName) {
    const nameParts = client.contactName.split(" ");
    payload.GivenName = nameParts[0] || undefined;
    payload.FamilyName = nameParts.slice(1).join(" ") || undefined;
  }

  // Add phone if present
  if (client.phone) {
    payload.PrimaryPhone = { FreeFormNumber: client.phone };
  }

  // Add email if present
  if (client.email) {
    payload.PrimaryEmailAddr = { Address: client.email };
  }

  // Add address
  if (client.address || client.city || client.province || client.postalCode) {
    payload.BillAddr = {
      Line1: client.address || undefined,
      Line2: client.address2 || undefined,
      City: client.city || undefined,
      CountrySubDivisionCode: client.province || undefined,
      PostalCode: client.postalCode || undefined,
    };
  }

  // For updates, include Id and SyncToken
  if (forUpdate && client.qboCustomerId && client.qboSyncToken) {
    payload.Id = client.qboCustomerId;
    payload.SyncToken = client.qboSyncToken;
  }

  return payload;
}

// ============================================================
// QBO -> APP MAPPERS
// ============================================================

export interface ParsedQBOCustomer {
  isSubCustomer: boolean;
  parentQboId: string | null;
  displayName: string;
  parentName: string | null; // Extracted from DisplayName for sub-customers
  locationName: string | null; // Extracted from DisplayName for sub-customers
  companyName: string | null;
  phone: string | null;
  email: string | null;
  address: {
    street: string | null;
    street2: string | null;
    city: string | null;
    province: string | null;
    postalCode: string | null;
    country: string | null;
  };
  shipAddress: {
    street: string | null;
    street2: string | null;
    city: string | null;
    province: string | null;
    postalCode: string | null;
    country: string | null;
  };
  isActive: boolean;
  billWithParent: boolean;
  qboCustomerId: string;
  qboSyncToken: string;
}

/**
 * Parses a QBO Customer response and extracts relevant data
 * Determines if it's a parent Customer or Sub-Customer
 */
export function parseQBOCustomerResponse(qboCustomer: QBOCustomerResponse): ParsedQBOCustomer {
  const isSubCustomer = !!qboCustomer.ParentRef;
  let parentName: string | null = null;
  let locationName: string | null = null;

  // Parse DisplayName to extract parent and location names
  // QBO format: "ParentName: LocationName"
  if (isSubCustomer && qboCustomer.DisplayName.includes(": ")) {
    const parts = qboCustomer.DisplayName.split(": ");
    parentName = parts[0];
    locationName = parts.slice(1).join(": "); // Handle case where location has ":"
  }

  return {
    isSubCustomer,
    parentQboId: qboCustomer.ParentRef?.value || null,
    displayName: qboCustomer.DisplayName,
    parentName,
    locationName,
    companyName: qboCustomer.CompanyName || null,
    phone: qboCustomer.PrimaryPhone?.FreeFormNumber || null,
    email: qboCustomer.PrimaryEmailAddr?.Address || null,
    address: {
      street: qboCustomer.BillAddr?.Line1 || null,
      street2: qboCustomer.BillAddr?.Line2 || null,
      city: qboCustomer.BillAddr?.City || null,
      province: qboCustomer.BillAddr?.CountrySubDivisionCode || null,
      postalCode: qboCustomer.BillAddr?.PostalCode || null,
      country: qboCustomer.BillAddr?.Country || null,
    },
    shipAddress: {
      street: qboCustomer.ShipAddr?.Line1 || null,
      street2: qboCustomer.ShipAddr?.Line2 || null,
      city: qboCustomer.ShipAddr?.City || null,
      province: qboCustomer.ShipAddr?.CountrySubDivisionCode || null,
      postalCode: qboCustomer.ShipAddr?.PostalCode || null,
      country: qboCustomer.ShipAddr?.Country || null,
    },
    isActive: qboCustomer.Active,
    billWithParent: qboCustomer.BillWithParent || false,
    qboCustomerId: qboCustomer.Id,
    qboSyncToken: qboCustomer.SyncToken,
  };
}

/**
 * Validates that a QBO customer is not a third-level hierarchy
 * QBO only supports 2 levels: Customer -> Sub-Customer
 * Returns true if valid, false if it's a sub-customer of a sub-customer
 */
export function validateQBOHierarchyDepth(
  qboCustomer: QBOCustomerResponse,
  allQboCustomers: Map<string, QBOCustomerResponse>
): { valid: boolean; reason?: string } {
  if (!qboCustomer.ParentRef) {
    return { valid: true }; // Top-level customer, always valid
  }

  const parent = allQboCustomers.get(qboCustomer.ParentRef.value);
  if (!parent) {
    return { valid: true }; // Parent not in our list, assume valid
  }

  if (parent.ParentRef) {
    return {
      valid: false,
      reason: `Customer "${qboCustomer.DisplayName}" is a sub-customer of a sub-customer (depth > 2). QBO only supports 2 levels.`,
    };
  }

  return { valid: true };
}

/**
 * Builds a QBO DisplayName ensuring uniqueness
 * If the base name is taken, appends a numeric suffix
 */
export function buildUniqueDisplayName(
  baseName: string,
  existingNames: Set<string>,
  maxAttempts: number = 100
): string {
  if (!existingNames.has(baseName)) {
    return baseName;
  }

  for (let i = 2; i <= maxAttempts; i++) {
    const candidate = `${baseName} (${i})`;
    if (!existingNames.has(candidate)) {
      return candidate;
    }
  }

  // Fallback: append timestamp
  return `${baseName} (${Date.now()})`;
}

// ============================================================
// QBO INVOICE INTERFACES
// ============================================================

export interface QBOInvoiceLineDetail {
  ItemRef?: { value: string; name?: string };
  Qty?: number;
  UnitPrice?: number;
  TaxCodeRef?: { value: string };
}

export interface QBOInvoiceLine {
  Id?: string;
  LineNum?: number;
  Description?: string;
  Amount: number;
  DetailType: "SalesItemLineDetail" | "SubTotalLineDetail" | "DiscountLineDetail";
  SalesItemLineDetail?: QBOInvoiceLineDetail;
}

export interface QBOInvoicePayload {
  Id?: string;
  SyncToken?: string;
  DocNumber?: string;
  TxnDate?: string; // Issue date YYYY-MM-DD
  DueDate?: string;
  CustomerRef: { value: string };
  BillAddr?: QBOAddress;
  ShipAddr?: QBOAddress;
  Line: QBOInvoiceLine[];
  CustomerMemo?: { value: string };
  PrivateNote?: string; // Maps to internal notes (not sent to customer)
  CurrencyRef?: { value: string };
  TotalAmt?: number;
}

export interface QBOInvoiceResponse {
  Id: string;
  SyncToken: string;
  DocNumber?: string;
  TxnDate: string;
  DueDate?: string;
  CustomerRef: { value: string; name?: string };
  BillAddr?: QBOAddress;
  ShipAddr?: QBOAddress;
  Line: QBOInvoiceLine[];
  CustomerMemo?: { value: string };
  PrivateNote?: string;
  CurrencyRef?: { value: string; name?: string };
  TotalAmt: number;
  Balance: number; // Remaining balance on invoice
  MetaData?: {
    CreateTime: string;
    LastUpdatedTime: string;
  };
}

// ============================================================
// INVOICE MAPPERS: APP -> QBO
// ============================================================

/**
 * Maps an Invoice and its lines to a QBO Invoice payload
 * The CustomerRef depends on the location's billWithParent flag:
 * - If billWithParent = true: CustomerRef points to parent Company's qboCustomerId
 * - If billWithParent = false: CustomerRef points to Location's qboCustomerId
 *
 * @param mappingConfig - Optional QBO mapping config for resolving item/tax refs
 * @param itemQboIds - Optional map of local item IDs to QBO item IDs (productId -> qboItemId)
 */
export function toQboInvoicePayload(
  invoice: Invoice,
  location: Client,
  customerCompany: CustomerCompany | undefined,
  lines: InvoiceLine[],
  forUpdate: boolean = false,
  mappingConfig?: QboMappingConfig | null,
  itemQboIds?: Map<string, string> | null
): QBOInvoicePayload {
  // Determine CustomerRef based on billWithParent flag
  // If billWithParent is true, bill to the parent company
  // Otherwise, bill to the location (sub-customer)
  let customerRefValue: string;
  
  if (location.billWithParent && customerCompany?.qboCustomerId) {
    // Bill to parent company
    customerRefValue = customerCompany.qboCustomerId;
  } else if (location.qboCustomerId) {
    // Bill to location (sub-customer)
    customerRefValue = location.qboCustomerId;
  } else {
    // Fallback: if no QBO ID available, this will fail at sync time
    throw new Error(`No QBO Customer ID available for billing. Location: ${location.id}`);
  }

  const payload: QBOInvoicePayload = {
    CustomerRef: { value: customerRefValue },
    TxnDate: invoice.issueDate,
    Line: [],
  };

  // Add DocNumber if set
  if (invoice.invoiceNumber) {
    payload.DocNumber = invoice.invoiceNumber;
  }

  // Add due date if set
  if (invoice.dueDate) {
    payload.DueDate = invoice.dueDate;
  }

  // Add currency if not default
  if (invoice.currency && invoice.currency !== "CAD") {
    payload.CurrencyRef = { value: invoice.currency };
  }

  // Build billing address
  // If billing parent, use parent company's billing address
  // Otherwise, use location's address
  if (location.billWithParent && customerCompany) {
    if (customerCompany.billingStreet || customerCompany.billingCity) {
      payload.BillAddr = {
        Line1: customerCompany.billingStreet || undefined,
        Line2: customerCompany.billingStreet2 || undefined,
        City: customerCompany.billingCity || undefined,
        CountrySubDivisionCode: customerCompany.billingProvince || undefined,
        PostalCode: customerCompany.billingPostalCode || undefined,
        Country: customerCompany.billingCountry || undefined,
      };
    }
  } else {
    if (location.address || location.city) {
      payload.BillAddr = {
        Line1: location.address || undefined,
        Line2: location.address2 || undefined,
        City: location.city || undefined,
        CountrySubDivisionCode: location.province || undefined,
        PostalCode: location.postalCode || undefined,
      };
    }
  }

  // ShipAddr is always the location's service address
  if (location.address || location.city) {
    payload.ShipAddr = {
      Line1: location.address || undefined,
      Line2: location.address2 || undefined,
      City: location.city || undefined,
      CountrySubDivisionCode: location.province || undefined,
      PostalCode: location.postalCode || undefined,
    };
  }

  // Build CustomerMemo to indicate the service location
  // This is especially important when billing to parent company
  const locationIdentifier = location.location 
    ? `${location.companyName} - ${location.location}`
    : location.companyName;
  
  let customerMemo = `Service Location: ${locationIdentifier} (Location ID: ${location.id})`;
  if (invoice.clientMessage) {
    customerMemo = `${invoice.clientMessage}\n\n${customerMemo}`;
  }
  payload.CustomerMemo = { value: customerMemo };

  // notesInternal → QBO PrivateNote mapping removed (2026-05-13).
  // The import adapter still writes notesInternal as a QBO snapshot; that is
  // the final blocker before the DB column DROP (see imports/InvoiceImportAdapter.ts).

  // Map line items with resolved mappings
  payload.Line = lines.map((line, index) => {
    const qboLine: QBOInvoiceLine = {
      LineNum: line.lineNumber || (index + 1),
      Description: line.description,
      Amount: parseFloat(line.quantity) * parseFloat(line.unitPrice),
      DetailType: "SalesItemLineDetail",
      SalesItemLineDetail: {
        Qty: parseFloat(line.quantity),
        UnitPrice: parseFloat(line.unitPrice),
      },
    };

    // Resolve ItemRef: explicit qboItemRefId -> catalog item's qboItemId -> error
    // No global default fallback — each catalog item must be synced to QBO individually.
    let itemRefId = line.qboItemRefId;

    // If no explicit mapping, check if line has productId with linked qboItemId
    if (!itemRefId && line.productId && itemQboIds?.has(line.productId)) {
      itemRefId = itemQboIds.get(line.productId) || null;
    }

    if (itemRefId) {
      qboLine.SalesItemLineDetail!.ItemRef = { value: itemRefId };
    }

    // Resolve TaxCodeRef: explicit -> company default based on taxRate -> none
    let taxCodeRefId = line.qboTaxCodeRefId;
    if (!taxCodeRefId && mappingConfig) {
      const taxRate = parseFloat(line.taxRate);
      if (taxRate > 0) {
        taxCodeRefId = mappingConfig.taxableCodeId || mappingConfig.taxableCode || null;
      } else {
        taxCodeRefId = mappingConfig.nonTaxableCodeId || mappingConfig.nonTaxableCode || null;
      }
    }
    if (taxCodeRefId) {
      qboLine.SalesItemLineDetail!.TaxCodeRef = { value: taxCodeRefId };
    }

    return qboLine;
  });

  // For updates, include Id and SyncToken
  if (forUpdate && invoice.qboInvoiceId && invoice.qboSyncToken) {
    payload.Id = invoice.qboInvoiceId;
    payload.SyncToken = invoice.qboSyncToken;
  }

  return payload;
}

// ============================================================
// INVOICE MAPPERS: QBO -> APP
// ============================================================

export interface ParsedQBOInvoice {
  qboInvoiceId: string;
  qboSyncToken: string;
  qboDocNumber: string | null;
  customerRefId: string;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  total: string;
  balance: string;
  customerMemo: string | null;
  privateNote: string | null;
  status: "draft" | "sent" | "paid" | "void";
  lines: ParsedQBOInvoiceLine[];
  billingAddress: {
    street: string | null;
    city: string | null;
    province: string | null;
    postalCode: string | null;
    country: string | null;
  };
  shippingAddress: {
    street: string | null;
    city: string | null;
    province: string | null;
    postalCode: string | null;
    country: string | null;
  };
}

export interface ParsedQBOInvoiceLine {
  lineNumber: number;
  description: string;
  quantity: string;
  unitPrice: string;
  lineSubtotal: string;
  qboItemRefId: string | null;
  qboTaxCodeRefId: string | null;
}

/**
 * Parses a QBO Invoice response and extracts relevant data
 */
export function fromQboInvoicePayload(qboInvoice: QBOInvoiceResponse): ParsedQBOInvoice {
  // Determine invoice status based on Balance
  // Balance of 0 typically means paid
  let status: ParsedQBOInvoice["status"] = "sent";
  if (qboInvoice.Balance === 0 && qboInvoice.TotalAmt > 0) {
    status = "paid";
  } else if (qboInvoice.TotalAmt === 0 && qboInvoice.Balance === 0) {
    // Possibly voided or zero-dollar invoice
    status = "void";
  }

  // Parse lines
  const lines: ParsedQBOInvoiceLine[] = qboInvoice.Line
    .filter(line => line.DetailType === "SalesItemLineDetail" && line.SalesItemLineDetail)
    .map((line, index) => ({
      lineNumber: line.LineNum || (index + 1),
      description: line.Description || "",
      quantity: (line.SalesItemLineDetail?.Qty || 1).toString(),
      unitPrice: (line.SalesItemLineDetail?.UnitPrice || 0).toString(),
      lineSubtotal: line.Amount.toString(),
      qboItemRefId: line.SalesItemLineDetail?.ItemRef?.value || null,
      qboTaxCodeRefId: line.SalesItemLineDetail?.TaxCodeRef?.value || null,
    }));

  return {
    qboInvoiceId: qboInvoice.Id,
    qboSyncToken: qboInvoice.SyncToken,
    qboDocNumber: qboInvoice.DocNumber || null,
    customerRefId: qboInvoice.CustomerRef.value,
    issueDate: qboInvoice.TxnDate,
    dueDate: qboInvoice.DueDate || null,
    currency: qboInvoice.CurrencyRef?.value || "CAD",
    total: qboInvoice.TotalAmt.toString(),
    balance: qboInvoice.Balance.toString(),
    customerMemo: qboInvoice.CustomerMemo?.value || null,
    privateNote: qboInvoice.PrivateNote || null,
    status,
    lines,
    billingAddress: {
      street: qboInvoice.BillAddr?.Line1 || null,
      city: qboInvoice.BillAddr?.City || null,
      province: qboInvoice.BillAddr?.CountrySubDivisionCode || null,
      postalCode: qboInvoice.BillAddr?.PostalCode || null,
      country: qboInvoice.BillAddr?.Country || null,
    },
    shippingAddress: {
      street: qboInvoice.ShipAddr?.Line1 || null,
      city: qboInvoice.ShipAddr?.City || null,
      province: qboInvoice.ShipAddr?.CountrySubDivisionCode || null,
      postalCode: qboInvoice.ShipAddr?.PostalCode || null,
      country: qboInvoice.ShipAddr?.Country || null,
    },
  };
}

/**
 * Extracts the location ID from a CustomerMemo field
 * Format: "... (Location ID: <id>)"
 */
export function extractLocationIdFromMemo(memo: string | null): string | null {
  if (!memo) return null;
  const match = memo.match(/\(Location ID: ([^)]+)\)/);
  return match ? match[1] : null;
}

// ============================================================
// PAYMENT MAPPERS: APP -> QBO
// ============================================================
//
// 2026-04-09: Outbound payment sync (one-way only). Locked product decisions:
//   - App is the source of truth; QBO mirrors.
//   - QBO sync NEVER mutates invoice.amountPaid / balance / status.
//   - Each local payment maps 1:1 to a QBO Payment row. The local payment
//     model has one invoice per payment, so QBO Payment.Line[].LinkedTxn[]
//     always has exactly one entry pointing at the parent invoice.
//   - Payment delete in our app maps to QBO `void` (preserves audit trail in
//     QBO accounting), not `delete`.
//   - The mapper produces a payload only. Field validation lives in
//     validatePaymentForSync (server/services/qbo/QboMapper.ts).

/**
 * QBO Payment line item — references the linked invoice transaction.
 * Each payment in our app has exactly one LinkedTxn entry.
 */
export interface QBOPaymentLine {
  Amount: number;
  LinkedTxn: Array<{
    TxnId: string;   // QBO Invoice.Id
    TxnType: "Invoice";
  }>;
}

/**
 * QBO Payment payload (the wire shape sent to POST /payment).
 * For updates, Id and SyncToken must be set.
 */
export interface QBOPaymentPayload {
  Id?: string;            // Only for updates / void
  SyncToken?: string;     // Required for updates / void
  TotalAmt: number;
  CustomerRef: { value: string };
  TxnDate: string;        // ISO date YYYY-MM-DD
  Line: QBOPaymentLine[];
  PaymentMethodRef?: { value: string };  // QBO PaymentMethod.Id (optional — QBO has its own list)
  PaymentRefNum?: string;                // Cheque #, transaction id, etc.
  PrivateNote?: string;                  // Internal note (not visible to customer in QBO)
  CurrencyRef?: { value: string };
  // For voids:
  void?: boolean;
}

/**
 * QBO Payment response (the wire shape returned by POST /payment).
 */
export interface QBOPaymentResponse {
  Id: string;
  SyncToken: string;
  TotalAmt: number;
  CustomerRef: { value: string; name?: string };
  TxnDate: string;
  Line?: QBOPaymentLine[];
  PaymentMethodRef?: { value: string; name?: string };
  PaymentRefNum?: string;
  PrivateNote?: string;
  MetaData?: {
    CreateTime: string;
    LastUpdatedTime: string;
  };
}

/**
 * Maps a local Payment + parent Invoice to a QBO Payment payload.
 *
 * Caller is responsible for ensuring `invoice.qboInvoiceId` is set
 * (validated separately by `validatePaymentForSync`). The customer ref
 * comes from the invoice's CustomerRef (resolved via the same
 * `determineCustomerRefId` logic the invoice service uses) — this
 * function takes the resolved id directly so the mapper stays pure.
 *
 * `forUpdate` controls whether `Id` and `SyncToken` are included for
 * QBO update / void operations. Updates require both.
 */
export function toQboPaymentPayload(
  payment: Payment,
  invoice: Invoice,
  customerRefId: string,
  forUpdate: boolean = false,
): QBOPaymentPayload {
  // QBO uses ISO date strings without time components
  const txnDate = payment.receivedAt
    ? new Date(payment.receivedAt).toISOString().split("T")[0]
    : new Date().toISOString().split("T")[0];

  const amountNum = parseFloat(payment.amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    throw new Error(`Invalid payment amount for QBO sync: ${payment.amount}`);
  }

  if (!invoice.qboInvoiceId) {
    throw new Error("Cannot build QBO payment payload: parent invoice has no qboInvoiceId");
  }

  const payload: QBOPaymentPayload = {
    TotalAmt: amountNum,
    CustomerRef: { value: customerRefId },
    TxnDate: txnDate,
    Line: [
      {
        Amount: amountNum,
        LinkedTxn: [
          {
            TxnId: invoice.qboInvoiceId,
            TxnType: "Invoice",
          },
        ],
      },
    ],
  };

  // Optional fields — only include when present so the QBO payload is minimal
  if (payment.reference) {
    payload.PaymentRefNum = payment.reference;
  }

  // Append a stable correlation marker to PrivateNote for round-trip identification
  // (helps support: a manual QBO query can find the matching local payment).
  const noteParts: string[] = [];
  if (payment.notes) noteParts.push(payment.notes);
  noteParts.push(`(Local payment ID: ${payment.id})`);
  payload.PrivateNote = noteParts.join(" ");

  if (invoice.currency && invoice.currency !== "CAD") {
    payload.CurrencyRef = { value: invoice.currency };
  }

  // For updates / voids, include Id and SyncToken
  if (forUpdate && payment.qboPaymentId && payment.qboSyncToken) {
    payload.Id = payment.qboPaymentId;
    payload.SyncToken = payment.qboSyncToken;
  }

  return payload;
}

