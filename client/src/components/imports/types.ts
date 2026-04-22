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
  entity: "clients" | "jobs" | "products";
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
}

export type { ColumnMapping, PreviewResponse, CommitResponse, ValidatedRow };
