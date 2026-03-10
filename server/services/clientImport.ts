/**
 * Client CSV Import Service (v1)
 *
 * Handles the import pipeline:
 *   1. CSV parsing
 *   2. Header auto-mapping
 *   3. Row normalization + validation
 *   4. Row execution (create company → location → contact)
 *
 * Create-only. Exact company-name dedup. One row = one client package.
 * Does NOT write to legacy flat contact fields on client_locations.
 */

import {
  type ClientImportRow,
  type ColumnMapping,
  type ValidatedRow,
  type RowValidationError,
  type RowStatus,
  type ImportRowResult,
  HEADER_ALIASES,
  IMPORT_FIELD_DEFS,
} from "@shared/clientImportTypes";
import { normalizePostalCode, isValidPostalCode } from "../lib/addressNormalize";
import { customerCompanyRepository } from "../storage/customerCompanies";
import { clientContactRepository } from "../storage/clientContacts";
import { storage } from "../storage/index";
import { maybeGeocode } from "../utils/geocode";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { clientLocations } from "@shared/schema";

// ============================================================================
// CSV Parsing
// ============================================================================

/**
 * Parse CSV text into rows. Handles quoted fields with commas and newlines.
 * Returns [headers, ...dataRows] where each row is string[].
 */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++; // skip escaped quote
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        current.push(field);
        field = "";
      } else if (ch === "\r" && next === "\n") {
        current.push(field);
        field = "";
        rows.push(current);
        current = [];
        i++; // skip \n
      } else if (ch === "\n") {
        current.push(field);
        field = "";
        rows.push(current);
        current = [];
      } else {
        field += ch;
      }
    }
  }

  // Final field/row
  if (field || current.length > 0) {
    current.push(field);
    rows.push(current);
  }

  // Filter out completely empty rows
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

// ============================================================================
// Header Auto-Mapping
// ============================================================================

/**
 * Suggest field mappings from CSV headers using alias matching.
 */
export function suggestMappings(headers: string[]): ColumnMapping[] {
  const usedFields = new Set<string>();

  return headers.map((header, index) => {
    const normalized = header.trim().toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ");

    // Try exact alias match
    let targetField: keyof ClientImportRow | null = HEADER_ALIASES[normalized] ?? null;

    // Try without common prefixes/suffixes
    if (!targetField) {
      for (const [alias, field] of Object.entries(HEADER_ALIASES)) {
        if (normalized.includes(alias) || alias.includes(normalized)) {
          if (!usedFields.has(field)) {
            targetField = field;
            break;
          }
        }
      }
    }

    // Don't map the same field twice
    if (targetField && usedFields.has(targetField)) {
      targetField = null;
    }
    if (targetField) {
      usedFields.add(targetField);
    }

    return {
      csvHeader: header.trim(),
      csvIndex: index,
      targetField,
    };
  });
}

// ============================================================================
// Row Normalization
// ============================================================================

const TRUTHY = new Set(["true", "yes", "y", "1", "active"]);
const FALSY = new Set(["false", "no", "n", "0", "inactive"]);

function coerceBoolean(val: string | null | undefined): boolean | null {
  if (val == null) return null;
  const lower = val.trim().toLowerCase();
  if (!lower) return null;
  if (TRUTHY.has(lower)) return true;
  if (FALSY.has(lower)) return false;
  return null;
}

function trimOrNull(val: string | null | undefined): string | null {
  if (val == null) return null;
  const trimmed = val.trim();
  return trimmed || null;
}

/** Apply column mappings to a raw CSV row and produce a normalized ClientImportRow */
export function normalizeRow(
  rawValues: string[],
  mappings: ColumnMapping[]
): ClientImportRow {
  const raw: Record<string, string> = {};
  for (const m of mappings) {
    if (m.targetField && m.csvIndex < rawValues.length) {
      raw[m.targetField] = rawValues[m.csvIndex];
    }
  }

  return {
    companyName: (raw.companyName ?? "").trim(),
    legalName: trimOrNull(raw.legalName),
    companyPhone: trimOrNull(raw.companyPhone),
    companyEmail: trimOrNull(raw.companyEmail),
    isActive: coerceBoolean(raw.isActive),

    billingStreet: trimOrNull(raw.billingStreet),
    billingCity: trimOrNull(raw.billingCity),
    billingProvince: trimOrNull(raw.billingProvince),
    billingPostalCode: raw.billingPostalCode?.trim()
      ? normalizePostalCode(raw.billingPostalCode.trim())
      : null,
    billingCountry: trimOrNull(raw.billingCountry),

    locationName: trimOrNull(raw.locationName),
    serviceStreet: trimOrNull(raw.serviceStreet),
    serviceCity: trimOrNull(raw.serviceCity),
    serviceProvince: trimOrNull(raw.serviceProvince),
    servicePostalCode: raw.servicePostalCode?.trim()
      ? normalizePostalCode(raw.servicePostalCode.trim())
      : null,
    serviceCountry: trimOrNull(raw.serviceCountry),
    siteCode: trimOrNull(raw.siteCode),
    locationNotes: trimOrNull(raw.locationNotes),
    billWithParent: coerceBoolean(raw.billWithParent),

    contactFirstName: trimOrNull(raw.contactFirstName),
    contactLastName: trimOrNull(raw.contactLastName),
    contactEmail: trimOrNull(raw.contactEmail),
    contactPhone: trimOrNull(raw.contactPhone),
  };
}

// ============================================================================
// Row Validation
// ============================================================================

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate a single normalized row. Returns errors/warnings and match status.
 */
export async function validateRow(
  row: ClientImportRow,
  rowIndex: number,
  companyId: string,
  /** Cache of known company names to avoid repeated DB lookups */
  companyCache: Map<string, { exists: boolean; name: string }>
): Promise<ValidatedRow> {
  const errors: RowValidationError[] = [];
  const warnings: string[] = [];

  // --- Company name required ---
  if (!row.companyName) {
    errors.push({ field: "companyName", message: "Company name is required" });
  }

  // --- Email format ---
  if (row.companyEmail && !EMAIL_RE.test(row.companyEmail)) {
    errors.push({ field: "companyEmail", message: "Invalid email format" });
  }
  if (row.contactEmail && !EMAIL_RE.test(row.contactEmail)) {
    errors.push({ field: "contactEmail", message: "Invalid contact email format" });
  }

  // --- Postal code validation ---
  if (row.billingPostalCode && !isValidPostalCode(row.billingPostalCode)) {
    errors.push({ field: "billingPostalCode", message: "Invalid postal/zip code format" });
  }
  if (row.servicePostalCode && !isValidPostalCode(row.servicePostalCode)) {
    errors.push({ field: "servicePostalCode", message: "Invalid postal/zip code format" });
  }

  // --- Contact block validation ---
  const hasContact = !!(row.contactFirstName || row.contactLastName || row.contactEmail || row.contactPhone);
  if (hasContact) {
    const hasName = !!(row.contactFirstName?.trim() || row.contactLastName?.trim());
    const hasContactInfo = !!(row.contactEmail?.trim() || row.contactPhone?.trim());
    if (!hasName) {
      errors.push({ field: "contactFirstName", message: "Contact first or last name required when contact data present" });
    }
    if (!hasContactInfo) {
      errors.push({ field: "contactEmail", message: "Contact email or phone required when contact data present" });
    }
  }

  // --- Boolean coercion warnings ---
  if (row.isActive === null && row.companyName) {
    // isActive not specified, will default to true — no warning needed
  }

  // --- Warnings ---
  if (!row.locationName && row.companyName) {
    warnings.push("Location name blank — will default to company name");
  }
  if (!hasContact) {
    warnings.push("No contact data — no contact will be created");
  }
  if (!row.serviceStreet && !row.serviceCity) {
    warnings.push("No service address provided");
  }

  // --- Company match check ---
  let matchesExisting = false;
  let existingCompanyName: string | undefined;

  if (row.companyName) {
    const cacheKey = row.companyName.trim();
    if (!companyCache.has(cacheKey)) {
      const existing = await customerCompanyRepository.findCustomerCompanyByName(companyId, cacheKey);
      companyCache.set(cacheKey, {
        exists: !!existing,
        name: existing?.name ?? cacheKey,
      });
    }
    const cached = companyCache.get(cacheKey)!;
    matchesExisting = cached.exists;
    if (matchesExisting) {
      existingCompanyName = cached.name;
      warnings.push(`Company "${cached.name}" already exists — location will be added to it`);
    }
  }

  const status: RowStatus = errors.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "valid";

  return {
    rowIndex,
    status,
    errors,
    warnings,
    normalized: row,
    matchesExisting,
    existingCompanyName,
  };
}

// ============================================================================
// Import Execution
// ============================================================================

/**
 * Execute import for a single row. Creates company (or reuses), location, and optional contact.
 */
export async function executeRow(
  row: ClientImportRow,
  rowIndex: number,
  companyId: string,
  userId: string,
  /** Cache to avoid creating same company multiple times in one batch */
  companyResolveCache: Map<string, { id: string; name: string; created: boolean }>
): Promise<ImportRowResult> {
  const result: ImportRowResult = {
    rowIndex,
    success: false,
    companyCreated: false,
    contactCreated: false,
  };

  try {
    // 1) Resolve customer company (dedup by exact name)
    const companyName = row.companyName.trim();
    let resolvedCompany = companyResolveCache.get(companyName);

    if (!resolvedCompany) {
      const existing = await customerCompanyRepository.findCustomerCompanyByName(companyId, companyName);
      if (existing) {
        resolvedCompany = { id: existing.id, name: existing.name, created: false };
      } else {
        const created = await customerCompanyRepository.createCustomerCompany(companyId, {
          name: companyName,
          phone: row.companyPhone ?? null,
          email: row.companyEmail ?? null,
          billingStreet: row.billingStreet ?? null,
          billingCity: row.billingCity ?? null,
          billingProvince: row.billingProvince ?? null,
          billingPostalCode: row.billingPostalCode ?? null,
          billingCountry: row.billingCountry ?? null,
        });
        resolvedCompany = { id: created.id, name: created.name, created: true };
      }
      companyResolveCache.set(companyName, resolvedCompany);
    }

    result.companyId = resolvedCompany.id;
    result.companyName = resolvedCompany.name;
    result.companyCreated = resolvedCompany.created;

    // 2) Determine isPrimary for the new location
    // If company was just created in this batch (no prior locations), isPrimary = true
    // If company already existed, check if it already has a primary location
    let isPrimary = false;
    if (resolvedCompany.created) {
      // Check if another row in this batch already created a location for this company
      // The first location for a new company gets isPrimary=true
      const [existingLoc] = await db
        .select({ id: clientLocations.id })
        .from(clientLocations)
        .where(and(
          eq(clientLocations.companyId, companyId),
          eq(clientLocations.parentCompanyId, resolvedCompany.id),
        ))
        .limit(1);
      isPrimary = !existingLoc;
    } else {
      // Existing company — check if it has any primary location
      const [primaryLoc] = await db
        .select({ id: clientLocations.id })
        .from(clientLocations)
        .where(and(
          eq(clientLocations.companyId, companyId),
          eq(clientLocations.parentCompanyId, resolvedCompany.id),
          eq(clientLocations.isPrimary, true),
        ))
        .limit(1);
      isPrimary = !primaryLoc; // only primary if no existing primary
    }

    // 3) Create location
    const locationName = row.locationName || companyName;
    const locationData: Record<string, unknown> = {
      parentCompanyId: resolvedCompany.id,
      companyName,
      location: locationName,
      address: row.serviceStreet ?? null,
      city: row.serviceCity ?? null,
      province: row.serviceProvince ?? null,
      postalCode: row.servicePostalCode ?? null,
      country: row.serviceCountry ?? null,
      roofLadderCode: row.siteCode ?? null,
      notes: row.locationNotes ?? null,
      selectedMonths: [],
      inactive: false,
      isPrimary: isPrimary,
      billWithParent: row.billWithParent ?? true,
      needsDetails: false,
    };

    // Auto-geocode
    const geocoded = await maybeGeocode(locationData);
    const location = await storage.createClient(companyId, userId, geocoded as any);
    result.locationId = location.id;

    // 4) Create primary contact (if contact block present)
    const hasContact = !!(
      row.contactFirstName?.trim() ||
      row.contactLastName?.trim() ||
      row.contactEmail?.trim() ||
      row.contactPhone?.trim()
    );

    if (hasContact) {
      const contacts = await clientContactRepository.createContacts(companyId, [
        {
          customerCompanyId: resolvedCompany.id,
          locationId: null, // company-level contact
          firstName: row.contactFirstName?.trim() || "",
          lastName: row.contactLastName?.trim() || "",
          email: row.contactEmail?.trim() || null,
          phone: row.contactPhone?.trim() || null,
          roles: [],
          isPrimary: true,
        },
      ]);
      if (contacts.length > 0) {
        result.contactId = contacts[0].id;
        result.contactCreated = true;
      }
    }

    result.success = true;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}
