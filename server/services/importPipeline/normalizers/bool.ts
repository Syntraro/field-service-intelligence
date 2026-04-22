/**
 * Canonical boolean coercion for CSV imports.
 *
 * 2026-04-21: Replaces the drifted pair `coerceBoolean` (clientImport) and
 * `coerceBool` (productImport), which had divergent truthy/falsy sets. One
 * canonical set; adapters compose (not copy).
 */

const TRUE_SET = new Set(["true", "yes", "y", "1", "active", "t"]);
const FALSE_SET = new Set(["false", "no", "n", "0", "inactive", "f"]);

/**
 * Coerce a CSV cell to a boolean.
 *
 * @param val         Raw cell value (may be null/undefined/empty).
 * @param fallback    Value to return when the cell is absent, empty, or
 *                    unparseable. Callers pass the entity-level default
 *                    (e.g. `isTaxable` defaults to true, `trackInventory`
 *                    defaults to false) so the canonical function stays
 *                    entity-neutral.
 */
export function coerceBoolean(val: string | null | undefined, fallback: boolean): boolean {
  if (val === null || val === undefined) return fallback;
  const t = val.trim().toLowerCase();
  if (t === "") return fallback;
  if (TRUE_SET.has(t)) return true;
  if (FALSE_SET.has(t)) return false;
  return fallback;
}

/**
 * Tri-state variant for cases where "unparseable" should be surfaced to
 * the adapter (e.g. row validation flags an unknown value) rather than
 * silently falling back. Returns `null` when the cell is unparseable.
 */
export function coerceBooleanStrict(val: string | null | undefined): boolean | null {
  if (val === null || val === undefined) return null;
  const t = val.trim().toLowerCase();
  if (t === "") return null;
  if (TRUE_SET.has(t)) return true;
  if (FALSE_SET.has(t)) return false;
  return null;
}
