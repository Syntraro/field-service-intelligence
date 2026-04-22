/**
 * Import plan types (2026-04-22 Phase 2b)
 *
 * Phase 2a introduced three actions per CSV column: IGNORE, map to a built-in
 * field, or CREATE_CUSTOM (write into the canonical Reference-Fields system).
 * Phase 2b broadens the target: each `create_custom` action now carries a
 * target entity (`job | customer_company | client_location | item`) so the
 * Clients import can route some columns to the Client and others to the
 * Location, and Products imports can create item-scoped custom fields.
 *
 * Scope note: only text-typed custom fields are supported. The canonical
 * Reference-Fields system (server/storage/referenceFields.ts) is text-only —
 * non-text storage columns were dropped 2026-04-10 and reintroducing them
 * is deferred to a later phase.
 */

import type { ColumnMapping } from "@shared/importPipeline/contracts";
import type { CustomFieldEntityId } from "./types";

// ---------------------------------------------------------------------------
// Per-column action
// ---------------------------------------------------------------------------

export type ColumnAction =
  | { kind: "ignore" }
  | { kind: "map_existing"; targetField: string }
  | {
      kind: "create_custom";
      label: string;
      /**
       * 2026-04-22 Phase 2b: which canonical entity receives this custom
       * field. Defaults are seeded by `defaultEntityForHeader` when the
       * user switches a column into create_custom mode.
       */
      entity: CustomFieldEntityId;
    };

export interface ColumnPlan {
  csvHeader: string;
  csvIndex: number;
  action: ColumnAction;
}

// ---------------------------------------------------------------------------
// Custom-field plan (derived from ColumnPlan[] for preview + commit)
// ---------------------------------------------------------------------------

/**
 * Each create_custom action turns into a CustomFieldPlan entry. The
 * wizard uses this to render the "Custom fields to create / reuse"
 * summary on the Preview step and to orchestrate definition creation on
 * commit.
 */
export interface CustomFieldPlan {
  /** Source column that feeds this custom field. */
  csvIndex: number;
  csvHeader: string;
  /** Normalized canonical label — what the user typed, trimmed. */
  label: string;
  /**
   * 2026-04-22 Phase 2b: target entity the custom field writes into.
   * Maps 1:1 with `referenceFieldEntityTypeEnum` on the backend.
   */
  entity: CustomFieldEntityId;
  /** Only text in this phase (Reference-Fields system constraint). */
  type: "text";
  /**
   * Filled in by the wizard AFTER definition creation or reuse. Carries
   * the server-assigned id used to write values for each imported row.
   */
  createdDefinitionId?: string;
  /**
   * 2026-04-22 Phase 2b: when the wizard reuses an existing tenant-scoped
   * definition with the same normalized label + entity, this flag is set
   * so the Preview summary can show "2 client fields reused" instead of
   * a misleading "will be created" message.
   */
  reusedExisting?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clean up a CSV header into a sensible default custom-field label.
 *  e.g. "PFT[Roof Code]" → "Roof Code", "Supplier Invoice #" → "Supplier Invoice". */
export function deriveCustomFieldLabel(csvHeader: string): string {
  return csvHeader
    .replace(/^PFT\[|\]$/g, "")           // strip Jobber's PFT[…] wrapper
    .replace(/[#$%]/g, "")                // strip common decorators
    .replace(/\s+/g, " ")
    .trim();
}

// 2026-04-22 Phase 2b: site-level keywords — columns whose header matches any
// of these default to the `client_location` target when the user is on the
// Clients import. Keywords are matched case-insensitively against the whole
// header after normalization.
const LOCATION_KEYWORDS = [
  "roof",
  "gate",
  "alarm",
  "filter",
  "pm",
  "building",
  "access",
  "ladder",
  "site",
  "elevator",
  "key",
  "lock",
];

/**
 * Pick the best default entity for a given CSV header, constrained to the
 * entity options offered by the current import config.
 *
 * Rules:
 *   - If exactly one target is available, use it.
 *   - If `client_location` is available and the header matches a
 *     location keyword, default to location.
 *   - Otherwise use the first available target (Client for Clients
 *     import, Job for Jobs import, etc.).
 */
export function defaultEntityForHeader(
  csvHeader: string,
  available: ReadonlyArray<{ id: CustomFieldEntityId; label: string }>,
): CustomFieldEntityId {
  if (available.length === 0) {
    // Defensive fallback — callers shouldn't invoke this when empty.
    return "job";
  }
  if (available.length === 1) return available[0].id;

  const hasLocation = available.some((a) => a.id === "client_location");
  if (hasLocation) {
    const norm = csvHeader.toLowerCase();
    if (LOCATION_KEYWORDS.some((kw) => norm.includes(kw))) {
      return "client_location";
    }
  }
  return available[0].id;
}

/** Build a ColumnPlan[] from a ColumnMapping[] (e.g. initial load from preset or backend suggestion). */
export function columnPlansFromMappings(mappings: ColumnMapping[]): ColumnPlan[] {
  return mappings.map((m) => ({
    csvHeader: m.csvHeader,
    csvIndex: m.csvIndex,
    action: m.targetField
      ? { kind: "map_existing", targetField: m.targetField }
      : { kind: "ignore" },
  }));
}

/**
 * Overlay backend-supplied mappings onto the user's current plan, preserving
 * any `create_custom` actions the user has set on columns the backend
 * doesn't know about (those would come back with `targetField: null`).
 * Used when a preview round-trip returns normalized mappings mid-session.
 */
export function mergeBackendMappings(
  existing: ColumnPlan[],
  backendMappings: ColumnMapping[],
): ColumnPlan[] {
  const existingByIdx = new Map(existing.map((p) => [p.csvIndex, p]));
  return backendMappings.map((m) => {
    if (m.targetField) {
      return {
        csvHeader: m.csvHeader,
        csvIndex: m.csvIndex,
        action: { kind: "map_existing" as const, targetField: m.targetField },
      };
    }
    const prev = existingByIdx.get(m.csvIndex);
    if (prev?.action.kind === "create_custom") {
      return prev; // keep user's custom-field decision
    }
    return {
      csvHeader: m.csvHeader,
      csvIndex: m.csvIndex,
      action: { kind: "ignore" as const },
    };
  });
}

/**
 * Derive the ColumnMapping[] we send to the backend. Custom-field columns
 * are stripped (their target is null from the backend's perspective) — the
 * wizard writes those values AFTER commit via the Reference-Fields API.
 */
export function mappingsFromPlan(plans: ColumnPlan[]): ColumnMapping[] {
  return plans.map((p) => ({
    csvHeader: p.csvHeader,
    csvIndex: p.csvIndex,
    targetField: p.action.kind === "map_existing" ? p.action.targetField : null,
  }));
}

/**
 * Extract the custom-field plans from a column-plan array.
 *
 * 2026-04-22 Phase 2b: entity is now per-column (carried on the action
 * itself), so this function no longer takes an entity parameter.
 */
export function customFieldPlansFromPlan(plans: ColumnPlan[]): CustomFieldPlan[] {
  const out: CustomFieldPlan[] = [];
  for (const p of plans) {
    if (p.action.kind !== "create_custom") continue;
    const label = p.action.label.trim();
    if (!label) continue;
    out.push({
      csvIndex: p.csvIndex,
      csvHeader: p.csvHeader,
      label,
      entity: p.action.entity,
      type: "text",
    });
  }
  return out;
}

/**
 * Validation used before enabling Continue. Returns human-readable
 * errors for any of:
 *   - required built-in field unmapped
 *   - duplicate custom-field labels (after normalization) targeting the
 *     same entity in the same session
 *   - create_custom action with empty label
 */
export function validatePlan(
  plans: ColumnPlan[],
  requiredBuiltInKeys: string[],
): string[] {
  const errors: string[] = [];

  const mappedKeys = new Set(
    plans
      .map((p) => (p.action.kind === "map_existing" ? p.action.targetField : null))
      .filter(Boolean) as string[],
  );
  for (const required of requiredBuiltInKeys) {
    if (!mappedKeys.has(required)) {
      errors.push(`Required field missing: ${required}`);
    }
  }

  // 2026-04-22 Phase 2b: duplicate-label detection is per-entity. Two
  // columns can both use the label "Notes" if one targets the Client and
  // the other targets the Location — they become two distinct defs.
  const seenByEntity = new Map<CustomFieldEntityId, Set<string>>();
  for (const p of plans) {
    if (p.action.kind !== "create_custom") continue;
    const label = p.action.label.trim();
    if (!label) {
      errors.push(`"${p.csvHeader}" is set to create a custom field but has no label.`);
      continue;
    }
    const norm = label.toLowerCase();
    const entitySeen = seenByEntity.get(p.action.entity) ?? new Set<string>();
    if (entitySeen.has(norm)) {
      errors.push(`Duplicate custom-field label for the same target: "${label}". Each new custom field must have a unique name per entity.`);
    } else {
      entitySeen.add(norm);
      seenByEntity.set(p.action.entity, entitySeen);
    }
  }

  return errors;
}
