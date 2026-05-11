/**
 * QuickAddJobDialog compact-form Phase D3 guard (2026-05-10).
 *
 * Pins that recurring-field labels in both the standalone block
 * ({isRecurring && !embedded}) and the embedded bottom block have been
 * migrated from raw shadcn <Label> to <CompactFormField> without htmlFor
 * (composite controls carry their own accessible names).
 *
 * Fields covered: Recurrence, Start date, End date, Frequency, Every,
 * Days, Day of month — in both block locations.
 *
 * Out of scope: schedule grid headers, Schedule section heading,
 * embedded Instructions sr-only label.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const src = readFileSync(
  resolve(__dirname, "../client/src/components/QuickAddJobDialog.tsx"),
  "utf-8",
);

const codeOnly = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\/[^\n]*/g, "");

// ── 1. No recurring Labels remain ────────────────────────────────────────────

describe("QuickAddJobDialog Phase D3 — no raw recurring Labels", () => {
  it("no <Label className=\"text-xs font-medium mb-1 block\"> remains", () => {
    expect(codeOnly).not.toMatch(/<Label\s+className="text-xs font-medium mb-1 block"/);
  });

  it("no <Label className=\"text-xs font-medium mb-1.5 block\"> remains", () => {
    expect(codeOnly).not.toMatch(/<Label\s+className="text-xs font-medium mb-1\.5 block"/);
  });
});

// ── 2. Standalone recurring fields use CompactFormField ───────────────────────

describe("QuickAddJobDialog Phase D3 — standalone recurring fields", () => {
  it("Recurrence uses CompactFormField with flex-1 and mb-1", () => {
    expect(src).toContain('CompactFormField label="Recurrence" className="flex-1" labelClassName="mb-1"');
  });

  it("Start date uses CompactFormField with flex-1 and mb-1", () => {
    expect(src).toContain('CompactFormField label="Start date *" className="flex-1" labelClassName="mb-1"');
  });

  it("End date uses CompactFormField with flex-1 and mb-1", () => {
    expect(src).toContain('CompactFormField label="End date" className="flex-1" labelClassName="mb-1"');
  });

  it("Frequency uses CompactFormField with flex-1 and mb-1", () => {
    expect(src).toContain('CompactFormField label="Frequency" className="flex-1" labelClassName="mb-1"');
  });

  it("Every uses CompactFormField with w-20 and mb-1", () => {
    expect(src).toContain('CompactFormField label="Every" className="w-20" labelClassName="mb-1"');
  });

  it("Days uses CompactFormField with mb-1.5 (at least once for standalone)", () => {
    expect(src).toContain('CompactFormField label="Days" labelClassName="mb-1.5"');
  });

  it("Day of month uses CompactFormField with w-24 and mb-1 (standalone)", () => {
    expect(src).toContain('CompactFormField label="Day of month" className="w-24" labelClassName="mb-1"');
  });

  it("standalone Recurrence/Start date/End date row flex wrapper preserved", () => {
    expect(src).toContain('className="flex items-start gap-3"');
  });

  it("standalone recurring outer container preserved", () => {
    expect(src).toContain('className="space-y-2 rounded-md border p-2.5 bg-muted/30"');
  });
});

// ── 3. Embedded recurring fields use CompactFormField ────────────────────────

describe("QuickAddJobDialog Phase D3 — embedded recurring fields", () => {
  it("Recurrence appears in CompactFormField at least twice (standalone + embedded)", () => {
    const count = (src.match(/CompactFormField label="Recurrence"/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("Start date appears in CompactFormField at least twice", () => {
    const count = (src.match(/CompactFormField label="Start date \*"/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("End date appears in CompactFormField at least twice", () => {
    const count = (src.match(/CompactFormField label="End date"/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("embedded Day of month uses CompactFormField without className (w-20 on Input, not wrapper)", () => {
    // Embedded: <CompactFormField label="Day of month" labelClassName="mb-1"> (no className)
    // The width is on the Input's className ("h-9 w-20 text-xs"), not the wrapper.
    expect(src).toContain('CompactFormField label="Day of month" labelClassName="mb-1"');
    // data-testid distinguishes embedded (input-recurring-day-of-month) from standalone (input-day-of-month)
    expect(src).toContain('data-testid="input-recurring-day-of-month"');
  });

  it("standalone Day of month data-testid is preserved", () => {
    expect(src).toContain('data-testid="input-day-of-month"');
  });
});

// ── 4. No htmlFor on recurring CompactFormFields ──────────────────────────────

describe("QuickAddJobDialog Phase D3 — no fake htmlFor on composite recurring controls", () => {
  // None of Recurrence/Start date/End date/Frequency/Every/Days/Day of month
  // should have an htmlFor — they're all composite controls.
  it('CompactFormField "Recurrence" has no htmlFor', () => {
    expect(src).not.toMatch(/CompactFormField[\s\S]{0,50}label="Recurrence"[\s\S]{0,50}htmlFor=/);
  });

  it('CompactFormField "Start date *" has no htmlFor', () => {
    expect(src).not.toMatch(/CompactFormField[\s\S]{0,50}label="Start date \*"[\s\S]{0,50}htmlFor=/);
  });

  it('CompactFormField "Days" has no htmlFor', () => {
    expect(src).not.toMatch(/CompactFormField[\s\S]{0,50}label="Days"[\s\S]{0,50}htmlFor=/);
  });
});

// ── 5. Out-of-scope elements ──────────────────────────────────────────────────
//
// Schedule heading and grid column headers were migrated in Phase E.
// The only in-scope guard remaining here is the embedded Instructions
// sr-only label (intentionally kept as a native accessible label).

describe("QuickAddJobDialog Phase D3 — out-of-scope elements untouched", () => {
  it("embedded Instructions uses native <label htmlFor> (Phase F converted shadcn Label)", () => {
    expect(codeOnly).toMatch(/<label\s+htmlFor="description-emb"\s+className="sr-only">/);
  });

  it("no form-field import was added", () => {
    expect(src).not.toMatch(/from\s+["']@\/components\/ui\/form-field["']/);
  });
});
