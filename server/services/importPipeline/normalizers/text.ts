/**
 * Canonical text normalizers used across all import adapters.
 * Consolidates the inline helpers that were duplicated in the three
 * legacy import services.
 */

/**
 * Trim a cell. Return null when the trimmed value is empty — the canonical
 * way to represent "no value" throughout the import pipeline. Adapters
 * should never store `""` for an absent field.
 */
export function trimOrNull(val: string | null | undefined): string | null {
  if (val === null || val === undefined) return null;
  const t = val.trim();
  return t === "" ? null : t;
}

/** Trim + collapse internal whitespace, but preserve casing. */
export function collapseWhitespace(val: string | null | undefined): string | null {
  const t = trimOrNull(val);
  if (t === null) return null;
  return t.replace(/\s+/g, " ");
}
