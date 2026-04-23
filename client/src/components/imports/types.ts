/**
 * Frontend types for the shared import wizard. Mirrors the backend wire
 * contract in `shared/importPipeline/contracts.ts` plus the per-entity
 * display config the wizard needs.
 */

import type { LucideIcon } from "lucide-react";
import type {
  ColumnMapping,
  PreviewResponse,
  CommitResponse,
  ValidatedRow,
} from "@shared/importPipeline/contracts";
import type { ProviderPreset } from "./presets/types";

/** Field definition as the backend adapter exposes it. */
export interface ImportFieldDef {
  key: string;
  label: string;
  required: boolean;
  group?: string;
  hint?: string;
}

/** Per-entity configuration — everything the wizard needs to render. */
export interface ImportWizardConfig {
  /** Backend entity key — matches the adapter registry. */
  entity: "clients" | "jobs" | "products" | "invoices";
  /** Page title (e.g. "Import Clients"). */
  title: string;
  /** Short one-line description under the title. */
  description: string;
  /** Plural noun for row counts ("client rows", "job rows", "items"). */
  rowNoun: string;
  /** Header icon. */
  icon: LucideIcon;
  /** Field definitions shown in the column mapper. */
  fieldDefs: ImportFieldDef[];
  /** Optional per-field group ordering for the mapper — defaults to insertion order. */
  fieldGroups?: string[];
  /** Template CSV text. Rendered as a "Download template" link above upload. */
  template: {
    filename: string;
    csv: string;
  };
  /** Optional per-entity content inserted above the upload step. */
  uploadBanner?: string;
  /** Optional content shown above the commit confirmation. */
  commitBanner?: string;
  /**
   * 2026-04-22: Provider presets registered for this entity. Order matters
   * only when two presets could both match — the first definition wins
   * at equal confidence (tie-breaker by array order). Omit or empty-array
   * to disable provider-aware auto-mapping entirely; the wizard falls
   * back to its existing generic CSV behavior.
   */
  presets?: ProviderPreset[];
  /**
   * 2026-04-22 Phase 2b: canonical custom-field (Reference Fields) entity
   * targets this import can write into. Presence of at least one entry
   * enables the "Create custom field" action in the Map step. When more
   * than one target is listed, the Map-step form shows a target picker
   * per column; smart defaults route columns by keyword heuristics.
   *
   * Supported targets across Phase 2b:
   *   - "job"              → Jobs import
   *   - "customer_company" → Clients import (Client-level)
   *   - "client_location"  → Clients import (Location-level) and Jobs import
   *   - "item"             → Products / Services import
   */
  customFieldEntities?: Array<{ id: CustomFieldEntityId; label: string }>;
}

/**
 * 2026-04-22 Phase 2b: canonical Reference-Fields entity targets. Mirrors
 * `referenceFieldEntityTypeEnum` on the backend but narrowed to the entities
 * the Import Center writes to today.
 */
export type CustomFieldEntityId =
  | "job"
  | "customer_company"
  | "client_location"
  | "item";

export type { ColumnMapping, PreviewResponse, CommitResponse, ValidatedRow };
