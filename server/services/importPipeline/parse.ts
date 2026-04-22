/**
 * Canonical CSV parsing entry-point for the import pipeline.
 *
 * Thin wrapper around `@shared/csvParser.parseCSV` (the canonical
 * quote-aware parser) that returns the structured preview shape the
 * pipeline needs: headers, data rows, and column-count warnings.
 *
 * All size/row guards live here so adapters never have to duplicate them.
 */

import { parseCSV as rawParseCSV } from "@shared/csvParser";

export interface ParsedCsv {
  headers: string[];
  /** Data rows — header row excluded, fully-empty rows filtered. */
  dataRows: string[][];
  /** Up to 5 sample rows for the mapping UI. */
  sampleData: string[][];
  /** Non-fatal parser warnings (column-count mismatch, up to 20 rows). */
  columnCountWarnings: string[];
}

export interface ParseOptions {
  /** Reject CSV larger than this many data rows. */
  maxRows: number;
}

export class CsvParseError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = "CsvParseError";
  }
}

export function parseCsv(csvText: string, options: ParseOptions): ParsedCsv {
  const parsed = rawParseCSV(csvText);
  if (parsed.length < 2) {
    throw new CsvParseError("CSV must have a header row and at least one data row");
  }

  const headers = parsed[0].map((h) => h.trim());
  const dataRows = parsed.slice(1);

  if (dataRows.length > options.maxRows) {
    throw new CsvParseError(
      `Too many rows (${dataRows.length}). Maximum is ${options.maxRows}.`,
    );
  }

  const columnCountWarnings: string[] = [];
  const headerCount = headers.length;
  const probe = Math.min(dataRows.length, 20);
  for (let i = 0; i < probe; i++) {
    if (dataRows[i].length !== headerCount) {
      columnCountWarnings.push(
        `Row ${i + 2} has ${dataRows[i].length} columns (expected ${headerCount}).`,
      );
    }
  }

  return {
    headers,
    dataRows,
    sampleData: dataRows.slice(0, 5),
    columnCountWarnings,
  };
}

// Re-export the raw parser for adapters that need to parse client-side
// in tests, and for the frontend header/sample preview step.
export { rawParseCSV as parseCSV };
