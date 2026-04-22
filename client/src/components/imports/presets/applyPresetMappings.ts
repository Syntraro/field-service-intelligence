/**
 * Preset-mapping helpers (2026-04-22, post-detection removal)
 *
 * Two pure functions used when the user has explicitly chosen a source
 * that has a matching preset for the current entity:
 *
 *   - `normalizeHeader(h)` — canonicalizes a CSV header string for
 *     comparison against a preset's alias list. Mirrors the server's
 *     `server/services/importPipeline/normalizers/headers.ts`
 *     `normalizeHeader` — keep the two in sync or a mapping computed
 *     here will be rejected by the backend.
 *
 *   - `applyPresetMappings(headers, preset)` — walks the CSV's raw
 *     headers and returns the canonical `ColumnMapping[]` the wizard
 *     submits to `/api/imports/:entity/preview` and `/commit`.
 *
 * There is deliberately NO detection / scoring / fuzzy matching here.
 * The user picks the source; we apply that preset or we don't. If they
 * pick wrong, the column mapper shows most columns unmapped and the
 * user can either adjust manually or flip their source choice.
 */

import type { ColumnMapping, ProviderPreset } from "./types";

/** Normalize a CSV header for preset alias matching. */
export function normalizeHeader(header: string): string {
  return header
    .normalize("NFKC")
    .replace(/[#$%]/g, "")        // strip common label decorators
    .replace(/[_\-.]+/g, " ")     // separators to space
    .replace(/\s+/g, " ")         // collapse whitespace
    .trim()
    .toLowerCase();
}

/**
 * Build `ColumnMapping[]` from a preset + the CSV's raw headers.
 *
 * For each CSV column, look through the preset's `fieldAliases` for the
 * first canonical field whose alias list (normalized) contains this
 * column's normalized header. Columns with no match remain unmapped
 * (`targetField: null`) — the user can map them by hand or ignore them.
 *
 * When two aliases collide (two presets list the same source header
 * under different canonical fields), the first one registered wins.
 * This gives preset authors explicit precedence control via entry order.
 */
export function applyPresetMappings(
  headers: string[],
  preset: ProviderPreset,
): ColumnMapping[] {
  const aliasLookup = new Map<string, string>();
  for (const [field, aliases] of Object.entries(preset.fieldAliases)) {
    for (const alias of aliases) {
      const normalized = normalizeHeader(alias);
      if (!aliasLookup.has(normalized)) {
        aliasLookup.set(normalized, field);
      }
    }
  }

  return headers.map((header, idx) => {
    const normalized = normalizeHeader(header);
    const targetField = aliasLookup.get(normalized) ?? null;
    return {
      csvHeader: header,
      csvIndex: idx,
      targetField,
    };
  });
}
