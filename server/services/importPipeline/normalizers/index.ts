/**
 * Canonical normalizer barrel. Adapters import from
 * `server/services/importPipeline/normalizers` and compose these helpers
 * rather than re-implementing their own.
 */

export { trimOrNull, collapseWhitespace } from "./text";
export { coerceBoolean, coerceBooleanStrict } from "./bool";
export { parseMoney, parseInteger, parseNumber } from "./money";
export { parseDate, parseDateISO } from "./date";
export { splitEmails, extractFirstEmail, isValidEmailShape } from "./email";
export { normalizePhoneDisplay, normalizePhoneForMatch } from "./phone";
export {
  normalizeForMatch,
  normalizeBusinessName,
  normalizePostalForMatch,
  normalizePostalDisplay,
  normalizeStreetAddress,
  buildAddressCompositeKey,
} from "./postal";
export { normalizeHeader, resolveHeader } from "./headers";
