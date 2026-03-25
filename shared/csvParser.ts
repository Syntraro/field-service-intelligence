/**
 * Quote-aware CSV parser — shared between server and client.
 *
 * Handles:
 * - Quoted fields with embedded commas (e.g. "Jan, May, Sep")
 * - Escaped quotes within quoted fields ("" → ")
 * - CRLF and LF line endings
 * - Empty rows filtered out
 *
 * This replaces naive String.split(",") parsing which breaks on quoted fields
 * and causes column-shift bugs in import previews.
 */

export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++; // skip escaped quote
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        current.push(field);
        field = "";
      } else if (ch === "\r" && next === "\n") {
        current.push(field);
        field = "";
        rows.push(current);
        current = [];
        i++; // skip \n
      } else if (ch === "\n") {
        current.push(field);
        field = "";
        rows.push(current);
        current = [];
      } else {
        field += ch;
      }
    }
  }

  // Final field/row
  if (field || current.length > 0) {
    current.push(field);
    rows.push(current);
  }

  // Filter out completely empty rows
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}
