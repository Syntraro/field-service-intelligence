/**
 * Provider preset types (2026-04-22, simplified)
 *
 * Presets are the per-entity mapping recipe for a known provider export
 * shape. They are ONLY applied when the user explicitly picks a source —
 * there is no automatic detection anywhere in the wizard. If the user
 * selects the wrong source, that is a user-correctable mistake. The
 * system never guesses, sniffs, or silently switches.
 *
 * Pre-2026-04-22 this file also carried `PresetDetection` + header
 * signature scoring. Those concepts were removed when we made source
 * selection explicit; `applyPresetMappings` and `normalizeHeader` are
 * all that remains of the former detection module.
 */

import type { ColumnMapping } from "@shared/importPipeline/contracts";

/** Provider / source the user explicitly picked. */
export type SourceId = "jobber" | "housecall_pro" | "generic_csv";

/**
 * One preset = one known CSV shape for one (source, entity) pair. The
 * wizard looks up the preset by scanning the entity config's `presets[]`
 * for an entry whose `source` matches the user's pick. Zero matches →
 * generic manual mapping with a clear "not available yet" notice.
 */
export interface ProviderPreset {
  /** Unique id (e.g. "jobber-clients"). Used for stable React keys and test ids. */
  id: string;
  /** Which provider this preset is for. */
  source: SourceId;
  /** Which entity this preset applies to. */
  entity: "clients" | "jobs" | "products";
  /** Short label shown on the "Source" chip once selected, e.g. "Jobber Clients export". */
  label: string;
  /** Human sentence shown above the column mapper so the user knows what happened. */
  description: string;
  /**
   * `{ canonicalField: [sourceHeader, sourceHeader, ...] }` — the first
   * source header present in the CSV wins. Matching is done on the
   * normalized form (`normalizeHeader` below) of each source header.
   */
  fieldAliases: Record<string, string[]>;
  /**
   * Optional caveats surfaced next to the preset chip, e.g. "Archived
   * flag cannot be imported yet — set inactive clients manually."
   */
  limitations?: string[];
}

export type { ColumnMapping };
