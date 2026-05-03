/**
 * ClientImportAdapter — CRM package import (customer company + location + contact).
 *
 * One CSV row imports:
 *   • One customer company (created, or matched by normalized name)
 *   • One service location (created, or matched/skipped by address
 *     composite key)
 *   • One optional contact (created, or matched by email → name+phone
 *     → name-only fallback)
 *
 * Transaction shape: every row commits inside a single `db.transaction`
 * (wrapped by the orchestrator) so the three-entity write is atomic.
 *
 * 2026-04-21 changes vs. the legacy service:
 *   • All normalizers routed through `server/services/importPipeline/normalizers/*`.
 *   • Preview-scope context holds the tenant-wide company cache once —
 *     replaces the per-row "resolve normalized name → entry" that
 *     previously happened inline in `validateRow`.
 *   • Feature-capacity gate (`canAddLocation`) moved into the adapter's
 *     `assertCapacity` so the orchestrator calls it uniformly.
 *   • Vocabulary: adapter exposes canonical `created / matched / skipped`
 *     per-entity in `details`, and the row's primary disposition is
 *     `created` when anything new is written, `matched` when everything
 *     was matched. Within-CSV duplicates → `skipped`.
 */

import { eq, and } from "drizzle-orm";
import { customerCompanies, clientLocations } from "@shared/schema";
import { customerCompanyRepository } from "../../../storage/customerCompanies";
import { clientRepository } from "../../../storage/clients";
import { clientContactRepository } from "../../../storage/clientContacts";
import { notDeletedClientFilter } from "../../../storage/jobFilters";
import { subscriptionRepository } from "../../../storage/subscriptions";
import { isValidPostalCode } from "../../../lib/addressNormalize";
import {
  trimOrNull,
  coerceBooleanStrict,
  extractFirstEmail,
  normalizePostalDisplay,
  normalizeForMatch,
  buildAddressCompositeKey,
  normalizeHeader,
  isValidEmailShape,
} from "../normalizers";
import type { ImportAdapter, AdapterFieldDef, ImportContext } from "../types";
import type { RowOutcome } from "@shared/importPipeline/contracts";
import type {
  ClientImportRow,
  ClientImportDetails,
  ClientEntityAction,
} from "@shared/importPipeline/zod/client";

// ============================================================================
// Field defs + header aliases
// ============================================================================

const FIELD_DEFS: readonly AdapterFieldDef[] = [
  // 2026-04-22: company name not strictly required — residential/person
  // rows can identify themselves via first/last name. Per-row identity
  // enforcement lives in validateRow.
  { key: "companyName", label: "Company name", group: "Company", required: false },
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
  { key: "contactTitle", label: "Contact title / prefix", group: "Contact", required: false },
  { key: "contactFirstName", label: "Contact first name", group: "Contact", required: false },
  { key: "contactLastName", label: "Contact last name", group: "Contact", required: false },
  { key: "contactEmail", label: "Contact email", group: "Contact", required: false },
  { key: "contactPhone", label: "Contact phone", group: "Contact", required: false },
];

const RAW_ALIASES: Record<string, keyof ClientImportRow> = {
  // Company
  "company name": "companyName", company: "companyName", "client name": "companyName",
  "customer": "companyName", "customer name": "companyName",
  "legal name": "legalName", "legal business name": "legalName",
  "company phone": "companyPhone", phone: "companyPhone",
  "company email": "companyEmail", email: "companyEmail", "e-mails": "companyEmail",
  "emails": "companyEmail",
  active: "isActive", "is active": "isActive", status: "isActive",
  // Billing
  "billing street": "billingStreet", "billing address": "billingStreet",
  "billing address 1": "billingStreet",
  "billing street 2": "billingStreet2", "billing address 2": "billingStreet2",
  "billing city": "billingCity",
  "billing province": "billingProvince", "billing state": "billingProvince",
  "billing province/state": "billingProvince",
  "billing postal code": "billingPostalCode", "billing zip": "billingPostalCode",
  "billing postal": "billingPostalCode", "billing zip code": "billingPostalCode",
  "billing country": "billingCountry",
  // Service location
  "location name": "locationName", location: "locationName",
  "property name": "locationName", "site name": "locationName",
  "service street": "serviceStreet", "service address": "serviceStreet",
  "property address": "serviceStreet", "property address 1": "serviceStreet",
  "service street 2": "serviceStreet2", "service address 2": "serviceStreet2",
  "service city": "serviceCity", "property city": "serviceCity",
  "service province": "serviceProvince", "service state": "serviceProvince",
  "service province/state": "serviceProvince",
  "service postal code": "servicePostalCode", "service zip": "servicePostalCode",
  "property postal code": "servicePostalCode",
  "service country": "serviceCountry",
  "site code": "siteCode", "roof code": "siteCode", "roof/ladder code": "siteCode",
  "location notes": "locationNotes", notes: "locationNotes",
  "bill with parent": "billWithParent",
  // Contact
  // 2026-04-22: Jobber's "Title" column → contact title/prefix.
  "title": "contactTitle", "contact title": "contactTitle", "prefix": "contactTitle",
  "salutation": "contactTitle",
  "contact first name": "contactFirstName", "first name": "contactFirstName",
  "contact last name": "contactLastName", "last name": "contactLastName",
  "contact email": "contactEmail",
  "contact phone": "contactPhone",
};

const HEADER_ALIASES: Record<string, string> = Object.fromEntries(
  Object.entries(RAW_ALIASES).map(([k, v]) => [normalizeHeader(k), v]),
);

// ============================================================================
// Preview-scope context — tenant caches for dedup
// ============================================================================

interface CompanyCacheEntry {
  exists: boolean;
  name: string;
  id?: string;
  locationKeys: Set<string>;
  contactEmails: Set<string>;
  contactNamePhones: Set<string>;
  contactNames: Set<string>;
  billing?: {
    billingStreet?: string | null;
    billingStreet2?: string | null;
    billingCity?: string | null;
    billingProvince?: string | null;
    billingPostalCode?: string | null;
    billingCountry?: string | null;
  };
}

interface ClientPreviewCtx {
  /** `normalizedName → cached entry`. Entries are hydrated lazily. */
  cache: Map<string, CompanyCacheEntry>;
}

const GARBAGE_NAMES = new Set([
  "", "-", ".", "..", "...", "--", "n/a", "na", "none", "unknown", "tbd", "tba",
  "null", "undefined", "test", "xxx", "x",
]);

/**
 * 2026-04-22: resolve the effective customer_company.name for a row.
 *
 *   - commercial rows: trimmed companyName (as before)
 *   - residential rows: "FirstName LastName" fallback, or just one of
 *     the names when the other is blank
 *   - all-blank rows: null — validateRow blocks these before commit
 *
 * The customer_company table is the canonical root for both commercial
 * and residential clients; using the person's name as the company name
 * preserves the existing architecture without introducing a parallel
 * "is_person" dimension.
 */
function resolveEffectiveCompanyName(row: ClientImportRow): string | null {
  const company = row.companyName?.trim();
  if (company) return company;
  const first = row.contactFirstName?.trim() ?? "";
  const last = row.contactLastName?.trim() ?? "";
  const combined = `${first} ${last}`.trim();
  return combined || null;
}

function classifyContactIdentity(row: ClientImportRow): { meaningful: boolean; reason?: string } {
  const firstName = row.contactFirstName?.trim() ?? "";
  const lastName = row.contactLastName?.trim() ?? "";
  const email = row.contactEmail?.trim() ?? "";
  const phone = row.contactPhone?.trim() ?? "";

  const hasFirstName = firstName !== "" && !GARBAGE_NAMES.has(firstName.toLowerCase());
  const hasLastName = lastName !== "" && !GARBAGE_NAMES.has(lastName.toLowerCase());
  const hasEmail = email !== "" && isValidEmailShape(email);
  const hasPhone = phone !== "";

  if (hasEmail || hasPhone) return { meaningful: true };
  if (hasFirstName) return { meaningful: true };
  if (hasLastName && !hasFirstName) {
    return { meaningful: false, reason: "Last name only — need first name, email, or phone for a valid contact" };
  }
  return { meaningful: false, reason: "Contact fields are empty or placeholder values" };
}

async function loadCompanyCacheEntry(
  tenantCompanyId: string,
  normalizedName: string,
  ctx: ClientPreviewCtx,
): Promise<CompanyCacheEntry> {
  const cached = ctx.cache.get(normalizedName);
  if (cached) return cached;

  const existing = await customerCompanyRepository.findCustomerCompanyByNormalizedName(
    tenantCompanyId,
    normalizedName,
  );
  if (!existing) {
    const entry: CompanyCacheEntry = {
      exists: false,
      name: normalizedName,
      locationKeys: new Set(),
      contactEmails: new Set(),
      contactNamePhones: new Set(),
      contactNames: new Set(),
    };
    ctx.cache.set(normalizedName, entry);
    return entry;
  }

  const locations = await customerCompanyRepository.getAllCustomerCompanyLocations(
    tenantCompanyId,
    existing.id,
  );
  const locationKeys = new Set<string>();
  for (const loc of locations) {
    const key = buildAddressCompositeKey(loc.address, loc.city, loc.province, loc.postalCode);
    if (key !== "|||") locationKeys.add(key);
  }

  const contacts = await clientContactRepository.getCompanyPersons(tenantCompanyId, existing.id);
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
  ctx.cache.set(normalizedName, entry);
  return entry;
}

function detectBillingConflicts(
  existing: CompanyCacheEntry["billing"],
  row: ClientImportRow,
): { field: string; existing: string; incoming: string }[] {
  if (!existing) return [];
  const checks: { field: string; e: string | null | undefined; i: string | null | undefined }[] = [
    { field: "billingStreet", e: existing.billingStreet, i: row.billingStreet },
    { field: "billingStreet2", e: existing.billingStreet2, i: row.billingStreet2 },
    { field: "billingCity", e: existing.billingCity, i: row.billingCity },
    { field: "billingProvince", e: existing.billingProvince, i: row.billingProvince },
    { field: "billingPostalCode", e: existing.billingPostalCode, i: row.billingPostalCode },
    { field: "billingCountry", e: existing.billingCountry, i: row.billingCountry },
  ];
  const out: { field: string; existing: string; incoming: string }[] = [];
  for (const { field, e, i } of checks) {
    const en = normalizeForMatch(e);
    const iN = normalizeForMatch(i);
    if (en && iN && en !== iN) {
      out.push({ field, existing: e!.trim(), incoming: i!.trim() });
    }
  }
  return out;
}

// ============================================================================
// Adapter
// ============================================================================

export const clientImportAdapter: ImportAdapter<
  ClientImportRow,
  ClientImportDetails,
  ClientPreviewCtx
> = {
  entity: "clients",
  entityLabelPlural: "clients",
  maxRows: 500,
  maxBytes: 5_000_000,
  fieldDefs: FIELD_DEFS,
  headerAliases: HEADER_ALIASES,

  normalizeRow(cells, mappings, _ctx) {
    const raw: Record<string, string> = {};
    for (const m of mappings) {
      if (m.targetField && m.csvIndex < cells.length) {
        raw[m.targetField] = cells[m.csvIndex];
      }
    }

    return {
      companyName: trimOrNull(raw.companyName),
      legalName: trimOrNull(raw.legalName),
      companyPhone: trimOrNull(raw.companyPhone),
      companyEmail: extractFirstEmail(raw.companyEmail),
      isActive: coerceBooleanStrict(raw.isActive),

      billingStreet: trimOrNull(raw.billingStreet),
      billingStreet2: trimOrNull(raw.billingStreet2),
      billingCity: trimOrNull(raw.billingCity),
      billingProvince: trimOrNull(raw.billingProvince),
      billingPostalCode: raw.billingPostalCode?.trim()
        ? normalizePostalDisplay(raw.billingPostalCode)
        : null,
      billingCountry: trimOrNull(raw.billingCountry),

      locationName: trimOrNull(raw.locationName),
      serviceStreet: trimOrNull(raw.serviceStreet),
      serviceStreet2: trimOrNull(raw.serviceStreet2),
      serviceCity: trimOrNull(raw.serviceCity),
      serviceProvince: trimOrNull(raw.serviceProvince),
      servicePostalCode: raw.servicePostalCode?.trim()
        ? normalizePostalDisplay(raw.servicePostalCode)
        : null,
      serviceCountry: trimOrNull(raw.serviceCountry),
      siteCode: trimOrNull(raw.siteCode),
      locationNotes: trimOrNull(raw.locationNotes),
      billWithParent: coerceBooleanStrict(raw.billWithParent),

      contactTitle: trimOrNull(raw.contactTitle),
      contactFirstName: trimOrNull(raw.contactFirstName),
      contactLastName: trimOrNull(raw.contactLastName),
      contactEmail: extractFirstEmail(raw.contactEmail),
      contactPhone: trimOrNull(raw.contactPhone),
    };
  },

  async buildPreviewContext(_ctx, _rows): Promise<ClientPreviewCtx> {
    return { cache: new Map() };
  },

  async validateRow(row, _idx, ctx, previewCtx) {
    const errors: { field: string; message: string }[] = [];
    const warnings: string[] = [];

    let companyAction: ClientEntityAction = "create";
    let locationAction: ClientEntityAction = "create";
    let contactAction: ClientEntityAction = "skip";
    let existingCompanyName: string | undefined;
    let billingConflicts: { field: string; existing: string; incoming: string }[] | undefined;

    // 2026-04-22: accept residential/person rows — require at least one
    // identifier (company name OR first name OR last name). The customer
    // company record still exists for residential rows, using the
    // effective name resolved below.
    const effectiveCompanyName = resolveEffectiveCompanyName(row);
    if (!effectiveCompanyName) {
      errors.push({
        field: "companyName",
        message: "Client requires at least one identifier: company name, first name, or last name.",
      });
    }
    if (row.companyEmail && !isValidEmailShape(row.companyEmail)) {
      errors.push({ field: "companyEmail", message: "Invalid email format" });
    }
    if (row.contactEmail && !isValidEmailShape(row.contactEmail)) {
      errors.push({ field: "contactEmail", message: "Invalid contact email format" });
    }

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

    const hasAnyContactField = !!(
      row.contactFirstName || row.contactLastName || row.contactEmail || row.contactPhone
    );
    let hasContact = false;
    if (hasAnyContactField) {
      const identity = classifyContactIdentity(row);
      if (identity.meaningful) {
        hasContact = true;
        const hasComms = !!(row.contactEmail?.trim() || row.contactPhone?.trim());
        if (!hasComms) {
          warnings.push("Contact has no email or phone — contact will be created without communication details");
        }
      } else {
        warnings.push(identity.reason ?? "Incomplete contact data — contact will not be created");
      }
    }

    if (!row.locationName && effectiveCompanyName) {
      warnings.push("Location name blank — will use address or company name");
    }
    if (!hasAnyContactField) {
      warnings.push("No contact data — no contact will be created");
    }
    if (!row.serviceStreet && !row.serviceCity) {
      warnings.push("No service address provided");
    }

    if (effectiveCompanyName) {
      const norm = normalizeForMatch(effectiveCompanyName);
      const entry = await loadCompanyCacheEntry(ctx.companyId, norm, previewCtx);
      if (entry.exists) {
        existingCompanyName = entry.name;
        companyAction = "match";
        warnings.push(`Company "${entry.name}" already exists — location will be added to it`);

        const addrKey = buildAddressCompositeKey(
          row.serviceStreet, row.serviceCity, row.serviceProvince, row.servicePostalCode,
        );
        if (addrKey !== "|||" && entry.locationKeys.has(addrKey)) {
          locationAction = "skip";
          warnings.push("Location with same address already exists — will be skipped");
        }

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
            contactAction = "match";
            warnings.push("Contact with same name already exists — will be skipped");
          } else {
            contactAction = "create";
          }
        }

        const conflicts = detectBillingConflicts(entry.billing, row);
        if (conflicts.length > 0) {
          billingConflicts = conflicts;
          warnings.push("Billing address differs from existing — existing values will be kept, empty fields will be filled");
        }
      } else {
        companyAction = "create";
        if (hasContact) contactAction = "create";
      }
    }

    const hasErrors = errors.length > 0;
    const details: ClientImportDetails = {
      existingCompanyName,
      companyAction,
      locationAction,
      contactAction,
      billingConflicts,
    };

    // Primary disposition: `matched` only when every entity is a match/skip.
    // Otherwise `created` (at least one entity will be written).
    const primary = deriveDisposition(companyAction, locationAction, contactAction, hasContact);
    const disposition = hasErrors ? "failed" : primary;

    return {
      errors,
      warnings,
      disposition,
      matchLabel: existingCompanyName,
      details,
    };
  },

  classifyWithinCsv(rows) {
    // Within-CSV dedup: later rows that reference the same company/location/
    // contact as an earlier row should NOT double-create. We mutate the
    // row's details to reflect that and bump the primary disposition when
    // every entity ends up matched/skipped.
    const seenCompanies = new Set<string>();
    const seenLocations = new Set<string>();
    const seenContactEmails = new Set<string>();
    const seenContactNamePhones = new Set<string>();
    const seenContactNames = new Set<string>();
    let withinCsvDuplicates = 0;

    for (const row of rows) {
      const details = row.details;
      if (!details) continue;
      const n = row.normalized;
      // 2026-04-22: use effective name (commercial or residential) as the
      // within-CSV dedupe key. Rows with no identifier at all are already
      // flagged "failed" in validateRow and can be skipped here.
      const effective = resolveEffectiveCompanyName(n);
      if (!effective) continue;

      const normalizedCompany = normalizeForMatch(effective);

      // Company: if a prior row creates the same-name company, this row matches.
      if (details.companyAction === "create") {
        if (seenCompanies.has(normalizedCompany)) {
          details.companyAction = "match";
        } else {
          seenCompanies.add(normalizedCompany);
        }
      }

      // Location: within-CSV dedup by (company, address composite).
      const addrKey = buildAddressCompositeKey(
        n.serviceStreet, n.serviceCity, n.serviceProvince, n.servicePostalCode,
      );
      const locKey = `${normalizedCompany}|${addrKey}`;
      if (details.locationAction === "create") {
        if (seenLocations.has(locKey)) {
          details.locationAction = "skip";
          if (row.status === "valid") row.status = "warning";
          if (!row.warnings.includes("Duplicate of an earlier row in this CSV (same company + address)")) {
            row.warnings.push("Duplicate of an earlier row in this CSV (same company + address)");
          }
          withinCsvDuplicates++;
        } else {
          seenLocations.add(locKey);
        }
      } else if (details.locationAction === "skip" || details.locationAction === "match") {
        seenLocations.add(locKey);
      }

      // Contact: dedup by email → name+phone → name-only within company scope.
      if (details.contactAction === "create") {
        const email = normalizeForMatch(n.contactEmail);
        const name = normalizeForMatch(`${n.contactFirstName ?? ""} ${n.contactLastName ?? ""}`);
        const phone = normalizeForMatch(n.contactPhone);
        let matched = false;
        if (email) {
          const k = `${normalizedCompany}|${email}`;
          if (seenContactEmails.has(k)) matched = true;
          else seenContactEmails.add(k);
        }
        if (!matched && name && phone) {
          const k = `${normalizedCompany}|${name}|${phone}`;
          if (seenContactNamePhones.has(k)) matched = true;
          else seenContactNamePhones.add(k);
        }
        if (!matched && name && !email && !phone) {
          const k = `${normalizedCompany}|${name}`;
          if (seenContactNames.has(k)) matched = true;
          else seenContactNames.add(k);
        }
        if (matched) {
          details.contactAction = "match";
          if (!row.warnings.includes("Same contact appears in an earlier CSV row — will be skipped")) {
            row.warnings.push("Same contact appears in an earlier CSV row — will be skipped");
          }
          if (row.status === "valid") row.status = "warning";
        }
      }

      // Recompute row disposition based on the now-updated actions.
      if (row.disposition !== "failed") {
        const hasContactField = !!(
          n.contactFirstName || n.contactLastName || n.contactEmail || n.contactPhone
        );
        row.disposition = deriveDisposition(
          details.companyAction,
          details.locationAction,
          details.contactAction,
          hasContactField,
        );
      }
    }

    return { withinCsvDuplicates };
  },

  async assertCapacity(ctx, _rowsToCreate) {
    // Canonical subscription gate — mirrors legacy clientImport/execute.
    const check = await subscriptionRepository.canAddLocation(ctx.companyId);
    if (!check.allowed) {
      const err = new Error(`Subscription limit reached: ${check.reason ?? "no additional locations allowed"}`);
      (err as any).statusCode = 403;
      throw err;
    }
  },

  async applyRow(row, rowIndex, ctx, commitCtx): Promise<RowOutcome> {
    const tx = commitCtx.tx;

    // 2026-04-22: effective company name falls back to "FirstName LastName"
    // for residential/person rows. Zod + validateRow guarantee at least
    // one identifier is present by the time we reach applyRow, but guard
    // defensively so a future caller mistake throws a clear error instead
    // of a null-pointer deref.
    const effective = resolveEffectiveCompanyName(row);
    if (!effective) {
      throw new Error(
        "Client row reached commit without any identifier (company/first/last name). " +
        "Preview validation should have blocked this row.",
      );
    }
    const companyName = effective;
    const normalizedName = normalizeForMatch(companyName);

    // 1. Resolve (create or match) the customer company via the canonical repo.
    const cachedCompany = commitCtx.withinBatchCache.get(`company:${normalizedName}`);
    let companyId: string;
    let companyCreated = false;

    if (cachedCompany) {
      companyId = cachedCompany;
    } else {
      const { customerCompany, created } =
        await customerCompanyRepository.createOrGetCustomerCompanyTx(tx, ctx.companyId, {
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
      companyId = customerCompany.id;
      companyCreated = created;

      if (!created) {
        // Fill-only billing merge: only fields that were previously empty
        // get populated. Never overwrites an existing value.
        const updates: Record<string, string | null> = {};
        if (!customerCompany.billingStreet && row.billingStreet) updates.billingStreet = row.billingStreet;
        if (!customerCompany.billingStreet2 && row.billingStreet2) updates.billingStreet2 = row.billingStreet2;
        if (!customerCompany.billingCity && row.billingCity) updates.billingCity = row.billingCity;
        if (!customerCompany.billingProvince && row.billingProvince) updates.billingProvince = row.billingProvince;
        if (!customerCompany.billingPostalCode && row.billingPostalCode) updates.billingPostalCode = row.billingPostalCode;
        if (!customerCompany.billingCountry && row.billingCountry) updates.billingCountry = row.billingCountry;
        if (Object.keys(updates).length > 0) {
          await tx
            .update(customerCompanies)
            .set(updates)
            .where(and(
              eq(customerCompanies.id, customerCompany.id),
              eq(customerCompanies.companyId, ctx.companyId),
            ));
        }
      }
      commitCtx.withinBatchCache.set(`company:${normalizedName}`, companyId);
    }

    // 2. Location — skip when the address matches an existing location,
    //    otherwise create via the canonical repo. Service address falls
    //    back to the billing address when the CSV omitted it.
    const addrKey = buildAddressCompositeKey(
      row.serviceStreet, row.serviceCity, row.serviceProvince, row.servicePostalCode,
    );
    let locationCreated = false;
    let locationId: string | undefined;

    if (addrKey !== "|||") {
      const existingLocations = await tx
        .select({
          id: clientLocations.id,
          address: clientLocations.address,
          city: clientLocations.city,
          province: clientLocations.province,
          postalCode: clientLocations.postalCode,
        })
        .from(clientLocations)
        .where(and(
          eq(clientLocations.companyId, ctx.companyId),
          eq(clientLocations.parentCompanyId, companyId),
          notDeletedClientFilter(),
        ));
      for (const loc of existingLocations) {
        const existingKey = buildAddressCompositeKey(loc.address, loc.city, loc.province, loc.postalCode);
        if (existingKey === addrKey) {
          locationId = loc.id;
          break;
        }
      }
    }

    if (!locationId) {
      const [existingPrimary] = await tx
        .select({ id: clientLocations.id })
        .from(clientLocations)
        .where(and(
          eq(clientLocations.companyId, ctx.companyId),
          eq(clientLocations.parentCompanyId, companyId),
          eq(clientLocations.isPrimary, true),
        ))
        .limit(1);
      const isPrimary = !existingPrimary;

      const addressLabel = row.serviceStreet ?? row.billingStreet ?? null;
      const cityForLabel = row.serviceCity ?? row.billingCity;
      const addressBasedName = addressLabel
        ? `${addressLabel}${cityForLabel ? `, ${cityForLabel}` : ""}`
        : null;
      const locationName = row.locationName || addressBasedName || companyName;

      const serviceStreet = row.serviceStreet ?? row.billingStreet ?? null;
      const serviceStreet2 = row.serviceStreet2 ?? row.billingStreet2 ?? null;
      const serviceCity = row.serviceCity ?? row.billingCity ?? null;
      const serviceProvince = row.serviceProvince ?? row.billingProvince ?? null;
      const servicePostalCode = row.servicePostalCode ?? row.billingPostalCode ?? null;
      const serviceCountry = row.serviceCountry ?? row.billingCountry ?? null;

      // 2026-05-01 stale-rename hardening (Option A): parented locations
      // do NOT denormalize the parent's name onto `client_locations.company_name`.
      // The display chain (`locationDisplayNameExpr`) resolves parent-first,
      // so leaving this column null keeps every location in sync with the
      // current `customer_companies.name` automatically.
      const locationData: Record<string, unknown> = {
        parentCompanyId: companyId,
        companyName: null,
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

      const { location, created } = await clientRepository.createOrGetLocationTx(
        tx, ctx.companyId, ctx.userId, locationData as any,
      );
      locationId = location.id;
      locationCreated = created;
    }

    // 3. Contact — same identity cascade as the legacy importer.
    let contactCreated = false;
    let contactId: string | undefined;
    const hasAnyContactField = !!(
      row.contactFirstName?.trim() || row.contactLastName?.trim() ||
      row.contactEmail?.trim() || row.contactPhone?.trim()
    );
    const contactIdentity = hasAnyContactField ? classifyContactIdentity(row) : null;
    if (hasAnyContactField && contactIdentity?.meaningful) {
      const { contact, created } = await clientContactRepository.createOrGetPersonTx(tx, ctx.companyId, {
        customerCompanyId: companyId,
        firstName: row.contactFirstName?.trim() || "",
        lastName: row.contactLastName?.trim() || "",
        // 2026-05-02 honorific split: Jobber's `Title` column is a
        // freeform PROFESSIONAL role (Operations Manager / Owner /
        // …), not an honorific. After the schema split, that maps
        // to `jobTitle`. The local `contactTitle` mapping key is
        // preserved (CSVs in flight don't change), only the
        // destination column moves. Honorific (`title`) is left
        // null on import — there's nothing in the upstream CSV to
        // populate it from.
        jobTitle: row.contactTitle?.trim() || null,
        email: row.contactEmail?.trim() || null,
        phone: row.contactPhone?.trim() || null,
        isPrimary: true,
      });
      contactCreated = created;
      contactId = contact.id;
    }

    const anythingCreated = companyCreated || locationCreated || contactCreated;
    // 2026-04-22 Phase 2b: expose customer/location/contact ids so the
    // Import Center's custom-field writer can target the correct entity.
    return {
      rowIndex,
      disposition: anythingCreated ? "created" : "matched",
      entityId: companyId,
      entityLabel: companyName,
      relatedEntities: {
        customerCompanyId: companyId,
        ...(locationId ? { locationId } : {}),
        ...(contactId ? { contactId } : {}),
      },
    };
  },
};

function deriveDisposition(
  company: ClientEntityAction,
  location: ClientEntityAction,
  contact: ClientEntityAction,
  hasContactField: boolean,
): "created" | "matched" {
  const parts = [company, location];
  if (hasContactField) parts.push(contact);
  return parts.every((a) => a !== "create") ? "matched" : "created";
}

// ============================================================================
// Pipeline instance
// ============================================================================

import { ImportPipeline } from "../ImportPipeline";
export const clientImportPipeline = new ImportPipeline(clientImportAdapter);
