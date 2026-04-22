/**
 * Preset registry barrel (2026-04-22, post-detection removal)
 *
 * Add new providers/presets here. Each preset is registered on the
 * matching entity config in `client/src/components/imports/configs/`.
 * Presets are looked up by (source, entity) — user picks source
 * explicitly; no detection ever runs.
 */

export type { SourceId, ProviderPreset } from "./types";

export { applyPresetMappings, normalizeHeader } from "./applyPresetMappings";

export { jobberClientsPreset } from "./jobberClientsPreset";
export { jobberJobsPreset } from "./jobberJobsPreset";
export { jobberProductsPreset } from "./jobberProductsPreset";
