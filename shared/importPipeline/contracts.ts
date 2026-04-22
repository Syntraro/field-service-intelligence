/**
 * Canonical import wire contracts.
 *
 * One PreviewResponse / CommitResponse shape used by every import entity.
 * Adapters extend `normalized` (what the adapter parses from each row) and
 * optional `details` (entity-specific extra info like
 * `{ companyAction, locationAction }` for client import).
 *
 * Intentionally NOT included in this phase: `runToken` / persisted preview
 * state / audit fields. Preview → commit is stateless: the client sends the
 * normalized rows back. A future phase can add server-side preview caching
 * and import_run tracking without changing these interfaces — callers that
 * ignore unknown fields will keep working.
 */

import type { RowDisposition, RowStatus } from "./terminology";

// ----------------------------------------------------------------------------
// Column mapping
// ----------------------------------------------------------------------------

export interface ColumnMapping {
  /** CSV column header text as it appeared in the file. */
  csvHeader: string;
  /** Index in the CSV row (0-based). */
  csvIndex: number;
  /**
   * Target field key in the entity's normalized row, or null when the user
   * chose to ignore the column. String-typed at the wire so the contract is
   * entity-neutral; adapters narrow it to their field key union.
   */
  targetField: string | null;
}

// ----------------------------------------------------------------------------
// Row error envelope
// ----------------------------------------------------------------------------

export interface RowError {
  /**
   * Field that caused the error. Use the adapter's field key where
   * applicable, or a short token like "row" for row-wide problems.
   */
  field: string;
  message: string;
}

// ----------------------------------------------------------------------------
// Validated row (preview output)
// ----------------------------------------------------------------------------

/**
 * `T` is the adapter's normalized-row type.
 * `D` is the adapter's optional per-row details payload (e.g. client import
 * uses this to expose companyAction / locationAction / contactAction).
 */
export interface ValidatedRow<T, D = undefined> {
  rowIndex: number;
  status: RowStatus;
  disposition: RowDisposition;
  errors: RowError[];
  warnings: string[];
  /**
   * Compact codes for the warning legend. Same length as `warnings`.
   * Populated by the pipeline, not by the adapter.
   */
  warningCodes?: number[];
  /** The adapter-normalized row — round-trips to the commit endpoint. */
  normalized: T;
  /**
   * Short human-readable label describing the match context when
   * disposition is `matched` (e.g. "Matches 'Acme Corp'"). Rendered by
   * the preview table.
   */
  matchLabel?: string;
  /** Adapter-defined detail payload. */
  details?: D;
}

// ----------------------------------------------------------------------------
// Preview summary
// ----------------------------------------------------------------------------

export interface PreviewSummary {
  totalRows: number;
  /** Count of rows with status `valid`. */
  validRows: number;
  /** Count of rows with status `warning`. */
  warningRows: number;
  /** Count of rows with status `blocked`. */
  blockedRows: number;
  /** Count of rows whose intended disposition is `created`. */
  toCreate: number;
  /** Count of rows whose intended disposition is `matched`. */
  toMatch: number;
  /** Count of rows whose intended disposition is `skipped`. */
  toSkip: number;
  /** Rows flagged as duplicates of an earlier row within the same CSV. */
  withinCsvDuplicates: number;
}

// ----------------------------------------------------------------------------
// Preview request / response
// ----------------------------------------------------------------------------

export interface PreviewRequest {
  csvText: string;
  /** If omitted, the server auto-suggests mappings from the headers. */
  mappings?: ColumnMapping[];
}

export interface PreviewResponse<T, D = undefined> {
  /** Headers extracted from the CSV's first row. */
  headers: string[];
  /** Up to 5 sample data rows so the UI can show the user what it parsed. */
  sampleData: string[][];
  /** Either the user-supplied mappings or server-suggested defaults. */
  mappings: ColumnMapping[];
  /** Normalized + validated rows, one per data row in the CSV. */
  rows: ValidatedRow<T, D>[];
  /** Optional per-column warnings from the parser (column-count mismatch). */
  columnCountWarnings?: string[];
  /** `{ code → message }` legend referenced by `warningCodes` on each row. */
  warningLegend?: Record<number, string>;
  summary: PreviewSummary;
}

// ----------------------------------------------------------------------------
// Commit request / response
// ----------------------------------------------------------------------------

export interface CommitRequest<T> {
  /**
   * Normalized rows to commit. Client echoes back the rows it received in
   * the preview response; the server re-validates with Zod. Blocked rows
   * and skipped duplicates MUST be filtered out by the caller before
   * posting — the commit endpoint does not second-guess disposition.
   */
  rows: T[];
}

export interface RowOutcome {
  rowIndex: number;
  disposition: RowDisposition;
  /** Canonical entity id written (when applicable). */
  entityId?: string;
  /** Human-readable label of the entity for the UI's row table. */
  entityLabel?: string;
  /** Populated when `disposition === "failed"`. */
  error?: string;
  /**
   * 2026-04-22 Phase 2b: multi-entity write targets for the Import Center's
   * inline custom-field writer. When one CSV row produces multiple canonical
   * entities (e.g. Client import creates a customer_company + client_location
   * + client_contact), the adapter populates the ids here so the commit
   * orchestrator can fan out custom-field values to the correct entity type.
   *
   * Single-entity adapters (Jobs, Products) leave this undefined — the
   * existing `entityId` is the sole write target.
   */
  relatedEntities?: {
    customerCompanyId?: string;
    locationId?: string;
    contactId?: string;
    itemId?: string;
    jobId?: string;
  };
}

export interface CommitSummary {
  totalRows: number;
  created: number;
  matched: number;
  skipped: number;
  failed: number;
}

export interface CommitResponse {
  results: RowOutcome[];
  summary: CommitSummary;
}
