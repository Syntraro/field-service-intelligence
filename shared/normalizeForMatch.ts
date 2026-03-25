/**
 * Shared normalization helpers for dedup matching.
 * Used by CSV import, company creation, and contact dedup.
 */

/** Trim, collapse whitespace, lowercase. */
export function normalizeForMatch(str: string | null | undefined): string {
  if (!str) return "";
  return str.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Normalize a business/company name for cross-system matching (CSV ↔ QBO).
 * Steps: trim, lowercase, replace & with and, strip legal suffixes, strip trailing punctuation.
 * Used only for comparison — never stored as canonical name.
 */
const LEGAL_SUFFIX_RE = /\b(inc|incorporated|inc\.|corp|corporation|corp\.|ltd|limited|ltd\.|llc|l\.l\.c\.|llp|l\.l\.p\.|co|co\.|company|plc|p\.l\.c\.)\s*$/i;

export function normalizeBusinessName(name: string | null | undefined): string {
  if (!name) return "";
  let s = name.trim().replace(/\s+/g, " ");
  // Replace & with "and" before lowering
  s = s.replace(/&/g, "and");
  s = s.toLowerCase();
  // Strip trailing legal suffix (one pass — suffixes don't nest)
  s = s.replace(LEGAL_SUFFIX_RE, "").trim();
  // Strip remaining trailing punctuation (commas, periods, dashes)
  s = s.replace(/[.,\-]+$/, "").trim();
  return s;
}

/**
 * Strip all non-digit characters for phone comparison.
 * Returns empty string for null/undefined/empty.
 */
export function stripNonDigits(str: string | null | undefined): string {
  if (!str) return "";
  return str.replace(/\D/g, "");
}

/**
 * Normalize postal/ZIP code for comparison: uppercase, strip spaces/hyphens.
 * "L4N 6P1" → "L4N6P1", "90210-1234" → "902101234"
 */
export function normalizePostalForMatch(postal: string | null | undefined): string {
  if (!postal) return "";
  return postal.trim().toUpperCase().replace(/[\s\-]/g, "");
}

/**
 * Normalize a street address for comparison: lowercase, collapse whitespace,
 * standardize common suffixes (street→st, avenue→ave, etc.), strip trailing periods/commas.
 */
const STREET_SUFFIX_MAP: Record<string, string> = {
  street: "st", avenue: "ave", boulevard: "blvd", drive: "dr",
  road: "rd", lane: "ln", court: "ct", place: "pl", crescent: "cres",
  circle: "cir", terrace: "terr", trail: "trl", way: "way",
  highway: "hwy", parkway: "pkwy",
};

export function normalizeStreetAddress(addr: string | null | undefined): string {
  if (!addr) return "";
  let s = addr.trim().replace(/\s+/g, " ").toLowerCase();
  // Strip trailing periods and commas
  s = s.replace(/[.,]+$/, "");
  // Normalize direction abbreviations with periods: "n." → "n", "s.w." → "sw"
  s = s.replace(/\b([nsew])\.([nsew])?\.?\b/gi, (_m, a, b) =>
    `${a}${b || ""}`.toLowerCase()
  );
  // Normalize street suffixes (only the last word that matches)
  s = s.replace(
    /\b(street|avenue|boulevard|drive|road|lane|court|place|crescent|circle|terrace|trail|highway|parkway)\.?\b/gi,
    (match) => STREET_SUFFIX_MAP[match.replace(/\.$/, "").toLowerCase()] || match.toLowerCase()
  );
  return s;
}

/**
 * Build a composite key from address parts for location dedup.
 * Two locations with same key under same company = duplicate.
 * Uses normalizePostalForMatch for postal codes and normalizeForMatch for other fields.
 */
export function buildAddressCompositeKey(
  address: string | null | undefined,
  city: string | null | undefined,
  province: string | null | undefined,
  postal: string | null | undefined
): string {
  return [
    normalizeForMatch(address),
    normalizeForMatch(city),
    normalizeForMatch(province),
    normalizePostalForMatch(postal),
  ].join("|");
}
