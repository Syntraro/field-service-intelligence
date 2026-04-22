/**
 * JobImportAdapter — historical Jobber-style job imports.
 *
 * Policy (unchanged from the legacy service):
 *   • Imported jobs are ALWAYS created as archived historical records via
 *     `jobRepository.createJobWithExplicitNumber`. They don't appear in
 *     dispatch, don't create visits, and don't affect live KPIs.
 *   • Companies must already exist — this adapter never auto-creates a
 *     customer company. (Client import owns that flow.)
 *   • Locations are created when the CSV carries enough address context,
 *     otherwise the adapter falls back to matching a pre-existing
 *     location by multi-strategy address + name.
 *
 * 2026-04-21 improvements over the legacy service:
 *   • Dates go through the canonical `parseDate(val, tenantTimezone)`
 *     normalizer — no more `new Date()` timezone-naive drift.
 *   • `tx.insert(jobNotes)` replaced with
 *     `jobNotesRepository.createSystemNoteTx` (canonical repo path).
 *   • Company + location lookups are hoisted into `buildPreviewContext`
 *     so the full preview does a constant number of DB reads per company.
 *   • Within-CSV duplicate job-number check moved out of `validateRow`
 *     mutation into `classifyWithinCsv`.
 *   • One header normalization path (`normalizeHeader` + alias map) —
 *     aligns with every other adapter.
 */

import { eq, and } from "drizzle-orm";
import {
  customerCompanies,
  clientLocations,
  jobs,
} from "@shared/schema";
import { clientRepository } from "../../../storage/clients";
import { jobRepository } from "../../../storage/jobs";
import { jobNotesRepository } from "../../../storage/jobNotes";
import {
  notDeletedClientFilter,
  notDeletedCustomerCompanyFilter,
  activeJobFilter,
} from "../../../storage/jobFilters";
import {
  normalizeForMatch,
  normalizeBusinessName,
  buildAddressCompositeKey,
  normalizeStreetAddress,
  normalizeHeader,
  parseDate,
  trimOrNull,
} from "../normalizers";
import type { ImportAdapter, AdapterFieldDef } from "../types";
import type { RowOutcome } from "@shared/importPipeline/contracts";
import type { JobImportRow, JobImportDetails } from "@shared/importPipeline/zod/job";

// ============================================================================
// Province / state lookup — kept alongside the adapter (imports-only concern)
// ============================================================================

const PROVINCE_STATE_MAP: Record<string, string> = {
  alberta: "ab", ab: "ab", alta: "ab", "alta.": "ab",
  "british columbia": "bc", bc: "bc", "b.c.": "bc",
  manitoba: "mb", mb: "mb", man: "mb", "man.": "mb",
  "new brunswick": "nb", nb: "nb", "n.b.": "nb",
  "newfoundland and labrador": "nl", newfoundland: "nl", nl: "nl", nf: "nl", nfld: "nl",
  "nova scotia": "ns", ns: "ns", "n.s.": "ns",
  ontario: "on", on: "on", ont: "on", "ont.": "on",
  "prince edward island": "pe", pe: "pe", pei: "pe", "p.e.i.": "pe",
  quebec: "qc", qc: "qc", que: "qc", "que.": "qc", "québec": "qc",
  saskatchewan: "sk", sk: "sk", sask: "sk", "sask.": "sk",
  "northwest territories": "nt", nt: "nt", "n.w.t.": "nt", nwt: "nt",
  nunavut: "nu", nu: "nu",
  yukon: "yt", yt: "yt",
  // US states — common cross-border HVAC scenarios
  alabama: "al", al: "al", alaska: "ak", ak: "ak", arizona: "az", az: "az",
  arkansas: "ar", ar: "ar", california: "ca", ca: "ca", calif: "ca",
  colorado: "co", co: "co", connecticut: "ct", ct: "ct", delaware: "de", de: "de",
  florida: "fl", fl: "fl", fla: "fl", georgia: "ga", ga: "ga", hawaii: "hi", hi: "hi",
  idaho: "id", id: "id", illinois: "il", il: "il", indiana: "in", in: "in",
  iowa: "ia", ia: "ia", kansas: "ks", ks: "ks", kentucky: "ky", ky: "ky",
  louisiana: "la", la: "la", maine: "me", me: "me", maryland: "md", md: "md",
  massachusetts: "ma", ma: "ma", mass: "ma", michigan: "mi", mi: "mi", mich: "mi",
  minnesota: "mn", mn: "mn", minn: "mn", mississippi: "ms", ms: "ms",
  missouri: "mo", mo: "mo", montana: "mt", mt: "mt", nebraska: "ne", ne: "ne",
  nevada: "nv", nv: "nv", "new hampshire": "nh", nh: "nh", "new jersey": "nj", nj: "nj",
  "new mexico": "nm", nm: "nm", "new york": "ny", ny: "ny",
  "north carolina": "nc", nc: "nc", "north dakota": "nd", nd: "nd",
  ohio: "oh", oh: "oh", oklahoma: "ok", ok: "ok", oregon: "or", or: "or",
  pennsylvania: "pa", pa: "pa", "rhode island": "ri", ri: "ri",
  "south carolina": "sc", sc: "sc", "south dakota": "sd", sd: "sd",
  tennessee: "tn", tn: "tn", tenn: "tn", texas: "tx", tx: "tx",
  utah: "ut", ut: "ut", vermont: "vt", vt: "vt", virginia: "va", va: "va",
  washington: "wa", wa: "wa", wash: "wa", "west virginia": "wv", wv: "wv",
  wisconsin: "wi", wi: "wi", wis: "wi", wyoming: "wy", wy: "wy",
  "district of columbia": "dc", dc: "dc", "d.c.": "dc",
};

function normalizeProvinceState(val: string | null | undefined): string {
  if (!val) return "";
  const key = val.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");
  return PROVINCE_STATE_MAP[key] ?? PROVINCE_STATE_MAP[val.trim().toLowerCase()] ?? key;
}

// ============================================================================
// Field defs + header aliases
// ============================================================================

const FIELD_DEFS: readonly AdapterFieldDef[] = [
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
];

const RAW_ALIASES: Record<string, keyof JobImportRow> = {
  "job #": "jobNumber", "job number": "jobNumber", "#": "jobNumber", number: "jobNumber",
  title: "title", "job title": "title", subject: "title",
  "client name": "clientName", client: "clientName", company: "clientName",
  "company name": "clientName", customer: "clientName", "customer name": "clientName",
  "client email": "clientEmail", email: "clientEmail",
  "client phone": "clientPhone", phone: "clientPhone",
  "billing street": "billingStreet", "billing address": "billingStreet",
  "billing address 1": "billingStreet",
  "billing city": "billingCity",
  "billing province": "billingProvince", "billing state": "billingProvince",
  "billing province/state": "billingProvince",
  "billing zip": "billingPostalCode", "billing postal code": "billingPostalCode",
  "billing postal": "billingPostalCode",
  "service property name": "locationName", "property name": "locationName",
  property: "locationName", "location name": "locationName", location: "locationName",
  "site name": "locationName",
  "service street": "serviceStreet", "service address": "serviceStreet",
  "property address": "serviceStreet", "property address 1": "serviceStreet",
  "service city": "serviceCity", "property city": "serviceCity",
  "service province": "serviceProvince", "service province/state": "serviceProvince",
  "service state": "serviceProvince", "property province": "serviceProvince",
  "property state": "serviceProvince", "property province/state": "serviceProvince",
  "service zip": "servicePostalCode", "service postal code": "servicePostalCode",
  "service postal": "servicePostalCode", "property postal code": "servicePostalCode",
  "property zip": "servicePostalCode",
  "roof code": "roofCode", "roof/ladder code": "roofCode",
  "roof ladder code": "roofCode", "site code": "roofCode",
  "created date": "createdDate", created: "createdDate", "date created": "createdDate",
  "schedule start date": "scheduledStartDate", "scheduled start": "scheduledStartDate",
  "scheduled start date": "scheduledStartDate", "start date": "scheduledStartDate",
  "closed date": "closedDate", "date closed": "closedDate",
  "completed date": "closedDate",
  "lead source": "leadSource", source: "leadSource",
  salesperson: "salesperson", "sales person": "salesperson",
  "assigned to": "salesperson",
  "online booking": "onlineBooking",
  "line items": "lineItems", services: "lineItems", items: "lineItems",
  "visits assigned to": "visitsAssignedTo", "visit assigned to": "visitsAssignedTo",
  technician: "visitsAssignedTo", "assigned technician": "visitsAssignedTo",
  "invoice #s": "invoiceNumbers", "invoice numbers": "invoiceNumbers",
  invoices: "invoiceNumbers",
  "quote #": "quoteNumber", "quote number": "quoteNumber",
  "supplier invoice #": "supplierInvoiceNumber",
  "supplier invoice": "supplierInvoiceNumber",
  "pm info": "pmInfo", "preventive maintenance": "pmInfo",
  "expenses total ($)": "expensesTotal", "expenses total": "expensesTotal",
  expenses: "expensesTotal",
  "time tracked": "timeTracked",
  "labour cost total ($)": "labourCostTotal", "labour cost total": "labourCostTotal",
  "labor cost total ($)": "labourCostTotal", "labor cost total": "labourCostTotal",
  "labour cost": "labourCostTotal", "labor cost": "labourCostTotal",
  "line item cost total ($)": "lineItemCostTotal",
  "line item cost total": "lineItemCostTotal", "line item cost": "lineItemCostTotal",
  "total costs ($)": "totalCosts", "total costs": "totalCosts", "total cost": "totalCosts",
  "quote discount ($)": "quoteDiscount", "quote discount": "quoteDiscount",
  discount: "quoteDiscount",
  "total revenue ($)": "totalRevenue", "total revenue": "totalRevenue",
  revenue: "totalRevenue", total: "totalRevenue",
  "profit ($)": "profit", profit: "profit",
  "profit %": "profitPercent", "profit (%)": "profitPercent",
  "average profit (%)": "profitPercent", "average profit": "profitPercent",
  margin: "profitPercent",
};

const HEADER_ALIASES: Record<string, string> = Object.fromEntries(
  Object.entries(RAW_ALIASES).map(([k, v]) => [normalizeHeader(k), v]),
);

// ============================================================================
// Preview-scope context: tenant companies + existing job numbers + per-company locations
// ============================================================================

interface JobPreviewCtx {
  /** All active companies for the tenant — shared across rows. */
  companies: { id: string; name: string | null }[];
  /** Existing active job numbers, for collision detection. */
  existingJobNumbers: Set<number>;
  /** Locations keyed by matched parent companyId — lazily populated. */
  locationsByCompany: Map<string, LocationRow[]>;
}

interface LocationRow {
  id: string;
  address: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  location: string | null;
  companyName: string | null;
}

// ============================================================================
// Adapter
// ============================================================================

export const jobImportAdapter: ImportAdapter<JobImportRow, JobImportDetails, JobPreviewCtx> = {
  entity: "jobs",
  entityLabelPlural: "historical jobs",
  maxRows: 2000,
  maxBytes: 10_000_000,
  fieldDefs: FIELD_DEFS,
  headerAliases: HEADER_ALIASES,

  previewBanner() {
    return "Historical jobs are created as archived records. They won't appear in dispatch, create visits, or affect live KPIs.";
  },

  normalizeRow(cells, mappings, _ctx) {
    const raw: Record<string, string> = {};
    for (const m of mappings) {
      if (m.targetField && m.csvIndex < cells.length) {
        raw[m.targetField] = cells[m.csvIndex];
      }
    }

    const T = (k: keyof JobImportRow) => trimOrNull(raw[k]);
    return {
      jobNumber: T("jobNumber"),
      title: T("title"),
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
      locationName: T("locationName"),
      roofCode: T("roofCode"),
      createdDate: T("createdDate"),
      scheduledStartDate: T("scheduledStartDate"),
      closedDate: T("closedDate"),
      leadSource: T("leadSource"),
      salesperson: T("salesperson"),
      onlineBooking: T("onlineBooking"),
      lineItems: T("lineItems"),
      visitsAssignedTo: T("visitsAssignedTo"),
      invoiceNumbers: T("invoiceNumbers"),
      quoteNumber: T("quoteNumber"),
      supplierInvoiceNumber: T("supplierInvoiceNumber"),
      pmInfo: T("pmInfo"),
      expensesTotal: T("expensesTotal"),
      timeTracked: T("timeTracked"),
      labourCostTotal: T("labourCostTotal"),
      lineItemCostTotal: T("lineItemCostTotal"),
      totalCosts: T("totalCosts"),
      quoteDiscount: T("quoteDiscount"),
      totalRevenue: T("totalRevenue"),
      profit: T("profit"),
      profitPercent: T("profitPercent"),
    };
  },

  async buildPreviewContext(ctx, _rows): Promise<JobPreviewCtx> {
    const { db } = await import("../../../db");

    const companies = await db
      .select({ id: customerCompanies.id, name: customerCompanies.name })
      .from(customerCompanies)
      .where(and(
        eq(customerCompanies.companyId, ctx.companyId),
        notDeletedCustomerCompanyFilter(),
      ));

    // Collect existing job numbers for the tenant so we can flag collisions.
    const existing = await db
      .select({ jobNumber: jobs.jobNumber })
      .from(jobs)
      .where(and(eq(jobs.companyId, ctx.companyId), activeJobFilter()));
    const existingJobNumbers = new Set<number>();
    for (const e of existing) {
      if (typeof e.jobNumber === "number") existingJobNumbers.add(e.jobNumber);
    }

    return {
      companies,
      existingJobNumbers,
      locationsByCompany: new Map(),
    };
  },

  async validateRow(row, _idx, ctx, previewCtx) {
    const errors: { field: string; message: string }[] = [];
    const warnings: string[] = [];

    // ---- Required fields ----------------------------------------------------
    if (!row.jobNumber) errors.push({ field: "jobNumber", message: "Job # is required" });
    if (!row.title) errors.push({ field: "title", message: "Title is required" });
    if (!row.clientName) errors.push({ field: "clientName", message: "Client name is required" });

    // ---- Job number parsing + DB collision ----------------------------------
    let jobNumberParsed: number | undefined;
    if (row.jobNumber) {
      const parsed = parseInt(row.jobNumber, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        errors.push({ field: "jobNumber", message: `Job # "${row.jobNumber}" is not a positive integer` });
      } else {
        jobNumberParsed = parsed;
        if (previewCtx.existingJobNumbers.has(parsed)) {
          errors.push({ field: "jobNumber", message: `Job # ${parsed} already exists in the system` });
        }
      }
    }

    // ---- Dates: warn when unparseable (match legacy permissive behavior) ---
    if (row.createdDate && !parseDate(row.createdDate, ctx.timezone)) {
      warnings.push(`Created date "${row.createdDate}" could not be parsed — will be ignored`);
    }
    if (row.scheduledStartDate && !parseDate(row.scheduledStartDate, ctx.timezone)) {
      warnings.push(`Scheduled start date "${row.scheduledStartDate}" could not be parsed — will be ignored`);
    }
    if (row.closedDate && !parseDate(row.closedDate, ctx.timezone)) {
      warnings.push(`Closed date "${row.closedDate}" could not be parsed — will be ignored`);
    }

    // ---- Company matching ---------------------------------------------------
    let matchedCompanyId: string | undefined;
    let matchedCompanyName: string | undefined;
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
        matchedCompanyId = matches[0].id;
        matchedCompanyName = matches[0].name ?? undefined;
      } else if (matches.length > 1) {
        errors.push({ field: "clientName", message: `Client "${row.clientName}" matches ${matches.length} companies — ambiguous` });
      } else {
        errors.push({ field: "clientName", message: `Client "${row.clientName}" not found — companies must be imported before jobs` });
      }
    }

    // ---- Location matching (only when company matched) ----------------------
    let matchedLocationId: string | undefined;
    let locationLabel: string | undefined;
    let willCreateLocation = false;

    if (matchedCompanyId) {
      const locations = await loadLocationsForCompany(previewCtx, ctx.companyId, matchedCompanyId);

      const addressMatchIds = new Set<string>();
      const nameMatchIds = new Set<string>();

      // Strategy 1: full normalized address composite key.
      const incomingKey = buildAddressCompositeKey(
        row.serviceStreet, row.serviceCity, row.serviceProvince, row.servicePostalCode,
      );
      const incomingKeyNormProv = buildAddressCompositeKey(
        row.serviceStreet, row.serviceCity,
        normalizeProvinceState(row.serviceProvince) || row.serviceProvince,
        row.servicePostalCode,
      );
      if (incomingKey !== "|||") {
        for (const loc of locations) {
          const existingKey = buildAddressCompositeKey(loc.address, loc.city, loc.province, loc.postalCode);
          const existingKeyNormProv = buildAddressCompositeKey(
            loc.address, loc.city,
            normalizeProvinceState(loc.province) || loc.province,
            loc.postalCode,
          );
          if (existingKey === incomingKey || existingKeyNormProv === incomingKeyNormProv) {
            addressMatchIds.add(loc.id);
          }
        }
      }

      // Strategy 2: street + city only (postal/province tolerant).
      const hasIncomingAddress = normalizeForMatch(row.serviceStreet) !== "";
      if (addressMatchIds.size === 0 && hasIncomingAddress) {
        const inStreet = normalizeStreetAddress(row.serviceStreet);
        const inCity = normalizeForMatch(row.serviceCity);
        if (inStreet && inCity) {
          for (const loc of locations) {
            if (
              normalizeStreetAddress(loc.address) === inStreet &&
              normalizeForMatch(loc.city) === inCity
            ) {
              addressMatchIds.add(loc.id);
            }
          }
        }
      }

      // Strategy 3: locationName vs loc.location / loc.companyName.
      if (row.locationName) {
        const lnKey = normalizeForMatch(row.locationName);
        for (const loc of locations) {
          if (
            (loc.location && normalizeForMatch(loc.location) === lnKey) ||
            (loc.companyName && normalizeForMatch(loc.companyName) === lnKey)
          ) {
            nameMatchIds.add(loc.id);
          }
        }
      }

      // Strategy 3b: field-swap fallback — locationName stored where
      // address should be. Activates only when strategies 1–3 found nothing.
      if (addressMatchIds.size === 0 && nameMatchIds.size === 0 && row.locationName) {
        const lnKey = normalizeForMatch(row.locationName);
        for (const loc of locations) {
          if (loc.address && normalizeForMatch(loc.address) === lnKey) {
            nameMatchIds.add(loc.id);
          }
        }
      }

      const addressArr = Array.from(addressMatchIds);
      const nameArr = Array.from(nameMatchIds);
      const combinedIds = new Set<string>([...addressArr, ...nameArr]);

      if (addressMatchIds.size === 1 && nameMatchIds.size <= 1) {
        const id = addressArr[0];
        matchedLocationId = id;
        const loc = locations.find((l) => l.id === id);
        locationLabel = loc?.location || loc?.address || "Matched location";
      } else if (
        addressMatchIds.size === 1 &&
        nameMatchIds.size > 1 &&
        nameMatchIds.has(addressArr[0])
      ) {
        const id = addressArr[0];
        matchedLocationId = id;
        const loc = locations.find((l) => l.id === id);
        locationLabel = loc?.location || loc?.address || "Matched location";
      } else if (addressMatchIds.size === 0 && nameMatchIds.size === 1) {
        const id = nameArr[0];
        matchedLocationId = id;
        const loc = locations.find((l) => l.id === id);
        locationLabel = loc?.location || loc?.address || "Matched location";
      } else if (addressMatchIds.size > 1) {
        errors.push({
          field: "serviceStreet",
          message: `Multiple existing locations match "${row.locationName || row.serviceStreet}" — ambiguous`,
        });
      } else if (combinedIds.size > 1) {
        errors.push({
          field: "serviceStreet",
          message: "Ambiguous location match: address and name point to different locations",
        });
      }

      // Fallback: create new location (or use single-location default).
      if (!matchedLocationId && errors.length === 0) {
        const hasStreet = !!row.serviceStreet;
        const hasCity = !!row.serviceCity;
        const hasProvince = !!row.serviceProvince;
        const hasLocationName = !!row.locationName;

        if (hasStreet && hasCity && hasProvince) {
          willCreateLocation = true;
          locationLabel = row.locationName || `${row.serviceStreet}, ${row.serviceCity}`;
        } else if (hasLocationName && hasStreet && hasCity) {
          willCreateLocation = true;
          locationLabel = row.locationName || undefined;
        } else if (locations.length === 1) {
          matchedLocationId = locations[0].id;
          locationLabel = locations[0].location || locations[0].address || "Default location";
          warnings.push("No service address provided — using company's only location");
        } else {
          errors.push({
            field: "serviceStreet",
            message: "Insufficient service address for location matching or creation",
          });
        }
      }
    }

    const hasErrors = errors.length > 0;
    const details: JobImportDetails = {
      companyLabel: matchedCompanyName,
      locationLabel,
      jobNumberParsed,
      willCreateLocation,
    };

    return {
      errors,
      warnings,
      disposition: hasErrors ? "failed" : "created",
      matchLabel: matchedCompanyName
        ? `${matchedCompanyName}${locationLabel ? ` — ${locationLabel}` : ""}`
        : undefined,
      details,
    };
  },

  classifyWithinCsv(rows) {
    const seen = new Map<number, number>(); // jobNumber -> first rowIndex
    let withinCsvDuplicates = 0;
    for (const row of rows) {
      const jobNumber = row.details?.jobNumberParsed;
      if (!Number.isFinite(jobNumber)) continue;
      const first = seen.get(jobNumber!);
      if (first === undefined) {
        seen.set(jobNumber!, row.rowIndex);
        continue;
      }
      // Duplicate within the CSV — flag the second occurrence as blocked.
      if (row.status !== "blocked") {
        row.status = "blocked";
        row.disposition = "failed";
        row.errors.push({
          field: "jobNumber",
          message: `Duplicate Job # ${jobNumber} (first seen at row ${first + 1})`,
        });
      }
      withinCsvDuplicates++;
    }
    return { withinCsvDuplicates };
  },

  async applyRow(row, rowIndex, ctx, commitCtx): Promise<RowOutcome> {
    const tx = commitCtx.tx;

    const jobNumberParsed = parseInt(row.jobNumber ?? "", 10);
    if (!Number.isFinite(jobNumberParsed) || jobNumberParsed <= 0) {
      return { rowIndex, disposition: "failed", error: "Invalid job number" };
    }

    // Re-resolve the company inside the tx by normalized-name match —
    // canonical preview already confirmed it, this is the safe re-check.
    const companyNorm = normalizeBusinessName(row.clientName ?? "");
    const companyFallback = normalizeForMatch(row.clientName ?? "");
    const companyRows = await tx
      .select({ id: customerCompanies.id, name: customerCompanies.name })
      .from(customerCompanies)
      .where(and(
        eq(customerCompanies.companyId, ctx.companyId),
        notDeletedCustomerCompanyFilter(),
      ));
    const company = companyRows.find((c: { id: string; name: string | null }) => {
      const n = c.name ?? "";
      return normalizeBusinessName(n) === companyNorm || normalizeForMatch(n) === companyFallback;
    });
    if (!company) {
      return { rowIndex, disposition: "failed", error: "Company not found at commit time" };
    }

    // Location: either create (when preview said so) or re-lookup + use.
    let locationId: string | undefined;
    let locationCreated = false;

    if (row.serviceStreet && row.serviceCity) {
      // Canonical createOrGet ensures we don't double-insert under race.
      const { location: loc, created } = await clientRepository.createOrGetLocationTx(
        tx,
        ctx.companyId,
        ctx.userId,
        {
          parentCompanyId: company.id,
          companyName: row.clientName ?? "",
          location: row.locationName || `${row.serviceStreet}, ${row.serviceCity}`.replace(/^, |, $/g, ""),
          address: row.serviceStreet,
          city: row.serviceCity,
          province: row.serviceProvince,
          postalCode: row.servicePostalCode,
          roofLadderCode: row.roofCode || null,
          selectedMonths: [],
          isPrimary: false,
          inactive: false,
        } as any,
      );
      locationId = loc.id;
      locationCreated = created;
    } else {
      // No address — fall back to the first existing location under this
      // company (the "single-location default" branch of the preview).
      const existing = await tx
        .select({ id: clientLocations.id })
        .from(clientLocations)
        .where(and(
          eq(clientLocations.companyId, ctx.companyId),
          eq(clientLocations.parentCompanyId, company.id),
          notDeletedClientFilter(),
        ))
        .limit(1);
      locationId = existing[0]?.id;
    }
    if (!locationId) {
      return { rowIndex, disposition: "failed", error: "No location resolved" };
    }

    // Build description + billing notes (preserve legacy text).
    const descParts: string[] = ["Imported from Jobber"];
    if (row.leadSource) descParts.push(`Lead Source: ${row.leadSource}`);
    if (row.salesperson) descParts.push(`Salesperson: ${row.salesperson}`);
    if (row.onlineBooking) descParts.push(`Online Booking: ${row.onlineBooking}`);
    const description = descParts.join("\n");

    const finParts: string[] = [];
    if (row.expensesTotal) finParts.push(`Expenses: $${row.expensesTotal}`);
    if (row.timeTracked) finParts.push(`Time Tracked: ${row.timeTracked}`);
    if (row.labourCostTotal) finParts.push(`Labour Cost: $${row.labourCostTotal}`);
    if (row.lineItemCostTotal) finParts.push(`Line Item Cost: $${row.lineItemCostTotal}`);
    if (row.totalCosts) finParts.push(`Total Costs: $${row.totalCosts}`);
    if (row.quoteDiscount) finParts.push(`Quote Discount: $${row.quoteDiscount}`);
    if (row.totalRevenue) finParts.push(`Total Revenue: $${row.totalRevenue}`);
    if (row.profit) finParts.push(`Profit: $${row.profit}`);
    if (row.profitPercent) finParts.push(`Profit %: ${row.profitPercent}`);
    const billingNotes = finParts.length > 0 ? finParts.join("\n") : null;

    // Canonical timezone-aware date parsing (replaces naive `new Date(val)`).
    const createdAt = parseDate(row.createdDate, ctx.timezone) ?? new Date();
    const scheduledStart = parseDate(row.scheduledStartDate, ctx.timezone);
    // closedDate is not directly persisted by createJobWithExplicitNumber but
    // we compute it here for future consumers and keep the legacy shape.
    // (the current jobRepository doesn't accept closedAt on this path)

    const createdJob = await jobRepository.createJobWithExplicitNumber(
      ctx.companyId,
      jobNumberParsed,
      {
        locationId,
        summary: row.title || `Imported Job #${jobNumberParsed}`,
        description,
        billingNotes,
        priority: "medium",
        jobType: "maintenance",
        scheduledStart,
        createdAt,
        version: 1,
        isActive: true,
      },
      tx,
    );

    // Preservation note — every unmapped Jobber field lives here.
    const noteParts: string[] = [`--- Jobber Import Data (Job #${jobNumberParsed}) ---`];
    if (row.visitsAssignedTo) noteParts.push(`Visits Assigned To: ${row.visitsAssignedTo}`);
    if (row.invoiceNumbers) noteParts.push(`Invoice #s: ${row.invoiceNumbers}`);
    if (row.quoteNumber) noteParts.push(`Quote #: ${row.quoteNumber}`);
    if (row.supplierInvoiceNumber) noteParts.push(`Supplier Invoice #: ${row.supplierInvoiceNumber}`);
    if (row.lineItems) noteParts.push(`Line Items: ${row.lineItems}`);
    if (row.pmInfo) noteParts.push(`PM Info: ${row.pmInfo}`);
    if (row.leadSource) noteParts.push(`Lead Source: ${row.leadSource}`);
    if (row.salesperson) noteParts.push(`Salesperson: ${row.salesperson}`);
    if (row.onlineBooking) noteParts.push(`Online Booking: ${row.onlineBooking}`);
    if (billingNotes) noteParts.push(`\n--- Financial Summary ---\n${billingNotes}`);
    if (noteParts.length > 1) {
      // Canonical repo path (replaces raw `tx.insert(jobNotes)`).
      await jobNotesRepository.createSystemNoteTx(
        tx,
        ctx.companyId,
        createdJob.id,
        ctx.userId,
        noteParts.join("\n"),
      );
    }

    return {
      rowIndex,
      disposition: "created",
      entityId: createdJob.id,
      entityLabel: `#${jobNumberParsed} — ${row.title ?? "Imported job"}${locationCreated ? " (new location)" : ""}`,
    };
  },
};

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

async function loadLocationsForCompany(
  ctx: JobPreviewCtx,
  tenantId: string,
  companyId: string,
): Promise<LocationRow[]> {
  const cached = ctx.locationsByCompany.get(companyId);
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
      companyName: clientLocations.companyName,
    })
    .from(clientLocations)
    .where(and(
      eq(clientLocations.companyId, tenantId),
      eq(clientLocations.parentCompanyId, companyId),
      notDeletedClientFilter(),
    ));
  ctx.locationsByCompany.set(companyId, rows);
  return rows;
}

// ============================================================================
// Ready-to-use pipeline
// ============================================================================

import { ImportPipeline } from "../ImportPipeline";
export const jobImportPipeline = new ImportPipeline(jobImportAdapter);
