/**
 * QuickAddJobDialog compact-form Phase D1 guard (2026-05-10).
 *
 * Pins that the 3 top-section composite-control labels (Location, Services,
 * Equipment) have been migrated from raw shadcn <Label> to <CompactFormField>
 * without htmlFor (renders <span aria-hidden="true"> — composite controls
 * carry their own accessible names via role/aria-label).
 *
 * Out of scope here: schedule grid headers, recurring fields, embedded bottom-
 * block labels, modal footer (Phase D2+).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const src = readFileSync(
  resolve(__dirname, "../client/src/components/QuickAddJobDialog.tsx"),
  "utf-8",
);

// Strip comments so doc-commentary mentioning legacy patterns doesn't
// false-match the negative pins below.
const codeOnly = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\/[^\n]*/g, "");

// ── 1. Import ─────────────────────────────────────────────────────────────────

describe("QuickAddJobDialog Phase D1 — import", () => {
  it("imports CompactFormField from @/components/ui/compact-form-field", () => {
    expect(src).toMatch(/from\s+["']@\/components\/ui\/compact-form-field["']/);
  });

  it("does NOT import from @/components/ui/form-field", () => {
    expect(src).not.toMatch(/from\s+["']@\/components\/ui\/form-field["']/);
  });
});

// ── 2. Location field ─────────────────────────────────────────────────────────

describe("QuickAddJobDialog Phase D1 — Location field", () => {
  it("uses <CompactFormField for Location (no htmlFor — composite control)", () => {
    // Search for the JSX usage <LocationCombobox (not the function definition)
    const jsxIdx = codeOnly.indexOf("<LocationCombobox");
    expect(jsxIdx).toBeGreaterThan(0);
    const blockBefore = codeOnly.slice(Math.max(0, jsxIdx - 400), jsxIdx);
    expect(blockBefore).toContain("CompactFormField");
  });

  it("Location CompactFormField has no htmlFor (renders aria-hidden span)", () => {
    // The Location CompactFormField must not pass htmlFor=
    // We verify by checking that htmlFor does not appear between the
    // label text and the LocationCombobox usage.
    const compactStart = codeOnly.indexOf("Location *");
    const comboboxStart = codeOnly.indexOf("LocationCombobox", compactStart);
    const slice = codeOnly.slice(compactStart - 200, comboboxStart);
    expect(slice).not.toMatch(/htmlFor="[^"]*"/);
  });

  it("embedded path still hides Location label (labelClassName sr-only)", () => {
    expect(src).toMatch(/labelClassName=\{embedded\s*\?\s*["']sr-only["']/);
  });

  it("no longer uses raw shadcn <Label> for Location visible label", () => {
    // The non-embedded visible label was <Label className="text-xs...">Location *</Label>
    expect(codeOnly).not.toMatch(/<Label\s+className="[^"]*"\s*>\s*Location \*/);
  });

  it("no longer uses raw shadcn <Label htmlFor=\"qa-location\">", () => {
    expect(codeOnly).not.toMatch(/<Label\s+htmlFor="qa-location"/);
  });

  it("still renders LocationCombobox as a child", () => {
    expect(src).toContain("<LocationCombobox");
  });
});

// ── 3. Services field ─────────────────────────────────────────────────────────

describe("QuickAddJobDialog Phase D1 — Services field", () => {
  it("uses <CompactFormField for Services (no htmlFor)", () => {
    // Find the CompactFormField containing "Service (optional)"
    expect(codeOnly).toContain("Service (optional)");
    const serviceIdx = codeOnly.indexOf("Service (optional)");
    const blockBefore = codeOnly.slice(Math.max(0, serviceIdx - 300), serviceIdx);
    expect(blockBefore).toContain("CompactFormField");
  });

  it("Services label contains icon + text in a flex span", () => {
    // The icon+text are wrapped in a span with flex layout
    expect(src).toMatch(/<span\s+className="flex items-center gap-1\.5">/);
  });

  it("no longer uses raw shadcn <Label> for Services label", () => {
    expect(codeOnly).not.toMatch(/<Label\s+className="[^"]*"\s*>\s*[\s\S]{0,50}Service \(optional\)/);
  });

  it("still renders ServicesMultiSelect as a child", () => {
    expect(src).toContain("<ServicesMultiSelect");
  });
});

// ── 4. Equipment field ────────────────────────────────────────────────────────

describe("QuickAddJobDialog Phase D1 — Equipment field", () => {
  it("uses <CompactFormField for Equipment (no htmlFor)", () => {
    expect(codeOnly).toContain("Equipment (optional)");
    const equipIdx = codeOnly.indexOf("Equipment (optional)");
    const blockBefore = codeOnly.slice(Math.max(0, equipIdx - 300), equipIdx);
    expect(blockBefore).toContain("CompactFormField");
  });

  it("no longer uses raw shadcn <Label> for Equipment label", () => {
    expect(codeOnly).not.toMatch(/<Label\s+className="[^"]*"\s*>\s*[\s\S]{0,50}Equipment \(optional\)/);
  });

  it("still renders EquipmentCombobox as a child", () => {
    expect(src).toContain("<EquipmentCombobox");
  });
});

// ── 5. Service+Equipment grid layout preserved ────────────────────────────────

describe("QuickAddJobDialog Phase D1 — Service+Equipment grid layout", () => {
  it("Service and Equipment share the md:grid-cols-2 grid wrapper", () => {
    expect(src).toContain('className="grid grid-cols-1 md:grid-cols-2 gap-2"');
  });

  it("grid wrapper is conditional on !isEditMode && !embedded", () => {
    expect(codeOnly).toMatch(/isEditMode[\s\S]{0,30}embedded[\s\S]{0,200}grid grid-cols-1 md:grid-cols-2/);
  });
});

// ── 6. Phase C targets untouched ─────────────────────────────────────────────

describe("QuickAddJobDialog Phase D1 — Phase C targets unchanged", () => {
  it("Summary still uses CompactFormField htmlFor=\"summary\"", () => {
    expect(codeOnly).toMatch(/CompactFormField[\s\S]{0,200}htmlFor="summary"/);
  });

  it("Team Instructions still uses CompactFormField htmlFor=\"description\"", () => {
    expect(codeOnly).toMatch(/CompactFormField[\s\S]{0,200}htmlFor="description"/);
  });

  it("Make Recurring still uses native horizontal flex layout (not CompactFormField)", () => {
    expect(codeOnly).toMatch(/<div\s+className="flex items-center gap-2">/);
    expect(codeOnly).not.toMatch(/CompactFormField[\s\S]{0,200}htmlFor="make-recurring"/);
  });
});
