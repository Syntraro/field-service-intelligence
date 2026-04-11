/**
 * Job CSV Import Service — Jobber Jobs Export Compatibility
 *
 * Pipeline: parse CSV → map columns → normalize rows → validate → execute
 * All imported jobs are created with status="archived".
 * Companies must already exist (no auto-creation).
 * Locations may be auto-created under matched companies when address is sufficient.
 */

import { db } from "../db";
import { jobs, jobNotes, clientLocations, customerCompanies } from "@shared/schema";
import { eq, and, isNull, sql } from "drizzle-orm";
import { jobRepository } from "../storage/jobs";
import { notDeletedClientFilter, notDeletedCustomerCompanyFilter } from "../storage/jobFilters";
import { parseCSV } from "@shared/csvParser";
import {
  normalizeForMatch,
  normalizeBusinessName,
  buildAddressCompositeKey,
  normalizePostalForMatch,
  normalizeStreetAddress,
} from "@shared/normalizeForMatch";
import type {
  JobImportRow,
  JobColumnMapping,
} from "@shared/jobImportTypes";
import {
  JOB_HEADER_ALIASES,
  normalizeProvinceState,
} from "@shared/jobImportTypes";

// ============================================================================
// TYPES
// ============================================================================

export type RowStatus = "valid" | "warning" | "blocked";

export interface JobValidatedRow {
  rowIndex: number;
  row: JobImportRow;
  status: RowStatus;
  errors: string[];
  warnings: string[];
  companyAction: "match" | "blocked";
  companyId?: string;
  companyName?: string;
  locationAction: "match" | "create" | "blocked";
  locationId?: string;
  locationLabel?: string;
  jobNumberParsed?: number;
}

export interface JobImportPreviewResponse {
  totalRows: number;
  importableRows: number;
  warningRows: number;
  blockedRows: number;
  conflictRows: number;
  companyMatches: number;
  locationMatches: number;
  locationsToCreate: number;
  duplicateJobNumbers: number;
  existingJobNumbers: number;
  mappings: JobColumnMapping[];
  rows: JobValidatedRow[];
  notice: string;
}

export interface JobImportRowResult {
  rowIndex: number;
  success: boolean;
  jobId?: string;
  jobNumber?: number;
  locationCreated?: boolean;
  locationId?: string;
  error?: string;
}

export interface JobImportExecuteResponse {
  imported: number;
  locationsCreated: number;
  skipped: number;
  blocked: number;
  errors: number;
  results: JobImportRowResult[];
  counterReset: { newNextJobNumber: number } | null;
}

// ============================================================================
// HELPERS
// ============================================================================

function trimOrNull(val: string | null | undefined): string | null {
  if (val == null) return null;
  const trimmed = val.trim();
  // Treat "-" as blank (common Jobber pattern for empty fields)
  if (!trimmed || trimmed === "-") return null;
  return trimmed;
}

/** Parse a date string flexibly. Returns ISO string or null. */
function parseDate(val: string | null): string | null {
  if (!val) return null;
  const trimmed = val.trim();
  if (!trimmed || trimmed === "-") return null;

  // Try direct Date parse (handles ISO, "Jan 15, 2024", "2024-01-15", "01/15/2024")
  const d = new Date(trimmed);
  if (!isNaN(d.getTime()) && d.getFullYear() > 1900 && d.getFullYear() < 2100) {
    return d.toISOString();
  }
  return null;
}

// ============================================================================
// SUGGEST MAPPINGS (same algorithm as clientImport, different alias table)
// ============================================================================

export function suggestJobMappings(headers: string[]): JobColumnMapping[] {
  const usedFields = new Set<string>();
  return headers.map((header, csvIndex) => {
    const normalized = header.trim().toLowerCase().replace(/_/g, " ");
    const match = JOB_HEADER_ALIASES[normalized];
    if (match && !usedFields.has(match)) {
      usedFields.add(match);
      return { csvHeader: header, csvIndex, targetField: match };
    }
    return { csvHeader: header, csvIndex, targetField: null };
  });
}

// ============================================================================
// NORMALIZE ROW
// ============================================================================

export function normalizeJobRow(
  rawValues: string[],
  mappings: JobColumnMapping[],
): JobImportRow {
  const raw: Record<string, string> = {};
  for (const m of mappings) {
    if (m.targetField && m.csvIndex < rawValues.length) {
      raw[m.targetField] = rawValues[m.csvIndex];
    }
  }

  return {
    jobNumber: trimOrNull(raw.jobNumber),
    title: trimOrNull(raw.title),
    clientName: trimOrNull(raw.clientName),
    clientEmail: trimOrNull(raw.clientEmail),
    clientPhone: trimOrNull(raw.clientPhone),
    billingStreet: trimOrNull(raw.billingStreet),
    billingCity: trimOrNull(raw.billingCity),
    billingProvince: trimOrNull(raw.billingProvince),
    billingPostalCode: trimOrNull(raw.billingPostalCode),
    serviceStreet: trimOrNull(raw.serviceStreet),
    serviceCity: trimOrNull(raw.serviceCity),
    serviceProvince: trimOrNull(raw.serviceProvince),
    servicePostalCode: trimOrNull(raw.servicePostalCode),
    locationName: trimOrNull(raw.locationName),
    roofCode: trimOrNull(raw.roofCode),
    createdDate: trimOrNull(raw.createdDate),
    scheduledStartDate: trimOrNull(raw.scheduledStartDate),
    closedDate: trimOrNull(raw.closedDate),
    leadSource: trimOrNull(raw.leadSource),
    salesperson: trimOrNull(raw.salesperson),
    onlineBooking: trimOrNull(raw.onlineBooking),
    lineItems: trimOrNull(raw.lineItems),
    visitsAssignedTo: trimOrNull(raw.visitsAssignedTo),
    invoiceNumbers: trimOrNull(raw.invoiceNumbers),
    quoteNumber: trimOrNull(raw.quoteNumber),
    supplierInvoiceNumber: trimOrNull(raw.supplierInvoiceNumber),
    pmInfo: trimOrNull(raw.pmInfo),
    expensesTotal: trimOrNull(raw.expensesTotal),
    timeTracked: trimOrNull(raw.timeTracked),
    labourCostTotal: trimOrNull(raw.labourCostTotal),
    lineItemCostTotal: trimOrNull(raw.lineItemCostTotal),
    totalCosts: trimOrNull(raw.totalCosts),
    quoteDiscount: trimOrNull(raw.quoteDiscount),
    totalRevenue: trimOrNull(raw.totalRevenue),
    profit: trimOrNull(raw.profit),
    profitPercent: trimOrNull(raw.profitPercent),
  };
}

// ============================================================================
// VALIDATE ROW
// ============================================================================

export async function validateJobRow(
  row: JobImportRow,
  rowIndex: number,
  companyId: string,
  existingJobNumbers: Set<number>,
  csvJobNumbers: Map<number, number>, // jobNumber -> first rowIndex
): Promise<JobValidatedRow> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let status: RowStatus = "valid";

  // --- Required fields ---
  if (!row.jobNumber) {
    errors.push("Job # is required");
  }
  if (!row.title) {
    errors.push("Title is required");
  }
  if (!row.clientName) {
    errors.push("Client name is required");
  }

  // --- Parse job number ---
  let jobNumberParsed: number | undefined;
  if (row.jobNumber) {
    const parsed = parseInt(row.jobNumber, 10);
    if (isNaN(parsed) || parsed <= 0) {
      errors.push(`Job # "${row.jobNumber}" is not a valid positive integer`);
    } else {
      jobNumberParsed = parsed;
      // Check within-CSV duplicate
      const firstSeen = csvJobNumbers.get(parsed);
      if (firstSeen !== undefined && firstSeen !== rowIndex) {
        errors.push(`Duplicate Job # ${parsed} (first seen at row ${firstSeen + 1})`);
      } else {
        csvJobNumbers.set(parsed, rowIndex);
      }
      // Check against existing DB jobs
      if (existingJobNumbers.has(parsed)) {
        errors.push(`Job # ${parsed} already exists in the system`);
      }
    }
  }

  // --- Date validation ---
  if (row.createdDate && !parseDate(row.createdDate)) {
    warnings.push(`Created date "${row.createdDate}" could not be parsed — will be ignored`);
  }
  if (row.scheduledStartDate && !parseDate(row.scheduledStartDate)) {
    warnings.push(`Scheduled start date "${row.scheduledStartDate}" could not be parsed — will be ignored`);
  }
  if (row.closedDate && !parseDate(row.closedDate)) {
    warnings.push(`Closed date "${row.closedDate}" could not be parsed — will be ignored`);
  }

  // --- Company matching ---
  let companyAction: "match" | "blocked" = "blocked";
  let matchedCompanyId: string | undefined;
  let matchedCompanyName: string | undefined;

  if (row.clientName) {
    const normalizedName = normalizeBusinessName(row.clientName);
    if (normalizedName) {
      // Also try exact normalizeForMatch (non-suffix-stripped) for broader compatibility
      const [byBizName] = await db
        .select({ id: customerCompanies.id, name: customerCompanies.name, nameNormalized: customerCompanies.nameNormalized })
        .from(customerCompanies)
        .where(and(
          eq(customerCompanies.companyId, companyId),
          notDeletedCustomerCompanyFilter(),
        ));

      // Fetch all companies and match manually for flexibility
      const allCompanies = await db
        .select({ id: customerCompanies.id, name: customerCompanies.name, nameNormalized: customerCompanies.nameNormalized })
        .from(customerCompanies)
        .where(and(
          eq(customerCompanies.companyId, companyId),
          notDeletedCustomerCompanyFilter(),
        ));

      const exactMatches = allCompanies.filter(c =>
        normalizeBusinessName(c.name ?? "") === normalizedName ||
        normalizeForMatch(c.name ?? "") === normalizeForMatch(row.clientName!)
      );

      if (exactMatches.length === 1) {
        companyAction = "match";
        matchedCompanyId = exactMatches[0].id;
        matchedCompanyName = exactMatches[0].name ?? undefined;
      } else if (exactMatches.length > 1) {
        errors.push(`Client "${row.clientName}" matches ${exactMatches.length} companies — ambiguous`);
      } else {
        errors.push(`Client "${row.clientName}" not found — companies must be imported before jobs`);
      }
    }
  }

  // --- Location matching (multi-strategy, scoped to matched company) ---
  let locationAction: "match" | "create" | "blocked" = "blocked";
  let matchedLocationId: string | undefined;
  let locationLabel: string | undefined;

  if (matchedCompanyId) {
    const existingLocations = await db
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
        eq(clientLocations.companyId, companyId),
        eq(clientLocations.parentCompanyId, matchedCompanyId),
        notDeletedClientFilter(),
      ));

    // Collect match candidates from independent strategies, then resolve
    // Each strategy records matched location IDs; we combine signals at the end
    const addressMatchIds = new Set<string>();
    const nameMatchIds = new Set<string>();

    // --- Strategy 1: Full normalized address composite key ---
    // Uses normalizePostalForMatch + normalizeProvinceState for tolerance
    const incomingKey = buildAddressCompositeKey(
      row.serviceStreet, row.serviceCity, row.serviceProvince, row.servicePostalCode
    );
    const incomingKeyNormProv = buildAddressCompositeKey(
      row.serviceStreet, row.serviceCity,
      normalizeProvinceState(row.serviceProvince) || row.serviceProvince,
      row.servicePostalCode
    );
    const hasIncomingAddress = normalizeForMatch(row.serviceStreet) !== "";

    if (incomingKey !== "|||") {
      for (const loc of existingLocations) {
        const existingKey = buildAddressCompositeKey(loc.address, loc.city, loc.province, loc.postalCode);
        const existingKeyNormProv = buildAddressCompositeKey(
          loc.address, loc.city,
          normalizeProvinceState(loc.province) || loc.province,
          loc.postalCode
        );
        if (existingKey === incomingKey || existingKeyNormProv === incomingKeyNormProv) {
          addressMatchIds.add(loc.id);
        }
      }
    }

    // --- Strategy 2: Street + city match (ignoring province/postal) ---
    // Catches cases where postal code is missing in one source or province
    // format differs. Uses normalizeStreetAddress for suffix tolerance.
    if (addressMatchIds.size === 0 && hasIncomingAddress) {
      const inStreet = normalizeStreetAddress(row.serviceStreet);
      const inCity = normalizeForMatch(row.serviceCity);

      if (inStreet && inCity) {
        for (const loc of existingLocations) {
          const locStreet = normalizeStreetAddress(loc.address);
          const locCity = normalizeForMatch(loc.city);
          if (locStreet === inStreet && locCity === inCity) {
            addressMatchIds.add(loc.id);
          }
        }
      }
    }

    // --- Strategy 3: Location / property name match ---
    // Checks incoming locationName against both loc.location and loc.companyName
    if (row.locationName) {
      const normalizedLocName = normalizeForMatch(row.locationName);
      for (const loc of existingLocations) {
        if (
          (loc.location && normalizeForMatch(loc.location) === normalizedLocName) ||
          (loc.companyName && normalizeForMatch(loc.companyName) === normalizedLocName)
        ) {
          nameMatchIds.add(loc.id);
        }
      }
    }

    // --- Strategy 3b: Field-swap detection ---
    // During client import, some locations had property name stored in the address
    // field and company name stored in the location field (field mapping swap).
    // If no matches yet, check if incoming locationName matches DB address field.
    // Only activates when both address and name strategies found nothing.
    if (addressMatchIds.size === 0 && nameMatchIds.size === 0 && row.locationName) {
      const normalizedLocName = normalizeForMatch(row.locationName);
      for (const loc of existingLocations) {
        if (loc.address && normalizeForMatch(loc.address) === normalizedLocName) {
          nameMatchIds.add(loc.id);
        }
      }
    }

    // --- Resolve match from collected signals ---
    // Priority: both signals agree > single unique address match > single unique name match
    const addressArr = Array.from(addressMatchIds);
    const nameArr = Array.from(nameMatchIds);
    const combinedIds = new Set(addressArr.concat(nameArr));

    if (addressMatchIds.size === 1 && nameMatchIds.size <= 1) {
      // Address match is authoritative (possibly confirmed by name)
      const id = addressArr[0];
      locationAction = "match";
      matchedLocationId = id;
      const loc = existingLocations.find(l => l.id === id);
      locationLabel = loc?.location || loc?.address || "Matched location";
    } else if (addressMatchIds.size === 1 && nameMatchIds.size > 1 && nameMatchIds.has(addressArr[0])) {
      // Address uniquely resolves and is included in the (non-discriminating) name matches.
      // Common pattern: all locations under a holding company share the same companyName,
      // so name matching returns all of them — but address pinpoints the correct one.
      // Safe because name isn't contradicting address, just non-specific.
      const id = addressArr[0];
      locationAction = "match";
      matchedLocationId = id;
      const loc = existingLocations.find(l => l.id === id);
      locationLabel = loc?.location || loc?.address || "Matched location";
    } else if (addressMatchIds.size === 0 && nameMatchIds.size === 1) {
      // Name-only match: unique within company, safe
      const id = nameArr[0];
      locationAction = "match";
      matchedLocationId = id;
      const loc = existingLocations.find(l => l.id === id);
      locationLabel = loc?.location || loc?.address || "Matched location";
    } else if (addressMatchIds.size > 1) {
      // Multiple address candidates — block to prevent wrong match
      errors.push(`Multiple existing locations match for "${row.locationName || row.serviceStreet}" — ambiguous`);
    } else if (combinedIds.size > 1) {
      // Address and name strategies found different candidates — conflict
      errors.push(`Ambiguous location match: address and name point to different locations`);
    }

    // --- Fallback: auto-create or single-location default ---
    if (locationAction === "blocked" && errors.length === 0) {
      const hasStreet = !!row.serviceStreet;
      const hasCity = !!row.serviceCity;
      const hasProvince = !!row.serviceProvince;
      const hasLocationName = !!row.locationName;

      if (hasStreet && hasCity && hasProvince) {
        locationAction = "create";
        locationLabel = row.locationName || `${row.serviceStreet}, ${row.serviceCity}`;
      } else if (hasLocationName && hasStreet && hasCity) {
        locationAction = "create";
        locationLabel = row.locationName || undefined;
      } else if (existingLocations.length === 1) {
        // Single-location company: use the only location
        locationAction = "match";
        matchedLocationId = existingLocations[0].id;
        locationLabel = existingLocations[0].location || existingLocations[0].address || "Default location";
        warnings.push("No service address provided — using company's only location");
      } else {
        errors.push("Insufficient service address for location matching or creation");
      }
    }
  }

  // --- Determine overall status ---
  if (errors.length > 0) status = "blocked";
  else if (warnings.length > 0) status = "warning";

  return {
    rowIndex,
    row,
    status,
    errors,
    warnings,
    companyAction,
    companyId: matchedCompanyId,
    companyName: matchedCompanyName,
    locationAction,
    locationId: matchedLocationId,
    locationLabel,
    jobNumberParsed,
  };
}

// ============================================================================
// EXECUTE ROW
// ============================================================================

export async function executeJobRow(
  validated: JobValidatedRow,
  companyId: string,
  userId: string,
  storage: any, // JobRepository
): Promise<JobImportRowResult> {
  const { row, rowIndex, companyId: matchedCompanyId, locationId: matchedLocationId, locationAction, jobNumberParsed } = validated;

  if (validated.status === "blocked" || !jobNumberParsed || !matchedCompanyId) {
    return { rowIndex, success: false, error: validated.errors.join("; ") };
  }

  try {
    return await db.transaction(async (tx) => {
      let locationId = matchedLocationId;
      let locationCreated = false;

      // Create location if needed
      if (locationAction === "create" && !locationId) {
        const serviceProvNorm = normalizeProvinceState(row.serviceProvince);
        const [newLoc] = await tx
          .insert(clientLocations)
          .values({
            companyId,
            parentCompanyId: matchedCompanyId,
            companyName: row.clientName || "",
            location: row.locationName || `${row.serviceStreet || ""}, ${row.serviceCity || ""}`.replace(/^, |, $/g, ""),
            address: row.serviceStreet,
            city: row.serviceCity,
            province: row.serviceProvince,   // Store original value, not normalized
            postalCode: row.servicePostalCode,
            roofLadderCode: row.roofCode || null,
            selectedMonths: [],
            isPrimary: false,
            inactive: false,
          } as any)
          .returning({ id: clientLocations.id });
        locationId = newLoc.id;
        locationCreated = true;
      }

      if (!locationId) {
        return { rowIndex, success: false, error: "No location resolved" };
      }

      // Build description (short structured import summary)
      const descParts: string[] = ["Imported from Jobber"];
      if (row.leadSource) descParts.push(`Lead Source: ${row.leadSource}`);
      if (row.salesperson) descParts.push(`Salesperson: ${row.salesperson}`);
      if (row.onlineBooking) descParts.push(`Online Booking: ${row.onlineBooking}`);
      const description = descParts.join("\n");

      // Build billing_notes (financial summary)
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

      // Parse dates
      const createdAt = parseDate(row.createdDate) ? new Date(parseDate(row.createdDate)!) : new Date();
      const scheduledStart = parseDate(row.scheduledStartDate) ? new Date(parseDate(row.scheduledStartDate)!) : null;
      const closedAt = parseDate(row.closedDate) ? new Date(parseDate(row.closedDate)!) : null;

      // 2026-03-20 F-01: Route through canonical storage method instead of
      // direct tx.insert(jobs). Preserves multi-entity atomicity via txHandle.
      const createdJob = await jobRepository.createJobWithExplicitNumber(
        companyId,
        jobNumberParsed,
        {
          locationId,
          summary: row.title || `Imported Job #${jobNumberParsed}`,
          description,
          billingNotes: billingNotes,
          priority: "medium",
          jobType: "maintenance",
          scheduledStart,
          createdAt,
          version: 1,
          isActive: true,
        },
        tx,
      );

      // Create preservation job_note with full unmapped data
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
        await tx.insert(jobNotes).values({
          companyId,
          jobId: createdJob.id,
          userId,
          noteText: noteParts.join("\n"),
        });
      }

      return {
        rowIndex,
        success: true,
        jobId: createdJob.id,
        jobNumber: jobNumberParsed,
        locationCreated,
        locationId,
      };
    });
  } catch (err: any) {
    // Handle unique constraint violation on job_number
    if (err.code === "23505" && err.constraint?.includes("job_number")) {
      return { rowIndex, success: false, error: `Job # ${jobNumberParsed} already exists (constraint violation)` };
    }
    return { rowIndex, success: false, error: err.message?.substring(0, 200) };
  }
}

// ============================================================================
// RE-EXPORT parseCSV for route convenience
// ============================================================================
export { parseCSV } from "@shared/csvParser";
