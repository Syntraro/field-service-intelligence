/**
 * addressNormalize — DTO normalization for address fields at the API boundary.
 *
 * Resolves province naming inconsistencies across endpoints:
 *   - client_locations / supplier_locations use `province`
 *   - company_settings / companies use `provinceState`
 *   - customer_companies use `billingProvince`
 *   - incoming payloads may use `stateOrProvince` (QBO / full-create)
 *
 * Also normalizes Canadian postal codes to uppercase with space (A1A 1A1).
 */

/** Regex patterns for postal code validation */
const CA_POSTAL_RE = /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/;
const US_ZIP_RE = /^\d{5}(-\d{4})?$/;

/**
 * Extract province value from any of the known province key variants.
 * Priority: explicit keys first, then common variants.
 * Returns trimmed string or null.
 */
export function extractProvince(
  input: Record<string, unknown>,
  ...keys: string[]
): string | null {
  const allKeys = [...keys, "province", "provinceState", "stateOrProvince"];
  for (const key of allKeys) {
    const val = input[key];
    if (typeof val === "string" && val.trim()) {
      return val.trim();
    }
  }
  return null;
}

/**
 * Normalize a service-address DTO (client_locations / supplier_locations).
 * Resolves province from any of the three naming variants into `province`.
 * Normalizes postal code if present.
 */
export function normalizeServiceAddress(input: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...input };

  // Province normalization — resolve from any variant into `province`
  const province = extractProvince(input);
  if (province !== null || "province" in input || "provinceState" in input || "stateOrProvince" in input) {
    result.province = province;
  }
  // Clean up alternate keys so .strict() schemas don't reject them
  delete result.provinceState;
  delete result.stateOrProvince;

  // Postal code normalization
  if (typeof input.postalCode === "string" && input.postalCode.trim()) {
    result.postalCode = normalizePostalCode(input.postalCode.trim());
  }

  return result;
}

/**
 * Normalize a company-settings DTO.
 * Resolves province into `provinceState` (the column name for companies/companySettings).
 * Normalizes postal code if present.
 */
export function normalizeCompanyAddress(input: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...input };

  const province = extractProvince(input, "provinceState");
  if (province !== null || "provinceState" in input || "province" in input || "stateOrProvince" in input) {
    result.provinceState = province;
  }
  // Clean up alternate keys
  delete result.province;
  delete result.stateOrProvince;

  if (typeof input.postalCode === "string" && input.postalCode.trim()) {
    result.postalCode = normalizePostalCode(input.postalCode.trim());
  }

  return result;
}

/**
 * Normalize a postal/zip code:
 *   1. Trim whitespace
 *   2. Remove non-alphanumeric characters (dashes, dots, etc.)
 *   3. Uppercase
 *   4. If the 6-char result matches Canadian A1A1A1 pattern, insert space → A1A 1A1
 *
 * Examples:
 *   "L4N6P1"  → "L4N 6P1"
 *   "l4n6p1"  → "L4N 6P1"
 *   "L4N-6P1" → "L4N 6P1"
 *   "90210"   → "90210"
 *   ""        → ""
 */
const CA_STRIPPED_RE = /^[A-Z]\d[A-Z]\d[A-Z]\d$/;

export function normalizePostalCode(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;

  // Already valid Canadian format with space — just uppercase
  if (CA_POSTAL_RE.test(trimmed)) {
    const upper = trimmed.toUpperCase().replace(/\s/g, "");
    return `${upper.slice(0, 3)} ${upper.slice(3)}`;
  }

  // Strip non-alphanumeric, uppercase, and check if it's a Canadian code without space
  const stripped = trimmed.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (stripped.length === 6 && CA_STRIPPED_RE.test(stripped)) {
    return `${stripped.slice(0, 3)} ${stripped.slice(3)}`;
  }

  // US ZIP or other — return trimmed original
  return trimmed;
}

/**
 * Validate a postal code string. Returns true if it matches CA or US format,
 * or if it is empty/null (postal codes are optional).
 */
export function isValidPostalCode(value: string | null | undefined): boolean {
  if (!value || !value.trim()) return true; // optional — blank is fine
  const trimmed = value.trim();
  return CA_POSTAL_RE.test(trimmed) || US_ZIP_RE.test(trimmed);
}
