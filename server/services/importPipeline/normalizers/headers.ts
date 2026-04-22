/**
 * Canonical CSV header normalizer.
 *
 * 2026-04-21: Replaces the three drifting header normalizations in the
 * legacy import services. ALL entity imports go through this helper so
 * aliases behave consistently regardless of entity.
 *
 *   "Unit_Price"  → "unit price"
 *   "UNIT-PRICE"  → "unit price"
 *   "  Unit  Price " → "unit price"
 */

/** Normalize a raw CSV header for alias-map lookup. */
export function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ");
}

/**
 * Look up a header against the adapter's alias map. The alias map keys
 * are expected to be already-normalized (same function applied at module
 * load time); callers that build alias maps inline should do the same.
 */
export function resolveHeader<K extends string>(
  header: string,
  aliases: Record<string, K>,
): K | null {
  const key = normalizeHeader(header);
  return aliases[key] ?? null;
}
