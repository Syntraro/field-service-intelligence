/**
 * InvoiceImportAdapter — canonical CSV invoice importer (2026-04-22).
 *
 * Generic-first by design: the adapter speaks the canonical field set
 * below, and every source (Jobber today, others later) is just a mapping
 * preset layered on top. Nothing in this file is Jobber-specific.
 *
 * Policy
 * ------
 *   • Customer companies MUST already exist — this adapter never
 *     auto-creates one. (Client import owns that flow.) A row whose
 *     clientName doesn't match an existing company fails the row.
 *   • Locations are resolved under the matched customer. Service address
 *     is preferred; absent that, the first active location is used.
 *   • Job linking is OPTIONAL. The first integer in the "Job #(s)" cell
 *     is looked up by `jobs.jobNumber`; if found AND the job belongs to
 *     the same matched customer, the invoice is linked. Otherwise the
 *     invoice imports unlinked — never a blocker.
 *   • Invoices import as FINALIZED historical totals — we record source
 *     truth, we do NOT recompute tax. This deliberately sidesteps the
 *     2026-03-18 `batchApplyLineTax()` performance baseline because that
 *     rule governs NEW invoices built by the app; historical imports have
 *     finalized numbers by definition.
 *   • A single "Imported Line Item" summary row is written per invoice,
 *     carrying the raw line-items text as description. No product catalog
 *     pollution (productId stays null). "Imported Expense" is skipped —
 *     the Jobber invoice export does not expose a distinct expense total;
 *     the jobs export does, so that's JobImportAdapter's domain.
 *   • Import provenance (source invoice #, job #, line-item text) is written
 *     into `workDescription` on the created invoice so the breakdown is
 *     visible without any legacy column dependency.
 */

import { eq, and, inArray, isNotNull } from "drizzle-orm";
import {
  customerCompanies,
  clientLocations,
  jobs,
  invoices,
  type InvoiceStatus,
} from "@shared/schema";
import { InvoiceRepository } from "../../../storage/invoices";
import {
  notDeletedClientFilter,
  notDeletedCustomerCompanyFilter,
  activeJobFilter,
} from "../../../storage/jobFilters";
import {
  normalizeForMatch,
  normalizeBusinessName,
  buildAddressCompositeKey,
  normalizeHeader,
  parseDate,
  parseMoney,
  trimOrNull,
} from "../normalizers";
import type { ImportAdapter, AdapterFieldDef } from "../types";
import type { RowOutcome } from "@shared/importPipeline/contracts";
import type {
  InvoiceImportRow,
  InvoiceImportDetails,
} from "@shared/importPipeline/zod/invoice";
import { INVOICE_FIELD_DEFS } from "@shared/importPipeline/zod/invoice";

// ============================================================================
// Field defs + header aliases
// ============================================================================

const FIELD_DEFS: readonly AdapterFieldDef[] = INVOICE_FIELD_DEFS.map((f) => ({
  ...f,
}));

// Canonical header aliases — every generic synonym we recognise without a
// preset. Provider-specific headers (Jobber's "Pre-tax total ($)" etc.)
// are added by the frontend preset before the user lands on the Map step.
const RAW_ALIASES: Record<string, keyof InvoiceImportRow> = {
  "invoice #": "invoiceNumber",
  "invoice number": "invoiceNumber",
  "invoice no": "invoiceNumber",
  "doc number": "invoiceNumber",
  "doc #": "invoiceNumber",

  subject: "subject",
  description: "subject",
  "invoice description": "subject",

  status: "status",
  "invoice status": "status",

  "created date": "createdDate",
  created: "createdDate",
  "date created": "createdDate",

  "issued date": "issuedDate",
  "issue date": "issuedDate",
  "invoice date": "issuedDate",
  issued: "issuedDate",

  "due date": "dueDate",
  due: "dueDate",

  "marked paid date": "paidDate",
  "paid date": "paidDate",
  "date paid": "paidDate",

  "client name": "clientName",
  client: "clientName",
  customer: "clientName",
  "customer name": "clientName",
  company: "clientName",
  "company name": "clientName",

  "client email": "clientEmail",
  email: "clientEmail",

  "client phone": "clientPhone",
  phone: "clientPhone",

  "billing street": "billingStreet",
  "billing address": "billingStreet",
  "billing city": "billingCity",
  "billing province": "billingProvince",
  "billing state": "billingProvince",
  "billing zip": "billingPostalCode",
  "billing postal code": "billingPostalCode",
  "billing postal": "billingPostalCode",

  "service street": "serviceStreet",
  "service address": "serviceStreet",
  "service city": "serviceCity",
  "service province": "serviceProvince",
  "service state": "serviceProvince",
  "service zip": "servicePostalCode",
  "service postal code": "servicePostalCode",
  "service postal": "servicePostalCode",

  "job #": "jobNumbers",
  "job #s": "jobNumbers",
  "job number": "jobNumbers",
  "job numbers": "jobNumbers",
  "linked job": "jobNumbers",
  "linked jobs": "jobNumbers",

  "line items": "lineItemsText",
  "line items text": "lineItemsText",

  "pre-tax total ($)": "subtotal",
  "pre-tax total": "subtotal",
  "pretax total": "subtotal",
  subtotal: "subtotal",

  "tax amount ($)": "taxAmount",
  "tax amount": "taxAmount",
  tax: "taxAmount",

  "tax (%)": "taxPercent",
  "tax %": "taxPercent",
  "tax percent": "taxPercent",

  "total ($)": "total",
  total: "total",
  "invoice total": "total",

  "balance ($)": "balance",
  balance: "balance",
  "outstanding balance": "balance",

  "deposit ($)": "deposit",
  "deposit $": "deposit",
  deposit: "deposit",

  "discount ($)": "discount",
  discount: "discount",

  "visits assigned to": "visitsAssignedTo",
  "assigned to": "visitsAssignedTo",
  technician: "visitsAssignedTo",
};

const HEADER_ALIASES: Record<string, string> = Object.fromEntries(
  Object.entries(RAW_ALIASES).map(([k, v]) => [normalizeHeader(k), v]),
);

// ============================================================================
// Preview-scope context — prefetched once per preview request
// ============================================================================

interface InvoicePreviewCtx {
  companies: { id: string; name: string | null }[];
  /** locations under matched customer companies, lazily populated. */
  locationsByCustomer: Map<string, LocationRow[]>;
  /** (jobNumber → { id, locationId, parentCompanyId }) for all active jobs. */
  jobsByNumber: Map<number, { id: string; locationId: string | null; parentCompanyId: string | null }>;
  /** Existing invoice numbers for collision checks. */
  existingInvoiceNumbers: Set<string>;
}

interface LocationRow {
  id: string;
  address: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  location: string | null;
  parentCompanyId: string | null;
}

// ============================================================================
// Status mapping — source strings to the canonical invoiceStatusEnum
// ============================================================================

const STATUS_MAP: Record<string, InvoiceStatus> = {
  draft: "draft",
  "awaiting payment": "awaiting_payment",
  awaiting: "awaiting_payment",
  sent: "sent",
  issued: "awaiting_payment",
  unpaid: "awaiting_payment",
  "past due": "awaiting_payment",
  overdue: "awaiting_payment",
  late: "awaiting_payment",
  paid: "paid",
  "partially paid": "partial_paid",
  "partial paid": "partial_paid",
  partial: "partial_paid",
  void: "voided",
  voided: "voided",
  cancelled: "voided",
  canceled: "voided",
  "bad debt": "voided",
};

function deriveStatusFromBalance(
  balance: number,
  total: number,
): InvoiceStatus {
  if (total <= 0) return "draft";
  if (balance <= 0) return "paid";
  if (balance >= total) return "awaiting_payment";
  return "partial_paid";
}

function resolveStatus(
  raw: string | null,
  balance: number,
  total: number,
): { status: InvoiceStatus; warning?: string } {
  if (!raw) {
    return { status: deriveStatusFromBalance(balance, total) };
  }
  const key = raw.trim().toLowerCase();
  const mapped = STATUS_MAP[key];
  if (mapped) return { status: mapped };
  // Unknown source status — fall back to balance-derived + warn so the
  // user can reconcile manually.
  return {
    status: deriveStatusFromBalance(balance, total),
    warning: `Unknown status "${raw}" — imported as "${deriveStatusFromBalance(
      balance,
      total,
    )}" based on balance`,
  };
}

// ============================================================================
// Adapter
// ============================================================================

export const invoiceImportAdapter: ImportAdapter<
  InvoiceImportRow,
  InvoiceImportDetails,
  InvoicePreviewCtx
> = {
  entity: "invoices",
  entityLabelPlural: "invoices",
  maxRows: 2000,
  maxBytes: 10_000_000,
  fieldDefs: FIELD_DEFS,
  headerAliases: HEADER_ALIASES,

  previewBanner() {
    return (
      "Invoices import as summarized financial lines for reporting. " +
      "Original line-item detail is saved in notes. When a matching Job # " +
      "is found, the invoice links to it automatically."
    );
  },

  normalizeRow(cells, mappings, _ctx) {
    const raw: Record<string, string> = {};
    for (const m of mappings) {
      if (m.targetField && m.csvIndex < cells.length) {
        raw[m.targetField] = cells[m.csvIndex];
      }
    }
    const T = (k: keyof InvoiceImportRow) => trimOrNull(raw[k]);
    return {
      invoiceNumber: T("invoiceNumber"),
      subject: T("subject"),
      status: T("status"),
      createdDate: T("createdDate"),
      issuedDate: T("issuedDate"),
      dueDate: T("dueDate"),
      paidDate: T("paidDate"),
      clientName: T("clientName"),
      clientEmail: T("clientEmail"),
      clientPhone: T("clientPhone"),
      billingStreet: T("billingStreet"),
      billingCity: T("billingCity"),
      billingProvince: T("billingProvince"),
      billingPostalCode: T("billingPostalCode"),
      serviceStreet: T("serviceStreet"),
      serviceCity: T("serviceCity"),
      serviceProvince: T("serviceProvince"),
      servicePostalCode: T("servicePostalCode"),
      jobNumbers: T("jobNumbers"),
      lineItemsText: T("lineItemsText"),
      subtotal: T("subtotal"),
      taxAmount: T("taxAmount"),
      taxPercent: T("taxPercent"),
      total: T("total"),
      balance: T("balance"),
      deposit: T("deposit"),
      discount: T("discount"),
      visitsAssignedTo: T("visitsAssignedTo"),
    };
  },

  async buildPreviewContext(ctx, _rows): Promise<InvoicePreviewCtx> {
    const { db } = await import("../../../db");

    const companies = await db
      .select({ id: customerCompanies.id, name: customerCompanies.name })
      .from(customerCompanies)
      .where(
        and(
          eq(customerCompanies.companyId, ctx.companyId),
          notDeletedCustomerCompanyFilter(),
        ),
      );

    // Active jobs — needed for optional job-number linking. One read per
    // preview (not per row) keeps this flat even on large imports.
    const jobRows = await db
      .select({
        id: jobs.id,
        jobNumber: jobs.jobNumber,
        locationId: jobs.locationId,
      })
      .from(jobs)
      .where(and(eq(jobs.companyId, ctx.companyId), activeJobFilter()));

    // Resolve parentCompanyId per job via a second bounded read so we can
    // verify the matched job belongs to the matched customer at validate
    // time (prevents cross-customer linkage accidents).
    const locationIds = Array.from(
      new Set(jobRows.map((j) => j.locationId).filter((v): v is string => !!v)),
    );
    const locRows =
      locationIds.length > 0
        ? await db
            .select({
              id: clientLocations.id,
              parentCompanyId: clientLocations.parentCompanyId,
            })
            .from(clientLocations)
            .where(inArray(clientLocations.id, locationIds))
        : [];
    const parentByLocation = new Map(locRows.map((l) => [l.id, l.parentCompanyId]));

    const jobsByNumber = new Map<
      number,
      { id: string; locationId: string | null; parentCompanyId: string | null }
    >();
    for (const j of jobRows) {
      if (typeof j.jobNumber === "number") {
        jobsByNumber.set(j.jobNumber, {
          id: j.id,
          locationId: j.locationId ?? null,
          parentCompanyId: j.locationId ? parentByLocation.get(j.locationId) ?? null : null,
        });
      }
    }

    const existingNumberRows = await db
      .select({ invoiceNumber: invoices.invoiceNumber })
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, ctx.companyId),
          isNotNull(invoices.invoiceNumber),
        ),
      );
    const existingInvoiceNumbers = new Set<string>();
    for (const row of existingNumberRows) {
      if (row.invoiceNumber) existingInvoiceNumbers.add(row.invoiceNumber);
    }

    return {
      companies,
      locationsByCustomer: new Map(),
      jobsByNumber,
      existingInvoiceNumbers,
    };
  },

  async validateRow(row, _idx, ctx, previewCtx) {
    const errors: { field: string; message: string }[] = [];
    const warnings: string[] = [];

    // ---- Required fields --------------------------------------------------
    if (!row.clientName) {
      errors.push({ field: "clientName", message: "Client name is required" });
    }

    const issuedDate = parseDate(row.issuedDate, ctx.timezone);
    if (!row.issuedDate) {
      errors.push({ field: "issuedDate", message: "Issued date is required" });
    } else if (!issuedDate) {
      errors.push({
        field: "issuedDate",
        message: `Issued date "${row.issuedDate}" could not be parsed`,
      });
    }

    if (row.dueDate && !parseDate(row.dueDate, ctx.timezone)) {
      warnings.push(
        `Due date "${row.dueDate}" could not be parsed — will be ignored`,
      );
    }
    if (row.paidDate && !parseDate(row.paidDate, ctx.timezone)) {
      warnings.push(
        `Marked paid date "${row.paidDate}" could not be parsed — will be ignored`,
      );
    }

    // ---- Totals -----------------------------------------------------------
    const subtotalStr = parseMoney(row.subtotal);
    const taxAmountStr = parseMoney(row.taxAmount);
    const totalStr = parseMoney(row.total);
    const balanceStr = parseMoney(row.balance);

    // At minimum we need a total OR a subtotal to build the invoice shell.
    if (!totalStr && !subtotalStr) {
      errors.push({
        field: "total",
        message: "Either Total or Pre-tax total must be provided",
      });
    }

    const totalN = totalStr ? Number(totalStr) : null;
    const subtotalN = subtotalStr ? Number(subtotalStr) : null;
    const taxAmountN = taxAmountStr ? Number(taxAmountStr) : 0;
    const balanceN = balanceStr ? Number(balanceStr) : totalN ?? 0;

    // ---- Customer match ---------------------------------------------------
    let matchedCustomerId: string | undefined;
    let matchedCustomerName: string | undefined;
    if (row.clientName) {
      const target = normalizeBusinessName(row.clientName);
      const targetFallback = normalizeForMatch(row.clientName);
      const matches = previewCtx.companies.filter((c) => {
        const n = c.name ?? "";
        return (
          normalizeBusinessName(n) === target ||
          normalizeForMatch(n) === targetFallback
        );
      });
      if (matches.length === 1) {
        matchedCustomerId = matches[0].id;
        matchedCustomerName = matches[0].name ?? undefined;
      } else if (matches.length > 1) {
        errors.push({
          field: "clientName",
          message: `Client "${row.clientName}" matches ${matches.length} customers — ambiguous`,
        });
      } else {
        errors.push({
          field: "clientName",
          message: `Client "${row.clientName}" not found — customers must be imported before invoices`,
        });
      }
    }

    // ---- Location match (needed because invoices.locationId is NOT NULL) --
    let matchedLocationId: string | undefined;
    let locationLabel: string | undefined;

    if (matchedCustomerId) {
      const locations = await loadLocationsForCustomer(
        previewCtx,
        ctx.companyId,
        matchedCustomerId,
      );
      if (locations.length === 0) {
        errors.push({
          field: "clientName",
          message: `Customer "${matchedCustomerName ?? row.clientName}" has no locations — import locations before invoices`,
        });
      } else {
        // Prefer an exact service-address match; fall back to the only
        // location; otherwise pick the first + warn.
        if (
          row.serviceStreet &&
          row.serviceCity &&
          row.serviceProvince &&
          row.servicePostalCode
        ) {
          const incoming = buildAddressCompositeKey(
            row.serviceStreet,
            row.serviceCity,
            row.serviceProvince,
            row.servicePostalCode,
          );
          const addressMatch = locations.find(
            (l) =>
              buildAddressCompositeKey(l.address, l.city, l.province, l.postalCode) ===
              incoming,
          );
          if (addressMatch) {
            matchedLocationId = addressMatch.id;
            locationLabel = addressMatch.location || addressMatch.address || "Matched location";
          }
        }
        if (!matchedLocationId) {
          const fallback = locations[0];
          matchedLocationId = fallback.id;
          locationLabel = fallback.location || fallback.address || "Default location";
          if (locations.length > 1) {
            warnings.push(
              `Service address did not match any location exactly — defaulted to "${locationLabel}"`,
            );
          }
        }
      }
    }

    // ---- Optional job linking --------------------------------------------
    let linkedJobId: string | undefined;
    let jobNumberParsed: number | undefined;
    if (row.jobNumbers) {
      const first = extractFirstInteger(row.jobNumbers);
      if (first !== null) {
        jobNumberParsed = first;
        const job = previewCtx.jobsByNumber.get(first);
        if (job && matchedCustomerId && job.parentCompanyId === matchedCustomerId) {
          linkedJobId = job.id;
        } else if (job && matchedCustomerId && job.parentCompanyId !== matchedCustomerId) {
          warnings.push(
            `Job #${first} exists but belongs to a different customer — invoice imported unlinked`,
          );
        } else if (!job) {
          warnings.push(
            `Job #${first} not found in the system — invoice imported unlinked`,
          );
        }
        // If there were additional numbers, flag them as dropped.
        if (/[,;/|]|\s{2,}/.test(row.jobNumbers)) {
          warnings.push(
            `"${row.jobNumbers}" contains multiple job numbers — only #${first} was considered for linkage`,
          );
        }
      }
    }

    // ---- Invoice number collision ----------------------------------------
    let invoiceNumberCollision = false;
    if (row.invoiceNumber && previewCtx.existingInvoiceNumbers.has(row.invoiceNumber)) {
      invoiceNumberCollision = true;
      warnings.push(
        `Invoice # "${row.invoiceNumber}" already exists — will import with a new number and preserve the source number in notes`,
      );
    }

    // ---- Status mapping --------------------------------------------------
    const { status, warning: statusWarning } = resolveStatus(
      row.status,
      balanceN,
      totalN ?? subtotalN ?? 0,
    );
    if (statusWarning) warnings.push(statusWarning);

    // ---- Line-item shape check (Jobber-format detection, preview surface)
    // Runs in preview so the user sees whether each row will import as
    // parsed multi-line or fall back to the summarized single line before
    // they commit. applyRow re-runs this as authoritative.
    if (row.lineItemsText) {
      const parse = parseJobberLineItems(row.lineItemsText);
      const effectiveSubtotal = subtotalN ?? (totalN != null ? totalN - taxAmountN : null);
      if (parse.ok) {
        const parsedSum = parse.items.reduce((s, l) => s + l.amount, 0);
        const drift = effectiveSubtotal != null ? Math.abs(parsedSum - effectiveSubtotal) : 0;
        if (effectiveSubtotal != null && drift > 0.05) {
          warnings.push(
            `Parsed line items sum to $${parsedSum.toFixed(2)} but invoice pre-tax total is $${effectiveSubtotal.toFixed(2)} — will import as one summarized line instead`,
          );
        } else {
          for (const w of parse.warnings) warnings.push(w);
        }
      } else if (parse.reason !== "empty") {
        warnings.push(
          `Line-item text could not be parsed (${parse.reason}) — will import as one summarized line`,
        );
      }
    }

    const hasErrors = errors.length > 0;
    const details: InvoiceImportDetails = {
      customerLabel: matchedCustomerName,
      locationLabel,
      linkedJobId,
      jobNumberParsed,
      statusMapped: status,
      invoiceNumberCollision,
    };

    const matchLabel = matchedCustomerName
      ? `${matchedCustomerName}${locationLabel ? ` — ${locationLabel}` : ""}${linkedJobId ? ` (→ Job #${jobNumberParsed})` : ""}`
      : undefined;

    return {
      errors,
      warnings,
      disposition: hasErrors ? "failed" : "created",
      matchLabel,
      details,
    };
  },

  classifyWithinCsv(rows) {
    // Dedupe by source invoiceNumber when present — two rows with the
    // same source number on the same import are almost certainly a
    // mistake; flag the second occurrence as blocked.
    const seen = new Map<string, number>();
    let withinCsvDuplicates = 0;
    for (const row of rows) {
      const raw = row.normalized.invoiceNumber;
      if (!raw) continue;
      const first = seen.get(raw);
      if (first === undefined) {
        seen.set(raw, row.rowIndex);
        continue;
      }
      if (row.status !== "blocked") {
        row.status = "blocked";
        row.disposition = "failed";
        row.errors.push({
          field: "invoiceNumber",
          message: `Duplicate Invoice # "${raw}" (first seen at row ${first + 1})`,
        });
      }
      withinCsvDuplicates++;
    }
    return { withinCsvDuplicates };
  },

  async applyRow(row, rowIndex, ctx, commitCtx): Promise<RowOutcome> {
    const tx = commitCtx.tx;

    // ---- Re-resolve customer inside the tx (same guard as JobImportAdapter)
    const companyNorm = normalizeBusinessName(row.clientName ?? "");
    const companyFallback = normalizeForMatch(row.clientName ?? "");
    const companyRows = await tx
      .select({ id: customerCompanies.id, name: customerCompanies.name })
      .from(customerCompanies)
      .where(
        and(
          eq(customerCompanies.companyId, ctx.companyId),
          notDeletedCustomerCompanyFilter(),
        ),
      );
    const customer = companyRows.find((c: { id: string; name: string | null }) => {
      const n = c.name ?? "";
      return normalizeBusinessName(n) === companyNorm || normalizeForMatch(n) === companyFallback;
    });
    if (!customer) {
      return { rowIndex, disposition: "failed", error: "Customer not found at commit time" };
    }

    // ---- Resolve the location under that customer -------------------------
    const locationRows = await tx
      .select({
        id: clientLocations.id,
        address: clientLocations.address,
        city: clientLocations.city,
        province: clientLocations.province,
        postalCode: clientLocations.postalCode,
        location: clientLocations.location,
      })
      .from(clientLocations)
      .where(
        and(
          eq(clientLocations.companyId, ctx.companyId),
          eq(clientLocations.parentCompanyId, customer.id),
          notDeletedClientFilter(),
        ),
      );
    if (locationRows.length === 0) {
      return { rowIndex, disposition: "failed", error: "Customer has no locations" };
    }
    let locationId = locationRows[0].id;
    if (row.serviceStreet && row.serviceCity && row.serviceProvince && row.servicePostalCode) {
      const incoming = buildAddressCompositeKey(
        row.serviceStreet,
        row.serviceCity,
        row.serviceProvince,
        row.servicePostalCode,
      );
      const match = locationRows.find(
        (l: LocationRow) =>
          buildAddressCompositeKey(l.address, l.city, l.province, l.postalCode) === incoming,
      );
      if (match) locationId = match.id;
    }

    // ---- Optional job linkage (idempotent re-lookup inside tx) ------------
    let jobId: string | null = null;
    if (row.jobNumbers) {
      const first = extractFirstInteger(row.jobNumbers);
      if (first !== null) {
        const jobRows = await tx
          .select({
            id: jobs.id,
            locationId: jobs.locationId,
          })
          .from(jobs)
          .where(
            and(
              eq(jobs.companyId, ctx.companyId),
              eq(jobs.jobNumber, first),
              activeJobFilter(),
            ),
          )
          .limit(1);
        if (jobRows[0]) {
          // Only link if the job's location belongs under the matched customer.
          const [loc] = await tx
            .select({ parentCompanyId: clientLocations.parentCompanyId })
            .from(clientLocations)
            .where(eq(clientLocations.id, jobRows[0].locationId))
            .limit(1);
          if (loc?.parentCompanyId === customer.id) {
            jobId = jobRows[0].id;
          }
        }
      }
    }

    // ---- Dates + totals + status -----------------------------------------
    const issuedDate = parseDate(row.issuedDate, ctx.timezone);
    if (!issuedDate) {
      return { rowIndex, disposition: "failed", error: "Issued date unparseable at commit" };
    }
    const dueDate = parseDate(row.dueDate, ctx.timezone);

    const totalStr = parseMoney(row.total) ?? "0.00";
    const subtotalStr =
      parseMoney(row.subtotal) ??
      // If subtotal missing, derive from total - tax so the two rows agree.
      (parseMoney(row.taxAmount)
        ? (Number(totalStr) - Number(parseMoney(row.taxAmount))).toFixed(2)
        : totalStr);
    const taxTotalStr = parseMoney(row.taxAmount) ?? "0.00";
    const balanceStr = parseMoney(row.balance) ?? totalStr;
    const totalN = Number(totalStr);
    const balanceN = Number(balanceStr);
    const amountPaidN = Math.max(0, totalN - balanceN);

    const { status } = resolveStatus(row.status, balanceN, totalN);

    // ---- Build invoice lines ---------------------------------------------
    // Preferred path: if `lineItemsText` parses cleanly as the Jobber shape
    // AND the parsed amounts sum to the source subtotal within $0.05, write
    // one canonical line per item. Otherwise fall back to the original
    // single summarized "Imported Line Item" — imports never fail on
    // unrecognised line-items text.
    const lineItemParseWarnings: string[] = [];
    const parse = parseJobberLineItems(row.lineItemsText);
    let lines: InvoiceLinePayload[];
    if (parse.ok) {
      const parsedSum = parse.items.reduce((s, l) => s + l.amount, 0);
      const sourceSubtotalN = Number(subtotalStr);
      const drift = Math.abs(parsedSum - sourceSubtotalN);
      if (drift <= 0.05) {
        lines = buildParsedInvoiceLines(parse.items, taxTotalStr, parsedSum);
        lineItemParseWarnings.push(...parse.warnings);
      } else {
        lines = buildSummarizedInvoiceLine(
          row.lineItemsText,
          subtotalStr,
          taxTotalStr,
        );
        lineItemParseWarnings.push(
          `Parsed line items sum to $${parsedSum.toFixed(2)} but invoice pre-tax total is $${sourceSubtotalN.toFixed(2)} — imported as one summarized line for consistency`,
        );
      }
    } else {
      lines = buildSummarizedInvoiceLine(row.lineItemsText, subtotalStr, taxTotalStr);
      if (row.lineItemsText && parse.reason !== "empty") {
        lineItemParseWarnings.push(
          `Line-item text could not be parsed (${parse.reason}) — imported as one summarized line`,
        );
      }
    }

    // ---- Invoice-number collision → drop the override ---------------------
    const existingRow = await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, ctx.companyId),
          ...(row.invoiceNumber
            ? [eq(invoices.invoiceNumber, row.invoiceNumber)]
            : []),
        ),
      )
      .limit(1);
    const safeInvoiceNumber = row.invoiceNumber && existingRow[0] ? null : row.invoiceNumber ?? null;

    // ---- Persist via canonical import path --------------------------------
    const invoiceRepo = new InvoiceRepository();
    const { invoice, invoiceNumber: writtenNumber } = await invoiceRepo.createImportedInvoice(
      ctx.companyId,
      {
        locationId,
        customerCompanyId: customer.id,
        jobId,
        invoiceNumber: safeInvoiceNumber,
        issueDate: toIsoDate(issuedDate),
        dueDate: dueDate ? toIsoDate(dueDate) : null,
        status,
        subtotal: subtotalStr,
        taxTotal: taxTotalStr,
        total: totalStr,
        amountPaid: amountPaidN.toFixed(2),
        balance: balanceStr,
        workDescription: row.subject ?? null,
      },
      lines,
      "IMPORT_ROUTE",
      tx,
    );

    const labelParts: string[] = [`Invoice ${writtenNumber}`];
    if (customer.name) labelParts.push(customer.name);
    if (jobId) labelParts.push(`→ Job #${row.jobNumbers}`);

    return {
      rowIndex,
      disposition: "created",
      entityId: invoice.id,
      entityLabel: labelParts.join(" — "),
    };
  },
};

// ============================================================================
// Helpers
// ============================================================================

async function loadLocationsForCustomer(
  ctx: InvoicePreviewCtx,
  tenantId: string,
  customerId: string,
): Promise<LocationRow[]> {
  const cached = ctx.locationsByCustomer.get(customerId);
  if (cached) return cached;
  const { db } = await import("../../../db");
  const rows = await db
    .select({
      id: clientLocations.id,
      address: clientLocations.address,
      city: clientLocations.city,
      province: clientLocations.province,
      postalCode: clientLocations.postalCode,
      location: clientLocations.location,
      parentCompanyId: clientLocations.parentCompanyId,
    })
    .from(clientLocations)
    .where(
      and(
        eq(clientLocations.companyId, tenantId),
        eq(clientLocations.parentCompanyId, customerId),
        notDeletedClientFilter(),
      ),
    );
  ctx.locationsByCustomer.set(customerId, rows);
  return rows;
}

function extractFirstInteger(raw: string): number | null {
  const match = raw.match(/\d+/);
  if (!match) return null;
  const n = parseInt(match[0], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function toIsoDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

// ============================================================================
// Jobber line-item parser (2026-04-22)
// ----------------------------------------------------------------------------
// Jobber's invoice "Line items" column is a single comma-joined string where
// each item ends in `(qty, $amount)` — qty is an integer, amount is the LINE
// total (not unit price). Descriptions may contain their own parentheses:
//     "Labour (Includes Travel) (2, $180.00), Truck Charge (1, $45.00)"
//
// Detection is shape-based, not preset-based — we only accept rows where
// EVERY item parses cleanly AND the sum of item amounts matches the source
// invoice subtotal within a $0.05 tolerance. Any miss falls back to the
// summarized single-line path with a preview warning, so the import never
// fails on line-items text we don't understand.
// ============================================================================

export interface ParsedJobberItem {
  description: string;
  qty: number;
  /** Line total in dollars (the raw source "$amount" — NOT unit price). */
  amount: number;
}

/**
 * Result type for the parser. `ok:false` branches carry a machine-friendly
 * `reason` string so the caller can build a targeted fallback warning.
 */
export type JobberLineItemsParseResult =
  | { ok: true; items: ParsedJobberItem[]; warnings: string[] }
  | { ok: false; reason: string };

/**
 * Split on top-level commas only — commas inside parentheses (e.g. the
 * `(2, $180.00)` metadata tail) must not separate items.
 */
function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * Parse a single item string. The tail regex anchors on the end of the
 * string so a description like "Labour (Includes Travel)" is not mistaken
 * for the metadata group.
 */
function parseItemTail(
  item: string,
): { description: string; qty: number; amount: number } | null {
  const m = item.match(
    /^(.*?)\s*\((\d+)\s*,\s*\$\s*([\d,]+(?:\.\d+)?)\s*\)\s*$/,
  );
  if (!m) return null;
  const description = m[1].trim();
  if (!description) return null;
  const qty = parseInt(m[2], 10);
  const amount = Number(m[3].replace(/,/g, ""));
  if (!Number.isFinite(qty) || !Number.isFinite(amount)) return null;
  return { description, qty, amount };
}

export function parseJobberLineItems(
  raw: string | null | undefined,
): JobberLineItemsParseResult {
  if (!raw || !raw.trim()) return { ok: false, reason: "empty" };

  const items = splitTopLevelCommas(raw);
  if (items.length === 0) return { ok: false, reason: "no items" };

  const out: ParsedJobberItem[] = [];
  const warnings: string[] = [];

  for (const item of items) {
    const t = parseItemTail(item);
    if (!t) {
      return {
        ok: false,
        reason: `item "${item.length > 40 ? item.slice(0, 37) + "…" : item}" did not match "<description> (qty, $amount)"`,
      };
    }
    let qty = t.qty;
    if (qty <= 0) {
      warnings.push(
        `Line "${t.description}": qty was ${t.qty}, defaulted to 1`,
      );
      qty = 1;
    }
    out.push({ description: t.description, qty, amount: t.amount });
  }

  return { ok: true, items: out, warnings };
}

export type InvoiceLinePayload = {
  description: string;
  quantity: string;
  unitPrice: string;
  unitCost: string | null;
  taxRate: string;
  lineSubtotal: string;
  taxAmount: string;
  lineTotal: string;
  lineItemType: "service" | "material" | "fee" | "discount";
};

/**
 * Fallback builder — one summarized "Imported Line Item" carrying the raw
 * line-items text. Mirrors the original (pre-parser) commit behavior so
 * parse failures land on the exact same fidelity the importer shipped with.
 */
function buildSummarizedInvoiceLine(
  rawLineItemsText: string | null | undefined,
  subtotalStr: string,
  taxTotalStr: string,
): InvoiceLinePayload[] {
  const description =
    rawLineItemsText && rawLineItemsText.trim()
      ? `Imported Line Item — ${rawLineItemsText.trim()}`
      : "Imported Line Item";
  const lineTotalStr = (Number(subtotalStr) + Number(taxTotalStr)).toFixed(2);
  return [
    {
      description,
      quantity: "1",
      unitPrice: subtotalStr,
      unitCost: null,
      taxRate: "0.0000",
      lineSubtotal: subtotalStr,
      taxAmount: taxTotalStr,
      lineTotal: lineTotalStr,
      lineItemType: "service",
    },
  ];
}

/**
 * Convert parsed Jobber items into canonical invoice-line payloads.
 * - `lineSubtotal` preserves the source line amount (truth).
 * - `unitPrice = amount / qty` via integer-cent math (2dp rounded display).
 *   For qty that does not divide evenly, unit price may round by 1¢ — line
 *   subtotal is still the source total so invoice math stays consistent.
 * - Tax is distributed proportionally across lines; the LAST line absorbs
 *   any rounding drift so `sum(line.taxAmount) === invoice.taxTotal` exactly.
 */
function buildParsedInvoiceLines(
  items: ParsedJobberItem[],
  invoiceTaxTotalStr: string,
  parsedSubtotal: number,
): InvoiceLinePayload[] {
  const taxTotalCents = Math.round(Number(invoiceTaxTotalStr) * 100);
  const rate = parsedSubtotal > 0 ? Number(invoiceTaxTotalStr) / parsedSubtotal : 0;
  const taxRateStr = rate.toFixed(4);

  const out: InvoiceLinePayload[] = [];
  let runningTaxCents = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const isLast = i === items.length - 1;
    const lineSubtotalCents = Math.round(it.amount * 100);
    const unitPriceCents =
      it.qty > 0 ? Math.round(lineSubtotalCents / it.qty) : lineSubtotalCents;
    const lineTaxCents = isLast
      ? taxTotalCents - runningTaxCents
      : Math.round(it.amount * rate * 100);
    if (!isLast) runningTaxCents += lineTaxCents;

    out.push({
      description: it.description,
      quantity: String(it.qty),
      unitPrice: (unitPriceCents / 100).toFixed(2),
      unitCost: null,
      taxRate: taxRateStr,
      lineSubtotal: (lineSubtotalCents / 100).toFixed(2),
      taxAmount: (lineTaxCents / 100).toFixed(2),
      lineTotal: ((lineSubtotalCents + lineTaxCents) / 100).toFixed(2),
      lineItemType: "service",
    });
  }
  return out;
}

// ============================================================================
// Ready-to-use pipeline
// ============================================================================

import { ImportPipeline } from "../ImportPipeline";
export const invoiceImportPipeline = new ImportPipeline(invoiceImportAdapter);
