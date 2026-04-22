/**
 * ImportPipeline — canonical orchestrator for entity CSV imports.
 *
 * The pipeline owns every step that is NOT entity-specific:
 *   • Parse the CSV (delegates to `parse.ts`).
 *   • Suggest column mappings from the adapter's alias map.
 *   • Run `adapter.normalizeRow` for every data row.
 *   • Build the adapter's preview-scope context ONCE and pass it to
 *     every `adapter.validateRow` call (fixes N×M catalog re-loading).
 *   • Classify within-CSV duplicates (delegates to the adapter).
 *   • Build the warning legend.
 *   • Aggregate summary counts using canonical dispositions.
 *   • Wrap every commit row in `db.transaction` so adapters never do.
 *
 * Adapters only implement entity-specific logic. This module is the
 * single source of truth for the preview → commit contract.
 */

import { db } from "../../db";
import { parseCsv, CsvParseError } from "./parse";
import { normalizeHeader } from "./normalizers";
import type {
  ImportAdapter,
  ImportContext,
  CommitRuntimeCtx,
} from "./types";
import type {
  ColumnMapping,
  PreviewResponse,
  CommitResponse,
  ValidatedRow,
  RowOutcome,
  PreviewSummary,
  CommitSummary,
} from "@shared/importPipeline/contracts";

export { CsvParseError };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class ImportPipeline<N, D = undefined, P = undefined> {
  constructor(private readonly adapter: ImportAdapter<N, D, P>) {}

  // -------------------------------------------------------------------------
  // Preview
  // -------------------------------------------------------------------------

  async preview(
    csvText: string,
    suppliedMappings: ColumnMapping[] | undefined,
    ctx: ImportContext,
  ): Promise<PreviewResponse<N, D>> {
    // 1. Parse + size guards.
    const parsed = parseCsv(csvText, { maxRows: this.adapter.maxRows });

    // 2. Mappings — either the user-supplied set or auto-suggested from
    //    the adapter's alias map.
    const mappings =
      suppliedMappings && suppliedMappings.length > 0
        ? suppliedMappings
        : this.suggestMappings(parsed.headers);

    // 3. Normalize every row. Pure — no DB access.
    const normalizedRows: N[] = parsed.dataRows.map((row) =>
      this.adapter.normalizeRow(row, mappings, ctx),
    );

    // 4. Preview-scope context. Built ONCE for the whole preview, so
    //    adapters can prefetch tenant-wide data rather than re-query
    //    per row.
    const previewCtx = await this.adapter.buildPreviewContext(ctx, normalizedRows);

    // 5. Validate every row.
    const rows: ValidatedRow<N, D>[] = [];
    for (let i = 0; i < normalizedRows.length; i++) {
      const normalized = normalizedRows[i];
      const result = await this.adapter.validateRow(normalized, i, ctx, previewCtx);

      const hasErrors = result.errors.length > 0;
      const hasWarnings = result.warnings.length > 0;
      const status = hasErrors ? "blocked" : hasWarnings ? "warning" : "valid";
      // When validation errors are present, disposition is `failed`
      // regardless of what the adapter proposed. This keeps the
      // disposition contract honest: a blocked row cannot "match" or
      // "create" anything.
      const disposition = hasErrors ? "failed" : result.disposition;

      rows.push({
        rowIndex: i,
        status,
        disposition,
        errors: result.errors,
        warnings: result.warnings,
        normalized,
        matchLabel: result.matchLabel,
        details: result.details,
      });
    }

    // 6. Within-CSV duplicate classification.
    const { withinCsvDuplicates } = this.adapter.classifyWithinCsv(rows);

    // 7. Warning legend (compact codes referenced by each row).
    const { warningLegend, legendSize } = buildWarningLegend(rows);

    // 8. Summary.
    const summary = buildPreviewSummary(rows, withinCsvDuplicates);

    // 9. Optional banner message.
    const banner = this.adapter.previewBanner?.(ctx);
    const columnCountWarnings = [
      ...(banner ? [banner] : []),
      ...parsed.columnCountWarnings,
    ];

    return {
      headers: parsed.headers,
      sampleData: parsed.sampleData,
      mappings,
      rows,
      columnCountWarnings: columnCountWarnings.length > 0 ? columnCountWarnings : undefined,
      warningLegend: legendSize > 0 ? warningLegend : undefined,
      summary,
    };
  }

  // -------------------------------------------------------------------------
  // Commit
  // -------------------------------------------------------------------------

  async commit(rows: N[], ctx: ImportContext): Promise<CommitResponse> {
    // Capacity gate — adapter decides whether to throw.
    if (this.adapter.assertCapacity) {
      // "rows to create" is the incoming row count; adapters that want
      // fine-grained counts can re-classify inside `assertCapacity`.
      await this.adapter.assertCapacity(ctx, rows.length);
    }

    const withinBatchCache = new Map<string, string>();
    const results: RowOutcome[] = [];
    let created = 0;
    let matched = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      let outcome: RowOutcome;
      try {
        outcome = await db.transaction(async (tx) => {
          const commitCtx: CommitRuntimeCtx<N> = { tx, withinBatchCache };
          return this.adapter.applyRow(row, i, ctx, commitCtx);
        });
      } catch (err: any) {
        outcome = {
          rowIndex: i,
          disposition: "failed",
          error: err?.message ?? "Unknown error",
        };
      }

      results.push(outcome);
      switch (outcome.disposition) {
        case "created": created++; break;
        case "matched": matched++; break;
        case "skipped": skipped++; break;
        case "failed":  failed++;  break;
      }
    }

    const summary: CommitSummary = {
      totalRows: rows.length,
      created,
      matched,
      skipped,
      failed,
    };

    return { results, summary };
  }

  // -------------------------------------------------------------------------
  // Header → field suggestion
  // -------------------------------------------------------------------------

  suggestMappings(headers: string[]): ColumnMapping[] {
    const aliases = this.adapter.headerAliases;
    return headers.map((header, index) => {
      const norm = normalizeHeader(header);
      const targetField = aliases[norm] ?? null;
      return { csvHeader: header, csvIndex: index, targetField };
    });
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function buildWarningLegend<N, D>(rows: ValidatedRow<N, D>[]): {
  warningLegend: Record<number, string>;
  legendSize: number;
} {
  const warningSet = new Map<string, number>();
  for (const row of rows) {
    for (const w of row.warnings) {
      if (!warningSet.has(w)) warningSet.set(w, warningSet.size + 1);
    }
  }
  const warningLegend: Record<number, string> = {};
  warningSet.forEach((code, msg) => {
    warningLegend[code] = msg;
  });
  for (const row of rows) {
    row.warningCodes = row.warnings.map((w) => warningSet.get(w)!);
  }
  return { warningLegend, legendSize: warningSet.size };
}

function buildPreviewSummary<N, D>(
  rows: ValidatedRow<N, D>[],
  withinCsvDuplicates: number,
): PreviewSummary {
  let validRows = 0;
  let warningRows = 0;
  let blockedRows = 0;
  let toCreate = 0;
  let toMatch = 0;
  let toSkip = 0;

  for (const row of rows) {
    if (row.status === "valid") validRows++;
    else if (row.status === "warning") warningRows++;
    else blockedRows++;

    switch (row.disposition) {
      case "created": toCreate++; break;
      case "matched": toMatch++; break;
      case "skipped": toSkip++; break;
      // `failed` rows aren't counted in the "intended disposition" trio
      // because they carry blocking errors. They're accounted for via
      // `blockedRows` above.
    }
  }

  return {
    totalRows: rows.length,
    validRows,
    warningRows,
    blockedRows,
    toCreate,
    toMatch,
    toSkip,
    withinCsvDuplicates,
  };
}
