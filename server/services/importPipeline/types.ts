/**
 * Internal types for the import pipeline orchestrator.
 *
 * Public wire contracts live in `shared/importPipeline/contracts.ts`;
 * the types here describe the adapter interface and runtime context.
 */

import type {
  ColumnMapping,
  RowError,
  ValidatedRow,
  PreviewResponse,
  CommitResponse,
  RowOutcome,
} from "@shared/importPipeline/contracts";

// ----------------------------------------------------------------------------
// Tenant / request context passed through every adapter call
// ----------------------------------------------------------------------------

export interface ImportContext {
  companyId: string;
  userId: string;
  /** IANA timezone for the tenant, used for date parsing. */
  timezone: string | null;
}

// ----------------------------------------------------------------------------
// Adapter interface
// ----------------------------------------------------------------------------

/**
 * Adapters define only entity-specific behavior. Everything generic
 * (parse, header suggest, within-CSV dedup classification, warning
 * legend, tx wrapping, summary aggregation) lives in the orchestrator.
 *
 * Generic parameters:
 *   N — adapter's normalized row type (what `normalizeRow` returns and
 *       what round-trips through preview → commit).
 *   D — adapter's per-row details payload (shown alongside dispositions
 *       on the preview table). Use `undefined` when not needed.
 *   P — adapter's preview-scope context (e.g. prefetched tenant cache,
 *       DB lookups reused across all rows). Built once by
 *       `buildPreviewContext` and passed to `validateRow` for every row.
 */
export interface ImportAdapter<N, D = undefined, P = undefined> {
  /** Stable adapter key (also the URL segment: `/api/imports/:entity`). */
  readonly entity: string;
  /** Human-readable plural (used in messages and the wizard). */
  readonly entityLabelPlural: string;
  /** Maximum CSV row count enforced by the orchestrator. */
  readonly maxRows: number;
  /** Maximum CSV byte size enforced by the orchestrator. */
  readonly maxBytes: number;

  /** Entity field definitions shown in the mapping UI. */
  readonly fieldDefs: readonly AdapterFieldDef[];

  /**
   * Canonical alias map: normalized-header → target field key.
   * Keys MUST already be run through `normalizeHeader()`.
   */
  readonly headerAliases: Record<string, string>;

  /**
   * Normalize one CSV row. Pure function — no DB access. Called once per
   * row during preview and again (indirectly, via request validation) at
   * commit time.
   */
  normalizeRow(cells: string[], mappings: ColumnMapping[], ctx: ImportContext): N;

  /**
   * Build any preview-scope context the adapter wants to reuse across
   * every `validateRow` call (e.g. a tenant-wide entity cache). Called
   * once per preview request. Adapters without preview-scope state can
   * return `undefined as unknown as P`.
   */
  buildPreviewContext(ctx: ImportContext, normalizedRows: N[]): Promise<P>;

  /**
   * Validate a single normalized row. Returns the adapter-specific
   * disposition + optional details. Runs AFTER `buildPreviewContext`.
   */
  validateRow(
    normalized: N,
    rowIndex: number,
    ctx: ImportContext,
    previewCtx: P,
  ): Promise<AdapterRowValidation<D>>;

  /**
   * Within-CSV duplicate classification. Mutates each row's disposition
   * when that row duplicates an earlier row in the same file. Runs after
   * every row has been validated individually. Returns the duplicate
   * count (used for the preview summary).
   *
   * Adapters without within-CSV dedup return `{ withinCsvDuplicates: 0 }`.
   */
  classifyWithinCsv(rows: ValidatedRow<N, D>[]): { withinCsvDuplicates: number };

  /**
   * Apply a single validated row. Pipeline wraps this in `db.transaction`
   * (adapters never call `db.transaction` themselves) so multi-write
   * adapters are atomic. Adapters receive the tx handle via closure using
   * `applyRowInTx` — see `ImportPipeline.commit` for the wrapper.
   *
   * Return the canonical entity id (or undefined for skip/failed).
   */
  applyRow(
    normalized: N,
    rowIndex: number,
    ctx: ImportContext,
    commitCtx: CommitRuntimeCtx<N>,
  ): Promise<RowOutcome>;

  /**
   * Optional capacity / feature-gate assertion called once before the
   * commit loop. Throw to reject the entire import. The orchestrator
   * passes the count of rows whose preview disposition was `created`.
   */
  assertCapacity?(ctx: ImportContext, rowsToCreate: number): Promise<void>;

  /**
   * Optional per-adapter post-preview hook for messages the UI should
   * surface prominently above the row table (e.g. "Historical jobs are
   * created as archived records"). Returned strings are added to the
   * preview response under `columnCountWarnings` style copy for now.
   */
  previewBanner?(ctx: ImportContext): string | null;
}

/** Result of `validateRow` — adapter-specific disposition + optional details. */
export interface AdapterRowValidation<D = undefined> {
  errors: RowError[];
  warnings: string[];
  /** Pre-within-CSV-dedup disposition — `created`, `matched`, or `failed`. */
  disposition: "created" | "matched" | "failed";
  matchLabel?: string;
  details?: D;
}

export interface AdapterFieldDef {
  key: string;
  label: string;
  required: boolean;
  /** Optional group heading for the mapping UI (e.g. "Billing", "Contact"). */
  group?: string;
  /** Optional helper text rendered next to the field in the mapper. */
  hint?: string;
}

/**
 * Shared per-commit runtime context. Adapters use `withinBatchCache` to
 * deduplicate within the active commit batch without rolling their own
 * state, and use `tx` for all DB writes.
 */
export interface CommitRuntimeCtx<_N> {
  /** Transaction handle provided by the orchestrator. */
  tx: any;
  /**
   * Free-form within-batch cache. Adapters own the keyspace (prefix with
   * the entity name) — the pipeline never inspects keys.
   */
  withinBatchCache: Map<string, string>;
}

// Re-export the wire types for convenience so adapter files import from
// one place.
export type {
  ColumnMapping,
  RowError,
  ValidatedRow,
  PreviewResponse,
  CommitResponse,
  RowOutcome,
};
