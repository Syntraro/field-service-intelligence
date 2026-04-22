/**
 * Canonical money / numeric coercion for CSV imports.
 *
 * Money values are kept as strings end-to-end (Postgres `numeric`); we
 * never convert to `number` in the business layer. These helpers strip
 * common formatting (currency symbols, thousand separators, whitespace)
 * and produce a fixed-decimal string — or null when the cell is absent.
 */

/**
 * Parse a money cell into a canonical numeric string with two decimal
 * places. Returns null when the cell is absent/empty; returns null when
 * the cell is non-numeric (caller can decide whether that's an error).
 */
export function parseMoney(val: string | null | undefined): string | null {
  if (val === null || val === undefined) return null;
  const cleaned = val.trim().replace(/[$€£¥,\s]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return null;
  return num.toFixed(2);
}

/**
 * Parse an integer cell (e.g. duration in minutes, quantity).
 * Returns null when absent/unparseable.
 */
export function parseInteger(val: string | null | undefined): number | null {
  if (val === null || val === undefined) return null;
  const t = val.trim();
  if (t === "" || t === "-") return null;
  const num = parseInt(t, 10);
  if (!Number.isFinite(num)) return null;
  return num;
}

/**
 * Parse a generic numeric cell into a raw number. Strips thousand
 * separators and whitespace. Returns null when absent/unparseable.
 */
export function parseNumber(val: string | null | undefined): number | null {
  if (val === null || val === undefined) return null;
  const cleaned = val.trim().replace(/[,\s]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}
