/**
 * Client CSV Import Service (v2 — Production Hardened)
 *
 * Handles the import pipeline:
 *   1. CSV parsing
 *   2. Header auto-mapping
 *   3. Row normalization + validation (with normalized dedup)
 *   4. Row execution in per-row DB transactions
 *
 * Dedup rules:
 *   - Company: normalized name (case-insensitive, whitespace-collapsed)
 *   - Location: company ID + address composite key
 *   - Contact: email (primary) or name+phone (fallback)
 *
 * Billing address policy: fill empty fields only, warn on conflicts.
 */

import {
  type ClientImportRow,
  type ColumnMapping,
  type ValidatedRow,
  type RowValidationError,
  type RowStatus,
  type ImportRowResult,
  type ImportEntityAction,
  type BillingConflict,
  HEADER_ALIASES,
  IMPORT_FIELD_DEFS,
} from "@shared/clientImportTypes";
import { normalizeForMatch, buildAddressCompositeKey } from "@shared/normalizeForMatch";
import { normalizePostalCode, isValidPostalCode } from "../lib/addressNormalize";
import { customerCompanyRepository } from "../storage/customerCompanies";
import { clientContactRepository } from "../storage/clientContacts";
// storage import removed — executeRow now uses tx handle directly for location inserts
import { maybeGeocode } from "../utils/geocode";
import { db } from "../db";
import { eq, and, isNull } from "drizzle-orm";
import { clientLocations, customerCompanies } from "@shared/schema";
import { notDeletedClientFilter } from "../storage/jobFilters";

// Re-export shared CSV parser so existing imports from this module continue to work
export { parseCSV } from "@shared/csvParser";

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

const MULTI_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Extract the first valid email from a cell that may contain multiple emails.
 * Supports separators: comma, semicolon, pipe, space.
 * Returns the first token that passes email format validation, or null.
 */
export function extractFirstEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Split on comma, semicolon, pipe, or whitespace (common multi-email separators)
  const tokens = trimmed.split(/[,;|\s]+/).map(t => t.trim()).filter(Boolean);
  for (const token of tokens) {
    if (MULTI_EMAIL_RE.test(token)) return token;
  }
  return null;
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
    // Multi-email handling: extract first valid email from comma/semicolon/pipe-separated lists
    companyEmail: extractFirstEmail(raw.companyEmail),
    isActive: coerceBoolean(raw.isActive),

    billingStreet: trimOrNull(raw.billingStreet),
    billingStreet2: trimOrNull(raw.billingStreet2),
    billingCity: trimOrNull(raw.billingCity),
    billingProvince: trimOrNull(raw.billingProvince),
    billingPostalCode: raw.billingPostalCode?.trim()
      ? normalizePostalCode(raw.billingPostalCode.trim())
      : null,
    billingCountry: trimOrNull(raw.billingCountry),

    locationName: trimOrNull(raw.locationName),
    serviceStreet: trimOrNull(raw.serviceStreet),
    serviceStreet2: trimOrNull(raw.serviceStreet2),
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
    contactEmail: extractFirstEmail(raw.contactEmail),
    contactPhone: trimOrNull(raw.contactPhone),
  };
}

// ============================================================================
// Row Validation (v2 — normalized matching + dedup detection)
// ============================================================================

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Placeholder/garbage values that should not be treated as meaningful contact identity */
const GARBAGE_NAMES = new Set([
  "", "-", ".", "..", "...", "--", "n/a", "na", "none", "unknown", "tbd", "tba",
  "null", "undefined", "test", "xxx", "x",
]);

/**
 * Contact identity classification.
 *
 * ALLOW (create contact):
 *   - firstName present and meaningful (not garbage)
 *   - email only (no name needed)
 *   - phone only (no name needed)
 *
 * BLOCK (skip contact creation):
 *   - lastName only, no firstName/email/phone
 *   - all fields are garbage/placeholder values
 *   - no meaningful identifying info at all
 *
 * Returns: { meaningful: boolean; reason?: string }
 */
export function classifyContactIdentity(row: ClientImportRow): { meaningful: boolean; reason?: string } {
  const firstName = row.contactFirstName?.trim() ?? "";
  const lastName = row.contactLastName?.trim() ?? "";
  const email = row.contactEmail?.trim() ?? "";
  const phone = row.contactPhone?.trim() ?? "";

  const hasFirstName = firstName !== "" && !GARBAGE_NAMES.has(firstName.toLowerCase());
  const hasLastName = lastName !== "" && !GARBAGE_NAMES.has(lastName.toLowerCase());
  const hasEmail = email !== "" && EMAIL_RE.test(email);
  const hasPhone = phone !== "";

  // Email or phone alone is sufficient identity
  if (hasEmail || hasPhone) return { meaningful: true };

  // First name (meaningful, not garbage) is sufficient for site contacts
  if (hasFirstName) return { meaningful: true };

  // Last name only without first name — insufficient
  if (hasLastName && !hasFirstName) {
    return { meaningful: false, reason: "Last name only — need first name, email, or phone for a valid contact" };
  }

  // Everything is garbage or empty
  return { meaningful: false, reason: "Contact fields are empty or placeholder values" };
}

/** Cached company info including existing locations/contacts for dedup */
interface CompanyCacheEntry {
  exists: boolean;
  name: string;
  id?: string;
  /** Address composite keys of existing locations under this company */
  locationKeys: Set<string>;
  /** Normalized emails of existing contacts */
  contactEmails: Set<string>;
  /** Normalized "first last|phone" keys for fallback contact dedup */
  contactNamePhones: Set<string>;
  /** Normalized "first last" keys for name-only contact dedup (no email/phone) */
  contactNames: Set<string>;
  /** Existing billing fields for conflict detection */
  billing?: {
    billingStreet?: string | null;
    billingStreet2?: string | null;
    billingCity?: string | null;
    billingProvince?: string | null;
    billingPostalCode?: string | null;
    billingCountry?: string | null;
  };
}

/**
 * Build or retrieve a company cache entry with location/contact data for dedup.
 */
async function getCompanyCacheEntry(
  companyId: string,
  normalizedName: string,
  companyCache: Map<string, CompanyCacheEntry>
): Promise<CompanyCacheEntry> {
  if (companyCache.has(normalizedName)) return companyCache.get(normalizedName)!;

  const existing = await customerCompanyRepository.findCustomerCompanyByNormalizedName(companyId, normalizedName);
  if (!existing) {
    const entry: CompanyCacheEntry = {
      exists: false,
      name: normalizedName,
      locationKeys: new Set(),
      contactEmails: new Set(),
      contactNamePhones: new Set(),
      contactNames: new Set(),
    };
    companyCache.set(normalizedName, entry);
    return entry;
  }

  // Fetch existing locations for address composite key dedup
  const locations = await customerCompanyRepository.getAllCustomerCompanyLocations(companyId, existing.id);
  const locationKeys = new Set<string>();
  for (const loc of locations) {
    const key = buildAddressCompositeKey(loc.address, loc.city, loc.province, loc.postalCode);
    if (key !== "|||") locationKeys.add(key); // skip empty address keys
  }

  // Fetch existing contacts for email/name+phone/name-only dedup
  const contacts = await clientContactRepository.getCompanyPersons(companyId, existing.id);
  const contactEmails = new Set<string>();
  const contactNamePhones = new Set<string>();
  const contactNames = new Set<string>();
  for (const c of contacts) {
    const email = normalizeForMatch(c.email);
    if (email) contactEmails.add(email);
    const name = normalizeForMatch(`${c.firstName} ${c.lastName}`);
    const phone = normalizeForMatch(c.phone);
    if (name && phone) contactNamePhones.add(`${name}|${phone}`);
    if (name) contactNames.add(name);
  }

  const entry: CompanyCacheEntry = {
    exists: true,
    name: existing.name ?? "",
    id: existing.id,
    locationKeys,
    contactEmails,
    contactNamePhones,
    contactNames,
    billing: {
      billingStreet: existing.billingStreet,
      billingStreet2: existing.billingStreet2,
      billingCity: existing.billingCity,
      billingProvince: existing.billingProvince,
      billingPostalCode: existing.billingPostalCode,
      billingCountry: existing.billingCountry,
    },
  };
  companyCache.set(normalizedName, entry);
  return entry;
}

/** Check for billing address conflicts (existing non-blank vs incoming non-blank that differ) */
function detectBillingConflicts(
  existing: CompanyCacheEntry["billing"],
  row: ClientImportRow
): BillingConflict[] {
  if (!existing) return [];
  const conflicts: BillingConflict[] = [];
  const fields: Array<{ field: string; existingVal: string | null | undefined; incomingVal: string | null | undefined }> = [
    { field: "billingStreet", existingVal: existing.billingStreet, incomingVal: row.billingStreet },
    { field: "billingStreet2", existingVal: existing.billingStreet2, incomingVal: row.billingStreet2 },
    { field: "billingCity", existingVal: existing.billingCity, incomingVal: row.billingCity },
    { field: "billingProvince", existingVal: existing.billingProvince, incomingVal: row.billingProvince },
    { field: "billingPostalCode", existingVal: existing.billingPostalCode, incomingVal: row.billingPostalCode },
    { field: "billingCountry", existingVal: existing.billingCountry, incomingVal: row.billingCountry },
  ];

  for (const { field, existingVal, incomingVal } of fields) {
    const e = normalizeForMatch(existingVal);
    const i = normalizeForMatch(incomingVal);
    if (e && i && e !== i) {
      conflicts.push({ field, existing: existingVal!.trim(), incoming: incomingVal!.trim() });
    }
  }
  return conflicts;
}

/**
 * Validate a single normalized row with normalized matching for companies,
 * address composite dedup for locations, and email/name+phone dedup for contacts.
 */
export async function validateRow(
  row: ClientImportRow,
  rowIndex: number,
  companyId: string,
  companyCache: Map<string, CompanyCacheEntry>
): Promise<ValidatedRow> {
  const errors: RowValidationError[] = [];
  const warnings: string[] = [];
  let companyAction: ImportEntityAction = "create";
  let locationAction: ImportEntityAction = "create";
  let contactAction: ImportEntityAction = "skip";
  const conflicts: BillingConflict[] = [];

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

  // --- Postal code validation (non-blocking — warns only) ---
  if (row.billingPostalCode && !isValidPostalCode(row.billingPostalCode)) {
    warnings.push("Billing postal code format not recognized — will import as-is");
  }
  if (!row.billingPostalCode && row.billingStreet) {
    warnings.push("Billing postal code missing");
  }
  if (row.servicePostalCode && !isValidPostalCode(row.servicePostalCode)) {
    warnings.push("Service postal code format not recognized — will import as-is");
  }
  if (!row.servicePostalCode && row.serviceStreet) {
    warnings.push("Service postal code missing");
  }

  // --- Contact identity validation ---
  const hasAnyContactField = !!(row.contactFirstName || row.contactLastName || row.contactEmail || row.contactPhone);
  let hasContact = false; // true if contact will be created

  if (hasAnyContactField) {
    const identity = classifyContactIdentity(row);
    if (identity.meaningful) {
      hasContact = true;
      // Warn when no communication details (name-only contacts)
      const hasComms = !!(row.contactEmail?.trim() || row.contactPhone?.trim());
      if (!hasComms) {
        warnings.push("Contact has no email or phone — contact will be created without communication details");
      }
    } else {
      // Contact fragment is not meaningful enough — skip creation, warn
      warnings.push(identity.reason ?? "Incomplete contact data — contact will not be created");
    }
  }

  // --- Warnings ---
  if (!row.locationName && row.companyName) {
    // Fix: updated warning to reflect new fallback chain (address → company name)
    warnings.push("Location name blank — will use address or company name");
  }
  if (!hasAnyContactField) {
    warnings.push("No contact data — no contact will be created");
  }
  if (!row.serviceStreet && !row.serviceCity) {
    warnings.push("No service address provided");
  }

  // --- Company match check (normalized) ---
  let matchesExisting = false;
  let existingCompanyName: string | undefined;

  if (row.companyName) {
    const normalizedName = normalizeForMatch(row.companyName);
    const entry = await getCompanyCacheEntry(companyId, normalizedName, companyCache);
    matchesExisting = entry.exists;

    if (matchesExisting) {
      existingCompanyName = entry.name;
      companyAction = "match";
      warnings.push(`Company "${entry.name}" already exists — location will be added to it`);

      // Location dedup: check address composite key
      const addrKey = buildAddressCompositeKey(
        row.serviceStreet, row.serviceCity, row.serviceProvince, row.servicePostalCode
      );
      if (addrKey !== "|||" && entry.locationKeys.has(addrKey)) {
        locationAction = "skip";
        warnings.push("Location with same address already exists — will be skipped");
      }

      // Contact dedup: email → name+phone → name-only (fallback)
      if (hasContact) {
        const email = normalizeForMatch(row.contactEmail);
        const name = normalizeForMatch(`${row.contactFirstName ?? ""} ${row.contactLastName ?? ""}`);
        const phone = normalizeForMatch(row.contactPhone);

        if (email && entry.contactEmails.has(email)) {
          contactAction = "match";
          warnings.push("Contact with same email already exists — will be skipped");
        } else if (name && phone && entry.contactNamePhones.has(`${name}|${phone}`)) {
          contactAction = "match";
          warnings.push("Contact with same name+phone already exists — will be skipped");
        } else if (name && !email && !phone && entry.contactNames.has(name)) {
          // Name-only fallback: if no email/phone, dedup by name alone within company
          contactAction = "match";
          warnings.push("Contact with same name already exists — will be skipped");
        } else {
          contactAction = "create";
        }
      }

      // Billing address conflict detection
      const billingConflicts = detectBillingConflicts(entry.billing, row);
      if (billingConflicts.length > 0) {
        conflicts.push(...billingConflicts);
        warnings.push("Billing address differs from existing — existing values will be kept, empty fields will be filled");
      }
    } else {
      // New company
      companyAction = "create";
      if (hasContact) contactAction = "create";
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
    companyAction,
    locationAction,
    contactAction,
    conflicts,
  };
}

// ============================================================================
// Within-CSV Entity Classification
// ============================================================================

/**
 * Classify within-CSV entity actions for all rows (including blocked).
 *
 * For rows where the company doesn't exist in the DB (companyAction === "create"),
 * this detects when multiple rows share the same normalized company name and
 * upgrades later rows to "match" (since an earlier row will create the company).
 *
 * Also detects location duplicates within the CSV (same company + same address)
 * and contact duplicates (same company + same email or name+phone).
 *
 * All rows participate in classification regardless of blocked status, so the
 * preview is truthful about what would happen if the row were valid.
 */
export function classifyWithinCsvEntities(rows: ValidatedRow[]): { withinCsvDuplicates: number } {
  // Track first-seen company by normalized name → rowIndex
  const seenCompanies = new Map<string, number>();
  // Track seen locations: "normalizedCompany|addrKey" → first rowIndex
  const seenLocations = new Map<string, number>();
  // Track seen contacts: "normalizedCompany|email" or "normalizedCompany|name|phone" or "normalizedCompany|name" → first rowIndex
  const seenContactEmails = new Map<string, number>();
  const seenContactNamePhones = new Map<string, number>();
  const seenContactNames = new Map<string, number>();

  let withinCsvDuplicates = 0;

  for (const row of rows) {
    if (!row.normalized.companyName) continue;

    const normalizedName = normalizeForMatch(row.normalized.companyName);

    // --- Company classification ---
    if (row.companyAction === "create") {
      if (seenCompanies.has(normalizedName)) {
        // An earlier row will create this company; this row matches it
        row.companyAction = "match";
        row.matchesExisting = false; // not a DB match, but a within-CSV match
      } else {
        seenCompanies.set(normalizedName, row.rowIndex);
      }
    }

    // --- Location classification ---
    const addrKey = buildAddressCompositeKey(
      row.normalized.serviceStreet,
      row.normalized.serviceCity,
      row.normalized.serviceProvince,
      row.normalized.servicePostalCode
    );
    const locationComposite = `${normalizedName}|${addrKey}`;

    if (row.locationAction === "create") {
      if (seenLocations.has(locationComposite)) {
        row.locationAction = "skip";
        row.warnings.push("Duplicate of an earlier row in this CSV (same company + address)");
        if (row.status === "valid") row.status = "warning";
        withinCsvDuplicates++;
      } else {
        seenLocations.set(locationComposite, row.rowIndex);
      }
    } else if (row.locationAction === "skip" || row.locationAction === "match") {
      // Already matched/skipped against DB — still register in seen so later CSV rows know
      if (!seenLocations.has(locationComposite)) {
        seenLocations.set(locationComposite, row.rowIndex);
      }
    }

    // --- Contact classification ---
    const hasContact = !!(
      row.normalized.contactFirstName || row.normalized.contactLastName ||
      row.normalized.contactEmail || row.normalized.contactPhone
    );

    if (hasContact && row.contactAction === "create") {
      const email = normalizeForMatch(row.normalized.contactEmail);
      const name = normalizeForMatch(
        `${row.normalized.contactFirstName ?? ""} ${row.normalized.contactLastName ?? ""}`
      );
      const phone = normalizeForMatch(row.normalized.contactPhone);

      let contactMatched = false;
      if (email) {
        const emailKey = `${normalizedName}|${email}`;
        if (seenContactEmails.has(emailKey)) {
          contactMatched = true;
        } else {
          seenContactEmails.set(emailKey, row.rowIndex);
        }
      }
      if (!contactMatched && name && phone) {
        const namePhoneKey = `${normalizedName}|${name}|${phone}`;
        if (seenContactNamePhones.has(namePhoneKey)) {
          contactMatched = true;
        } else {
          seenContactNamePhones.set(namePhoneKey, row.rowIndex);
        }
      }
      // Name-only fallback: dedup by full name within company when no email/phone
      if (!contactMatched && name && !email && !phone) {
        const nameKey = `${normalizedName}|${name}`;
        if (seenContactNames.has(nameKey)) {
          contactMatched = true;
        } else {
          seenContactNames.set(nameKey, row.rowIndex);
        }
      }

      if (contactMatched) {
        row.contactAction = "match";
        row.warnings.push("Same contact appears in an earlier CSV row — will be skipped");
        if (row.status === "valid") row.status = "warning";
      }
    }
  }

  return { withinCsvDuplicates };
}

// ============================================================================
// Import Execution (v2 — row-level transactions, dedup, fill-only billing)
// ============================================================================

/**
 * Execute import for a single row inside a DB transaction.
 * Company: normalized match or create. Location: address dedup or create.
 * Contact: email/name+phone dedup or create. Fill-only billing policy.
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
    locationCreated: false,
    contactCreated: false,
  };

  try {
    await db.transaction(async (tx) => {
      // 1) Resolve customer company (dedup by normalized name)
      const companyName = row.companyName.trim();
      const normalizedName = normalizeForMatch(companyName);
      let resolvedCompany = companyResolveCache.get(normalizedName);

      if (!resolvedCompany) {
        const existing = await customerCompanyRepository.findCustomerCompanyByNormalizedName(companyId, normalizedName);
        if (existing) {
          resolvedCompany = { id: existing.id, name: existing.name ?? "", created: false };

          // Fill-only billing policy: update empty billing fields with incoming data
          const billingUpdates: Record<string, string | null> = {};
          if (!existing.billingStreet && row.billingStreet) billingUpdates.billingStreet = row.billingStreet;
          if (!existing.billingStreet2 && row.billingStreet2) billingUpdates.billingStreet2 = row.billingStreet2;
          if (!existing.billingCity && row.billingCity) billingUpdates.billingCity = row.billingCity;
          if (!existing.billingProvince && row.billingProvince) billingUpdates.billingProvince = row.billingProvince;
          if (!existing.billingPostalCode && row.billingPostalCode) billingUpdates.billingPostalCode = row.billingPostalCode;
          if (!existing.billingCountry && row.billingCountry) billingUpdates.billingCountry = row.billingCountry;

          if (Object.keys(billingUpdates).length > 0) {
            await tx
              .update(customerCompanies)
              .set(billingUpdates)
              .where(and(
                eq(customerCompanies.id, existing.id),
                eq(customerCompanies.companyId, companyId),
              ));
          }
        } else {
          const created = await customerCompanyRepository.createCustomerCompanyTx(tx, companyId, {
            name: companyName,
            phone: row.companyPhone ?? null,
            email: row.companyEmail ?? null,
            billingStreet: row.billingStreet ?? null,
            billingStreet2: row.billingStreet2 ?? null,
            billingCity: row.billingCity ?? null,
            billingProvince: row.billingProvince ?? null,
            billingPostalCode: row.billingPostalCode ?? null,
            billingCountry: row.billingCountry ?? null,
          });
          resolvedCompany = { id: created.id, name: created.name ?? "", created: true };
        }
        companyResolveCache.set(normalizedName, resolvedCompany);
      }

      if (!resolvedCompany) {
        throw new Error(`Failed to resolve company for row: ${companyName}`);
      }

      result.companyId = resolvedCompany.id;
      result.companyName = resolvedCompany.name;
      result.companyCreated = resolvedCompany.created;

      // 2) Location dedup by address composite key
      const addrKey = buildAddressCompositeKey(
        row.serviceStreet, row.serviceCity, row.serviceProvince, row.servicePostalCode
      );

      let locationSkipped = false;
      if (addrKey !== "|||") {
        // Check existing locations under this company for same address
        const existingLocations = await tx
          .select({ id: clientLocations.id, address: clientLocations.address, city: clientLocations.city, province: clientLocations.province, postalCode: clientLocations.postalCode })
          .from(clientLocations)
          .where(and(
            eq(clientLocations.companyId, companyId),
            eq(clientLocations.parentCompanyId, resolvedCompany.id),
            notDeletedClientFilter(),
          ));

        for (const loc of existingLocations) {
          const existingKey = buildAddressCompositeKey(loc.address, loc.city, loc.province, loc.postalCode);
          if (existingKey === addrKey) {
            result.locationId = loc.id;
            locationSkipped = true;
            break;
          }
        }
      }

      if (!locationSkipped) {
        // Determine isPrimary
        let isPrimary = false;
        const [existingPrimary] = await tx
          .select({ id: clientLocations.id })
          .from(clientLocations)
          .where(and(
            eq(clientLocations.companyId, companyId),
            eq(clientLocations.parentCompanyId, resolvedCompany.id),
            eq(clientLocations.isPrimary, true),
          ))
          .limit(1);
        isPrimary = !existingPrimary;

        // Create location
        // Fix: use canonical company name from resolved company, not raw CSV value
        // Prevents case mismatches (e.g., "Basil HVAC" vs "basil hvac") across rows
        const canonicalCompanyName = resolvedCompany.name;
        // Fix: prefer distinct location name from CSV, then address-based name,
        // then company name. Prevents multi-location clients from all showing
        // the same company name as their location label.
        const addressLabel = row.serviceStreet ?? row.billingStreet ?? null;
        const addressBasedName = addressLabel
          ? `${addressLabel}${row.serviceCity ?? row.billingCity ? `, ${row.serviceCity ?? row.billingCity}` : ""}`
          : null;
        const locationName = row.locationName || addressBasedName || canonicalCompanyName;

        // Fix: when CSV has billing address but no service address, copy billing → service.
        // Common in Jobber/QBO exports where only "Billing Address 1" is provided.
        const serviceStreet = row.serviceStreet ?? row.billingStreet ?? null;
        const serviceStreet2 = row.serviceStreet2 ?? row.billingStreet2 ?? null;
        const serviceCity = row.serviceCity ?? row.billingCity ?? null;
        const serviceProvince = row.serviceProvince ?? row.billingProvince ?? null;
        const servicePostalCode = row.servicePostalCode ?? row.billingPostalCode ?? null;
        const serviceCountry = row.serviceCountry ?? row.billingCountry ?? null;

        const locationData: Record<string, unknown> = {
          parentCompanyId: resolvedCompany.id,
          companyName: canonicalCompanyName,
          location: locationName,
          address: serviceStreet,
          address2: serviceStreet2,
          city: serviceCity,
          province: serviceProvince,
          postalCode: servicePostalCode,
          country: serviceCountry,
          roofLadderCode: row.siteCode ?? null,
          notes: row.locationNotes ?? null,
          selectedMonths: [],
          inactive: false,
          isPrimary,
          billWithParent: row.billWithParent ?? true,
          needsDetails: false,
        };

        const geocoded = await maybeGeocode(locationData);
        // Fix: insert via tx (not global db) so the FK to the just-created
        // customer_company row is visible within this transaction.
        const [location] = await tx
          .insert(clientLocations)
          .values({ ...(geocoded as any), companyId, userId })
          .returning();
        result.locationId = location.id;
        result.locationCreated = true;
      }

      // 3) Contact: classify identity, then dedup (email → name+phone → name-only)
      const hasAnyContactField = !!(
        row.contactFirstName?.trim() ||
        row.contactLastName?.trim() ||
        row.contactEmail?.trim() ||
        row.contactPhone?.trim()
      );
      const contactIdentity = hasAnyContactField ? classifyContactIdentity(row) : null;

      if (hasAnyContactField && contactIdentity?.meaningful) {
        let contactExists = false;
        const email = normalizeForMatch(row.contactEmail);
        const name = normalizeForMatch(`${row.contactFirstName ?? ""} ${row.contactLastName ?? ""}`);
        const phone = normalizeForMatch(row.contactPhone);

        // Dedup chain: email → name+phone → name-only
        if (email) {
          const existing = await clientContactRepository.findContactByEmail(companyId, resolvedCompany.id, email);
          if (existing) {
            result.contactId = existing.id;
            contactExists = true;
          }
        }

        if (!contactExists && name && phone) {
          const existing = await clientContactRepository.findContactByNamePhone(companyId, resolvedCompany.id, name, phone);
          if (existing) {
            result.contactId = existing.id;
            contactExists = true;
          }
        }

        if (!contactExists && name && !email && !phone) {
          // Name-only fallback: dedup by full name within company
          const existing = await clientContactRepository.findContactByName(companyId, resolvedCompany.id, name);
          if (existing) {
            result.contactId = existing.id;
            contactExists = true;
          }
        }

        if (!contactExists) {
          const contact = await clientContactRepository.createContactTx(tx, companyId, {
            customerCompanyId: resolvedCompany.id,
            locationId: null,
            firstName: row.contactFirstName?.trim() || "",
            lastName: row.contactLastName?.trim() || "",
            email: row.contactEmail?.trim() || null,
            phone: row.contactPhone?.trim() || null,
            roles: [],
            isPrimary: true,
          });
          result.contactId = contact.id;
          result.contactCreated = true;
        }
      }

      result.success = true;
    });
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}
