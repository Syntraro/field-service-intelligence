/**
 * Preset registry barrel.
 *
 * Add new providers/presets here. Each preset is registered on the
 * matching entity config in `client/src/components/imports/configs/`.
 * Presets are scored against uploaded CSV headers by `detectPreset`
 * and applied automatically when confidence is sufficient.
 */

export type { SourceId, ProviderPreset } from "./types";

export { applyPresetMappings, normalizeHeader } from "./applyPresetMappings";
export { detectPreset } from "./detectPreset";
export type { DetectionResult } from "./detectPreset";

export { jobberClientsPreset } from "./jobberClientsPreset";
export { jobberJobsPreset } from "./jobberJobsPreset";
export { jobberProductsPreset } from "./jobberProductsPreset";
export { jobberInvoicesPreset } from "./jobberInvoicesPreset";
