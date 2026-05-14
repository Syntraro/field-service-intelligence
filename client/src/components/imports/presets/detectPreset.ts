/**
 * Preset auto-detection (2026-05-13)
 *
 * Scores each registered preset against a set of CSV headers and returns
 * the best match, or "generic_csv" when no preset clears the confidence
 * threshold.
 *
 * Scoring: for each preset, count how many of its canonical target fields
 * have at least one alias (normalized) present in the CSV header set.
 * Divide by the total number of canonical fields in the preset.
 * The preset with the highest score wins when it is at or above
 * CONFIDENCE_THRESHOLD. First-registration order breaks ties.
 *
 * This replaces the pre-2026-04-22 detection module that was removed when
 * source selection became explicit. The threshold-based approach avoids the
 * false-positive problem: a one- or two-column match on a generic CSV will
 * not trigger a Jobber preset.
 */

import { normalizeHeader } from "./applyPresetMappings";
import type { ProviderPreset, SourceId } from "./types";

export interface DetectionResult {
  /** The detected source id — "generic_csv" when nothing matched. */
  source: SourceId;
  /** The matched preset, or null when source is "generic_csv". */
  preset: ProviderPreset | null;
  /**
   * Fraction of the best-matching preset's canonical fields found in the
   * CSV (0–1). Useful for UI copy: "detected with high confidence" vs
   * "low confidence" vs "no match".
   */
  confidence: number;
}

// At least 30% of a preset's canonical fields must be present in the CSV
// for the preset to auto-apply. This prevents a one-column coincidental
// match (e.g. "Company Name" alone) from triggering a Jobber preset on a
// fully generic CSV.
export const DETECTION_THRESHOLD = 0.30;

export function detectPreset(
  headers: string[],
  presets: ProviderPreset[],
): DetectionResult {
  const normalizedHeaders = new Set(headers.map(normalizeHeader));

  let bestPreset: ProviderPreset | null = null;
  let bestConfidence = 0;

  for (const preset of presets) {
    const entries = Object.entries(preset.fieldAliases);
    if (entries.length === 0) continue;

    let matched = 0;
    for (const [, aliases] of entries) {
      if (aliases.some((a) => normalizedHeaders.has(normalizeHeader(a)))) {
        matched++;
      }
    }
    const confidence = matched / entries.length;

    // Strict greater-than keeps first-registered preset as tie-breaker.
    if (confidence > bestConfidence) {
      bestConfidence = confidence;
      bestPreset = preset;
    }
  }

  if (bestPreset && bestConfidence >= DETECTION_THRESHOLD) {
    return { source: bestPreset.source, preset: bestPreset, confidence: bestConfidence };
  }

  return { source: "generic_csv", preset: null, confidence: bestConfidence };
}
